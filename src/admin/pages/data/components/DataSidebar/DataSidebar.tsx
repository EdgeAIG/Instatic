/**
 * DataSidebar — left panel listing all data tables for the Data workspace.
 *
 * Renders the table list, loading/error states, and a "New table" CTA.
 * Uses the canonical Panel primitive for the inner panel slot — consistent
 * with the site editor's docked panels. The outer <aside> (rail + resize
 * handle) follows the LeftSidebar layout pattern.
 */
import { useRef, type CSSProperties } from 'react'
import { Button } from '@ui/components/Button'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { PlusIcon } from 'pixel-art-icons/icons/plus'
import { useEditorStore } from '@site/store/store'
import { Panel } from '@admin/shared/Panel'
import { SidebarResizeHandle } from '@admin/shared/SidebarResizeHandle'
import leftSidebarStyles from '@site/sidebars/LeftSidebar/LeftSidebar.module.css'
import panelRailStyles from '@site/sidebars/PanelRail/PanelRail.module.css'
import type { DataTable } from '@core/data/schemas'
import styles from './DataSidebar.module.css'

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DataSidebarProps {
  tables: DataTable[]
  loading: boolean
  error: string | null
  selectedTableId: string | null
  onSelectTable: (tableId: string) => void
  onCreateTable: () => void
  canCreate: boolean
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataSidebar({
  tables,
  loading,
  error,
  selectedTableId,
  onSelectTable,
  onCreateTable,
  canCreate,
}: DataSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const leftSidebarWidth = useEditorStore((s) => s.leftSidebarWidth)
  const setLeftSidebarWidth = useEditorStore((s) => s.setLeftSidebarWidth)
  const dataSidebarCollapsed = useEditorStore((s) => s.dataSidebarCollapsed)
  const setDataSidebarCollapsed = useEditorStore((s) => s.setDataSidebarCollapsed)

  // When collapsed, the panel slot collapses to zero-width (rail stays visible).
  const panelWidth = dataSidebarCollapsed ? 0 : leftSidebarWidth

  const style = {
    '--left-sidebar-panel-width': `${panelWidth}px`,
  } as CSSProperties

  return (
    <aside
      ref={sidebarRef}
      className={leftSidebarStyles.sidebar}
      data-testid="data-left-sidebar"
      data-expanded={dataSidebarCollapsed ? 'false' : 'true'}
      style={style}
    >
      {/* Rail — single icon representing the data panel */}
      <nav
        aria-label="Data panel dock"
        className={panelRailStyles.rail}
        data-testid="data-panel-rail"
      >
        <div className={panelRailStyles.itemGroup}>
          <Button
            variant="ghost"
            size="md"
            iconOnly
            pressed={!dataSidebarCollapsed}
            aria-label="Data tables panel"
            tooltip="Data tables panel"
            data-testid="data-panel-rail-tables"
            data-icon="database"
            data-accent="sky"
            onClick={() => setDataSidebarCollapsed(dataSidebarCollapsed ? false : true)}
            className={panelRailStyles.railButton}
          >
            <span className={panelRailStyles.activeIndicator} aria-hidden="true" />
            <DatabaseSolidIcon size={16} className={panelRailStyles.railIcon} />
          </Button>
        </div>
      </nav>

      {/* Panel slot */}
      <div
        className={leftSidebarStyles.panelSlot}
        data-testid="data-left-sidebar-panel-slot"
        aria-hidden={dataSidebarCollapsed ? 'true' : undefined}
      >
        <div className={leftSidebarStyles.panelMount}>
          <Panel
            panelId="data-tables"
            title="Data tables"
            body="bare"
            onClose={() => setDataSidebarCollapsed(true)}
          >
            <div className={styles.tableList} role="listbox" aria-label="Data tables">
              {loading && (
                <p className={styles.loadingText} aria-live="polite">
                  Loading…
                </p>
              )}

              {!loading && error && (
                <p role="alert" className={styles.errorText}>
                  {error}
                </p>
              )}

              {!loading && !error && tables.length === 0 && (
                <p className={styles.emptyText}>No tables yet.</p>
              )}

              {tables.map((table) => {
                const selected = table.id === selectedTableId
                return (
                  <Button
                    key={table.id}
                    variant="ghost"
                    size="sm"
                    fullWidth
                    align="start"
                    pressed={selected}
                    role="option"
                    aria-selected={selected}
                    onClick={() => onSelectTable(table.id)}
                    className={styles.tableButton}
                  >
                    <DatabaseSolidIcon size={13} aria-hidden="true" />
                    <span className={styles.tableLabel}>{table.pluralLabel}</span>
                    <span className={styles.kindBadge}>
                      {table.kind === 'postType' ? 'post-type' : 'data'}
                    </span>
                  </Button>
                )
              })}
            </div>

            {canCreate && (
              <div className={styles.footer}>
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  onClick={onCreateTable}
                >
                  <PlusIcon size={12} aria-hidden="true" />
                  <span>New table</span>
                </Button>
              </div>
            )}
          </Panel>
        </div>
      </div>

      <SidebarResizeHandle
        side="left"
        width={leftSidebarWidth}
        targetRef={sidebarRef}
        cssVariable="--left-sidebar-panel-width"
        ariaLabel="Resize data sidebar"
        onResize={setLeftSidebarWidth}
      />
    </aside>
  )
}
