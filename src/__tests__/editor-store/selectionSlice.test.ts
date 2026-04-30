import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '../../core/editor-store/store'

function freshStore() {
  useEditorStore.setState({
    project: null,
    activePageId: null,
    selectedNodeId: null,
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
    const project = store.createProject('Selection Test')
    const rootId = project.pages[0].rootNodeId
    const nodeId = useEditorStore.getState().insertNode('base.text', {}, rootId)
    const cls = useEditorStore.getState().createClass('hero-title')
    useEditorStore.getState().addNodeClass(nodeId, cls.id)

    useEditorStore.getState().selectNode(nodeId)

    expect(useEditorStore.getState().activeClassId).toBe(cls.id)
  })
})
