import { Suspense, lazy, useEffect, useId, useRef, useState } from 'react'
import { useAdminUi } from '@admin/state/adminUi'
import { readTitleCell } from '@core/data/cells'
import type {
  DataTable,
  DataRow,
  DataRowStatus,
  UpdateDataTableInput,
} from '@core/data/schemas'
import { HeadingIcon } from 'pixel-art-icons/icons/heading'
import { ImagesSolidIcon } from 'pixel-art-icons/icons/images-solid'
import { TextPlusIcon } from 'pixel-art-icons/icons/text-plus'
import { BracesIcon } from 'pixel-art-icons/icons/braces'
// Token-picker dialog is awaiting re-integration with the popover-based
// DynamicBindingControl that a parallel session is rolling out. Until then
// the slash-menu "Data token" action inserts a placeholder token string at
// the caret and the author can hand-edit it.
import { AdminCanvasLayout } from '@admin/layouts/AdminCanvasLayout'
import { MediaExplorerPanel } from '@site/panels/MediaExplorerPanel'
import type { CanvasNotchAction } from '@site/canvas/CanvasNotch'
import { ContentDocumentCanvas } from './components/ContentDocumentCanvas/ContentDocumentCanvas'
import { ContentCollectionCreateDialog } from './components/ContentCollectionCreateDialog/ContentCollectionCreateDialog'
import { ContentExplorerPanel } from './components/ContentExplorerPanel/ContentExplorerPanel'
import { ContentSettingsPanel } from './components/ContentSettingsPanel/ContentSettingsPanel'
import { MediaViewerWindow } from '@admin/pages/media/components/MediaViewerWindow/MediaViewerWindow'
import { ContentSidebar, type ContentPanelId } from './components/ContentSidebar/ContentSidebar'
import { ContentToolbar } from './components/ContentToolbar/ContentToolbar'
import type { TiptapBodyEditorHandle } from './TiptapBodyEditor'
// Lazy-load the WordPress-style fullscreen media picker. Pulls in the full
// Media-page workspace (folder tree + canvas grid + upload queue), so we
// only pay for it the first time the user opens the picker — typing in the
// content editor doesn't need it.
const MediaPickerModal = lazy(() =>
  import('@admin/pages/media/components/MediaPickerModal/MediaPickerModal').then(
    (m) => ({ default: m.MediaPickerModal }),
  ),
)
import { useContentEntryDraft } from './hooks/useContentEntryDraft'
import { useContentMediaPicker } from './hooks/useContentMediaPicker'
import { useContentWorkspace } from './hooks/useContentWorkspace'
import { publicContentPath } from './utils/contentEntryUtils'
import { useAuthenticatedAdminUser } from '@admin/sessionContext'
import { ContentAgentMount } from './agent/ContentAgentMount'
import {
  canCreateContent,
  canEditAnyContent,
  canEditContentEntry,
  canManageContentCollections,
  canPublishContentEntry,
} from '@admin/access'

export function ContentPage() {
  const [activeContentPanel, setActiveContentPanel] = useState<ContentPanelId | null>('content')
  const [collectionDialogOpen, setCollectionDialogOpen] = useState(false)
  // These are monotonic counters used purely as "do the action now" pings:
  // bumping them re-runs the focus effect inside the canvas / body editor.
  const [focusTitleSignal, setFocusTitleSignal] = useState(0)
  const [focusBodySignal, setFocusBodySignal] = useState(0)
  // Token binding picker — temporarily stubbed (see comment near
  // `BindingPickerPopover` placeholder below). Slash-menu / notch actions
  // insert a placeholder token directly until the popover is wired up to
  // the body editor's caret.
  // Canvas display mode: 'write' is the bare editor surface, 'live' is
  // the entry rendered inside its template (real site styles, inline
  // editing). Switching is purely client-side — the body markdown is the
  // source of truth, so both modes show the same content.
  const [contentMode, setContentMode] = useState<'write' | 'live'>('write')
  const slugId = useId()
  const seoTitleId = useId()
  const seoDescriptionId = useId()

  // Imperative handle into the body editor — let us focus, insert text
  // (data tokens), insert media nodes, or append heading/paragraph blocks
  // from outside the editor in response to notch / picker actions.
  const bodyEditorRef = useRef<TiptapBodyEditorHandle | null>(null)

  // Strict accessor — ContentPage only renders inside `AuthenticatedAdmin`,
  // which gates the entire tree on a non-null session user. A null here
  // means the page rendered outside an `AdminSessionProvider`, which is a
  // programming error, not a permission state — fail loud, don't fail
  // open. (The previous code path silently treated null as an unrestricted
  // sentinel, which masked tests that forgot to wire the provider and
  // briefly painted full-admin UI in any session-rehydration race.)
  const permissionUser = useAuthenticatedAdminUser()
  const canReassignAuthor = canEditAnyContent(permissionUser)
  const canCreateEntries = canCreateContent(permissionUser)
  const canManageCollections = canManageContentCollections(permissionUser)
  const workspace = useContentWorkspace({ loadAuthors: canReassignAuthor })
  const draft = useContentEntryDraft({
    selectedEntry: workspace.selectedEntry,
    updateSelectedEntry: workspace.updateSelectedEntry,
    setError: workspace.setError,
  })
  const mediaPicker = useContentMediaPicker({
    featuredMediaId: draft.featuredMediaId,
    setFeaturedMediaId: draft.setFeaturedMediaId,
    insertBodyMedia: (attrs) => bodyEditorRef.current?.insertMedia(attrs),
    entries: workspace.entries,
  })

  const publicPath = workspace.selectedCollection && draft.slug
    ? publicContentPath(workspace.selectedCollection.routeBase, draft.slug)
    : ''
  const canEditSelectedEntry = canEditContentEntry(permissionUser, workspace.selectedEntry)
  const canPublishSelectedEntry = canPublishContentEntry(permissionUser, workspace.selectedEntry)

  // Mirror the selected entry's public URL into adminUi so the global
  // toolbar's "Open live page" icon button deep-links to the post the
  // user is editing — instead of the site root (Site editor publishes
  // its own active-page path; here we publish the entry's path). Empty
  // string (no entry / no slug yet) maps to null so the button falls
  // back to the site root.
  const publishActiveLivePath = useAdminUi((s) => s.setActiveLivePath)
  useEffect(() => {
    publishActiveLivePath(publicPath || null)
    return () => {
      publishActiveLivePath(null)
    }
  }, [publicPath, publishActiveLivePath])

  // Note: we used to unconditionally `setPropertiesPanel({ collapsed:
  // false })` here on mount, which forced the inspector open every time
  // the user entered the Content workspace — overriding the saved
  // closed state and causing a slide-in width transition on the right
  // sidebar. The persisted layout in localStorage is the source of
  // truth; if the user closed the inspector, it stays closed when they
  // return. Specific actions (selecting an entry, opening a row) still
  // open the inspector through their own handlers.

  async function handleCreateEntry() {
    if (!canCreateEntries) {
      workspace.setError('Your role cannot create content entries')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      const entry = await workspace.createUntitledEntry()
      // `createUntitledEntry` hands us an entry whose title is empty so the
      // editor's title field renders as a placeholder rather than
      // pre-filling "Untitled" (the server-side fallback that the sidebar
      // list still shows). The user can type their real title immediately.
      draft.applySelectedEntry(entry)
      draft.setSaveMessage('saved')
      setFocusTitleSignal((n) => n + 1)
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not create entry')
    }
  }

  async function handleMoveEntryCollection(tableId: string) {
    if (!canEditSelectedEntry) {
      workspace.setError('Your role cannot move this entry')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      const entry = await workspace.moveSelectedEntryToCollection(tableId)
      if (entry) draft.applySelectedEntry(entry)
      draft.setSaveMessage('saved')
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not move entry')
    }
  }

  async function handleUpdateEntryAuthor(authorUserId: string) {
    const entry = workspace.selectedEntry
    if (!entry || entry.authorUserId === authorUserId) return
    if (!canReassignAuthor) {
      workspace.setError('Your role cannot reassign authors')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      const updatedEntry = await workspace.updateEntryAuthor(entry, authorUserId)
      draft.applySelectedEntry(updatedEntry)
      draft.setSaveMessage('saved')
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not update author')
    }
  }

  async function handleUpdateCollection(
    collection: DataTable,
    input: UpdateDataTableInput,
  ) {
    if (!canManageCollections) {
      workspace.setError('Your role cannot manage content collections')
      return
    }
    workspace.setError(null)
    try {
      await workspace.updateCollection(collection.id, input)
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not update collection')
      throw err
    }
  }

  async function handleDeleteCollection(collection: DataTable) {
    if (!canManageCollections) {
      workspace.setError('Your role cannot manage content collections')
      return
    }
    workspace.setError(null)
    try {
      await workspace.deleteCollection(collection.id)
      if (workspace.selectedCollectionId === collection.id) {
        draft.applySelectedEntry(null)
      }
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not delete collection')
      throw err
    }
  }

  async function handleRenameEntry(
    entry: DataRow,
    input: { title: string; slug: string },
  ) {
    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot edit this entry')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      const entrySnapshot = workspace.selectedEntry?.id === entry.id
        ? {
            ...entry,
            cells: {
              ...entry.cells,
              body: draft.body,
              featuredMedia: draft.featuredMediaId,
              seoTitle: draft.seoTitle,
              seoDescription: draft.seoDescription,
            },
          }
        : entry
      const updatedEntry = await workspace.renameEntry(entrySnapshot, input)
      if (workspace.selectedEntry?.id === entry.id) {
        draft.applySelectedEntry(updatedEntry)
      }
      draft.setSaveMessage('saved')
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not rename entry')
      throw err
    }
  }

  async function handleDeleteEntry(entry: DataRow) {
    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot delete this entry')
      return
    }
    workspace.setError(null)
    try {
      const nextEntry = await workspace.deleteEntry(entry)
      if (workspace.selectedEntry?.id === entry.id) {
        draft.applySelectedEntry(nextEntry)
      }
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not delete entry')
      throw err
    }
  }

  async function handleDuplicateEntry(entry: DataRow) {
    if (!canCreateEntries) {
      workspace.setError('Your role cannot create content entries')
      return
    }
    draft.setSaveMessage('saving')
    workspace.setError(null)
    try {
      // If duplicating the currently-edited entry, persist the in-memory
      // draft first so the duplicate captures the latest unsaved edits.
      // Otherwise we'd silently copy the last-saved version of the body
      // which is confusing — the user clicked duplicate on the row they're
      // visibly editing.
      const source = workspace.selectedEntry?.id === entry.id
        ? {
            ...entry,
            cells: {
              ...entry.cells,
              body: draft.body,
              featuredMedia: draft.featuredMediaId,
              seoTitle: draft.seoTitle,
              seoDescription: draft.seoDescription,
              title: draft.title || readTitleCell(entry.cells),
            },
          }
        : entry
      const duplicated = await workspace.duplicateEntry(source)
      draft.applySelectedEntry(duplicated)
      draft.setSaveMessage('saved')
    } catch (err) {
      draft.setSaveMessage('error')
      workspace.setError(err instanceof Error ? err.message : 'Could not duplicate entry')
      throw err
    }
  }

  async function handleMoveEntryToCollection(entry: DataRow, tableId: string) {
    if (entry.tableId === tableId) return
    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot move this entry')
      return
    }
    workspace.setError(null)
    try {
      const updatedEntry = await workspace.moveEntryToCollection(entry, tableId)
      if (workspace.selectedEntry?.id === entry.id) {
        draft.applySelectedEntry(updatedEntry)
      }
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not move entry')
      throw err
    }
  }

  async function handlePublishEntry(entry: DataRow) {
    if (!canPublishContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot publish this entry')
      return
    }

    if (workspace.selectedEntry?.id === entry.id) {
      if (canEditContentEntry(permissionUser, entry)) {
        await draft.handlePublish()
      } else {
        draft.setSaveMessage('publishing')
        workspace.setError(null)
        try {
          const published = await workspace.publishEntry(entry)
          draft.applySelectedEntry(published)
          draft.setSaveMessage('published')
        } catch (err) {
          draft.setSaveMessage('error')
          workspace.setError(err instanceof Error ? err.message : 'Could not publish entry')
        }
      }
      return
    }

    workspace.setError(null)
    try {
      await workspace.publishEntry(entry)
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not publish entry')
      throw err
    }
  }

  async function handleStatusChange(status: DataRowStatus) {
    const entry = workspace.selectedEntry
    if (!entry || status === entry.status) return

    if (status === 'published') {
      await handlePublishEntry(entry)
      return
    }

    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot edit this entry')
      return
    }

    await draft.handleStatusChange(status)
  }

  async function handleConvertEntryToDraft(entry: DataRow) {
    if (!canEditContentEntry(permissionUser, entry)) {
      workspace.setError('Your role cannot edit this entry')
      return
    }
    if (workspace.selectedEntry?.id === entry.id) {
      await draft.handleStatusChange('draft')
      return
    }

    workspace.setError(null)
    try {
      await workspace.updateEntryStatus(entry, 'draft')
    } catch (err) {
      workspace.setError(err instanceof Error ? err.message : 'Could not convert entry to draft')
      throw err
    }
  }

  function handleSelectEntry(entry: Parameters<typeof workspace.selectEntry>[0]) {
    workspace.selectEntry(entry)
    draft.applySelectedEntry(entry)
  }

  const notchActions: CanvasNotchAction[] = [
    {
      id: 'heading',
      label: 'Heading',
      icon: HeadingIcon,
      onClick: () => bodyEditorRef.current?.appendBlock('heading'),
    },
    {
      id: 'text',
      label: 'Text',
      icon: TextPlusIcon,
      onClick: () => bodyEditorRef.current?.appendBlock('paragraph'),
    },
    {
      id: 'media',
      label: 'Media',
      icon: ImagesSolidIcon,
      onClick: () => void mediaPicker.openMediaPicker('media'),
    },
    {
      id: 'bind',
      label: 'Insert data token',
      icon: BracesIcon,
      onClick: () => bodyEditorRef.current?.insertText('{currentEntry.title}'),
    },
  ]

  return (
    <>
      <AdminCanvasLayout
        workspace="content"
        toolbarRightSlot={(
          <ContentToolbar
            contentLoading={workspace.contentLoading}
            saveMessage={draft.saveMessage}
            isDirty={draft.isDirty}
            selectedEntry={workspace.selectedEntry}
            selectedCollection={workspace.selectedCollection}
            publicPath={publicPath}
            canSaveDraft={canEditSelectedEntry}
            canPublish={canPublishSelectedEntry}
            onSaveDraft={() => void draft.handleSaveDraft()}
            onPublish={() => {
              if (workspace.selectedEntry) void handlePublishEntry(workspace.selectedEntry)
            }}
          />
        )}
        contentSidebar={(
          <ContentSidebar
            activePanel={activeContentPanel}
            onActivePanelChange={setActiveContentPanel}
            contentPanel={(
              <ContentExplorerPanel
                loading={workspace.contentLoading}
                error={workspace.error}
                collections={workspace.collections}
                entries={workspace.entries}
                selectedCollection={workspace.selectedCollection}
                selectedCollectionId={workspace.selectedCollectionId}
                selectedEntryId={workspace.selectedEntry?.id ?? null}
                canCreateCollection={canManageCollections}
                canCreateEntry={canCreateEntries}
                canManageCollections={canManageCollections}
                canEditEntry={(entry) => canEditContentEntry(permissionUser, entry)}
                canPublishEntry={(entry) => canPublishContentEntry(permissionUser, entry)}
                getFeaturedMediaAssetForEntry={mediaPicker.getFeaturedMediaAssetForEntry}
                onSelectCollection={workspace.selectCollection}
                onSelectEntry={handleSelectEntry}
                onCreateCollection={() => setCollectionDialogOpen(true)}
                onCreateEntry={() => void handleCreateEntry()}
                onUpdateCollection={handleUpdateCollection}
                onDeleteCollection={handleDeleteCollection}
                onRenameEntry={handleRenameEntry}
                onPublishEntry={handlePublishEntry}
                onConvertEntryToDraft={handleConvertEntryToDraft}
                onDeleteEntry={handleDeleteEntry}
                onDuplicateEntry={handleDuplicateEntry}
                onMoveEntryToCollection={handleMoveEntryToCollection}
                onClose={() => setActiveContentPanel(null)}
              />
            )}
            mediaPanel={(
              <MediaExplorerPanel
                variant="docked"
                open={activeContentPanel === 'media'}
                onOpenChange={(open) => setActiveContentPanel(open ? 'media' : null)}
              />
            )}
          />
        )}
        contentCanvas={(
          <ContentDocumentCanvas
            ref={bodyEditorRef}
            selectedEntry={workspace.selectedEntry}
            selectedCollection={workspace.selectedCollection}
            loading={workspace.contentLoading}
            title={draft.title}
            body={draft.body}
            notchActions={notchActions}
            canEditEntry={canEditSelectedEntry}
            canCreateEntry={canCreateEntries}
            focusTitleSignal={focusTitleSignal}
            focusBodySignal={focusBodySignal}
            contentMode={contentMode}
            onContentModeChange={setContentMode}
            onTitleChange={draft.setTitle}
            onTitleEnter={() => setFocusBodySignal((n) => n + 1)}
            onBodyChange={draft.setBody}
            onPickMedia={() => mediaPicker.openMediaPicker('media')}
            onInsertDataToken={() => bodyEditorRef.current?.insertText('{currentEntry.title}')}
            onCreateEntry={() => void handleCreateEntry()}
          />
        )}
        contentRightPanel={workspace.selectedEntry ? (
          <ContentSettingsPanel
            selectedEntry={workspace.selectedEntry}
            authors={workspace.authors}
            authorsLoading={workspace.authorsLoading}
            collections={workspace.collections}
            selectedCollection={workspace.selectedCollection}
            loading={workspace.contentLoading}
            slug={draft.slug}
            slugId={slugId}
            seoTitle={draft.seoTitle}
            seoTitleId={seoTitleId}
            seoDescription={draft.seoDescription}
            seoDescriptionId={seoDescriptionId}
            publicPath={publicPath}
            mediaError={mediaPicker.mediaError}
            featuredMediaId={draft.featuredMediaId}
            featuredMediaAsset={mediaPicker.featuredMediaAsset}
            onCollectionChange={(tableId) => void handleMoveEntryCollection(tableId)}
            onAuthorChange={(authorUserId) => void handleUpdateEntryAuthor(authorUserId)}
            onSlugChange={draft.setSlug}
            onSeoTitleChange={draft.setSeoTitle}
            onSeoDescriptionChange={draft.setSeoDescription}
            onStatusChange={(status) => void handleStatusChange(status)}
            onChooseFeaturedMedia={() => void mediaPicker.openMediaPicker('featured')}
            onClearFeaturedMedia={() => draft.setFeaturedMediaId(null)}
            onEditFeaturedMedia={() => {
              if (mediaPicker.featuredMediaAsset) {
                mediaPicker.openMediaViewer(mediaPicker.featuredMediaAsset.id)
              }
            }}
            canEditEntry={canEditSelectedEntry}
            canPublishEntry={canPublishSelectedEntry}
            canChangeAuthor={canReassignAuthor}
          />
        ) : undefined}
      />

      {mediaPicker.mediaPicker && (
        <Suspense fallback={null}>
          <MediaPickerModal
            open
            onClose={mediaPicker.closeMediaPicker}
            mediaKind="any"
            currentValue={mediaPicker.mediaPicker.kind === 'featured'
              ? (mediaPicker.featuredMediaAsset?.publicPath ?? null)
              : null}
            onPick={mediaPicker.pickMedia}
          />
        </Suspense>
      )}

      <MediaViewerWindow
        editor={mediaPicker.viewerEditor}
        open={mediaPicker.viewerOpen}
        onClose={mediaPicker.closeMediaViewer}
      />


      {collectionDialogOpen && (
        <ContentCollectionCreateDialog
          onCancel={() => setCollectionDialogOpen(false)}
          onCreate={async (input) => {
            if (!canManageCollections) {
              workspace.setError('Your role cannot manage content collections')
              setCollectionDialogOpen(false)
              return
            }
            await workspace.createCollection(input)
            setCollectionDialogOpen(false)
          }}
        />
      )}

      {/*
        Token binding picker — temporarily stubbed. When the popover-based
        BindingPickerPopover wires up to the body editor's caret rect,
        mount it here anchored to a stable wrapper element and forward the
        chosen token to `bodyEditorRef.current?.insertText`.
      */}

      {/* AI Assistant — content-scope. Mounts the AgentPanel + a floating
          toggle button + registers the ContentBridgeHandle for the write
          tools to call into. Self-contained — only depends on the live
          workspace + draft state we pass in. */}
      <ContentAgentMount
        workspace={workspace}
        draft={draft}
        currentUser={{
          id: permissionUser.id,
          displayName: permissionUser.displayName ?? permissionUser.email,
          email: permissionUser.email,
        }}
      />
    </>
  )
}
