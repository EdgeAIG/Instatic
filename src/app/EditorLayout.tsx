/**
 * EditorLayout — root layout for the editor route /editor/:projectId
 *
 * Editor Overlay Layout (Guideline #410 — motion-editor style):
 *   ┌─────────────────────────────── Toolbar ──────────────────────────────────┐  z-60
 *   │ [ProjectName] [Undo/Redo] [+ Add] ──── [Zoom] [Save] [Export] [⚙] [✦] │
 *   ├──────────────────────────── Canvas (full-bleed) ─────────────────────────┤
 *   │  [DOM Tree Panel ▓]     canvas          [Properties Panel ▓]            │
 *   │  position: absolute overlays (z-50)     [AI Panel ▓] (bottom-right)     │
 *   └──────────────────────────────────────────────────────────────────────────┘
 *
 * Five independent self-contained floating panels (Guideline #410):
 * - DomPanel (Layers) — top-left
 * - PropertiesPanel — top-right
 * - AgentPanel (AI) — bottom-right, independent visibility
 * - ProjectExplorerPanel — project concepts: pages, components, styles, assets, scripts
 * - CodeEditorPanel (Task #432) — center-stage, code editing
 *
 * J12: usePersistence handles load-from-IndexedDB on mount, preference-gated
 * 30s auto-save, toolbar Save, and Cmd+S immediate save.
 *
 * Agent Panel: Phase D AI assistant — self-contained floating panel (Guideline #410).
 * Authenticates via ambient Claude Code credentials through the local Bun server.
 * No env vars, no API keys, no endpoint configuration required (Constraint #385).
 */
import { useParams } from 'react-router-dom'
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
import styles from './EditorLayout.module.css'

export default function EditorLayout() {
  const { projectId } = useParams<{ projectId: string }>()
  const propertiesPanelMode = useEditorStore((s) => s.propertiesPanelMode)
  const rightSidebarExpanded = useEditorStore(selectRightSidebarExpanded)

  // J12 — wire IndexedDB persistence: load, auto-save, toolbar Save, Cmd+S
  const saveProject = usePersistence(projectId)
  useEditorLayoutPersistence()

  return (
    <div className={styles.shell}>
      {/* ── Top toolbar (z-60, Guideline #374) ───────────────────────────── */}
      <Toolbar onSave={saveProject} />

      {/* ── Canvas + floating overlay panels ──────────────────────────────── */}
      {/*
        position: relative makes this the containing block for absolutely
        positioned panels (Guideline #356 / Task #358 / Architect #504).
        flex is kept so CanvasRoot's flex:1 fills the full width.
      */}
      <div className={styles.editorBody}>
        <LeftSidebar />
        <div
          className={'relative ' + styles.canvasStage + (rightSidebarExpanded ? ` ${styles.canvasStageRightSidebarOpen}` : '')}
          data-right-sidebar-expanded={rightSidebarExpanded ? 'true' : 'false'}
        >
          {/* Canvas — fills the remaining space between sidebars */}
          <CanvasRoot />
          {/* Properties can be unpinned into the floating draggable overlay. */}
          {propertiesPanelMode === 'floating' && <PropertiesPanel variant="floating" />}
          {/* Task #432 — Code Editor Panel: center-stage overlay (Guideline #410, UX Spec #612) */}
          <CodeEditorPanel />
        </div>
        <RightSidebar />
      </div>

      {/* J10 — Settings Modal (portal-rendered, listens to store.settingsModalOpen) */}
      <SettingsModal />
    </div>
  )
}
