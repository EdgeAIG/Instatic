import { bagToCSS, conditionPrelude } from '@core/publisher/classCss'
import { PUBLISHER_RESET_CSS } from '@core/publisher/reset'
import { generateFrameworkRootCss } from '@core/framework/generate'
import { generateFontsCss } from '@core/fonts/css'
import { styleRuleSelector } from '@core/page-tree/classNames'
import type { StyleRule, Condition, ConditionDef } from '@core/page-tree'
import type { SiteFontsSettings } from '@core/fonts/schemas'
import type {
  FrameworkColorSettings,
  FrameworkPreferencesSettings,
  FrameworkSpacingSettings,
  FrameworkTypographySettings,
} from '@core/framework/schemas'

export function generateCanvasClassCSS(
  classes: Record<string, StyleRule>,
  breakpoints: Array<{ id: string; width: number }>,
  conditions: ReadonlyArray<ConditionDef> = [],
  frameworkColors?: FrameworkColorSettings | null,
  frameworkTypography?: FrameworkTypographySettings | null,
  frameworkSpacing?: FrameworkSpacingSettings | null,
  frameworkPreferences?: FrameworkPreferencesSettings | null,
  fonts?: SiteFontsSettings | null,
): string {
  const blocks: string[] = []

  // Publisher reset, identical to what `publishPage()` ships. Each canvas
  // breakpoint frame is its own iframe with its own `<body>`, so we use the
  // unscoped reset (low-specificity `:where(body) { ... }` rules) rather
  // than the legacy `[data-breakpoint-id]`-scoped variant. The unscoped reset
  // matches the published cascade exactly — user CSS like
  // `body { color: var(--color-fg) }` wins over the reset's `:where(body)`
  // baseline, the way it does on the live site. Editor chrome lives outside
  // the iframe so the reset can't leak into the toolbars / panels.
  blocks.push(PUBLISHER_RESET_CSS)

  // Fonts go first (after the reset) so `@font-face` declarations exist before
  // any rule that references the family — browsers tolerate the reverse order,
  // but the ordering keeps generated CSS easier to inspect.
  const fontsCss = generateFontsCss(fonts)
  if (fontsCss) blocks.push(fontsCss)
  const frameworkCss = generateFrameworkRootCss({
    colors: frameworkColors,
    typography: frameworkTypography,
    spacing: frameworkSpacing,
    preferences: frameworkPreferences,
  })
  if (frameworkCss) blocks.push(frameworkCss)

  // Cascade order matches the publisher: rules sorted by `order` ascending so
  // a later, more-specific override appears later in source and wins on equal
  // specificity. See generateClassCSS for the matching publisher invariant.
  const orderedClasses = Object.values(classes).slice().sort((a, b) => {
    const ao = typeof a.order === 'number' ? a.order : 0
    const bo = typeof b.order === 'number' ? b.order : 0
    return ao - bo
  })

  const breakpointIds = new Set(breakpoints.map((bp) => bp.id))
  // Condition id → (condition, registry index) for stable ordering.
  const conditionById = new Map<string, { condition: Condition; index: number }>(
    conditions.map((c, index) => [c.id, { condition: c.condition, index }]),
  )

  for (const cls of orderedClasses) {
    const baseDecls = bagToCSS(cls.styles)
    if (baseDecls) {
      blocks.push(`${styleRuleSelector(cls)} {\n${baseDecls}\n}`)
    }

    // Unified contextStyles: a key is either a width breakpoint (simulated via
    // the [data-breakpoint-id] frame attribute) or a custom condition (emitted
    // as a REAL @-rule wrapper, evaluated by the canvas frame's own engine
    // against its actual viewport / container / support so the canvas matches
    // published output). Keys matching neither registry are skipped.
    const conditionEntries: Array<{ bag: Record<string, unknown>; condition: Condition; index: number }> = []
    for (const [contextId, bag] of Object.entries(cls.contextStyles ?? {})) {
      const cond = conditionById.get(contextId)
      if (cond) {
        conditionEntries.push({ bag, condition: cond.condition, index: cond.index })
        continue
      }
      if (!breakpointIds.has(contextId)) continue
      const decls = bagToCSS(bag)
      if (!decls) continue
      blocks.push(`[data-breakpoint-id="${escapeCssAttribute(contextId)}"] ${styleRuleSelector(cls)} {\n${decls}\n}`)
    }

    conditionEntries.sort((a, b) => a.index - b.index)
    for (const { bag, condition } of conditionEntries) {
      const decls = bagToCSS(bag)
      if (!decls) continue
      const prelude = conditionPrelude(condition)
      if (!prelude) continue
      blocks.push(`${prelude} {\n  ${styleRuleSelector(cls)} {\n${decls}\n  }\n}`)
    }
  }

  return blocks.join('\n\n')
}

/**
 * Generate a higher-specificity preview rule for a single class, used by
 * the canvas style injector while a user is hovering a suggestion. The
 * doubled class selector (`.foo.foo`) wins over any base / breakpoint
 * rule emitted by `generateCanvasClassCSS`, without committing the
 * change to the document or pushing a history entry.
 */
export function generatePreviewClassCSS(
  cls: StyleRule,
  preview: { breakpointId?: string | null; styles: Record<string, unknown> },
): string {
  const decls = bagToCSS(preview.styles)
  if (!decls) return ''
  const selector = styleRuleSelector(cls)
  const doubled = `${selector}${selector}`
  if (!preview.breakpointId) {
    return `${doubled} {\n${decls}\n}`
  }
  return `[data-breakpoint-id="${escapeCssAttribute(preview.breakpointId)}"] ${doubled} {\n${decls}\n}`
}

function escapeCssAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
