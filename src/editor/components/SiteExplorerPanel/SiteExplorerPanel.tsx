import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { useEditorStore } from '@core/editor-store/store'
import type { SiteFile } from '@core/files/schemas'
import type { Page } from '@core/page-tree'
import type { VisualComponent } from '@core/visualComponents/schemas'
import { createUniquePageSlug, pagePublicPath } from '@core/page-tree/slugs'
import { PanelHeader } from '../shared/PanelHeader'
import { Button } from '@ui/components/Button'
import { EmptyState } from '@ui/components/EmptyState'
import type { IconComponent } from 'pixel-art-icons/types'
import { FilePlusIcon } from 'pixel-art-icons/icons/file-plus'
import { FileTextIcon } from 'pixel-art-icons/icons/file-text'
import { BracesIcon } from 'pixel-art-icons/icons/braces'
import { PaintBucketIcon } from 'pixel-art-icons/icons/paint-bucket'
import { CodeIcon } from 'pixel-art-icons/icons/code'
import { ExternalLinkIcon } from 'pixel-art-icons/icons/external-link'
import { cn } from '@ui/cn'
import {
  SiteCreateDialog,
  buildScriptPath,
  buildStylePath,
  slugifySiteItemName,
  toPascalCaseSiteItemName,
  type SiteCreatePayload,
  type SiteCreateKind,
} from '../SiteCreateDialog'
import { ExplorerItemContextMenu, ExplorerRenameDialog, type ExplorerRenamePayload } from '../ExplorerPanelActions'
import { TemplateSettingsDialog, type TemplateSettingsPayload } from '../TemplateSettingsDialog'
import styles from './SiteExplorerPanel.module.css'

interface SiteExplorerPanelProps {
  variant?: 'docked'
}

type FileBucket = 'styles' | 'scripts'

type SiteExplorerContextTarget =
  | { kind: 'page'; id: string; title: string; slug: string }
  | { kind: 'component'; id: string; name: string }
  | { kind: 'file'; id: string; path: string }

interface ContextMenuState {
  x: number
  y: number
  target: SiteExplorerContextTarget
}

const EMPTY_FILES: SiteFile[] = []

function fileName(path: string) {
  return path.split('/').pop() ?? path
}

function fileExtension(path: string) {
  const name = fileName(path)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index) : ''
}

function pathFromRenameInput(currentPath: string, value: string) {
  const trimmed = value.trim()
  if (trimmed.includes('/')) return trimmed

  const slash = currentPath.lastIndexOf('/')
  const directory = slash >= 0 ? currentPath.slice(0, slash + 1) : ''
  const extension = fileExtension(currentPath)
  const nextName = extension && !trimmed.endsWith(extension) ? `${trimmed}${extension}` : trimmed
  return `${directory}${nextName}`
}

function keyboardMenuPosition(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.left + Math.min(rect.width - 8, 24),
    y: rect.top + Math.min(rect.height - 8, 24),
  }
}

function groupSiteFiles(files: SiteFile[]) {
  const visible = files.filter((file) => !file.generated || file.ejected)
  return {
    styles: visible.filter((file) => file.type === 'style'),
    scripts: visible.filter((file) => file.type === 'script'),
  } satisfies Record<FileBucket, SiteFile[]>
}

export function SiteExplorerPanel({
  variant = 'docked',
}: SiteExplorerPanelProps) {
  const isOpen = useEditorStore((s) => s.siteExplorerPanelOpen)
  const site = useEditorStore((s) => s.site)
  const activePageId = useEditorStore((s) => s.activePageId)
  const activeDocument = useEditorStore((s) => s.activeDocument)
  const setSiteExplorerPanelOpen = useEditorStore((s) => s.setSiteExplorerPanelOpen)
  const openPageInCanvas = useEditorStore((s) => s.openPageInCanvas)
  const setActiveDocument = useEditorStore((s) => s.setActiveDocument)
  const addPage = useEditorStore((s) => s.addPage)
  const renamePage = useEditorStore((s) => s.renamePage)
  const deletePage = useEditorStore((s) => s.deletePage)
  const convertPageToTemplate = useEditorStore((s) => s.convertPageToTemplate)
  const convertTemplateToPage = useEditorStore((s) => s.convertTemplateToPage)
  const createVisualComponent = useEditorStore((s) => s.createVisualComponent)
  const renameVisualComponent = useEditorStore((s) => s.renameVisualComponent)
  const deleteVisualComponent = useEditorStore((s) => s.deleteVisualComponent)
  const createFile = useEditorStore((s) => s.createFile)
  const renameFile = useEditorStore((s) => s.renameFile)
  const deleteFile = useEditorStore((s) => s.deleteFile)
  const openInEditor = useEditorStore((s) => s.openInEditor)
  const [createKind, setCreateKind] = useState<SiteCreateKind | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [renameTarget, setRenameTarget] = useState<SiteExplorerContextTarget | null>(null)
  const [templateSettingsTarget, setTemplateSettingsTarget] = useState<Page | null>(null)
  const panelRef = useRef<HTMLElement>(null)

  const files = site?.files ?? EMPTY_FILES
  const fileBuckets = useMemo(() => groupSiteFiles(files), [files])

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => panelRef.current?.focus())
    }
  }, [isOpen])

  if (!isOpen || variant !== 'docked') return null

  function handleCreate({ name, slug }: SiteCreatePayload) {
    if (!createKind) return

    try {
      if (createKind === 'page') {
        const page = addPage(name, slug ?? slugifySiteItemName(name))
        openPageInCanvas(page.id)
      } else if (createKind === 'component') {
        const vcId = createVisualComponent(toPascalCaseSiteItemName(name))
        setActiveDocument({ kind: 'visualComponent', vcId })
      } else if (createKind === 'style') {
        const fileId = createFile(buildStylePath(name), 'style', '')
        openInEditor(fileId)
      } else {
        const fileId = createFile(buildScriptPath(name), 'script', '')
        openInEditor(fileId)
      }
      setCreateKind(null)
    } catch (err) {
      console.error('[SiteExplorerPanel] create site item error:', err)
    }
  }

  const pages = site?.pages ?? []
  const normalPages = pages.filter((page) => !page.template)
  const templatePages = pages.filter((page) => page.template)
  const components = site?.visualComponents ?? []

  function pageForTarget(target: SiteExplorerContextTarget): Page | null {
    if (target.kind !== 'page') return null
    return pages.find((page) => page.id === target.id) ?? null
  }

  function openContextMenu(target: SiteExplorerContextTarget, event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ x: event.clientX, y: event.clientY, target })
  }

  function openKeyboardContextMenu(target: SiteExplorerContextTarget, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({ ...keyboardMenuPosition(event.currentTarget), target })
  }

  function handleRename(payload: ExplorerRenamePayload) {
    if (!renameTarget) return

    if (renameTarget.kind === 'page') {
      renamePage(renameTarget.id, payload.value, payload.slug)
    } else if (renameTarget.kind === 'component') {
      renameVisualComponent(renameTarget.id, toPascalCaseSiteItemName(payload.value))
    } else {
      renameFile(renameTarget.id, pathFromRenameInput(renameTarget.path, payload.value))
    }

    setRenameTarget(null)
  }

  function handleDelete(target: SiteExplorerContextTarget) {
    if (target.kind === 'page') {
      deletePage(target.id)
    } else if (target.kind === 'component') {
      deleteVisualComponent(target.id)
      if (activeDocument?.kind === 'visualComponent' && activeDocument.vcId === target.id) {
        setActiveDocument(null)
      }
    } else {
      deleteFile(target.id)
    }
    setContextMenu(null)
  }

  function handleCreateTemplate() {
    const slug = createUniquePageSlug('Post Template', pages)
    const page = addPage('Post Template', slug)
    openPageInCanvas(page.id)
    setTemplateSettingsTarget(page)
  }

  function handleSaveTemplateSettings(payload: TemplateSettingsPayload) {
    if (!templateSettingsTarget) return
    renamePage(templateSettingsTarget.id, payload.title, payload.slug)
    convertPageToTemplate(templateSettingsTarget.id, payload.template)
    setTemplateSettingsTarget(null)
    openPageInCanvas(templateSettingsTarget.id)
  }

  function templateMenuItems(target: SiteExplorerContextTarget) {
    const page = pageForTarget(target)
    if (!page) return []

    if (page.template) {
      return [
        {
          label: 'Template settings',
          icon: <FileTextIcon size={13} />,
          action: () => {
            setTemplateSettingsTarget(page)
            setContextMenu(null)
          },
        },
        {
          label: 'Convert to page',
          icon: <FileTextIcon size={13} />,
          action: () => {
            convertTemplateToPage(page.id)
            setContextMenu(null)
          },
        },
      ]
    }

    return [{
      label: 'Use as template',
      icon: <FileTextIcon size={13} />,
      action: () => {
        setTemplateSettingsTarget(page)
        setContextMenu(null)
      },
    }]
  }

  function pageMenuItems(target: SiteExplorerContextTarget) {
    const page = pageForTarget(target)
    if (!page) return []

    return [
      {
        label: 'Open in new tab',
        icon: <ExternalLinkIcon size={13} />,
        action: () => {
          window.open(pagePublicPath(page.slug), '_blank', 'noopener,noreferrer')
          setContextMenu(null)
        },
      },
      ...templateMenuItems(target),
    ]
  }

  return (
    <>
      <aside
        ref={panelRef}
        role="complementary"
        aria-label="Site Explorer"
        data-panel=""
        data-testid="site-explorer-panel"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={styles.panel}
      >
        <PanelHeader
          panelId="site-explorer"
          title="Site"
          onClose={() => setSiteExplorerPanelOpen(false)}
        />

        <div className={styles.content}>
          {!site ? (
            <EmptyState compact title="Loading site..." />
          ) : (
            <>
              <ExplorerSection
                title="Pages"
                count={normalPages.length}
                actionLabel="New page"
                actionIcon={FilePlusIcon}
                onAction={() => setCreateKind('page')}
              >
                {normalPages.map((page) => (
                  <ExplorerRow
                    key={page.id}
                    icon={FileTextIcon}
                    label={page.title}
                    meta={page.slug === 'index' ? '/' : `/${page.slug}`}
                    active={page.id === activePageId && activeDocument?.kind !== 'visualComponent'}
                    ariaLabel={`Open page ${page.title}`}
                    onClick={() => openPageInCanvas(page.id)}
                    onContextMenu={(event) => openContextMenu({
                      kind: 'page',
                      id: page.id,
                      title: page.title,
                      slug: page.slug,
                    }, event)}
                    onKeyDown={(event) => openKeyboardContextMenu({
                      kind: 'page',
                      id: page.id,
                      title: page.title,
                      slug: page.slug,
                    }, event)}
                  />
                ))}
              </ExplorerSection>

              <ExplorerSection
                title="Templates"
                count={templatePages.length}
                actionLabel="New template"
                actionIcon={FilePlusIcon}
                onAction={handleCreateTemplate}
              >
                {templatePages.map((page) => (
                  <ExplorerRow
                    key={page.id}
                    icon={FileTextIcon}
                    label={page.title}
                    meta={page.template?.collectionId ?? ''}
                    active={page.id === activePageId && activeDocument?.kind !== 'visualComponent'}
                    ariaLabel={`Open template ${page.title}`}
                    onClick={() => openPageInCanvas(page.id)}
                    onContextMenu={(event) => openContextMenu({
                      kind: 'page',
                      id: page.id,
                      title: page.title,
                      slug: page.slug,
                    }, event)}
                    onKeyDown={(event) => openKeyboardContextMenu({
                      kind: 'page',
                      id: page.id,
                      title: page.title,
                      slug: page.slug,
                    }, event)}
                  />
                ))}
              </ExplorerSection>

              <ExplorerSection
                title="Components"
                count={components.length}
                actionLabel="New component"
                actionIcon={BracesIcon}
                onAction={() => setCreateKind('component')}
              >
                {components.map((component) => (
                  <DraggableComponentRow
                    key={component.id}
                    component={component}
                    active={activeDocument?.kind === 'visualComponent' && activeDocument.vcId === component.id}
                    onOpen={() => setActiveDocument({ kind: 'visualComponent', vcId: component.id })}
                    onContextMenu={(event) => openContextMenu({
                      kind: 'component',
                      id: component.id,
                      name: component.name,
                    }, event)}
                    onKeyDown={(event) => openKeyboardContextMenu({
                      kind: 'component',
                      id: component.id,
                      name: component.name,
                    }, event)}
                  />
                ))}
              </ExplorerSection>

              <ExplorerSection
                title="Styles"
                count={fileBuckets.styles.length}
                actionLabel="New stylesheet"
                actionIcon={PaintBucketIcon}
                onAction={() => setCreateKind('style')}
              >
                <FileRows
                  files={fileBuckets.styles}
                  icon={PaintBucketIcon}
                  onOpen={openInEditor}
                  onContextMenu={(file, event) => openContextMenu({
                    kind: 'file',
                    id: file.id,
                    path: file.path,
                  }, event)}
                  onKeyDown={(file, event) => openKeyboardContextMenu({
                    kind: 'file',
                    id: file.id,
                    path: file.path,
                  }, event)}
                />
              </ExplorerSection>

              <ExplorerSection
                title="Scripts"
                count={fileBuckets.scripts.length}
                actionLabel="New script"
                actionIcon={CodeIcon}
                onAction={() => setCreateKind('script')}
              >
                <FileRows
                  files={fileBuckets.scripts}
                  icon={CodeIcon}
                  onOpen={openInEditor}
                  onContextMenu={(file, event) => openContextMenu({
                    kind: 'file',
                    id: file.id,
                    path: file.path,
                  }, event)}
                  onKeyDown={(file, event) => openKeyboardContextMenu({
                    kind: 'file',
                    id: file.id,
                    path: file.path,
                  }, event)}
                />
              </ExplorerSection>
            </>
          )}
        </div>
      </aside>

      {createKind && (
        <SiteCreateDialog
          kind={createKind}
          pages={pages}
          onCancel={() => setCreateKind(null)}
          onCreate={handleCreate}
        />
      )}

      {contextMenu && (
        <ExplorerItemContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          ariaLabel="Site item options"
          deleteDisabled={contextMenu.target.kind === 'page' && pages.length <= 1}
          extraItems={pageMenuItems(contextMenu.target)}
          onClose={() => setContextMenu(null)}
          onRename={() => {
            setRenameTarget(contextMenu.target)
            setContextMenu(null)
          }}
          onDelete={() => handleDelete(contextMenu.target)}
        />
      )}

      {templateSettingsTarget && (
        <TemplateSettingsDialog
          page={templateSettingsTarget}
          pages={pages}
          onCancel={() => setTemplateSettingsTarget(null)}
          onSave={handleSaveTemplateSettings}
        />
      )}

      {renameTarget && (
        <ExplorerRenameDialog
          title={
            renameTarget.kind === 'page'
              ? 'Rename page'
              : renameTarget.kind === 'component'
                ? 'Rename component'
                : 'Rename file'
          }
          fieldLabel={renameTarget.kind === 'file' ? 'Path' : 'Name'}
          initialValue={
            renameTarget.kind === 'page'
              ? renameTarget.title
              : renameTarget.kind === 'component'
                ? renameTarget.name
                : renameTarget.path
          }
          initialSlug={renameTarget.kind === 'page' ? renameTarget.slug : undefined}
          pageId={renameTarget.kind === 'page' ? renameTarget.id : undefined}
          pages={pages}
          onCancel={() => setRenameTarget(null)}
          onRename={handleRename}
        />
      )}
    </>
  )
}

// ─── DraggableComponentRow ────────────────────────────────────────────────────
// Wraps ExplorerRow with a dnd-kit draggable so the component row can be
// dragged onto the canvas. Payload: { kind: 'visualComponentRef', componentId }.
// A DndContext ancestor (provided by the canvas layer) is required for the
// drag to activate — without it, the row still renders and clicks work normally.

interface DraggableComponentRowProps {
  component: VisualComponent
  active: boolean
  onOpen: () => void
  onContextMenu: (event: MouseEvent<HTMLButtonElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void
}

function DraggableComponentRow({
  component,
  active,
  onOpen,
  onContextMenu,
  onKeyDown,
}: DraggableComponentRowProps) {
  const { listeners, setNodeRef, isDragging } = useDraggable({
    id: `site-explorer-vc-${component.id}`,
    data: { kind: 'visualComponentRef', componentId: component.id },
  })

  return (
    <div
      ref={setNodeRef}
      data-testid="site-explorer-component-drag-handle"
      className={isDragging ? styles.draggingComponent : undefined}
      {...listeners}
    >
      <ExplorerRow
        icon={BracesIcon}
        label={component.name}
        meta={`${component.params.length} props`}
        active={active}
        ariaLabel={`Open component ${component.name}`}
        onClick={onOpen}
        onContextMenu={onContextMenu}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

interface ExplorerSectionProps {
  title: string
  count: number
  actionLabel: string
  actionIcon: IconComponent
  onAction?: () => void
  emptyLabel?: string
  children: ReactNode
}

function ExplorerSection({
  title,
  count,
  actionLabel,
  actionIcon,
  onAction,
  emptyLabel = 'None yet',
  children,
}: ExplorerSectionProps) {
  const ActionIcon = actionIcon
  return (
    <section className={styles.section} aria-labelledby={`site-section-${title.toLowerCase()}`}>
      <div className={styles.sectionHeader}>
        <h2 id={`site-section-${title.toLowerCase()}`} className={styles.sectionTitle}>
          {title}
        </h2>
        <span className={styles.sectionCount}>{count}</span>
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={actionLabel}
          tooltip={actionLabel}
          onClick={onAction}
        >
          <ActionIcon size={13} />
        </Button>
      </div>
      <div className={styles.rows}>
        {count === 0 ? (
          <EmptyState
            compact
            title={emptyLabel}
            className={styles.sectionEmpty}
          />
        ) : children}
      </div>
    </section>
  )
}

interface ExplorerRowProps {
  icon: IconComponent
  label: string
  meta?: string
  active?: boolean
  ariaLabel: string
  onClick: () => void
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void
}

function ExplorerRow({
  icon,
  label,
  meta,
  active = false,
  ariaLabel,
  onClick,
  onContextMenu,
  onKeyDown,
}: ExplorerRowProps) {
  const RowIcon = icon
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn(styles.row, active && styles.rowActive)}
      aria-label={ariaLabel}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
    >
      <RowIcon size={13} />
      <span className={styles.rowLabel}>{label}</span>
      {meta && <span className={styles.rowMeta}>{meta}</span>}
    </Button>
  )
}

function FileRows({
  files,
  icon,
  onOpen,
  onContextMenu,
  onKeyDown,
}: {
  files: SiteFile[]
  icon: IconComponent
  onOpen: (fileId: string) => void
  onContextMenu: (file: SiteFile, event: MouseEvent<HTMLButtonElement>) => void
  onKeyDown: (file: SiteFile, event: KeyboardEvent<HTMLButtonElement>) => void
}) {
  return files.map((file) => (
    <ExplorerRow
      key={file.id}
      icon={icon}
      label={fileName(file.path)}
      meta={file.path}
      ariaLabel={`Open ${fileName(file.path)}`}
      onClick={() => onOpen(file.id)}
      onContextMenu={(event) => onContextMenu(file, event)}
      onKeyDown={(event) => onKeyDown(file, event)}
    />
  ))
}
