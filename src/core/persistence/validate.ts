/**
 * validateSite — structural validation of raw data before store hydration.
 *
 * Constraint #230: ALL site data loaded from storage MUST be validated
 * before being passed to `store.loadSite()`. This prevents corrupted or
 * stale schema data from silently poisoning the store.
 *
 * The validator is intentionally STRICT on structure and LENIENT on values:
 * - It rejects data that would crash the editor (missing required fields,
 *   wrong types for fields the code unconditionally reads).
 * - It does NOT reject unknown extra keys — forward-compat with future schema.
 * - It does NOT validate prop VALUES against module schemas — that would
 *   require the registry at validation time, creating a circular dependency.
 *
 * Throws a descriptive SiteValidationError with a `path` field for debugging.
 */

import type {
  SiteDocument,
  Page,
  PageNode,
  Breakpoint,
  SiteSettings,
  PageTemplateConfig,
  DynamicPropBinding,
  DynamicBindingFormat,
  TemplateCondition,
} from '../page-tree/types'
import type { SiteFile, SiteFileType } from '../files/types'
import type { VisualComponent, VCParam } from '../visualComponents/types'
import { isSafePath, normalizePath } from '../files/pathValidation'
import { validateComponentName } from '../visualComponents/nameValidation'
import { sanitizeRichtext, isRichtextPropKey } from '../sanitize'
import { normalizeSitePackageJson } from '../site-dependencies/manifest'
import { pageSlugDuplicateError, pageSlugError } from '../page-tree/slugs'

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class SiteValidationError extends Error {
  readonly path: string
  constructor(message: string, path: string) {
    super(`[persistence/validate] ${path}: ${message}`)
    this.name = 'SiteValidationError'
    this.path = path
  }
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function assertString(v: unknown, path: string): asserts v is string {
  if (typeof v !== 'string') throw new SiteValidationError(`expected string, got ${typeof v}`, path)
}

function assertNumber(v: unknown, path: string): asserts v is number {
  if (typeof v !== 'number' || !isFinite(v)) throw new SiteValidationError(`expected finite number, got ${typeof v}`, path)
}

function assertObject(v: unknown, path: string): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new SiteValidationError(`expected plain object, got ${Array.isArray(v) ? 'array' : typeof v}`, path)
  }
}

function assertArray(v: unknown, path: string): asserts v is unknown[] {
  if (!Array.isArray(v)) throw new SiteValidationError(`expected array, got ${typeof v}`, path)
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

const VALID_DYNAMIC_FORMATS = new Set<DynamicBindingFormat>(['plain', 'html', 'url', 'media'])

function validateDynamicBindings(raw: unknown): Record<string, DynamicPropBinding> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined

  const bindings: Record<string, DynamicPropBinding> = {}
  for (const [propKey, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const binding = value as Record<string, unknown>
    if (binding.source !== 'currentEntry') continue
    if (typeof binding.field !== 'string' || binding.field.trim() === '') continue

    const next: DynamicPropBinding = {
      source: 'currentEntry',
      field: binding.field,
    }

    if (typeof binding.format === 'string' && VALID_DYNAMIC_FORMATS.has(binding.format as DynamicBindingFormat)) {
      next.format = binding.format as DynamicBindingFormat
    }

    if (binding.fallback === 'static' || binding.fallback === 'empty') {
      next.fallback = binding.fallback
    }

    bindings[propKey] = next
  }

  return Object.keys(bindings).length > 0 ? bindings : undefined
}

function validateTemplateCondition(raw: unknown): TemplateCondition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const condition = raw as Record<string, unknown>
  if (typeof condition.id !== 'string') return null
  if (typeof condition.field !== 'string') return null
  if (condition.operator !== 'equals') return null
  if (typeof condition.value !== 'string') return null

  return {
    id: condition.id,
    field: condition.field,
    operator: 'equals',
    value: condition.value,
  }
}

function validatePageTemplate(raw: unknown): PageTemplateConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const template = raw as Record<string, unknown>
  if (template.enabled !== true) return undefined
  if (template.context !== 'entry') return undefined
  if (typeof template.collectionId !== 'string' || template.collectionId.trim() === '') return undefined

  const conditions = Array.isArray(template.conditions)
    ? template.conditions
        .map((condition) => validateTemplateCondition(condition))
        .filter((condition): condition is TemplateCondition => condition !== null)
    : []

  return {
    enabled: true,
    context: 'entry',
    collectionId: template.collectionId,
    priority: typeof template.priority === 'number' && isFinite(template.priority) ? template.priority : 0,
    conditions,
  }
}

function validatePageNode(raw: unknown, path: string): PageNode {
  assertObject(raw, path)
  assertString(raw.id, `${path}.id`)
  assertString(raw.moduleId, `${path}.moduleId`)
  // props must be an object (values are unchecked — module-specific)
  assertObject(raw.props ?? {}, `${path}.props`)
  // children must be an array of strings
  assertArray(raw.children ?? [], `${path}.children`)
  for (let i = 0; i < (raw.children as unknown[]).length; i++) {
    assertString((raw.children as unknown[])[i], `${path}.children[${i}]`)
  }
  // breakpointOverrides must be an object (values unchecked)
  assertObject(raw.breakpointOverrides ?? {}, `${path}.breakpointOverrides`)

  // Sanitize richtext-typed prop values before storing — prevents XSS via
  // tampered or pre-DOMPurify-boundary site data reaching the publisher.
  // Non-richtext props are passed through unchanged. Constraint #299 / Task #302.
  const rawProps = (raw.props ?? {}) as Record<string, unknown>
  const sanitizedProps: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(rawProps)) {
    if (isRichtextPropKey(key) && typeof val === 'string') {
      sanitizedProps[key] = sanitizeRichtext(val)
    } else {
      sanitizedProps[key] = val
    }
  }

  // childNodes: recursively validate each child node (VC-tree only, optional).
  // Page nodes never have childNodes — this field is absent and round-trips as undefined.
  const childNodes: PageNode[] | undefined = Array.isArray(raw.childNodes)
    ? (raw.childNodes as unknown[]).map((n, i) =>
        validatePageNode(n, `${path}.childNodes[${i}]`)
      )
    : undefined

  // propBindings: lenient per-item — preserve entries with a valid { paramId: string }
  // shape; silently drop malformed bindings rather than rejecting the whole node.
  let propBindings: Record<string, { paramId: string }> | undefined
  if (raw.propBindings && typeof raw.propBindings === 'object' && !Array.isArray(raw.propBindings)) {
    propBindings = Object.fromEntries(
      Object.entries(raw.propBindings as Record<string, unknown>)
        .filter(([, v]) => v && typeof v === 'object' && typeof (v as Record<string, unknown>).paramId === 'string')
        .map(([k, v]) => [k, { paramId: (v as Record<string, unknown>).paramId as string }])
    )
  }

  const dynamicBindings = validateDynamicBindings(raw.dynamicBindings)

  return {
    id: raw.id as string,
    moduleId: raw.moduleId as string,
    props: sanitizedProps,
    children: (raw.children ?? []) as string[],
    breakpointOverrides: (raw.breakpointOverrides ?? {}) as Record<string, Partial<Record<string, unknown>>>,
    label: typeof raw.label === 'string' ? raw.label : undefined,
    locked: typeof raw.locked === 'boolean' ? raw.locked : undefined,
    hidden: typeof raw.hidden === 'boolean' ? raw.hidden : undefined,
    // classIds — optional, default [] for legacy nodes
    classIds: Array.isArray(raw.classIds)
      ? (raw.classIds as unknown[]).filter((id) => typeof id === 'string') as string[]
      : [],
    dynamicBindings,
    childNodes,
    propBindings,
  }
}

function validatePage(raw: unknown, path: string): Page {
  assertObject(raw, path)
  assertString(raw.id, `${path}.id`)
  assertString(raw.title, `${path}.title`)
  assertString(raw.slug, `${path}.slug`)
  assertString(raw.rootNodeId, `${path}.rootNodeId`)
  assertObject(raw.nodes, `${path}.nodes`)

  const nodes: Record<string, PageNode> = {}
  for (const [nodeId, nodeRaw] of Object.entries(raw.nodes as Record<string, unknown>)) {
    nodes[nodeId] = validatePageNode(nodeRaw, `${path}.nodes[${nodeId}]`)
  }

  // Referential integrity: rootNodeId must exist in nodes
  if (!nodes[raw.rootNodeId as string]) {
    throw new SiteValidationError(
      `rootNodeId "${raw.rootNodeId}" not found in nodes`,
      `${path}.rootNodeId`,
    )
  }

  return {
    id: raw.id as string,
    title: raw.title as string,
    slug: raw.slug as string,
    rootNodeId: raw.rootNodeId as string,
    nodes,
    template: validatePageTemplate(raw.template),
  }
}

function validateBreakpoint(raw: unknown, path: string): Breakpoint {
  assertObject(raw, path)
  assertString(raw.id, `${path}.id`)
  assertString(raw.label, `${path}.label`)
  assertNumber(raw.width, `${path}.width`)
  // icon is optional in practice
  return {
    id: raw.id as string,
    label: raw.label as string,
    width: raw.width as number,
    icon: typeof raw.icon === 'string' ? raw.icon : 'monitor',
  }
}

function validateSettings(raw: unknown, path: string): SiteSettings {
  assertObject(raw, path)
  return {
    metaTitle: typeof raw.metaTitle === 'string' ? raw.metaTitle : undefined,
    metaDescription: typeof raw.metaDescription === 'string' ? raw.metaDescription : undefined,
    faviconUrl: typeof raw.faviconUrl === 'string' ? raw.faviconUrl : undefined,
    fontImportUrl: typeof raw.fontImportUrl === 'string' ? raw.fontImportUrl : undefined,
    language: typeof raw.language === 'string' ? raw.language : undefined,
    colorTokens:
      raw.colorTokens && typeof raw.colorTokens === 'object' && !Array.isArray(raw.colorTokens)
        ? (raw.colorTokens as Record<string, string>)
        : {},
    typeScale:
      raw.typeScale && typeof raw.typeScale === 'object' && !Array.isArray(raw.typeScale)
        ? {
            baseSize:
              typeof (raw.typeScale as Record<string, unknown>).baseSize === 'number'
                ? (raw.typeScale as Record<string, unknown>).baseSize as number
                : 16,
            ratio:
              typeof (raw.typeScale as Record<string, unknown>).ratio === 'number'
                ? (raw.typeScale as Record<string, unknown>).ratio as number
                : 1.25,
          }
        : { baseSize: 16, ratio: 1.25 },
    shortcuts:
      raw.shortcuts && typeof raw.shortcuts === 'object' && !Array.isArray(raw.shortcuts)
        ? (raw.shortcuts as Record<string, string>)
        : {},
  }
}

const VALID_FILE_TYPES: SiteFileType[] = [
  'component', 'script', 'style', 'asset', 'config', 'doc',
]

function validateSiteFile(raw: unknown, _path: string): SiteFile | null {
  void _path
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>

  if (typeof r.id !== 'string' || typeof r.path !== 'string') return null
  if (!VALID_FILE_TYPES.includes(r.type as SiteFileType)) return null

  // Silently discard files with unsafe paths (rather than throwing — we want
  // the validator to be lenient on individual files to avoid rejecting whole
  // projects due to one bad entry).
  const normalized = normalizePath(r.path)
  if (!isSafePath(normalized)) return null

  return {
    id: r.id,
    path: normalized,
    type: r.type as SiteFileType,
    content: typeof r.content === 'string' ? r.content : undefined,
    blob:
      r.blob &&
      typeof r.blob === 'object' &&
      !Array.isArray(r.blob) &&
      typeof (r.blob as Record<string, unknown>).mimeType === 'string' &&
      typeof (r.blob as Record<string, unknown>).base64 === 'string'
        ? {
            mimeType: (r.blob as Record<string, unknown>).mimeType as string,
            base64: (r.blob as Record<string, unknown>).base64 as string,
          }
        : undefined,
    generated: typeof r.generated === 'boolean' ? r.generated : undefined,
    ejected: typeof r.ejected === 'boolean' ? r.ejected : undefined,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : Date.now(),
  }
}

// ---------------------------------------------------------------------------
// VisualComponent validator (lenient per-item, mirrors validateSiteFile)
// ---------------------------------------------------------------------------

/**
 * Validate a single raw VisualComponent from storage.
 *
 * Returns a fully-shaped VisualComponent or null (silently drop bad entries).
 * Self-healing: filePath is always re-derived from name to fix stale paths.
 *
 * Architecture source: Contribution #619 §9
 */
function validateVisualComponent(raw: unknown): VisualComponent | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>

  // Required string fields
  if (typeof r.id !== 'string' || !r.id) return null
  if (typeof r.name !== 'string' || !r.name) return null

  // Name must pass PascalCase + reserved-word checks (drop on fail)
  const nameValidation = validateComponentName(r.name, [])
  if (!nameValidation.ok) return null

  // rootNode must be a valid PageNode shape (at minimum)
  if (!r.rootNode || typeof r.rootNode !== 'object' || Array.isArray(r.rootNode)) return null
  let rootNode: PageNode
  try {
    rootNode = validatePageNode(r.rootNode, `visualComponents[${r.id}].rootNode`)
  } catch {
    return null
  }

  // params — validate each entry, skip malformed
  const params: VCParam[] = []
  if (Array.isArray(r.params)) {
    for (const p of r.params as unknown[]) {
      if (!p || typeof p !== 'object' || Array.isArray(p)) continue
      const param = p as Record<string, unknown>
      if (typeof param.id !== 'string' || typeof param.name !== 'string') continue
      const validTypes: VCParam['type'][] = ['string', 'number', 'boolean', 'url', 'enum', 'color']
      const paramType = validTypes.includes(param.type as VCParam['type'])
        ? (param.type as VCParam['type'])
        : 'string'
      params.push({
        id: param.id,
        name: param.name,
        type: paramType,
        defaultValue: param.defaultValue ?? '',
        required: typeof param.required === 'boolean' ? param.required : false,
        enumOptions: Array.isArray(param.enumOptions)
          ? (param.enumOptions as unknown[]).filter((o) => typeof o === 'string') as string[]
          : undefined,
      })
    }
  }

  // filePath: always re-derive from name (self-healing, Contribution #619 §9 VP-6)
  const filePath = `src/components/${r.name}.tsx`

  return {
    id: r.id,
    name: r.name,
    rootNode: rootNode as VisualComponent['rootNode'],
    params,
    breakpoints: Array.isArray(r.breakpoints)
      ? (r.breakpoints as unknown[])
          .filter((b) => b && typeof b === 'object' && !Array.isArray(b))
          .map((b) => {
            const bp = b as Record<string, unknown>
            return {
              id: typeof bp.id === 'string' ? bp.id : '',
              label: typeof bp.label === 'string' ? bp.label : '',
              width: typeof bp.width === 'number' ? bp.width : 0,
              icon: typeof bp.icon === 'string' ? bp.icon : 'monitor',
            }
          })
          .filter((bp) => bp.id !== '')
      : [],
    classIds: Array.isArray(r.classIds)
      ? (r.classIds as unknown[]).filter((id) => typeof id === 'string') as string[]
      : [],
    filePath,
    generated: typeof r.generated === 'boolean' ? r.generated : true,
    ejected: typeof r.ejected === 'boolean' ? r.ejected : false,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate raw data from storage and return a typed SiteDocument, or throw
 * SiteValidationError describing exactly which field failed.
 *
 * Usage:
 * ```ts
 * const raw = await adapter.loadSite(id)
 * const site = validateSite(raw)   // throws if corrupt
 * store.loadSite(site)
 * ```
 */
export function validateSite(raw: unknown): SiteDocument {
  assertObject(raw, 'site')
  assertString(raw.id, 'site.id')
  assertString(raw.name, 'site.name')
  assertArray(raw.pages, 'site.pages')
  assertArray(raw.breakpoints, 'site.breakpoints')
  assertNumber(raw.createdAt, 'site.createdAt')
  assertNumber(raw.updatedAt, 'site.updatedAt')

  const pages: Page[] = (raw.pages as unknown[]).map((p, i) =>
    validatePage(p, `site.pages[${i}]`),
  )

  const breakpoints: Breakpoint[] = (raw.breakpoints as unknown[]).map((b, i) =>
    validateBreakpoint(b, `site.breakpoints[${i}]`),
  )

  const settings = validateSettings(raw.settings ?? {}, 'site.settings')
  const packageJson = normalizeSitePackageJson(raw.packageJson)

  // Validate class registry — coerce any legacy projects that lack this field
  const rawClasses = raw.classes
  const classes: SiteDocument['classes'] = {}
  if (rawClasses !== undefined && rawClasses !== null && typeof rawClasses === 'object' && !Array.isArray(rawClasses)) {
    for (const [id, cls] of Object.entries(rawClasses as Record<string, unknown>)) {
      if (cls && typeof cls === 'object' && !Array.isArray(cls)) {
        const c = cls as Record<string, unknown>
        if (typeof c.id === 'string' && typeof c.name === 'string') {
          const scope =
            c.scope &&
            typeof c.scope === 'object' &&
            !Array.isArray(c.scope) &&
            (c.scope as Record<string, unknown>).type === 'node' &&
            typeof (c.scope as Record<string, unknown>).nodeId === 'string'
              ? {
                  type: 'node' as const,
                  nodeId: (c.scope as Record<string, unknown>).nodeId as string,
                  role: 'module-style' as const,
                }
              : undefined
          classes[id] = {
            id: c.id as string,
            name: c.name as string,
            description: typeof c.description === 'string' ? c.description : undefined,
            scope,
            styles: (c.styles && typeof c.styles === 'object' && !Array.isArray(c.styles) ? c.styles : {}) as Record<string, unknown>,
            breakpointStyles: (c.breakpointStyles && typeof c.breakpointStyles === 'object' && !Array.isArray(c.breakpointStyles) ? c.breakpointStyles : {}) as Record<string, Record<string, unknown>>,
            tags: Array.isArray(c.tags) ? (c.tags as string[]).filter((t) => typeof t === 'string') : undefined,
            createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
            updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : Date.now(),
          }
        }
      }
    }
  }

  // Must have at least one page
  if (pages.length === 0) {
    throw new SiteValidationError('site must have at least one page', 'site.pages')
  }

  for (let i = 0; i < pages.length; i++) {
    const slugError = pageSlugError(pages[i].slug)
    if (slugError) throw new SiteValidationError(slugError, `site.pages[${i}].slug`)

    const duplicateError = pageSlugDuplicateError(pages[i].slug, pages, pages[i].id)
    if (duplicateError) {
      throw new SiteValidationError(`duplicate slug: ${duplicateError}`, `site.pages[${i}].slug`)
    }
  }

  // Validate files[] — default to [] for legacy projects that pre-date the
  // files data layer (Contribution #595 / Task #429).  Individual files with
  // unsafe paths are silently dropped rather than rejecting the whole site.
  // Duplicate paths are deduplicated (last-write-wins on the normalized path).
  const rawFiles = raw.files
  const files: SiteFile[] = []
  if (Array.isArray(rawFiles)) {
    const seenPaths = new Set<string>()
    for (let i = 0; i < rawFiles.length; i++) {
      const file = validateSiteFile(rawFiles[i], `site.files[${i}]`)
      if (file === null) continue
      if (seenPaths.has(file.path)) continue // deduplicate
      seenPaths.add(file.path)
      files.push(file)
    }
  }

  // Validate visualComponents[] — default to [] for legacy projects that
  // pre-date the VC data layer (Contribution #619 / Task #436).
  // Individual VCs with invalid names are silently dropped.
  // Duplicate names are deduplicated (first-wins, per §9 spec).
  // filePath is always re-derived from name (self-healing).
  const rawVCs = raw.visualComponents
  const visualComponents: VisualComponent[] = []
  if (Array.isArray(rawVCs)) {
    const seenNames = new Set<string>()
    for (let i = 0; i < rawVCs.length; i++) {
      const vc = validateVisualComponent(rawVCs[i])
      if (vc === null) continue
      if (seenNames.has(vc.name)) continue // first-wins deduplication
      seenNames.add(vc.name)
      visualComponents.push(vc)
    }
  }

  return {
    id: raw.id as string,
    name: raw.name as string,
    pages,
    files,
    visualComponents,
    packageJson,
    breakpoints,
    settings,
    classes,
    createdAt: raw.createdAt as number,
    updatedAt: raw.updatedAt as number,
  }
}
