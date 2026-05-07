/**
 * componentSystem.smoke.test.ts — End-to-end smoke test for the Component System.
 *
 * Priority 6 of the cleanup pass.
 *
 * Exercises the FULL Component System code paths through editor store + selectors +
 * publisher boundaries. NOT actual UI clicks — we drive the store directly, the same
 * way convertNodeToComponent.test.ts does.
 *
 * Flow under test (ordered):
 *   1.  Setup: page with Container + 2 child nodes.
 *   2.  Default state: activeDocument is null, activePageId is set.
 *   3.  Select the Container node via selectNode().
 *   4.  Convert to VC with activeDocument === null (the bug-regression case).
 *       Assert: VC exists, subtree cloned, original replaced with ref, activeDocument
 *       switches to the new VC.
 *   5.  Exit VC editing back to page via exitVisualComponentMode().
 *   6.  Re-place the VC on the page via insertComponentRef().
 *       Assert: second ref exists on the page tree.
 *   7.  Selection boundary — clicking inside VC body routes to the ref node:
 *       instantiate the VC, build the combined node map, call
 *       findEnclosingComponentRef() and verify it returns the ref id
 *       (isInsideSlotContent: false).
 *   8.  Selection boundary — clicking slot-content routes to the node itself:
 *       add a slot-outlet to the VC, instantiate with slot content, call
 *       findEnclosingComponentRef() and verify isInsideSlotContent: true.
 *
 * Spec ambiguities resolved by reading source — see bottom of file.
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore, selectActiveCanvasPage, selectSelectedNode } from '@core/editor-store/store'
import { produce } from 'immer'
import type { PageNode } from '@core/page-tree/schemas'
import type { VCNode } from '@core/visualComponents/schemas'
import { instantiateVCAtRef } from '@core/visualComponents/instantiate'
import {
  findEnclosingComponentRef,
  type AnnotatedPageNode,
} from '@editor/components/Canvas/canvasSelectionUtils'

// ---------------------------------------------------------------------------
// Helpers — mirror the style from convertNodeToComponent.test.ts
// ---------------------------------------------------------------------------

function freshStore() {
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
    activeDocument: null,
    activePageId: null,
  })
  return useEditorStore.getState()
}

function getSite() {
  return useEditorStore.getState().site!
}

function getPage() {
  const { activePageId } = useEditorStore.getState()
  return getSite().pages.find((p) => p.id === activePageId)!
}

/** Call any named action on the store */
function callAction<T>(name: string, ...args: unknown[]): T {
  const s = useEditorStore.getState() as Record<string, unknown>
  return (s[name] as (...a: unknown[]) => T)(...args)
}

/** Build a minimal PageNode for direct store injection. */
function makePageNode(
  id: string,
  moduleId: string,
  children: string[] = [],
): PageNode {
  return {
    id,
    moduleId,
    props: {},
    breakpointOverrides: {},
    children,
    classIds: [],
  }
}

/**
 * Inject nodes into the active page's nodes map and attach rootContainerId as a
 * child of the existing page root — same pattern as convertNodeToComponent.test.ts.
 */
function injectNodesIntoPage(rootContainerId: string, extraNodes: PageNode[]): void {
  const state = useEditorStore.getState()
  const pageId = state.activePageId!
  useEditorStore.setState(
    produce(state, (draft) => {
      const page = draft.site!.pages.find((p) => p.id === pageId)!
      const pageRoot = page.nodes[page.rootNodeId]
      if (!pageRoot.children.includes(rootContainerId)) {
        pageRoot.children.push(rootContainerId)
      }
      for (const n of extraNodes) {
        page.nodes[n.id] = n
      }
    }),
  )
}

// ---------------------------------------------------------------------------
// Smoke test
// ---------------------------------------------------------------------------

describe('Component System E2E smoke test', () => {
  beforeEach(() => {
    freshStore()
    useEditorStore.getState().createSite('Smoke Test Site')
  })

  it('step 2 — default canvas state: activeDocument is null, activePageId is set', () => {
    const state = useEditorStore.getState()
    expect(state.activeDocument).toBeNull()
    expect(state.activePageId).not.toBeNull()
    expect(state.site).not.toBeNull()
  })

  // ── VC-aware selector contract (Bug-fix regression cases) ──────────────────
  //
  // These cases directly verify the selector contract that was broken in
  // DomPanel (Bug 1) and ClassPicker (Bug 2): selectors must return correct
  // data in BOTH page mode and VC edit mode.

  it('selectActiveCanvasPage: page mode returns the active page', () => {
    // Create a simple text node on the page
    const textId = 'vc-sel-text'
    const text = makePageNode(textId, 'base.text')
    injectNodesIntoPage(textId, [text])

    const state = useEditorStore.getState()
    expect(state.activeDocument).toBeNull()

    const canvasPage = selectActiveCanvasPage(state)
    expect(canvasPage).not.toBeNull()
    // Must be the real page (not a virtual page)
    expect(canvasPage!.id).not.toContain('vc-virtual:')
    // The injected node is present
    expect(canvasPage!.nodes[textId]).toBeDefined()
  })

  it('selectActiveCanvasPage: VC edit mode returns virtual page containing VC nodes', () => {
    // Build a Container with a styled child and convert to VC
    const containerId = 'vc-sel-container'
    const childId = 'vc-sel-child'
    const container = makePageNode(containerId, 'base.container', [childId])
    const child = { ...makePageNode(childId, 'base.text'), classIds: ['cls-1'] }
    injectNodesIntoPage(containerId, [container, child])

    // Convert to VC — this also enters VC edit mode
    const vcId = callAction<string>('convertNodeToComponent', containerId, 'SelectorTestCard')

    const state = useEditorStore.getState()
    expect(state.activeDocument).toEqual({ kind: 'visualComponent', vcId })

    const canvasPage = selectActiveCanvasPage(state)
    expect(canvasPage).not.toBeNull()
    // Virtual page id has the well-known prefix
    expect(canvasPage!.id).toBe(`vc-virtual:${vcId}`)
    // Virtual page slug follows the components/<Name> convention
    expect(canvasPage!.slug).toBe('components/SelectorTestCard')

    // The flat nodes dict includes ALL VC nodes (root + cloned children)
    const vc = state.site!.visualComponents.find((v) => v.id === vcId)!
    const vcRootId = vc.tree.rootNodeId
    expect(canvasPage!.nodes[vcRootId]).toBeDefined()
    // VC rootNodeId is the virtual page's rootNodeId
    expect(canvasPage!.rootNodeId).toBe(vcRootId)
    // Cloned children are also in the flat map
    const vcRootNode = vc.tree.nodes[vcRootId]
    const childIds = vcRootNode?.children ?? []
    for (const childId2 of childIds) {
      expect(canvasPage!.nodes[childId2]).toBeDefined()
    }
  })

  it('selectSelectedNode: returns VC node with classIds when a VC node is selected', () => {
    // Build a container with a styled child — classIds must survive round-trip
    const containerId = 'vc-cls-container'
    const childId = 'vc-cls-child'
    const container = makePageNode(containerId, 'base.container', [childId])
    const styledChild = { ...makePageNode(childId, 'base.text'), classIds: ['cls-a', 'cls-b'] }
    injectNodesIntoPage(containerId, [container, styledChild])

    // Convert to VC (also enters VC edit mode)
    const vcId = callAction<string>('convertNodeToComponent', containerId, 'StyledCard')
    const state = useEditorStore.getState()

    // Identify the cloned child in the VC tree (it has a new ID after cloning).
    // After always-wrap, the tree shape is:
    //   tree.rootNodeId → base.body wrapper
    //     children[0]   → cloned base.container
    //       children    → cloned text(s)
    const vc = state.site!.visualComponents.find((v) => v.id === vcId)!
    const vcRoot = vc.tree.nodes[vc.tree.rootNodeId]
    expect(vcRoot.moduleId).toBe('base.body')
    const clonedContainerId = vcRoot.children[0]
    const clonedContainer = vc.tree.nodes[clonedContainerId]
    expect(clonedContainer.moduleId).toBe('base.container')
    const clonedChildId = clonedContainer.children.find(
      (cId) => vc.tree.nodes[cId]?.moduleId === 'base.text',
    )
    expect(clonedChildId).toBeDefined()

    // Select the cloned child node
    useEditorStore.getState().selectNode(clonedChildId)
    expect(useEditorStore.getState().selectedNodeId).toBe(clonedChildId)

    // selectSelectedNode must resolve through the virtual page
    const selectedNode = selectSelectedNode(useEditorStore.getState())
    expect(selectedNode).not.toBeNull()
    expect(selectedNode!.id).toBe(clonedChildId)
    // classIds are preserved on the cloned node
    expect(selectedNode!.classIds).toEqual(['cls-a', 'cls-b'])
  })

  it('selectActiveCanvasPage + selectSelectedNode: page mode returns page-tree data', () => {
    // In page mode both selectors should return page-tree data
    const nodeId = 'page-mode-node'
    const node = { ...makePageNode(nodeId, 'base.text'), classIds: ['pg-cls'] }
    injectNodesIntoPage(nodeId, [node])

    // Ensure we are in page mode (no VC document active)
    const state = useEditorStore.getState()
    expect(state.activeDocument).toBeNull()

    // selectActiveCanvasPage should return the real page
    const canvasPage = selectActiveCanvasPage(state)
    expect(canvasPage).not.toBeNull()
    expect(canvasPage!.id).not.toContain('vc-virtual:')
    expect(canvasPage!.nodes[nodeId]).toBeDefined()

    // selectSelectedNode with the page node selected
    useEditorStore.getState().selectNode(nodeId)
    const selected = selectSelectedNode(useEditorStore.getState())
    expect(selected).not.toBeNull()
    expect(selected!.id).toBe(nodeId)
    expect(selected!.classIds).toEqual(['pg-cls'])
  })

  it('full component system flow: convert → exit → re-place → selection boundaries', () => {
    // ── Step 1: Setup ──────────────────────────────────────────────────────────
    // Build a Container with 2 child text nodes and inject them onto the page.
    const containerId = 'smoke-container'
    const text1Id = 'smoke-text-1'
    const text2Id = 'smoke-text-2'

    const container = makePageNode(containerId, 'base.container', [text1Id, text2Id])
    const text1 = makePageNode(text1Id, 'base.text')
    const text2 = makePageNode(text2Id, 'base.text')
    injectNodesIntoPage(containerId, [container, text1, text2])

    // ── Step 2: Default state assert ───────────────────────────────────────────
    expect(useEditorStore.getState().activeDocument).toBeNull()
    expect(useEditorStore.getState().activePageId).not.toBeNull()

    // ── Step 3: Select the Container ───────────────────────────────────────────
    // selectNode() is the canonical UI selection action. It also calls
    // findSelectableNode() internally to resolve the active class.
    useEditorStore.getState().selectNode(containerId)
    expect(useEditorStore.getState().selectedNodeId).toBe(containerId)

    // ── Step 4: Convert with activeDocument === null ────────────────────────────
    // This is the exact bug-regression case: activeDocument is null (the default
    // page-canvas state), and we must NOT need to explicitly activate the page
    // document first.
    expect(useEditorStore.getState().activeDocument).toBeNull()

    // Must NOT throw
    const newVcId = callAction<string>('convertNodeToComponent', containerId, 'TestCard')

    // A new VisualComponent named 'TestCard' exists
    const site = getSite()
    const newVc = site.visualComponents.find((v) => v.id === newVcId)
    expect(newVc).toBeDefined()
    expect(newVc!.name).toBe('TestCard')

    // VC tree shape after always-wrap:
    //   tree.rootNodeId → fresh base.body wrapper (NOT the original container)
    //     children[0]   → cloned base.container
    //       children    → cloned text1, text2
    const vcTreeRoot = newVc!.tree.nodes[newVc!.tree.rootNodeId]
    expect(newVc!.tree.rootNodeId).not.toBe(containerId)
    expect(vcTreeRoot.moduleId).toBe('base.body')
    expect(vcTreeRoot.children.length).toBe(1)

    const clonedContainer = newVc!.tree.nodes[vcTreeRoot.children[0]]
    expect(clonedContainer.moduleId).toBe('base.container')
    expect(clonedContainer.children.length).toBe(2)

    const clonedChildIds = clonedContainer.children
    expect(clonedChildIds).not.toContain(text1Id)
    expect(clonedChildIds).not.toContain(text2Id)
    // Child modules preserved
    const clonedModules = clonedChildIds.map((id) => newVc!.tree.nodes[id]?.moduleId)
    expect(clonedModules).toContain('base.text')

    // Original location on the page now has a base.visual-component-ref
    const page = getPage()
    expect(page.nodes[containerId]).toBeUndefined()
    expect(page.nodes[text1Id]).toBeUndefined()
    expect(page.nodes[text2Id]).toBeUndefined()

    const refNode = Object.values(page.nodes).find(
      (n) => n.moduleId === 'base.visual-component-ref',
    )
    expect(refNode).toBeDefined()
    expect(refNode!.props.componentId).toBe(newVcId)
    const refNodeId = refNode!.id

    // activeDocument switched to the new VC
    expect(useEditorStore.getState().activeDocument).toEqual({
      kind: 'visualComponent',
      vcId: newVcId,
    })

    // selectedNodeId is null after conversion.
    // NOTE: The task spec says "selectedNodeId is the root id of the new VC's
    // subtree", but the implementation (and gate CNC-3) set it to null.
    // Resolved by reading source — see "Spec Ambiguities" at the top of this file.
    expect(useEditorStore.getState().selectedNodeId).toBeNull()

    // ── Step 5: Exit VC editing back to page ───────────────────────────────────
    useEditorStore.getState().exitVisualComponentMode()

    expect(useEditorStore.getState().activeDocument).toBeNull()
    // activePageId must still resolve to our original page
    expect(useEditorStore.getState().activePageId).not.toBeNull()

    // ── Step 6: Place the VC on the page again ──────────────────────────────────
    // insertComponentRef() in page mode inserts a base.visual-component-ref node
    // as a child of the given parent.
    const pageRootId = getPage().rootNodeId
    const newRefId = callAction<string | null>('insertComponentRef', pageRootId, newVcId)
    expect(newRefId).not.toBeNull()

    const page2 = getPage()

    // Two base.visual-component-ref nodes now exist (first from conversion, second from insert)
    const allRefNodes = Object.values(page2.nodes).filter(
      (n) => n.moduleId === 'base.visual-component-ref',
    )
    expect(allRefNodes.length).toBe(2)

    // The new ref is a child of the page root container
    const pageRoot = page2.nodes[pageRootId]
    expect(pageRoot.children).toContain(newRefId!)

    // The new ref points to the same VC
    const secondRef = page2.nodes[newRefId!]
    expect(secondRef).toBeDefined()
    expect(secondRef.props.componentId).toBe(newVcId)

    // ── Step 7: Selection — clicking VC body node routes to the ref ────────────
    // Instantiate the VC at refNodeId to produce an annotated flat node map.
    // Each instantiated node carries _owningRefId = refNodeId and _fromSlotContent = false.
    const vcRootForStep7 = newVc!.tree.nodes[newVc!.tree.rootNodeId]
    const innerVCNodeId = vcRootForStep7.children[0]

    const instantiated = instantiateVCAtRef(newVc!, {}, {}, {}, refNodeId)
    expect(instantiated.nodes[innerVCNodeId]).toBeDefined()
    expect(instantiated.nodes[innerVCNodeId]._owningRefId).toBe(refNodeId)
    expect(instantiated.nodes[innerVCNodeId]._fromSlotContent).toBe(false)

    // Build the combined node map: page nodes + inlined VC nodes.
    // InstantiatedVCNode is structurally compatible with AnnotatedPageNode
    // (both extend BaseNode; _owningRefId and _fromSlotContent are present;
    // the only structural difference is childNodes vs dynamicBindings, both optional).
    const combinedNodesStep7: Record<string, AnnotatedPageNode> = {
      ...page2.nodes,
      ...(instantiated.nodes as Record<string, AnnotatedPageNode>),
    }

    // findEnclosingComponentRef: clicking a VC body node must route to the ref.
    const bodyClickResult = findEnclosingComponentRef(combinedNodesStep7, innerVCNodeId)
    expect(bodyClickResult).not.toBeNull()
    expect(bodyClickResult!.refId).toBe(refNodeId)
    expect(bodyClickResult!.isInsideSlotContent).toBe(false)

    // ── Step 8: Selection — clicking slot-content routes to the node itself ─────
    // Setup: add a base.slot-outlet node to the VC tree so that slot content is
    // instantiated when we call instantiateVCAtRef with a slotContent map.
    //
    // addNodeToVc() operates on vc.rootNode directly and does not require
    // activeDocument to be set to VC mode — it takes an explicit vcId argument.
    const slotOutletId = 'smoke-slot-outlet'
    const slotOutletNode: VCNode = {
      id: slotOutletId,
      moduleId: 'base.slot-outlet',
      props: { slotName: 'children' },
      children: [],
      breakpointOverrides: {},
      classIds: [],
    }
    // Add the slot outlet as a child of the VC root node.
    const vcWithSlotRootId = newVc!.tree.rootNodeId
    callAction<void>('addNodeToVc', newVcId, vcWithSlotRootId, slotOutletNode)

    // Verify the slot outlet was added to the VC tree.
    const vcWithSlot = getSite().visualComponents.find((v) => v.id === newVcId)!
    const vcWithSlotRoot = vcWithSlot.tree.nodes[vcWithSlot.tree.rootNodeId]
    expect(vcWithSlotRoot.children).toContain(slotOutletId)
    expect(vcWithSlot.tree.nodes[slotOutletId]).toBeDefined()

    // Create a slot content node (user-authored content placed into the slot).
    const slotContentNodeId = 'smoke-slot-content-node'
    const slotContentNode: VCNode = {
      id: slotContentNodeId,
      moduleId: 'base.text',
      props: { text: 'User slot content' },
      children: [],
      breakpointOverrides: {},
      classIds: [],
    }

    // Instantiate the VC with slot content injected into the 'children' slot.
    // slotInstancesByName maps slotName → direct child IDs of the slot-instance;
    // pageNodes provides the full subtree for recursive collection.
    // instantiateVCAtRef expands the base.slot-outlet with the provided content
    // and marks all slot content nodes _fromSlotContent = true.
    const slotPageNodes = { [slotContentNodeId]: slotContentNode as unknown as import('@core/page-tree/baseNode').BaseNode }
    const instantiatedWithSlot = instantiateVCAtRef(
      vcWithSlot,
      {},
      { children: [slotContentNodeId] },
      slotPageNodes,
      refNodeId,
    )

    // The slot content node must be in the flat map and marked as slot content.
    expect(instantiatedWithSlot.nodes[slotContentNodeId]).toBeDefined()
    expect(instantiatedWithSlot.nodes[slotContentNodeId]._fromSlotContent).toBe(true)
    expect(instantiatedWithSlot.nodes[slotContentNodeId]._owningRefId).toBe(refNodeId)

    // The slot outlet placeholder itself must NOT appear in the flat map
    // when it was replaced by content nodes.
    expect(instantiatedWithSlot.nodes[slotOutletId]).toBeUndefined()

    // Build combined map with the slot-content-aware instantiation.
    const page3 = getPage()
    const combinedNodesStep8: Record<string, AnnotatedPageNode> = {
      ...page3.nodes,
      ...(instantiatedWithSlot.nodes as Record<string, AnnotatedPageNode>),
    }

    // findEnclosingComponentRef: clicking a slot-content node must indicate
    // isInsideSlotContent: true — the node is user-editable, not locked to the VC body.
    const slotClickResult = findEnclosingComponentRef(combinedNodesStep8, slotContentNodeId)
    expect(slotClickResult).not.toBeNull()
    expect(slotClickResult!.isInsideSlotContent).toBe(true)
    // The refId is still the owning ref (the page-level VC ref node).
    expect(slotClickResult!.refId).toBe(refNodeId)
  })
})

// ---------------------------------------------------------------------------
// Spec Ambiguities resolved by reading source
// ---------------------------------------------------------------------------
//
// 1. "selectedNodeId is the root id of the new VC's subtree" (step 4 bullet)
//    — The implementation (visualComponentsSlice.ts line ~832) sets
//      state.selectedNodeId = null after conversion. Gate CNC-3 in
//      convertNodeToComponent.test.ts explicitly asserts selectedNodeId is null.
//    — Resolution: test asserts null (matching implementation and CNC-3).
//      The task spec description appears to describe a future desired state,
//      not the current implementation.
//
// 2. "Use `findSelectableNode(state, innerVCNodeId)`" (steps 7 & 8)
//    — findSelectableNode is a module-private function in selectionSlice.ts and
//      is NOT exported. It also does not implement the VC body → ref routing:
//      in page mode it only searches page.nodes[nodeId], which would be undefined
//      for VC body nodes (they live in the VC tree, not page.nodes).
//    — The CANONICAL selector for the click → selectable mapping is
//      findEnclosingComponentRef() from canvasSelectionUtils.ts. This is what
//      NodeRenderer uses (line ~82) and what findEnclosingComponentRef.test.ts tests.
//    — Resolution: test uses findEnclosingComponentRef() throughout steps 7 & 8.
//
// 3. "slotContent map keyed by slot id with a child node id as value"
//    — The actual shape (from visualComponentRef/index.tsx and instantiate.ts) is:
//      slotContent: Record<string, VCNode[]> — keyed by SLOT NAME (string from
//      base.slot-outlet's props.slotName), value is an array of VCNode objects
//      (not just ids).
//    — Resolution: test uses { children: [slotContentNode] } where 'children'
//      matches the slot outlet's props.slotName.
//
// 4. Canonical container module id
//    — The spec says "base.container or whatever the canonical container module id is".
//    — Reading src/modules/base/ and the existing tests confirms 'base.container'.
//
// 5. "exitVisualComponentMode or setActiveDocument(null)"
//    — Both exist; exitVisualComponentMode() is what the UI (VCBreadcrumb,
//      toolbar) uses and additionally restores previousActivePageId.
//    — Resolution: test uses exitVisualComponentMode().
