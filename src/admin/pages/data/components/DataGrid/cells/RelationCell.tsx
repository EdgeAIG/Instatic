import type { ReactElement } from 'react'
import { Button } from '@ui/components/Button'
import { LinkIcon } from 'pixel-art-icons/icons/link'
import { readStringArrayCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField, DataRow } from '@core/data/schemas'
import styles from './cells.module.css'

type RelationField = Extract<DataField, { type: 'relation' }>

/**
 * RelationCell — renders a button that shows the current relation display
 * name and accepts an `onOpenPicker` prop for the parent to wire up a
 * RelationPickerDialog.
 *
 * The actual picker dialog is built by a separate agent. This component
 * stubs the opening behaviour so the cell editor contract is fulfilled.
 */
export interface RelationCellProps extends CellEditorProps<RelationField> {
  /** Called when the user wants to open the relation picker. */
  onOpenPicker?: () => void
}

function resolveDisplayName(
  ids: string[],
  isMulti: boolean,
  resolveRelationTarget: ((id: string) => DataRow | null) | undefined,
): string {
  if (ids.length === 0) return ''

  if (isMulti) {
    return `${ids.length} related`
  }

  const id = ids[0]
  if (!id) return ''
  if (!resolveRelationTarget) return id

  const target = resolveRelationTarget(id)
  if (!target) return id

  // Use the first non-empty string cell as the display value.
  const firstValue = Object.values(target.cells).find(
    (v): v is string => typeof v === 'string' && v !== '',
  )
  return firstValue ?? id
}

export function RelationCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  ariaLabel,
  resolveRelationTarget,
  onOpenPicker,
}: RelationCellProps): ReactElement {
  const isMulti = field.allowMultiple === true

  const currentIds: string[] = isMulti
    ? readStringArrayCell({ [field.id]: value }, field.id)
    : typeof value === 'string'
      ? [value]
      : []

  const hasValue = currentIds.length > 0
  const displayName = resolveDisplayName(currentIds, isMulti, resolveRelationTarget)

  function handleClear() {
    onChange(isMulti ? [] : null)
    onCommit?.()
  }

  return (
    <div className={styles.relationButton}>
      <Button
        variant="secondary"
        size="sm"
        disabled={readOnly}
        aria-label={ariaLabel ?? `${field.label}: ${hasValue ? displayName : 'No relation'}`}
        onClick={() => onOpenPicker?.()}
        align="start"
        fullWidth
      >
        <LinkIcon size={14} />
        {hasValue ? (
          <span>{displayName}</span>
        ) : (
          <span className={styles.relationEmpty}>Choose…</span>
        )}
      </Button>

      {hasValue && !readOnly && (
        <Button
          variant="ghost"
          size="xs"
          tooltip="Clear relation"
          aria-label="Clear relation"
          onClick={handleClear}
        >
          Clear
        </Button>
      )}
    </div>
  )
}
