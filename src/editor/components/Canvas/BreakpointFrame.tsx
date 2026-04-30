/**
 * BreakpointFrame — a fixed-width viewport container for one breakpoint.
 *
 * Renders the page tree inside a frame sized to the breakpoint's width.
 * The frame appears as a device preview on the canvas.
 *
 * One BreakpointFrame is rendered per breakpoint, positioned side-by-side
 * on the canvas. All frames live inside CanvasTransformLayer and are therefore
 * panned/zoomed together by the CSS transform.
 */

import type { CSSProperties } from 'react'
import type { Page, Breakpoint } from '../../../core/page-tree/types'
import { CanvasBreakpointContext, NodeRenderer } from './NodeRenderer'
import { Icon } from '../../../ui/icons/Icon'
import { Button } from '@ui/components/Button'
import { cn } from '@ui/cn'
import styles from './BreakpointFrame.module.css'

interface BreakpointFrameProps {
  page: Page
  breakpoint: Breakpoint
  isActive: boolean
  onActivate: (breakpointId: string) => void
}

export function BreakpointFrame({
  page,
  breakpoint,
  isActive,
  onActivate,
}: BreakpointFrameProps) {
  // --bp-width drives both label width and viewport width via CSS (dynamic value)
  const bpStyle = { '--bp-width': `${breakpoint.width}px` } as CSSProperties

  return (
    <div className={styles.frameWrapper} style={bpStyle}>
      {/* Breakpoint label bar */}
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

      {/* Viewport frame */}
      <div
        data-breakpoint-id={breakpoint.id}
        className={cn(styles.viewport, isActive && styles.viewportActive)}
        onClick={(e) => {
          // Click on empty frame area → activate this breakpoint
          onActivate(breakpoint.id)
          e.stopPropagation()
        }}
      >
        {/* Empty canvas state — shown when page has only the root node */}
        {page.nodes[page.rootNodeId]?.children.length === 0 && (
          <EmptyCanvasState />
        )}

        <CanvasBreakpointContext.Provider value={breakpoint.id}>
          <NodeRenderer nodeId={page.rootNodeId} />
        </CanvasBreakpointContext.Provider>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty canvas onboarding state (UX Reviewer guideline)
// ---------------------------------------------------------------------------

function EmptyCanvasState() {
  return (
    <div className={styles.emptyState}>
      <Icon name="plus-box" size={40} color="var(--editor-text-subtle)" />
      <p className={styles.emptyTitle}>Empty page</p>
      <p className={styles.emptyHint}>
        Add your first element using the toolbar.
      </p>
    </div>
  )
}
