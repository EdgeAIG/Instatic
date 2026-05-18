/**
 * vcDeletionCascade.test.ts — verifies F-0010 fix:
 *
 *  1. deleteVisualComponent removes the VC and every base.visual-component-ref
 *     subtree (ref + slot-instances + user content) from all pages AND from
 *     other VC trees.
 *  2. No orphan children[] IDs remain after deletion.
 *  3. The deletion is undoable (pushHistory was called → Cmd-Z restores everything).
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '@site/store/store'
import { makeSite, makePage, makeNode, makeVC, makeVCNode } from '../fixtures'

const TARGET_VC_ID = 'vc-target'
const OTHER_VC_ID = 'vc-other'

function freshStore() {
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    propertiesPanel: { collapsed: true, x: 0, y: 0, width: 360 },
    packageJson: {},
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

/**
 * Build a page with two ref nodes pointing at TARGET_VC_ID.
 * Each ref has one slot-instance child (simulating the slot materialisation)
 * and the slot-instance has a text child (user content).
 */
function buildPageWithRefs(pageId: string) {
  const rootId = 'root'
  const ref1Id = 'ref1'
  const slot1Id = 'slot1'
  const text1Id = 'text1'
  const ref2Id = 'ref2'
  const slot2Id = 'slot2'

  return makePage({
    id: pageId,
    title: `Page ${pageId}`,
    rootNodeId: rootId,
    nodes: {
      [rootId]: makeNode({ id: rootId, moduleId: 'base.body', children: [ref1Id, ref2Id] }),
      [ref1Id]: makeNode({
        id: ref1Id,
        moduleId: 'base.visual-component-ref',
        props: { componentId: TARGET_VC_ID },
        children: [slot1Id],
      }),
      [slot1Id]: makeNode({
        id: slot1Id,
        moduleId: 'base.slot-instance',
        children: [text1Id],
      }),
      [text1Id]: makeNode({ id: text1Id, moduleId: 'base.text' }),
      [ref2Id]: makeNode({
        id: ref2Id,
        moduleId: 'base.visual-component-ref',
        props: { componentId: TARGET_VC_ID },
        children: [slot2Id],
      }),
      [slot2Id]: makeNode({
        id: slot2Id,
        moduleId: 'base.slot-instance',
        children: [],
      }),
    },
  })
}

describe('deleteVisualComponent — cascade deletion', () => {
  beforeEach(freshStore)

  it('removes the VC from site.visualComponents', () => {
    const targetVc = makeVC({ id: TARGET_VC_ID, name: 'Target' })
    const site = makeSite({ pages: [buildPageWithRefs('p1')], visualComponents: [targetVc] })
    useEditorStore.getState().loadSite(site)

    useEditorStore.getState().deleteVisualComponent(TARGET_VC_ID)

    const vcs = useEditorStore.getState().site!.visualComponents
    expect(vcs.find((v) => v.id === TARGET_VC_ID)).toBeUndefined()
  })

  it('removes all ref subtrees from every page (ref + slot-instances + user content)', () => {
    const targetVc = makeVC({ id: TARGET_VC_ID, name: 'Target' })
    const page1 = buildPageWithRefs('p1')
    const page2 = buildPageWithRefs('p2')
    const site = makeSite({ pages: [page1, page2], visualComponents: [targetVc] })
    useEditorStore.getState().loadSite(site)

    useEditorStore.getState().deleteVisualComponent(TARGET_VC_ID)

    const state = useEditorStore.getState().site!
    for (const page of state.pages) {
      for (const [, node] of Object.entries(page.nodes)) {
        // No ref to the deleted VC remains
        if (node.moduleId === 'base.visual-component-ref') {
          expect(node.props.componentId).not.toBe(TARGET_VC_ID)
        }
        // ref1, slot1, text1, ref2, slot2 should all be gone
      }
      expect(page.nodes['ref1']).toBeUndefined()
      expect(page.nodes['slot1']).toBeUndefined()
      expect(page.nodes['text1']).toBeUndefined()
      expect(page.nodes['ref2']).toBeUndefined()
      expect(page.nodes['slot2']).toBeUndefined()
    }
  })

  it('splices refs out of parent children[] — no orphan IDs in children[]', () => {
    const targetVc = makeVC({ id: TARGET_VC_ID, name: 'Target' })
    const site = makeSite({ pages: [buildPageWithRefs('p1')], visualComponents: [targetVc] })
    useEditorStore.getState().loadSite(site)

    useEditorStore.getState().deleteVisualComponent(TARGET_VC_ID)

    const page = useEditorStore.getState().site!.pages[0]
    const allNodeIds = new Set(Object.keys(page.nodes))

    for (const node of Object.values(page.nodes)) {
      for (const childId of node.children) {
        expect(allNodeIds.has(childId)).toBe(true)
      }
    }
    // Root should have no children (both refs were removed)
    expect(page.nodes['root'].children).toHaveLength(0)
  })

  it('removes refs inside other VC trees', () => {
    const targetVc = makeVC({ id: TARGET_VC_ID, name: 'Target' })

    // OTHER_VC has a ref to TARGET_VC in its tree
    const otherRoot = makeVCNode({ id: 'other-root', moduleId: 'base.body', children: ['vc-ref'] })
    const vcRef = makeVCNode({
      id: 'vc-ref',
      moduleId: 'base.visual-component-ref',
      props: { componentId: TARGET_VC_ID },
    })
    const otherVc = makeVC({
      id: OTHER_VC_ID,
      name: 'Other',
      tree: { nodes: { 'other-root': otherRoot, 'vc-ref': vcRef }, rootNodeId: 'other-root' },
    })

    const site = makeSite({ visualComponents: [targetVc, otherVc] })
    useEditorStore.getState().loadSite(site)

    useEditorStore.getState().deleteVisualComponent(TARGET_VC_ID)

    const remainingVc = useEditorStore.getState().site!.visualComponents.find((v) => v.id === OTHER_VC_ID)
    expect(remainingVc).toBeDefined()
    expect(remainingVc!.tree.nodes['vc-ref']).toBeUndefined()
    expect(remainingVc!.tree.nodes['other-root'].children).toHaveLength(0)
  })

  it('is undoable — Cmd-Z restores the VC and all ref subtrees', () => {
    const targetVc = makeVC({ id: TARGET_VC_ID, name: 'Target' })
    const page = buildPageWithRefs('p1')
    const site = makeSite({ pages: [page], visualComponents: [targetVc] })
    useEditorStore.getState().loadSite(site)

    const nodeCountBefore = Object.keys(useEditorStore.getState().site!.pages[0].nodes).length
    const vcCountBefore = useEditorStore.getState().site!.visualComponents.length

    useEditorStore.getState().deleteVisualComponent(TARGET_VC_ID)

    // canUndo should be true after the deletion
    expect(useEditorStore.getState().canUndo).toBe(true)

    useEditorStore.getState().undo()

    const restoredSite = useEditorStore.getState().site!
    expect(restoredSite.visualComponents).toHaveLength(vcCountBefore)
    expect(restoredSite.visualComponents.find((v) => v.id === TARGET_VC_ID)).toBeDefined()
    expect(Object.keys(restoredSite.pages[0].nodes)).toHaveLength(nodeCountBefore)
  })

  it('is a no-op when the VC does not exist', () => {
    const site = makeSite({ visualComponents: [] })
    useEditorStore.getState().loadSite(site)

    // Should not throw and canUndo should be true (pushHistory ran)
    useEditorStore.getState().deleteVisualComponent('nonexistent')
    // site unchanged
    expect(useEditorStore.getState().site!.visualComponents).toHaveLength(0)
  })
})
