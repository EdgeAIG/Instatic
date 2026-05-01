/**
 * Canonical HTML-escape, URL-validation, and CSS-sanitisation utilities.
 *
 * This is the single source of truth for all escaping/sanitisation in the
 * publisher pipeline. Both the publisher (render.ts), base modules
 * (modules/base/utils/escape.ts), and editor components
 * (ClassStyleInjector.tsx) import from here — no duplicate implementations.
 *
 * Constraint #211 contract:
 *   - escapeHtml() is called by the publisher via escapeProps() BEFORE render().
 *   - Module render() functions receive pre-escaped string props and MUST NOT
 *     call escapeHtml() on those props again (that causes double-escaping: CWE-116).
 *   - URL props (href/src/etc.) are an exception: the publisher validates safety via
 *     isSafeUrl() but does NOT HTML-escape them. Module render() functions must
 *     call safeUrl() on URL props (validation + HTML-escape in one step).
 *   - Values a module constructs INTERNALLY (not from props) may still call escapeHtml().
 *
 * Constraint #228 contract:
 *   - sanitiseCssValue() is the canonical CSS value sanitiser. Both ClassStyleInjector
 *     (editor live preview) and buildStyle() (module CSS) must use this function — no
 *     per-file reimplementations (same pattern that fixed CWE-116 for HTML escaping).
 */

// ---------------------------------------------------------------------------
// HTML escaping
// ---------------------------------------------------------------------------

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
}

/**
 * HTML-escape the 5 characters that are dangerous in HTML text / attribute contexts.
 * Accepts `unknown` — non-strings are stringified first (graceful handling of
 * number props passed as unknown in typed module render signatures).
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch])
}

// ---------------------------------------------------------------------------
// URL validation
// ---------------------------------------------------------------------------

/**
 * Return true if a URL is safe to use in href/src/action attributes.
 * Blocks javascript:, vbscript:, and data: URL schemes.
 *
 * Normalisation: strips \t, \n, \r before scheme detection — the WHATWG URL parser
 * removes these characters too, so `java\tscript:` would be treated as `javascript:`
 * by browsers (CWE-79 bypass). We must mirror that normalisation.
 *
 * data: URIs are blocked because:
 * - `data:text/html,...` in href opens a new browsing context with arbitrary HTML/JS,
 *   bypassing the published page's CSP (which only governs the current document).
 * - `data:image/svg+xml,...` may embed JavaScript in SVG content.
 * For safe inline images, host apps should use CDN URLs or properly hosted assets.
 */
export function isSafeUrl(url: string): boolean {
  const normalized = url.replace(/[\t\n\r]/g, '').trim().toLowerCase()
  return (
    !normalized.startsWith('javascript:') &&
    !normalized.startsWith('vbscript:') &&
    !normalized.startsWith('data:')
  )
}

/**
 * Validate a URL and HTML-escape it for safe use in an HTML attribute.
 *
 * - Unsafe URLs (javascript:/vbscript:) are replaced with '#'.
 * - Safe URLs are HTML-escaped (e.g. `&` in query strings → `&amp;`).
 *
 * Accepts `unknown` for convenience in module render() signatures.
 * Use this for ALL URL props in module render() functions.
 */
export function safeUrl(value: unknown): string {
  const str = String(value ?? '')
  if (!isSafeUrl(str)) return '#'
  return escapeHtml(str)
}

// ---------------------------------------------------------------------------
// CSS value sanitisation
// ---------------------------------------------------------------------------

/**
 * Sanitise a CSS property value — block dangerous CSS injection patterns.
 *
 * This is the CANONICAL implementation. Both ClassStyleInjector.tsx (editor live
 * preview) and buildStyle() in escape.ts (module CSS) must import and call THIS
 * function. No per-file reimplementations (Constraint #228 / same pattern that
 * fixed CWE-116 for HTML escaping in Contribution #393).
 *
 * Guards against:
 * - `expression(...)` — IE CSS expression(), executes JS (CWE-79 via CSS)
 * - `javascript:` — invalid in CSS but historically exploited in some parsers
 * - `behavior:` / `-moz-binding:` — legacy IE/Gecko CSS code execution
 * - `data:text/` — data URI in CSS `url()` loads arbitrary HTML in some browsers
 * - `{` or `}` — closes/opens the surrounding class selector block,
 *               enabling injection of arbitrary CSS rules (CWE-74, Medium)
 *
 * Numbers are always safe — they are stringified and returned directly.
 * Returns the trimmed string value if safe, or `null` if the value must be dropped.
 */
export function sanitiseCssValue(value: string | number): string | null {
  if (typeof value === 'number') return String(value)
  const v = value.trim()
  if (/expression\s*\(/i.test(v)) return null
  if (/javascript\s*:/i.test(v)) return null
  if (/behavior\s*:/i.test(v)) return null
  if (/-moz-binding/i.test(v)) return null
  if (/data\s*:\s*text/i.test(v)) return null
  if (/[{}]/.test(v)) return null
  return v
}
