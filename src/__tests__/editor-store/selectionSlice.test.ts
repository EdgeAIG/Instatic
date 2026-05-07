import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'

function freshStore() {
  useEditorStore.setState({
    site: null,
    activePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeClassId: null,
    previewClassAssignment: null,
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 280 },
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(freshStore)

describe('selectionSlice.selectNode', () => {
  it('activates the first assigned class when selecting a node with classes', () => {
    const store = useEditorStore.getState()
    const site = store.createSite('Selection Test')
    const rootId = site.pages[0].rootNodeId
    const nodeId = useEditorStore.getState().insertNode('base.text', {}, rootId)
    const cls = useEditorStore.getState().createClass('hero-title')
    useEditorStore.getState().addNodeClass(nodeId, cls.id)

    useEditorStore.getState().selectNode(nodeId)

    expect(useEditorStore.getState().activeClassId).toBe(cls.id)
  })
})
