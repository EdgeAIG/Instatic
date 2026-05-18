/**
 * VCDeletionImpact — impact-preview helper for visual component deletion.
 *
 * Used by the editor to show users which pages and other components contain
 * references to a VC before it is deleted. The caller checks the impact and
 * either commits silently (no usages) or shows a confirmation dialog listing
 * every usage site.
 *
 * Constraint #269: no imports from editor / editor-store here.
 */

import type { SiteDocument } from '@core/page-tree/schemas'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VCRefUsage {
  source:
    | {
        kind: 'page'
        pageId: string
        pageTitle: string
        nodeId: string
        nodeLabel: string
      }
    | {
        kind: 'visualComponent'
        vcId: string
        vcName: string
        nodeId: string
        nodeLabel: string
      }
}

export interface VCDeletionImpact {
  vc: { id: string; name: string }
  usages: VCRefUsage[]
  /** Number of distinct pages containing at least one ref to the deleted VC. */
  pageCount: number
  /** Number of distinct other VCs containing at least one ref to the deleted VC. */
  vcCount: number
}

// ---------------------------------------------------------------------------
// previewVCDeletion
// ---------------------------------------------------------------------------

/**
 * Compute where a VC is referenced across all pages and other VCs.
 *
 * Returns `null` when the VC has no usages — the caller can commit silently
 * without showing the impact dialog.
 *
 * Self-references (a VC containing a ref to itself) are excluded because the
 * recursion guard prevents them; even if present in corrupt data they are not
 * actionable information for the user.
 */
export function previewVCDeletion(
  site: SiteDocument,
  vcId: string,
): VCDeletionImpact | null {
  const vc = site.visualComponents.find((v) => v.id === vcId)
  if (!vc) return null

  const usages: VCRefUsage[] = []

  // Walk pages
  for (const page of site.pages) {
    for (const node of Object.values(page.nodes)) {
      if (
        node.moduleId === 'base.visual-component-ref' &&
        node.props.componentId === vcId
      ) {
        usages.push({
          source: {
            kind: 'page',
            pageId: page.id,
            pageTitle: page.title,
            nodeId: node.id,
            nodeLabel: node.label ?? node.moduleId,
          },
        })
      }
    }
  }

  // Walk other VCs (skip self to exclude self-references)
  for (const otherVc of site.visualComponents) {
    if (otherVc.id === vcId) continue
    for (const node of Object.values(otherVc.tree.nodes)) {
      if (
        node.moduleId === 'base.visual-component-ref' &&
        node.props.componentId === vcId
      ) {
        usages.push({
          source: {
            kind: 'visualComponent',
            vcId: otherVc.id,
            vcName: otherVc.name,
            nodeId: node.id,
            nodeLabel: node.label ?? node.moduleId,
          },
        })
      }
    }
  }

  if (usages.length === 0) return null

  const pageIds = new Set<string>()
  const vcIds = new Set<string>()
  for (const usage of usages) {
    if (usage.source.kind === 'page') pageIds.add(usage.source.pageId)
    else vcIds.add(usage.source.vcId)
  }

  return {
    vc: { id: vcId, name: vc.name },
    usages,
    pageCount: pageIds.size,
    vcCount: vcIds.size,
  }
}
