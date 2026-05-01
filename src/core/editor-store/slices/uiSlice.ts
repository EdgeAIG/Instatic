import type { StateCreator } from 'zustand'
import type { EditorStore } from '../store'

export type FocusedPanel = 'canvas' | 'domTree' | 'properties' | null
export type LeftSidebarPanelId = 'site' | 'selectors' | 'media' | 'dependencies' | 'layers' | 'agent'
export type PropertiesPanelMode = 'docked' | 'floating'

export const SIDEBAR_MIN_WIDTH = 260
export const SIDEBAR_MAX_WIDTH = 520
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 320
export const PROPERTIES_PANEL_DEFAULT_WIDTH = 360

/**
 * Active document descriptor — tracks which canvas document is open.
 * 'page' → standard page canvas; 'visualComponent' → VC canvas mode (Task #438).
 * Architecture source: Contribution #631 §5 (single-active-doc pattern).
 */
export type ActiveDocument =
  | { kind: 'page'; pageId: string }
  | { kind: 'visualComponent'; vcId: string }

export interface PanelState {
  collapsed: boolean
  x: number
  y: number
  width: number
}

export interface MediaAssetPreview {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  publicPath: string
}

export interface UiSlice {
  // Panel visibility / layout
  domTreePanel: PanelState
  propertiesPanel: PanelState
  propertiesPanelMode: PropertiesPanelMode
  leftSidebarWidth: number
  focusedPanel: FocusedPanel

  // Modals
  settingsModalOpen: boolean
  settingsModalSection: string

  // Preview overlay — toggle from toolbar (Phase 7)
  previewOpen: boolean

  // Unsaved changes guard
  hasUnsavedChanges: boolean

  // Module insert picker
  insertPickerOpen: boolean
  insertPickerParentId: string | null

  // Site explorer — user-facing site concepts, not generated source files
  siteExplorerPanelOpen: boolean
  selectorsPanelOpen: boolean
  mediaExplorerPanelOpen: boolean
  dependenciesPanelOpen: boolean

  // CodeEditorPanel (Task #433) — whether the code editor floating panel is visible
  codeEditorPanelOpen: boolean

  // CodeEditor (Task #432) — ID of the file currently open in the code editor
  activeEditorFileId: string | null
  activeMediaAssetPreview: MediaAssetPreview | null

  // Actions
  setDomTreePanel: (state: Partial<PanelState>) => void
  setPropertiesPanel: (state: Partial<PanelState>) => void
  setPropertiesPanelMode: (mode: PropertiesPanelMode) => void
  setLeftSidebarWidth: (width: number) => void
  toggleDomTreePanel: () => void
  togglePropertiesPanel: () => void
  setFocusedPanel: (panel: FocusedPanel) => void
  cycleFocusedPanel: () => void

  openSettingsModal: (section?: string) => void
  closeSettingsModal: () => void

  openPreview: () => void
  closePreview: () => void

  setHasUnsavedChanges: (value: boolean) => void

  openInsertPicker: (parentId: string) => void
  closeInsertPicker: () => void

  setSiteExplorerPanelOpen: (open: boolean) => void
  setSelectorsPanelOpen: (open: boolean) => void
  setMediaExplorerPanelOpen: (open: boolean) => void
  setDependenciesPanelOpen: (open: boolean) => void
  setLeftSidebarPanel: (panel: LeftSidebarPanelId | null) => void
  toggleLeftSidebarPanel: (panel: LeftSidebarPanelId) => void

  /** Show / hide the CodeEditor floating panel. */
  setCodeEditorPanelOpen: (open: boolean) => void

  /** Open a SiteFile in the CodeEditor panel. Sets activeEditorFileId and auto-shows the panel. */
  openInEditor: (fileId: string) => void
  /** Open a CMS media asset in the same draggable CodeEditor preview panel. */
  openMediaAssetPreview: (asset: MediaAssetPreview) => void
  /** Clear activeEditorFileId and hide the panel (e.g. when the file is deleted or editor closed). */
  closeEditor: () => void

  /**
   * Active canvas document — set when switching between page canvas and VC canvas mode.
   * Null = no explicit canvas document selected (default page canvas applies).
   */
  activeDocument: ActiveDocument | null
  setActiveDocument: (doc: ActiveDocument | null) => void

  /** Class selected in the global Selectors panel. */
  selectedSelectorClassId: string | null
  setSelectedSelectorClassId: (classId: string | null) => void

  /**
   * Atomically open a page in the canvas and clear any active VC document.
   * Use this instead of calling setActivePage + setActiveDocument separately to
   * avoid intermediate states where activeDocument is still 'visualComponent'
   * while activePageId has already changed (SF-2 / CR #666 finding).
   */
  openPageInCanvas: (pageId: string) => void
}

const PANEL_FOCUS_ORDER: FocusedPanel[] = ['canvas', 'domTree', 'properties']

const DEFAULT_DOM_TREE_PANEL: PanelState = {
  collapsed: false,
  x: 0,
  y: 0,
  width: 280,
}

const DEFAULT_PROPERTIES_PANEL: PanelState = {
  collapsed: false,
  x: 0, // will be set to window.innerWidth - width on mount
  y: 0,
  width: PROPERTIES_PANEL_DEFAULT_WIDTH,
}

export function clampSidebarWidth(width: number) {
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)))
}

function getActiveLeftSidebarPanel(state: EditorStore): LeftSidebarPanelId | null {
  if (state.siteExplorerPanelOpen) return 'site'
  if (state.selectorsPanelOpen) return 'selectors'
  if (state.mediaExplorerPanelOpen) return 'media'
  if (state.dependenciesPanelOpen) return 'dependencies'
  if (!state.domTreePanel.collapsed) return 'layers'
  if (state.isAgentOpen) return 'agent'
  return null
}

export const createUiSlice: StateCreator<EditorStore, [], [], UiSlice> = (set, get) => ({
  domTreePanel: DEFAULT_DOM_TREE_PANEL,
  propertiesPanel: DEFAULT_PROPERTIES_PANEL,
  propertiesPanelMode: 'docked',
  leftSidebarWidth: LEFT_SIDEBAR_DEFAULT_WIDTH,
  focusedPanel: 'canvas',
  settingsModalOpen: false,
  settingsModalSection: 'pages',
  previewOpen: false,
  hasUnsavedChanges: false,
  insertPickerOpen: false,
  insertPickerParentId: null,
  siteExplorerPanelOpen: false,
  selectorsPanelOpen: false,
  mediaExplorerPanelOpen: false,
  dependenciesPanelOpen: false,
  codeEditorPanelOpen: false,
  activeEditorFileId: null,
  activeMediaAssetPreview: null,
  activeDocument: null,
  selectedSelectorClassId: null,

  setDomTreePanel: (partial) => {
    // Guard: skip the set() call entirely when every supplied field already
    // matches the current value.  A no-op spread like
    //   set((s) => ({ domTreePanel: { ...s.domTreePanel, ...partial } }))
    // still produces a new object reference, which triggers
    // useSyncExternalStore's tearing detection and schedules a synchronous
    // forceStoreRerender.  On initial mount DomPanel calls this from its
    // localStorage-restore effect — if the stored value equals the default,
    // the guard prevents the spurious mutation that was causing the
    // "Maximum update depth exceeded" crash.
    const current = get().domTreePanel
    const anyChanged = (Object.keys(partial) as (keyof PanelState)[]).some(
      (k) => !Object.is(current[k], partial[k]),
    )
    if (!anyChanged) return
    set((state) => ({ domTreePanel: { ...state.domTreePanel, ...partial } }))
  },

  setPropertiesPanel: (partial) => {
    // Same guard as setDomTreePanel — prevents a no-op mutation from
    // PropertiesPanel's localStorage-restore effect on initial mount.
    const current = get().propertiesPanel
    const anyChanged = (Object.keys(partial) as (keyof PanelState)[]).some(
      (k) => !Object.is(current[k], partial[k]),
    )
    if (!anyChanged) return
    set((state) => ({ propertiesPanel: { ...state.propertiesPanel, ...partial } }))
  },

  setPropertiesPanelMode: (mode) => {
    if (Object.is(get().propertiesPanelMode, mode)) return
    set({ propertiesPanelMode: mode })
  },

  setLeftSidebarWidth: (width) => {
    const nextWidth = clampSidebarWidth(width)
    if (Object.is(get().leftSidebarWidth, nextWidth)) return
    set({ leftSidebarWidth: nextWidth })
  },

  toggleDomTreePanel: () =>
    set((state) => ({
      domTreePanel: { ...state.domTreePanel, collapsed: !state.domTreePanel.collapsed },
    })),

  togglePropertiesPanel: () =>
    set((state) => ({
      propertiesPanel: {
        ...state.propertiesPanel,
        collapsed: state.propertiesPanel.collapsed
          ? !state.selectedNodeId
          : true,
      },
    })),

  setFocusedPanel: (panel) => set({ focusedPanel: panel }),

  cycleFocusedPanel: () => {
    const { focusedPanel } = get()
    const idx = PANEL_FOCUS_ORDER.indexOf(focusedPanel)
    const next = PANEL_FOCUS_ORDER[(idx + 1) % PANEL_FOCUS_ORDER.length]
    set({ focusedPanel: next })
  },

  openSettingsModal: (section = 'pages') =>
    set({ settingsModalOpen: true, settingsModalSection: section }),

  closeSettingsModal: () => set({ settingsModalOpen: false }),

  openPreview: () => set({ previewOpen: true }),
  closePreview: () => set({ previewOpen: false }),

  setHasUnsavedChanges: (value) => set({ hasUnsavedChanges: value }),

  openInsertPicker: (parentId) =>
    set({ insertPickerOpen: true, insertPickerParentId: parentId }),

  closeInsertPicker: () =>
    set({ insertPickerOpen: false, insertPickerParentId: null }),

  setSiteExplorerPanelOpen: (open) => set({ siteExplorerPanelOpen: open }),

  setSelectorsPanelOpen: (open) => set({ selectorsPanelOpen: open }),

  setMediaExplorerPanelOpen: (open) => set({ mediaExplorerPanelOpen: open }),

  setDependenciesPanelOpen: (open) => set({ dependenciesPanelOpen: open }),

  setLeftSidebarPanel: (panel) =>
    set((state) => ({
      siteExplorerPanelOpen: panel === 'site',
      selectorsPanelOpen: panel === 'selectors',
      mediaExplorerPanelOpen: panel === 'media',
      dependenciesPanelOpen: panel === 'dependencies',
      domTreePanel: {
        ...state.domTreePanel,
        collapsed: panel !== 'layers',
      },
      isAgentOpen: panel === 'agent',
    })),

  toggleLeftSidebarPanel: (panel) => {
    const activePanel = getActiveLeftSidebarPanel(get())
    get().setLeftSidebarPanel(activePanel === panel ? null : panel)
  },

  setCodeEditorPanelOpen: (open) => set({ codeEditorPanelOpen: open }),

  openInEditor: (fileId) =>
    // Auto-show the panel whenever a file is opened (avoids a two-click UX).
    set({ activeEditorFileId: fileId, activeMediaAssetPreview: null, codeEditorPanelOpen: true }),

  openMediaAssetPreview: (asset) =>
    set({ activeEditorFileId: null, activeMediaAssetPreview: asset, codeEditorPanelOpen: true }),

  closeEditor: () =>
    // Closing the editor hides the panel and clears the active file.
    set({ activeEditorFileId: null, activeMediaAssetPreview: null, codeEditorPanelOpen: false }),

  setActiveDocument: (doc) => set({ activeDocument: doc }),

  setSelectedSelectorClassId: (classId) => {
    if (Object.is(get().selectedSelectorClassId, classId)) return
    set({ selectedSelectorClassId: classId })
  },

  openPageInCanvas: (pageId) =>
    // Atomic: clear VC mode + switch to the target page in one store write.
    // Avoids an intermediate state where activeDocument is still 'visualComponent'
    // while activePageId has already changed (SF-2 / CR #666 finding).
    set({ activeDocument: null, activePageId: pageId }),
})
