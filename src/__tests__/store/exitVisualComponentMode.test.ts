/**
 * exitVisualComponentMode — store action tests
 *
 * Tests the round-trip: setActiveDocument({kind:'visualComponent'}) captures
 * previousActivePageId, and exitVisualComponentMode() restores state correctly.
 *
 * Architecture source: Phase 4 Layer 3 (Task #A3)
 * Implementation: src/core/editor-store/slices/uiSlice.ts
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'

// ---------------------------------------------------------------------------
// Store reset helper — mirrors the pattern in selectionSlice.test.ts
// ---------------------------------------------------------------------------

function freshStore() {
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    previousActivePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(freshStore)

// ---------------------------------------------------------------------------
// Helper: spin up a minimal site so page existence checks pass
// ---------------------------------------------------------------------------

function setupSiteWithPage(): { pageId: string } {
  const store = useEditorStore.getState()
  const site = store.createSite('Test Site')
  const pageId = site.pages[0].id
  useEditorStore.setState({ activePageId: pageId })
  return { pageId }
}

// ---------------------------------------------------------------------------
// setActiveDocument — previousActivePageId capture
// ---------------------------------------------------------------------------

describe('setActiveDocument — VC mode entry captures previousActivePageId', () => {
  it('captures activePageId into previousActivePageId when entering VC mode from default canvas', () => {
    const { pageId } = setupSiteWithPage()

    const vcId = 'test-vc-id'
    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId })

    const s = useEditorStore.getState()
    expect(s.previousActivePageId).toBe(pageId)
    expect(s.activeDocument).toEqual({ kind: 'visualComponent', vcId })
  })

  it('does NOT overwrite previousActivePageId when entering VC mode from an explicit page doc', () => {
    const { pageId } = setupSiteWithPage()

    // First set an explicit page doc (not null → null scenario)
    useEditorStore.setState({ activeDocument: { kind: 'page', pageId } })

    const vcId = 'test-vc-id'
    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId })

    // previousActivePageId must not be written because we came from an explicit page doc
    const s = useEditorStore.getState()
    expect(s.previousActivePageId).toBeNull()
  })

  it('clears previousActivePageId when exiting VC mode via setActiveDocument(null)', () => {
    const { pageId } = setupSiteWithPage()

    const vcId = 'test-vc-id'
    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId })
    expect(useEditorStore.getState().previousActivePageId).toBe(pageId)

    // Exit via setActiveDocument(null) — not exitVisualComponentMode, but clears it too
    useEditorStore.getState().setActiveDocument(null)
    expect(useEditorStore.getState().previousActivePageId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// exitVisualComponentMode — restores page + clears state
// ---------------------------------------------------------------------------

describe('exitVisualComponentMode', () => {
  it('restores activePageId to the captured previous page', () => {
    const { pageId } = setupSiteWithPage()

    const vcId = 'test-vc-id'
    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId })

    useEditorStore.getState().exitVisualComponentMode()

    const s = useEditorStore.getState()
    expect(s.activePageId).toBe(pageId)
  })

  it('sets activeDocument to null after exit', () => {
    const { pageId } = setupSiteWithPage()

    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId: 'vc-1' })
    useEditorStore.getState().exitVisualComponentMode()

    expect(useEditorStore.getState().activeDocument).toBeNull()
  })

  it('clears selectedNodeId after exit', () => {
    setupSiteWithPage()

    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId: 'vc-1' })
    useEditorStore.setState({ selectedNodeId: 'some-node' })

    useEditorStore.getState().exitVisualComponentMode()

    expect(useEditorStore.getState().selectedNodeId).toBeNull()
  })

  it('clears previousActivePageId after exit', () => {
    const { pageId } = setupSiteWithPage()

    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId: 'vc-1' })
    expect(useEditorStore.getState().previousActivePageId).toBe(pageId)

    useEditorStore.getState().exitVisualComponentMode()

    expect(useEditorStore.getState().previousActivePageId).toBeNull()
  })

  it('leaves activePageId unchanged if captured page no longer exists in the site', () => {
    const { pageId } = setupSiteWithPage()

    // Add a second page so we can delete the first without hitting the
    // "cannot delete last page" guard in the page-tree layer.
    // addPage switches activePageId to the new page, so restore it to pageId.
    const store = useEditorStore.getState()
    const secondPage = store.addPage('Second Page')
    const secondPageId = secondPage.id
    useEditorStore.setState({ activePageId: pageId })

    // Enter VC mode from the first page (captures pageId)
    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId: 'vc-1' })
    expect(useEditorStore.getState().previousActivePageId).toBe(pageId)

    // Delete the captured page while we are in VC mode
    useEditorStore.getState().deletePage(pageId)

    // deletePage may update activePageId; record whatever it is now
    const activePageIdBefore = useEditorStore.getState().activePageId

    // Manually restore the stale previousActivePageId (as if it was captured before deletion)
    useEditorStore.setState({ previousActivePageId: pageId })

    useEditorStore.getState().exitVisualComponentMode()

    const s = useEditorStore.getState()
    // The deleted page doesn't exist — activePageId should be left as-is
    expect(s.activePageId).toBe(activePageIdBefore)
    // But previousActivePageId must always be cleared
    expect(s.previousActivePageId).toBeNull()
    // Verify the second page still exists (side-effect check)
    expect(s.site!.pages.some((p) => p.id === secondPageId)).toBe(true)
  })

  it('handles exit when no previousActivePageId was captured (no-op on activePageId)', () => {
    // Enter VC mode without any active page
    useEditorStore.setState({ activePageId: null, previousActivePageId: null })
    useEditorStore.setState({ activeDocument: { kind: 'visualComponent', vcId: 'vc-1' } })

    useEditorStore.getState().exitVisualComponentMode()

    const s = useEditorStore.getState()
    expect(s.activeDocument).toBeNull()
    expect(s.activePageId).toBeNull()
    expect(s.previousActivePageId).toBeNull()
  })
})
