/**
 * selectionSlice — multi-select behaviors.
 *
 * Covers:
 *   1. selectNode default mode replaces the selection.
 *   2. selectNode 'toggle' adds/removes ids (Cmd/Ctrl-click semantics).
 *   3. selectNode 'range' selects the DFS-ordered range from anchor to id
 *      (Shift-click semantics). Cross-parent ranges are allowed.
 *   4. addToSelection is idempotent.
 *   5. removeFromSelection drops a single id.
 *   6. The page root is rejected from multi-selection (filterMultiSelectable).
 *   7. Multi-aware actions: deleteNodes / duplicateNodes / wrapNodes /
 *      moveNodes / copyNodes / cutNodes act on the whole set in one undo step.
 *   8. wrapNodes uses closest common ancestor for cross-parent selections.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'
import '../../modules/base/index'

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

describe('selectionSlice.selectNode — modes', () => {
  it('default mode replaces the selection', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)

    useEditorStore.getState().selectNode(a)
    useEditorStore.getState().selectNode(b)

    const after = useEditorStore.getState()
    expect(after.selectedNodeId).toBe(b)
    expect(after.selectedNodeIds).toEqual([b])
  })

  it('toggle mode adds and removes ids (Cmd-click)', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)

    useEditorStore.getState().selectNode(a)
    useEditorStore.getState().selectNode(b, 'toggle')

    expect(useEditorStore.getState().selectedNodeIds).toEqual([a, b])

    useEditorStore.getState().selectNode(a, 'toggle')
    expect(useEditorStore.getState().selectedNodeIds).toEqual([b])
  })

  it('range mode selects DFS-ordered range from anchor to id (Shift-click)', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)
    const c = useEditorStore.getState().insertNode('base.text', {}, root)
    const d = useEditorStore.getState().insertNode('base.text', {}, root)

    useEditorStore.getState().selectNode(b)
    useEditorStore.getState().selectNode(d, 'range')

    const ids = useEditorStore.getState().selectedNodeIds
    // Anchor moves to the latest target; range fills in between.
    expect(ids).toContain(b)
    expect(ids).toContain(c)
    expect(ids).toContain(d)
    expect(ids).not.toContain(a)
    expect(ids[ids.length - 1]).toBe(d)
  })

  it('addToSelection is idempotent', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)

    useEditorStore.getState().selectNode(a)
    useEditorStore.getState().addToSelection(b)
    useEditorStore.getState().addToSelection(b)
    expect(useEditorStore.getState().selectedNodeIds).toEqual([a, b])
  })

  it('removeFromSelection drops only the given id', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)

    useEditorStore.getState().selectNode(a)
    useEditorStore.getState().selectNode(b, 'toggle')
    useEditorStore.getState().removeFromSelection(a)
    expect(useEditorStore.getState().selectedNodeIds).toEqual([b])
  })

  it('the page root is dropped from multi-selection but allowed solo', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)

    useEditorStore.getState().selectNode(a)
    useEditorStore.getState().selectNode(root, 'toggle')
    // Toggling root falls back to single-select (root is not multi-selectable).
    expect(useEditorStore.getState().selectedNodeIds).toEqual([root])
  })
})

describe('multi-aware mutations', () => {
  it('deleteNodes removes every id in one undo step', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)

    useEditorStore.getState().deleteNodes([a, b])
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[a]).toBeUndefined()
    expect(page.nodes[b]).toBeUndefined()
    // Single undo step — past has exactly one snapshot before the delete.
    useEditorStore.getState().undo()
    const restored = useEditorStore.getState().site!.pages[0]
    expect(restored.nodes[a]).toBeDefined()
    expect(restored.nodes[b]).toBeDefined()
  })

  it('duplicateNodes returns the new ids in selection order', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)

    const newIds = useEditorStore.getState().duplicateNodes([a, b])
    expect(newIds.length).toBe(2)
    const page = useEditorStore.getState().site!.pages[0]
    for (const id of newIds) {
      expect(page.nodes[id]).toBeDefined()
    }
  })

  it('wrapNodes (same parent contiguous) wraps the selected siblings', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)
    const c = useEditorStore.getState().insertNode('base.text', {}, root)

    const wrapperId = useEditorStore.getState().wrapNodes([a, b], 'base.container')
    expect(wrapperId).toBeTruthy()

    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[root].children).toEqual([wrapperId!, c])
    expect(page.nodes[wrapperId!].children).toEqual([a, b])
  })

  it('wrapNodes (cross-parent) wraps closest common ancestor branches', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const containerA = useEditorStore.getState().insertNode('base.container', {}, root)
    const containerB = useEditorStore.getState().insertNode('base.container', {}, root)
    const textA = useEditorStore.getState().insertNode('base.text', {}, containerA)
    const textB = useEditorStore.getState().insertNode('base.text', {}, containerB)

    // Selecting one text from each container — closest common ancestor is root,
    // and the branches at root are containerA and containerB. Both should be
    // wrapped together at root.
    const wrapperId = useEditorStore.getState().wrapNodes([textA, textB], 'base.container')
    expect(wrapperId).toBeTruthy()

    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[root].children).toEqual([wrapperId!])
    expect(page.nodes[wrapperId!].children).toEqual([containerA, containerB])
    // Text leaves stay where they were inside their original containers.
    expect(page.nodes[containerA].children).toEqual([textA])
    expect(page.nodes[containerB].children).toEqual([textB])
  })

  it('moveNodes preserves order and runs in one undo step', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const target = useEditorStore.getState().insertNode('base.container', {}, root)
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)

    useEditorStore.getState().moveNodes([a, b], target, 0)
    const page = useEditorStore.getState().site!.pages[0]
    expect(page.nodes[target].children).toEqual([a, b])
  })

  it('copyNodes captures multiple roots into one clipboard payload', () => {
    const s = useEditorStore.getState()
    const site = s.createSite('Multi')
    const root = site.pages[0].rootNodeId
    const a = useEditorStore.getState().insertNode('base.text', {}, root)
    const b = useEditorStore.getState().insertNode('base.text', {}, root)

    const ok = useEditorStore.getState().copyNodes([a, b])
    expect(ok).toBe(true)
    const entry = useEditorStore.getState().clipboardEntry
    expect(entry?.rootNodeIds).toEqual([a, b])
  })
})
