/**
 * BreakpointFrame — a fixed-width viewport container for one breakpoint.
 *
 * Renders the page tree inside a frame sized to the breakpoint's width.
 * The frame appears as a device preview on the canvas.
 *
 * One BreakpointFrame is rendered per breakpoint, positioned side-by-side
 * on the canvas. All frames live inside CanvasTransformLayer and are therefore
 * panned/zoomed together by the CSS transform.
 *
 * Two render surfaces are mutually exclusive depending on `canvasView`:
 * - 'design'  → React-based <NodeRenderer> (live, fully reactive, no scripts)
 * - 'preview' → sandboxed runtime <CanvasRuntimePreview> (scripts run; manual refresh)
 *
 * They are never stacked. The previous overlay design caused scripts to
 * re-execute on every property edit because the iframe srcDoc had to be
 * replaced to reflect the live state — see the runtime dependencies design
 * doc, "Canvas Runtime Preview" section.
 *
 * In preview mode the frame chrome (label row) also surfaces a small status
 * pill + Refresh control next to the breakpoint label, so the iframe area
 * itself stays clean of UI overlays.
 */

import type { CSSProperties } from 'react'
import type { Page, Breakpoint } from '@core/page-tree/schemas'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { useEditorStore } from '@core/editor-store/store'
import { NodeRenderer } from './NodeRenderer'
import { CanvasBreakpointContext, CanvasTemplateContext } from './CanvasContexts'
import { CanvasRuntimePreview } from './CanvasRuntimePreview'
import {
  useRuntimePreviewBuild,
  type RuntimePreviewBuildState,
  type RuntimePreviewStatus,
} from './useRuntimePreviewBuild'
import { PlusBoxIcon } from 'pixel-art-icons/icons/plus-box'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
import { Tooltip } from '@ui/components/Tooltip'
import { cn } from '@ui/cn'
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
  const canvasView = useEditorStore((s) => s.canvasView)
  const isPreview = canvasView === 'preview'

  // Single source of truth for the iframe build. The hook is called even in
  // design mode but its `enabled` arg stops it from firing any work — keeps
  // hook-call order stable across renders without paying for unused fetches.
  const previewBuild = useRuntimePreviewBuild({
    page,
    breakpointId: breakpoint.id,
    templateContext,
    enabled: isPreview && isActive,
  })

  return (
    <div
      className={cn(styles.frameWrapper, isDimmed && styles.frameWrapperDimmed)}
      data-breakpoint-dimmed={isDimmed ? 'true' : undefined}
      style={bpStyle}
    >
      {/* Frame chrome row — breakpoint label and (in preview) status + refresh */}
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

        {isPreview && previewBuild.hasScripts && (
          <RuntimePreviewChromeStatus build={previewBuild} />
        )}
      </div>

      {/* Viewport frame */}
      <div
        data-breakpoint-id={breakpoint.id}
        data-canvas-view={canvasView}
        className={cn(styles.viewport, isActive && styles.viewportActive)}
        onClick={(e) => {
          // Click on empty frame area → activate this breakpoint
          onActivate(breakpoint.id)
          e.stopPropagation()
        }}
      >
        {isPreview ? (
          <CanvasRuntimePreview
            page={page}
            srcDoc={previewBuild.srcDoc}
            hasScripts={previewBuild.hasScripts}
          />
        ) : (
          <>
            {/* Empty canvas state — shown when page has only the root node */}
            {page.nodes[page.rootNodeId]?.children.length === 0 && (
              <EmptyCanvasState />
            )}

            <CanvasTemplateContext.Provider value={templateContext}>
              <CanvasBreakpointContext.Provider value={breakpoint.id}>
                <NodeRenderer nodeId={page.rootNodeId} />
              </CanvasBreakpointContext.Provider>
            </CanvasTemplateContext.Provider>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Runtime preview status pill — lives in the frame chrome row, not over the
// iframe. Shows a small "Live"/"Building"/"Runtime error" badge plus a
// Refresh button so the user can pull a fresh build after editing styles.
// ---------------------------------------------------------------------------

function statusLabel(status: RuntimePreviewStatus, build: RuntimePreviewBuildState): string {
  if (status === 'building') return 'Building'
  if (status === 'error') {
    return build.diagnostics[0]?.packageName ?? build.diagnostics[0]?.message ?? 'Runtime error'
  }
  if (status === 'idle') return 'Idle'
  return 'Live'
}

interface RuntimePreviewChromeStatusProps {
  build: RuntimePreviewBuildState
}

function RuntimePreviewChromeStatus({ build }: RuntimePreviewChromeStatusProps) {
  return (
    <div
      className={styles.runtimePreviewStatus}
      data-status={build.status}
      role="status"
      aria-live="polite"
      onClick={(e) => e.stopPropagation()}
    >
      <span className={styles.runtimePreviewStatusLabel}>
        {statusLabel(build.status, build)}
      </span>
      <Tooltip content="Rebuild preview from current site state">
        <button
          type="button"
          className={styles.runtimePreviewRefresh}
          onClick={(e) => {
            e.stopPropagation()
            build.refresh()
          }}
          disabled={build.status === 'building'}
          data-testid="canvas-runtime-preview-refresh"
          aria-label="Refresh preview"
        >
          Refresh
        </button>
      </Tooltip>
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
      icon={<PlusBoxIcon size={40} color="var(--editor-text-subtle)" />}
      title="Empty page"
      description="Add your first element using the toolbar."
    />
  )
}
