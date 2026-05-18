/**
 * DataPage — the Data workspace top-level page.
 *
 * Composes the DataSidebar, DataCanvas, and DataInspector through
 * AdminCanvasLayout. Capability resolution mirrors ContentPage.
 */
import { Button } from '@ui/components/Button'
import { Settings2SolidIcon } from 'pixel-art-icons/icons/settings-2-solid'
import { AdminCanvasLayout } from '@admin/layouts'
import { useAuthenticatedAdminUser } from '@admin/sessionContext'
import { useNavigate } from '@admin/lib/routing'
import { useEditorStore } from '@site/store/store'
import { useConfirmDelete } from '@admin/shared/dialogs/ConfirmDeleteDialog'
import {
  canCreateContent,
  canEditAnyContent,
  canManageContentCollections,
} from '@admin/access'
import type { DataRow, DataRowCells, DataRowStatus } from '@core/data/schemas'
import { useDataWorkspace } from './hooks/useDataWorkspace'
import { DataSidebar } from './components/DataSidebar/DataSidebar'
import { DataCanvas } from './components/DataCanvas/DataCanvas'
import { DataInspector } from './components/DataInspector/DataInspector'
import { NewTableDialog } from './components/NewTableDialog/NewTableDialog'
import { useState } from 'react'
import styles from './DataPage.module.css'

// ---------------------------------------------------------------------------
// DataPage
// ---------------------------------------------------------------------------

export function DataPage() {
  const navigate = useNavigate()
  // Strict accessor — DataPage only renders inside `AuthenticatedAdmin`,
  // which gates the entire tree on a non-null session user. A null here
  // means the page rendered outside an `AdminSessionProvider`, which is a
  // programming error, not a permission state — fail loud, don't fail
  // open. (The previous code path silently treated null as an unrestricted
  // sentinel, which masked tests that forgot to wire the provider and
  // briefly painted full-admin UI in any session-rehydration race.)
  const permissionUser = useAuthenticatedAdminUser()

  const canEdit = canEditAnyContent(permissionUser)
  const canCreate = canCreateContent(permissionUser)
  const canManage = canManageContentCollections(permissionUser)
  const canDelete = canManage

  const workspace = useDataWorkspace()
  const setPropertiesPanel = useEditorStore((s) => s.setPropertiesPanel)
  const confirmDelete = useConfirmDelete()

  const [newTableDialogOpen, setNewTableDialogOpen] = useState(false)

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  function handleEditInContent(row: DataRow) {
    const table = workspace.selectedTable
    if (!table) return
    navigate('/admin/content?table=' + table.slug + '&row=' + row.id)
  }

  async function handleAddRow(): Promise<void> {
    try {
      const newRow = await workspace.createRow()
      workspace.selectRow(newRow.id)
    } catch (err) {
      console.error('[DataPage] Add row failed:', err)
    }
  }

  async function handleSaveRow(rowId: string, cells: DataRowCells) {
    return workspace.saveRow(rowId, cells)
  }

  function handleDeleteRow(rowId: string): void {
    const table = workspace.selectedTable
    const row = workspace.rows.find((r) => r.id === rowId)
    const primaryValue = row && table
      ? (typeof row.cells[table.primaryFieldId] === 'string'
          ? (row.cells[table.primaryFieldId] as string)
          : null)
      : null
    const label = primaryValue || 'row'

    confirmDelete({
      title: `Delete "${label}"?`,
      commit: () => {
        workspace.deleteRow(rowId).catch((err) => {
          console.error('[DataPage] Delete row failed:', err)
        })
      },
    })
  }

  function handleSelectRow(rowId: string | null) {
    workspace.selectRow(rowId)
    if (rowId !== null) {
      setPropertiesPanel({ collapsed: false })
    }
  }

  function handleOpenRow(rowId: string) {
    workspace.selectRow(rowId)
    setPropertiesPanel({ collapsed: false })
  }

  /**
   * Unified status setter for the DataGrid bulk-action bar. The workspace
   * exposes two endpoints — `publishRow` (transitions to 'published') and
   * `setRowStatus` (transitions to 'draft' | 'unpublished') — because the
   * server has separate routes for them. The grid only knows DataRowStatus,
   * so we dispatch here.
   */
  async function handleSetRowStatus(rowId: string, status: DataRowStatus): Promise<DataRow> {
    if (status === 'published') return workspace.publishRow(rowId)
    return workspace.setRowStatus(rowId, status)
  }

  // ---------------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------------

  const selectedTable = workspace.selectedTable

  const toolbarRightSlot = selectedTable ? (
    <div className={styles.toolbarSlot}>
      <Button
        variant="ghost"
        size="sm"
        pressed={workspace.selectedRowId === null}
        onClick={() => {
          workspace.selectRow(null)
          setPropertiesPanel({ collapsed: false })
        }}
      >
        <Settings2SolidIcon size={13} aria-hidden="true" />
        <span>Table settings</span>
      </Button>
    </div>
  ) : undefined

  // ---------------------------------------------------------------------------
  // Right panel (inspector)
  // ---------------------------------------------------------------------------

  const rightPanel = selectedTable ? (
    <DataInspector
      table={selectedTable}
      tables={workspace.tables}
      row={workspace.selectedRow}
      rows={workspace.rows}
      onSaveRow={handleSaveRow}
      onUpdateTable={async (input) => {
        return workspace.updateTable(selectedTable.id, input)
      }}
      onDeleteTable={async () => {
        await workspace.deleteTable(selectedTable.id)
      }}
      onEditInContent={handleEditInContent}
      onPublishRow={async (rowId) => workspace.publishRow(rowId)}
      onSetRowStatus={async (rowId, status) => workspace.setRowStatus(rowId, status)}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  ) : undefined

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <AdminCanvasLayout
        workspace="data"
        toolbarRightSlot={toolbarRightSlot}
        contentSidebar={(
          <DataSidebar
            tables={workspace.tables}
            loading={workspace.loadingTables}
            error={workspace.tablesError}
            selectedTableId={workspace.selectedTableId}
            onSelectTable={workspace.selectTable}
            onCreateTable={() => setNewTableDialogOpen(true)}
            canCreate={canCreate}
          />
        )}
        contentCanvas={(
          <DataCanvas
            table={selectedTable}
            tables={workspace.tables}
            rows={workspace.rows}
            loading={workspace.loadingRows}
            error={workspace.rowsError}
            selectedRowId={workspace.selectedRowId}
            onSelectRow={handleSelectRow}
            onAddRow={handleAddRow}
            onDeleteRow={handleDeleteRow}
            onEditInContent={handleEditInContent}
            onOpenRow={handleOpenRow}
            onSetRowStatus={handleSetRowStatus}
            canEdit={canEdit}
            canDelete={canDelete}
          />
        )}
        contentRightPanel={rightPanel}
      />

      {newTableDialogOpen && (
        <NewTableDialog
          open={newTableDialogOpen}
          onClose={() => setNewTableDialogOpen(false)}
          onCreate={async (input) => {
            await workspace.createTable(input)
            setNewTableDialogOpen(false)
          }}
        />
      )}
    </>
  )
}
