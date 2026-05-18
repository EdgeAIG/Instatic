import type { DataField, DataRow, DataRowCells } from '@core/data/schemas'

export type CellEditorContext = 'grid' | 'detail'

/**
 * Uniform props for every cell editor.
 * Each concrete editor narrows `TField` to its specific `DataField` variant.
 */
export interface CellEditorProps<TField extends DataField = DataField> {
  field: TField
  /** Raw cell value from `row.cells[field.id]`. */
  value: unknown
  /** Updates draft state in memory. */
  onChange: (next: unknown) => void
  /** Blur / enter — caller persists the draft. */
  onCommit?: () => void
  readOnly?: boolean
  /** 'grid' = compact single-line; 'detail' = expanded, full-width. */
  context: CellEditorContext
  rowId?: string
  ariaLabel?: string
  /** Lookup helper for relation cells (id → row in the target table). */
  resolveRelationTarget?: (rowId: string) => DataRow | null
}

/**
 * Lightweight shape for an in-memory draft of a single row's cells.
 * Consumed by `useDataRowDraft`.
 */
export interface RowDraftState {
  cells: DataRowCells
  isDirty: boolean
  isSaving: boolean
  saveError: string | null
}
