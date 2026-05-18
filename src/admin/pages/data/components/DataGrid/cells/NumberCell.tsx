import type { ReactElement } from 'react'
import { Input } from '@ui/components/Input'
import { readNumberCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'
import styles from './cells.module.css'

type NumberField = Extract<DataField, { type: 'number' }>

function getPrefix(field: NumberField): string | undefined {
  if (field.format === 'currency' && field.currency) return field.currency
  return undefined
}

function getUnit(field: NumberField): string | undefined {
  if (field.format === 'percent') return '%'
  return undefined
}

export function NumberCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  ariaLabel,
}: CellEditorProps<NumberField>): ReactElement {
  const numValue = readNumberCell({ [field.id]: value }, field.id)

  return (
    <Input
      className={styles.inputFull}
      type="number"
      value={numValue === null ? '' : numValue}
      readOnly={readOnly}
      aria-label={ariaLabel ?? field.label}
      min={field.min}
      max={field.max}
      step={field.integer ? 1 : (field.step ?? 'any')}
      prefix={getPrefix(field)}
      unit={getUnit(field)}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '' || raw === '-') {
          onChange(null)
        } else {
          const parsed = field.integer ? parseInt(raw, 10) : parseFloat(raw)
          onChange(Number.isFinite(parsed) ? parsed : null)
        }
      }}
      onBlur={() => onCommit?.()}
      onKeyDown={(e) => { if (e.key === 'Enter') onCommit?.() }}
    />
  )
}
