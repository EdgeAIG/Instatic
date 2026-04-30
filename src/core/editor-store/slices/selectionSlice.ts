import type { StateCreator } from 'zustand'
import type { EditorStore } from '../store'
import { isUserVisibleClass } from '../../page-tree/classUtils'
import type { PageNode } from '../../page-tree/types'

export interface SelectionSlice {
  /** Currently selected node ID — null if nothing is selected */
  selectedNodeId: string | null
  /** Hovered node ID — null if no hover */
  hoveredNodeId: string | null

  selectNode: (id: string | null) => void
  hoverNode: (id: string | null) => void
  clearSelection: () => void
}

export const createSelectionSlice: StateCreator<EditorStore, [], [], SelectionSlice> = (set, get) => ({
  selectedNodeId: null,
  hoveredNodeId: null,

  selectNode: (id) => {
    const current = get()
    const shouldCollapseProperties = !id
    const selectedChanged = !Object.is(current.selectedNodeId, id)
    const panelChanged = !Object.is(current.propertiesPanel.collapsed, shouldCollapseProperties)
    const nextActiveClassId = getSelectionActiveClassId(current, id)
    const activeClassChanged = !Object.is(current.activeClassId, nextActiveClassId)

    if (!selectedChanged && !panelChanged && !activeClassChanged) return

    set((state) => ({
      selectedNodeId: id,
      activeClassId: nextActiveClassId,
      propertiesPanel: panelChanged
        ? { ...state.propertiesPanel, collapsed: shouldCollapseProperties }
        : state.propertiesPanel,
    }))
  },
  hoverNode: (id) => set({ hoveredNodeId: id }),
  clearSelection: () => set({ selectedNodeId: null, hoveredNodeId: null, activeClassId: null }),
})

function getSelectionActiveClassId(state: EditorStore, nodeId: string | null): string | null {
  if (!nodeId) return null

  const node = findSelectableNode(state, nodeId)
  if (!node?.classIds?.length || !state.project) return null

  const visibleClassIds = node.classIds.filter((classId) => {
    const cls = state.project?.classes[classId]
    return cls && isUserVisibleClass(cls)
  })

  if (visibleClassIds.length === 0) return null
  if (state.activeClassId && visibleClassIds.includes(state.activeClassId)) {
    return state.activeClassId
  }
  return visibleClassIds[0]
}

function findSelectableNode(state: EditorStore, nodeId: string): PageNode | null {
  if (!state.project) return null

  const activeDocument = state.activeDocument
  if (activeDocument?.kind === 'visualComponent') {
    const component = state.project.visualComponents?.find((vc) => vc.id === activeDocument.vcId)
    const node = component ? findNodeInTree(component.rootNode as PageNode, nodeId) : null
    if (node) return node
  }

  for (const page of state.project.pages) {
    const node = page.nodes[nodeId]
    if (node) return node
  }

  return null
}

function findNodeInTree(node: PageNode, nodeId: string): PageNode | null {
  if (node.id === nodeId) return node

  for (const child of node.childNodes ?? []) {
    const match = findNodeInTree(child, nodeId)
    if (match) return match
  }

  return null
}
