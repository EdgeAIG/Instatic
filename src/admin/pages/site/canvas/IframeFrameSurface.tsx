/**
 * IframeFrameSurface — renders one breakpoint frame inside its own iframe so
 * the canvas DOM matches the published page's DOM exactly.
 *
 * Why an iframe per frame?
 * ────────────────────────
 * The editor used to render each breakpoint frame as a `<div className=
 * "viewport">` directly inside the editor's document. That gave us "free"
 * event handling and shared CSS, but it created two structural mismatches
 * between canvas and published HTML:
 *
 *   1. `<body>` was the editor's body, so user CSS like
 *      `body { background: black; }` painted the editor chrome.
 *   2. Every authored element was wrapped in a `<div class="nodeWrapper">`
 *      for editor plumbing. CSS combinators (`>`, `+`, `~`, `:nth-child()`)
 *      couldn't traverse the wrappers, so authored direct-child / sibling
 *      relationships didn't match in the canvas.
 *
 * The iframe gives the page tree its own document, with its own real
 * `<body>` — user CSS works exactly as it does on the published site. No
 * scoping, no rewriting, no impedance mismatch. Each module also spreads
 * `nodeWrapperProps` (data-node-id, click/hover/keyboard handlers, …)
 * directly onto its own root tag, so there are no `display: contents`
 * NodeWrapper divs sitting between authored elements either — CSS
 * combinators (`>`, `+`, `~`, `:nth-child()`) match the same authored DOM
 * the publisher emits.
 *
 * How it works
 * ────────────
 *  - The iframe boots with an empty HTML skeleton via `srcDoc`.
 *  - On the iframe's `load` event we capture `contentDocument` into state.
 *  - The children passed to this component are mounted into the iframe's
 *    `<body>` via `createPortal`. React synthetic events bubble through
 *    the React tree (not the DOM tree), so click/hover/keyboard handlers
 *    attached in NodeRenderer still fire — the React fiber sees these as
 *    same-tree events.
 *  - `ClassStyleInjector` and `UserStylesheetInjector` are mounted with
 *    `targetDocument={iframeDoc}` so the class registry CSS and user
 *    stylesheets land in the iframe's `<head>`.
 *  - `data-breakpoint-id` is set on the iframe's `<body>` so the
 *    per-breakpoint class CSS (which uses `[data-breakpoint-id="..."]
 *    .myClass` selectors) matches inside the iframe.
 *
 * What's NOT in this component (yet):
 *  - Per-iframe `getComputedStyle` for code outside the iframe that
 *    measures elements (selection overlay handles its own iframe-rect
 *    translation; other callers may need updates).
 *
 * Cross-iframe drag relay (canvas reorder)
 * ────────────────────────────────────────
 * The canvas reorder drag (`useCanvasReorderDrag`) starts on the selection
 * toolbar's drag handle in the parent doc, but the cursor inevitably
 * crosses into an iframe partway through. Left-click pointer events
 * inside the iframe never bubble to the parent's `window`, so the parent's
 * pointermove / up / cancel listeners go silent the moment the cursor
 * enters a frame. To fix that, `useCanvasReorderDrag` sets
 * `data-pb-canvas-dragging` and `data-pb-canvas-dragging-pointer-id` on
 * the parent's `<html>` while a drag is in flight. Every iframe reads
 * those flags inside its pointer handler and, when set, forwards the
 * three pointer event types to the parent (using the original drag's
 * pointerId so the parent's session-id assumptions still line up).
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@ui/cn'
import { ClassStyleInjector } from './ClassStyleInjector'
import { UserStylesheetInjector } from './UserStylesheetInjector'
import { EditorChromeInjector } from './EditorChromeInjector'
import { RuntimeScriptInjector } from './RuntimeScriptInjector'
import type { InjectableRuntimeScript } from './useRuntimeScriptBuild'
import { CANVAS_VIEWPORT_HEIGHT, type CanvasViewport } from './resolveViewportUnits'
import styles from './IframeFrameSurface.module.css'

/**
 * Frame interaction model.
 * - 'canvas': the infinite-surface design frame. Wheel/pointer events are
 *   forwarded to the parent for pan/zoom, the iframe grows to its content
 *   height (no inner scrollbar), and the canvas-chrome CSS neutralises
 *   cursors / text selection so the frame reads as a click-to-select preview.
 * - 'live': a single real-size frame. The iframe is its own scroll viewport
 *   (published height behaviour), real cursors and text selection apply, and
 *   no events are forwarded — there is nothing to pan.
 */
export type IframeInteraction = 'canvas' | 'live'

const IFRAME_SRC_DOC = '<!doctype html><html><head></head><body></body></html>'

/** Stable empty list so a script-less frame doesn't churn the injector's deps. */
const EMPTY_RUNTIME_SCRIPTS: InjectableRuntimeScript[] = []

interface IframeFrameSurfaceProps {
  /** Stable id used to tag the iframe's `<body>` with `data-breakpoint-id`. */
  breakpointId: string
  /** Logical viewport width in px; drives the iframe's CSS width. */
  width: number
  className?: string
  style?: CSSProperties
  /**
   * Click handler delegated to the iframe's `<body>`. The original frame
   * had its onClick on the viewport `<div>`; we replicate that on the body
   * so clicking the empty area still activates the breakpoint.
   */
  onClick?: () => void
  /** Page tree React subtree to mount inside the iframe's body. */
  children: ReactNode
  /**
   * `data-*` attributes forwarded onto the iframe element itself. The
   * outgoing `data-breakpoint-id` lives on the iframe's `<body>` (so it can
   * be a target of the canvas's `[data-breakpoint-id]`-scoped CSS), but
   * the editor sometimes wants identifiers on the iframe wrapper too —
   * e.g. testids that the agent-browser can target without crossing the
   * iframe boundary.
   */
  dataAttrs?: Record<string, string | undefined>
  /** Interaction model — see {@link IframeInteraction}. Defaults to 'canvas'. */
  interaction?: IframeInteraction
  /**
   * Bundled runtime scripts to execute inside the frame. Empty/undefined runs
   * nothing — the frame stays a pure render. Same in both interaction modes
   * (the "Run scripts" toggle drives this), so authored behaviour can run
   * alongside the live editor.
   */
  runtimeScripts?: InjectableRuntimeScript[]
}

export interface IframeFrameSurfaceHandle {
  /** The iframe element itself. `null` until the iframe mounts. */
  iframeElement: HTMLIFrameElement | null
  /** The iframe's contentDocument. `null` until the iframe has loaded. */
  contentDocument: Document | null
  /** Convenience: the iframe's body. `null` until loaded. */
  contentBody: HTMLBodyElement | null
}

export const IframeFrameSurface = forwardRef<IframeFrameSurfaceHandle, IframeFrameSurfaceProps>(
  function IframeFrameSurface(
    {
      breakpointId,
      width,
      className,
      style,
      onClick,
      children,
      dataAttrs,
      interaction = 'canvas',
      runtimeScripts,
    },
    ref,
  ) {
    const isLive = interaction === 'live'
    const iframeRef = useRef<HTMLIFrameElement | null>(null)
    const [iframeDoc, setIframeDoc] = useState<Document | null>(null)

    // Bridge the iframe handle out to the parent (selection overlay reads
    // `iframeElement` to translate inside-iframe rects into editor coordinates).
    useImperativeHandle(
      ref,
      () => ({
        iframeElement: iframeRef.current,
        contentDocument: iframeDoc,
        contentBody: (iframeDoc?.body ?? null) as HTMLBodyElement | null,
      }),
      [iframeDoc],
    )

    // Wire up the iframe document once it's ready. Capture both onLoad and
    // the synchronous `contentDocument` path: `srcDoc` parses immediately so
    // contentDocument is often already populated by the time React commits
    // the iframe element; we still listen for `load` as a fallback in case
    // the browser deferred parsing.
    const attachIframeDoc = (iframe: HTMLIFrameElement | null) => {
      iframeRef.current = iframe
      if (!iframe) {
        setIframeDoc(null)
        return
      }
      const tryCapture = () => {
        const doc = iframe.contentDocument
        if (doc && doc.readyState !== 'loading') setIframeDoc(doc)
      }
      tryCapture()
      iframe.addEventListener('load', tryCapture)
      // Stash the cleanup on the ref so React's ref-callback contract (the
      // function may be called again with null on unmount) doesn't leak
      // listeners.
      ;(iframe as HTMLIFrameElement & { _pbCleanup?: () => void })._pbCleanup = () => {
        iframe.removeEventListener('load', tryCapture)
      }
    }

    useEffect(() => {
      return () => {
        const iframe = iframeRef.current as
          | (HTMLIFrameElement & { _pbCleanup?: () => void })
          | null
        iframe?._pbCleanup?.()
      }
    }, [])

    // Tag the iframe body with `data-breakpoint-id` (matches the existing
    // canvasClassCss selector `[data-breakpoint-id="..."] .myClass`) and
    // wire the empty-frame click handler. Re-runs when the document or
    // handler change.
    //
    // We also break the `:where(html, body) { height: 100% }` reset rule
    // for the canvas iframe context. The published page wants body filling
    // the viewport (so footer stickies to bottom on short pages); the
    // canvas iframe is a Figma-like frame that should be EXACTLY the height
    // of its content — letting body inherit 100% creates a feedback loop
    // where the iframe sizes to body which sizes to iframe and the frame
    // never shrinks. Both `html` and `body` styles win against `:where()`
    // (zero-specificity) so the override is safe.
    useEffect(() => {
      if (!iframeDoc?.body) return
      applyIframeBodyReset(iframeDoc, breakpointId, interaction)
      if (!onClick) return
      // Empty-frame click: ONLY fire when the click target is the body
      // itself (not a child node bubbling up). Without this guard, every
      // single click anywhere in the iframe — including clicks that the
      // canvas already routed through NodeRenderer's stopPropagation
      // logic — would re-trigger `onActivate`. React's `stopPropagation()`
      // from the child's onClick reaches React's delegated listener but
      // doesn't stop this native bubble-phase listener (they were
      // attached in different code paths, in different orders).
      const handler = (e: MouseEvent) => {
        if (e.target !== iframeDoc.body) return
        onClick()
      }
      iframeDoc.body.addEventListener('click', handler)
      return () => {
        iframeDoc.body.removeEventListener('click', handler)
      }
    }, [iframeDoc, breakpointId, onClick, interaction])

    // ── Iframe height tracking ────────────────────────────────────────────
    // The canvas is a Figma-like infinite surface — frames are not supposed
    // to have their own scrollbars. If the iframe element has a fixed
    // height (e.g. the default ~150px or `100vh`) but its content overflows,
    // the iframe scrolls internally — and that scroll captures wheel events
    // before they reach the canvas pan/zoom gesture layer. We grow the
    // iframe to its content's full height so:
    //  1. No inner scrollbar appears.
    //  2. Wheel events for canvas pan are never consumed by inner scroll.
    //  3. The whole page is visible at once, the way the legacy in-document
    //     frame rendered it.
    //
    // Viewport-unit feedback loop — why this is guarded
    // ─────────────────────────────────────────────────
    // The iframe element's height IS the `vh`/`vw` reference for the page
    // rendered inside it. So writing `iframe.style.height` from the measured
    // content height feeds straight back into any authored CSS that sizes
    // against the viewport (`min-height: 88vh`, `height: 100vh`, percentage
    // heights chained off such an ancestor, …): we grow the frame → `vh`
    // recomputes larger → content grows → the ResizeObserver fires → we grow
    // again. Below 100% of viewport units this converges slowly; at ≥ 100%
    // it diverges and pins the CPU. An unguarded loop makes the editor
    // unusable the instant a user pastes viewport-relative CSS.
    //
    // The guard:
    //  - Coalesce measurements into a single rAF so a write can't trigger a
    //    synchronous re-measure on the same frame.
    //  - Cap how many times we may resize from our OWN height writes before
    //    treating the layout as settled (a viewport feedback chain only ever
    //    grows from our writes, with no DOM mutation in between). The frame
    //    is left at its last height once the cap trips — convergent pages
    //    reach their natural height, divergent ones stop at a bounded height,
    //    and the CPU is never pinned.
    //  - A genuine content/style change (nodes added/removed, text edited,
    //    injected CSS replaced) fires the MutationObserver, which resets the
    //    budget so real edits always earn a fresh fit. Our own height writes
    //    land on the iframe element in the PARENT document, so they never
    //    trip the MutationObserver and never reset the budget themselves.
    useEffect(() => {
      // Grow-to-content is a canvas-only concern: on the infinite surface the
      // frame must not have an inner scrollbar. In 'live' mode the iframe IS
      // the scroll viewport (published height behaviour), so we leave its
      // height to CSS (100%) and let it scroll internally.
      if (isLive) return
      if (!iframeDoc) return
      const iframe = iframeRef.current
      if (!iframe) return

      const MAX_SELF_RESIZES = 60
      let selfResizes = 0
      let rafId: number | null = null

      const measure = () => {
        rafId = null
        const body = iframeDoc.body
        const html = iframeDoc.documentElement
        if (!body || !html) return
        // `scrollHeight` of either body or html — pick the larger because
        // some content (e.g. fixed-position children) only contributes to
        // one of the two.
        const target = Math.max(body.scrollHeight, html.scrollHeight)
        const current = parseFloat(iframe.style.height || '0')
        if (Math.abs(current - target) <= 0.5) {
          // Layout settled — clear the budget so the next genuine change
          // gets a fresh fit.
          selfResizes = 0
          return
        }
        // Not settling after many consecutive self-driven resizes → this is
        // a viewport-unit feedback loop. Stop writing to break it.
        if (selfResizes >= MAX_SELF_RESIZES) return
        iframe.style.height = `${target}px`
        selfResizes += 1
      }
      const scheduleMeasure = () => {
        if (rafId === null) rafId = requestAnimationFrame(measure)
      }

      // First fit runs synchronously so the frame doesn't flash at the
      // ~150px default height before the first rAF lands.
      measure()

      // ResizeObserver fires for any layout change inside the iframe — font
      // load reflow, image decode/lazy-load, authored style edits, and our
      // own height writes (hence the self-resize cap above).
      const ro = new ResizeObserver(scheduleMeasure)
      ro.observe(iframeDoc.body)
      ro.observe(iframeDoc.documentElement)
      // MutationObserver covers structural edits (nodes added/removed, text
      // changed) and injected-CSS replacements (the class/user-style tags in
      // <head>), resetting the self-resize budget so a real change always
      // re-fits. We deliberately do NOT observe `attributes`: the canvas
      // toggles selection/hover `data-*`/`aria-*` attributes on every pointer
      // move, and re-measuring (a forced reflow) on each of those was a
      // second, hover-driven source of jank on large pages.
      const mo = new MutationObserver(() => {
        selfResizes = 0
        scheduleMeasure()
      })
      mo.observe(iframeDoc.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
      })
      return () => {
        if (rafId !== null) cancelAnimationFrame(rafId)
        ro.disconnect()
        mo.disconnect()
      }
    }, [iframeDoc, isLive])

    // ── Forward wheel events to the canvas gesture layer ─────────────────
    // Without this, scrolling the wheel while the cursor is over an iframe
    // does nothing — the iframe document doesn't propagate wheel events to
    // the parent. The canvas pan/zoom gesture handlers live in the parent
    // document, attached to the canvas root via useGesture; they need
    // wheel events at the parent's coordinate system. We forward by
    // listening inside the iframe and re-dispatching a new WheelEvent on
    // the iframe element itself (in the parent doc), so it bubbles to the
    // canvas root and useGesture's handler picks it up.
    useEffect(() => {
      // Live frames scroll natively — no pan to forward to.
      if (isLive) return
      if (!iframeDoc) return
      const iframe = iframeRef.current
      if (!iframe) return
      const onWheel = (e: WheelEvent) => {
        // Prevent the iframe from doing its own scroll (should be a no-op
        // since we sized the iframe to content, but defensive).
        e.preventDefault()
        const rect = iframe.getBoundingClientRect()
        // Re-emit at the iframe's outer client position so handlers in the
        // parent doc see screen-space coordinates consistent with the
        // user's pointer.
        const clientX = rect.left + (e.clientX || 0)
        const clientY = rect.top + (e.clientY || 0)
        const forwarded = new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaZ: e.deltaZ,
          deltaMode: e.deltaMode,
          clientX,
          clientY,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        })
        iframe.dispatchEvent(forwarded)
      }
      // `passive: false` so we can preventDefault on the iframe-internal
      // wheel — otherwise Chrome lets the iframe do its own scroll first.
      iframeDoc.addEventListener('wheel', onWheel, { passive: false })
      return () => {
        iframeDoc.removeEventListener('wheel', onWheel)
      }
    }, [iframeDoc, isLive])

    // ── Forward pointer events for canvas pan gestures + reorder drag ────
    // The canvas pan gesture (useCanvas via @use-gesture) and the canvas
    // reorder drag (useCanvasReorderDrag) both live in the parent document
    // and rely on `window` pointer events. Three scenarios need to cross
    // the iframe boundary from inside the iframe back to the parent:
    //
    //   1. Middle-click drag (`e.button === 1`) — always a pan, regardless
    //      of where the cursor is.
    //   2. Space + left-click drag (Figma convention) — pan when the user
    //      is holding space, even with the cursor over a frame.
    //   3. An active reorder drag started outside the iframe (the
    //      selection toolbar's drag handle lives in the parent doc). The
    //      pointer down fires in the parent, then as the cursor enters an
    //      iframe its pointermove/up events go to the iframe instead of
    //      bubbling up to `window`. `useCanvasReorderDrag` sets
    //      `data-pb-canvas-dragging` on `<html>` so each iframe knows to
    //      forward pointermove / up / cancel events while the drag is in
    //      flight. The drag id is also stashed so we can mint forwarded
    //      events with the matching pointerId.
    //
    // For (2) we mirror the spacebar tracking that lives inside `useCanvas`
    // but install it on the iframe document so the iframe knows whether
    // space is currently held. When pointerdown fires with space active,
    // we (a) forward the event so the canvas pan handler sees it, and
    // (b) `preventDefault` so the iframe doesn't also send the original
    // pointer event into module selection logic (otherwise a module would
    // get selected while the user was trying to pan).
    useEffect(() => {
      // Pan-gesture / reorder-drag relay is canvas-only. Live frames neither
      // pan nor host the cross-frame reorder drag.
      if (isLive) return
      if (!iframeDoc) return
      const iframe = iframeRef.current
      if (!iframe) return
      let spaceHeld = false
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.code === 'Space' && !e.repeat) spaceHeld = true
        // Block Tab navigation inside the canvas iframe. The author is
        // designing, not using, the page — letting Tab walk through
        // link / button controls inside the iframe surface the browser's
        // default focus outline and traps the keyboard inside the
        // preview. The canvas exposes its own keyboard model
        // (arrow keys / Cmd+navigation) at the parent level.
        if (e.key === 'Tab') {
          e.preventDefault()
          e.stopPropagation()
        }
      }
      const onKeyUp = (e: KeyboardEvent) => {
        if (e.code === 'Space') spaceHeld = false
      }
      iframeDoc.addEventListener('keydown', onKeyDown)
      iframeDoc.addEventListener('keyup', onKeyUp)

      const forwardPointer = (e: PointerEvent, overridePointerId?: number) => {
        const rect = iframe.getBoundingClientRect()
        const clientX = rect.left + (e.clientX || 0)
        const clientY = rect.top + (e.clientY || 0)
        const forwarded = new PointerEvent(e.type, {
          bubbles: true,
          cancelable: true,
          pointerId: overridePointerId ?? e.pointerId,
          pointerType: e.pointerType,
          button: e.button,
          buttons: e.buttons,
          clientX,
          clientY,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
        })
        iframe.dispatchEvent(forwarded)
      }
      const isCanvasDragActive = (): { pointerId: number } | null => {
        const html = iframe.ownerDocument?.documentElement
        if (!html) return null
        if (html.dataset.pbCanvasDragging !== '1') return null
        const id = Number(html.dataset.pbCanvasDraggingPointerId ?? NaN)
        return Number.isFinite(id) ? { pointerId: id } : { pointerId: 0 }
      }
      // True while a pan gesture started inside this iframe is still in
      // flight (middle-click hold OR space+left-click hold). We start a
      // pan on pointerdown when the conditions match and keep forwarding
      // every subsequent pointermove / pointerup for the same pointerId
      // until the button comes back up. This is the only way to know that
      // a stray pointermove is "part of an active pan" — `e.buttons` is 0
      // on the final pointerup, and using `e.button === 0` to detect "left
      // is down during move" matches every casual mouse motion (because
      // pointermove always reports `button` as 0). Tracking explicitly is
      // the only correct option.
      let panPointerId: number | null = null
      const isPanStartPointer = (e: PointerEvent): boolean => {
        // Middle button down — middle-click pan.
        if (e.button === 1) return true
        // Space + left button down — Figma-style pan.
        if (spaceHeld && e.button === 0) return true
        return false
      }
      const maybeForward = (e: PointerEvent) => {
        // (3) An external reorder drag is in progress — forward move/up/
        // cancel so the parent's `window` listeners keep ticking.
        // pointerdown is excluded: the iframe never originates the drag,
        // and forwarding the first iframe-internal pointerdown would
        // confuse the parent's session state.
        const dragSignal = isCanvasDragActive()
        if (dragSignal && (e.type === 'pointermove' || e.type === 'pointerup' || e.type === 'pointercancel')) {
          // The iframe-internal event is harmless on its own (no selection
          // logic listens for raw pointermove inside the iframe), so we
          // don't swallow it — but we do forward it to the parent doc with
          // the original drag's pointerId so the session-id check in
          // useCanvasReorderDrag is consistent.
          forwardPointer(e, dragSignal.pointerId)
          return
        }

        if (e.type === 'pointerdown' && isPanStartPointer(e)) {
          panPointerId = e.pointerId
          // Space + left-click: swallow the original so the click doesn't
          // also trigger module selection. Middle-click never selects
          // anything so it doesn't need swallowing.
          if (spaceHeld && e.button === 0) {
            e.preventDefault()
            e.stopPropagation()
          }
          forwardPointer(e)
          return
        }

        if (panPointerId !== null && e.pointerId === panPointerId) {
          if (e.type === 'pointermove') {
            if (spaceHeld) {
              e.preventDefault()
              e.stopPropagation()
            }
            forwardPointer(e)
            return
          }
          if (e.type === 'pointerup' || e.type === 'pointercancel') {
            forwardPointer(e)
            panPointerId = null
            return
          }
        }
      }
      iframeDoc.addEventListener('pointerdown', maybeForward)
      iframeDoc.addEventListener('pointermove', maybeForward)
      iframeDoc.addEventListener('pointerup', maybeForward)
      iframeDoc.addEventListener('pointercancel', maybeForward)
      return () => {
        iframeDoc.removeEventListener('keydown', onKeyDown)
        iframeDoc.removeEventListener('keyup', onKeyUp)
        iframeDoc.removeEventListener('pointerdown', maybeForward)
        iframeDoc.removeEventListener('pointermove', maybeForward)
        iframeDoc.removeEventListener('pointerup', maybeForward)
        iframeDoc.removeEventListener('pointercancel', maybeForward)
      }
    }, [iframeDoc, isLive])

    const dataAttrSpread = dataAttrs
      ? Object.fromEntries(
          Object.entries(dataAttrs).filter(([, v]) => v !== undefined),
        )
      : {}

    // Frame viewport for canvas viewport-unit resolution. Width is the
    // breakpoint width (the iframe's real width); height is a fixed
    // device-like value. Pinning `vh`/`vmax`/… to this stops authored
    // viewport units from feeding the grow-to-content height loop above.
    const viewport: CanvasViewport = { width, height: CANVAS_VIEWPORT_HEIGHT }

    return (
      <>
        <iframe
          ref={attachIframeDoc}
          // `srcDoc` is what creates the iframe document; an empty
          // `<html><body>` so we can portal React content into the body.
          srcDoc={IFRAME_SRC_DOC}
          className={cn(styles.iframe, isLive && styles.iframeLive, className)}
          // Canvas frames are sized to the breakpoint width and grow to content
          // height. Live frames fill the surface-controlled wrapper and scroll
          // internally, so they take 100% in both axes.
          style={isLive ? { ...style, width: '100%', height: '100%' } : { ...style, width: `${width}px` }}
          title={`Canvas frame for ${breakpointId}`}
          {...dataAttrSpread}
          // Allow the same-origin policy so the parent can read/write the
          // iframe's document. `allow-scripts` so authored script modules
          // (and React itself, via portal) can run.
        />
        {iframeDoc &&
          createPortal(
            <>
              {/* Editor-chrome stylesheet — UNLAYERED so it beats @layer user-authored author CSS */}
              <EditorChromeInjector targetDocument={iframeDoc} parentDocument={document} />
              {/* Author CSS — both wrapped in @layer user-authored inside the injectors */}
              <ClassStyleInjector targetDocument={iframeDoc} viewport={viewport} />
              <UserStylesheetInjector targetDocument={iframeDoc} viewport={viewport} />
              {children}
              {/* Runtime scripts (opt-in) run against the node tree mounted
                  above. Empty list = no-op, so this is safe to always mount. */}
              <RuntimeScriptInjector targetDocument={iframeDoc} scripts={runtimeScripts ?? EMPTY_RUNTIME_SCRIPTS} />
            </>,
            iframeDoc.body,
          )}
      </>
    )
  },
)

/**
 * Tag the iframe body with the breakpoint id, break the
 * `:where(html, body) { height: 100% }` reset rule so the iframe height can
 * track its content height instead of getting locked into a feedback loop
 * (iframe sized to body which is sized to 100% of iframe), and inject the
 * canvas-only chrome stylesheet.
 *
 * Canvas chrome stylesheet
 * ────────────────────────
 * Lives in the iframe `<head>` so it only affects canvas content — the
 * published page never sees these rules. Each rule turns off a piece of
 * default browser behaviour that fights the "canvas is a click-to-select
 * preview surface" model:
 *
 *  - `cursor: default` — the iframe is a design surface, not a reading
 *    surface. Author gets the same arrow cursor everywhere instead of
 *    the I-beam flicker on text and the pointer flicker on links.
 *  - `user-select: none` — text selection on click-drag inside the
 *    iframe just fights the canvas's click-to-select-node interaction.
 *    Disabled outright; copy-paste of authored content isn't a canvas
 *    workflow.
 *  - `outline: none` on focus — the canvas draws its own selection ring
 *    via `BreakpointSelectionOverlay`. The browser's default focus
 *    outline on the authored link / button control / body would just
 *    double-up and clash with the canvas chrome.
 *  - `iframe { pointer-events: none }` — authored modules may render
 *    their own embedded iframes (YouTube embeds, custom HTML, etc.). In
 *    the canvas we want pan / scroll / selection gestures to keep
 *    working when the cursor is over those nested iframes — disabling
 *    pointer events on them makes the canvas behave consistently.
 *
 * The `*, *::before, *::after` selector has higher specificity than the
 * publisher reset's `:where()` rules and overrides anything authored
 * unless the user explicitly opts back in (e.g. `cursor: pointer` on a
 * class will not survive — that's the trade-off and it matches Figma's
 * "preview is not interactive" model).
 *
 * Lives at module scope so the React Compiler doesn't flag the cross-frame
 * DOM writes as mutating React state — these mutate the iframe's document,
 * not anything React owns.
 */
const CANVAS_CHROME_CSS = [
  '*, *::before, *::after {',
  '  cursor: default !important;',
  '  user-select: none !important;',
  '  -webkit-user-select: none !important;',
  '  -webkit-tap-highlight-color: transparent !important;',
  '}',
  '*:focus, *:focus-visible {',
  '  outline: none !important;',
  '}',
  'iframe { pointer-events: none; }',
].join('\n')

function applyIframeBodyReset(
  iframeDoc: Document,
  breakpointId: string,
  interaction: IframeInteraction,
): void {
  iframeDoc.body.setAttribute('data-breakpoint-id', breakpointId)
  // Live frames render the page exactly as published: html/body keep the
  // `:where(html, body) { height: 100% }` reset (the iframe is the scroll
  // viewport, short pages still fill it), and the canvas-chrome CSS
  // (cursor / user-select / nested-iframe overrides) is NOT applied — real
  // cursors, text selection, and embedded iframes behave like the live site.
  if (interaction === 'live') return
  iframeDoc.documentElement.style.height = 'auto'
  iframeDoc.body.style.height = 'auto'
  let chrome = iframeDoc.head.querySelector('style[data-pb-canvas-chrome]')
  if (!chrome) {
    chrome = iframeDoc.createElement('style')
    chrome.setAttribute('data-pb-canvas-chrome', '')
    chrome.textContent = CANVAS_CHROME_CSS
    iframeDoc.head.appendChild(chrome)
  }
}
