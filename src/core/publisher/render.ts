/**
 * Publisher — Recursive Renderer
 *
 * Converts a Page (flat-map PageNode tree) into a clean, standalone HTML document.
 * All string props are HTML-escaped before being passed to module render() functions.
 * CSS is deduplicated by moduleId — 50 heading nodes share one CSS entry.
 *
 * Constraint #211: escapeProps() must be called on every node before render().
 * Constraint #179: module render() is a pure function — no DOM, no React, no side effects.
 * Decision #308: CSS dedup keyed by moduleId reduces published CSS by ~60–80% on typical pages.
 */

import type { Page, PageNode, SiteDocument } from '../page-tree/types'
import type { IModuleRegistry } from '../module-engine/types'
import { resolveProps } from '../page-tree/selectors'
import { resolveDynamicProps, type TemplateRenderDataContext } from '../templates/dynamicBindings'
import { classNamesForClassIds } from '../page-tree/classNames'
import { sanitizeModuleCSS, collectClassCSS } from './cssCollector'
import { escapeHtml, isSafeUrl } from './utils'

// Re-export canonical utilities so existing imports from this file keep working
// (render.test.ts imports escapeHtml / isSafeUrl from here)
export { escapeHtml, isSafeUrl } from './utils'

// ---------------------------------------------------------------------------
// Security — prop escaping (Constraint #211)
// ---------------------------------------------------------------------------

/**
 * URL-related prop key suffixes and exact keys.
 * These receive URL validation rather than HTML escaping.
 */
const URL_PROP_KEYS = new Set(['href', 'src', 'action', 'url'])
const URL_PROP_SUFFIXES = ['url', 'href', 'src']

/**
 * Richtext/HTML prop keys — passed through unescaped.
 * MUST have been sanitized (e.g. DOMPurify) at input time.
 */
const RICHTEXT_PROP_KEYS = new Set(['richtext', 'html'])
const RICHTEXT_PROP_SUFFIXES = ['html', 'richtext']

function isUrlKey(key: string): boolean {
  const k = key.toLowerCase()
  if (URL_PROP_KEYS.has(k)) return true
  return URL_PROP_SUFFIXES.some((s) => k.endsWith(s))
}

function isRichtextKey(key: string): boolean {
  const k = key.toLowerCase()
  if (RICHTEXT_PROP_KEYS.has(k)) return true
  return RICHTEXT_PROP_SUFFIXES.some((s) => k.endsWith(s))
}

/**
 * Escape all string props before passing them to a module's render() function.
 *
 * Rules:
 * - String props: HTML-escaped via escapeHtml()
 * - URL props (href/src/action/url suffixes): validated with isSafeUrl(), replaced with '#' if unsafe
 * - Richtext/HTML props: passed through as-is (must be sanitised at input time)
 * - Non-string props: unchanged
 */
export function escapeProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const escaped: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== 'string') {
      escaped[key] = value
      continue
    }

    if (isRichtextKey(key)) {
      // Richtext: pass through (DOMPurify must sanitize at edit time)
      escaped[key] = value
    } else if (isUrlKey(key)) {
      // URLs: block javascript: and vbscript: schemes; pass safe URLs through raw
      // so that module render() functions can HTML-escape them via safeUrl() from
      // modules/base/utils/escape.ts.  Publisher HTML-escaping plain strings is the
      // escapeProps() contract for non-URL string props; URL props deliberately skip
      // the escapeHtml() step here to avoid double-escaping when modules call safeUrl()
      // (which also applies escapeHtml internally).
      // Note: publishPage() manually escapeHtml()'s faviconUrl/fontImportUrl because
      // those are not passed to module render() — they go directly into HTML template
      // strings that never pass through a module's safeUrl() call.
      escaped[key] = isSafeUrl(value) ? value : '#'
    } else {
      // Plain strings: HTML-escape
      escaped[key] = escapeHtml(value)
    }
  }

  return escaped
}

// ---------------------------------------------------------------------------
// Class injection helper (Task #401 Bug 3)
// ---------------------------------------------------------------------------

/**
 * Inject a class attribute into the root element of an HTML string.
 *
 * Handles two cases:
 * 1. Element already has a class attribute → prepend the new classes.
 *    `<div class="existing">` → `<div class="class_name existing">`
 * 2. Element has no class attribute → inject one after the tag name.
 *    `<button type="button">` → `<button class="class_name" type="button">`
 *
 * The classAttr string is pre-validated by the caller (class tokens, HTML-escaped).
 * The function only touches the first opening tag so it does not modify nested elements.
 */
function injectClassIntoRootElement(html: string, classAttr: string): string {
  // Case 1: existing class=" attribute — prepend to it
  const withExisting = html.replace(/(<[\w-]+\b[^>]*?)(\bclass=")/, `$1$2${classAttr} `)
  if (withExisting !== html) return withExisting
  // Case 2: no existing class — insert after the first tag name
  return html.replace(/(<[\w-]+)(\s|>)/, `$1 class="${classAttr}"$2`)
}

// ---------------------------------------------------------------------------
// Recursive renderer
// ---------------------------------------------------------------------------

export interface RenderContext {
  page: Page
  site: SiteDocument
  registry: IModuleRegistry
  breakpointId: string | undefined
  templateContext?: TemplateRenderDataContext
  /**
   * CSS deduplication map: moduleId → CSS string.
   * Each module type contributes at most one CSS entry regardless of instance count.
   * Decision #308: keying by moduleId is O(1); at 200 nodes saves ~60–80% CSS vs naive concat.
   */
  cssMap: Map<string, string>
}

/**
 * Render a single node and its entire subtree recursively (bottom-up).
 *
 * Children are rendered first; their HTML strings are passed as `renderedChildren`
 * to the parent node's render() call — exactly the contract in ModuleDefinition.
 *
 * @returns HTML string for this node and all its descendants
 */
export function renderNode(nodeId: string, ctx: RenderContext): string {
  const node: PageNode | undefined = ctx.page.nodes[nodeId]
  if (!node) return ''

  const def = ctx.registry.get(node.moduleId)
  if (!def) {
    // Unknown module — emit a comment so the page doesn't silently lose content
    return `<!-- pb: unknown module "${escapeHtml(node.moduleId)}" -->`
  }

  // 1. Render children first (bottom-up) — pass their HTML to the parent
  const renderedChildren = (node.children ?? []).map((childId) =>
    renderNode(childId, ctx),
  )

  // 2. Resolve effective props (base + breakpoint shallow-merge)
  const effectiveProps = resolveProps(node, ctx.breakpointId)
  const resolvedProps = resolveDynamicProps(effectiveProps, node.dynamicBindings, ctx.templateContext)

  // 3. Escape all string props (Constraint #211) before calling render()
  const safeProps = escapeProps(resolvedProps)

  // 4. Call the pure render() function
  const output = def.render(safeProps as never, renderedChildren)

  // 5. Collect CSS — one entry per moduleId (dedup).
  //    Sanitize before storage: strip </style> to prevent style-block escape (Constraint #228).
  if (output.css && !ctx.cssMap.has(node.moduleId)) {
    ctx.cssMap.set(node.moduleId, sanitizeModuleCSS(output.css))
  }

  // 6. Inject user-facing class names into the root HTML element.
  let html = output.html
  if (node.classIds?.length) {
    const classAttr = classNamesForClassIds(ctx.site.classes, node.classIds)
      .map(escapeHtml)
      .join(' ')
    if (classAttr) html = injectClassIntoRootElement(html, classAttr)
  }

  return html
}

// ---------------------------------------------------------------------------
// Page publisher
// ---------------------------------------------------------------------------

interface PublishedPage {
  /** Filename for this page in the ZIP archive, e.g. "index.html", "about-us.html" */
  filename: string
  /** Complete <!DOCTYPE html> document — no editor dependencies */
  html: string
}

/**
 * Sanitize a CSS property value for safe injection inside a `<style>` block.
 *
 * Strips `</style>` sequences to prevent breaking out of the style context
 * (same protection as sanitizeModuleCSS — applied to design-token values,
 * which are user-controlled site settings).  Also strips `{` and `}` to
 * prevent escaping the `:root {}` rule block (CSS injection, CWE-94).
 */
function sanitizeCssTokenValue(value: string): string {
  return value
    .replace(/<\/style\s*>/gi, '')
    .replace(/[{}]/g, '')
}

/**
 * Valid CSS custom property name: `--` followed by one or more alphanumeric,
 * hyphen, or underscore characters.  Rejects keys containing `;`, `{`, `}`,
 * spaces, etc. that could escape the :root {} rule block (CWE-94 / CSS injection).
 * The built-in tokens (--type-base-size, --type-ratio) satisfy this pattern.
 * User-supplied colorToken keys that fail the check are silently dropped —
 * they are invalid CSS identifiers and cannot be safely emitted.
 */
const CSS_CUSTOM_PROP_RE = /^--[a-zA-Z0-9_-]+$/

/**
 * Generate the CSS :root block for site design tokens.
 * Injects color tokens and typography scale as CSS custom properties.
 * Token values are sanitized to prevent CSS injection (Constraint #228 / CWE-94).
 * Token keys are validated against CSS_CUSTOM_PROP_RE to prevent key-side injection.
 */
function buildRootCss(site: SiteDocument): string {
  const { colorTokens, typeScale } = site.settings
  const tokens = {
    ...colorTokens,
    '--type-base-size': `${typeScale.baseSize}px`,
    '--type-ratio': String(typeScale.ratio),
  }
  const declarations = Object.entries(tokens)
    .filter(([k]) => CSS_CUSTOM_PROP_RE.test(k))
    .map(([k, v]) => `  ${k}: ${sanitizeCssTokenValue(v)};`)
    .join('\n')
  return `:root {\n${declarations}\n}`
}

/**
 * Convert a page title/slug to a safe HTML filename.
 * "About Us" → "about-us.html", "index" → "index.html"
 */
function slugToFilename(slug: string, title: string): string {
  const base = (slug || title || 'page')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return base === '' || base === 'index' ? 'index.html' : `${base}.html`
}

/**
 * Publish a single page to a standalone HTML document.
 *
 * - Walks the node tree bottom-up, collecting HTML and CSS.
 * - Deduplicates CSS across all nodes (one entry per moduleId).
 * - Injects site design tokens as CSS :root custom properties.
 * - Embeds the deduplicated CSS in a single <style> block — no external stylesheets.
 * - No editor code, no React, no framework runtime in the output.
 *
 * @param page         The page to publish
 * @param site      The site (used for settings, title, tokens)
 * @param registry     The module registry
 * @param breakpointId Optional breakpoint to publish at (uses breakpoint prop overrides)
 */
export function publishPage(
  page: Page,
  site: SiteDocument,
  registry: IModuleRegistry,
  breakpointId?: string,
  templateContext?: TemplateRenderDataContext,
): PublishedPage {
  const cssMap = new Map<string, string>()
  const ctx: RenderContext = { page, site, registry, breakpointId, templateContext, cssMap }

  // Render entire tree from root
  const bodyHtml = renderNode(page.rootNodeId, ctx)

  // Assemble deduplicated CSS: design tokens, module CSS, then class CSS (Phase C)
  const rootCss = buildRootCss(site)
  const moduleCss = Array.from(cssMap.values()).join('\n')
  const classCss = collectClassCSS(site)
  const allCss = [rootCss, moduleCss, classCss].filter(Boolean).join('\n')

  const { settings } = site
  const pageTitle = escapeHtml(settings.metaTitle ?? page.title ?? site.name)
  const metaDesc = settings.metaDescription
    ? `\n  <meta name="description" content="${escapeHtml(settings.metaDescription)}">`
    : ''
  // URL-validate icon and font URLs — isSafeUrl() blocks javascript:/vbscript: schemes.
  // escapeHtml() then makes the validated URL safe for HTML attribute injection.
  const favicon =
    settings.faviconUrl && isSafeUrl(settings.faviconUrl)
      ? `\n  <link rel="icon" href="${escapeHtml(settings.faviconUrl)}">`
      : ''
  const fontImport =
    settings.fontImportUrl && isSafeUrl(settings.fontImportUrl)
      ? `\n  <link rel="stylesheet" href="${escapeHtml(settings.fontImportUrl)}">`
      : ''

  // Constraint #227: every published page must carry a Content-Security-Policy meta tag.
  // script-src 'none' eliminates inline/external script execution in the published output.
  const csp =
    `\n  <meta http-equiv="Content-Security-Policy"` +
    ` content="default-src 'self'; script-src 'none';` +
    ` style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-src 'none';">`

  // WCAG 2.1 AA SC 3.1.1: lang attribute must reflect the site's declared language.
  // Escape the tag value — even a BCP-47 tag is user-controlled and must be safe for HTML output.
  const langAttr = escapeHtml(settings.language ?? 'en')

  const html =
    `<!DOCTYPE html>\n` +
    `<html lang="${langAttr}">\n` +
    `<head>\n` +
    `  <meta charset="UTF-8">\n` +
    `  <meta name="viewport" content="width=device-width, initial-scale=1.0">${csp}\n` +
    `  <title>${pageTitle}</title>${metaDesc}${favicon}${fontImport}\n` +
    `  <style>\n${allCss}\n  </style>\n` +
    `</head>\n` +
    `<body>\n` +
    `${bodyHtml}\n` +
    `</body>\n` +
    `</html>`

  return {
    filename: slugToFilename(page.slug, page.title),
    html,
  }
}
