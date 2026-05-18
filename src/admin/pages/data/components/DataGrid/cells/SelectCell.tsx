import type { ReactElement } from 'react'
import { Select } from '@ui/components/Select'
import { readStringCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'

type SelectField = Extract<DataField, { type: 'select' }>

export function SelectCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  ariaLabel,
}: CellEditorProps<SelectField>): ReactElement {
  const selected = typeof value === 'string' ? value : readStringCell({ [field.id]: value }, field.id)

  const options = field.options.map((opt) => ({
    value: opt.id,
    label: opt.label,
  }))

  return (
    <Select
      value={selected}
      disabled={readOnly}
      aria-label={ariaLabel ?? field.label}
      placeholder={field.required ? undefined : '— none —'}
      options={options}
      onChange={(e) => {
        onChange(e.target.value === '' ? null : e.target.value)
        onCommit?.()
      }}
    />
  )
}
