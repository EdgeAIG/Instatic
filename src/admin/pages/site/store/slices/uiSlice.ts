import type { EditorStore, EditorStoreSliceCreator } from '@site/store/types'
import { clearCanvasSelectionDraft } from './selectionSlice'

export type FocusedPanel = 'canvas' | 'domTree' | 'properties' | null
export type LeftSidebarPanelId =
  | 'site'
  | 'selectors'
  | 'colors'
  | 'typography'
  | 'spacing'
  | 'media'
  | 'dependencies'
  | 'layers'
  | 'agent'
export type PropertiesPanelMode = 'docked' | 'floating'

export const SIDEBAR_MIN_WIDTH = 300
export const SIDEBAR_MAX_WIDTH = 520
export const LEFT_SIDEBAR_DEFAULT_WIDTH = 320
const PROPERTIES_PANEL_DEFAULT_WIDTH = 360

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
  colorsPanelOpen: boolean
  typographyPanelOpen: boolean
  spacingPanelOpen: boolean
  mediaExplorerPanelOpen: boolean
  dependenciesPanelOpen: boolean

  /**
   * Plugin-registered editor panel currently open in the left sidebar, or
   * `null` when a built-in panel (or nothing) is active. Mutually exclusive
   * with the built-in `*PanelOpen` flags — the setters below clear the
   * other side automatically. The id is the full panel id registered by the
   * plugin (e.g. `acme.workflow.review`); the host looks it up in
   * `pluginRuntime.getPanel(id)` at render time.
   */
  activePluginPanelId: string | null

  // CodeEditorPanel (Task #433) — whether the code editor floating panel is visible
  codeEditorPanelOpen: boolean

  // CodeEditor (Task #432) — ID of the file currently open in the code editor
  activeEditorFileId: string | null

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
  setColorsPanelOpen: (open: boolean) => void
  setTypographyPanelOpen: (open: boolean) => void
  setSpacingPanelOpen: (open: boolean) => void
  setMediaExplorerPanelOpen: (open: boolean) => void
  setDependenciesPanelOpen: (open: boolean) => void
  setLeftSidebarPanel: (panel: LeftSidebarPanelId | null) => void
  toggleLeftSidebarPanel: (panel: LeftSidebarPanelId) => void

  /**
   * Open a plugin-registered panel by id. Clears all built-in panels (only
   * one panel can be active at a time). Pass `null` to close the active
   * plugin panel without opening anything else.
   */
  setActivePluginPanel: (panelId: string | null) => void
  /** Toggle a plugin panel — open if not active, close if active. */
  toggleActivePluginPanel: (panelId: string) => void

  /** Show / hide the CodeEditor floating panel. */
  setCodeEditorPanelOpen: (open: boolean) => void

  /** Open a SiteFile in the CodeEditor panel. Sets activeEditorFileId and auto-shows the panel. */
  openInEditor: (fileId: string) => void
  /** Clear activeEditorFileId and hide the panel (e.g. when the file is deleted or editor closed). */
  closeEditor: () => void

  /**
   * Active canvas document — set when switching between page canvas and VC canvas mode.
   * Null = no explicit canvas document selected (default page canvas applies).
   */
  activeDocument: ActiveDocument | null
  setActiveDocument: (doc: ActiveDocument | null) => void

  /**
   * Exit VC canvas mode and return to the previously active page.
   *
   * - Sets activeDocument = null.
   * - If previousActivePageId is set and its page still exists in the site,
   *   restores activePageId to that page; otherwise leaves activePageId as-is.
   * - Clears selectedNodeId and previousActivePageId.
   */
  exitVisualComponentMode: () => void

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

  /**
   * Whether the Data workspace's left sidebar panel is collapsed (hidden).
   * Mirrors the `propertiesPanel.collapsed` naming convention. When true,
   * the panel slot shrinks to zero-width but the rail indicator remains.
   */
  dataSidebarCollapsed: boolean
  setDataSidebarCollapsed: (collapsed: boolean) => void

  /**
   * Node currently being edited inline on the canvas, or `null`.
   *
   * Set by the canvas double-click handler when the user opens inline edit
   * mode for a text-like module (base.text, base.button, …). Each module's
   * editor component checks `props.isInlineEditing` and renders its
   * primary content prop as `contentEditable` when true.
   *
   * Cleared on blur / Escape / canvas-deselect / page switch.
   */
  inlineEditingNodeId: string | null
  /** Open / close inline edit on a node. Pass `null` to exit edit mode. */
  setInlineEditing: (nodeId: string | null) => void
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
  // A plugin panel takes precedence over every built-in panel — the
  // built-in `*PanelOpen` flags are forced to false whenever a plugin
  // panel is opened, but `domTreePanel.collapsed` defaults to false so
  // we have to short-circuit here too.
  if (state.activePluginPanelId !== null) return null
  if (state.siteExplorerPanelOpen) return 'site'
  if (state.selectorsPanelOpen) return 'selectors'
  if (state.colorsPanelOpen) return 'colors'
  if (state.typographyPanelOpen) return 'typography'
  if (state.spacingPanelOpen) return 'spacing'
  if (state.mediaExplorerPanelOpen) return 'media'
  if (state.dependenciesPanelOpen) return 'dependencies'
  if (!state.domTreePanel.collapsed) return 'layers'
  if (state.isAgentOpen) return 'agent'
  return null
}

// Contribute this slice's fields to the combined `EditorStore` type via TS
// module augmentation. See `../types.ts` for why we use this pattern.
declare module '@site/store/types' {
  interface EditorStore extends UiSlice {}
}

export const createUiSlice: EditorStoreSliceCreator<UiSlice> = (set, get) => ({
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
  colorsPanelOpen: false,
  typographyPanelOpen: false,
  spacingPanelOpen: false,
  mediaExplorerPanelOpen: false,
  dependenciesPanelOpen: false,
  activePluginPanelId: null,
  codeEditorPanelOpen: false,
  activeEditorFileId: null,
  activeDocument: null,
  selectedSelectorClassId: null,
  dataSidebarCollapsed: false,
  inlineEditingNodeId: null,

  setInlineEditing: (nodeId) => {
    if (Object.is(get().inlineEditingNodeId, nodeId)) return
    set({ inlineEditingNodeId: nodeId })
  },

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

  setColorsPanelOpen: (open) => set({ colorsPanelOpen: open }),

  setTypographyPanelOpen: (open) => set({ typographyPanelOpen: open }),

  setSpacingPanelOpen: (open) => set({ spacingPanelOpen: open }),

  setMediaExplorerPanelOpen: (open) => set({ mediaExplorerPanelOpen: open }),

  setDependenciesPanelOpen: (open) => set({ dependenciesPanelOpen: open }),

  setLeftSidebarPanel: (panel) =>
    set((state) => ({
      siteExplorerPanelOpen: panel === 'site',
      selectorsPanelOpen: panel === 'selectors',
      colorsPanelOpen: panel === 'colors',
      typographyPanelOpen: panel === 'typography',
      spacingPanelOpen: panel === 'spacing',
      mediaExplorerPanelOpen: panel === 'media',
      dependenciesPanelOpen: panel === 'dependencies',
      domTreePanel: {
        ...state.domTreePanel,
        collapsed: panel !== 'layers',
      },
      isAgentOpen: panel === 'agent',
      // Built-in panels are mutually exclusive with plugin panels.
      activePluginPanelId: null,
    })),

  toggleLeftSidebarPanel: (panel) => {
    // Account for the plugin-panel-takes-precedence rule in
    // getActiveLeftSidebarPanel: if a plugin panel is currently active
    // and the user clicks a built-in rail item, that should open the
    // built-in panel (not toggle it closed because it "wasn't active").
    const state = get()
    const activePanel = state.activePluginPanelId === null
      ? getActiveLeftSidebarPanel(state)
      : null
    get().setLeftSidebarPanel(activePanel === panel ? null : panel)
  },

  setActivePluginPanel: (panelId) =>
    set((state) => ({
      siteExplorerPanelOpen: false,
      selectorsPanelOpen: false,
      colorsPanelOpen: false,
      typographyPanelOpen: false,
      spacingPanelOpen: false,
      mediaExplorerPanelOpen: false,
      dependenciesPanelOpen: false,
      domTreePanel: {
        ...state.domTreePanel,
        collapsed: true,
      },
      isAgentOpen: false,
      activePluginPanelId: panelId,
    })),

  toggleActivePluginPanel: (panelId) => {
    const current = get().activePluginPanelId
    get().setActivePluginPanel(current === panelId ? null : panelId)
  },

  setCodeEditorPanelOpen: (open) => set({ codeEditorPanelOpen: open }),

  openInEditor: (fileId) =>
    // Auto-show the panel whenever a file is opened (avoids a two-click UX).
    set({ activeEditorFileId: fileId, codeEditorPanelOpen: true }),

  closeEditor: () =>
    // Closing the editor hides the panel and clears the active file.
    set({ activeEditorFileId: null, codeEditorPanelOpen: false }),

  setActiveDocument: (doc) =>
    set((state) => {
        const prevDoc = state.activeDocument
        state.activeDocument = doc

        if (doc?.kind === 'visualComponent') {
          // Entering VC mode: capture the page we came from IF the previous
          // activeDocument was null (the default page canvas). Coming from an
          // explicit page doc or another VC → leave previousActivePageId as-is.
          if (prevDoc === null && state.activePageId !== null) {
            state.previousActivePageId = state.activePageId
          }
        } else {
          // Leaving VC mode (setting to null or a page doc) → clear the captured id.
          state.previousActivePageId = null
        }

        // Drop stale selection / hover whenever the active document actually
        // changes. The DOM panel resets to "nothing selected" on a doc switch
        // anyway, and a node ID from the previous document either no longer
        // resolves in the new canvas or — worse — accidentally collides with
        // an unrelated node ID, which makes the selection overlay land in the
        // wrong place. Clearing here is the single source of truth so every
        // entry point (page → VC, VC → page, VC → other VC, doc → null) gets
        // it right.
        if (!isSameActiveDocument(prevDoc, doc)) {
          clearCanvasSelectionDraft(state)
        }
      }),

  exitVisualComponentMode: () =>
    set((state) => {
        const prevPageId = state.previousActivePageId
        state.activeDocument = null
        // Restore the page we came from if it still exists in the site.
        if (prevPageId !== null && state.site?.pages.some((p) => p.id === prevPageId)) {
          state.activePageId = prevPageId
        }
        clearCanvasSelectionDraft(state)
        state.previousActivePageId = null
      }),

  setSelectedSelectorClassId: (classId) => {
    if (Object.is(get().selectedSelectorClassId, classId)) return
    set({ selectedSelectorClassId: classId })
  },

  setDataSidebarCollapsed: (collapsed) => set({ dataSidebarCollapsed: collapsed }),

  openPageInCanvas: (pageId) =>
    // Atomic: clear VC mode + switch to the target page in one store write.
    // Avoids an intermediate state where activeDocument is still 'visualComponent'
    // while activePageId has already changed (SF-2 / CR #666 finding).
    //
    // Also drops stale selection / hover when the target page differs from the
    // currently active page. Same rationale as setActiveDocument: a node ID
    // from the previous document either won't resolve in the new canvas or
    // could collide with an unrelated node ID and put the selection overlay
    // in the wrong place.
    set((state) => {
      const docChanged = state.activeDocument !== null
      const pageChanged = state.activePageId !== pageId

      state.activeDocument = null
      state.activePageId = pageId
      state.previousActivePageId = null

      if (docChanged || pageChanged) {
        clearCanvasSelectionDraft(state)
      }
    }),
})

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/**
 * Compare two ActiveDocument descriptors structurally. Reference equality is
 * not enough — UI call sites typically construct fresh `{ kind, ... }` objects
 * each time, so two semantically-equal documents are usually distinct
 * references. Used by setActiveDocument to decide whether selection / hover
 * needs to be cleared.
 */
function isSameActiveDocument(
  a: ActiveDocument | null,
  b: ActiveDocument | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'page' && b.kind === 'page') return a.pageId === b.pageId
  if (a.kind === 'visualComponent' && b.kind === 'visualComponent') return a.vcId === b.vcId
  return false
}
