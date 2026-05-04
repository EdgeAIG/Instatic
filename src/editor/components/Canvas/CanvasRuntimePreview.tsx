/**
 * CanvasRuntimePreview — presentational shell for the sandboxed runtime
 * iframe. Owns no state of its own; receives the build output from the
 * parent (BreakpointFrame), which calls useRuntimePreviewBuild and also
 * renders the status pill in the frame's chrome row so the iframe area
 * itself stays uncluttered.
 *
 * Renders one of three things:
 * - Nothing (no scripts to run yet — empty-state copy)
 * - Nothing (build hasn't produced an srcDoc yet — caller should also be
 *   rendering a "Building" indicator in the frame chrome)
 * - The actual sandboxed iframe
 */

import type { Page } from '@core/page-tree/schemas'
import { EmptyState } from '@ui/components/EmptyState'
import styles from './BreakpointFrame.module.css'

interface CanvasRuntimePreviewProps {
  page: Page
  srcDoc: string
  hasScripts: boolean
}

export function CanvasRuntimePreview({ page, srcDoc, hasScripts }: CanvasRuntimePreviewProps) {
  if (!hasScripts) {
    return (
      <EmptyState
        variant="centered"
        className={styles.emptyState}
        title="Nothing to preview"
        description="Add a script in the Site explorer and enable “Run in canvas” to test it here."
      />
    )
  }

  if (!srcDoc) return null

  return (
    <iframe
      title={`Runtime preview: ${page.title}`}
      data-testid="canvas-runtime-preview"
      className={styles.runtimePreviewFrame}
      srcDoc={srcDoc}
      sandbox="allow-scripts"
    />
  )
}
