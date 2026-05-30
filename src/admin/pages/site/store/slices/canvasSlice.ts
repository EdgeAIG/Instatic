import type { EditorStoreSliceCreator } from '@site/store/types'
import {
  DEFAULT_ZOOM,
  clampZoom,
  clampPan,
  nearestZoomStep,
} from '@site/canvas/math'

type CanvasMode = 'select' | 'pan' | 'insert'

/**
 * Canvas render mode.
 *
 * - 'design': the React-based module renderer is shown — fully reactive to
 *   property edits, no script execution. Selection / drag / drop work here.
 * - 'preview': the runtime-preview iframe is shown — site scripts actually run
 *   inside a sandboxed iframe so authors can test behavior. Property edits
 *   while in preview mode do NOT auto-refresh the iframe; the user clicks
 *   Refresh (or navigates page/breakpoint, or edits scripts/deps) to rebuild.
 *
 * The two surfaces are mutually exclusive — preview mode does not stack the
 * iframe over the design canvas. This avoids the "scripts re-execute on every
 * keystroke" problem the previous overlay design caused.
 */
export type CanvasView = 'design' | 'preview'

export interface CanvasSlice {
  zoom: number
  panX: number
  panY: number
  /** Active breakpoint ID — determines which viewport frame is "focused" */
  activeBreakpointId: string
  /**
   * Active custom-condition id (a `site.conditions` id) the style panel is
   * editing under, or null when editing the viewport-resolved styles (base /
   * breakpoint). Orthogonal to `activeBreakpointId`: a condition can't reframe
   * the canvas, so the viewport frame stays put while edits route to the
   * condition's `contextStyles` bag. Selecting a viewport clears this.
   */
  activeConditionId: string | null
  /** Active page ID */
  activePageId: string | null
  /**
   * Page ID to restore when exiting VC canvas mode.
   * Captured by setActiveDocument when transitioning into VC mode from
   * the default page canvas (activeDocument === null). Cleared on exit.
   */
  previousActivePageId: string | null
  /** Current editor interaction mode */
  canvasMode: CanvasMode
  /** Current canvas render mode — design (live module editor) or preview (sandboxed runtime) */
  canvasView: CanvasView

  setZoom: (zoom: number) => void
  setPan: (x: number, y: number) => void
  setCanvasTransform: (zoom: number, x: number, y: number) => void
  setActiveBreakpoint: (id: string) => void
  /** Set (or clear, with null) the active custom-condition editing context. */
  setActiveConditionId: (id: string | null) => void
  setActivePage: (pageId: string) => void
  setCanvasMode: (mode: CanvasMode) => void
  setCanvasView: (view: CanvasView) => void
  resetView: () => void
  /**
   * Step zoom up to the next preset level. When `originX`/`originY` are
   * provided (in viewport-space, relative to the canvas root), the pan is
   * adjusted so that origin point stays fixed on screen — i.e. the zoom is
   * "around" that point. Toolbar buttons / keyboard shortcuts pass the
   * canvas viewport center; without an origin the zoom uses (0, 0) which
   * pulls content toward the top-left of the document.
   */
  zoomIn: (originX?: number, originY?: number) => void
  zoomOut: (originX?: number, originY?: number) => void
  zoomTo: (zoom: number, originX?: number, originY?: number) => void
}

// Contribute this slice's fields to the combined `EditorStore` type via TS
// module augmentation. See `../types.ts` for why we use this pattern.
declare module '@site/store/types' {
  interface EditorStore extends CanvasSlice {}
}

export const createCanvasSlice: EditorStoreSliceCreator<CanvasSlice> = (set, get) => ({
  zoom: DEFAULT_ZOOM,
  panX: 0,
  panY: 0,
  activeBreakpointId: 'desktop',
  activeConditionId: null,
  activePageId: null,
  previousActivePageId: null,
  canvasMode: 'select',
  canvasView: 'design',

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),

  setPan: (panX, panY) => set({ panX: clampPan(panX), panY: clampPan(panY) }),

  setCanvasTransform: (zoom, panX, panY) => set({
    zoom: clampZoom(zoom),
    panX: clampPan(panX),
    panY: clampPan(panY),
  }),

  // Picking a viewport switches editing back to that viewport's styles, so the
  // condition overlay is cleared.
  setActiveBreakpoint: (id) => set({ activeBreakpointId: id, activeConditionId: null }),

  setActiveConditionId: (id) => set({ activeConditionId: id }),

  setActivePage: (pageId) => set({ activePageId: pageId }),

  setCanvasMode: (mode) => set({ canvasMode: mode }),

  setCanvasView: (view) => set({ canvasView: view }),

  resetView: () => set({ zoom: DEFAULT_ZOOM, panX: 0, panY: 0 }),

  zoomIn: (originX, originY) => {
    const { zoom, panX, panY, zoomTo } = get()
    const next = nearestZoomStep(zoom, 1)
    if (originX !== undefined && originY !== undefined) {
      zoomTo(next, originX, originY)
    } else {
      // Fallback: keep current pan. Used by call sites that don't have a
      // viewport rect handy (shouldn't occur for user-facing actions).
      set({ zoom: next, panX: clampPan(panX), panY: clampPan(panY) })
    }
  },

  zoomOut: (originX, originY) => {
    const { zoom, panX, panY, zoomTo } = get()
    const next = nearestZoomStep(zoom, -1)
    if (originX !== undefined && originY !== undefined) {
      zoomTo(next, originX, originY)
    } else {
      set({ zoom: next, panX: clampPan(panX), panY: clampPan(panY) })
    }
  },

  /**
   * Zoom to a target level, optionally around a viewport origin point.
   * Used for Ctrl+Wheel zoom (zoom towards cursor position).
   */
  zoomTo: (targetZoom, originX = 0, originY = 0) => {
    const { zoom, panX, panY } = get()
    const newZoom = clampZoom(targetZoom)
    const scale = newZoom / zoom
    // Adjust pan so the origin point stays fixed in viewport space
    const newPanX = clampPan(originX - scale * (originX - panX))
    const newPanY = clampPan(originY - scale * (originY - panY))
    set({ zoom: newZoom, panX: newPanX, panY: newPanY })
  },
})

