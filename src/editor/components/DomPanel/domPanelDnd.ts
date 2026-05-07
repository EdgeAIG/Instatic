import type { Page } from '@core/page-tree/schemas'
import { getParent, isAncestor } from '@core/page-tree/selectors'

type DomDropPosition = 'before' | 'after' | 'inside'
type DomDropZone = DomDropPosition

export interface DomDropTarget {
  /** The pivot drag id (the row the user grabbed). Used for visual feedback. */
  draggedId: string
  /** Every dragged id when this is a multi-drag — `[draggedId]` for single. */
  draggedIds: string[]
  parentId: string
  index: number
  position: DomDropPosition
  slot: 'default'
  overId: string
}

interface DomDropRowRect {
  top: number
  bottom: number
  height: number
}

export interface DomDropRowMeta {
  nodeId: string
  rect: DomDropRowRect
}

interface ResolveDomDropTargetInput {
  page: Page
  /** The pivot id (the row the user grabbed). */
  draggedId: string
  /**
   * All ids being dragged. Optional — defaults to `[draggedId]` for
   * single-drag callers. Cycle and no-op checks consider every id in this
   * list; index normalization is computed against the pivot only.
   */
  draggedIds?: string[]
  overId: string
  zone: DomDropZone
  canHaveChildren: (moduleId: string) => boolean
}

const MIN_EDGE_HIT_ZONE = 8
const MAX_EDGE_HIT_ZONE = 12
const EDGE_ZONE_RATIO = 0.3

export function getDomDropZone(rect: DomDropRowRect, pointerY: number): DomDropZone {
  const edgeBand = Math.max(
    MIN_EDGE_HIT_ZONE,
    Math.min(MAX_EDGE_HIT_ZONE, rect.height * EDGE_ZONE_RATIO),
  )
  const offset = pointerY - rect.top

  if (offset <= edgeBand) return 'before'
  if (offset >= rect.height - edgeBand) return 'after'
  return 'inside'
}

export function findDomDropRow(rows: DomDropRowMeta[], pointerY: number): DomDropRowMeta | null {
  for (const row of rows) {
    if (pointerY >= row.rect.top && pointerY <= row.rect.bottom) return row
  }
  return null
}

export function resolveDomDropTarget({
  page,
  draggedId,
  draggedIds: draggedIdsInput,
  overId,
  zone,
  canHaveChildren,
}: ResolveDomDropTargetInput): DomDropTarget | null {
  const dragged = page.nodes[draggedId]
  const over = page.nodes[overId]
  if (!dragged || !over) return null

  // Default to single-drag semantics when no multi list is supplied.
  const draggedIds = draggedIdsInput ?? [draggedId]

  // Multi-drag rejections: every dragged id must be a real, non-root,
  // non-locked node. (The slot-instance lockdown for the OVER side is
  // checked below — locked nodes simply cannot move themselves.)
  for (const id of draggedIds) {
    if (id === page.rootNodeId) return null
    const node = page.nodes[id]
    if (!node) return null
    if (node.locked) return null
  }

  // Drop target must not be one of the dragged ids.
  if (draggedIds.includes(overId)) return null

  if (zone === 'inside') {
    if (!canHaveChildren(over.moduleId)) return null

    // ─── slot-instance structural lock-down — Task 5 ──────────────────────
    // slot-instance nodes are locked (preventing reorder/detach), but their
    // children are fully editable. Allow drops inside a locked slot-instance;
    // reject drops inside all other locked nodes.
    if (over.locked && over.moduleId !== 'base.slot-instance') return null

    // Direct children of a VC ref are exclusively managed by syncSlotInstances.
    // The only valid entry point into VC ref content is *inside* one of its
    // slot-instance children — not directly inside the VC ref itself.
    if (over.moduleId === 'base.visual-component-ref') return null
    // ─────────────────────────────────────────────────────────────────────────

    // Cycle: no dragged id may be an ancestor of the new parent.
    for (const id of draggedIds) {
      if (isAncestor(page, id, overId)) return null
    }

    const index = normalizeIndexAfterRemoval(page, draggedId, overId, over.children.length)
    return noOpTarget(page, draggedId, overId, index)
      ? null
      : {
          draggedId,
          draggedIds,
          parentId: overId,
          index,
          position: 'inside',
          slot: 'default',
          overId,
        }
  }

  if (overId === page.rootNodeId) return null
  const parent = getParent(page, overId)
  if (!parent) return null
  if (parent.locked) return null

  // ─── slot-instance structural lock-down — Task 5 ────────────────────────
  // Direct children of a VC ref are slot-instances managed by syncSlotInstances.
  // No external node may be inserted as a sibling of slot-instance nodes — the
  // only valid way to place content is *inside* a slot-instance.
  if (parent.moduleId === 'base.visual-component-ref') return null
  // ─────────────────────────────────────────────────────────────────────────

  // Cycle (multi): no dragged id may be an ancestor of the new sibling-parent.
  for (const id of draggedIds) {
    if (isAncestor(page, id, parent.id)) return null
  }

  const overIndex = parent.children.indexOf(overId)
  if (overIndex === -1) return null

  const rawIndex = zone === 'before' ? overIndex : overIndex + 1
  const index = normalizeIndexAfterRemoval(page, draggedId, parent.id, rawIndex)

  return noOpTarget(page, draggedId, parent.id, index)
    ? null
    : {
        draggedId,
        draggedIds,
        parentId: parent.id,
        index,
        position: zone,
        slot: 'default',
        overId,
      }
}

function normalizeIndexAfterRemoval(
  page: Page,
  draggedId: string,
  parentId: string,
  rawIndex: number,
): number {
  const currentParent = getParent(page, draggedId)
  if (!currentParent || currentParent.id !== parentId) return rawIndex

  const currentIndex = currentParent.children.indexOf(draggedId)
  if (currentIndex === -1 || currentIndex >= rawIndex) return rawIndex
  return rawIndex - 1
}

function noOpTarget(page: Page, draggedId: string, parentId: string, index: number): boolean {
  const currentParent = getParent(page, draggedId)
  if (!currentParent || currentParent.id !== parentId) return false
  return currentParent.children.indexOf(draggedId) === index
}
