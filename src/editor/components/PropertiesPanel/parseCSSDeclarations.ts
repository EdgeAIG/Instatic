/**
 * parseCSSDeclarations — parse raw CSS declaration block into a CSSPropertyBag patch.
 *
 * Used by ClassComposer's writable "Edit CSS" textarea (§3.1 of Spec #659).
 * Accepts a CSS declarations string (no selector / no braces — just the body).
 * Unknown CSS properties are silently dropped (safe — only known CSSPropertyBag
 * keys make it into the store).
 *
 * Security: property names are validated against KNOWN_PROPERTIES whitelist before
 * any store write. Values are treated as opaque strings; the CSS canvas renderer
 * enforces sanitisation at render time (Constraint #329).
 */

import type { CSSPropertyBag } from '../../../core/page-tree/types'

/**
 * Camelcase CSS property names recognised by CSSPropertyBag.
 *
 * MUST remain a 1-to-1 superset of keyof CSSPropertyBag — HF-4 gate in
 * propertiesPanel-redesign.test.tsx enforces this invariant statically.
 * If you add a new field to CSSPropertyBag, add it here too.
 */
const KNOWN_PROPERTIES = new Set<keyof CSSPropertyBag>([
  // Layout
  'display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent',
  'justifyItems', 'alignSelf', 'justifySelf', 'flex', 'gap', 'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow',
  // Size
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'aspectRatio', 'boxSizing',
  // Spacing
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  // Position
  'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  // Typography
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textAlign', 'textDecoration', 'textTransform',
  'color', 'textShadow',
  // Visual
  'backgroundColor', 'background', 'backgroundImage', 'backgroundSize',
  'backgroundPosition', 'backgroundRepeat', 'objectFit', 'objectPosition',
  'opacity',
  'overflow', 'overflowX', 'overflowY',
  // Border
  'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius', 'outline', 'outlineOffset',
  // Effects
  'boxShadow', 'filter', 'backdropFilter', 'transform', 'transformOrigin',
  // Motion
  'transition', 'animation',
  // Interaction
  'cursor', 'pointerEvents', 'userSelect',
  // Scrollbar
  'scrollBehavior',
])

/** Convert a kebab-case CSS property name to camelCase. */
function cssPropertyToCamel(prop: string): string {
  return prop.trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * Parse a CSS declarations block (without selector / braces) into a CSSPropertyBag patch.
 *
 * - Unknown properties are silently ignored.
 * - Empty or entirely-unparseable input returns null (caller skips the store write).
 *
 * @example
 *   parseCSSDeclarations('font-size: 24px; color: red;')
 *   // → { fontSize: '24px', color: 'red' }
 *
 *   parseCSSDeclarations('/* comment *\/')
 *   // → null  (nothing parseable)
 */
export function parseCSSDeclarations(css: string): Partial<CSSPropertyBag> | null {
  const result: Partial<CSSPropertyBag> = {}
  let parsed = 0

  for (const decl of css.split(';')) {
    const colonIdx = decl.indexOf(':')
    if (colonIdx === -1) continue
    const rawKey = decl.slice(0, colonIdx).trim()
    const rawVal = decl.slice(colonIdx + 1).trim()
    if (!rawKey || !rawVal) continue

    const camelKey = cssPropertyToCamel(rawKey) as keyof CSSPropertyBag
    if (KNOWN_PROPERTIES.has(camelKey)) {
      // Cast is safe: all KNOWN_PROPERTIES values are string-typed in CSSPropertyBag
      ;(result as Record<string, string>)[camelKey] = rawVal
      parsed++
    }
  }

  return parsed > 0 ? result : null
}
