/**
 * StyleRule — a named CSS style rule that emits one rule into the stylesheet.
 *
 * A `StyleRule` can be any CSS rule, discriminated by `kind`:
 *
 *   - `kind: 'class'` — the rule's selector is `.<name>`. It is attached to
 *     nodes via `node.classIds`; the publisher emits the name into the node's
 *     class attribute and the rule into the stylesheet. This is what the
 *     editor's ClassPicker manipulates.
 *
 *   - `kind: 'ambient'` — the rule attaches by CSS matching, not by node
 *     assignment (e.g. `h1`, `h1 > span`, `.hero .title`, `a:hover`). The
 *     publisher emits the rule into the stylesheet only; nothing changes on
 *     node `class=` attributes. Used by the CSS importer and "Add ambient
 *     selector" affordance.
 *
 * §4.1 persistence note: `styles` and `contextStyles` are stored as
 * `Record<string, unknown>` matching `validate.ts` which stores the raw object
 * without narrowing to CSSPropertyBag. Narrowing happens at the publisher
 * boundary (`bagToCSS` in `classCss.ts`).
 *
 * CSSPropertyBag is used for the WRITE API (classSlice / framework
 * generators) which always writes only known CSS property keys.
 *
 * For tolerant parsing of persisted style rules (with per-entry fallbacks),
 * use `parseStyleRule` instead of `parseValue(StyleRuleSchema, raw)`.
 *
 * Constraint #269: no imports from editor / editor-store here.
 */

import { Type, Value, type Static, withFallback } from '@core/utils/typeboxHelpers'
import { GeneratedClassMetadataSchema } from '@core/framework/schemas'
import {
  asPlainObject,
  parseBreakpointStylesBag,
  parseStringArrayField,
  parseStylesBag,
  parseTimestamp,
} from './parseHelpers'
import { conditionId, type Condition } from './condition'
import { escapeCssIdentifier as escapeCssIdent } from './cssIdentifier'

// ---------------------------------------------------------------------------
// StyleRuleSchema
// ---------------------------------------------------------------------------

export const StyleRuleKindSchema = Type.Union([Type.Literal('class'), Type.Literal('ambient')])
export type StyleRuleKind = Static<typeof StyleRuleKindSchema>

export const StyleRuleSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  /**
   * Discriminator. Old persisted shells written before this field existed
   * default to `'class'` in `parseStyleRule`.
   */
  kind: withFallback(StyleRuleKindSchema, 'class' as StyleRuleKind),
  /**
   * The CSS selector expression emitted verbatim into the published
   * stylesheet:
   *   - kind:'class'   → `.<escaped-name>` (always derived from `name`; not
   *                      user-edited; kept on the object so the publisher and
   *                      canvas can call `styleRuleSelector(rule)` uniformly).
   *   - kind:'ambient' → any valid selector (`h1`, `h1 > span`, `.hero .title`,
   *                      `a:hover`, `[data-x="y"]`, ...).
   *
   * Old shells without this field have it backfilled in `parseStyleRule` from
   * `.${escapeCssIdentifier(name)}`.
   */
  selector: withFallback(Type.String(), ''),
  /**
   * Cascade order — emitted rules are sorted ascending by `order`. Imported
   * rules preserve their position in the source stylesheet so author intent
   * survives. User-created rules append at the end. Defaults to 0 (treated as
   * "insertion order" by stable sort).
   */
  order: withFallback(Type.Number(), 0),
  description: Type.Optional(Type.String()),
  /**
   * Optional ownership scope. If the scope object does not match the exact
   * shape, it is silently dropped — handled in parseStyleRule.
   */
  scope: Type.Optional(Type.Object({
    type: Type.Literal('node'),
    nodeId: Type.String(),
    role: Type.Literal('module-style'),
  })),
  /**
   * Base CSS styles — arbitrary string→unknown map at persistence boundary.
   * Falls back to {} when missing or invalid — handled in parseStyleRule.
   */
  styles: withFallback(Type.Record(Type.String(), Type.Unknown()), {} as Record<string, unknown>),
  /**
   * Per-context overrides — same persistence semantics as `styles`. The unified
   * "editing context" model (docs/plans/2026-05-30-unified-condition-axis.md):
   * one flat map keyed by a context id, where a context id is EITHER
   *   - a width breakpoint id (from `site.breakpoints`) → `@media (max-width:N)`,
   *   - or a condition id (from `site.conditions`) → custom
   *     `@media` / `@container` / `@supports`.
   *
   * This replaces the old split between `breakpointStyles` (width breakpoints)
   * and `conditionalLayers` (everything else) — they were the same axis twice.
   * Falls back to {} when missing or invalid — handled in parseStyleRule, which
   * also migrates the two legacy fields into this one.
   */
  contextStyles: withFallback(
    Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
    {} as Record<string, Record<string, unknown>>,
  ),
  /** Optional search/filter tags. Invalid items silently dropped — handled in parseStyleRule. */
  tags: Type.Optional(Type.Array(Type.String())),
  /** Metadata for framework-generated classes. Undefined if invalid — handled in parseStyleRule. */
  generated: Type.Optional(GeneratedClassMetadataSchema),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
})

export type StyleRule = Static<typeof StyleRuleSchema>

/**
 * Build the canonical `.<escaped-name>` selector for a class-kind rule.
 * Used during creation and when backfilling missing `selector` on old data.
 */
export function classKindSelector(name: string): string {
  return `.${escapeCssIdent(name)}`
}

// ---------------------------------------------------------------------------
// Tolerant parsing
// ---------------------------------------------------------------------------

/**
 * Resolve the context-id key for a legacy `conditionalLayers` entry's
 * condition. Legacy `breakpoint`-kind conditions key by their breakpoint id (so
 * they merge with migrated `breakpointStyles`); custom conditions key by the
 * deterministic `conditionId`. Returns null on an unrecognised shape.
 */
function legacyLayerContextId(rawCondition: unknown): string | null {
  const c = asPlainObject(rawCondition)
  if (!c) return null
  if (c.kind === 'breakpoint' && typeof c.breakpointId === 'string') return c.breakpointId
  if (c.kind === 'media' && typeof c.query === 'string') {
    return conditionId({ kind: 'media', query: c.query })
  }
  if (c.kind === 'container' && typeof c.query === 'string') {
    const cond: Condition = {
      kind: 'container',
      query: c.query,
      ...(typeof c.name === 'string' ? { name: c.name } : {}),
    }
    return conditionId(cond)
  }
  if (c.kind === 'supports' && typeof c.query === 'string') {
    return conditionId({ kind: 'supports', query: c.query })
  }
  return null
}

/**
 * Build the `contextStyles` map for a rule, migrating the two legacy fields:
 *   - `contextStyles` (current shape) — taken as-is.
 *   - `breakpointStyles` (legacy width-breakpoint model) — folded in by
 *     breakpoint id.
 *   - `conditionalLayers` (legacy per-rule custom conditions) — folded in by
 *     condition id (or breakpoint id for legacy breakpoint-kind layers).
 *
 * The site-level `conditions` registry that names these condition ids is
 * reconstructed separately in `parseSiteDocument` from the same raw layers.
 */
function parseContextStyles(raw: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  const merge = (key: string, bag: Record<string, unknown>) => {
    if (Object.keys(bag).length === 0) return
    out[key] = { ...(out[key] ?? {}), ...bag }
  }

  // Current shape.
  const current = parseBreakpointStylesBag(raw.contextStyles)
  for (const [key, bag] of Object.entries(current)) merge(key, bag)

  // Legacy breakpointStyles → contextStyles[breakpointId].
  const legacyBp = parseBreakpointStylesBag(raw.breakpointStyles)
  for (const [key, bag] of Object.entries(legacyBp)) merge(key, bag)

  // Legacy conditionalLayers → contextStyles[conditionId].
  if (Array.isArray(raw.conditionalLayers)) {
    for (const entry of raw.conditionalLayers) {
      const layer = asPlainObject(entry)
      if (!layer) continue
      const key = legacyLayerContextId(layer.condition)
      if (!key) continue
      merge(key, parseStylesBag(layer.styles))
    }
  }

  return out
}

/** Parse a StyleRule scope (currently only `{ type: 'node', nodeId, role: 'module-style' }`). */
function parseStyleRuleScope(raw: unknown): StyleRule['scope'] {
  const s = asPlainObject(raw)
  if (!s) return undefined
  if (s.type !== 'node' || typeof s.nodeId !== 'string' || s.role !== 'module-style') return undefined
  return { type: 'node', nodeId: s.nodeId, role: 'module-style' }
}

/**
 * Parse a StyleRule, providing fallbacks for resilient fields.
 *
 * Backfills for the selectors-system fields on legacy shells that predate them:
 *   - kind:      defaults to 'class' (the only kind that existed before).
 *   - selector:  defaults to the canonical `.<escaped-name>` for kind 'class'.
 *                For kind 'ambient' a missing selector falls back to the name
 *                verbatim (the importer always writes selector explicitly).
 *   - order:     defaults to 0 (stable-sort preserves insertion order).
 */
export function parseStyleRule(raw: unknown): StyleRule | null {
  const r = asPlainObject(raw)
  if (!r) return null
  if (typeof r.id !== 'string') return null
  if (typeof r.name !== 'string') return null

  const scope = parseStyleRuleScope(r.scope)
  const tags = parseStringArrayField(r.tags)
  const contextStyles = parseContextStyles(r)
  const generated = Value.Check(GeneratedClassMetadataSchema, r.generated)
    ? (r.generated as StyleRule['generated'])
    : undefined

  const kind: StyleRuleKind = r.kind === 'ambient' ? 'ambient' : 'class'
  const rawSelector = typeof r.selector === 'string' ? r.selector : ''
  const selector = rawSelector.length > 0
    ? rawSelector
    : (kind === 'class' ? classKindSelector(r.name) : r.name)
  const order = typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 0

  return {
    id: r.id,
    name: r.name,
    kind,
    selector,
    order,
    ...(typeof r.description === 'string' ? { description: r.description } : {}),
    ...(scope !== undefined ? { scope } : {}),
    styles: parseStylesBag(r.styles),
    contextStyles,
    ...(tags !== undefined ? { tags } : {}),
    ...(generated !== undefined ? { generated } : {}),
    createdAt: parseTimestamp(r.createdAt),
    updatedAt: parseTimestamp(r.updatedAt),
  }
}

/** Parse the style rule registry: iterate entries and silently drop those with invalid id/name. */
export function parseStyleRuleRegistry(raw: unknown): Record<string, StyleRule> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, StyleRule> = {}
  for (const [id, rule] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = parseStyleRule(rule)
    if (parsed) result[id] = parsed
  }
  return result
}
