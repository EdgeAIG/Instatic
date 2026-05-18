import type { ReactElement } from 'react'
import { Switch } from '@ui/components/Switch'
import { readBooleanCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'
import styles from './cells.module.css'

type BooleanField = Extract<DataField, { type: 'boolean' }>

export function BooleanCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  ariaLabel,
}: CellEditorProps<BooleanField>): ReactElement {
  const checked = readBooleanCell({ [field.id]: value }, field.id)

  return (
    <div className={styles.booleanGrid}>
      <Switch
        checked={checked}
        disabled={readOnly}
        aria-label={ariaLabel ?? field.label}
        onCheckedChange={(next) => {
          onChange(next)
          onCommit?.()
        }}
      />
      <span className={styles.booleanLabel} aria-hidden="true">
        {checked ? 'Yes' : 'No'}
      </span>
    </div>
  )
}
