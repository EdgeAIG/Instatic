import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { selectSelectedNode, useEditorStore } from '@core/editor-store/store'
import { cssClassSelector } from '@core/page-tree/classNames'
import { generatedClassKindLabel, isGeneratedClass, isGeneratedClassLocked } from '@core/page-tree/classUtils'
import type { CSSClass } from '@core/page-tree/schemas'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@ui/components/ContextMenu'
import { EmptyState } from '@ui/components/EmptyState'
import { FilterBar, type FilterBarItem } from '@ui/components/FilterBar'
import { Input } from '@ui/components/Input'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { Copy2SharpIcon } from 'pixel-art-icons/icons/copy-2-sharp'
import { DeleteIcon } from 'pixel-art-icons/icons/delete'
import { EditIcon } from 'pixel-art-icons/icons/edit'
import { FilePlusIcon } from 'pixel-art-icons/icons/file-plus'
import { PaintBucketIcon } from 'pixel-art-icons/icons/paint-bucket'
import { PanelHeader } from '../shared/PanelHeader'
import dialogStyles from '../SiteCreateDialog/SiteCreateDialog.module.css'
import {
  formatSelectorUsage,
  getReusableClasses,
  getSelectorStyleSummary,
  getSelectorUsage,
} from './selectorUsage'
import styles from './SelectorsPanel.module.css'

interface SelectorsPanelProps {
  variant?: 'docked'
}

type SelectorFilter = 'all' | 'user' | 'utility'

const SELECTOR_FILTER_ITEMS: FilterBarItem<SelectorFilter>[] = [
  { value: 'all', label: 'All' },
  { value: 'user', label: 'User' },
  { value: 'utility', label: 'Utility' },
]

interface ContextMenuState {
  x: number
  y: number
  classId: string
}

function keyboardMenuPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + Math.min(rect.width - 8, 24),
    y: rect.top + Math.min(rect.height - 8, 24),
  }
}

function normalizeClassNameInput(value: string) {
  const trimmed = value.trim()
  return (trimmed.startsWith('.') ? trimmed.slice(1) : trimmed).trim()
}

function selectorInputValue(className: string) {
  return className ? `.${className}` : ''
}

function getEmptyFilterMessage(filter: SelectorFilter, query: string): string {
  const normalized = query.trim()
  if (normalized) return `No selectors match “${normalized}”.`
  if (filter === 'user') return 'No user selectors yet.'
  if (filter === 'utility') return 'No utility selectors yet.'
  return 'No selectors match the current filters.'
}

export function SelectorsPanel({ variant = 'docked' }: SelectorsPanelProps) {
  const site = useEditorStore((s) => s.site)
  const isOpen = useEditorStore((s) => s.selectorsPanelOpen)
  const selectedSelectorClassId = useEditorStore((s) => s.selectedSelectorClassId)
  const setSelectorsPanelOpen = useEditorStore((s) => s.setSelectorsPanelOpen)
  const setSelectedSelectorClassId = useEditorStore((s) => s.setSelectedSelectorClassId)
  const setActiveClass = useEditorStore((s) => s.setActiveClass)
  const setPropertiesPanel = useEditorStore((s) => s.setPropertiesPanel)
  const setFocusedPanel = useEditorStore((s) => s.setFocusedPanel)
  const createClass = useEditorStore((s) => s.createClass)
  const renameClass = useEditorStore((s) => s.renameClass)
  const duplicateClass = useEditorStore((s) => s.duplicateClass)
  const deleteClass = useEditorStore((s) => s.deleteClass)
  const addNodeClass = useEditorStore((s) => s.addNodeClass)
  const removeNodeClass = useEditorStore((s) => s.removeNodeClass)
  const selectedNode = useEditorStore(selectSelectedNode)
  const selectedNodeId = useEditorStore((s) => s.selectedNodeId)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<SelectorFilter>('all')
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<CSSClass | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CSSClass | null>(null)

  const reusableClasses = useMemo(
    () => getReusableClasses(site?.classes ?? {}),
    [site?.classes],
  )
  const filteredClasses = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return reusableClasses.filter((cls) => {
      if (filter === 'user' && isGeneratedClass(cls)) return false
      if (filter === 'utility' && !isGeneratedClass(cls)) return false
      if (normalized && !cls.name.toLowerCase().includes(normalized)) return false
      return true
    })
  }, [filter, query, reusableClasses])
  const selectedClass = reusableClasses.find((cls) => cls.id === selectedSelectorClassId) ?? null
  const contextClass = contextMenu ? site?.classes[contextMenu.classId] ?? null : null

  useEffect(() => {
    if (selectedSelectorClassId && !selectedClass) {
      setSelectedSelectorClassId(null)
    }
  }, [selectedSelectorClassId, selectedClass, setSelectedSelectorClassId])

  if (!isOpen || variant !== 'docked') return null

  function openContextMenu(classId: string, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, classId })
  }

  function openKeyboardContextMenu(classId: string, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ ...keyboardMenuPosition(event.currentTarget), classId })
  }

  function openSelectorInProperties(classId: string) {
    setSelectedSelectorClassId(classId)
    setActiveClass(classId)
    setPropertiesPanel({ collapsed: false })
    setFocusedPanel('properties')
  }

  function handleCreate(name: string) {
    const cls = createClass(name)
    openSelectorInProperties(cls.id)
    setCreateDialogOpen(false)
  }

  function handleRename(name: string) {
    if (!renameTarget) return
    if (isGeneratedClassLocked(renameTarget)) return
    renameClass(renameTarget.id, name)
    setRenameTarget(null)
  }

  function handleDuplicate(cls: CSSClass) {
    if (isGeneratedClassLocked(cls)) {
      setContextMenu(null)
      return
    }
    const copy = duplicateClass(cls.id)
    if (copy) {
      openSelectorInProperties(copy.id)
    }
    setContextMenu(null)
  }

  function handleApplyToSelected(cls: CSSClass) {
    if (!selectedNodeId) return
    addNodeClass(selectedNodeId, cls.id)
    setContextMenu(null)
  }

  function handleRemoveFromSelected(cls: CSSClass) {
    if (!selectedNodeId) return
    removeNodeClass(selectedNodeId, cls.id)
    setContextMenu(null)
  }

  function handleCopySelector(cls: CSSClass) {
    void navigator.clipboard?.writeText(cssClassSelector(cls))
    setContextMenu(null)
  }

  function handleDelete(cls: CSSClass) {
    if (isGeneratedClassLocked(cls)) return
    deleteClass(cls.id)
    setDeleteTarget(null)
  }

  return (
    <>
      <aside
        role="complementary"
        aria-label="Selectors"
        data-panel=""
        data-testid="selectors-panel"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className={styles.panel}
      >
        <PanelHeader
          panelId="selectors"
          title="Selectors"
          onClose={() => setSelectorsPanelOpen(false)}
        >
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label="Create selector"
            tooltip="Create selector"
            onClick={() => setCreateDialogOpen(true)}
          >
            <FilePlusIcon size={13} aria-hidden="true" />
          </Button>
        </PanelHeader>

        <div className={styles.content}>
          <FilterBar<SelectorFilter>
            items={SELECTOR_FILTER_ITEMS}
            value={filter}
            onValueChange={setFilter}
            search={{
              value: query,
              onValueChange: setQuery,
              onClear: () => setQuery(''),
              placeholder: 'Search selectors',
              ariaLabel: 'Search selectors',
            }}
            groupLabel="Selector type"
          />

          {reusableClasses.length === 0 ? (
            <EmptyState
              title="No reusable selectors yet."
              action={
                <Button variant="secondary" size="sm" onClick={() => setCreateDialogOpen(true)}>
                  Create selector
                </Button>
              }
            />
          ) : filteredClasses.length === 0 ? (
            <EmptyState title={getEmptyFilterMessage(filter, query)} />
          ) : (
            <div className={styles.rows} aria-label="Reusable selectors">
              {filteredClasses.map((cls) => (
                <SelectorRow
                  key={cls.id}
                  cls={cls}
                  active={selectedSelectorClassId === cls.id}
                  usage={formatSelectorUsage(getSelectorUsage(site, cls.id))}
                  summary={getSelectorStyleSummary(cls)}
                  onSelect={() => openSelectorInProperties(cls.id)}
                  onContextMenu={(event) => openContextMenu(cls.id, event)}
                  onKeyDown={(event) => openKeyboardContextMenu(cls.id, event)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {contextMenu && contextClass && (
        <SelectorContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          selectedNodeHasClass={Boolean(selectedNode?.classIds?.includes(contextClass.id))}
          selectedNodeId={selectedNodeId}
          onClose={() => setContextMenu(null)}
          onEdit={() => {
            openSelectorInProperties(contextClass.id)
            setContextMenu(null)
          }}
          onRename={() => {
            if (!isGeneratedClassLocked(contextClass)) setRenameTarget(contextClass)
            setContextMenu(null)
          }}
          onDuplicate={() => handleDuplicate(contextClass)}
          onApply={() => handleApplyToSelected(contextClass)}
          onRemove={() => handleRemoveFromSelected(contextClass)}
          onCopy={() => handleCopySelector(contextClass)}
          onDelete={() => {
            if (!isGeneratedClassLocked(contextClass)) setDeleteTarget(contextClass)
            setContextMenu(null)
          }}
          locked={isGeneratedClassLocked(contextClass)}
        />
      )}

      {createDialogOpen && (
        <SelectorNameDialog
          title="Create selector"
          initialValue=""
          submitLabel="Create"
          onCancel={() => setCreateDialogOpen(false)}
          onSubmit={handleCreate}
        />
      )}

      {renameTarget && (
        <SelectorNameDialog
          title="Rename selector"
          initialValue={renameTarget.name}
          submitLabel="Save"
          onCancel={() => setRenameTarget(null)}
          onSubmit={handleRename}
        />
      )}

      {deleteTarget && (
        <DeleteSelectorDialog
          cls={deleteTarget}
          usage={formatSelectorUsage(getSelectorUsage(site, deleteTarget.id))}
          onCancel={() => setDeleteTarget(null)}
          onDelete={() => handleDelete(deleteTarget)}
        />
      )}
    </>
  )
}

interface SelectorRowProps {
  cls: CSSClass
  active: boolean
  usage: string
  summary: string
  onSelect: () => void
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

function SelectorRow({
  cls,
  active,
  usage,
  summary,
  onSelect,
  onContextMenu,
  onKeyDown,
}: SelectorRowProps) {
  const selectorLabel = `.${cls.name}`
  const kindLabel = generatedClassKindLabel(cls)

  return (
    <Button
      variant="ghost"
      size="sm"
      active={active}
      className={styles.row}
      aria-label={`Edit selector ${selectorLabel}`}
      onClick={onSelect}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
          return
        }
        onKeyDown(event)
      }}
    >
      <PaintBucketIcon size={13} aria-hidden="true" />
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{selectorLabel}</span>
        <span className={styles.rowMeta}>{summary}</span>
      </span>
      <span className={styles.rowAside}>
        {kindLabel && <span className={styles.utilityBadge}>{kindLabel}</span>}
        <span className={styles.rowUsage}>{usage}</span>
      </span>
    </Button>
  )
}

function SelectorContextMenu({
  x,
  y,
  selectedNodeHasClass,
  selectedNodeId,
  onClose,
  onEdit,
  onRename,
  onDuplicate,
  onApply,
  onRemove,
  onCopy,
  onDelete,
  locked,
}: {
  x: number
  y: number
  selectedNodeHasClass: boolean
  selectedNodeId: string | null
  onClose: () => void
  onEdit: () => void
  onRename: () => void
  onDuplicate: () => void
  onApply: () => void
  onRemove: () => void
  onCopy: () => void
  onDelete: () => void
  locked: boolean
}) {
  return (
    <ContextMenu x={x} y={y} ariaLabel="Selector actions" onClose={onClose}>
      <ContextMenuItem onClick={onEdit}>
        <span aria-hidden="true"><EditIcon size={13} /></span>
        {locked ? 'View utility' : 'Edit'}
      </ContextMenuItem>
      <ContextMenuItem disabled={locked} onClick={onRename}>
        <span aria-hidden="true"><EditIcon size={13} /></span>
        Rename
      </ContextMenuItem>
      <ContextMenuItem disabled={locked} onClick={onDuplicate}>
        <span aria-hidden="true"><Copy2SharpIcon size={13} /></span>
        Duplicate
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!selectedNodeId || selectedNodeHasClass} onClick={onApply}>
        <span aria-hidden="true"><PaintBucketIcon size={13} /></span>
        Apply to selected element
      </ContextMenuItem>
      <ContextMenuItem disabled={!selectedNodeId || !selectedNodeHasClass} onClick={onRemove}>
        <span aria-hidden="true"><CloseIcon size={13} /></span>
        Remove from selected element
      </ContextMenuItem>
      <ContextMenuItem onClick={onCopy}>
        <span aria-hidden="true"><Copy2SharpIcon size={13} /></span>
        Copy selector
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem danger disabled={locked} onClick={onDelete}>
        <span aria-hidden="true"><DeleteIcon size={13} /></span>
        Delete
      </ContextMenuItem>
    </ContextMenu>
  )
}

function SelectorNameDialog({
  title,
  initialValue,
  submitLabel,
  onCancel,
  onSubmit,
}: {
  title: string
  initialValue: string
  submitLabel: string
  onCancel: () => void
  onSubmit: (name: string) => void
}) {
  const [name, setName] = useState(selectorInputValue(initialValue))
  const [error, setError] = useState<string | null>(null)
  const trimmedName = normalizeClassNameInput(name)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmedName) return
    try {
      onSubmit(trimmedName)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\[[^\]]+\]\s*/, '') : 'Unable to save selector')
    }
  }

  return createPortal(
    <div
      className={dialogStyles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="selector-name-dialog-title"
        className={dialogStyles.dialog}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={dialogStyles.header}>
          <h2 id="selector-name-dialog-title" className={dialogStyles.title}>
            {title}
          </h2>
          <Button variant="ghost" size="xs" iconOnly aria-label="Close dialog" onClick={onCancel}>
            <CloseIcon size={12} aria-hidden="true" />
          </Button>
        </div>
        <form className={dialogStyles.form} onSubmit={handleSubmit}>
          <label className={dialogStyles.field}>
            <span className={dialogStyles.label}>Class name</span>
            <Input
              fieldSize="sm"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
              aria-label="Class name"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          {error && <p role="alert" className={dialogStyles.errorText}>{error}</p>}
          <div className={dialogStyles.actions}>
            <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" type="submit" disabled={!trimmedName}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}

function DeleteSelectorDialog({
  cls,
  usage,
  onCancel,
  onDelete,
}: {
  cls: CSSClass
  usage: string
  onCancel: () => void
  onDelete: () => void
}) {
  const selectorLabel = `.${cls.name}`

  return createPortal(
    <div
      className={dialogStyles.backdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-selector-dialog-title"
        className={dialogStyles.dialog}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={dialogStyles.header}>
          <h2 id="delete-selector-dialog-title" className={dialogStyles.title}>
            Delete selector
          </h2>
          <Button variant="ghost" size="xs" iconOnly aria-label="Close dialog" onClick={onCancel}>
            <CloseIcon size={12} aria-hidden="true" />
          </Button>
        </div>
        <div className={dialogStyles.form}>
          <p className={styles.dialogCopy}>
            Delete <span className={styles.dialogStrong}>{selectorLabel}</span>?
            This selector is {usage.toLowerCase()}.
          </p>
          <div className={dialogStyles.actions}>
            <Button variant="secondary" size="sm" type="button" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" type="button" onClick={onDelete}>
              Delete selector
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
