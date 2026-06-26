import { beforeEach, describe, expect, it } from 'bun:test'
import { selectRightSidebarExpanded, useEditorStore } from '@site/store/store'
import '@modules/base/index'

function freshStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    hoveredBreakpointId: null,
    activeInlineEdit: null,
    activeClassId: null,
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(freshStore)

describe('page actions selection state', () => {
  it('clears stale node selection when creating and opening a new page', () => {
    const site = useEditorStore.getState().createSite('Page selection site')
    const sourcePage = site.pages[0]
    const selectedNodeId = useEditorStore
      .getState()
      .insertNode('base.text', { text: 'Old page node' }, sourcePage.rootNodeId)
    useEditorStore.getState().selectNode(selectedNodeId)
    useEditorStore.setState({
      hoveredNodeId: selectedNodeId,
      hoveredBreakpointId: 'desktop',
      activeInlineEdit: { nodeId: selectedNodeId, prop: 'text' },
      activeClassId: 'stale-class-id',
    } as Parameters<typeof useEditorStore.setState>[0])

    expect(selectRightSidebarExpanded(useEditorStore.getState())).toBe(true)

    const nextPage = useEditorStore.getState().addPage('Fresh page', 'fresh-page')

    const state = useEditorStore.getState()
    expect(state.activePageId).toBe(nextPage.id)
    expect(state.selectedNodeId).toBeNull()
    expect(state.selectedNodeIds).toEqual([])
    expect(state.hoveredNodeId).toBeNull()
    expect(state.hoveredBreakpointId).toBeNull()
    expect(state.activeInlineEdit).toBeNull()
    expect(state.activeClassId).toBeNull()
    expect(selectRightSidebarExpanded(state)).toBe(false)
  })
})
