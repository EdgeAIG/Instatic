/**
 * classSlice — Phase C CSS Class System store slice.
 *
 * Manages the site's global class registry (CSSClass[]) and the
 * per-node class assignments (node.classIds). All mutations go through
 * Immer produce() for immutability and undo-ability.
 *
 * Architecture:
 * - Classes live in site.classes (flat map, keyed by CSSClass.id)
 * - Nodes reference class IDs in node.classIds (ordered array)
 * - The active class ID controls which class the Class Composer edits
 *
 * Guideline #242 — no-op guard: every setter must bail out if the new
 * value equals the current value (Object.is) to prevent re-render loops.
 */

import { nanoid } from 'nanoid'
import type { Draft } from 'immer'
import type { EditorStore, EditorStoreSliceCreator } from '../types'
import type { BaseNode, SiteDocument } from '@core/page-tree'
import type { CSSClass, CSSPropertyBag } from '@core/page-tree/schemas'
import { isGeneratedClassLocked, isUserVisibleClass } from '@core/page-tree/classUtils'
import { assertValidCssClassName } from '@core/page-tree/classNames'

export interface ClassPreviewAssignment {
  nodeId: string
  classId: string
}

/**
 * Transient style preview applied on top of a class while a user hovers a
 * suggestion in a property control (e.g. spacing token dropdown). The
 * canvas style injector reads this and emits a higher-specificity rule so
 * the change is visible without committing to history.
 */
export interface ClassStylesPreview {
  classId: string
  /** Breakpoint id to scope the preview to, or null/undefined for the base styles. */
  breakpointId?: string | null
  styles: Partial<CSSPropertyBag>
}

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface ClassSlice {
  // ── UI state ──────────────────────────────────────────────────────────────
  /** The class currently being edited in the Class Composer (null = none) */
  activeClassId: string | null
  setActiveClass(id: string | null): void

  /** Transient class assignment previewed on the canvas while hovering a suggestion. */
  previewClassAssignment: ClassPreviewAssignment | null
  setPreviewNodeClass(nodeId: string, classId: string): void
  clearPreviewNodeClass(nodeId?: string, classId?: string): void

  /** Transient style patch previewed on the canvas while hovering a suggestion. */
  previewClassStyles: ClassStylesPreview | null
  setPreviewClassStyles(preview: ClassStylesPreview): void
  clearPreviewClassStyles(classId?: string): void

  // ── CRUD ──────────────────────────────────────────────────────────────────
  /**
   * Create a new class with the given name and optional initial styles.
   * Returns the new CSSClass so callers can immediately activate it.
   * Throws if a class with the same name already exists.
   */
  createClass(name: string, styles?: Partial<CSSPropertyBag>): CSSClass

  /** Shallow-merge a style patch into a class's base styles. */
  updateClassStyles(classId: string, patch: Partial<CSSPropertyBag>): void

  /** Shallow-merge a style patch into a class's breakpoint-specific styles. */
  setClassBreakpointStyles(
    classId: string,
    breakpointId: string,
    patch: Partial<CSSPropertyBag>,
  ): void

  /**
   * Fully remove a CSS property from a class — both from base styles and
   * from every breakpoint override. Used by the X / clear affordances on
   * visual switchers (LayoutSection) where "clear this property" must mean
   * "make it disappear" regardless of which breakpoint tab is active.
   * No-ops (and does NOT push history) if the property isn't set anywhere.
   */
  removeClassStyleProperty(classId: string, property: keyof CSSPropertyBag): void

  /** Ensure a hidden node-scoped class exists for module instance style fields. */
  ensureNodeStyleClass(nodeId: string, moduleName?: string): CSSClass | null

  /** Rename a class. Throws if the new name is already taken. */
  renameClass(classId: string, name: string): void

  /** Duplicate a reusable class. Returns the new class, or null if not found. */
  duplicateClass(classId: string): CSSClass | null

  /** Delete a class and remove it from all nodes that reference it. */
  deleteClass(classId: string): void

  // ── Node ↔ class assignment ───────────────────────────────────────────────
  /** Append a classId to a node's classIds (no-op if already present). */
  addNodeClass(nodeId: string, classId: string): void

  /** Remove a classId from a node's classIds (no-op if not present). */
  removeNodeClass(nodeId: string, classId: string): void

  /** Swap two classIds by index within a node's classIds array. */
  reorderNodeClasses(nodeId: string, fromIndex: number, toIndex: number): void

  /**
   * Move a classId one position up ('up' = lower index = lower cascade priority)
   * or down ('down' = higher index = higher cascade priority) in a node's classIds array.
   * No-op at array boundaries (Guideline #242 — no-op mutation guard).
   */
  reorderNodeClass(nodeId: string, classId: string, direction: 'up' | 'down'): void
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasStylePatchChanges(
  current: Record<string, unknown>,
  patch: Partial<CSSPropertyBag>,
): boolean {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === null) {
      if (key in current) return true
    } else if (!Object.is(current[key], value)) {
      return true
    }
  }
  return false
}

function shallowEqualStyles(
  a: Partial<CSSPropertyBag>,
  b: Partial<CSSPropertyBag>,
): boolean {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false
  for (const key of aKeys) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) {
      return false
    }
  }
  return true
}

function cloneBreakpointStyles(
  breakpointStyles: CSSClass['breakpointStyles'],
): CSSClass['breakpointStyles'] {
  return Object.fromEntries(
    Object.entries(breakpointStyles).map(([breakpointId, styles]) => [
      breakpointId,
      { ...styles },
    ]),
  )
}

/**
 * Find a node by id anywhere in the site — pages **and** Visual Component
 * trees. Returns null when the node doesn't exist anywhere.
 *
 * Node↔class mutations need this because the user can be editing either a
 * page or a VC; the canvas selection lives in whichever document is active.
 * Searching only `site.pages` (the original implementation) silently
 * no-ops every class assignment when the user is in VC canvas mode.
 *
 * VCNode = BaseNode (structurally identical), so a single `BaseNode`-shaped
 * helper covers both tree kinds.
 */
function findNodeWithClassIds(
  site: SiteDocument | null,
  nodeId: string,
): BaseNode | null {
  if (!site) return null
  for (const page of site.pages) {
    const node = page.nodes[nodeId]
    if (node) return node
  }
  for (const vc of site.visualComponents) {
    const node = vc.tree.nodes[nodeId]
    if (node) return node
  }
  return null
}

/**
 * Apply a mutation to a node's `classIds` array inside an Immer producer,
 * looking up the node in pages first and falling back to Visual Component
 * trees. The recipe receives the live (draft) `classIds` array — mutate it
 * in place. Initialises `classIds` to `[]` when missing.
 *
 * Returns `true` when the node was found and the recipe ran, `false`
 * otherwise (used by callers to skip post-mutation bookkeeping when the
 * node has been removed concurrently).
 */
function mutateNodeClassIds(
  state: Draft<EditorStore>,
  nodeId: string,
  recipe: (classIds: string[]) => void,
): boolean {
  if (!state.site) return false
  for (const page of state.site.pages) {
    const node = page.nodes[nodeId]
    if (node) {
      if (!node.classIds) node.classIds = []
      recipe(node.classIds)
      return true
    }
  }
  for (const vc of state.site.visualComponents) {
    const node = vc.tree.nodes[nodeId]
    if (node) {
      if (!node.classIds) node.classIds = []
      recipe(node.classIds)
      return true
    }
  }
  return false
}

function uniqueClassCopyName(classes: Record<string, CSSClass>, originalName: string): string {
  const existingNames = new Set(Object.values(classes).map((cls) => cls.name))
  const baseName = `${originalName}-copy`
  if (!existingNames.has(baseName)) return baseName

  let suffix = 2
  while (existingNames.has(`${baseName}-${suffix}`)) {
    suffix += 1
  }
  return `${baseName}-${suffix}`
}

// ---------------------------------------------------------------------------
// Slice implementation
// ---------------------------------------------------------------------------

// Contribute this slice's fields to the combined `EditorStore` type via TS
// module augmentation. See `../types.ts` for why we use this pattern.
declare module '@core/editor-store/types' {
  interface EditorStore extends ClassSlice {}
}

export const createClassSlice: EditorStoreSliceCreator<ClassSlice> = (set, get) => ({
  // ── UI state ───────────────────────────────────────────────────────────────

  activeClassId: null,
  previewClassAssignment: null,
  previewClassStyles: null,

  setActiveClass(id) {
    // Guideline #242 no-op guard
    if (Object.is(get().activeClassId, id)) return
    set({ activeClassId: id })
  },

  setPreviewNodeClass(nodeId, classId) {
    const current = get().previewClassAssignment
    if (current?.nodeId === nodeId && current.classId === classId) return
    set({ previewClassAssignment: { nodeId, classId } })
  },

  clearPreviewNodeClass(nodeId, classId) {
    const current = get().previewClassAssignment
    if (!current) return
    if (nodeId !== undefined && current.nodeId !== nodeId) return
    if (classId !== undefined && current.classId !== classId) return
    set({ previewClassAssignment: null })
  },

  setPreviewClassStyles(preview) {
    const current = get().previewClassStyles
    if (
      current &&
      current.classId === preview.classId &&
      (current.breakpointId ?? null) === (preview.breakpointId ?? null) &&
      shallowEqualStyles(current.styles, preview.styles)
    ) {
      return
    }
    set({ previewClassStyles: preview })
  },

  clearPreviewClassStyles(classId) {
    const current = get().previewClassStyles
    if (!current) return
    if (classId !== undefined && current.classId !== classId) return
    set({ previewClassStyles: null })
  },

  // ── CRUD ───────────────────────────────────────────────────────────────────

  createClass(name, styles = {}) {
    const { site } = get()
    if (!site) throw new Error('[classSlice] Site document is not initialized')
    assertValidCssClassName(name)

    // Uniqueness check
    const existing = Object.values(site.classes).find((c) => c.name === name)
    if (existing) throw new Error(`[classSlice] A class named "${name}" already exists`)

    const now = Date.now()
    const newClass: CSSClass = {
      id: nanoid(),
      name,
      styles,
      breakpointStyles: {},
      createdAt: now,
      updatedAt: now,
    }

    get().pushHistory()
    set((state) => {
        if (!state.site) return
        state.site.classes[newClass.id] = newClass
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })

    return newClass
  },

  updateClassStyles(classId, patch) {
    const { site } = get()
    const cls = site?.classes[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return
    if (!hasStylePatchChanges(cls.styles, patch)) return

    get().pushHistory()
    set((state) => {
        if (!state.site?.classes[classId]) return
        const draftClass = state.site.classes[classId]
        Object.assign(draftClass.styles, patch)
        // Remove keys explicitly set to undefined/null (allow clearing a property)
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) {
            delete draftClass.styles[k]
          }
        }
        draftClass.updatedAt = Date.now()
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
  },

  setClassBreakpointStyles(classId, breakpointId, patch) {
    const { site } = get()
    const cls = site?.classes[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return
    const currentStyles = cls.breakpointStyles[breakpointId] ?? {}
    if (!hasStylePatchChanges(currentStyles, patch)) return

    get().pushHistory()
    set((state) => {
        if (!state.site?.classes[classId]) return
        const draftClass = state.site.classes[classId]
        if (!draftClass.breakpointStyles[breakpointId]) {
          draftClass.breakpointStyles[breakpointId] = {}
        }
        Object.assign(draftClass.breakpointStyles[breakpointId], patch)
        // Remove keys explicitly set to undefined/null
        for (const [k, v] of Object.entries(patch)) {
          if (v === undefined || v === null) {
            delete draftClass.breakpointStyles[breakpointId][k]
          }
        }
        draftClass.updatedAt = Date.now()
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
  },

  removeClassStyleProperty(classId, property) {
    const { site } = get()
    const cls = site?.classes[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return

    const propKey = property as string
    const isInBase = propKey in cls.styles
    const breakpointIdsWithProperty = Object.entries(cls.breakpointStyles)
      .filter(([, bpStyles]) => propKey in (bpStyles ?? {}))
      .map(([id]) => id)
    if (!isInBase && breakpointIdsWithProperty.length === 0) return

    get().pushHistory()
    set((state) => {
        if (!state.site?.classes[classId]) return
        const draftClass = state.site.classes[classId]
        delete (draftClass.styles as Record<string, unknown>)[propKey]
        for (const bpId of breakpointIdsWithProperty) {
          const bp = draftClass.breakpointStyles[bpId]
          if (bp) delete (bp as Record<string, unknown>)[propKey]
        }
        draftClass.updatedAt = Date.now()
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
  },

  ensureNodeStyleClass(nodeId, moduleName = 'Module') {
    const { site } = get()
    if (!site) return null

    const node = findNodeWithClassIds(site, nodeId)
    if (!node) return null

    const existingId = node.classIds?.find((id) => {
      const cls = site.classes[id]
      return cls?.scope?.type === 'node' && cls.scope.nodeId === nodeId && cls.scope.role === 'module-style'
    })
    if (existingId && site.classes[existingId]) {
      return site.classes[existingId]
    }

    const now = Date.now()
    const newClass: CSSClass = {
      id: nanoid(),
      name: `${moduleName} instance ${nodeId.slice(0, 6)}`,
      description: 'Node-scoped module style layer',
      scope: { type: 'node', nodeId, role: 'module-style' },
      styles: {},
      breakpointStyles: {},
      tags: ['module-instance'],
      createdAt: now,
      updatedAt: now,
    }

    get().pushHistory()
    set((state) => {
        if (!state.site) return
        state.site.classes[newClass.id] = newClass
        const mutated = mutateNodeClassIds(state, nodeId, (classIds) => {
          // Drop any prior module-style class scoped to this node before
          // appending the freshly created one. The filter is in-place via
          // splice so we don't reassign `node.classIds` inside the recipe.
          for (let i = classIds.length - 1; i >= 0; i--) {
            const cls = state.site?.classes[classIds[i]]
            if (
              cls?.scope?.type === 'node' &&
              cls.scope.nodeId === nodeId &&
              cls.scope.role === 'module-style'
            ) {
              classIds.splice(i, 1)
            }
          }
          classIds.push(newClass.id)
        })
        if (!mutated) return
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })

    return newClass
  },

  renameClass(classId, name) {
    const { site } = get()
    const cls = site?.classes[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return
    assertValidCssClassName(name)
    if (Object.is(cls.name, name)) return

    // Uniqueness check (allow keeping same name)
    const existing = Object.values(site.classes).find(
      (c) => c.name === name && c.id !== classId,
    )
    if (existing) throw new Error(`[classSlice] A class named "${name}" already exists`)

    get().pushHistory()
    set((state) => {
        if (!state.site?.classes[classId]) return
        state.site.classes[classId].name = name
        state.site.classes[classId].updatedAt = Date.now()
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
  },

  duplicateClass(classId) {
    const { site } = get()
    const cls = site?.classes[classId]
    if (!site || !cls || !isUserVisibleClass(cls)) return null
    if (isGeneratedClassLocked(cls)) return null

    const now = Date.now()
    const newClass: CSSClass = {
      id: nanoid(),
      name: uniqueClassCopyName(site.classes, cls.name),
      description: cls.description,
      styles: { ...cls.styles },
      breakpointStyles: cloneBreakpointStyles(cls.breakpointStyles),
      tags: cls.tags ? [...cls.tags] : undefined,
      createdAt: now,
      updatedAt: now,
    }

    get().pushHistory()
    set((state) => {
        if (!state.site) return
        state.site.classes[newClass.id] = newClass
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })

    return newClass
  },

  deleteClass(classId) {
    const { site } = get()
    const cls = site?.classes[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return

    get().pushHistory()
    set((state) => {
        if (!state.site) return
        // Remove from registry
        delete state.site.classes[classId]
        // Remove from every node on every page AND every Visual Component
        // tree — class IDs are global, so a deleted class must disappear
        // from both surfaces or a VC keeps a dangling reference.
        for (const page of state.site.pages) {
          for (const node of Object.values(page.nodes)) {
            if (node.classIds && node.classIds.includes(classId)) {
              node.classIds = node.classIds.filter((id) => id !== classId)
            }
          }
        }
        for (const vc of state.site.visualComponents) {
          for (const node of Object.values(vc.tree.nodes)) {
            if (node.classIds && node.classIds.includes(classId)) {
              node.classIds = node.classIds.filter((id) => id !== classId)
            }
          }
        }
        state.site.updatedAt = Date.now()
        // Clear activeClassId if it pointed to the deleted class
        if (state.activeClassId === classId) {
          state.activeClassId = null
        }
        if (state.selectedSelectorClassId === classId) {
          state.selectedSelectorClassId = null
        }
        state.hasUnsavedChanges = true
      })
  },

  // ── Node ↔ class assignment ────────────────────────────────────────────────

  addNodeClass(nodeId, classId) {
    const { site } = get()
    const node = findNodeWithClassIds(site, nodeId)
    if (!node) return
    // No-op if already assigned
    if (node.classIds?.includes(classId)) return

    get().pushHistory()
    set((state) => {
        if (!state.site) return
        const mutated = mutateNodeClassIds(state, nodeId, (classIds) => {
          if (!classIds.includes(classId)) classIds.push(classId)
        })
        if (!mutated) return
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
  },

  removeNodeClass(nodeId, classId) {
    const { site } = get()
    const node = findNodeWithClassIds(site, nodeId)
    if (!node?.classIds?.includes(classId)) return

    get().pushHistory()
    set((state) => {
        if (!state.site) return
        const mutated = mutateNodeClassIds(state, nodeId, (classIds) => {
          const idx = classIds.indexOf(classId)
          if (idx >= 0) classIds.splice(idx, 1)
        })
        if (!mutated) return
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
  },

  reorderNodeClasses(nodeId, fromIndex, toIndex) {
    const { site } = get()
    if (!site) return
    if (fromIndex === toIndex) return
    if (fromIndex < 0 || toIndex < 0) return
    const node = findNodeWithClassIds(site, nodeId)
    const classIds = node?.classIds
    if (!classIds || classIds.length <= Math.max(fromIndex, toIndex)) return

    get().pushHistory()
    set((state) => {
        if (!state.site) return
        const mutated = mutateNodeClassIds(state, nodeId, (arr) => {
          if (arr.length <= Math.max(fromIndex, toIndex)) return
          const [moved] = arr.splice(fromIndex, 1)
          arr.splice(toIndex, 0, moved)
        })
        if (!mutated) return
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
  },

  reorderNodeClass(nodeId, classId, direction) {
    const { site } = get()
    if (!site) return
    const node = findNodeWithClassIds(site, nodeId)
    const classIds = node?.classIds
    if (!classIds || classIds.length < 2) return
    const idx = classIds.indexOf(classId)
    if (idx === -1) return
    const newIdx = direction === 'up' ? idx - 1 : idx + 1
    // No-op at array boundaries — Guideline #242
    if (newIdx < 0 || newIdx >= classIds.length) return

    get().pushHistory()
    set((state) => {
        if (!state.site) return
        const mutated = mutateNodeClassIds(state, nodeId, (arr) => {
          const i = arr.indexOf(classId)
          if (i === -1) return
          const target = direction === 'up' ? i - 1 : i + 1
          if (target < 0 || target >= arr.length) return
          const [moved] = arr.splice(i, 1)
          arr.splice(target, 0, moved)
        })
        if (!mutated) return
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true
      })
  },
})
