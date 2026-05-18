/**
 * BreakpointSelectionOverlay — selection and hover rings for the canvas.
 *
 * Why this exists
 * ───────────────
 * The previous design rendered selection/hover rings via a `::after`
 * pseudo-element on `NodeWrapper`. That required `NodeWrapper` to produce a
 * layout box (`<div>` with `position: relative`), which in turn forced every
 * canvas node into block flow — breaking inline behaviour (two `<a>` siblings
 * stacking instead of sitting side-by-side, flex-row containers laying out as
 * column, etc.) and diverging from the published HTML.
 *
 * Now `NodeWrapper` is `display: contents` (no layout box, exact match for
 * published), and rings live here as absolutely-positioned divs over the
 * actual rendered module element.
 *
 * Architecture
 * ────────────
 * - One overlay per breakpoint frame, mounted inside the viewport `<div>`
 *   (which is already `position: relative`).
 * - Subscribes to `selectedNodeId` and (per-frame) `hoveredNodeId`.
 * - Resolves the rendered element via `[data-node-id="X"]`'s first element
 *   child (modules render single-root HTML, so `firstElementChild` is the
 *   actual rendered tag — `<a>`, `<h1>`, `<div>`, etc.).
 * - Computes the rect relative to the viewport on every animation frame
 *   while a ring is visible (cheap; getBoundingClientRect + style write).
 *   Polling via RAF is simpler than wiring ResizeObserver/MutationObserver/
 *   IntersectionObserver to every possible mutation source.
 * - Clears style positioning when the tracked node disappears or the
 *   selection/hover clears.
 * - Renders the selected-layer toolbar through a portal into the canvas
 *   root so it escapes the breakpoint viewport's overflow boundary but
 *   stays inside the canvas's stacking + clipping context. That way the
 *   editor sidebars (z-index 55), dialogs (95+), modals (200+) and
 *   overlays naturally paint above it — instead of being covered by a
 *   max-z-index fixed-position toolbar floating over the whole document.
 *   Falls back to document.body with position:fixed when the canvas root
 *   isn't available (tests, transient mount race).
 *
 * Contract
 * ────────
 * The ring and indicator overlay is presentational and click-through
 * (`pointer-events: none` in CSS). The selected-layer toolbar is interactive
 * and clipped by the canvas root.
 */

import { useContext, useEffect, useRef, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore } from '@site/store/store'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import { CopyPlusSolidIcon } from 'pixel-art-icons/icons/copy-plus-solid'
import { TrashSolidIcon } from 'pixel-art-icons/icons/trash-solid'
import { HandGrabSolidIcon } from 'pixel-art-icons/icons/hand-grab-solid'
import { CanvasViewportActionsContext } from './CanvasContexts'
import { useCanvasReorderDrag } from './useCanvasReorderDrag'
import { measureCanvasNodeClientUnionRect } from './canvasDomGeometry'
import type {
  CanvasDropAxis,
  CanvasDropTarget,
  CanvasRect,
} from './canvasDnd'
import styles from './BreakpointSelectionOverlay.module.css'

const TOOLBAR_VERTICAL_OFFSET = 30

interface BreakpointSelectionOverlayProps {
  /**
   * The breakpoint frame this overlay belongs to. Used to scope the hover
   * ring — only the frame that owns the current hover renders one. Selection
   * applies to all frames simultaneously (the user sees the same node
   * highlighted in every breakpoint preview).
   */
  breakpointId: string
  /**
   * Ref to the viewport `<div>` the overlay sits inside. Bounding rects are
   * computed relative to this element so the ring follows pan/zoom without
   * extra math.
   */
  viewportRef: React.RefObject<HTMLElement | null>
}

export function BreakpointSelectionOverlay({
  breakpointId,
  viewportRef,
}: BreakpointSelectionOverlayProps) {
  // Multi-select: render one ring per selected node. `useShallow` keeps the
  // subscription stable when the array reference changes but its contents
  // are equal (matters because selectedNodeIds is a new array every set call).
  const selectedNodeIds = useEditorStore(useShallow((s) => s.selectedNodeIds))
  // `hoveredBreakpointId === null` means "global hover" — i.e. the hover did
  // not originate from a specific breakpoint frame on the canvas (e.g. it was
  // triggered by hovering a row in the DOM panel). In that case every frame
  // mirrors the hover so the user sees the highlight wherever they're looking.
  // When the hover originated from the canvas itself, scope it to the owning
  // frame so adjacent breakpoint previews don't all light up at once.
  const hoveredNodeId = useEditorStore((s) =>
    s.hoveredNodeId &&
    (s.hoveredBreakpointId === null || s.hoveredBreakpointId === breakpointId)
      ? s.hoveredNodeId
      : null,
  )
  const activeBreakpointId = useEditorStore((s) => s.activeBreakpointId)

  // One ref per selected node, keyed by id. Stable across renders while the
  // id stays in the selection — when an id is removed, its ring entry is
  // dropped from the map; when added, a fresh ref is allocated.
  const ringRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const hoverRef = useRef<HTMLDivElement>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const viewportActions = useContext(CanvasViewportActionsContext)

  // Hover only renders when the hovered node isn't already part of the
  // selection — otherwise the two rings would stack and the hover ring
  // would mask the selection ring.
  const showHover = Boolean(hoveredNodeId) && !selectedNodeIds.includes(hoveredNodeId ?? '')

  // Stable string for the deps array — re-runs the RAF loop only when the
  // selection identity actually changes (not on every store mutation).
  const selectionKey = selectedNodeIds.join(',')
  // Selection toolbar (drag / duplicate / delete) is purely structural —
  // hidden for callers without `site.structure.edit`. Content-only Clients
  // still get the selection ring (they click to select for content edit),
  // but no action chrome.
  //
  // Pure Viewers (no edit caps at all) see neither rings nor toolbar — the
  // canvas is a read-only inspection surface for them; selection ribbons
  // would just be visual clutter with no follow-on action available.
  const permissions = useEditorPermissions()
  const anyEditCap =
    permissions.canEditStructure || permissions.canEditContent || permissions.canEditStyle
  const showRings = anyEditCap
  const showToolbar =
    permissions.canEditStructure &&
    selectedNodeIds.length > 0 &&
    activeBreakpointId === breakpointId
  const reorderDrag = useCanvasReorderDrag({
    viewportRef,
    selectedNodeIds,
    enabled: showToolbar,
    panBy: viewportActions?.panBy,
    canvasRootRef: viewportActions?.canvasRootRef,
  })

  const duplicateSelectedLayers = () => {
    const ids = useEditorStore.getState().selectedNodeIds
    if (ids.length === 0) return
    useEditorStore.getState().duplicateNodes(ids)
  }

  const deleteSelectedLayers = () => {
    const ids = useEditorStore.getState().selectedNodeIds
    if (ids.length === 0) return
    const state = useEditorStore.getState()
    state.deleteNodes(ids)
    state.clearSelection()
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let frame = 0
    let cancelled = false

    const tick = () => {
      if (cancelled) return
      for (const id of selectedNodeIds) {
        positionRing(ringRefs.current.get(id) ?? null, id, viewport)
      }
      positionRing(hoverRef.current, showHover ? hoveredNodeId : null, viewport)
      positionToolbar(
        toolbarRef.current,
        showToolbar ? selectedNodeIds : [],
        viewport,
        viewportActions?.canvasRootRef.current ?? null,
      )
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, hoveredNodeId, showHover, showToolbar, viewportRef])

  // Prefer the canvas root as the portal target so the toolbar sits inside
  // the canvas's stacking + clipping context (below sidebars / dialogs /
  // modals, clipped by canvas overflow). Fall back to document.body for
  // tests or transient mount races where the ref isn't ready yet.
  const canvasRoot = viewportActions?.canvasRootRef.current ?? null
  const portalTarget = canvasRoot ?? document.body
  const toolbarMode = canvasRoot ? 'scoped' : 'fixed'

  const toolbar = showToolbar ? (
    <div
      ref={toolbarRef}
      role="group"
      aria-label="Selection actions"
      className={styles.selectionToolbar}
      data-canvas-selection-toolbar="true"
      data-canvas-toolbar-mode={toolbarMode}
      data-canvas-dragging={reorderDrag.dragging ? 'true' : undefined}
    >
      <Button
        variant="secondary"
        size="xs"
        iconOnly
        aria-label="Drag selected layers"
        tooltip="Drag selected layers"
        className={cn(styles.selectionToolbarButton, styles.dragToolbarButton)}
        onPointerDown={reorderDrag.handlePointerDown}
      >
        <HandGrabSolidIcon size={13} color="var(--editor-text)" />
      </Button>
      <Button
        variant="secondary"
        size="xs"
        iconOnly
        aria-label="Duplicate selected layers"
        tooltip="Duplicate selected layers"
        className={styles.selectionToolbarButton}
        onClick={duplicateSelectedLayers}
      >
        <CopyPlusSolidIcon size={13} color="var(--editor-text)" />
      </Button>
      <Button
        variant="secondary"
        size="xs"
        iconOnly
        tone="danger"
        aria-label="Delete selected layers"
        tooltip="Delete selected layers"
        className={styles.selectionToolbarButton}
        onClick={deleteSelectedLayers}
      >
        <TrashSolidIcon size={13} color="var(--editor-danger-light)" />
      </Button>
    </div>
  ) : null

  return (
    <>
      <div className={styles.overlayLayer}>
        <div className={styles.ringLayer} aria-hidden="true">
          {showRings && selectedNodeIds.map((id) => (
            <div
              key={id}
              ref={(el) => {
                if (el) ringRefs.current.set(id, el)
                else ringRefs.current.delete(id)
              }}
              className={cn(styles.ring, styles.selection)}
              data-canvas-selection-ring="true"
              data-node-id={id}
            />
          ))}
          {showRings && showHover && hoveredNodeId && (
            <div
              ref={hoverRef}
              className={cn(styles.ring, styles.hover)}
              data-canvas-hover-ring="true"
              data-node-id={hoveredNodeId}
            />
          )}
        </div>

        {reorderDrag.target && (
          <div
            className={styles.dropIndicator}
            data-position={reorderDrag.target.position}
            data-axis={reorderDrag.target.axis}
            style={dropIndicatorStyle(reorderDrag.target)}
            aria-hidden="true"
          />
        )}

        {reorderDrag.invalid && (
          <div
            className={styles.invalidDropIndicator}
            style={rectStyle(reorderDrag.invalid.rect)}
            data-axis={reorderDrag.invalid.axis}
            aria-hidden="true"
          />
        )}
      </div>
      {toolbar && createPortal(toolbar, portalTarget)}
    </>
  )
}

// ---------------------------------------------------------------------------
// Positioning helper
// ---------------------------------------------------------------------------

/**
 * Move/resize a ring div to overlay the rendered element of `nodeId` inside
 * `viewport`. Hides the ring (display: none) if the element is not currently
 * mounted — happens transiently during page swaps, breakpoint changes, or
 * when the selection points into a hidden subtree.
 *
 * Coordinates are computed via getBoundingClientRect (which returns visual
 * post-transform pixels) and then made viewport-local AND unscaled. The
 * unscaling matters because the viewport sits inside CanvasTransformLayer,
 * which applies `scale(zoom)` to all its descendants — including the ring.
 * If we wrote screen-space pixels to the ring, the parent scale would scale
 * them a second time and the ring would land in the wrong place at any zoom
 * other than 1. Deriving the scale from the viewport itself
 * (clientRect.width / offsetWidth) means we don't need to subscribe to the
 * zoom store and we automatically track pan/zoom in flight.
 */
function positionRing(
  ring: HTMLDivElement | null,
  nodeId: string | null,
  viewport: HTMLElement,
): void {
  if (!ring) return

  if (!nodeId) {
    ring.style.display = 'none'
    return
  }

  // The wrapper is `display: contents` so its own getBoundingClientRect
  // returns a zero-sized rect. Read the rect from the actual rendered child
  // element instead — modules render single-root HTML, so firstElementChild
  // is the right target. Search inside the viewport so a duplicate node-id
  // in another breakpoint frame can't be picked up by accident.
  const wrapper = viewport.querySelector<HTMLElement>(
    `[data-node-id="${escapeAttribute(nodeId)}"]`,
  )
  const target = wrapper?.firstElementChild ?? wrapper

  if (!target || !(target instanceof Element)) {
    ring.style.display = 'none'
    return
  }

  const rect = target.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    // Element is in the DOM but not laid out (display: none ancestor, etc.) —
    // hide the ring rather than draw a zero-sized box at (0,0).
    ring.style.display = 'none'
    return
  }

  const viewportRect = viewport.getBoundingClientRect()

  // Recover the canvas zoom factor: the viewport's CSS layout width
  // (offsetWidth) is the breakpoint width in unscaled pixels, while
  // getBoundingClientRect().width is that same width times the parent's
  // `scale(zoom)`. Their ratio is the effective scale. Fallback to 1 when the
  // viewport has no layout (offsetWidth === 0), which can happen transiently
  // during mount.
  const scale = viewport.offsetWidth > 0 ? viewportRect.width / viewport.offsetWidth : 1

  // Viewport-local, unscaled coordinates — what the ring's CSS pixels need to
  // be in, since the ring is itself a descendant of the scaled transform layer.
  const x = (rect.left - viewportRect.left) / scale
  const y = (rect.top - viewportRect.top) / scale
  const width = rect.width / scale
  const height = rect.height / scale

  // transform/width/height instead of top/left/width/height so the browser
  // can promote the ring to its own compositing layer (smooth follow without
  // layout thrash on the rest of the canvas).
  ring.style.display = ''
  ring.style.transform = `translate(${x}px, ${y}px)`
  ring.style.width = `${width}px`
  ring.style.height = `${height}px`
}

function positionToolbar(
  toolbar: HTMLDivElement | null,
  nodeIds: readonly string[],
  viewport: HTMLElement,
  canvasRoot: HTMLElement | null,
): void {
  if (!toolbar || nodeIds.length === 0) {
    if (toolbar) toolbar.style.display = 'none'
    return
  }

  const rect = measureCanvasNodeClientUnionRect(viewport, nodeIds)
  if (!rect) {
    toolbar.style.display = 'none'
    return
  }

  // When the selected element has been panned/zoomed entirely outside the
  // canvas root's visible area, hide the toolbar rather than leaving it
  // anchored to an off-canvas position. Otherwise the toolbar appears to
  // "hang on screen" detached from the element it belongs to. This also
  // covers the case where overflow:hidden clipping would only partially hide
  // the toolbar — once the element is gone, hide the chrome cleanly.
  if (canvasRoot) {
    const canvasRect = canvasRoot.getBoundingClientRect()
    const elementFullyOutOfBounds =
      rect.right <= canvasRect.left ||
      rect.left >= canvasRect.right ||
      rect.bottom <= canvasRect.top ||
      rect.top >= canvasRect.bottom
    if (elementFullyOutOfBounds) {
      toolbar.style.display = 'none'
      return
    }
  }

  toolbar.style.display = ''

  // Scoped path: toolbar lives inside the canvas root (position: absolute),
  // so the CSS variables are in canvas-root-local coordinates. The canvas
  // root's overflow:hidden then clips the toolbar when it lands outside the
  // visible canvas area (e.g. anchored to an element near a frame edge that
  // the user has panned partly out of view).
  //
  // Fixed path (fallback): toolbar lives in document.body (position: fixed),
  // so the CSS variables remain in viewport (client) coordinates.
  let originLeft = 0
  let originTop = 0
  if (canvasRoot) {
    const canvasRect = canvasRoot.getBoundingClientRect()
    originLeft = canvasRect.left
    originTop = canvasRect.top
  }

  // No horizontal clamping: the toolbar anchors to the selected element's
  // left edge. A previous `Math.max(4, x)` clamp kept the toolbar visible at
  // the canvas-left edge when the element panned off-screen left, but that
  // decoupled the toolbar from the element and left it "hanging" far from
  // the actual selection. The element-out-of-bounds check above already
  // hides the toolbar when the selection is fully off-canvas; for partial
  // overlap, overflow:hidden clips the toolbar so it can't bleed into the
  // sidebars.
  const x = rect.left - originLeft
  const y = rect.top - originTop - TOOLBAR_VERTICAL_OFFSET

  toolbar.style.setProperty('--canvas-toolbar-x', `${x}px`)
  toolbar.style.setProperty('--canvas-toolbar-y', `${y}px`)
}

function dropIndicatorStyle(target: CanvasDropTarget): CSSProperties {
  if (target.position === 'inside') return rectStyle(target.rect)
  return lineStyle(target.rect, target.position, target.axis)
}

function lineStyle(
  rect: CanvasRect,
  position: 'before' | 'after',
  axis: CanvasDropAxis,
): CSSProperties {
  if (axis === 'horizontal') {
    const x = position === 'before' ? rect.left : rect.right
    return indicatorVars(x, rect.top, 2, rect.height)
  }

  const y = position === 'before' ? rect.top : rect.bottom
  return indicatorVars(rect.left, y, rect.width, 2)
}

function rectStyle(rect: CanvasRect): CSSProperties {
  return indicatorVars(rect.left, rect.top, rect.width, rect.height)
}

function indicatorVars(x: number, y: number, width: number, height: number): CSSProperties {
  return {
    '--canvas-drop-x': `${x}px`,
    '--canvas-drop-y': `${y}px`,
    '--canvas-drop-w': `${width}px`,
    '--canvas-drop-h': `${height}px`,
  } as CSSProperties
}

/**
 * Escape an attribute value for safe inclusion in a CSS attribute selector.
 * `nodeId` is generated server-side / by the editor so the alphabet is
 * controlled, but escaping `"` and `\` is cheap insurance and matches the
 * defensive pattern used elsewhere in canvasClassCss.ts.
 */
function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
