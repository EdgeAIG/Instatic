/**
 * slotEditPropagation.test.ts — verifies the end-to-end editing flow for slot
 * content on a page consuming a Visual Component.
 *
 * User-facing scenario being gated:
 *   1. User authors a VC with a `base.slot-outlet` in its tree.
 *   2. User drops the VC ref on a page (via `insertComponentRef`) — sync
 *      materializes a `base.slot-instance` child under the ref.
 *   3. User inserts a `base.text` node into the slot-instance — this is the
 *      content the consumer sees inside the VC's layout.
 *   4. User edits the text node's `props.text` via the Properties panel
 *      (`updateNodeProps`).
 *   5. Calling `instantiateVCAtRef` immediately after the edit must produce a
 *      flat node map whose text-node entry carries the NEW text — that's what
 *      the inlined canvas render reads from.
 *
 * If this test ever fails, the canvas preview is genuinely stale: the
 * mutation isn't propagating through the page tree → instantiateVCAtRef →
 * VCInlineTree pipeline.
 */
import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'
import { instantiateVCAtRef } from '@core/visualComponents/instantiate'
import type { BaseNode } from '@core/page-tree/baseNode'
import { makeSite, makePage, makeNode } from '../fixtures'
import '../../modules/base/index'

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

describe('slot edit propagation — page mode', () => {
  beforeEach(freshStore)

  it('updateNodeProps on a text inside a slot-instance reflects in instantiateVCAtRef output', () => {
    // 1. Set up a page with a VC that has a slot-outlet.
    const slotOutletId = 'outlet-1'
    const vcRootId = 'vc-root'
    const vc = {
      id: 'vc-1',
      name: 'HeroSection',
      tree: {
        rootNodeId: vcRootId,
        nodes: {
          [vcRootId]: {
            id: vcRootId,
            moduleId: 'base.body',
            props: {},
            children: [slotOutletId],
            breakpointOverrides: {},
            classIds: [],
          } as BaseNode,
          [slotOutletId]: {
            id: slotOutletId,
            moduleId: 'base.slot-outlet',
            props: { slotName: 'children' },
            children: [],
            breakpointOverrides: {},
            classIds: [],
          } as BaseNode,
        },
      },
      params: [],
      breakpoints: [],
      classIds: [],
      createdAt: 0,
    }

    const page = makePage({
      id: 'p1',
      slug: 'home',
      title: 'Home',
      rootNodeId: 'root',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: [] }),
      },
    })
    const site = makeSite({ pages: [page], visualComponents: [vc] })

    useEditorStore.setState({
      site,
      activePageId: 'p1',
      activeDocument: null,
    } as Parameters<typeof useEditorStore.setState>[0])

    // 2. Drop the VC ref on the page — sync auto-materializes the slot-instance.
    const refId = useEditorStore
      .getState()
      .insertComponentRef('root', 'vc-1')!
    expect(refId).toBeTruthy()

    const refNode = useEditorStore.getState().site!.pages[0].nodes[refId]
    expect(refNode.children).toHaveLength(1)
    const slotInstId = refNode.children[0]
    const slotInst = useEditorStore.getState().site!.pages[0].nodes[slotInstId]
    expect(slotInst.moduleId).toBe('base.slot-instance')
    expect(slotInst.props.slotName).toBe('children')

    // 3. Insert a base.text into the slot-instance.
    const textId = useEditorStore.getState().insertNode(
      'base.text',
      { text: 'Initial text' },
      slotInstId,
    )
    expect(textId).toBeTruthy()

    const slotInstAfterInsert = useEditorStore.getState().site!.pages[0].nodes[slotInstId]
    expect(slotInstAfterInsert.children).toContain(textId)

    // 4. Verify that instantiateVCAtRef produces an output containing the
    //    text node with the INITIAL text.
    let pageNodes = useEditorStore.getState().site!.pages[0].nodes as Record<
      string,
      BaseNode
    >
    let result = instantiateVCAtRef(
      vc,
      {},
      { children: [textId] },
      pageNodes,
      refId,
    )
    expect(result.nodes[textId]).toBeDefined()
    expect(result.nodes[textId].props.text).toBe('Initial text')

    // 5. Edit the text via updateNodeProps.
    useEditorStore.getState().updateNodeProps(textId, { text: 'Edited text' })

    // 6. The page tree must now hold the new text.
    const textAfterEdit = useEditorStore.getState().site!.pages[0].nodes[textId]
    expect(textAfterEdit.props.text).toBe('Edited text')

    // 7. Re-call instantiateVCAtRef — the inlined output must reflect the edit.
    pageNodes = useEditorStore.getState().site!.pages[0].nodes as Record<
      string,
      BaseNode
    >
    // Read the latest VC after sync side-effects.
    const vcLatest = useEditorStore.getState().site!.visualComponents.find(
      (v) => v.id === 'vc-1',
    )!
    result = instantiateVCAtRef(
      vcLatest,
      {},
      { children: [textId] },
      pageNodes,
      refId,
    )
    expect(result.nodes[textId]).toBeDefined()
    expect(result.nodes[textId].props.text).toBe('Edited text')
  })
})
