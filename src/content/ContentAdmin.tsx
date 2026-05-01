import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Button } from '@ui/components/Button'
import { Input, Textarea } from '@ui/components/Input'
import { Select } from '@ui/components/Select'
import { cn } from '@ui/cn'
import { BookOpenIcon } from '@ui/icons/icons/book-open'
import { FilePlusIcon } from '@ui/icons/icons/file-plus'
import { FileTextIcon } from '@ui/icons/icons/file-text'
import { HeadingIcon } from '@ui/icons/icons/heading'
import { ImagesIcon } from '@ui/icons/icons/images'
import { ExternalLinkIcon } from '@ui/icons/icons/external-link'
import { SaveIcon } from '@ui/icons/icons/save'
import { SendIcon } from '@ui/icons/icons/send'
import { Settings2Icon } from '@ui/icons/icons/settings-2'
import { TextPlusIcon } from '@ui/icons/icons/text-plus'
import { VideoIcon } from '@ui/icons/icons/video'
import type { IconComponent } from '@ui/icons/types'
import {
  createCmsContentEntry,
  listCmsContentCollections,
  listCmsContentEntries,
  listCmsMediaAssets,
  publishCmsContentEntry,
  saveCmsContentEntryDraft,
  updateCmsContentEntryStatus,
  type CmsMediaAsset,
} from '@core/persistence'
import { useEditorStore } from '@core/editor-store/store'
import EditorLayout from '../app/EditorLayout'
import { CanvasNotch, type CanvasNotchAction } from '../editor/components/Canvas/CanvasNotch'
import canvasStyles from '../editor/components/Canvas/CanvasRoot.module.css'
import leftSidebarStyles from '../editor/components/LeftSidebar/LeftSidebar.module.css'
import { MediaExplorerPanel } from '../editor/components/MediaExplorerPanel'
import panelRailStyles from '../editor/components/PanelRail/PanelRail.module.css'
import propertiesStyles from '../editor/components/PropertiesPanel/PropertiesPanel.module.css'
import explorerStyles from '../editor/components/SiteExplorerPanel/SiteExplorerPanel.module.css'
import { PanelHeader } from '../editor/components/shared/PanelHeader'
import { SidebarResizeHandle } from '../editor/components/shared/SidebarResizeHandle'
import { SettingsButton } from '../editor/components/Toolbar/SettingsButton'
import {
  createHeadingBlock,
  createMediaBlock,
  createParagraphBlock,
  parseMarkdownBlocks,
  serializeMarkdownBlocks,
} from './markdown'
import { RichMarkdownEditor } from './RichMarkdownEditor'
import type { ContentBlock, ContentCollection, ContentEntry, ContentEntryStatus, ContentMediaType } from './types'
import styles from './ContentAdmin.module.css'

type SaveMessage = 'idle' | 'saving' | 'saved' | 'publishing' | 'published' | 'error'
type MediaPickerKind = 'media' | 'featured'
interface MediaPickerState {
  kind: MediaPickerKind
  targetBlockId?: string
}
type ContentPanelId = 'content' | 'media'

function slugFromTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled'
}

function updateEntryList(entries: ContentEntry[], entry: ContentEntry): ContentEntry[] {
  const existing = entries.findIndex((candidate) => candidate.id === entry.id)
  if (existing === -1) return [entry, ...entries]
  const next = [...entries]
  next[existing] = entry
  return next
}

function mediaTypeFromAsset(asset: CmsMediaAsset): ContentMediaType {
  return asset.mimeType.startsWith('video/') ? 'video' : 'image'
}

function publicContentPath(routeBase: string, entrySlug: string): string {
  const trimmedBase = routeBase.trim()
  const withLeadingSlash = trimmedBase.startsWith('/') ? trimmedBase : `/${trimmedBase}`
  const normalizedBase = withLeadingSlash.replace(/\/+$/g, '') || '/'
  return `${normalizedBase === '/' ? '' : normalizedBase}/${entrySlug}`
}

export function ContentAdmin() {
  const [collections, setCollections] = useState<ContentCollection[]>([])
  const [entries, setEntries] = useState<ContentEntry[]>([])
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [selectedEntry, setSelectedEntry] = useState<ContentEntry | null>(null)
  const [title, setTitle] = useState('')
  const [slug, setSlug] = useState('')
  const [seoTitle, setSeoTitle] = useState('')
  const [seoDescription, setSeoDescription] = useState('')
  const [featuredMediaId, setFeaturedMediaId] = useState<string | null>(null)
  const [blocks, setBlocks] = useState<ContentBlock[]>([createParagraphBlock()])
  const [mediaAssets, setMediaAssets] = useState<CmsMediaAsset[]>([])
  const [mediaAssetsLoaded, setMediaAssetsLoaded] = useState(false)
  const [mediaLoading, setMediaLoading] = useState(false)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [mediaPicker, setMediaPicker] = useState<MediaPickerState | null>(null)
  const [activeContentPanel, setActiveContentPanel] = useState<ContentPanelId | null>('content')
  const [loading, setLoading] = useState(true)
  const [entriesLoading, setEntriesLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState<SaveMessage>('idle')
  const titleId = useId()
  const slugId = useId()
  const seoTitleId = useId()
  const seoDescriptionId = useId()

  const selectedCollection = collections.find((collection) => collection.id === selectedCollectionId) ?? null
  const publicPath = selectedCollection && slug ? publicContentPath(selectedCollection.routeBase, slug) : ''
  const openEntryLabel = `Open ${(selectedCollection?.singularLabel ?? 'entry').toLowerCase()} in new tab`
  const featuredMediaAsset = mediaAssets.find((asset) => asset.id === featuredMediaId) ?? null
  const contentLoading = loading || entriesLoading

  const filteredMediaAssets = useMemo(() => {
    if (!mediaPicker) return []
    return mediaAssets.filter((asset) =>
      asset.mimeType.startsWith('image/') || asset.mimeType.startsWith('video/'),
    )
  }, [mediaAssets, mediaPicker])

  useEffect(() => {
    useEditorStore.getState().setPropertiesPanel({ collapsed: false })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadCollections() {
      setLoading(true)
      setEntriesLoading(true)
      setError(null)
      try {
        const nextCollections = await listCmsContentCollections()
        if (cancelled) return
        const fallbackCollectionId = nextCollections[0]?.id ?? null
        setCollections(nextCollections)
        setEntriesLoading(Boolean(fallbackCollectionId))
        setSelectedCollectionId((current) => current ?? fallbackCollectionId)
      } catch (err) {
        if (!cancelled) {
          setEntriesLoading(false)
          setError(err instanceof Error ? err.message : 'Could not load content')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadCollections()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!selectedCollectionId) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setEntriesLoading(false)
      })
      return () => { cancelled = true }
    }
    const collectionId = selectedCollectionId
    let cancelled = false

    async function loadEntries() {
      setEntriesLoading(true)
      setError(null)
      try {
        const nextEntries = await listCmsContentEntries(collectionId)
        if (cancelled) return
        setEntries(nextEntries)
        if (!selectedEntry || selectedEntry.collectionId !== collectionId) {
          applySelectedEntry(nextEntries[0] ?? null)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load entries')
      } finally {
        if (!cancelled) setEntriesLoading(false)
      }
    }

    void loadEntries()
    return () => { cancelled = true }
    // selectedEntry is a current guard; changing collection is the reload trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCollectionId])

  function applySelectedEntry(entry: ContentEntry | null) {
    setSelectedEntry(entry)
    setTitle(entry?.title ?? '')
    setSlug(entry?.slug ?? '')
    setSeoTitle(entry?.seoTitle ?? '')
    setSeoDescription(entry?.seoDescription ?? '')
    setFeaturedMediaId(entry?.featuredMediaId ?? null)
    setBlocks(entry ? parseMarkdownBlocks(entry.bodyMarkdown) : [createParagraphBlock()])
    setSaveMessage('idle')
    useEditorStore.getState().setPropertiesPanel({ collapsed: false })
  }

  async function handleCreateEntry() {
    if (!selectedCollection) return
    setSaveMessage('saving')
    setError(null)
    try {
      const nextSlug = entries.length === 0 ? 'untitled' : `untitled-${entries.length + 1}`
      const entry = await createCmsContentEntry(selectedCollection.id, {
        title: 'Untitled',
        slug: nextSlug,
      })
      setEntries((current) => updateEntryList(current, entry))
      applySelectedEntry(entry)
      setSaveMessage('saved')
    } catch (err) {
      setSaveMessage('error')
      setError(err instanceof Error ? err.message : 'Could not create entry')
    }
  }

  async function saveDraft(): Promise<ContentEntry | null> {
    if (!selectedEntry) return null
    const nextTitle = title.trim() || 'Untitled'
    const nextSlug = slugFromTitle(slug || nextTitle)
    const entry = await saveCmsContentEntryDraft(selectedEntry.id, {
      title: nextTitle,
      slug: nextSlug,
      bodyMarkdown: serializeMarkdownBlocks(blocks),
      featuredMediaId,
      seoTitle: seoTitle.trim(),
      seoDescription: seoDescription.trim(),
    })
    setSelectedEntry(entry)
    setEntries((current) => updateEntryList(current, entry))
    setTitle(entry.title)
    setSlug(entry.slug)
    setSeoTitle(entry.seoTitle)
    setSeoDescription(entry.seoDescription)
    setFeaturedMediaId(entry.featuredMediaId)
    return entry
  }

  async function handleSaveDraft() {
    setSaveMessage('saving')
    setError(null)
    try {
      await saveDraft()
      setSaveMessage('saved')
    } catch (err) {
      setSaveMessage('error')
      setError(err instanceof Error ? err.message : 'Could not save draft')
    }
  }

  async function handlePublish() {
    if (!selectedEntry) return
    setSaveMessage('publishing')
    setError(null)
    try {
      const savedEntry = await saveDraft()
      if (!savedEntry) return
      const publishedEntry = await publishCmsContentEntry(savedEntry.id)
      setSelectedEntry(publishedEntry)
      setEntries((current) => updateEntryList(current, publishedEntry))
      setSaveMessage('published')
    } catch (err) {
      setSaveMessage('error')
      setError(err instanceof Error ? err.message : 'Could not publish entry')
    }
  }

  const loadMediaAssets = useCallback(async () => {
    try {
      const assets = await listCmsMediaAssets()
      setMediaAssets(assets)
      return assets
    } finally {
      setMediaAssetsLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!featuredMediaId || mediaAssetsLoaded) return
    void loadMediaAssets().catch(() => {})
  }, [featuredMediaId, mediaAssetsLoaded, loadMediaAssets])

  async function openMediaPicker(kind: MediaPickerKind, targetBlockId?: string) {
    setMediaPicker({ kind, targetBlockId })
    setMediaLoading(true)
    setMediaError(null)
    try {
      await loadMediaAssets()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not load media'
      setMediaError(message)
      console.error('[ContentAdmin] load media picker error:', err)
    } finally {
      setMediaLoading(false)
    }
  }

  function insertMedia(asset: CmsMediaAsset) {
    if (!mediaPicker) return

    if (mediaPicker.kind === 'featured') {
      setFeaturedMediaId(asset.id)
      setMediaPicker(null)
      return
    }

    const mediaType = mediaTypeFromAsset(asset)
    setBlocks((current) => {
      if (!mediaPicker.targetBlockId) {
        return [
          ...current,
          createMediaBlock(asset.publicPath, mediaType, mediaType === 'image' ? asset.filename : ''),
        ]
      }

      return current.map((block) => {
        if (block.id !== mediaPicker.targetBlockId) return block
        return {
          id: block.id,
          type: 'media',
          mediaType,
          src: asset.publicPath,
          alt: mediaType === 'image' ? asset.filename : '',
        }
      })
    })
    setMediaPicker(null)
  }

  async function handleStatusChange(nextStatus: ContentEntryStatus) {
    if (!selectedEntry || nextStatus === selectedEntry.status) return

    if (nextStatus === 'published') {
      await handlePublish()
      return
    }

    setSaveMessage('saving')
    setError(null)
    try {
      const savedEntry = await saveDraft()
      if (!savedEntry) return
      const updatedEntry = await updateCmsContentEntryStatus(savedEntry.id, nextStatus)
      setSelectedEntry(updatedEntry)
      setEntries((current) => updateEntryList(current, updatedEntry))
      setTitle(updatedEntry.title)
      setSlug(updatedEntry.slug)
      setSeoTitle(updatedEntry.seoTitle)
      setSeoDescription(updatedEntry.seoDescription)
      setFeaturedMediaId(updatedEntry.featuredMediaId)
      setSaveMessage('idle')
    } catch (err) {
      setSaveMessage('error')
      setError(err instanceof Error ? err.message : 'Could not update entry status')
    }
  }

  const statusText =
    contentLoading ? 'Loading content' :
    saveMessage === 'saving' ? 'Saving draft' :
    saveMessage === 'saved' ? 'Draft saved' :
    saveMessage === 'publishing' ? 'Publishing' :
    saveMessage === 'published' ? 'Published' :
    saveMessage === 'error' ? 'Save failed' :
    selectedEntry?.status === 'published' ? 'Published' :
    selectedEntry?.status === 'unpublished' ? 'Unpublished' :
    selectedEntry ? 'Draft' :
    'No entry selected'

  const toolbarRightSlot = (
    <>
      <span className={styles.toolbarStatus}>{statusText}</span>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={openEntryLabel}
        title={openEntryLabel}
        disabled={!publicPath}
        onClick={() => {
          if (!publicPath) return
          window.open(publicPath, '_blank', 'noopener,noreferrer')
        }}
      >
        <ExternalLinkIcon size={16} aria-hidden="true" />
      </Button>
      <Button variant="secondary" size="sm" disabled={!selectedEntry || saveMessage === 'saving'} onClick={() => void handleSaveDraft()}>
        <SaveIcon size={14} aria-hidden="true" />
        <span>Save Draft</span>
      </Button>
      <Button variant="primary" size="sm" disabled={!selectedEntry || saveMessage === 'publishing'} onClick={() => void handlePublish()}>
        <SendIcon size={14} aria-hidden="true" />
        <span>Publish</span>
      </Button>
      <SettingsButton />
    </>
  )

  const notchActions: CanvasNotchAction[] = [
    {
      id: 'heading',
      label: 'Heading',
      icon: HeadingIcon,
      onClick: () => setBlocks((current) => [...current, createHeadingBlock()]),
    },
    {
      id: 'text',
      label: 'Text',
      icon: TextPlusIcon,
      onClick: () => setBlocks((current) => [...current, createParagraphBlock()]),
    },
    {
      id: 'media',
      label: 'Media',
      icon: ImagesIcon,
      onClick: () => void openMediaPicker('media'),
    },
  ]
  return (
    <>
      <EditorLayout
        workspace="content"
        toolbarRightSlot={toolbarRightSlot}
        contentSidebar={(
          <ContentSidebar
            activePanel={activeContentPanel}
            onActivePanelChange={setActiveContentPanel}
            contentPanel={(
              <ContentExplorerPanel
                loading={contentLoading}
                error={error}
                collections={collections}
                entries={entries}
                selectedCollectionId={selectedCollectionId}
                selectedEntryId={selectedEntry?.id ?? null}
                onSelectCollection={(collectionId) => {
                  if (collectionId === selectedCollectionId) return
                  setEntriesLoading(true)
                  setSelectedCollectionId(collectionId)
                }}
                onSelectEntry={applySelectedEntry}
                onCreateEntry={() => void handleCreateEntry()}
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
            selectedEntry={selectedEntry}
            selectedCollection={selectedCollection}
            loading={contentLoading}
            title={title}
            titleId={titleId}
            blocks={blocks}
            notchActions={notchActions}
            onTitleChange={setTitle}
            onBlocksChange={setBlocks}
            onRequestMedia={(blockId) => void openMediaPicker('media', blockId)}
            onCreateEntry={() => void handleCreateEntry()}
          />
        )}
        contentRightPanel={(
          <ContentSettingsPanel
            selectedEntry={selectedEntry}
            loading={contentLoading}
            slug={slug}
            slugId={slugId}
            seoTitle={seoTitle}
            seoTitleId={seoTitleId}
            seoDescription={seoDescription}
            seoDescriptionId={seoDescriptionId}
            publicPath={publicPath}
            mediaAssets={mediaAssets}
            mediaLoading={mediaLoading}
            mediaError={mediaError}
            featuredMediaId={featuredMediaId}
            featuredMediaAsset={featuredMediaAsset}
            onSlugChange={setSlug}
            onSeoTitleChange={setSeoTitle}
            onSeoDescriptionChange={setSeoDescription}
            onStatusChange={(status) => void handleStatusChange(status)}
            onChooseFeaturedMedia={() => void openMediaPicker('featured')}
            onClearFeaturedMedia={() => setFeaturedMediaId(null)}
          />
        )}
      />

      {mediaPicker && (
        <div className={styles.mediaOverlay} role="dialog" aria-modal="true" aria-label={`Pick ${mediaPicker.kind}`}>
          <div className={styles.mediaDialog}>
            <header className={styles.mediaHeader}>
              <h2>{mediaPicker.kind === 'featured' ? 'Pick featured media' : `Pick ${mediaPicker.kind}`}</h2>
              <Button variant="ghost" size="sm" onClick={() => setMediaPicker(null)}>Close</Button>
            </header>
            {mediaLoading ? (
              <p className={styles.muted}>Loading media...</p>
            ) : mediaError ? (
              <p className={styles.error} role="alert">{mediaError}</p>
            ) : filteredMediaAssets.length === 0 ? (
              <p className={styles.muted}>No matching media yet.</p>
            ) : (
              <div className={styles.mediaGrid}>
                {filteredMediaAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    className={styles.mediaTile}
                    onClick={() => insertMedia(asset)}
                  >
                    {asset.mimeType.startsWith('image/') ? (
                      <img src={asset.publicPath} alt="" />
                    ) : (
                      <video src={asset.publicPath} />
                    )}
                    <span>{asset.filename}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

interface ContentSidebarProps {
  activePanel: ContentPanelId | null
  onActivePanelChange: (panel: ContentPanelId | null) => void
  contentPanel: ReactNode
  mediaPanel: ReactNode
}

function ContentSidebar({
  activePanel,
  onActivePanelChange,
  contentPanel,
  mediaPanel,
}: ContentSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const leftSidebarWidth = useEditorStore((s) => s.leftSidebarWidth)
  const setLeftSidebarWidth = useEditorStore((s) => s.setLeftSidebarWidth)
  const panelWidth = activePanel ? leftSidebarWidth : 0
  const style = {
    '--left-sidebar-panel-width': `${panelWidth}px`,
  } as CSSProperties

  return (
    <aside
      ref={sidebarRef}
      className={leftSidebarStyles.sidebar}
      data-testid="left-sidebar"
      data-expanded={activePanel ? 'true' : 'false'}
      data-active-panel={activePanel ?? 'none'}
      style={style}
    >
      <nav
        aria-label="Content panel dock"
        className={panelRailStyles.rail}
        data-testid="content-panel-rail"
      >
        <div className={panelRailStyles.itemGroup}>
          <ContentRailButton
            id="content"
            label="Content"
            icon={BookOpenIcon}
            iconName="book-open"
            accent="mint"
            active={activePanel === 'content'}
            onToggle={() => onActivePanelChange(activePanel === 'content' ? null : 'content')}
          />
          <ContentRailButton
            id="media"
            label="Media"
            icon={ImagesIcon}
            iconName="images"
            accent="sky"
            active={activePanel === 'media'}
            onToggle={() => onActivePanelChange(activePanel === 'media' ? null : 'media')}
          />
        </div>
      </nav>

      <div
        className={leftSidebarStyles.panelSlot}
        data-testid="left-sidebar-panel-slot"
        aria-hidden={activePanel ? undefined : 'true'}
      >
        <div className={leftSidebarStyles.panelMount}>
          {activePanel === 'content' ? contentPanel : activePanel === 'media' ? mediaPanel : null}
        </div>
      </div>

      {activePanel && (
        <SidebarResizeHandle
          side="left"
          width={leftSidebarWidth}
          targetRef={sidebarRef}
          cssVariable="--left-sidebar-panel-width"
          ariaLabel="Resize content sidebar"
          onResize={setLeftSidebarWidth}
        />
      )}
    </aside>
  )
}

interface ContentRailButtonProps {
  id: ContentPanelId
  label: string
  icon: IconComponent
  iconName: string
  accent: 'mint' | 'sky'
  active: boolean
  onToggle: () => void
}

function ContentRailButton({
  id,
  label,
  icon,
  iconName,
  accent,
  active,
  onToggle,
}: ContentRailButtonProps) {
  const RailIcon = icon
  const action = active ? 'Close' : 'Open'

  return (
    <Button
      variant="ghost"
      size="md"
      iconOnly
      pressed={active}
      aria-label={`${action} ${label} panel`}
      title={`${label} panel`}
      data-testid={`panel-rail-${id}`}
      data-icon={iconName}
      data-accent={accent}
      onClick={onToggle}
      className={panelRailStyles.railButton}
    >
      <span className={panelRailStyles.activeIndicator} aria-hidden="true" />
      <RailIcon size={16} className={panelRailStyles.railIcon} />
    </Button>
  )
}

interface ContentExplorerPanelProps {
  loading: boolean
  error: string | null
  collections: ContentCollection[]
  entries: ContentEntry[]
  selectedCollectionId: string | null
  selectedEntryId: string | null
  onSelectCollection: (collectionId: string) => void
  onSelectEntry: (entry: ContentEntry) => void
  onCreateEntry: () => void
  onClose: () => void
}

function ContentExplorerPanel({
  loading,
  error,
  collections,
  entries,
  selectedCollectionId,
  selectedEntryId,
  onSelectCollection,
  onSelectEntry,
  onCreateEntry,
  onClose,
}: ContentExplorerPanelProps) {
  return (
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

        <section className={explorerStyles.section} aria-label="Entries">
          <div className={explorerStyles.sectionHeader}>
            <h2 className={explorerStyles.sectionTitle}>Entries</h2>
            <span className={explorerStyles.sectionCount}>{entries.length}</span>
            <Button
              variant="ghost"
              size="xs"
              iconOnly
              onClick={onCreateEntry}
              disabled={!selectedCollectionId}
              aria-label="New post"
              title="New post"
            >
              <FilePlusIcon size={13} aria-hidden="true" />
            </Button>
          </div>

          {loading ? (
            <ContentEntriesLoading />
          ) : entries.length === 0 ? (
            <p className={explorerStyles.emptyState}>No entries yet.</p>
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

interface ContentDocumentCanvasProps {
  selectedEntry: ContentEntry | null
  selectedCollection: ContentCollection | null
  loading: boolean
  title: string
  titleId: string
  blocks: ContentBlock[]
  notchActions: CanvasNotchAction[]
  onTitleChange: (value: string) => void
  onBlocksChange: (blocks: ContentBlock[]) => void
  onRequestMedia: (blockId: string) => void
  onCreateEntry: () => void
}

function ContentDocumentCanvas({
  selectedEntry,
  selectedCollection,
  loading,
  title,
  titleId,
  blocks,
  notchActions,
  onTitleChange,
  onBlocksChange,
  onRequestMedia,
  onCreateEntry,
}: ContentDocumentCanvasProps) {
  const addControl = (
    <Button
      variant="primary"
      size="sm"
      className={styles.notchAddButton}
      disabled={loading || !selectedEntry}
      onClick={() => onBlocksChange([...blocks, createParagraphBlock()])}
    >
      <FilePlusIcon size={14} aria-hidden="true" />
      <span>Add</span>
    </Button>
  )

  return (
    <div
      role="region"
      aria-label="Content canvas"
      data-testid="content-canvas-root"
      className={cn(canvasStyles.canvas, styles.contentCanvas)}
    >
      <CanvasNotch actions={notchActions} addControl={addControl} />

      <div className={styles.documentScroll}>
        {loading ? (
          <ContentCanvasLoading />
        ) : selectedEntry ? (
          <article className={styles.document}>
            <label className={styles.titleLabel} htmlFor={titleId}>Title</label>
            <Input
              id={titleId}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              className={styles.titleInput}
              fieldSize="md"
              emphasis="strong"
            />
            <RichMarkdownEditor blocks={blocks} onChange={onBlocksChange} onMediaRequest={onRequestMedia} />
          </article>
        ) : (
          <div className={styles.emptyState}>
            <h2>Create the first {selectedCollection?.singularLabel.toLowerCase() ?? 'post'}</h2>
            <p>Select a collection and create an entry to start writing.</p>
            <Button variant="primary" size="md" onClick={onCreateEntry} disabled={!selectedCollection}>
              <FilePlusIcon size={15} aria-hidden="true" />
              <span>New Post</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function ContentCanvasLoading() {
  return (
    <div
      className={styles.canvasLoading}
      data-testid="content-canvas-loading"
      aria-busy="true"
      aria-label="Loading content"
    >
      <span className={cn(styles.skeletonShape, styles.canvasSkeletonTitle)} />
      <span className={cn(styles.skeletonShape, styles.canvasSkeletonLine)} />
      <span className={cn(styles.skeletonShape, styles.canvasSkeletonShortLine)} />
      <span className={cn(styles.skeletonShape, styles.canvasSkeletonBlock)} />
    </div>
  )
}

interface ContentSettingsPanelProps {
  selectedEntry: ContentEntry | null
  loading: boolean
  slug: string
  slugId: string
  seoTitle: string
  seoTitleId: string
  seoDescription: string
  seoDescriptionId: string
  publicPath: string
  mediaAssets: CmsMediaAsset[]
  mediaLoading: boolean
  mediaError: string | null
  featuredMediaId: string | null
  featuredMediaAsset: CmsMediaAsset | null
  onSlugChange: (value: string) => void
  onSeoTitleChange: (value: string) => void
  onSeoDescriptionChange: (value: string) => void
  onStatusChange: (status: ContentEntryStatus) => void
  onChooseFeaturedMedia: () => void
  onClearFeaturedMedia: () => void
}

function ContentSettingsPanel({
  selectedEntry,
  loading,
  slug,
  slugId,
  seoTitle,
  seoTitleId,
  seoDescription,
  seoDescriptionId,
  publicPath,
  mediaAssets,
  mediaLoading,
  mediaError,
  featuredMediaId,
  featuredMediaAsset,
  onSlugChange,
  onSeoTitleChange,
  onSeoDescriptionChange,
  onStatusChange,
  onChooseFeaturedMedia,
  onClearFeaturedMedia,
}: ContentSettingsPanelProps) {
  const setPropertiesPanel = useEditorStore((s) => s.setPropertiesPanel)

  return (
    <aside
      data-panel=""
      data-testid="content-settings-panel"
      role="complementary"
      aria-label="Content settings"
      className={cn(propertiesStyles.panel, propertiesStyles.panelDocked)}
    >
      <PanelHeader
        panelId="content-settings"
        title="Settings"
        titleContent={(
          <span className={propertiesStyles.headerNodeTitle}>
            <Settings2Icon size={13} aria-hidden="true" />
            <span className={propertiesStyles.headerNodeLabel}>Settings</span>
          </span>
        )}
        onClose={() => setPropertiesPanel({ collapsed: true })}
      />

      <div className={styles.settingsBody}>
        {loading ? (
          <ContentSettingsLoading />
        ) : (
          <>
            <label className={styles.field} htmlFor={slugId}>
              <span>Slug</span>
              <Input
                id={slugId}
                value={slug}
                onChange={(event) => onSlugChange(event.target.value)}
                disabled={!selectedEntry}
              />
            </label>
            <label className={styles.field} htmlFor={seoTitleId}>
              <span>SEO title</span>
              <Input
                id={seoTitleId}
                value={seoTitle}
                onChange={(event) => onSeoTitleChange(event.target.value)}
                disabled={!selectedEntry}
              />
            </label>
            <label className={styles.field} htmlFor={seoDescriptionId}>
              <span>SEO description</span>
              <Textarea
                id={seoDescriptionId}
                value={seoDescription}
                onChange={(event) => onSeoDescriptionChange(event.target.value)}
                disabled={!selectedEntry}
                resize="none"
                rows={4}
              />
            </label>
            <div className={styles.field}>
              <span>Status</span>
              <Select
                aria-label="Status"
                value={selectedEntry?.status ?? 'draft'}
                disabled={!selectedEntry}
                onChange={(event) => onStatusChange(event.target.value as ContentEntryStatus)}
                options={[
                  { value: 'draft', label: 'Draft' },
                  { value: 'published', label: 'Published' },
                  { value: 'unpublished', label: 'Unpublished' },
                ]}
              />
            </div>
            <div className={styles.metaBlock}>
              <span>Public URL</span>
              <strong>{publicPath || 'Not available'}</strong>
            </div>
            <div className={styles.featuredMediaField}>
              <span>Featured media</span>
              {featuredMediaAsset ? (
                <div className={styles.featuredMediaCard}>
                  <span className={styles.featuredMediaPreview} aria-hidden="true">
                    {featuredMediaAsset.mimeType.startsWith('image/') ? (
                      <img src={featuredMediaAsset.publicPath} alt="" />
                    ) : (
                      <VideoIcon size={16} />
                    )}
                  </span>
                  <span className={styles.featuredMediaText}>
                    <strong>{featuredMediaAsset.filename}</strong>
                    <small>{featuredMediaAsset.publicPath}</small>
                  </span>
                </div>
              ) : (
                <strong>{featuredMediaId ?? 'None'}</strong>
              )}
              {mediaError && <p className={styles.error} role="alert">{mediaError}</p>}
              <div className={styles.featuredMediaActions}>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!selectedEntry || mediaLoading}
                  onClick={onChooseFeaturedMedia}
                >
                  {mediaLoading ? 'Loading media' : 'Choose featured media'}
                </Button>
                {featuredMediaId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!selectedEntry}
                    onClick={onClearFeaturedMedia}
                  >
                    Clear
                  </Button>
                )}
              </div>
              {mediaAssets.length > 0 && !featuredMediaAsset && featuredMediaId && (
                <small className={styles.muted}>Selected media is not in the current library results.</small>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}

function ContentSettingsLoading() {
  return (
    <div
      className={styles.settingsSkeleton}
      data-testid="content-settings-loading"
      aria-busy="true"
      aria-label="Loading content settings"
    >
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonLabel)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonInput)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonLabel)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonInput)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonLabel)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonTextarea)} />
      <span className={cn(styles.skeletonShape, styles.settingsSkeletonCard)} />
    </div>
  )
}
