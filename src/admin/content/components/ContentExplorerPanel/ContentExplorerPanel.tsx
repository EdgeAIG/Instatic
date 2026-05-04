import { useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
import { cn } from '@ui/cn'
import { BookOpenIcon } from 'pixel-art-icons/icons/book-open'
import { BookPlusIcon } from 'pixel-art-icons/icons/book-plus'
import { ExternalLinkIcon } from 'pixel-art-icons/icons/external-link'
import { FilePlusIcon } from 'pixel-art-icons/icons/file-plus'
import { FileTextIcon } from 'pixel-art-icons/icons/file-text'
import { Settings2Icon } from 'pixel-art-icons/icons/settings-2'
import { UploadIcon } from 'pixel-art-icons/icons/upload'
import type { ContentCollection, ContentEntry, UpdateContentCollectionInput } from '@core/content/schemas'
import { ExplorerItemContextMenu, type ExplorerContextMenuItem } from '@editor/components/ExplorerPanelActions'
import explorerStyles from '@editor/components/SiteExplorerPanel/SiteExplorerPanel.module.css'
import { PanelHeader } from '@editor/components/shared/PanelHeader'
import { ContentCollectionSettingsDialog } from '../ContentCollectionSettingsDialog/ContentCollectionSettingsDialog'
import {
  ContentItemRenameDialog,
  type ContentItemRenamePayload,
} from '../ContentItemRenameDialog/ContentItemRenameDialog'
import styles from '../../ContentPage.module.css'
import { publicContentPath } from '../../utils/contentEntryUtils'

type ContentExplorerContextTarget =
  | { kind: 'collection'; collection: ContentCollection }
  | { kind: 'entry'; entry: ContentEntry }

interface ContextMenuState {
  x: number
  y: number
  target: ContentExplorerContextTarget
}

interface ContentExplorerPanelProps {
  loading: boolean
  error: string | null
  collections: ContentCollection[]
  entries: ContentEntry[]
  selectedCollection: ContentCollection | null
  selectedCollectionId: string | null
  selectedEntryId: string | null
  onSelectCollection: (collectionId: string) => void
  onSelectEntry: (entry: ContentEntry) => void
  onCreateCollection: () => void
  onCreateEntry: () => void
  onUpdateCollection: (collection: ContentCollection, input: UpdateContentCollectionInput) => void | Promise<void>
  onDeleteCollection: (collection: ContentCollection) => void | Promise<void>
  onRenameEntry: (entry: ContentEntry, input: ContentItemRenamePayload) => void | Promise<void>
  onPublishEntry: (entry: ContentEntry) => void | Promise<void>
  onConvertEntryToDraft: (entry: ContentEntry) => void | Promise<void>
  onDeleteEntry: (entry: ContentEntry) => void | Promise<void>
  onClose: () => void
}

function keyboardMenuPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + Math.min(rect.width - 8, 24),
    y: rect.top + Math.min(rect.height - 8, 24),
  }
}

export function ContentExplorerPanel({
  loading,
  error,
  collections,
  entries,
  selectedCollection,
  selectedCollectionId,
  selectedEntryId,
  onSelectCollection,
  onSelectEntry,
  onCreateCollection,
  onCreateEntry,
  onUpdateCollection,
  onDeleteCollection,
  onRenameEntry,
  onPublishEntry,
  onConvertEntryToDraft,
  onDeleteEntry,
  onClose,
}: ContentExplorerPanelProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameTarget, setRenameTarget] = useState<ContentExplorerContextTarget | null>(null)
  const [settingsTarget, setSettingsTarget] = useState<ContentCollection | null>(null)
  const entryListLabel = selectedCollection?.pluralLabel || 'Entries'
  const singularLabel = selectedCollection?.singularLabel || 'entry'
  const newEntryLabel = `New ${singularLabel.toLowerCase()}`

  function collectionForEntry(entry: ContentEntry): ContentCollection | null {
    return collections.find((collection) => collection.id === entry.collectionId) ?? selectedCollection
  }

  function openContextMenu(target: ContentExplorerContextTarget, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, target })
  }

  function openKeyboardContextMenu(target: ContentExplorerContextTarget, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ ...keyboardMenuPosition(event.currentTarget), target })
  }

  function extraMenuItems(target: ContentExplorerContextTarget): ExplorerContextMenuItem[] {
    if (target.kind === 'collection') {
      return [{
        label: 'Collection settings',
        icon: <Settings2Icon size={13} />,
        action: () => {
          setSettingsTarget(target.collection)
          setContextMenu(null)
        },
      }]
    }

    if (target.entry.status !== 'published') {
      return [{
        label: 'Publish',
        icon: <UploadIcon size={13} />,
        action: () => {
          void onPublishEntry(target.entry)
          setContextMenu(null)
        },
      }]
    }

    return [
      {
        label: 'Open in new tab',
        icon: <ExternalLinkIcon size={13} />,
        action: () => {
          const collection = collectionForEntry(target.entry)
          if (collection) {
            window.open(publicContentPath(collection.routeBase, target.entry.slug), '_blank', 'noopener,noreferrer')
          }
          setContextMenu(null)
        },
      },
      {
        label: 'Convert to draft',
        icon: <FileTextIcon size={13} />,
        action: () => {
          void onConvertEntryToDraft(target.entry)
          setContextMenu(null)
        },
      },
    ]
  }

  function renameDialogTitle(target: ContentExplorerContextTarget): string {
    if (target.kind === 'collection') return 'Rename collection'
    const collection = collectionForEntry(target.entry)
    return `Rename ${(collection?.singularLabel ?? 'entry').toLowerCase()}`
  }

  async function handleRename(payload: ContentItemRenamePayload) {
    if (!renameTarget) return

    if (renameTarget.kind === 'collection') {
      await onUpdateCollection(renameTarget.collection, {
        name: payload.title,
        slug: payload.slug,
      })
    } else {
      await onRenameEntry(renameTarget.entry, payload)
    }
    setRenameTarget(null)
  }

  async function handleDelete(target: ContentExplorerContextTarget) {
    setContextMenu(null)
    if (target.kind === 'collection') {
      await onDeleteCollection(target.collection)
    } else {
      await onDeleteEntry(target.entry)
    }
  }

  return (
    <>
      <aside
        role="complementary"
        aria-label="Content Explorer"
        data-panel=""
        data-testid="content-explorer-panel"
        tabIndex={-1}
        className={explorerStyles.panel}
      >
        <PanelHeader
          panelId="content-explorer"
          title="Content"
          onClose={onClose}
        />

        <div className={explorerStyles.content}>
          {error && <p className={styles.error} role="alert">{error}</p>}

          <section className={explorerStyles.section} aria-label="Collections">
            <div className={explorerStyles.sectionHeader}>
              <h2 className={explorerStyles.sectionTitle}>Collections</h2>
              <span className={explorerStyles.sectionCount}>{collections.length}</span>
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                onClick={onCreateCollection}
                aria-label="New collection"
                tooltip="New collection"
              >
                <BookPlusIcon size={13} aria-hidden="true" />
              </Button>
            </div>
            <div className={explorerStyles.rows}>
              {collections.map((collection) => (
                <button
                  key={collection.id}
                  type="button"
                  className={cn(
                    explorerStyles.row,
                    collection.id === selectedCollectionId && explorerStyles.rowActive,
                  )}
                  onClick={() => onSelectCollection(collection.id)}
                  onContextMenu={(event) => openContextMenu({ kind: 'collection', collection }, event)}
                  onKeyDown={(event) => openKeyboardContextMenu({ kind: 'collection', collection }, event)}
                >
                  <BookOpenIcon size={14} aria-hidden="true" />
                  <span className={explorerStyles.rowLabel}>{collection.name}</span>
                  <span className={explorerStyles.rowMeta}>
                    {collection.id === selectedCollectionId ? entries.length : ''}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className={explorerStyles.section} aria-label={entryListLabel}>
            <div className={explorerStyles.sectionHeader}>
              <h2 className={explorerStyles.sectionTitle}>{entryListLabel}</h2>
              <span className={explorerStyles.sectionCount}>{entries.length}</span>
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                onClick={onCreateEntry}
                disabled={!selectedCollectionId}
                aria-label={newEntryLabel}
                tooltip={newEntryLabel}
              >
                <FilePlusIcon size={13} aria-hidden="true" />
              </Button>
            </div>

            {loading ? (
              <ContentEntriesLoading />
            ) : entries.length === 0 ? (
              <EmptyState compact title="No entries yet." />
            ) : (
              <div className={explorerStyles.rows}>
                {entries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={cn(
                      explorerStyles.row,
                      entry.id === selectedEntryId && explorerStyles.rowActive,
                    )}
                    onClick={() => onSelectEntry(entry)}
                    onContextMenu={(event) => openContextMenu({ kind: 'entry', entry }, event)}
                    onKeyDown={(event) => openKeyboardContextMenu({ kind: 'entry', entry }, event)}
                  >
                    <FileTextIcon size={14} aria-hidden="true" />
                    <span className={styles.entryTitle}>{entry.title}</span>
                    <span className={explorerStyles.rowMeta}>{entry.status}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      </aside>

      {contextMenu && (
        <ExplorerItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel="Content item options"
          deleteDisabled={contextMenu.target.kind === 'collection' && contextMenu.target.collection.id === 'posts'}
          extraItems={extraMenuItems(contextMenu.target)}
          onClose={() => setContextMenu(null)}
          onRename={() => {
            setRenameTarget(contextMenu.target)
            setContextMenu(null)
          }}
          onDelete={() => { void handleDelete(contextMenu.target) }}
        />
      )}

      {renameTarget && (
        <ContentItemRenameDialog
          title={renameDialogTitle(renameTarget)}
          titleLabel={renameTarget.kind === 'collection' ? 'Name' : 'Title'}
          initialTitle={renameTarget.kind === 'collection' ? renameTarget.collection.name : renameTarget.entry.title}
          initialSlug={renameTarget.kind === 'collection' ? renameTarget.collection.slug : renameTarget.entry.slug}
          onCancel={() => setRenameTarget(null)}
          onRename={handleRename}
        />
      )}

      {settingsTarget && (
        <ContentCollectionSettingsDialog
          collection={settingsTarget}
          onCancel={() => setSettingsTarget(null)}
          onSave={async (input) => {
            await onUpdateCollection(settingsTarget, input)
            setSettingsTarget(null)
          }}
        />
      )}
    </>
  )
}

function ContentEntriesLoading() {
  return (
    <div
      className={explorerStyles.rows}
      data-testid="content-entries-loading"
      aria-busy="true"
      aria-label="Loading entries"
    >
      {[0, 1, 2].map((index) => (
        <span key={index} className={styles.entriesSkeletonRow}>
          <span className={cn(styles.skeletonShape, styles.entriesSkeletonIcon)} />
          <span className={cn(styles.skeletonShape, styles.entriesSkeletonLabel)} />
          <span className={cn(styles.skeletonShape, styles.entriesSkeletonMeta)} />
        </span>
      ))}
    </div>
  )
}
