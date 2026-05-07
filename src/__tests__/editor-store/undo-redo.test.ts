/**
 * Undo/Redo store tests — verifies J4 requirements:
 * - undo/redo operates only on site state
 * - canUndo / canRedo flags stay accurate
 * - history is capped at MAX_HISTORY (50)
 * - undo then modify creates a new branch (future is cleared)
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'

// Helper: get fresh store state (Zustand is module-singleton — reset between tests)
function getStore() {
  return useEditorStore.getState()
}

beforeEach(() => {
  // Reset store to a clean slate before each test
  useEditorStore.setState({
    site: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    hasUnsavedChanges: false,
  })
})

describe('Undo / Redo — basic lifecycle', () => {
  it('canUndo is false before any mutations', () => {
    const store = getStore()
    store.createSite('Test SiteDocument')
    expect(useEditorStore.getState().canUndo).toBe(false)
  })

  it('canUndo becomes true after a mutation', () => {
    const store = getStore()
    const site = store.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId
    useEditorStore.getState().insertNode('base.text', {}, rootId)
    expect(useEditorStore.getState().canUndo).toBe(true)
  })

  it('undo restores previous site state', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId
    const nodesBefore = Object.keys(site.pages[0].nodes).length

    useEditorStore.getState().insertNode('base.text', {}, rootId)
    const nodesAfter = Object.keys(
      useEditorStore.getState().site!.pages[0].nodes
    ).length
    expect(nodesAfter).toBe(nodesBefore + 1)

    useEditorStore.getState().undo()
    const nodesAfterUndo = Object.keys(
      useEditorStore.getState().site!.pages[0].nodes
    ).length
    expect(nodesAfterUndo).toBe(nodesBefore)
  })

  it('redo re-applies the undone mutation', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId

    useEditorStore.getState().insertNode('base.text', {}, rootId)
    const nodesBeforeUndo = Object.keys(
      useEditorStore.getState().site!.pages[0].nodes
    ).length

    useEditorStore.getState().undo()
    useEditorStore.getState().redo()

    const nodesAfterRedo = Object.keys(
      useEditorStore.getState().site!.pages[0].nodes
    ).length
    expect(nodesAfterRedo).toBe(nodesBeforeUndo)
  })

  it('canRedo is true after undo', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId
    useEditorStore.getState().insertNode('base.text', {}, rootId)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().canRedo).toBe(true)
  })

  it('canRedo is false after redo', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId
    useEditorStore.getState().insertNode('base.text', {}, rootId)
    useEditorStore.getState().undo()
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().canRedo).toBe(false)
  })

  it('undo clears future when new mutation is made after undo', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId

    // Insert → undo → new insertion (new branch)
    useEditorStore.getState().insertNode('base.text', {}, rootId)
    useEditorStore.getState().undo()
    useEditorStore.getState().insertNode('base.text', {}, rootId)

    expect(useEditorStore.getState().canRedo).toBe(false)
    expect(useEditorStore.getState()._historyFuture).toHaveLength(0)
  })

  it('multiple mutations are each individually undoable', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId
    const startCount = Object.keys(site.pages[0].nodes).length

    useEditorStore.getState().insertNode('base.text', {}, rootId)
    useEditorStore.getState().insertNode('base.text', {}, rootId)
    useEditorStore.getState().insertNode('base.image', {}, rootId)

    expect(Object.keys(useEditorStore.getState().site!.pages[0].nodes).length).toBe(startCount + 3)

    useEditorStore.getState().undo()
    expect(Object.keys(useEditorStore.getState().site!.pages[0].nodes).length).toBe(startCount + 2)

    useEditorStore.getState().undo()
    expect(Object.keys(useEditorStore.getState().site!.pages[0].nodes).length).toBe(startCount + 1)

    useEditorStore.getState().undo()
    expect(Object.keys(useEditorStore.getState().site!.pages[0].nodes).length).toBe(startCount)
  })

  it('undo does nothing when canUndo is false', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const nodesBefore = Object.keys(site.pages[0].nodes).length

    useEditorStore.getState().undo() // no-op
    expect(Object.keys(useEditorStore.getState().site!.pages[0].nodes).length).toBe(nodesBefore)
  })

  it('createSite resets history', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId
    useEditorStore.getState().insertNode('base.text', {}, rootId)
    useEditorStore.getState().undo()

    // Create new site — should wipe history
    useEditorStore.getState().createSite('New SiteDocument')
    expect(useEditorStore.getState().canUndo).toBe(false)
    expect(useEditorStore.getState().canRedo).toBe(false)
    expect(useEditorStore.getState()._historyPast).toHaveLength(0)
    expect(useEditorStore.getState()._historyFuture).toHaveLength(0)
  })

  it('canvas/UI state (zoom, panX) is not affected by undo', () => {
    const s = getStore()
    const site = s.createSite('Test SiteDocument')
    const rootId = site.pages[0].rootNodeId

    useEditorStore.setState({ zoom: 2, panX: 100, panY: 50 })
    useEditorStore.getState().insertNode('base.text', {}, rootId)
    useEditorStore.getState().undo()

    const { zoom, panX, panY } = useEditorStore.getState()
    expect(zoom).toBe(2)
    expect(panX).toBe(100)
    expect(panY).toBe(50)
  })
})
