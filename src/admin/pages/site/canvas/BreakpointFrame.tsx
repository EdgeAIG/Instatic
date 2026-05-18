/**
 * BreakpointFrame — a fixed-width design-mode viewport for one breakpoint.
 *
 * Renders the page tree inside a frame sized to the breakpoint's width.
 * One BreakpointFrame is rendered per breakpoint, positioned side-by-side
 * inside CanvasTransformLayer (so they're panned/zoomed together).
 *
 * Frame is design-only after the canvas-view redesign: preview mode now
 * lives in its own surface (CanvasPreviewSurface) which owns a single
 * full-bleed iframe instead of one iframe per breakpoint frame. See the
 * "Canvas Preview Surface" architecture note in CanvasPreviewSurface.tsx
 * for why preview no longer reuses these frames.
 */

import { useRef, type CSSProperties } from 'react'
import type { Page, Breakpoint } from '@core/page-tree/schemas'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { NodeRenderer } from './NodeRenderer'
import { BreakpointSelectionOverlay } from './BreakpointSelectionOverlay'
import { CanvasBreakpointContext, CanvasTemplateContext } from './CanvasContexts'
import { PlusBoxSolidIcon } from 'pixel-art-icons/icons/plus-box-solid'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
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
}

export function BreakpointFrame({
  page,
  breakpoint,
  isActive,
  isDimmed = false,
  onActivate,
  templateContext,
}: BreakpointFrameProps) {
  // --bp-width drives both label width and viewport width via CSS (dynamic value)
  const bpStyle = { '--bp-width': `${breakpoint.width}px` } as CSSProperties

  // Ref to the viewport `<div>` — passed to the selection overlay so ring
  // positions are computed relative to this frame (handles canvas pan/zoom
  // for free, since the viewport itself is transformed with the canvas).
  const viewportRef = useRef<HTMLDivElement>(null)

  // Breakpoint chrome (active highlight + label-click-to-activate) is a style
  // editing affordance — picking the "active" breakpoint controls where per-
  // breakpoint style overrides land. Hidden for content-only Clients and
  // pure Viewers; they get plain frames without an active-state outline.
  const permissions = useEditorPermissions()
  const breakpointChromeVisible = permissions.canEditStyle || permissions.canEditStructure

  return (
    <div
      className={cn(styles.frameWrapper, isDimmed && styles.frameWrapperDimmed)}
      data-breakpoint-dimmed={isDimmed ? 'true' : undefined}
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
          >
            {breakpoint.label}
            <span className={styles.pxBadge}>{breakpoint.width}px</span>
          </Button>
        </div>
      )}

      {/* Viewport frame */}
      <div
        ref={viewportRef}
        data-breakpoint-id={breakpoint.id}
        className={cn(
          styles.viewport,
          // Only style/structure editors see the "active breakpoint" outline.
          isActive && breakpointChromeVisible && styles.viewportActive,
        )}
        onClick={(e) => {
          if (!breakpointChromeVisible) return
          // Click on empty frame area → activate this breakpoint
          onActivate(breakpoint.id)
          e.stopPropagation()
        }}
      >
        {/* Empty canvas state — shown only when the page is a base.body
            wrapper with no children. Visual Components whose rootNode is
            not base.body (e.g. a single Button converted via Componentize)
            use the rootNode itself as the rendered content, so the empty
            state would be misleading there. */}
        {(() => {
          const rootNode = page.nodes[page.rootNodeId]
          return rootNode?.moduleId === 'base.body' && rootNode.children.length === 0
            ? <EmptyCanvasState />
            : null
        })()}

        <CanvasTemplateContext.Provider value={templateContext}>
          <CanvasBreakpointContext.Provider value={breakpoint.id}>
            <NodeRenderer nodeId={page.rootNodeId} />
          </CanvasBreakpointContext.Provider>
        </CanvasTemplateContext.Provider>

        {/* Selection / hover rings, rendered as an absolutely-positioned
            overlay so the wrapper divs (`NodeWrapper`) can stay
            `display: contents`. See BreakpointSelectionOverlay.tsx. */}
        <BreakpointSelectionOverlay
          breakpointId={breakpoint.id}
          viewportRef={viewportRef}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty canvas onboarding state (UX Reviewer guideline)
// ---------------------------------------------------------------------------

function EmptyCanvasState() {
  return (
    <EmptyState
      variant="centered"
      className={styles.emptyState}
      icon={<PlusBoxSolidIcon size={40} color="var(--editor-text-subtle)" />}
      title="Empty page"
      description="Add your first element using the toolbar."
    />
  )
}
