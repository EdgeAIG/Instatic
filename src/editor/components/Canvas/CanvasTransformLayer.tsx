/**
 * CanvasTransformLayer — the div that receives the CSS transform.
 *
 * This is the ONLY element whose style.transform is mutated during pan/zoom.
 * It contains all BreakpointFrames positioned side-by-side.
 *
 * Performance note: CSS transform (translate + scale) is composited on the GPU.
 * Mutating its `style.transform` via a ref (not React state) avoids React re-renders.
 * See useCanvas.ts for the RAF-batched write pattern.
 */

import { forwardRef } from 'react'
import type { Page, Breakpoint } from '../../../core/page-tree/types'
import type { TemplateRenderDataContext } from '../../../core/templates/dynamicBindings'
import { BreakpointFrame } from './BreakpointFrame'
import { cn } from '@ui/cn'
import styles from './CanvasTransformLayer.module.css'

interface CanvasTransformLayerProps {
  page: Page | null
  breakpoints: Breakpoint[]
  activeBreakpointId: string
  onBreakpointActivate: (id: string) => void
  templateContext?: TemplateRenderDataContext
}

export const CanvasTransformLayer = forwardRef<HTMLDivElement, CanvasTransformLayerProps>(
  function CanvasTransformLayer(
    { page, breakpoints, activeBreakpointId, onBreakpointActivate, templateContext },
    ref,
  ) {
    return (
      <div
        ref={ref}
        data-testid="canvas-transform-layer"
        // will-change toggled via modifier class (avoids compositing overhead on empty canvas)
        className={cn(styles.transformLayer, page && styles.transformLayerActive)}
      >
        {page ? (
          breakpoints.map((bp) => (
            <BreakpointFrame
              key={bp.id}
              page={page}
              breakpoint={bp}
              isActive={activeBreakpointId === bp.id}
              onActivate={onBreakpointActivate}
              templateContext={templateContext}
            />
          ))
        ) : (
          <NoSiteState />
        )}
      </div>
    )
  },
)

function NoSiteState() {
  return (
    <div className={styles.noSite}>
      Loading site...
    </div>
  )
}
