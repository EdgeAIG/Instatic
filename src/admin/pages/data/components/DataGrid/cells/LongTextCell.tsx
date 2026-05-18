import type { ReactElement } from 'react'
import { Input, Textarea } from '@ui/components/Input'
import { readStringCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'
import styles from './cells.module.css'

type LongTextField = Extract<DataField, { type: 'longText' }>

export function LongTextCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  context,
  ariaLabel,
}: CellEditorProps<LongTextField>): ReactElement {
  const strValue = typeof value === 'string' ? value : readStringCell({ [field.id]: value }, field.id)

  if (context === 'detail') {
    return (
      <Textarea
        className={styles.inputFull}
        value={strValue}
        readOnly={readOnly}
        aria-label={ariaLabel ?? field.label}
        resize="vertical"
        rows={4}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onCommit?.()}
      />
    )
  }

  return (
    <Input
      className={styles.inputFull}
      type="text"
      value={strValue}
      readOnly={readOnly}
      aria-label={ariaLabel ?? field.label}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => onCommit?.()}
      onKeyDown={(e) => { if (e.key === 'Enter') onCommit?.() }}
    />
  )
}
