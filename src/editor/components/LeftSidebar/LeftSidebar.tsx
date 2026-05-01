import { useRef, type CSSProperties, type ReactNode } from 'react'
import { useEditorStore } from '@core/editor-store/store'
import type { LeftSidebarPanelId } from '@core/editor-store/slices/uiSlice'
import { AgentPanel } from '../AgentPanel'
import { DependenciesPanel } from '../DependenciesPanel'
import { DomPanel } from '../DomPanel'
import { MediaExplorerPanel } from '../MediaExplorerPanel'
import { PanelRail } from '../PanelRail'
import { SelectorsPanel } from '../SelectorsPanel'
import { SiteExplorerPanel } from '../SiteExplorerPanel'
import { SidebarResizeHandle } from '../shared/SidebarResizeHandle'
import styles from './LeftSidebar.module.css'

function selectActiveLeftSidebarPanel(state: ReturnType<typeof useEditorStore.getState>): LeftSidebarPanelId | null {
  if (state.siteExplorerPanelOpen) return 'site'
  if (state.selectorsPanelOpen) return 'selectors'
  if (state.mediaExplorerPanelOpen) return 'media'
  if (state.dependenciesPanelOpen) return 'dependencies'
  if (!state.domTreePanel.collapsed) return 'layers'
  if (state.isAgentOpen) return 'agent'
  return null
}

interface LeftSidebarProps {
  workspace?: 'site' | 'content'
  contentPanel?: ReactNode
}

export function LeftSidebar({ workspace = 'site', contentPanel }: LeftSidebarProps) {
  const sidebarRef = useRef<HTMLElement | null>(null)
  const activePanel = useEditorStore(selectActiveLeftSidebarPanel)
  const leftSidebarWidth = useEditorStore((s) => s.leftSidebarWidth)
  const setLeftSidebarWidth = useEditorStore((s) => s.setLeftSidebarWidth)
  const panelWidth = activePanel ? leftSidebarWidth : 0

  const style = {
    '--left-sidebar-panel-width': `${panelWidth}px`,
  } as CSSProperties

  return (
    <aside
      ref={sidebarRef}
      className={styles.sidebar}
      data-testid="left-sidebar"
      data-expanded={activePanel ? 'true' : 'false'}
      data-active-panel={activePanel ?? 'none'}
      style={style}
    >
      <PanelRail workspace={workspace} />

      <div
        className={styles.panelSlot}
        data-testid="left-sidebar-panel-slot"
        aria-hidden={activePanel ? undefined : 'true'}
      >
        <div className={styles.panelMount} hidden={activePanel !== 'layers'}>
          <DomPanel variant="docked" />
        </div>
        <div className={styles.panelMount} hidden={activePanel !== 'site'}>
          {workspace === 'content' ? contentPanel : <SiteExplorerPanel variant="docked" />}
        </div>
        <div className={styles.panelMount} hidden={activePanel !== 'selectors'}>
          <SelectorsPanel variant="docked" />
        </div>
        <div className={styles.panelMount} hidden={activePanel !== 'media'}>
          <MediaExplorerPanel variant="docked" />
        </div>
        <div className={styles.panelMount} hidden={activePanel !== 'dependencies'}>
          <DependenciesPanel variant="docked" />
        </div>
        <div className={styles.panelMount} hidden={activePanel !== 'agent'}>
          <AgentPanel variant="docked" />
        </div>
      </div>

      {activePanel && (
        <SidebarResizeHandle
          side="left"
          width={leftSidebarWidth}
          targetRef={sidebarRef}
          cssVariable="--left-sidebar-panel-width"
          ariaLabel="Resize left sidebar"
          onResize={setLeftSidebarWidth}
        />
      )}
    </aside>
  )
}
