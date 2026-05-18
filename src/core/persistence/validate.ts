/**
 * validateSite — Constraint #230: ALL site data loaded from storage MUST be
 * validated before being passed to `store.loadSite()`.
 *
 * Structural validation is delegated to parseSiteDocument (TypeBox).
 * runDomainPostChecks() handles the nine cross-cutting rules that cannot be
 * expressed as per-field schema constraints:
 *   1. Page slug syntax
 *   2. Page slug uniqueness
 *   3. SiteFile path safety + deduplication
 *   4. VisualComponent name validation
 *   5. VisualComponent recursion prevention
 *   6. Richtext prop sanitization (XSS — Constraint #299)
 *   7. SitePackageJson name sanitization
 *   8. SiteRuntimeConfig normalization
 *   9. Framework color slug normalization + default dark color generation
 *
 * Referential integrity: rootNodeId must exist in each page's nodes map.
 */

import { parseSiteDocument, type SiteDocument } from '@core/page-tree/schemas'
import { isSafePath, normalizePath } from '@core/files/pathValidation'
import { validateComponentName } from '@core/visualComponents/nameValidation'
import { sanitizeRichtext, isRichtextPropKey } from '@core/sanitize'
import { normalizeSitePackageJson } from '@core/site-dependencies/manifest'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime'
import { pageSlugDuplicateError, pageSlugError } from '@core/page-tree/slugs'
import { generateDefaultDarkColor, normalizeFrameworkColorSlug } from '@core/framework/colors'
import { getReferencedComponentIds } from '@core/visualComponents/recursionGuard'
import { syncSlotInstances, applySlotSyncResult } from '@core/visualComponents/slotSync'
import type { BaseNode } from '@core/page-tree/baseNode'

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
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a parseSiteDocument error message to a structured site path.
 *
 * parseSiteDocument throws Error with messages in two formats:
 *   1. "<relative.path>: <description>" (from parsePageNode / parsePage)
 *      → strip the ': ...' suffix, prepend 'site.'
 *   2. "<firstWord> <rest>" (top-level field errors, e.g. "id must be a string")
 *      → extract first word as field name, prepend 'site.'
 */
function extractSiteErrorPath(message: string): string {
  const colonIndex = message.indexOf(': ')
  if (colonIndex > 0) {
    return `site.${message.slice(0, colonIndex)}`
  }
  const firstWord = message.split(' ')[0]
  return `site.${firstWord}`
}

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
  let site: SiteDocument
  try {
    site = parseSiteDocument(raw)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invalid site'
    throw new SiteValidationError(message, extractSiteErrorPath(message))
  }
  return runDomainPostChecks(site)
}

/**
 * Walk a node's props and sanitize richtext-keyed values in-place.
 * Operates on a single flat node — no childNodes recursion (VC trees are now flat).
 */
function sanitizeNodeProps(node: unknown): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return
  const n = node as { props?: Record<string, unknown> }
  if (n.props && typeof n.props === 'object') {
    for (const [key, val] of Object.entries(n.props)) {
      if (isRichtextPropKey(key) && typeof val === 'string') {
        n.props[key] = sanitizeRichtext(val)
      }
    }
  }
}

/**
 * Remove `base.visual-component-ref` nodes whose `componentId` does not resolve
 * to a known VC from the flat node map. Strips the entire subtree (ref +
 * slot-instances + user content) and splices the ref out of its parent's
 * `children[]`. Self-heals sites corrupted by the old (pre-fix) delete behaviour
 * that left dangling refs behind.
 *
 * Exported for unit tests and called from `runDomainPostChecks` after the VC
 * list has been finalised (post-cycle-filter).
 */
export function stripDanglingVCRefs(site: SiteDocument): void {
  const knownVcIds = new Set(site.visualComponents.map((vc) => vc.id))

  const strip = (nodes: Record<string, BaseNode>): void => {
    // Collect all top-level ref IDs pointing at an unknown VC
    const danglingRefIds: string[] = []
    for (const [nodeId, node] of Object.entries(nodes)) {
      if (node.moduleId !== 'base.visual-component-ref') continue
      const componentId = node.props.componentId
      if (typeof componentId !== 'string' || !componentId) continue
      if (!knownVcIds.has(componentId)) danglingRefIds.push(nodeId)
    }

    for (const refNodeId of danglingRefIds) {
      // DFS-collect entire subtree
      const subtreeIds: string[] = []
      const stack: string[] = [refNodeId]
      while (stack.length > 0) {
        const id = stack.pop()!
        const node = nodes[id]
        if (!node) continue
        subtreeIds.push(id)
        stack.push(...node.children)
      }

      // Remove ref from its parent's children[]
      for (const node of Object.values(nodes)) {
        const idx = node.children.indexOf(refNodeId)
        if (idx !== -1) {
          node.children.splice(idx, 1)
          break
        }
      }

      // Delete subtree nodes from the flat map
      for (const id of subtreeIds) {
        delete nodes[id]
      }
    }
  }

  for (const page of site.pages) {
    strip(page.nodes as Record<string, BaseNode>)
  }
  for (const vc of site.visualComponents) {
    strip(vc.tree.nodes as Record<string, BaseNode>)
  }
}

/**
 * Drop VisualComponents that form dependency cycles.
 * Uses DFS cycle detection on the componentRef graph.
 */
function filterCyclicVCs(vcs: SiteDocument['visualComponents']): SiteDocument['visualComponents'] {
  const vcMap = new Map(vcs.map((vc) => [vc.id, vc]))
  const cyclic = new Set<string>()
  const visited = new Set<string>()
  const inStack = new Set<string>()

  function dfs(id: string): boolean {
    if (inStack.has(id)) { cyclic.add(id); return true }
    if (visited.has(id)) return cyclic.has(id)
    visited.add(id)
    inStack.add(id)
    const vc = vcMap.get(id)
    if (vc) {
      for (const refId of getReferencedComponentIds(vc)) {
        if (dfs(refId)) cyclic.add(id)
      }
    }
    inStack.delete(id)
    return cyclic.has(id)
  }

  for (const vc of vcs) dfs(vc.id)
  return vcs.filter((vc) => !cyclic.has(vc.id))
}

// ---------------------------------------------------------------------------
// Domain post-checks
// ---------------------------------------------------------------------------

function runDomainPostChecks(site: SiteDocument): SiteDocument {
  // 1 & 2: Page slug syntax + uniqueness
  for (let i = 0; i < site.pages.length; i++) {
    const { slug, id } = site.pages[i]
    const slugErr = pageSlugError(slug)
    if (slugErr) throw new SiteValidationError(slugErr, `site.pages[${i}].slug`)
    const dupErr = pageSlugDuplicateError(slug, site.pages, id)
    if (dupErr) throw new SiteValidationError(`duplicate slug: ${dupErr}`, `site.pages[${i}].slug`)
  }

  // Referential integrity: rootNodeId must exist in the page's nodes map
  for (let i = 0; i < site.pages.length; i++) {
    const page = site.pages[i]
    if (!page.nodes[page.rootNodeId]) {
      throw new SiteValidationError(
        `rootNodeId "${page.rootNodeId}" not found in nodes`,
        `site.pages[${i}].rootNodeId`,
      )
    }
  }

  // 3: SiteFile path safety + deduplication (first-wins on normalized path)
  const seenPaths = new Set<string>()
  site.files = site.files.filter((file) => {
    const normalized = normalizePath(file.path)
    if (!isSafePath(normalized) || seenPaths.has(normalized)) return false
    seenPaths.add(normalized)
    file.path = normalized
    return true
  })

  // 4: VC name validation + deduplication (first-wins on name)
  const seenVCNames = new Set<string>()
  site.visualComponents = site.visualComponents.filter((vc) => {
    if (!validateComponentName(vc.name, []).ok) return false
    if (seenVCNames.has(vc.name)) return false
    seenVCNames.add(vc.name)
    return true
  })

  // 5: VC recursion prevention — drop VCs that form dependency cycles
  site.visualComponents = filterCyclicVCs(site.visualComponents)

  // 5b: Passive slot sync — idempotent reconciliation of slot-instance children
  // on every VC ref. Runs after VC filtering so we only reference live VCs.
  // This fixes any slot-instance drift that may have occurred before Task 4 was
  // wired into all mutation paths (e.g. legacy data, direct DB edits).
  {
    const vcById = new Map(site.visualComponents.map((vc) => [vc.id, vc]))
    for (const page of site.pages) {
      for (const node of Object.values(page.nodes)) {
        if (node.moduleId !== 'base.visual-component-ref') continue
        const componentId = node.props.componentId
        if (typeof componentId !== 'string' || !componentId) continue
        const vc = vcById.get(componentId)
        if (!vc) continue
        const treeNodes = page.nodes as Record<string, BaseNode>
        const syncResult = syncSlotInstances(node as BaseNode, vc, treeNodes)
        if (syncResult.ops.length > 0 || Object.keys(syncResult.newNodes).length > 0) {
          applySlotSyncResult(treeNodes, syncResult, node.id)
        }
      }
    }
  }

  // 5c: Strip dangling VC refs — remove base.visual-component-ref nodes whose
  // componentId doesn't resolve to a known VC (can arise from old delete bugs).
  // Runs after slot sync (5b) so we don't strip refs added by sync.
  stripDanglingVCRefs(site)

  // 6: Richtext sanitization — page nodes (flat map) and VC node trees (flat map)
  for (const page of site.pages) {
    for (const node of Object.values(page.nodes)) sanitizeNodeProps(node)
  }
  for (const vc of site.visualComponents) {
    for (const node of Object.values(vc.tree.nodes)) sanitizeNodeProps(node)
  }

  // 7: SitePackageJson name sanitization (filters unsafe npm package names)
  site.packageJson = normalizeSitePackageJson(site.packageJson)

  // 8: SiteRuntimeConfig normalization (filters unsafe names in dep-lock, normalizes scripts)
  site.runtime = normalizeSiteRuntimeConfig(site.runtime)

  // 9: Framework color slug normalization + default dark color generation
  if (site.settings.framework?.colors) {
    site.settings.framework.colors.tokens = site.settings.framework.colors.tokens.map((token) => ({
      ...token,
      slug: normalizeFrameworkColorSlug(token.slug),
      darkValue: token.darkValue || generateDefaultDarkColor(token.lightValue),
    }))
  }

  return site
}
