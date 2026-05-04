/**
 * ConvertToComponentButton — inline control to convert a page node into a Visual Component.
 *
 * Two states:
 *   idle    → single "Componentize" Button (secondary, full-width).
 *   editing → inline Input + Create + Cancel strip with inline error display.
 *
 * Visibility is gated by the parent (PropertiesPanel) — this component is
 * rendered only on pages, for non-root, non-ref selected nodes.
 *
 * Architecture source: Contribution #619 Phase 3 §3
 * Constraint #269: may import from core/
 */

import { useState, useRef } from 'react'
import { useEditorStore } from '@core/editor-store/store'
import { VisualComponentNameError } from '@core/editor-store/slices/visualComponentsSlice'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import styles from './ConvertToComponentButton.module.css'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ConvertToComponentButtonProps {
  nodeId: string
}

// ---------------------------------------------------------------------------
// ConvertToComponentButton
// ---------------------------------------------------------------------------

export function ConvertToComponentButton({ nodeId }: ConvertToComponentButtonProps) {
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const convertNodeToComponent = useEditorStore((s) => s.convertNodeToComponent)

  function handleSubmit() {
    const name = inputRef.current?.value.trim() ?? ''
    if (!name) return
    try {
      convertNodeToComponent(nodeId, name)
      // On success: activeDocument switches to the new VC, panel rerenders,
      // this component unmounts — no further local state update needed.
    } catch (err) {
      if (err instanceof VisualComponentNameError) {
        setError(err.message)
      } else {
        setError(`Failed to convert: ${err instanceof Error ? err.message : 'Unknown error'}`)
      }
    }
  }

  if (!editing) {
    return (
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setEditing(true)}
      >
        Componentize
      </Button>
    )
  }

  // Editing state — span the full parent row so the inline Input + Create +
  // Cancel strip is not crammed into a half-column.
  return (
    <div className={styles.editingStrip}>
      <div className={styles.inputRow}>
        <Input
          ref={inputRef}
          fieldSize="sm"
          defaultValue=""
          placeholder="ComponentName"
          autoFocus
          aria-label="Component name"
          invalid={!!error}
          onChange={() => {
            if (error) setError(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleSubmit()
            }
            if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
              setError(null)
            }
          }}
        />
        <Button
          variant="primary"
          size="sm"
          onClick={handleSubmit}
        >
          Create
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setEditing(false)
            setError(null)
          }}
        >
          Cancel
        </Button>
      </div>
      {error !== null && (
        <div role="alert" className={styles.errorAlert}>
          {error}
        </div>
      )}
    </div>
  )
}
