import { useState, type ReactElement } from 'react'
import { Button } from '@ui/components/Button'
import { ExternalLinkSolidIcon } from 'pixel-art-icons/icons/external-link-solid'
import { CellEditorRenderer } from '@admin/pages/data/components/DataGrid/cells/CellEditorRenderer'
import { RelationPickerDialog } from '@admin/pages/data/components/RelationPickerDialog/RelationPickerDialog'
import { useDataRowDraft } from '@admin/pages/data/hooks/useDataRowDraft'
import { emptyCellValue } from '@admin/pages/data/utils/fieldDefaults'
import type { DataTable, DataRow, DataRowCells } from '@core/data/schemas'
import type { DataField } from '@core/data/schemas'
import styles from './DataInspector.module.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RowDetailProps {
  row: DataRow
  table: DataTable
  tables: DataTable[]
  onSaveRow: (rowId: string, cells: DataRowCells) => Promise<DataRow>
  onEditInContent?: (row: DataRow) => void
  onPublishRow?: (rowId: string) => Promise<DataRow>
  onSetRowStatus?: (rowId: string, status: 'draft' | 'unpublished') => Promise<DataRow>
  /** Resolve a row id to a row object for display in relation cells. */
  resolveRow: (rowId: string) => DataRow | null
  canEdit: boolean
}

interface PickerState {
  fieldId: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function statusPillClass(status: DataRow['status']): string {
  switch (status) {
    case 'published': return styles.statusPublished
    case 'unpublished': return styles.statusUnpublished
    default: return styles.statusDraft
  }
}

function statusLabel(status: DataRow['status']): string {
  switch (status) {
    case 'published': return 'Published'
    case 'unpublished': return 'Unpublished'
    default: return 'Draft'
  }
}

function authorDisplayName(row: DataRow): string {
  const user = row.author ?? row.createdBy ?? row.updatedBy
  if (user?.displayName) return user.displayName
  if (user?.email) return user.email
  return '—'
}

// ---------------------------------------------------------------------------
// PostType card
// ---------------------------------------------------------------------------

function PostTypeCard({
  row,
  table,
  onEditInContent,
}: {
  row: DataRow
  table: DataTable
  onEditInContent?: (row: DataRow) => void
}): ReactElement {
  const primaryValue = typeof row.cells[table.primaryFieldId] === 'string'
    ? (row.cells[table.primaryFieldId] as string)
    : row.id

  return (
    <div className={styles.section}>
      <div className={styles.postTypeCard}>
        <div className={styles.postTypeTitleRow}>
          <span className={styles.postTypeTitle}>{primaryValue || '(untitled)'}</span>
          <span className={`${styles.statusPill} ${statusPillClass(row.status)}`}>
            {statusLabel(row.status)}
          </span>
        </div>

        <Button
          variant="primary"
          size="sm"
          fullWidth
          onClick={() => onEditInContent?.(row)}
          disabled={!onEditInContent}
          aria-label={`Edit ${primaryValue} in Content`}
        >
          <ExternalLinkSolidIcon size={12} aria-hidden="true" />
          Edit in Content
        </Button>
      </div>

      <div className={styles.metaBlock}>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Created</span>
          <span className={styles.metaValue}>{formatDate(row.createdAt)}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Updated</span>
          <span className={styles.metaValue}>{formatDate(row.updatedAt)}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Published</span>
          <span className={styles.metaValue}>{formatDate(row.publishedAt)}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaKey}>Author</span>
          <span className={styles.metaValue}>{authorDisplayName(row)}</span>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data row form
// ---------------------------------------------------------------------------

function DataRowForm({
  row,
  table,
  tables,
  onSaveRow,
  resolveRow,
  canEdit,
}: {
  row: DataRow
  table: DataTable
  tables: DataTable[]
  onSaveRow: (rowId: string, cells: DataRowCells) => Promise<DataRow>
  resolveRow: (rowId: string) => DataRow | null
  canEdit: boolean
}): ReactElement {
  const draft = useDataRowDraft(row, onSaveRow)
  const [pickerState, setPickerState] = useState<PickerState | null>(null)

  // Derive picker props from pickerState
  const pickerField: DataField | null = pickerState
    ? (table.fields.find((f) => f.id === pickerState.fieldId) ?? null)
    : null

  const pickerTargetTable = pickerField?.type === 'relation'
    ? (tables.find((t) => t.id === pickerField.targetTableId) ?? null)
    : null

  const pickerCurrentValue = pickerState
    ? ((draft.cells[pickerState.fieldId] ?? null) as string | string[] | null)
    : null

  const pickerAllowMultiple = pickerField?.type === 'relation'
    ? (pickerField.allowMultiple ?? false)
    : false

  return (
    <>
      <div className={styles.section}>
        {table.fields.map((field) => (
          <label key={field.id} className={styles.formGroup}>
            <span className={styles.label}>{field.label}</span>
            {field.description && (
              <span className={styles.labelDescription}>{field.description}</span>
            )}
            <CellEditorRenderer
              field={field}
              value={draft.cells[field.id] ?? emptyCellValue(field)}
              onChange={(next) => draft.setCell(field.id, next)}
              onCommit={() => void draft.flush()}
              context="detail"
              readOnly={!canEdit}
              rowId={row.id}
              resolveRelationTarget={resolveRow}
              onOpenPicker={
                field.type === 'relation'
                  ? () => setPickerState({ fieldId: field.id })
                  : undefined
              }
            />
          </label>
        ))}

        <div className={styles.saveStatus} aria-live="polite" aria-atomic="true">
          {draft.isSaving && (
            <span className={styles.savingText}>Saving…</span>
          )}
          {!draft.isSaving && draft.saveError && (
            <span className={styles.saveErrorText} role="alert">{draft.saveError}</span>
          )}
          {!draft.isSaving && !draft.saveError && !draft.isDirty && (
            <span className={styles.savedText}>Saved</span>
          )}
        </div>
      </div>

      <RelationPickerDialog
        open={pickerState !== null}
        onClose={() => setPickerState(null)}
        targetTable={pickerTargetTable}
        currentValue={pickerCurrentValue}
        allowMultiple={pickerAllowMultiple}
        onPick={(next) => {
          if (pickerState) {
            draft.setCell(pickerState.fieldId, next)
            void draft.flush()
          }
          setPickerState(null)
        }}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// RowDetail
// ---------------------------------------------------------------------------

export function RowDetail({
  row,
  table,
  tables,
  onSaveRow,
  onEditInContent,
  onPublishRow: _onPublishRow,
  onSetRowStatus: _onSetRowStatus,
  resolveRow,
  canEdit,
}: RowDetailProps): ReactElement {
  if (table.kind === 'postType') {
    return (
      <PostTypeCard
        row={row}
        table={table}
        onEditInContent={onEditInContent}
      />
    )
  }

  return (
    <DataRowForm
      row={row}
      table={table}
      tables={tables}
      onSaveRow={onSaveRow}
      resolveRow={resolveRow}
      canEdit={canEdit}
    />
  )
}
