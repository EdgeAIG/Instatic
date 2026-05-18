import type { ReactElement } from 'react'
import { Input } from '@ui/components/Input'
import { readStringCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'
import styles from './cells.module.css'

type DateField = Extract<DataField, { type: 'date' }>

export function DateCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  ariaLabel,
}: CellEditorProps<DateField>): ReactElement {
  // Store as ISO date string (YYYY-MM-DD). The <input type="date"> native
  // value is already in this format, so no conversion needed.
  const strValue = typeof value === 'string' ? value : readStringCell({ [field.id]: value }, field.id)

  return (
    <Input
      className={styles.inputFull}
      type="date"
      value={strValue}
      readOnly={readOnly}
      aria-label={ariaLabel ?? field.label}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit?.()}
    />
  )
}
