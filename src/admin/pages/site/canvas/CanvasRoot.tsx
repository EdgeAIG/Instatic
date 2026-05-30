/**
 * CanvasRoot — the top-level canvas component.
 *
 * Responsibilities:
 * - Captures all wheel, drag, and pinch gestures via useCanvas
 * - Manages the CanvasSelectionContext (click → selectNode, hover → hoverNode)
 * - Delegates canvas-level keyboard shortcuts to useCanvasKeyboardShortcuts
 * - Delegates the rename modal to useCanvasRenameDialog + CanvasRenameDialog
 * - Delegates the right-click menu to useCanvasLayerContextMenu + CanvasLayerContextMenu
 * - Renders CanvasTransformLayer inside the gesture-capture area
 * - Renders CanvasNotch (position: absolute, not in transform layer)
 * - Handles double-click on base.visual-component-ref → enters VC canvas mode
 *
 * Performance architecture:
 * - Pan/zoom writes go directly to CanvasTransformLayer's style.transform via ref
 * - No React state is updated during active interaction (60fps pan/zoom)
 * - NodeRenderer components memo'd per node — only affected nodes re-render on edit
 *
 * Accessibility:
 * - tabIndex={0} so the canvas receives keyboard events
 * - aria-label for screen reader orientation
 * - prefers-reduced-motion: CSS transitions are disabled for users who opt out
 */

import { useRef } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { useEditorStore, selectActiveCanvasPage, selectRightSidebarExpanded } from '@site/store/store'
import type { Breakpoint } from '@core/page-tree'
import { registry } from '@core/module-engine/registry'
import { getNodeDisplayName } from '@core/page-tree/nodeDisplayName'
import { ErrorBoundary } from '@ui/components/ErrorBoundary'
import { useCanvas } from '@site/hooks/useCanvas'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { CanvasTransformLayer } from './CanvasTransformLayer'
import { CanvasPreviewSurface } from './CanvasPreviewSurface'
import { CanvasNotch } from './CanvasNotch'
import { CanvasModeToggle } from './CanvasModeToggle'
import { CanvasContextSelector } from './CanvasContextSelector'
import { CanvasSelectionContext, CanvasViewportActionsContext } from './CanvasContexts'
// Class / user-stylesheet injectors are now mounted per breakpoint frame
// (inside each iframe's document) by `IframeFrameSurface`. CanvasRoot no
// longer injects site CSS into the editor's document — that path was a
// stopgap before the iframe cut-over. See
// `docs/features/canvas-iframe-per-frame.md`.
import { PluginCanvasOverlayLayer } from './PluginCanvasOverlayLayer'
import { CanvasRenameDialog } from './CanvasRenameDialog'
import { useCanvasRenameDialog } from './useCanvasRenameDialog'
import { CanvasLayerContextMenu } from './CanvasLayerContextMenu'
import { useCanvasLayerContextMenu } from './useCanvasLayerContextMenu'
import { useCanvasKeyboardShortcuts } from './useCanvasKeyboardShortcuts'
import { clientPointToEditorDoc } from './canvasDomGeometry'
import { useConfirmDelete } from '@admin/shared/dialogs/ConfirmDeleteDialog'
import { useEditorPreference } from '@site/preferences/editorPreferences'
import { useTemplatePreviewContext } from '@site/hooks/useTemplatePreviewContext'
import styles from './CanvasRoot.module.css'

/**
 * Stable empty-breakpoints sentinel — used as the `?? fallback` in the
 * breakpoints selector so that `Object.is(prev, next)` returns `true` when
 * the site is null, preventing useSyncExternalStore from entering an
 * infinite re-render loop.  Never use `?? []` inline in a useEditorStore
 * selector — a new array literal has a new identity on every call.
 */
const EMPTY_BREAKPOINTS: Breakpoint[] = []

/**
 * B2 — dnd-kit droppable ID for the canvas root.
 * The AdminCanvasLayout's canvas-level DndContext uses this to detect when a
 * visualComponentRef drag is released over the canvas.
 */
export const CANVAS_ROOT_DROPPABLE_ID = 'canvas-root'

interface CanvasRootProps {
  editable?: boolean
}

export function CanvasRoot({ editable = true }: CanvasRootProps) {
  const transformLayerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  // B2 — Register canvas root as a drop target for visualComponentRef drags.
  // The AdminCanvasLayout DndContext's onDragEnd checks event.over.id against CANVAS_ROOT_DROPPABLE_ID.
  const { setNodeRef: setCanvasDropRef } = useDroppable({
    id: CANVAS_ROOT_DROPPABLE_ID,
    disabled: !editable,
  })

  // Merged callback ref: satisfies both useCanvas (canvasRef) and useDroppable (setCanvasDropRef).
  const mergedCanvasRef = (el: HTMLDivElement | null) => {
    canvasRef.current = el
    setCanvasDropRef(el)
  }

  // Store subscriptions
  const canvasPage = useEditorStore(selectActiveCanvasPage)
  const breakpoints = useEditorStore((s) => s.site?.breakpoints ?? EMPTY_BREAKPOINTS)
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)
  const canvasView = useEditorStore((s) => s.canvasView)
  const rightSidebarExpanded = useEditorStore(selectRightSidebarExpanded)
  const isPreview = canvasView === 'preview'
  // selectedNodeId is needed here for canvas-level keyboard shortcuts (Delete, Ctrl+D).
  // hoveredNodeId is NOT subscribed here — NodeRenderer handles its own hover state
  // via per-node selectors to avoid O(N) re-renders on every hover event (#495).
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)
  const selectNode = useEditorStore((s) => s.selectNode)
  const hoverNode = useEditorStore((s) => s.hoverNode)
  const clearSelection = useEditorStore((s) => s.clearSelection)
  const deleteNode = useEditorStore((s) => s.deleteNode)
  // Multi-select: keyboard shortcuts dispatch the *Nodes batch actions when a
  // multi-selection is active so a single Ctrl+D / Delete / Cmd+C/X/V acts on
  // every selected layer in one undo step.
  const deleteNodes = useEditorStore((s) => s.deleteNodes)
  const duplicateNode = useEditorStore((s) => s.duplicateNode)
  const duplicateNodes = useEditorStore((s) => s.duplicateNodes)
  const renameNode = useEditorStore((s) => s.renameNode)
  const wrapNode = useEditorStore((s) => s.wrapNode)
  const copyNode = useEditorStore((s) => s.copyNode)
  const copyNodes = useEditorStore((s) => s.copyNodes)
  const cutNode = useEditorStore((s) => s.cutNode)
  const cutNodes = useEditorStore((s) => s.cutNodes)
  const pasteNode = useEditorStore((s) => s.pasteNode)
  const setActiveBreakpoint = useEditorStore((s) => s.setActiveBreakpoint)
  const setFocusedPanel = useEditorStore((s) => s.setFocusedPanel)
  const setActiveDocument = useEditorStore((s) => s.setActiveDocument)
  const activeDocument = useEditorStore((s) => s.activeDocument)
  const templatePreviewContext = useTemplatePreviewContext(canvasPage)
  // Permission context — controls which double-click actions are available:
  //   canEditStructure → enter VC canvas (structural navigation)
  const permissions = useEditorPermissions()
  // Auto-dim non-active breakpoints when a layer is selected and the
  // properties panel is open — gated by the `dimInactiveBreakpoints` user
  // preference so designers comparing breakpoints side-by-side can keep
  // them all bright.
  const dimInactiveBreakpointsPref = useEditorPreference('dimInactiveBreakpoints')
  const focusActiveBreakpoint =
    dimInactiveBreakpointsPref && Boolean(selectedNodeId && rightSidebarExpanded)

  // Routes destructive actions through the editor's central confirm dialog.
  // When the `confirmBeforeDelete` preference is off, the commit callback
  // runs synchronously — same behaviour as before this preference existed.
  const confirmDelete = useConfirmDelete()
  const requestDeleteNode = (nodeId: string) => {
    const page = canvasPage
    if (!page) return
    const node = page.nodes[nodeId]
    const definition = node ? registry.get(node.moduleId) : undefined
    const label = node
      ? getNodeDisplayName(node, definition, useEditorStore.getState().site?.visualComponents)
      : 'this layer'
    confirmDelete({
      title: 'Delete layer?',
      description: `${label} and any of its children will be removed. This can be undone with Ctrl/Cmd+Z.`,
      confirmLabel: 'Delete',
      commit: () => {
        deleteNode(nodeId)
        if (nodeId === useEditorStore.getState().selectedNodeId) clearSelection()
      },
    })
  }

  // Canvas gesture hook (pan/zoom). Disabled in preview mode — preview owns
  // its own surface (CanvasPreviewSurface) and pan/zoom is meaningless on a
  // single sandboxed iframe. Critically, this also stops wheel events from
  // silently mutating transformRef while in preview, which would otherwise
  // make the design canvas visibly jump on the first interaction after
  // returning from preview.
  const { bind, handleKeyDown: canvasKeyDown, panBy } = useCanvas({
    canvasRootRef: canvasRef,
    transformLayerRef,
    enabled: !isPreview,
  })

  // ─── Modals & overlays ─────────────────────────────────────────────────────

  const renameDialog = useCanvasRenameDialog(renameNode)
  const contextMenu = useCanvasLayerContextMenu()

  // "Paste HTML here…" — read the clipboard, then open the import modal
  // with the clicked node as the insertion parent.
  const openImportHtmlModal = useEditorStore((s) => s.openImportHtmlModal)
  const handlePasteHtml = async (nodeId: string) => {
    let prefillHtml = ''
    try {
      prefillHtml = await navigator.clipboard.readText()
    } catch (_err) {
      // Clipboard permission denied or API unavailable — open with empty textarea.
    }
    openImportHtmlModal({ parentId: nodeId, prefillHtml })
  }

  // ─── Selection context value ───────────────────────────────────────────────

  const onNodeClick = (nodeId: string, e: React.MouseEvent, breakpointId?: string) => {
    e.stopPropagation()
    if (breakpointId && breakpointId !== activeBreakpointId) {
      setActiveBreakpoint(breakpointId)
    }
    // Modifier-aware selection (multi-select): Cmd/Ctrl-click toggles, Shift-
    // click extends a range from the anchor. Plain clicks replace the
    // selection (default mode in `selectNode`).
    const mode = e.shiftKey
      ? 'range'
      : e.metaKey || e.ctrlKey
        ? 'toggle'
        : 'replace'
    selectNode(nodeId, mode)
    setFocusedPanel('canvas')
  }

  const onNodeHover = (nodeId: string | null, breakpointId?: string) => {
    hoverNode(nodeId, breakpointId)
  }

  const onNodeContextMenu = (nodeId: string, e: React.MouseEvent, breakpointId?: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!editable) return
    if (breakpointId && breakpointId !== activeBreakpointId) {
      setActiveBreakpoint(breakpointId)
    }
    // If the right-clicked node is part of an existing multi-selection,
    // KEEP the selection (the menu acts on the whole set). Otherwise replace
    // the selection with just this node — matches Figma / VS Code behavior.
    const currentIds = useEditorStore.getState().selectedNodeIds
    if (!currentIds.includes(nodeId)) {
      selectNode(nodeId)
    }
    setFocusedPanel('canvas')
    // The right-click event originates inside the per-breakpoint iframe, so
    // `e.clientX` / `e.clientY` are relative to the iframe's own viewport.
    // The context menu is portaled into the editor's `document.body` with
    // `position: fixed` — it needs editor-document coordinates, which
    // `clientPointToEditorDoc` produces by adding the iframe's outer rect
    // (scaled by the canvas zoom).
    const point = clientPointToEditorDoc(e.nativeEvent)
    contextMenu.open({ x: point.x, y: point.y, nodeId })
  }

  /**
   * Double-click on a canvas node.
   *
   * Intentionally a no-op for now. The previous behaviours — entering VC
   * canvas mode on `base.visual-component-ref`, and opening inline text
   * edit on text-like modules — were both removed. VC entry still works
   * from the Site panel and from Spotlight; inline text editing was
   * removed pending a re-design (see
   * `docs/features/canvas-iframe-per-frame.md` for context).
   *
   * The plumbing (`SelectionContext.onNodeDoubleClick`, the
   * `onDoubleClick` / `onDoubleClickCapture` entries on `nodeWrapperProps`)
   * stays in place so a future double-click behaviour can be wired in
   * without revisiting every module.
   */
  const onNodeDoubleClick = (_nodeId: string, _e: React.MouseEvent) => {
    // no-op
  }

  // Context carries only stable callbacks — selectedNodeId/hoveredNodeId are
  // intentionally excluded (Perf fix — Contribution #495). Each NodeRenderer
  // subscribes to its own boolean directly, so only the 2 affected nodes
  // re-render per selection/hover event rather than the entire canvas tree.
  const selectionContextValue = { onNodeClick, onNodeHover, onNodeContextMenu, onNodeDoubleClick }

  const viewportActionsContextValue = { canvasRootRef: canvasRef, panBy }

  // ─── Canvas-level keyboard shortcuts ──────────────────────────────────────
  // Match predicates come from the keybindings registry — single source of truth.

  const handleKeyDown = useCanvasKeyboardShortcuts({
    canvasKeyDown,
    selectedNodeId,
    editable,
    activeDocument,
    setActiveDocument,
    clearSelection,
    requestDeleteNode,
    deleteNodes,
    duplicateNode,
    duplicateNodes,
    copyNode,
    copyNodes,
    cutNode,
    cutNodes,
    pasteNode,
  })

  // ─── Canvas background click → deselect ───────────────────────────────────

  const handleCanvasClick = () => {
    contextMenu.close()
    clearSelection()
  }

  // Resolve the active breakpoint object for the preview surface (which
  // wants the full Breakpoint, not just the id, to read .width).
  const activeBreakpoint = breakpoints.find((bp) => bp.id === activeBreakpointId) ?? breakpoints[0] ?? null

  // Preview mode skips canvas-level gestures and shortcuts: there's nothing
  // to pan/zoom/select on a single sandboxed iframe. Spreading {} keeps the
  // outer div's prop shape stable when toggling.
  const gestureBindings = isPreview ? {} : bind()
  const onCanvasKeyDown = isPreview ? undefined : handleKeyDown
  const onCanvasClick = isPreview ? undefined : handleCanvasClick

  return (
    <CanvasViewportActionsContext.Provider value={viewportActionsContextValue}>
      <CanvasSelectionContext.Provider value={selectionContextValue}>
        <div
          ref={mergedCanvasRef}
          role="region"
          aria-label="Canvas — infinite editing surface"
          tabIndex={0}
          data-testid="canvas-root"
          data-canvas-state={canvasPage ? 'canvas-ready' : 'canvas-empty'}
          data-canvas-view={canvasView}
          data-vc-mode={activeDocument?.kind === 'visualComponent' ? 'true' : undefined}
          onKeyDown={onCanvasKeyDown}
          onClick={onCanvasClick}
          onFocus={() => setFocusedPanel('canvas')}
          className={styles.canvas}
          // Spread gesture handlers from useGesture (wheel, drag, pinch).
          // Empty in preview mode — see gestureBindings above.
          {...gestureBindings}
        >
          {/* CSS for prefers-reduced-motion — no transitions for accessibility */}
          <style>{`
          @media (prefers-reduced-motion: reduce) {
            [data-testid="canvas-transform-layer"] {
              transition: none !important;
            }
          }
        `}</style>

          {/* Site CSS (class registry + user stylesheets) lives inside each
            breakpoint iframe now — mounted per-frame by IframeFrameSurface
            so the canvas sees the same cascade the published page sees. */}

          {/* Insert toolbar and breakpoint context selector are design-only —
            preview has its own chrome inside CanvasModeToggle. */}
          {!isPreview && editable && <CanvasNotch />}

          {/* Design / Preview view toggle — top-left chrome. In preview mode
            this also hosts inline breakpoint switcher buttons. */}
          <CanvasModeToggle />

          {/* The editing-context switcher targets per-context style overrides
              (viewports + custom conditions), so it's only meaningful for
              callers who can edit style or structure. Content-only Clients and
              pure Viewers get the same plain frames without this affordance. */}
          {!isPreview && rightSidebarExpanded && (permissions.canEditStyle || permissions.canEditStructure) && (
            <CanvasContextSelector />
          )}

          {/*
          A buggy module render must not blank the toolbar / DOM panel /
          properties panel that share the editor shell. Resetting on the
          active page id means switching pages naturally clears stuck
          errors — the user navigates away from a broken module preview
          rather than getting "stuck" on the failure screen.
        */}
          <ErrorBoundary
            location="canvas"
            resetKeys={[canvasPage?.id ?? null, activeDocument?.kind ?? null, canvasView]}
          >
            {isPreview ? (
              <CanvasPreviewSurface
                page={canvasPage}
                activeBreakpoint={activeBreakpoint}
                templateContext={templatePreviewContext}
              />
            ) : (
              <CanvasTransformLayer
                ref={transformLayerRef}
                page={canvasPage}
                breakpoints={breakpoints}
                activeBreakpointId={activeBreakpointId}
                dimInactiveBreakpoints={focusActiveBreakpoint}
                onBreakpointActivate={setActiveBreakpoint}
                templateContext={templatePreviewContext}
              />
            )}
          </ErrorBoundary>

          {/*
          Plugin-registered canvas overlays. Mounted after the transform
          layer so they paint above rendered nodes. Only active in design
          (editable) mode — preview-mode canvases don't need overlays and
          plugin code shouldn't paint over the visitor preview.
        */}
          {!isPreview && editable && <PluginCanvasOverlayLayer />}

          {!isPreview && editable && contextMenu.position && (
            <CanvasLayerContextMenu
              position={contextMenu.position}
              onClose={contextMenu.close}
              actions={{
                requestDeleteNode,
                duplicateNode,
                openRenameDialog: renameDialog.open,
                wrapNode,
                copyNode,
                cutNode,
                pasteNode,
                pasteHtml: handlePasteHtml,
              }}
            />
          )}

          {!isPreview && editable && renameDialog.state && (
            <CanvasRenameDialog
              state={renameDialog.state}
              onChange={renameDialog.replace}
              onCommit={renameDialog.commit}
              onClose={renameDialog.close}
            />
          )}
        </div>
      </CanvasSelectionContext.Provider>
    </CanvasViewportActionsContext.Provider>
  )
}
