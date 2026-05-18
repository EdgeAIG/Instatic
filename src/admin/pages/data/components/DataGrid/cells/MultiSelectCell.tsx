import { useRef, useState, type MouseEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { readStringArrayCell } from '@core/data/cells'
import type { CellEditorProps } from '@admin/pages/data/types'
import type { DataField } from '@core/data/schemas'
import styles from './cells.module.css'

type MultiSelectField = Extract<DataField, { type: 'multiSelect' }>

export function MultiSelectCell({
  field,
  value,
  onChange,
  onCommit,
  readOnly,
  ariaLabel,
}: CellEditorProps<MultiSelectField>): ReactElement {
  const selected = readStringArrayCell({ [field.id]: value }, field.id)
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLElement | null>(null)

  function toggle(optionId: string) {
    const next = selected.includes(optionId)
      ? selected.filter((id) => id !== optionId)
      : [...selected, optionId]
    onChange(next)
    onCommit?.()
  }

  function removeChip(optionId: string, e: MouseEvent) {
    e.stopPropagation()
    const next = selected.filter((id) => id !== optionId)
    onChange(next)
    onCommit?.()
  }

  const selectedOptions = field.options.filter((o) => selected.includes(o.id))
  const buttonLabel = selected.length === 0
    ? 'Select options…'
    : `${selected.length} selected`

  return (
    <div className={styles.multiSelectWrapper}>
      {selectedOptions.map((opt) => (
        <span key={opt.id} className={styles.chip}>
          {opt.label}
          {!readOnly && (
            <Button
              variant="ghost"
              size="micro"
              iconOnly
              aria-label={`Remove ${opt.label}`}
              className={styles.chipRemove}
              onClick={(e) => removeChip(opt.id, e)}
            >
              ×
            </Button>
          )}
        </span>
      ))}

      {!readOnly && (
        <Button
          ref={(el) => { anchorRef.current = el }}
          variant="ghost"
          size="xs"
          aria-label={ariaLabel ?? `${field.label}: ${buttonLabel}`}
          aria-expanded={open}
          aria-haspopup="listbox"
          className={styles.multiSelectTrigger}
          onClick={() => setOpen((v) => !v)}
        >
          {selected.length === 0 ? '+ Add' : '+ More'}
        </Button>
      )}

      {open && createPortal(
        <ContextMenu
          ariaLabel={`${field.label} options`}
          anchorRef={anchorRef}
          side="auto"
          align="start"
          offset={4}
          minWidth={160}
          onClose={() => setOpen(false)}
        >
          {field.options.map((opt) => (
            <ContextMenuItem
              key={opt.id}
              role="option"
              aria-selected={selected.includes(opt.id)}
              onClick={() => toggle(opt.id)}
            >
              {selected.includes(opt.id) ? '✓ ' : '  '}
              {opt.label}
            </ContextMenuItem>
          ))}
        </ContextMenu>,
        document.body,
      )}
    </div>
  )
}
