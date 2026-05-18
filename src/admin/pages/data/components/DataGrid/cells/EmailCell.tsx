import type { ReactElement } from 'react'
import { Input } from '@ui/components/Input'
import { readStringCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'
import styles from './cells.module.css'

type EmailField = Extract<DataField, { type: 'email' }>

export function EmailCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  ariaLabel,
}: CellEditorProps<EmailField>): ReactElement {
  const strValue = typeof value === 'string' ? value : readStringCell({ [field.id]: value }, field.id)

  return (
    <Input
      className={styles.inputFull}
      type="email"
      value={strValue}
      readOnly={readOnly}
      aria-label={ariaLabel ?? field.label}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit?.()}
      onKeyDown={(e) => { if (e.key === 'Enter') onCommit?.() }}
    />
  )
}
