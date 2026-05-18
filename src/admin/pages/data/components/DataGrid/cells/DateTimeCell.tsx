import type { ReactElement } from 'react'
import { Input } from '@ui/components/Input'
import { readStringCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'
import styles from './cells.module.css'

type DateTimeField = Extract<DataField, { type: 'dateTime' }>

export function DateTimeCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  ariaLabel,
}: CellEditorProps<DateTimeField>): ReactElement {
  const strValue = typeof value === 'string' ? value : readStringCell({ [field.id]: value }, field.id)

  // The <input type="datetime-local"> expects "YYYY-MM-DDTHH:mm" format.
  // ISO strings from the server include seconds / timezone — trim to minutes.
  const inputValue = strValue ? strValue.slice(0, 16) : ''

  return (
    <Input
      className={styles.inputFull}
      type="datetime-local"
      value={inputValue}
      readOnly={readOnly}
      aria-label={ariaLabel ?? field.label}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit?.()}
    />
  )
}
