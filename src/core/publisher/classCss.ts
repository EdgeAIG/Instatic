import type { CSSClass, CSSPropertyBag } from '../page-tree/types'
import { cssClassSelector } from '../page-tree/classNames'
import { sanitiseCssValue } from './utils'

/**
 * Convert a camelCase CSS property name to kebab-case.
 * "backgroundColor" -> "background-color", "zIndex" -> "z-index"
 */
function toKebab(camel: string): string {
  return camel.replace(/([A-Z])/g, (_, c: string) => `-${c.toLowerCase()}`)
}

/** Allowlist of CSS property names from CSSPropertyBag. */
const ALLOWED_PROPS = new Set<string>([
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing',
  'lineHeight', 'textAlign', 'textDecoration', 'textTransform', 'color', 'textShadow',
  'display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent',
  'justifyItems', 'alignSelf', 'justifySelf', 'flex', 'gap', 'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow',
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'aspectRatio', 'boxSizing',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  'backgroundColor', 'background', 'backgroundImage', 'backgroundSize',
  'backgroundPosition', 'backgroundRepeat', 'objectFit', 'objectPosition',
  'opacity', 'overflow', 'overflowX', 'overflowY',
  'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius',
  'outline', 'outlineOffset',
  'boxShadow', 'filter', 'backdropFilter', 'transform', 'transformOrigin',
  'transition', 'animation',
  'cursor', 'pointerEvents', 'userSelect', 'scrollBehavior',
])

/**
 * Serialise a CSSPropertyBag to a CSS declaration block string.
 * Only emits properties in the allowlist with sanitised values.
 */
export function bagToCSS(bag: Partial<CSSPropertyBag>): string {
  const lines: string[] = []
  for (const [prop, value] of Object.entries(bag)) {
    if (!ALLOWED_PROPS.has(prop)) continue
    if (value === undefined || value === null || value === '') continue
    const sanitised = sanitiseCssValue(value as string | number)
    if (sanitised === null) continue
    lines.push(`  ${toKebab(prop)}: ${sanitised};`)
  }
  return lines.join('\n')
}

/**
 * Generate the full CSS string for all classes in the registry.
 * Includes base styles and @media blocks for breakpoint overrides.
 */
export function generateClassCSS(
  classes: Record<string, CSSClass>,
  breakpoints: Array<{ id: string; width: number }>,
): string {
  const blocks: string[] = []

  for (const cls of Object.values(classes)) {
    const baseDecls = bagToCSS(cls.styles)
    if (baseDecls) {
      blocks.push(`${cssClassSelector(cls)} {\n${baseDecls}\n}`)
    }

    for (const [bpId, bpStyles] of Object.entries(cls.breakpointStyles)) {
      const decls = bagToCSS(bpStyles)
      if (!decls) continue
      const bp = breakpoints.find((b) => b.id === bpId)
      if (!bp) continue
      blocks.push(`@media (max-width: ${bp.width}px) {\n  ${cssClassSelector(cls)} {\n${decls}\n  }\n}`)
    }
  }

  return blocks.join('\n\n')
}
