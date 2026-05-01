import { produce } from 'immer'
import { nanoid } from 'nanoid'
import type { StateCreator } from 'zustand'
import type { EditorStore } from '../store'
import { renderCache } from '../../engine/renderCache'
import { registry } from '../../module-engine/registry'
import {
  type SiteDocument,
  type Page,
  type PageNode,
  type Breakpoint,
  type SiteSettings,
  type PageTemplateConfig,
  type DynamicPropBinding,
  DEFAULT_BREAKPOINTS,
  DEFAULT_SITE_SETTINGS,
  createNode,
  addPage,
  deletePage,
  renamePage,
  reorderPages,
  insertNode,
  deleteNode,
  updateNodeProps,
  setBreakpointOverride,
  clearBreakpointOverride,
  renameNode,
  toggleNodeLocked,
  toggleNodeHidden,
  moveNode,
  duplicateNode,
  wrapNode,
} from '../../page-tree'
import {
  clonePackageJson,
  DEFAULT_SITE_PACKAGE_JSON,
} from '../../site-dependencies/manifest'

/** Maximum undo history depth — prevents unbounded memory growth */
const MAX_HISTORY = 50

export interface SiteSlice {
  site: SiteDocument | null

  // SiteDocument lifecycle
  createSite: (name: string) => SiteDocument
  loadSite: (site: SiteDocument) => void
  clearSite: () => void
  updateSiteName: (name: string) => void

  // Page mutations
  addPage: (title: string, slug?: string) => Page
  deletePage: (pageId: string) => void
  renamePage: (pageId: string, title: string, slug?: string) => void
  reorderPages: (fromIndex: number, toIndex: number) => void
  convertPageToTemplate: (pageId: string, config: PageTemplateConfig) => void
  convertTemplateToPage: (pageId: string) => void

  // Node mutations (operate on the active page)
  insertNode: (moduleId: string, defaults: Record<string, unknown>, parentId: string, index?: number) => string
  deleteNode: (nodeId: string) => void
  updateNodeProps: (nodeId: string, patch: Record<string, unknown>) => void
  setBreakpointOverride: (nodeId: string, breakpointId: string, patch: Record<string, unknown>) => void
  clearBreakpointOverride: (nodeId: string, breakpointId: string) => void
  renameNode: (nodeId: string, label: string) => void
  toggleNodeLocked: (nodeId: string) => void
  toggleNodeHidden: (nodeId: string) => void
  moveNode: (nodeId: string, newParentId: string, newIndex: number) => void
  duplicateNode: (nodeId: string) => string
  wrapNode: (nodeId: string, containerModuleId: string, defaults?: Record<string, unknown>) => string
  setNodeDynamicBinding: (nodeId: string, propKey: string, binding: DynamicPropBinding) => void
  clearNodeDynamicBinding: (nodeId: string, propKey: string) => void

  // Breakpoint mutations
  addBreakpoint: (bp: Omit<Breakpoint, 'id'>) => Breakpoint
  updateBreakpoint: (id: string, patch: Partial<Omit<Breakpoint, 'id'>>) => void
  removeBreakpoint: (id: string) => void
  reorderBreakpoints: (fromIndex: number, toIndex: number) => void

  // SiteDocument settings mutations
  updateSiteSettings: (patch: Partial<SiteSettings>) => void

  // ─── Undo / Redo ──────────────────────────────────────────────────────────
  /** Snapshots of previous site states — most recent last */
  _historyPast: SiteDocument[]
  /** Snapshots popped by undo, available for redo — most recent last */
  _historyFuture: SiteDocument[]
  /** True if there's at least one state to undo to */
  canUndo: boolean
  /** True if there's at least one state to redo to */
  canRedo: boolean
  undo: () => void
  redo: () => void
  /**
   * Call before any undoable mutation to snapshot the current site.
   * Exposed so external code (e.g., batch operations) can manage history.
   */
  pushHistory: () => void
}

function createDefaultSiteDocument(name: string): SiteDocument {
  const rootNode = createNode('base.root')
  const homePage: Page = {
    id: nanoid(),
    title: 'Home',
    slug: 'index',
    rootNodeId: rootNode.id,
    nodes: { [rootNode.id]: rootNode },
  }
  return {
    id: nanoid(),
    name,
    pages: [homePage],
    files: [],             // Contribution #595 — files data layer
    visualComponents: [],  // Contribution #619 — visual components data layer
    packageJson: clonePackageJson(DEFAULT_SITE_PACKAGE_JSON),
    breakpoints: DEFAULT_BREAKPOINTS,
    settings: DEFAULT_SITE_SETTINGS,
    classes: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

function migrateLegacyTextModules(site: SiteDocument): SiteDocument {
  const migrated = structuredClone(site)

  for (const page of migrated.pages) {
    for (const node of Object.values(page.nodes)) {
      migrateLegacyTextNode(node)
    }
  }

  for (const component of migrated.visualComponents ?? []) {
    migrateLegacyTextNode(component.rootNode)
  }

  return migrated
}

function migrateLegacyTextNode(node: { moduleId: string; props: Record<string, unknown>; childNodes?: unknown[] }) {
  if (node.moduleId === 'base.heading') {
    node.moduleId = 'base.text'
    node.props = {
      text: typeof node.props.text === 'string' ? node.props.text : 'Your Heading Here',
      tag: legacyHeadingTag(node.props.level),
    }
  } else if (node.moduleId === 'base.paragraph') {
    node.moduleId = 'base.text'
    node.props = {
      text: typeof node.props.text === 'string' ? node.props.text : 'Add your text here.',
      tag: 'p',
    }
  }

  for (const child of node.childNodes ?? []) {
    migrateLegacyTextNode(child as { moduleId: string; props: Record<string, unknown>; childNodes?: unknown[] })
  }
}

function legacyHeadingTag(level: unknown): string {
  if (typeof level === 'number' && level >= 1 && level <= 6) return `h${level}`
  const tag = String(level || 'h2').toLowerCase()
  return /^h[1-6]$/.test(tag) ? tag : 'h2'
}

function clearDynamicBindingsFromNode(node: PageNode): void {
  delete node.dynamicBindings
  for (const child of node.childNodes ?? []) {
    clearDynamicBindingsFromNode(child)
  }
}

export const createSiteSlice: StateCreator<EditorStore, [], [], SiteSlice> = (set, get) => {
  // ---------------------------------------------------------------------------
  // Internal helpers — note: these use `get()` before calling set() so they
  // can snapshot the current site for history.
  // ---------------------------------------------------------------------------

  /** Snapshot current site into undo history, then clear redo stack. */
  function pushHistory(): void {
    const { site } = get()
    if (!site) return
    set(
      produce((state: EditorStore) => {
        const snapshot = structuredClone(site)
        state._historyPast.push(snapshot)
        if (state._historyPast.length > MAX_HISTORY) {
          state._historyPast.shift() // evict oldest
        }
        state._historyFuture = []
        state.canUndo = true
        state.canRedo = false
      })
    )
  }

  /** Mutate the active page — auto-snapshots history first. */
  function mutatePage(fn: (page: Page) => void): void {
    pushHistory()
    set(
      produce((state: EditorStore) => {
        if (!state.site) return
        const page = state.site.pages.find((p) => p.id === state.activePageId)
        if (!page) return
        fn(page)
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
    )
  }

  /** Mutate the site — auto-snapshots history first. */
  function mutateSite(fn: (site: SiteDocument) => void): void {
    pushHistory()
    set(
      produce((state: EditorStore) => {
        if (!state.site) return
        fn(state.site)
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
    )
  }

  return {
    site: null,

    // ─── Undo / Redo ─────────────────────────────────────────────────────────
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,

    pushHistory,

    undo: () => {
      const { _historyPast, site } = get()
      if (_historyPast.length === 0 || !site) return
      const previous = _historyPast[_historyPast.length - 1]
      set(
        produce((state: EditorStore) => {
          state._historyPast.pop()
          state._historyFuture.push(structuredClone(site))
          state.site = previous
          state.canUndo = state._historyPast.length > 0
          state.canRedo = true
          state.hasUnsavedChanges = true
          // Keep activePageId valid
          if (!state.site.pages.find((p) => p.id === state.activePageId)) {
            state.activePageId = state.site.pages[0]?.id ?? null
          }
        })
      )
    },

    redo: () => {
      const { _historyFuture, site } = get()
      if (_historyFuture.length === 0 || !site) return
      const next = _historyFuture[_historyFuture.length - 1]
      set(
        produce((state: EditorStore) => {
          state._historyFuture.pop()
          state._historyPast.push(structuredClone(site))
          state.site = next
          state.canUndo = true
          state.canRedo = state._historyFuture.length > 0
          state.hasUnsavedChanges = true
          // Keep activePageId valid
          if (!state.site.pages.find((p) => p.id === state.activePageId)) {
            state.activePageId = state.site.pages[0]?.id ?? null
          }
        })
      )
    },

    // ─── SiteDocument lifecycle ────────────────────────────────────────────────────
    createSite: (name) => {
      const site = createDefaultSiteDocument(name)
      set({
        site,
        packageJson: clonePackageJson(site.packageJson),
        activePageId: site.pages[0].id,
        _historyPast: [],
        _historyFuture: [],
        canUndo: false,
        canRedo: false,
        hasUnsavedChanges: false,
      })
      return site
    },

    loadSite: (site) => {
      // Clear the render cache BEFORE store hydration so stale HTML from a previous
      // site cannot bleed into the canvas after switching projects.
      // (Guideline #307 / Architect message #1216 — critical integration note)
      renderCache.clear()
      const migratedSite = migrateLegacyTextModules(site)
      const packageJson = clonePackageJson(migratedSite.packageJson)
      set({
        site: { ...migratedSite, packageJson },
        packageJson,
        activePageId: migratedSite.pages[0]?.id ?? null,
        _historyPast: [],
        _historyFuture: [],
        canUndo: false,
        canRedo: false,
        hasUnsavedChanges: false,
      })
    },

    clearSite: () => {
      set({
        site: null,
        packageJson: clonePackageJson(DEFAULT_SITE_PACKAGE_JSON),
        activePageId: null,
        selectedNodeId: null,
        _historyPast: [],
        _historyFuture: [],
        canUndo: false,
        canRedo: false,
      })
    },

    updateSiteName: (name) => {
      mutateSite((p) => { p.name = name })
    },

    // ─── Page mutations ───────────────────────────────────────────────────────
    addPage: (title, slug) => {
      let newPage!: Page
      mutateSite((p) => {
        newPage = addPage(p, title, slug ?? title)
      })
      set({ activePageId: newPage.id })
      return newPage
    },

    deletePage: (pageId) => {
      mutateSite((p) => deletePage(p, pageId))
      const { site, activePageId } = get()
      if (activePageId === pageId && site) {
        set({ activePageId: site.pages[0]?.id ?? null })
      }
    },

    renamePage: (pageId, title, slug) => {
      mutateSite((p) => renamePage(p, pageId, title, slug))
    },

    reorderPages: (fromIndex, toIndex) => {
      mutateSite((p) => reorderPages(p, fromIndex, toIndex))
    },

    convertPageToTemplate: (pageId, config) => {
      mutateSite((site) => {
        const page = site.pages.find((candidate) => candidate.id === pageId)
        if (!page) return
        page.template = config
      })
    },

    convertTemplateToPage: (pageId) => {
      mutateSite((site) => {
        const page = site.pages.find((candidate) => candidate.id === pageId)
        if (!page) return
        delete page.template
        for (const node of Object.values(page.nodes)) {
          clearDynamicBindingsFromNode(node)
        }
      })
    },

    // ─── Node mutations ───────────────────────────────────────────────────────
    insertNode: (moduleId, defaults, parentId, index) => {
      const mod = registry.get(moduleId)
      const resolvedDefaults = { ...(mod?.defaults ?? {}), ...defaults }
      const newNode = createNode(moduleId, resolvedDefaults)
      mutatePage((page) => insertNode(page, newNode, parentId, index))
      return newNode.id
    },

    deleteNode: (nodeId) => {
      mutatePage((page) => deleteNode(page, nodeId))
      if (get().selectedNodeId === nodeId) set({ selectedNodeId: null })
    },

    updateNodeProps: (nodeId, patch) => {
      mutatePage((page) => updateNodeProps(page, nodeId, patch))
    },

    setBreakpointOverride: (nodeId, breakpointId, patch) => {
      mutatePage((page) => setBreakpointOverride(page, nodeId, breakpointId, patch))
    },

    clearBreakpointOverride: (nodeId, breakpointId) => {
      mutatePage((page) => clearBreakpointOverride(page, nodeId, breakpointId))
    },

    renameNode: (nodeId, label) => {
      mutatePage((page) => renameNode(page, nodeId, label))
    },

    toggleNodeLocked: (nodeId) => {
      mutatePage((page) => toggleNodeLocked(page, nodeId))
    },

    toggleNodeHidden: (nodeId) => {
      mutatePage((page) => toggleNodeHidden(page, nodeId))
    },

    moveNode: (nodeId, newParentId, newIndex) => {
      mutatePage((page) => moveNode(page, nodeId, newParentId, newIndex))
    },

    duplicateNode: (nodeId) => {
      let newId = ''
      mutatePage((page) => { newId = duplicateNode(page, nodeId) })
      return newId
    },

    wrapNode: (nodeId, containerModuleId, defaults = {}) => {
      // Auto-resolve the module's schema defaults so the wrapper node renders correctly.
      // Without this, wrapNode(id, 'base.container') produces props:{} → props.tag=undefined
      // → React.createElement(undefined) → "Element type is invalid" crash (Task #414).
      const mod = registry.get(containerModuleId)
      const resolvedDefaults = { ...(mod?.defaults ?? {}), ...defaults }
      let wrapperId = ''
      mutatePage((page) => { wrapperId = wrapNode(page, nodeId, containerModuleId, resolvedDefaults) })
      return wrapperId
    },

    setNodeDynamicBinding: (nodeId, propKey, binding) => {
      mutatePage((page) => {
        const node = page.nodes[nodeId]
        if (!node) return
        node.dynamicBindings = {
          ...(node.dynamicBindings ?? {}),
          [propKey]: binding,
        }
      })
    },

    clearNodeDynamicBinding: (nodeId, propKey) => {
      mutatePage((page) => {
        const node = page.nodes[nodeId]
        if (!node?.dynamicBindings) return
        delete node.dynamicBindings[propKey]
        if (Object.keys(node.dynamicBindings).length === 0) {
          delete node.dynamicBindings
        }
      })
    },

    // ─── Breakpoint mutations ─────────────────────────────────────────────────
    addBreakpoint: (bp) => {
      const newBp: Breakpoint = { ...bp, id: nanoid(8) }
      mutateSite((p) => { p.breakpoints.push(newBp) })
      return newBp
    },

    updateBreakpoint: (id, patch) => {
      mutateSite((p) => {
        const idx = p.breakpoints.findIndex((b) => b.id === id)
        if (idx !== -1) Object.assign(p.breakpoints[idx], patch)
      })
    },

    removeBreakpoint: (id) => {
      mutateSite((p) => {
        p.breakpoints = p.breakpoints.filter((b) => b.id !== id)
      })
      // If the active breakpoint was removed, fall back to desktop
      if (get().activeBreakpointId === id) {
        set({ activeBreakpointId: 'desktop' })
      }
    },

    reorderBreakpoints: (fromIndex, toIndex) => {
      mutateSite((p) => {
        const [item] = p.breakpoints.splice(fromIndex, 1)
        p.breakpoints.splice(toIndex, 0, item)
      })
    },

    // ─── SiteDocument settings mutations ───────────────────────────────────────────
    updateSiteSettings: (patch) => {
      mutateSite((p) => {
        Object.assign(p.settings, patch)
      })
    },
  }
}
