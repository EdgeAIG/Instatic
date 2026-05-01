/**
 * EditorLayout — root layout for the self-hosted CMS editor.
 *
 * Editor Overlay Layout (Guideline #410 — motion-editor style):
 *   ┌─────────────────────────────── Toolbar ──────────────────────────────────┐  z-60
 *   │ [SiteName] [Undo/Redo] [+ Add] ─────── [Zoom] [Save] [Publish] [⚙] [✦] │
 *   ├──────────────────────────── Canvas (full-bleed) ─────────────────────────┤
 *   │  [DOM Tree Panel ▓]     canvas          [Properties Panel ▓]            │
 *   │  position: absolute overlays (z-50)     [AI Panel ▓] (bottom-right)     │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * Five independent self-contained floating panels (Guideline #410):
 * - DomPanel (Layers) — top-left
 * - PropertiesPanel — top-right
 * - AgentPanel (AI) — bottom-right, independent visibility
 * - Site explorer panel — site concepts: pages, components, styles, scripts
 * - CodeEditorPanel (Task #432) — center-stage, code editing
 *
 * J12: usePersistence handles CMS draft load on mount, preference-gated
 * 30s auto-save, toolbar Save, and Cmd+S immediate save.
 *
 * Agent Panel: Phase D AI assistant — self-contained floating panel (Guideline #410).
 * Authenticates via ambient Claude Code credentials through the local Bun server.
 * No env vars, no API keys, no endpoint configuration required (Constraint #385).
 */
import { CanvasRoot } from '@editor/components/Canvas'
import { PropertiesPanel } from '@editor/components/PropertiesPanel'
import { CodeEditorPanel } from '@editor/components/CodeEditor'
import { Toolbar } from '@editor/components/Toolbar'
import { LeftSidebar } from '@editor/components/LeftSidebar'
import { RightSidebar } from '@editor/components/RightSidebar'
import { SettingsModal } from '@editor/components/Settings'
import { usePersistence } from '@editor/hooks/usePersistence'
import { useEditorLayoutPersistence } from '@editor/hooks/useEditorLayoutPersistence'
import { selectRightSidebarExpanded, useEditorStore } from '@core/editor-store/store'
import { cmsAdapter } from '@core/persistence'
import { listCmsPlugins } from '@core/persistence/cmsPlugins'
import type { PluginAdminPageRoute } from '@core/plugin-sdk'
import { cn } from '@ui/cn'
import { useInstalledEditorPlugins } from '../plugins/useInstalledEditorPlugins'
import { CMS_PLUGINS_CHANGED_EVENT } from '../plugins/pluginEvents'
import { AppLoadingScreen } from './AppLoadingScreen'
import styles from './EditorLayout.module.css'
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Link, useInRouterContext, useLocation, useNavigate } from 'react-router-dom'
import toolbarStyles from '@editor/components/Toolbar/Toolbar.module.css'

export type AdminWorkspace = 'site' | 'content' | 'plugins' | 'pluginPage'

interface EditorLayoutProps {
  workspace?: AdminWorkspace
  contentSidebar?: ReactNode
  contentLeftPanel?: ReactNode
  contentCanvas?: ReactNode
  contentRightPanel?: ReactNode
  toolbarRightSlot?: ReactNode
}

export default function EditorLayout({
  workspace = 'site',
  contentSidebar,
  contentLeftPanel,
  contentCanvas,
  contentRightPanel,
  toolbarRightSlot,
}: EditorLayoutProps) {
  const site = useEditorStore((s) => s.site)
  const propertiesPanelMode = useEditorStore((s) => s.propertiesPanelMode)
  const rightSidebarExpanded = useEditorStore(selectRightSidebarExpanded)
  const contentRightSidebarExpanded = workspace === 'content' && Boolean(contentRightPanel)
  const hasRightSidebar = contentRightSidebarExpanded || (workspace === 'site' && rightSidebarExpanded)

  // J12 — wire persistence: load, auto-save, toolbar Save, Cmd+S.
  const persistence = usePersistence('default', cmsAdapter, { markNewSiteUnsaved: true })
  useEditorLayoutPersistence()
  useInstalledEditorPlugins()

  if (!site) {
    if (persistence.saveStatus.state === 'error') {
      return (
        <main className={styles.bootstrapError} role="alert">
          <h1>Could not load CMS site</h1>
          <p>{persistence.saveStatus.message ?? 'Reload the admin page and try again.'}</p>
        </main>
      )
    }

    return <AppLoadingScreen />
  }

  return (
    <div className={styles.shell}>
      {/* ── Top toolbar (z-60, Guideline #374) ───────────────────────────── */}
      <Toolbar
        onSave={persistence.saveSite}
        saveStatus={persistence.saveStatus}
        publishEnabled={workspace === 'site'}
        section={workspace}
        adminNavigationSlot={(
          <AdminSectionNavigation
            section={workspace}
          />
        )}
        rightSlot={toolbarRightSlot}
      />

      {/* ── Canvas + floating overlay panels ──────────────────────────────── */}
      {/*
        position: relative makes this the containing block for absolutely
        positioned panels (Guideline #356 / Task #358 / Architect #504).
        flex is kept so CanvasRoot's flex:1 fills the full width.
      */}
      <div className={styles.editorBody}>
        {workspace === 'site' ? (
          <LeftSidebar workspace={workspace} contentPanel={contentLeftPanel} />
        ) : (
          contentSidebar ?? null
        )}
        <div
          className={cn(styles.canvasStage, hasRightSidebar && styles.canvasStageRightSidebarOpen)}
          data-right-sidebar-expanded={hasRightSidebar ? 'true' : 'false'}
        >
          <div className={styles.canvasContent} key={workspace}>
            {workspace === 'site' ? (
              <>
                {/* Canvas — fills the remaining space between sidebars */}
                <CanvasRoot />
                {/* Properties can be unpinned into the floating draggable overlay. */}
                {propertiesPanelMode === 'floating' && <PropertiesPanel variant="floating" />}
              </>
            ) : (
              contentCanvas
            )}
          </div>
        </div>
        <RightSidebar
          contentPanel={workspace === 'content' ? contentRightPanel : undefined}
          suppressDefaultPanel={workspace !== 'site'}
        />
      </div>

      {/* Code editor/media preview: viewport overlay, not constrained by the canvas stage. */}
      <CodeEditorPanel />

      {/* J10 — Settings Modal (portal-rendered, listens to store.settingsModalOpen) */}
      <SettingsModal />
    </div>
  )
}

interface AdminSectionNavigationProps {
  section: AdminWorkspace
  onWorkspaceNavigateStart?: () => void
}

export function AdminSectionNavigation({
  section,
  onWorkspaceNavigateStart,
}: AdminSectionNavigationProps) {
  const [pluginPages, setPluginPages] = useState<PluginAdminPageRoute[]>([])

  useEffect(() => {
    let cancelled = false

    async function loadPluginPages() {
      try {
        const payload = await listCmsPlugins()
        if (!cancelled) {
          setPluginPages((current) => {
            const next = payload.adminPages
            const unchanged =
              current.length === next.length &&
              current.every((page, index) => page.route === next[index]?.route)
            return unchanged ? current : next
          })
        }
      } catch {
        // Navigation remains usable when plugins cannot be loaded.
      }
    }

    function refreshPluginPages() {
      void loadPluginPages()
    }

    refreshPluginPages()
    window.addEventListener(CMS_PLUGINS_CHANGED_EVENT, refreshPluginPages)
    return () => {
      cancelled = true
      window.removeEventListener(CMS_PLUGINS_CHANGED_EVENT, refreshPluginPages)
    }
  }, [])

  return (
    <>
      {section === 'site' ? (
        <span className={toolbarStyles.activeSection}>Site</span>
      ) : (
        <AdminRouteLink to="/admin/site" onNavigateStart={onWorkspaceNavigateStart}>Site</AdminRouteLink>
      )}
      {section === 'content' ? (
        <span className={toolbarStyles.activeSection}>Content</span>
      ) : (
        <AdminRouteLink to="/admin/content" onNavigateStart={onWorkspaceNavigateStart}>Content</AdminRouteLink>
      )}
      {section === 'plugins' ? (
        <span className={toolbarStyles.activeSection}>Plugins</span>
      ) : (
        <AdminRouteLink to="/admin/plugins" onNavigateStart={onWorkspaceNavigateStart}>Plugins</AdminRouteLink>
      )}
      {pluginPages.map((page) => (
        <AdminRouteLink
          key={`${page.pluginId}:${page.id}`}
          to={page.route}
          onNavigateStart={onWorkspaceNavigateStart}
        >
          {page.navLabel ?? page.title}
        </AdminRouteLink>
      ))}
    </>
  )
}

function AdminRouteLink({
  to,
  children,
  onNavigateStart,
}: {
  to: string
  children: ReactNode
  onNavigateStart?: () => void
}) {
  const inRouter = useInRouterContext()

  if (inRouter) {
    return (
      <RouterAdminRouteLink to={to} onNavigateStart={onNavigateStart}>
        {children}
      </RouterAdminRouteLink>
    )
  }

  return (
    <a className={toolbarStyles.adminLink} href={to}>
      {children}
    </a>
  )
}

function RouterAdminRouteLink({
  to,
  children,
  onNavigateStart,
}: {
  to: string
  children: ReactNode
  onNavigateStart?: () => void
}) {
  const navigate = useNavigate()
  const location = useLocation()

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.altKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.currentTarget.target
    ) {
      return
    }

    if (location.pathname === to) return

    event.preventDefault()
    onNavigateStart?.()

    const startViewTransition = document.startViewTransition
    if (typeof startViewTransition !== 'function') {
      void navigate(to)
      return
    }

    startViewTransition.call(document, () => {
      flushSync(() => {
        void navigate(to)
      })
    })
  }

  return (
    <Link className={toolbarStyles.adminLink} to={to} onClick={handleClick}>
      {children}
    </Link>
  )
}
