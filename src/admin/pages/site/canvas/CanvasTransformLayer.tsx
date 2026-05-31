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

import type { Ref } from 'react'
import type { Page, Breakpoint } from '@core/page-tree'
import type { TemplateRenderDataContext } from '@core/templates/dynamicBindings'
import { BreakpointFrame } from './BreakpointFrame'
import type { InjectableRuntimeScript } from './useRuntimeScriptBuild'
import styles from './CanvasTransformLayer.module.css'

interface CanvasTransformLayerProps {
  page: Page | null
  breakpoints: Breakpoint[]
  activeBreakpointId: string
  dimInactiveBreakpoints?: boolean
  onBreakpointActivate: (id: string) => void
  templateContext?: TemplateRenderDataContext
  /** Opt-in runtime scripts injected into every frame; empty/undefined = none. */
  runtimeScripts?: InjectableRuntimeScript[]
  /** React 19: ref is a regular prop on function components. */
  ref?: Ref<HTMLDivElement>
}

export function CanvasTransformLayer({
  page,
  breakpoints,
  activeBreakpointId,
  dimInactiveBreakpoints = false,
  onBreakpointActivate,
  templateContext,
  runtimeScripts,
  ref,
}: CanvasTransformLayerProps) {
  return (
    <div
      ref={ref}
      data-testid="canvas-transform-layer"
      // GPU promotion (will-change) is applied imperatively + transiently by
      // useCanvas during active gestures — not permanently — to avoid wrapping
      // the whole subtree into one oversized layer backing that leaves content
      // blank at scale/low zoom. See WILL_CHANGE_RELEASE_MS in useCanvas.ts.
      className={styles.transformLayer}
    >
      {page ? (
        // Only breakpoints flagged for a preview frame render an iframe on the
        // canvas (`previewFrame !== false`; undefined = framed for back-compat).
        // Frame-less breakpoints are still selectable editing contexts in the
        // toolbar switcher and still publish their @media CSS — they just don't
        // spawn an editor iframe.
        breakpoints
          .filter((bp) => bp.previewFrame !== false)
          .map((bp) => (
            <BreakpointFrame
              key={bp.id}
              page={page}
              breakpoint={bp}
              isActive={activeBreakpointId === bp.id}
              isDimmed={dimInactiveBreakpoints && activeBreakpointId !== bp.id}
              onActivate={onBreakpointActivate}
              templateContext={templateContext}
              runtimeScripts={runtimeScripts}
            />
          ))
      ) : (
        <NoSiteState />
      )}
    </div>
  )
}

function NoSiteState() {
  return (
    <div className={styles.noSite}>
      Loading site...
    </div>
  )
}
