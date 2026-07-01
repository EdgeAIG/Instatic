/**
 * Agent document read surface.
 *
 * Produces the annotated HTML + compact CSS payload that agents inspect before
 * editing. It is runtime-agnostic: both server-side catalog tests and the
 * browser executor use this helper so document reads behave the same way.
 */

import type { IModuleRegistry } from '@core/module-engine'
import {
  collectUserStylesheetCss,
  generateFrameworkCss,
  generateClassCSS,
  publishPage,
  renderNode,
  sanitizeModuleCSS,
  type SiteCssBundle,
} from '@core/publisher'
import { generateFontTokenVariablesCss } from '@core/fonts'
import {
  isGeneratedClass,
  type Page,
  type SiteDocument,
  type StyleRule,
} from '@core/page-tree'

export interface AgentDocumentRender {
  /** Annotated inner <body> HTML (uid="<nodeId>" on each element). */
  html: string
  /** The document CSS wrapped in a <style> block; '' when there is no CSS. */
  css: string
  /** Paging and cleanup metadata for the returned read_document slice. */
  pageInfo: AgentDocumentInfo
}

export interface AgentDocumentInfo {
  part: number
  totalParts: number
  nextPart: number | null
  /** Hard ceiling for JSON.stringify({ html, css, pageInfo }).length. */
  maxChars: number
  /** Full cleaned html+css character count before paging. */
  totalChars: number
  /** Character count of the returned html+css slice before JSON escaping. */
  returnedChars: number
  /** JSON.stringify({ html, css, pageInfo }).length for this result. */
  serializedChars: number
  ranges: AgentDocumentRange[]
  cleanedStrings: AgentDocumentCleanedStrings
  note: string
}

export interface AgentDocumentRange {
  field: 'html' | 'css'
  start: number
  end: number
  totalChars: number
}

export interface AgentDocumentCleanedStrings {
  base64DataUrls: number
  longUrls: number
}

export interface AgentDocumentRenderOptions {
  part?: number
  maxSerializedChars?: number
}

const DEFAULT_READ_DOCUMENT_MAX_SERIALIZED_CHARS = 80_000
const MIN_READ_DOCUMENT_MAX_SERIALIZED_CHARS = 1_200
const PLACEHOLDER_TOTAL_PARTS = 999_999
const LONG_URL_MAX_CHARS = 240
const LONG_URL_PREFIX_CHARS = 160
const LONG_URL_SUFFIX_CHARS = 40
const BASE64_DATA_URL_MAX_PAYLOAD_CHARS = 96
const READ_DOCUMENT_PAGING_NOTE =
  'read_document is size-budgeted. If nextPart is not null, call read_document with that part to continue. Long base64/data URLs and very long URLs are summarized; use node uid values with getNodeHtml when exact node markup is needed.'

const EMPTY_AGENT_CSS_BUNDLE: SiteCssBundle = {
  reset: { bundle: 'reset', filename: 'reset-empty.css', hash: 'empty', content: '' },
  framework: { bundle: 'framework', filename: 'framework-empty.css', hash: 'empty', content: '' },
  style: { bundle: 'style', filename: 'style-empty.css', hash: 'empty', content: '' },
  userStyles: { bundle: 'userStyles', filename: 'userStyles-empty.css', hash: 'empty', content: '' },
}

export function renderAgentDocument(
  page: Page,
  site: SiteDocument,
  registry: IModuleRegistry,
  options: AgentDocumentRenderOptions = {},
): AgentDocumentRender {
  const { html: fullDocument } = publishPage(page, site, registry, {
    annotateNodeIds: true,
    cssEmission: 'external',
    cssBundle: EMPTY_AGENT_CSS_BUNDLE,
  })
  const cleanedStrings: AgentDocumentCleanedStrings = { base64DataUrls: 0, longUrls: 0 }
  const html = cleanAgentReadSurface(extractBody(fullDocument), cleanedStrings)
  const cssBody = [
    buildAgentFrameworkCss(site),
    collectPageModuleCss(page, site, registry),
    collectAgentDocumentClassCss(page, site),
    collectUserStylesheetCss(site, page),
  ].filter(Boolean).join('\n\n')
  const css = cssBody ? cleanAgentReadSurface(`<style>\n${cssBody}\n</style>`, cleanedStrings) : ''

  return paginateAgentDocument({ html, css, cleanedStrings }, options)
}

/** Extract the inner `<body>` HTML from a full published document. */
function extractBody(html: string): string {
  const m = html.match(/<body[^>]*>([\s\S]*)<\/body>/)
  return m ? m[1] : html
}

function buildAgentFrameworkCss(site: SiteDocument): string {
  return [
    generateFontTokenVariablesCss(site.settings.fonts),
    generateFrameworkCss(site),
  ].filter(Boolean).join('\n')
}

function paginateAgentDocument(
  payload: { html: string; css: string; cleanedStrings: AgentDocumentCleanedStrings },
  options: AgentDocumentRenderOptions,
): AgentDocumentRender {
  const maxChars = normaliseMaxSerializedChars(options.maxSerializedChars)
  const requestedPart = normalisePart(options.part)
  const totalChars = payload.html.length + payload.css.length
  const chunks = buildDocumentChunks(payload, maxChars, totalChars)
  const totalParts = chunks.length
  const part = Math.min(requestedPart, totalParts)
  const chunk = chunks[part - 1]!
  return buildAgentDocumentPart(payload, chunk, {
    part,
    totalParts,
    nextPart: part < totalParts ? part + 1 : null,
    maxChars,
    totalChars,
  })
}

function normalisePart(part: number | undefined): number {
  return typeof part === 'number' && Number.isInteger(part) && part > 0 ? part : 1
}

function normaliseMaxSerializedChars(maxChars: number | undefined): number {
  if (typeof maxChars !== 'number' || !Number.isInteger(maxChars) || maxChars <= 0) {
    return DEFAULT_READ_DOCUMENT_MAX_SERIALIZED_CHARS
  }
  return Math.max(maxChars, MIN_READ_DOCUMENT_MAX_SERIALIZED_CHARS)
}

interface AgentDocumentChunk {
  start: number
  end: number
}

function buildDocumentChunks(
  payload: { html: string; css: string; cleanedStrings: AgentDocumentCleanedStrings },
  maxChars: number,
  totalChars: number,
): AgentDocumentChunk[] {
  if (totalChars === 0) return [{ start: 0, end: 0 }]

  const chunks: AgentDocumentChunk[] = []
  let start = 0
  while (start < totalChars) {
    let low = 1
    let high = totalChars - start
    let best = 0

    while (low <= high) {
      const size = Math.floor((low + high) / 2)
      const candidate = buildAgentDocumentPart(payload, { start, end: start + size }, {
        part: PLACEHOLDER_TOTAL_PARTS,
        totalParts: PLACEHOLDER_TOTAL_PARTS,
        nextPart: PLACEHOLDER_TOTAL_PARTS,
        maxChars,
        totalChars,
      })
      if (candidate.pageInfo.serializedChars <= maxChars) {
        best = size
        low = size + 1
      } else {
        high = size - 1
      }
    }

    if (best === 0) {
      throw new Error('read_document budget is too small to return paging metadata.')
    }

    chunks.push({ start, end: start + best })
    start += best
  }
  return chunks
}

function buildAgentDocumentPart(
  payload: { html: string; css: string; cleanedStrings: AgentDocumentCleanedStrings },
  chunk: AgentDocumentChunk,
  info: {
    part: number
    totalParts: number
    nextPart: number | null
    maxChars: number
    totalChars: number
  },
): AgentDocumentRender {
  const { html, css, ranges } = sliceAgentDocumentPayload(payload.html, payload.css, chunk)
  const result: AgentDocumentRender = {
    html,
    css,
    pageInfo: {
      part: info.part,
      totalParts: info.totalParts,
      nextPart: info.nextPart,
      maxChars: info.maxChars,
      totalChars: info.totalChars,
      returnedChars: html.length + css.length,
      serializedChars: 0,
      ranges,
      cleanedStrings: { ...payload.cleanedStrings },
      note: READ_DOCUMENT_PAGING_NOTE,
    },
  }
  updateSerializedLength(result)
  return result
}

function updateSerializedLength(result: AgentDocumentRender): void {
  for (;;) {
    const next = JSON.stringify(result).length
    if (next === result.pageInfo.serializedChars) return
    result.pageInfo.serializedChars = next
  }
}

function sliceAgentDocumentPayload(
  html: string,
  css: string,
  chunk: AgentDocumentChunk,
): { html: string; css: string; ranges: AgentDocumentRange[] } {
  const ranges: AgentDocumentRange[] = []
  let htmlSlice = ''
  let cssSlice = ''

  const htmlEnd = Math.min(chunk.end, html.length)
  if (chunk.start < html.length && htmlEnd > chunk.start) {
    htmlSlice = html.slice(chunk.start, htmlEnd)
    ranges.push({ field: 'html', start: chunk.start, end: htmlEnd, totalChars: html.length })
  }

  const cssStart = Math.max(0, chunk.start - html.length)
  const cssEnd = Math.min(css.length, chunk.end - html.length)
  if (cssEnd > cssStart) {
    cssSlice = css.slice(cssStart, cssEnd)
    ranges.push({ field: 'css', start: cssStart, end: cssEnd, totalChars: css.length })
  }

  return { html: htmlSlice, css: cssSlice, ranges }
}

const BASE64_DATA_URL_RE =
  /\bdata:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+(?:;[a-zA-Z0-9.+-]+=[^,;\s"'()<>]+)*);base64,([a-zA-Z0-9+/=_-]+)/g
const DATA_URL_RE = /\bdata:[^\s"'()<>]+/g
const LONG_URL_RE = /\b(?:https?:\/\/|\/(?:uploads|media)\/)[^\s"'<>),]+/g

function cleanAgentReadSurface(value: string, counts: AgentDocumentCleanedStrings): string {
  return value
    .replace(BASE64_DATA_URL_RE, (match, mime: string, payload: string) => {
      if (payload.length <= BASE64_DATA_URL_MAX_PAYLOAD_CHARS) return match
      counts.base64DataUrls += 1
      return `data:${mime};base64,[omitted ${payload.length} chars]`
    })
    .replace(DATA_URL_RE, (match) => truncateLongUrl(match, counts))
    .replace(LONG_URL_RE, (match) => truncateLongUrl(match, counts))
}

function truncateLongUrl(value: string, counts: AgentDocumentCleanedStrings): string {
  if (value.length <= LONG_URL_MAX_CHARS) return value
  counts.longUrls += 1
  const omittedChars = value.length - LONG_URL_PREFIX_CHARS - LONG_URL_SUFFIX_CHARS
  return `${value.slice(0, LONG_URL_PREFIX_CHARS)}...[truncated ${omittedChars} chars]...${value.slice(-LONG_URL_SUFFIX_CHARS)}`
}

function collectPageModuleCss(page: Page, site: SiteDocument, registry: IModuleRegistry): string {
  const acc = {
    cssMap: new Map<string, string>(),
    jsMap: new Map<string, string>(),
    infiniteLoopIds: new Set<string>(),
    holeNodeIds: new Set<string>(),
    cspSources: new Map<string, Set<string>>(),
  }
  renderNode(page.rootNodeId, { page, site, registry, breakpointId: undefined }, acc)
  return Array.from(acc.cssMap.values()).join('\n')
}

function collectAgentDocumentClassCss(page: Page, site: SiteDocument): string {
  if (!site.styleRules) return ''

  const usedClassIds = collectActivePageClassIds(page, site)
  const usedClassNames = new Set<string>()
  const rules: Record<string, StyleRule> = {}

  for (const id of usedClassIds) {
    const rule = site.styleRules[id]
    if (!rule || isGeneratedClass(rule) || rule.kind !== 'class') continue
    rules[id] = rule
    usedClassNames.add(rule.name)
  }

  for (const rule of Object.values(site.styleRules)) {
    if (rule.kind !== 'ambient' || isGeneratedClass(rule)) continue
    if (ambientRuleCanAffectPage(rule, usedClassNames)) rules[rule.id] = rule
  }

  return sanitizeModuleCSS(generateClassCSS(rules, site.breakpoints, site.conditions ?? []))
}

function collectActivePageClassIds(page: Page, site: SiteDocument): Set<string> {
  const ids = new Set<string>()
  for (const node of Object.values(page.nodes)) {
    for (const id of node.classIds ?? []) ids.add(id)
  }

  for (const vc of site.visualComponents ?? []) {
    for (const id of vc.classIds ?? []) ids.add(id)
    for (const node of Object.values(vc.tree.nodes)) {
      for (const id of node.classIds ?? []) ids.add(id)
    }
  }
  return ids
}

function ambientRuleCanAffectPage(rule: StyleRule, usedClassNames: Set<string>): boolean {
  if (rule.rawCss) return true
  const selectorClasses = selectorClassTokens(rule.selector)
  if (selectorClasses.length === 0) return true
  return selectorClasses.every((name) => usedClassNames.has(name))
}

const CLASS_SELECTOR_RE = /\.((?:\\.|[-_a-zA-Z0-9])+)/g

function selectorClassTokens(selector: string): string[] {
  const tokens: string[] = []
  for (const match of selector.matchAll(CLASS_SELECTOR_RE)) {
    tokens.push(match[1]!.replace(/\\([^\s])/g, '$1'))
  }
  return tokens
}
