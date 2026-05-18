/**
 * CanvasRoot — the top-level canvas component.
 *
 * Responsibilities:
 * - Captures all wheel, drag, and pinch gestures via useCanvas
 * - Manages the CanvasSelectionContext (click → selectNode, hover → hoverNode)
 * - Handles canvas-level keyboard shortcuts (Delete, Ctrl+D, Escape)
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

import { useRef, useCallback, useMemo, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useDroppable } from '@dnd-kit/core'
import { useEditorStore, selectActiveCanvasPage, selectRightSidebarExpanded } from '@site/store/store'
import type { Breakpoint } from '@core/page-tree/schemas'
import { registry } from '@core/module-engine/registry'
import { getNodeDisplayName } from '@core/page-tree/nodeDisplayName'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { ErrorBoundary } from '@ui/components/ErrorBoundary'
import { Input } from '@ui/components/Input'
import { useCanvas } from '@site/hooks/useCanvas'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { getKeybindingForCommand } from '@admin/spotlight/keybindings'
import { CanvasTransformLayer } from './CanvasTransformLayer'
import { CanvasPreviewSurface } from './CanvasPreviewSurface'
import { CanvasNotch } from './CanvasNotch'
import { CanvasModeToggle } from './CanvasModeToggle'
import { CanvasBreakpointSelector } from './CanvasBreakpointSelector'
import { CanvasSelectionContext, CanvasViewportActionsContext } from './CanvasContexts'
import { ClassStyleInjector } from './ClassStyleInjector'
import { PluginCanvasOverlayLayer } from './PluginCanvasOverlayLayer'
import { LayerNodeContextMenu } from '@site/panels/DomPanel/LayerNodeContextMenu'
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

interface RenameDialogState {
  nodeId: string
  currentName: string
  value: string
  error: string | null
}

export function CanvasRoot({ editable = true }: CanvasRootProps) {
  const transformLayerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [renameDialog, setRenameDialog] = useState<RenameDialogState | null>(null)

  // B2 — Register canvas root as a drop target for visualComponentRef drags.
  // The AdminCanvasLayout DndContext's onDragEnd checks event.over.id against CANVAS_ROOT_DROPPABLE_ID.
  const { setNodeRef: setCanvasDropRef } = useDroppable({
    id: CANVAS_ROOT_DROPPABLE_ID,
    disabled: !editable,
  })

  // Merged callback ref: satisfies both useCanvas (canvasRef) and useDroppable (setCanvasDropRef).
  const mergedCanvasRef = useCallback(
    (el: HTMLDivElement | null) => {
      canvasRef.current = el
      setCanvasDropRef(el)
    },
    [setCanvasDropRef],
  )

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
  const setInlineEditing = useEditorStore((s) => s.setInlineEditing)
  const templatePreviewContext = useTemplatePreviewContext(canvasPage)
  // Permission context — controls which double-click actions are available:
  //   canEditStructure → enter VC canvas (structural navigation)
  //   canEditContent   → enter inline text edit on text-like modules
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
  const requestDeleteNode = useCallback(
    (nodeId: string) => {
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
    },
    [canvasPage, clearSelection, confirmDelete, deleteNode],
  )

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

  // ─── Selection context value ───────────────────────────────────────────────

  const onNodeClick = useCallback(
    (nodeId: string, e: React.MouseEvent, breakpointId?: string) => {
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
    },
    [activeBreakpointId, selectNode, setActiveBreakpoint, setFocusedPanel],
  )

  const onNodeHover = useCallback(
    (nodeId: string | null, breakpointId?: string) => {
      hoverNode(nodeId, breakpointId)
    },
    [hoverNode],
  )

  const onNodeContextMenu = useCallback(
    (nodeId: string, e: React.MouseEvent, breakpointId?: string) => {
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
      setContextMenu({ x: e.clientX, y: e.clientY, nodeId })
    },
    [activeBreakpointId, editable, selectNode, setActiveBreakpoint, setFocusedPanel],
  )

  /**
   * Double-click on a canvas node.
   *
   * Three behaviours, in priority order:
   *   1. `base.visual-component-ref` + caller can edit structure → enter VC canvas mode.
   *   2. text-like module (base.text / base.button) + caller can edit content
   *      → open inline text edit on that node.
   *   3. Otherwise — no-op.
   *
   * The structural branch requires `canEditStructure`; entering the VC editor
   * is fundamentally structural. The inline-edit branch only requires
   * `canEditContent` — that's the whole point of the Client role.
   */
  const onNodeDoubleClick = useCallback(
    (nodeId: string, _e: React.MouseEvent) => {
      // Imperative store access — correct in event handlers
      const state = useEditorStore.getState()
      const node = selectActiveCanvasPage(state)?.nodes[nodeId]
      if (!node) return

      if (node.moduleId === 'base.visual-component-ref') {
        if (!permissions.canEditStructure) return
        const componentId = node.props.componentId
        if (typeof componentId === 'string' && componentId) {
          setActiveDocument({ kind: 'visualComponent', vcId: componentId })
        }
        return
      }

      // Inline text editing — opt-in per module via `inlineEditable: true`
      // on the ModuleDefinition. Today: base.text and base.button declare it.
      const definition = registry.get(node.moduleId)
      if (definition?.inlineEditable && permissions.canEditContent) {
        setInlineEditing(nodeId)
      }
    },
    [permissions.canEditContent, permissions.canEditStructure, setActiveDocument, setInlineEditing],
  )

  // Context carries only stable callbacks — selectedNodeId/hoveredNodeId are
  // intentionally excluded (Perf fix — Contribution #495). Each NodeRenderer
  // subscribes to its own boolean directly, so only the 2 affected nodes
  // re-render per selection/hover event rather than the entire canvas tree.
  const selectionContextValue = useMemo(
    () => ({ onNodeClick, onNodeHover, onNodeContextMenu, onNodeDoubleClick }),
    [onNodeClick, onNodeHover, onNodeContextMenu, onNodeDoubleClick],
  )

  const viewportActionsContextValue = useMemo(
    () => ({ canvasRootRef: canvasRef, panBy }),
    [canvasRef, panBy],
  )

  // ─── Canvas-level keyboard shortcuts ──────────────────────────────────────
  // Match predicates come from the keybindings registry — single source of truth.

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Let useCanvas handle zoom/pan shortcuts
      canvasKeyDown(e)

      // Escape exits VC mode regardless of selection state (SF-1 / CR #666).
      // This branch must run BEFORE the selectedNodeId guard so pressing Escape
      // while in VC mode with nothing selected still returns to the page canvas.
      if (e.key === 'Escape') {
        clearSelection()
        if (activeDocument?.kind === 'visualComponent') {
          setActiveDocument(null)
        }
        return
      }

      if (!editable) return
      if (!selectedNodeId) return

      // Read the live selection set inside the handler so multi-actions see
      // the latest state (subscribing in the component body would cause
      // re-renders on every selection change just to refresh this callback).
      const currentIds = useEditorStore.getState().selectedNodeIds

      // Delete / Backspace → delete selected layer(s)
      if (getKeybindingForCommand('layers.delete')?.match(e)) {
        // Don't intercept backspace in inputs
        const target = e.target as HTMLElement
        if (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        ) return
        e.preventDefault()
        if (currentIds.length > 1) {
          // Multi-delete: skip the central confirm dialog for v1 (no plumbing
          // to render "Delete N layers?" from this hot path). Undo via Ctrl+Z.
          deleteNodes(currentIds)
          clearSelection()
        } else {
          requestDeleteNode(selectedNodeId)
        }
      }

      // Ctrl/Cmd+D → duplicate
      if (getKeybindingForCommand('layers.duplicate')?.match(e)) {
        e.preventDefault()
        if (currentIds.length > 1) {
          duplicateNodes(currentIds)
        } else {
          duplicateNode(selectedNodeId)
        }
      }

      // Ctrl/Cmd+C / X / V — clipboard. Skip when the active element is a
      // text input / contenteditable so native text-clipboard behaviour wins
      // when the user is editing a value, not the layer tree.
      const target = e.target as HTMLElement
      const isTextInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      if (!isTextInput) {
        if (getKeybindingForCommand('layers.copy')?.match(e)) {
          e.preventDefault()
          if (currentIds.length > 1) copyNodes(currentIds)
          else copyNode(selectedNodeId)
        } else if (getKeybindingForCommand('layers.cut')?.match(e)) {
          e.preventDefault()
          if (currentIds.length > 1) cutNodes(currentIds)
          else cutNode(selectedNodeId)
        } else if (getKeybindingForCommand('layers.paste')?.match(e)) {
          e.preventDefault()
          // Paste anchors to the multi-selection's anchor — same single target.
          pasteNode(selectedNodeId)
        }
      }
    },
    [
      selectedNodeId,
      canvasKeyDown,
      clearSelection,
      requestDeleteNode,
      duplicateNode,
      duplicateNodes,
      deleteNodes,
      activeDocument,
      editable,
      setActiveDocument,
      copyNode,
      copyNodes,
      cutNode,
      cutNodes,
      pasteNode,
    ],
  )

  // ─── Canvas background click → deselect ───────────────────────────────────

  const handleCanvasClick = useCallback(() => {
    setContextMenu(null)
    clearSelection()
  }, [clearSelection])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const openRenameDialog = useCallback((nodeId: string) => {
    const state = useEditorStore.getState()
    const node = selectActiveCanvasPage(state)?.nodes[nodeId]
    if (!node) return

    const definition = registry.get(node.moduleId)
    const currentName = getNodeDisplayName(node, definition, state.site?.visualComponents)
    setRenameDialog({
      nodeId,
      currentName,
      value: currentName,
      error: null,
    })
  }, [])

  const closeRenameDialog = useCallback(() => {
    setRenameDialog(null)
  }, [])

  const commitRenameDialog = useCallback(() => {
    if (!renameDialog) return

    const nextName = renameDialog.value.trim()
    if (!nextName) {
      setRenameDialog((current) =>
        current ? { ...current, error: 'Name is required' } : current,
      )
      return
    }

    if (nextName !== renameDialog.currentName) {
      renameNode(renameDialog.nodeId, nextName)
    }
    setRenameDialog(null)
  }, [renameDialog, renameNode])

  const handleRenameSubmit = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    commitRenameDialog()
  }, [commitRenameDialog])

  // Resolve the active breakpoint object for the preview surface (which
  // wants the full Breakpoint, not just the id, to read .width).
  const activeBreakpoint = useMemo(
    () => breakpoints.find((bp) => bp.id === activeBreakpointId) ?? breakpoints[0] ?? null,
    [breakpoints, activeBreakpointId],
  )

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

          {/* Phase C — CSS class styles injected into document.head */}
          <ClassStyleInjector />

          {/* Insert toolbar and breakpoint context selector are design-only —
            preview has its own chrome inside CanvasModeToggle. */}
          {!isPreview && editable && <CanvasNotch />}

          {/* Design / Preview view toggle — top-left chrome. In preview mode
            this also hosts inline breakpoint switcher buttons. */}
          <CanvasModeToggle />

          {/* The breakpoint switcher targets per-breakpoint style overrides,
              so it's only meaningful for callers who can edit style or
              structure. Content-only Clients and pure Viewers get the
              same plain frames without this affordance. */}
          {!isPreview && rightSidebarExpanded && (permissions.canEditStyle || permissions.canEditStructure) && (
            <CanvasBreakpointSelector
              breakpoints={breakpoints}
              activeBreakpointId={activeBreakpointId}
              onBreakpointChange={setActiveBreakpoint}
            />
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

          {!isPreview && editable && contextMenu && createPortal(
            <LayerNodeContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              nodeId={contextMenu.nodeId}
              onClose={closeContextMenu}
              onDelete={() => {
                const id = contextMenu.nodeId
                closeContextMenu()
                requestDeleteNode(id)
              }}
              onDuplicate={() => {
                duplicateNode(contextMenu.nodeId)
                closeContextMenu()
              }}
              onRename={() => {
                const { nodeId } = contextMenu
                closeContextMenu()
                openRenameDialog(nodeId)
              }}
              onWrapInContainer={() => {
                wrapNode(contextMenu.nodeId, 'base.container')
                closeContextMenu()
              }}
              onCopy={() => {
                copyNode(contextMenu.nodeId)
                closeContextMenu()
              }}
              onCut={() => {
                cutNode(contextMenu.nodeId)
                closeContextMenu()
              }}
              onPaste={() => {
                pasteNode(contextMenu.nodeId)
                closeContextMenu()
              }}
            />,
            document.body,
          )}

          {!isPreview && editable && renameDialog && (
            <Dialog
              open
              onClose={closeRenameDialog}
              title="Rename element"
              size="sm"
              initialFocusRef={renameInputRef}
              footer={
                <>
                  <Button variant="secondary" size="sm" type="button" onClick={closeRenameDialog}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    type="button"
                    onClick={commitRenameDialog}
                    disabled={!renameDialog.value.trim()}
                  >
                    Save
                  </Button>
                </>
              }
            >
              <form className={styles.renameForm} onSubmit={handleRenameSubmit}>
                <label className={styles.renameField}>
                  <span className={styles.renameLabel}>Name</span>
                  <Input
                    ref={renameInputRef}
                    fieldSize="sm"
                    value={renameDialog.value}
                    autoComplete="off"
                    spellCheck={false}
                    invalid={Boolean(renameDialog.error)}
                    aria-describedby={renameDialog.error ? 'canvas-rename-error' : undefined}
                    onChange={(event) => {
                      const value = event.currentTarget.value
                      setRenameDialog((current) =>
                        current ? { ...current, value, error: null } : current,
                      )
                    }}
                  />
                </label>
                {renameDialog.error && (
                  <p id="canvas-rename-error" role="alert" className={styles.renameError}>
                    {renameDialog.error}
                  </p>
                )}
              </form>
            </Dialog>
          )}
        </div>
      </CanvasSelectionContext.Provider>
    </CanvasViewportActionsContext.Provider>
  )
}
