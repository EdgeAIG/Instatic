import { memo, useEffect, useMemo, useState } from 'react'
import { Button } from '@ui/components/Button'
import { Dialog } from '@ui/components/Dialog'
import { EmptyState } from '@ui/components/EmptyState'
import { SearchBar } from '@ui/components/SearchBar'
import { LoaderIcon } from 'pixel-art-icons/icons/loader'
import { listCmsDataRows } from '@core/persistence/cmsData'
import { readStringCell } from '@core/data/cells'
import type { DataRow, DataTable } from '@core/data/schemas'
import styles from './RelationPickerDialog.module.css'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RelationPickerDialogProps {
  open: boolean
  onClose: () => void
  targetTable: DataTable | null
  currentValue: string | string[] | null
  allowMultiple: boolean
  onPick: (next: string | string[] | null) => void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSelection(value: string | string[] | null): Set<string> {
  if (!value) return new Set()
  if (Array.isArray(value)) return new Set(value)
  return new Set([value])
}

function buildResult(selected: Set<string>, allowMultiple: boolean): string | string[] | null {
  if (selected.size === 0) return null
  const ids = [...selected]
  return allowMultiple ? ids : (ids[0] ?? null)
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const RelationPickerDialog = memo(function RelationPickerDialog({
  open,
  onClose,
  targetTable,
  currentValue,
  allowMultiple,
  onPick,
}: RelationPickerDialogProps) {
  const [rows, setRows] = useState<DataRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => normalizeSelection(currentValue))

  // Re-sync selection when dialog opens or currentValue changes
  useEffect(() => {
    if (open) {
      setSelected(normalizeSelection(currentValue))
    }
  }, [open, currentValue])

  // Load rows when dialog opens (or target table changes)
  useEffect(() => {
    if (!open || !targetTable) {
      setRows([])
      setLoading(false)
      setLoadError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError(null)
    setRows([])

    listCmsDataRows(targetTable.id)
      .then((fetched) => {
        if (cancelled) return
        setRows(fetched)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load rows')
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [open, targetTable])

  const primaryFieldId = targetTable?.primaryFieldId ?? ''

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.trim().toLowerCase()
    return rows.filter((row) =>
      readStringCell(row.cells, primaryFieldId).toLowerCase().includes(q),
    )
  }, [rows, search, primaryFieldId])

  function toggleRow(rowId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        if (!allowMultiple) {
          next.clear()
        }
        next.add(rowId)
      }
      return next
    })
  }

  function handleConfirm() {
    onPick(buildResult(selected, allowMultiple))
    onClose()
  }

  function handleClose() {
    setSearch('')
    onClose()
  }

  const title =
    targetTable == null
      ? 'Pick relation'
      : allowMultiple
        ? `Pick ${targetTable.pluralLabel}`
        : `Pick ${targetTable.singularLabel}`

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title={title}
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" type="button" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="button"
            onClick={handleConfirm}
            disabled={targetTable == null}
          >
            Confirm
          </Button>
        </>
      }
    >
      {targetTable == null ? (
        <EmptyState
          title="No target table configured"
          description="Set a target table on the relation field to pick rows."
          variant="centered"
        />
      ) : (
        <div className={styles.body}>
          <SearchBar
            value={search}
            onValueChange={setSearch}
            placeholder={`Search ${targetTable.pluralLabel.toLowerCase()}…`}
            className={styles.search}
          />

          {loading && (
            <div className={styles.loadingState} role="status" aria-label="Loading rows">
              <LoaderIcon size={16} aria-hidden="true" />
            </div>
          )}

          {!loading && loadError && (
            <EmptyState
              title="Could not load rows"
              description={loadError}
              variant="card"
            />
          )}

          {!loading && !loadError && filteredRows.length === 0 && (
            <EmptyState
              title={search ? 'No matches' : `No ${targetTable.pluralLabel.toLowerCase()} yet`}
              description={search ? 'Try a different search term.' : undefined}
              variant="card"
            />
          )}

          {!loading && !loadError && filteredRows.length > 0 && (
            <div className={styles.list} role="listbox" aria-multiselectable={allowMultiple}>
              {filteredRows.map((row) => {
                const displayValue = readStringCell(row.cells, primaryFieldId) || row.id
                const isSelected = selected.has(row.id)
                return (
                  <Button
                    key={row.id}
                    variant="ghost"
                    size="sm"
                    pressed={isSelected}
                    fullWidth
                    align="start"
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggleRow(row.id)}
                  >
                    <span className={styles.rowLabel}>{displayValue}</span>
                  </Button>
                )
              })}
            </div>
          )}
        </div>
      )}
    </Dialog>
  )
})
