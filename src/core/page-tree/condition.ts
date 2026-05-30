/**
 * Condition — a reusable, site-level CSS condition definition.
 *
 * Part of the unified "editing context" model (see
 * docs/plans/2026-05-30-unified-condition-axis.md). An *editing context* is the
 * condition under which a style override applies. There are two kinds of
 * context id a `StyleRule.contextStyles` map can key on:
 *
 *   - a **breakpoint id** (from `site.breakpoints`) → emits
 *     `@media (max-width: Npx)`. The width presets that drive the canvas frame.
 *   - a **condition id** (from `site.conditions`, defined here) → emits a custom
 *     `@media` / `@container` / `@supports` block.
 *
 * Conditions are *reusable*: defined once on the site, any class can carry an
 * override under one. This mirrors how breakpoints already work and replaces
 * the old per-rule `conditionalLayers` array (which embedded the condition in
 * every rule, with no reuse).
 *
 * Constraint #269: no imports from editor / editor-store here.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { asPlainObject } from './parseHelpers'

// ---------------------------------------------------------------------------
// Condition — the discriminated CSS condition a context applies under.
// ---------------------------------------------------------------------------

/**
 * The condition a custom editing context applies under. Discriminated by
 * `kind`. (Width breakpoints are NOT represented here — a breakpoint context is
 * keyed by its `site.breakpoints` id directly. These are the conditions that
 * have no first-class breakpoint preset.)
 *
 *   - `media`:     any media query, stored verbatim (`(max-width: 860px)`,
 *                  `(orientation: landscape)`, `print`). Emits `@media <query>`.
 *   - `container`: a container query with an optional container name.
 *                  Emits `@container [name] (<query>)`.
 *   - `supports`:  a feature query. Emits `@supports (<query>)`.
 */
export const ConditionSchema = Type.Union([
  Type.Object({ kind: Type.Literal('media'), query: Type.String() }),
  Type.Object({
    kind: Type.Literal('container'),
    query: Type.String(),
    name: Type.Optional(Type.String()),
  }),
  Type.Object({ kind: Type.Literal('supports'), query: Type.String() }),
])
export type Condition = Static<typeof ConditionSchema>

// ---------------------------------------------------------------------------
// ConditionDef — a named, reusable site-level condition.
// ---------------------------------------------------------------------------

export const ConditionDefSchema = Type.Object({
  /**
   * Stable id. Deterministic from the condition content (see `conditionId`) so
   * importing the same condition twice — or migrating legacy per-rule layers —
   * dedupes to one definition.
   */
  id: Type.String(),
  /** Human label shown in the context switcher (e.g. "Dark", "Card ≥400"). */
  label: Type.String(),
  condition: ConditionSchema,
})
export type ConditionDef = Static<typeof ConditionDefSchema>

// ---------------------------------------------------------------------------
// Derivation helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic context id for a condition, derived purely from its content.
 * Two structurally-equal conditions produce the same id, so they share one
 * registry entry and one `contextStyles` key. Matches the scheme the CSS
 * importer uses so imported + hand-authored conditions collapse together.
 */
export function conditionId(condition: Condition): string {
  switch (condition.kind) {
    case 'media': return `media:${condition.query}`
    case 'container': return `container:${condition.name ?? ''}:${condition.query}`
    case 'supports': return `supports:${condition.query}`
  }
}

/** Short human label for a condition, used as the default `ConditionDef.label`. */
export function conditionLabel(condition: Condition): string {
  switch (condition.kind) {
    case 'media': return condition.query
    case 'container': return condition.name ? `@${condition.name} ${condition.query}` : condition.query
    case 'supports': return `supports ${condition.query}`
  }
}

/** Structural equality for two conditions. */
export function sameCondition(a: Condition, b: Condition): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'media':
    case 'supports':
      return a.query === (b as Extract<Condition, { kind: 'media' | 'supports' }>).query
    case 'container': {
      const bb = b as Extract<Condition, { kind: 'container' }>
      return a.query === bb.query && (a.name ?? '') === (bb.name ?? '')
    }
  }
}

/** Build a fully-formed `ConditionDef` from a condition (+ optional label). */
export function makeConditionDef(condition: Condition, label?: string): ConditionDef {
  return {
    id: conditionId(condition),
    label: label && label.trim().length > 0 ? label.trim() : conditionLabel(condition),
    condition,
  }
}

// ---------------------------------------------------------------------------
// Tolerant parsing
// ---------------------------------------------------------------------------

/** Parse a single condition, returning null on an unrecognised shape. */
export function parseCondition(raw: unknown): Condition | null {
  const c = asPlainObject(raw)
  if (!c) return null
  if (c.kind === 'media' && typeof c.query === 'string') {
    return { kind: 'media', query: c.query }
  }
  if (c.kind === 'container' && typeof c.query === 'string') {
    return {
      kind: 'container',
      query: c.query,
      ...(typeof c.name === 'string' ? { name: c.name } : {}),
    }
  }
  if (c.kind === 'supports' && typeof c.query === 'string') {
    return { kind: 'supports', query: c.query }
  }
  return null
}

/** Parse a single ConditionDef, dropping it (null) when unusable. */
export function parseConditionDef(raw: unknown): ConditionDef | null {
  const r = asPlainObject(raw)
  if (!r) return null
  const condition = parseCondition(r.condition)
  if (!condition) return null
  const id = typeof r.id === 'string' && r.id.length > 0 ? r.id : conditionId(condition)
  const label = typeof r.label === 'string' && r.label.length > 0 ? r.label : conditionLabel(condition)
  return { id, label, condition }
}

/**
 * Parse the optional site-level conditions registry, dropping invalid entries
 * and de-duplicating by id (first wins).
 */
export function parseConditions(raw: unknown): ConditionDef[] {
  if (!Array.isArray(raw)) return []
  const out: ConditionDef[] = []
  const seen = new Set<string>()
  for (const entry of raw) {
    const def = parseConditionDef(entry)
    if (!def || seen.has(def.id)) continue
    seen.add(def.id)
    out.push(def)
  }
  return out
}
