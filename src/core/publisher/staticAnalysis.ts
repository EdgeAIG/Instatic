/**
 * Page-level static-analysis predicates — thin projections over
 * `dynamicDetection.ts`.
 *
 * Public API:
 *   `isFullyStaticPage(page, site, registry): boolean`
 *   `staticReasons(page, site, registry): string[]`
 *   `isBindingSourceRequestDependent(source, field): boolean` (re-export)
 *
 * A page is fully static iff every node in its tree (including
 * recursively referenced Visual Components) is publish-time-deterministic.
 * Both predicates here delegate to `findDynamicNodesWithReasons` so the
 * four detection rules live in exactly one place and cannot drift between
 * Layer A (disk artefacts) and Layer C (hole placeholders).
 *
 * See `dynamicDetection.ts` for the rules + the consolidated walker.
 */

import type { Page, SiteDocument } from '@core/page-tree'
import type { IModuleRegistry } from '@core/module-engine/types'
import {
  findDynamicNodesWithReasons,
  isBindingSourceRequestDependent,
} from './dynamicDetection'

export { isBindingSourceRequestDependent }

/**
 * Returns a list of human-readable reasons why `page` is NOT fully static.
 *
 * Empty list ⇔ every node (including VC-ref'd trees) is
 * publish-time-deterministic, so the page bakes to a complete static document
 * rather than a `<pb-hole>` shell. (Layer A bakes BOTH kinds to disk; this
 * predicate just distinguishes "complete document" from "shell with holes".)
 *
 * Useful for developer tooling and editor introspection.
 */
export function staticReasons(
  page: Page,
  site: SiteDocument,
  registry: IModuleRegistry,
): string[] {
  return findDynamicNodesWithReasons(page, site, registry).reasons
}

/**
 * Returns `true` iff the page tree contains no request-dependent constructs —
 * i.e. it bakes to a complete static document with no `<pb-hole>` placeholders.
 *
 * Returns `false` if any node is dynamic (module flag, request-dependent
 * binding, request-dependent loop source, or a VC ref to a dynamic VC), or
 * if a VC ref cycle is detected. Such pages still bake to disk (Layer A) — as
 * a static shell whose dynamic nodes are Layer C holes.
 */
export function isFullyStaticPage(
  page: Page,
  site: SiteDocument,
  registry: IModuleRegistry,
): boolean {
  return findDynamicNodesWithReasons(page, site, registry).dynamicPageNodeIds.size === 0
}
