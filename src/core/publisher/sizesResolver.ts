/**
 * Publisher — `sizes='auto'` resolver.
 *
 * The image module's `sizes` prop accepts an explicit media-query string
 * (e.g. `(min-width: 1024px) 50vw, 100vw`). When the author leaves it at the
 * default `'auto'`, this resolver walks the image's ancestor chain and
 * derives a `sizes` string from the innermost ancestor that constrains the
 * box's width via CSS.
 *
 * Scope (v1):
 *   - Only `width` and `maxWidth` are inspected.
 *   - Only pixel values (`"800px"`, `"800"`) count — `%` / `vw` / `auto`
 *     would need a parent-width context the publisher doesn't compute.
 *   - The **innermost** ancestor with a pixel-valued cap wins. Once one is
 *     found, traversal stops — outer ancestors can't loosen an inner cap.
 *   - The cap can shrink per-breakpoint via `class.breakpointStyles`. Each
 *     defined breakpoint emits a separate tier in the output.
 *
 * Output: a `sizes` string emitted next to `srcset`, e.g.
 *   `(min-width: 769px) 1200px, (min-width: 376px) 600px, 100vw`
 *
 * Returns `null` when no constraining ancestor is found — caller (the image
 * module) falls back to the simpler `'100vw'` default.
 *
 * Why ancestor-only, not the image's own classes? The same image is
 * commonly wrapped in a `max-width: 1200px` container — that's where the
 * real cap lives. The image's own classes typically pin display semantics
 * (border-radius, object-fit), not width. Still, this resolver inspects
 * the image node itself first so authors who DO pin a width directly on
 * the image still benefit.
 */
import type { Page, PageNode, SiteDocument } from '@core/page-tree'

/** Effective pixel cap inferred from CSS. `null` means "no pixel constraint". */
type WidthCap = number | null

/**
 * Inspect a single CSS-style bag for a pixel-valued width / maxWidth.
 *
 * `maxWidth` wins over `width` because the visual editor's typical pattern
 * is to set `width: 100%; max-width: 1200px;` on containers — the cap is
 * the meaningful number.
 */
function widthCapFromBag(bag: Record<string, unknown> | undefined): WidthCap {
  if (!bag) return null
  return pixelOrNull(bag.maxWidth) ?? pixelOrNull(bag.width)
}

/**
 * Parse `"800px"` / `"800"` / `800` → `800`. Returns `null` for any non-pixel
 * unit (`%`, `vw`, `rem`, `auto`, etc.), empty strings, NaN, and non-positive
 * numbers.
 */
function pixelOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  // Reject explicit non-px units / CSS functions outright.
  if (/(?:%|vw|vh|rem|em|auto|min\(|max\(|clamp\(|calc\()/.test(trimmed)) return null
  const m = trimmed.match(/^(\d+(?:\.\d+)?)(?:px)?$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Per-breakpoint width cap for one node. Returns `null` for the base tier
 * (no constraint), and a number or `null` for each breakpoint id.
 *
 * Multi-class semantics: in v1, the **last classId** declaring a width is
 * authoritative — same direction as CSS source-order ties between
 * equally-specific selectors. Earlier classes' declarations are
 * overridden. Classes with no width / maxWidth are skipped.
 */
function nodeCaps(
  node: PageNode,
  site: SiteDocument,
  breakpointIds: string[],
): { base: WidthCap; byBreakpoint: Map<string, WidthCap> } {
  let base: WidthCap = null
  const byBreakpoint = new Map<string, WidthCap>()

  for (const classId of node.classIds ?? []) {
    const cls = site.styleRules[classId]
    if (!cls) continue
    const fromBase = widthCapFromBag(cls.styles)
    if (fromBase !== null) base = fromBase
    for (const bpId of breakpointIds) {
      const fromBp = widthCapFromBag(cls.contextStyles?.[bpId])
      if (fromBp !== null) byBreakpoint.set(bpId, fromBp)
    }
  }
  return { base, byBreakpoint }
}

/**
 * Build `nodeId → parentNodeId` map for one page. O(N) over the flat node
 * map, cached on the page reference so multi-image pages amortize the
 * cost across all images on the page.
 */
const parentMapCache = new WeakMap<Page, Map<string, string>>()
function getParentMap(page: Page): Map<string, string> {
  const cached = parentMapCache.get(page)
  if (cached) return cached
  const map = new Map<string, string>()
  for (const [parentId, node] of Object.entries(page.nodes)) {
    for (const childId of node.children ?? []) map.set(childId, parentId)
  }
  parentMapCache.set(page, map)
  return map
}

/**
 * Walk from `nodeId` outward. Returns `[node, parent, grandparent, …,
 * root]` — innermost first.
 */
function ancestorChain(nodeId: string, page: Page): PageNode[] {
  const parents = getParentMap(page)
  const out: PageNode[] = []
  let current: string | undefined = nodeId
  while (current) {
    const node = page.nodes[current]
    if (!node) break
    out.push(node)
    current = parents.get(current)
  }
  return out
}

/**
 * Find the innermost ancestor (inclusive of `nodeId` itself) whose CSS
 * declares any width cap (base or per-breakpoint). The result is that
 * ancestor's per-tier caps — outer ancestors don't get inspected once a
 * constraint is found because outer ancestors cannot make an inner cap
 * looser.
 */
function findConstrainingAncestor(
  nodeId: string,
  page: Page,
  site: SiteDocument,
): { base: WidthCap; byBreakpoint: Map<string, WidthCap> } | null {
  const chain = ancestorChain(nodeId, page)
  const breakpointIds = site.breakpoints.map((b) => b.id)
  for (const node of chain) {
    const caps = nodeCaps(node, site, breakpointIds)
    if (caps.base !== null || caps.byBreakpoint.size > 0) return caps
  }
  return null
}

/** Convert a width cap → CSS `sizes` source value. */
function capToSize(cap: WidthCap): string {
  return cap === null ? '100vw' : `${Math.round(cap)}px`
}

/**
 * Resolve a per-breakpoint `sizes` string for the image at `nodeId`.
 *
 * Returns `null` when nothing in the chain constrains the image — caller
 * falls back to `'100vw'`.
 */
export function resolveAutoSizes(
  nodeId: string,
  page: Page,
  site: SiteDocument,
): string | null {
  const caps = findConstrainingAncestor(nodeId, page, site)
  if (!caps) return null

  // Sort breakpoints widest → narrowest. The CSS pipeline emits each
  // `@media (max-width: N)` rule and narrower-overrides-wider, so for
  // `sizes` (which uses `min-width`) we mirror the cascade in reverse:
  // emit the widest viewport tier first.
  const orderedBps = site.breakpoints.slice().sort((a, b) => b.width - a.width)

  // Build the raw per-tier cap sequence (widest → narrowest), applying the
  // CSS cascade. Each tier's `minViewport` is the lower bound of the
  // viewport range it covers:
  //   - "above all breakpoints"   → base only,                 minViewport = widest_bp.width + 1
  //   - "viewport ≤ widest_bp"    → + widest_bp override,      minViewport = next_narrower.width + 1
  //   - "viewport ≤ narrower_bp"  → + that bp's override,      …
  //
  // Within a single class, narrower breakpoint overrides win because they're
  // emitted later in CSS. Same here: once a breakpoint defines a cap, it
  // shadows base for all narrower tiers until another breakpoint changes it.
  type RawTier = { minViewport: number | null; cap: WidthCap }
  const rawTiers: RawTier[] = []
  let currentCap: WidthCap = caps.base
  const widestBp = orderedBps[0]
  rawTiers.push({
    minViewport: widestBp ? widestBp.width + 1 : null,
    cap: currentCap,
  })

  for (let i = 0; i < orderedBps.length; i++) {
    const bp = orderedBps[i]
    const bpCap = caps.byBreakpoint.get(bp.id)
    if (bpCap !== undefined) currentCap = bpCap
    const next = orderedBps[i + 1]
    rawTiers.push({
      minViewport: next ? next.width + 1 : null,
      cap: currentCap,
    })
  }

  // Collapse adjacent same-cap tiers — drop the WIDER one of each pair so
  // the surviving (narrower / broader-coverage) `min-width` rule covers
  // both viewport ranges. Dropping the narrower would create a gap
  // because the catch-all default would take over too early.
  //
  // Concretely: tiers `[{1441, 1200}, {376, 1200}, {null, 320}]` collapse
  // to `[{376, 1200}, {null, 320}]` → output `(min-width: 376px) 1200px, 320px`.
  const collapsed: RawTier[] = []
  for (let i = 0; i < rawTiers.length; i++) {
    const tier = rawTiers[i]
    const next = rawTiers[i + 1]
    if (next && capToSize(next.cap) === capToSize(tier.cap)) continue
    collapsed.push(tier)
  }

  // If every surviving tier is `100vw`, there's nothing useful to express.
  if (collapsed.every((t) => t.cap === null)) return null

  // Emit. The LAST tier (narrowest viewport) is the catch-all default and
  // gets no media-query prefix.
  const trailing = collapsed[collapsed.length - 1]
  const head = collapsed
    .slice(0, -1)
    .map((t) => `(min-width: ${t.minViewport}px) ${capToSize(t.cap)}`)
    .join(', ')
  return head ? `${head}, ${capToSize(trailing.cap)}` : capToSize(trailing.cap)
}
