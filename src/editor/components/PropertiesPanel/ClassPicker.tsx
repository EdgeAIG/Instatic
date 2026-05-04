/**
 * ClassPicker — always-visible class chip manager.
 *
 * Replaces ClassesTab in the Properties Panel redesign (Spec #659 §2).
 * Now permanently visible (no tab click required — PP-2 acceptance criterion).
 *
 * Changes vs. ClassesTab:
 *   - Pill right-click context menu owns reorder/rename/remove actions — PP-8
 *   - Chip × has tooltip="Remove from this element" — PP-9
 *   - Class assignment UI lives directly under the selected element header
 *   - Uses reorderNodeClass store action (new in classSlice — Task #456)
 *
 * Architecture:
 *   - Always mounted when a node is selected (PropertiesPanel renders it unconditionally)
 *   - Active class styling is rendered by PropertiesPanel below the header class strip
 *   - Guideline #242: reorderNodeClass no-ops at array boundaries
 *   - Guideline #350: pixel-art-icons only; CloseIcon for × button
 *   - Constraint #451: X/Twitter logo icon is prohibited (use CloseIcon for × buttons)
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { useEditorStore, selectActiveCanvasPage } from '@core/editor-store/store'
import {
  readClassHoverPreviewPreference,
  subscribeToEditorPrefsChanged,
} from '../../preferences/editorPreferences'
import { Button } from '@ui/components/Button'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@ui/components/ContextMenu'
import { Input } from '@ui/components/Input'
import { ChevronUpIcon } from 'pixel-art-icons/icons/chevron-up'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { EditIcon } from 'pixel-art-icons/icons/edit'
import { cn } from '@ui/cn'
import {
  generatedClassKindLabel,
  isGeneratedClassLocked,
  isUserVisibleClass,
} from '@core/page-tree/classUtils'
import type { CSSClass } from '@core/page-tree/schemas'
import dialogStyles from '../SiteCreateDialog/SiteCreateDialog.module.css'
import styles from './ClassPicker.module.css'

interface SuggestionsPosition {
  x: number
  y: number
  width: number
}

interface ClassContextMenuState {
  x: number
  y: number
  classId: string
}

// ---------------------------------------------------------------------------
// Pill accent — deterministic hash from the class name.
// Kept local: purely presentational, not shared logic.
// ---------------------------------------------------------------------------

type PillAccent = 'mint' | 'lilac' | 'sky' | 'peach'
const PILL_ACCENTS: readonly PillAccent[] = ['mint', 'lilac', 'sky', 'peach']

function pillAccent(name: string): PillAccent {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(h, 31) + name.charCodeAt(i)) | 0
  }
  return PILL_ACCENTS[Math.abs(h) % PILL_ACCENTS.length]!
}

function keyboardMenuPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + Math.min(rect.width - 8, 24),
    y: rect.top + Math.min(rect.height - 8, 24),
  }
}

// ---------------------------------------------------------------------------
// ClassPicker
// ---------------------------------------------------------------------------

export interface ClassPickerHandle {
  /** Focus the 'Add or create class…' input. */
  focusInput: () => void
}

interface ClassPickerProps {
  nodeId: string
  /**
   * Optional inline action rendered to the right of the 'Add or create class…'
   * input as a sibling cell in the same two-column row. The suggestions
   * dropdown spans both cells so search results can use the full row width.
   */
  trailingAction?: ReactNode
}

export const ClassPicker = forwardRef<ClassPickerHandle, ClassPickerProps>(
function ClassPickerInner({ nodeId, trailingAction }: ClassPickerProps, ref) {
  const site = useEditorStore((s) => s.site)
  const node = useEditorStore(
    useCallback(
      (s) => selectActiveCanvasPage(s)?.nodes[nodeId] ?? null,
      [nodeId],
    ),
  )
  const activeClassId = useEditorStore((s) => s.activeClassId)
  const setActiveClass = useEditorStore((s) => s.setActiveClass)
  const addNodeClass = useEditorStore((s) => s.addNodeClass)
  const removeNodeClass = useEditorStore((s) => s.removeNodeClass)
  const createClass = useEditorStore((s) => s.createClass)
  const renameClass = useEditorStore((s) => s.renameClass)
  const reorderNodeClass = useEditorStore((s) => s.reorderNodeClass)
  const setPreviewNodeClass = useEditorStore((s) => s.setPreviewNodeClass)
  const clearPreviewNodeClass = useEditorStore((s) => s.clearPreviewNodeClass)

  const [query, setQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionsPosition, setSuggestionsPosition] = useState<SuggestionsPosition | null>(null)
  const [contextMenu, setContextMenu] = useState<ClassContextMenuState | null>(null)
  const [renameTarget, setRenameTarget] = useState<CSSClass | null>(null)
  const [classHoverPreviewEnabled, setClassHoverPreviewEnabled] = useState(
    readClassHoverPreviewPreference,
  )

  const inputRef = useRef<HTMLInputElement>(null)
  // The dropdown anchors to the input but takes the *row* width so search
  // results can use both columns when a trailingAction is present.
  const inputRowRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    focusInput: () => {
      inputRef.current?.focus()
    },
  }))

  const assignedIds = node?.classIds ?? []
  const visibleAssignedIds = assignedIds.filter((id) => isUserVisibleClass(site?.classes[id]))
  const allClasses = Object.values(site?.classes ?? {}).filter(isUserVisibleClass)
  const contextClass = contextMenu ? site?.classes[contextMenu.classId] ?? null : null
  const contextClassIndex = contextMenu ? visibleAssignedIds.indexOf(contextMenu.classId) : -1

  const suggestions = allClasses.filter(
    (c) =>
      !assignedIds.includes(c.id) &&
      c.name.toLowerCase().includes(query.toLowerCase()),
  )

  const canCreateNew =
    query.trim().length > 0 &&
    !allClasses.some((c) => c.name === query.trim())

  const updateSuggestionsPosition = useCallback(() => {
    // Anchor vertically to the input (so the dropdown opens just below it),
    // but use the full input-row width so the menu can span the trailing
    // action column as well.
    const inputRect = inputRef.current?.getBoundingClientRect()
    const rowRect = inputRowRef.current?.getBoundingClientRect() ?? inputRect
    if (!inputRect || !rowRect) return
    setSuggestionsPosition({
      x: rowRect.left,
      y: inputRect.bottom + 6,
      width: rowRect.width,
    })
  }, [])

  const openSuggestions = useCallback(() => {
    updateSuggestionsPosition()
    setShowSuggestions(true)
  }, [updateSuggestionsPosition])

  const handleAddExisting = useCallback(
    (classId: string) => {
      addNodeClass(nodeId, classId)
      clearPreviewNodeClass(nodeId, classId)
      setQuery('')
      setShowSuggestions(false)
      setSuggestionsPosition(null)
    },
    [nodeId, addNodeClass, clearPreviewNodeClass],
  )

  const handleCreateAndAdd = useCallback(() => {
    const name = query.trim()
    if (!name) return
    try {
      const newClass = createClass(name)
      addNodeClass(nodeId, newClass.id)
      setActiveClass(newClass.id)
      clearPreviewNodeClass(nodeId)
      setQuery('')
      setShowSuggestions(false)
      setSuggestionsPosition(null)
    } catch {
      // Class with this name already exists
    }
  }, [query, createClass, addNodeClass, nodeId, setActiveClass, clearPreviewNodeClass])

  const previewClass = useCallback(
    (classId: string) => {
      if (!classHoverPreviewEnabled) return
      setPreviewNodeClass(nodeId, classId)
    },
    [classHoverPreviewEnabled, nodeId, setPreviewNodeClass],
  )

  const clearPreviewClass = useCallback(
    (classId: string) => {
      clearPreviewNodeClass(nodeId, classId)
    },
    [clearPreviewNodeClass, nodeId],
  )

  useEffect(() => {
    return subscribeToEditorPrefsChanged(() => {
      setClassHoverPreviewEnabled(readClassHoverPreviewPreference())
    })
  }, [])

  useEffect(() => {
    if (!classHoverPreviewEnabled) clearPreviewNodeClass(nodeId)
  }, [classHoverPreviewEnabled, clearPreviewNodeClass, nodeId])

  useEffect(() => () => clearPreviewNodeClass(nodeId), [clearPreviewNodeClass, nodeId])

  useEffect(() => {
    if (!showSuggestions) return
    function onViewportChange() {
      updateSuggestionsPosition()
    }
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [showSuggestions, updateSuggestionsPosition])

  const closeSuggestions = useCallback(() => {
    clearPreviewNodeClass(nodeId)
    setShowSuggestions(false)
    setSuggestionsPosition(null)
  }, [clearPreviewNodeClass, nodeId])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const openClassContextMenu = useCallback(
    (classId: string, event: MouseEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setContextMenu({ x: event.clientX, y: event.clientY, classId })
    },
    [],
  )

  const openKeyboardClassContextMenu = useCallback(
    (classId: string, event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
      event.preventDefault()
      event.stopPropagation()
      setContextMenu({ ...keyboardMenuPosition(event.currentTarget), classId })
    },
    [],
  )

  const handleRename = useCallback(
    (name: string) => {
      if (!renameTarget) return
      renameClass(renameTarget.id, name)
      setRenameTarget(null)
    },
    [renameClass, renameTarget],
  )

  const removeAssignedClass = useCallback(
    (classId: string) => {
      if (activeClassId === classId) setActiveClass(null)
      removeNodeClass(nodeId, classId)
    },
    [activeClassId, nodeId, removeNodeClass, setActiveClass],
  )

  return (
    <div className={styles.container}>
      {/* Assigned class chips */}
      {visibleAssignedIds.length > 0 && (
        <div className={styles.pillsContainer}>
          {visibleAssignedIds.map((id) => {
            const cls = site?.classes[id]
            if (!cls) return null
            const isActive = activeClassId === id
            return (
              <div
                key={id}
                className={cn(styles.pill, isActive ? styles.pillActive : styles.pillInactive)}
                data-accent={pillAccent(cls.name)}
                onClick={() => {
                  setActiveClass(isActive ? null : id)
                }}
                role="button"
                aria-pressed={isActive}
                aria-label={`${isActive ? 'Deselect' : 'Edit'} class ${cls.name}`}
                tabIndex={0}
                onContextMenu={(e) => openClassContextMenu(id, e)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setActiveClass(isActive ? null : id)
                    return
                  }
                  openKeyboardClassContextMenu(id, e)
                }}
              >
                <span className={styles.pillName}>{cls.name}</span>

                {/* Remove from this element (does NOT delete the class globally) */}
                <Button
                  variant="ghost"
                  size="micro"
                  iconOnly
                  onClick={(e) => {
                    e.stopPropagation()
                    removeAssignedClass(id)
                  }}
                  aria-label={`Remove class ${cls.name}`}
                  tooltip="Remove from this element"
                  dangerHover
                  className={styles.pillRemoveBtn}
                >
                  <CloseIcon size={10} color="currentColor" aria-hidden="true" />
                </Button>
              </div>
            )
          })}
        </div>
      )}

      {contextMenu && contextClass && createPortal(
        <ClassPillContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          canMoveUp={contextClassIndex > 0}
          canMoveDown={contextClassIndex >= 0 && contextClassIndex < visibleAssignedIds.length - 1}
          locked={isGeneratedClassLocked(contextClass)}
          onClose={closeContextMenu}
          onEdit={() => {
            setActiveClass(contextClass.id)
            closeContextMenu()
          }}
          onRename={() => {
            if (!isGeneratedClassLocked(contextClass)) setRenameTarget(contextClass)
            closeContextMenu()
          }}
          onMoveUp={() => {
            reorderNodeClass(nodeId, contextClass.id, 'up')
            closeContextMenu()
          }}
          onMoveDown={() => {
            reorderNodeClass(nodeId, contextClass.id, 'down')
            closeContextMenu()
          }}
          onRemove={() => {
            removeAssignedClass(contextClass.id)
            closeContextMenu()
          }}
        />,
        document.body,
      )}

      {renameTarget && (
        <ClassRenameDialog
          initialValue={renameTarget.name}
          onCancel={() => setRenameTarget(null)}
          onRename={handleRename}
        />
      )}

      {/* Add-class input + optional trailing action (e.g. the Componentize
          button). Two-column grid when trailingAction is provided, single
          column otherwise. The suggestions dropdown anchors to the input but
          spans the full row. */}
      <div ref={inputRowRef} className={styles.inputRow} data-with-action={trailingAction != null}>
        <Input
          ref={inputRef}
          type="text"
          fieldSize="sm"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            openSuggestions()
          }}
          onFocus={openSuggestions}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (canCreateNew) handleCreateAndAdd()
              else if (suggestions[0]) handleAddExisting(suggestions[0].id)
            }
            if (e.key === 'Escape') closeSuggestions()
          }}
          placeholder="Add or create class…"
          aria-label="Add or create a CSS class"
        />

        {trailingAction}

        {/* Suggestions dropdown */}
        {showSuggestions && suggestionsPosition && (query.length > 0 || suggestions.length > 0) && createPortal(
          <ContextMenu
            x={suggestionsPosition.x}
            y={suggestionsPosition.y}
            width={suggestionsPosition.width}
            minWidth={suggestionsPosition.width}
            zIndex={10000}
            ariaLabel="Class suggestions"
            onClose={closeSuggestions}
            triggerRef={inputRef}
          >
            {suggestions.map((cls) => (
              <ContextMenuItem
                key={cls.id}
                onClick={() => handleAddExisting(cls.id)}
                onMouseEnter={() => previewClass(cls.id)}
                onFocus={() => previewClass(cls.id)}
                onMouseLeave={() => clearPreviewClass(cls.id)}
                onBlur={() => clearPreviewClass(cls.id)}
              >
                <span className={styles.suggestionLabel}>{cls.name}</span>
                {generatedClassKindLabel(cls) && (
                  <span className={styles.utilityBadge}>{generatedClassKindLabel(cls)}</span>
                )}
              </ContextMenuItem>
            ))}
            {canCreateNew && (
              <>
                {suggestions.length > 0 && <ContextMenuSeparator />}
                <ContextMenuItem
                  onClick={handleCreateAndAdd}
                >
                  + Create &ldquo;{query.trim()}&rdquo;
                </ContextMenuItem>
              </>
            )}
            {suggestions.length === 0 && !canCreateNew && (
              <div className={styles.noMatch}>
                No classes match &ldquo;{query}&rdquo;
              </div>
            )}
          </ContextMenu>,
          document.body,
        )}
      </div>
    </div>
  )
})

function ClassPillContextMenu({
  x,
  y,
  canMoveUp,
  canMoveDown,
  onClose,
  onEdit,
  onRename,
  onMoveUp,
  onMoveDown,
  onRemove,
  locked,
}: {
  x: number
  y: number
  canMoveUp: boolean
  canMoveDown: boolean
  locked: boolean
  onClose: () => void
  onEdit: () => void
  onRename: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  onRemove: () => void
}) {
  const firstItemRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstItemRef.current?.focus()
  }, [])

  return (
    <ContextMenu x={x} y={y} ariaLabel="Class actions" onClose={onClose}>
      <ContextMenuItem ref={firstItemRef} onClick={onEdit}>
        <span aria-hidden="true"><EditIcon size={13} /></span>
        {locked ? 'View utility' : 'Edit styles'}
      </ContextMenuItem>
      <ContextMenuItem disabled={locked} onClick={onRename}>
        <span aria-hidden="true"><EditIcon size={13} /></span>
        Rename
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canMoveUp} onClick={onMoveUp}>
        <span aria-hidden="true"><ChevronUpIcon size={13} /></span>
        Move up
      </ContextMenuItem>
      <ContextMenuItem disabled={!canMoveDown} onClick={onMoveDown}>
        <span aria-hidden="true"><ChevronDownIcon size={13} /></span>
        Move down
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem danger onClick={onRemove}>
        <span aria-hidden="true"><CloseIcon size={13} /></span>
        Remove from this element
      </ContextMenuItem>
    </ContextMenu>
  )
}

function ClassRenameDialog({
  initialValue,
  onCancel,
  onRename,
}: {
  initialValue: string
  onCancel: () => void
  onRename: (name: string) => void
}) {
  const [name, setName] = useState(initialValue)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmedName = name.trim()

  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.select())
  }, [])

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!trimmedName) return

    try {
      onRename(trimmedName)
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^\[[^\]]+\]\s*/, '') : 'Unable to rename class')
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
        aria-labelledby="class-rename-dialog-title"
        className={dialogStyles.dialog}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={dialogStyles.header}>
          <h2 id="class-rename-dialog-title" className={dialogStyles.title}>
            Rename selector
          </h2>
          <Button variant="ghost" size="xs" iconOnly aria-label="Close dialog" onClick={onCancel}>
            <CloseIcon size={12} color="currentColor" aria-hidden="true" />
          </Button>
        </div>
        <form className={dialogStyles.form} onSubmit={handleSubmit}>
          <label className={dialogStyles.field}>
            <span className={dialogStyles.label}>Name</span>
            <Input
              ref={inputRef}
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
              Save
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
