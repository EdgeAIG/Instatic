/**
 * BreakpointFrame — a fixed-width design-mode viewport for one breakpoint.
 *
 * Renders the page tree inside a frame sized to the breakpoint's width.
 * One BreakpointFrame is rendered per breakpoint, positioned side-by-side
 * inside CanvasTransformLayer (so they're panned/zoomed together).
 *
 * The viewport itself is an iframe (see `IframeFrameSurface`) so the
 * canvas DOM matches the published HTML exactly — `body` is the page body,
 * not the editor chrome. See `docs/features/canvas-iframe-per-frame.md`
 * for the rationale.
 *
 * BreakpointFrame is the design-canvas frame (one per breakpoint, panned and
 * zoomed together). Live mode renders a single real-size frame in its own
 * surface (CanvasLiveSurface) using the same `IframeFrameSurface` with
 * `interaction="live"`. Both can run the site's runtime scripts when the
 * "Run scripts" toggle is on — see `runtimeScripts`.
 */

import { useRef, useState, type CSSProperties } from 'react'
import type { Page, Breakpoint } from '@core/page-tree'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { NodeRenderer } from './NodeRenderer'
import { BreakpointSelectionOverlay } from './BreakpointSelectionOverlay'
import { CanvasBreakpointContext, CanvasTemplateContext } from './CanvasContexts'
import { IframeFrameSurface, type IframeFrameSurfaceHandle } from './IframeFrameSurface'
import type { InjectableRuntimeScript } from './useRuntimeScriptBuild'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import { useEditorPermissions } from '@site/editorPermissionsContext'
import styles from './BreakpointFrame.module.css'

interface BreakpointFrameProps {
  page: Page
  breakpoint: Breakpoint
  isActive: boolean
  isDimmed?: boolean
  onActivate: (breakpointId: string) => void
  templateContext?: TemplateRenderDataContext
  /** Opt-in runtime scripts injected into this frame; empty/undefined = none. */
  runtimeScripts?: InjectableRuntimeScript[]
}

export function BreakpointFrame({
  page,
  breakpoint,
  isActive,
  isDimmed = false,
  onActivate,
  templateContext,
  runtimeScripts,
}: BreakpointFrameProps) {
  // --bp-width drives both label width and viewport width via CSS (dynamic value)
  const bpStyle = { '--bp-width': `${breakpoint.width}px` } as CSSProperties

  // Outer viewport `<div>` wrapping the iframe. The selection overlay still
  // measures the viewport (not the iframe) for zoom/pan/toolbar positioning;
  // the iframe handle below is just for translating *inside-iframe* element
  // rects into editor coordinates.
  const viewportRef = useRef<HTMLDivElement | null>(null)
  // Handle to the iframe surface; the selection overlay reads the iframe
  // element so it can translate inside-iframe element rects into editor
  // viewport coordinates.
  const iframeHandleRef = useRef<IframeFrameSurfaceHandle | null>(null)
  // Track the iframe element separately for the selection overlay's
  // `getBoundingClientRect()` call. State (not ref) so the overlay re-renders
  // when the iframe mounts.
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null)

  // Breakpoint chrome (active highlight + label-click-to-activate) is a style
  // editing affordance — picking the "active" breakpoint controls where per-
  // breakpoint style overrides land. Hidden for content-only Clients and
  // pure Viewers; they get plain frames without an active-state outline.
  const permissions = useEditorPermissions()
  const breakpointChromeVisible = permissions.canEditStyle || permissions.canEditStructure

  const handleIframeRef = (handle: IframeFrameSurfaceHandle | null) => {
    iframeHandleRef.current = handle
    setIframeEl(handle?.iframeElement ?? null)
  }

  const handleEmptyFrameClick = () => {
    if (!breakpointChromeVisible) return
    onActivate(breakpoint.id)
  }

  return (
    <div
      className={cn(styles.frameWrapper, isDimmed && styles.frameWrapperDimmed)}
      data-breakpoint-dimmed={isDimmed ? 'true' : undefined}
      data-testid={`canvas-frame-${breakpoint.id}`}
      style={bpStyle}
    >
      {/* Frame chrome row — breakpoint label.
          Hidden for non-editors: the label button activates a per-breakpoint
          override target, which only makes sense when the caller can edit
          styles or structure. */}
      {breakpointChromeVisible && (
        <div className={styles.labelRow}>
          <Button
            variant="ghost"
            size="sm"
            pressed={isActive}
            onClick={() => onActivate(breakpoint.id)}
            className={styles.labelBtn}
            aria-label={`Switch to ${breakpoint.label} breakpoint`}
            data-testid={`canvas-frame-activate-${breakpoint.id}`}
            aria-pressed={isActive}
          >
            {breakpoint.label}
            <span className={styles.pxBadge}>{breakpoint.width}px</span>
          </Button>
        </div>
      )}

      {/* Iframe viewport — see IframeFrameSurface for why this is an iframe
          instead of a plain `<div>`. The outer wrapper div is still here so
          the selection overlay has a positioning context and so the
          breakpoint's `data-breakpoint-id` is observable to canvas-level
          DOM tools that don't cross the iframe boundary. */}
      <div
        ref={viewportRef}
        data-breakpoint-id={breakpoint.id}
        className={cn(
          styles.viewport,
          isActive && breakpointChromeVisible && styles.viewportActive,
        )}
      >
        <IframeFrameSurface
          ref={handleIframeRef}
          breakpointId={breakpoint.id}
          width={breakpoint.width}
          onClick={handleEmptyFrameClick}
          runtimeScripts={runtimeScripts}
        >
          <CanvasTemplateContext.Provider value={templateContext}>
            <CanvasBreakpointContext.Provider value={breakpoint.id}>
              <NodeRenderer nodeId={page.rootNodeId} />
            </CanvasBreakpointContext.Provider>
          </CanvasTemplateContext.Provider>
        </IframeFrameSurface>

        {/* Selection / hover rings — rendered in the parent document but
            positioned over the iframe. The overlay handles the iframe-rect
            → editor-viewport coordinate translation. */}
        <BreakpointSelectionOverlay
          breakpointId={breakpoint.id}
          viewportRef={viewportRef}
          iframeElement={iframeEl}
        />
      </div>
    </div>
  )
}
