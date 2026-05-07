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
 *
 * Contract
 * ────────
 * The overlay is purely presentational and click-through (`pointer-events:
 * none` in CSS). Click/hover/keyboard interaction still flows through
 * `NodeWrapper` exactly as before.
 */

import { useEffect, useRef } from 'react'
import { useEditorStore } from '@core/editor-store/store'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@ui/cn'
import styles from './BreakpointSelectionOverlay.module.css'

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
  const hoveredNodeId = useEditorStore((s) =>
    s.hoveredBreakpointId === breakpointId ? s.hoveredNodeId : null,
  )

  // One ref per selected node, keyed by id. Stable across renders while the
  // id stays in the selection — when an id is removed, its ring entry is
  // dropped from the map; when added, a fresh ref is allocated.
  const ringRefs = useRef<Map<string, HTMLDivElement | null>>(new Map())
  const hoverRef = useRef<HTMLDivElement>(null)

  // Hover only renders when the hovered node isn't already part of the
  // selection — otherwise the two rings would stack and the hover ring
  // would mask the selection ring.
  const showHover = Boolean(hoveredNodeId) && !selectedNodeIds.includes(hoveredNodeId ?? '')

  // Stable string for the deps array — re-runs the RAF loop only when the
  // selection identity actually changes (not on every store mutation).
  const selectionKey = selectedNodeIds.join(',')

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
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey, hoveredNodeId, showHover, viewportRef])

  return (
    <div className={styles.overlayLayer} aria-hidden="true">
      {selectedNodeIds.map((id) => (
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
      {showHover && hoveredNodeId && (
        <div
          ref={hoverRef}
          className={cn(styles.ring, styles.hover)}
          data-canvas-hover-ring="true"
          data-node-id={hoveredNodeId}
        />
      )}
    </div>
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

/**
 * Escape an attribute value for safe inclusion in a CSS attribute selector.
 * `nodeId` is generated server-side / by the editor so the alphabet is
 * controlled, but escaping `"` and `\` is cheap insurance and matches the
 * defensive pattern used elsewhere in canvasClassCss.ts.
 */
function escapeAttribute(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}
