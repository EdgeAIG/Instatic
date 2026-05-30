/**
 * classSlice — Phase C CSS Class System store slice.
 *
 * Manages the site's global class registry (StyleRule[]) and the
 * per-node class assignments (node.classIds). All mutations go through
 * Immer produce() for immutability and undo-ability.
 *
 * Architecture:
 * - Classes live in site.styleRules (flat map, keyed by StyleRule.id)
 * - Nodes reference class IDs in node.classIds (ordered array)
 * - The active class ID controls which class the Class Composer edits
 *
 * Guideline #242 — no-op guard: every setter must bail out if the new
 * value equals the current value (Object.is) to prevent re-render loops.
 */

import { nanoid } from 'nanoid'
import type { Draft } from 'immer'
import type { EditorStore, EditorStoreSliceCreator } from '@site/store/types'
import type { BaseNode, SiteDocument } from '@core/page-tree'
import type { StyleRule, CSSPropertyBag, StyleCondition, ConditionalStyleLayer } from '@core/page-tree'
import { classKindSelector } from '@core/page-tree'
import { isGeneratedClassLocked, isUserVisibleClass } from '@core/page-tree/classUtils'
import { assertValidCssClassName } from '@core/page-tree/classNames'
import { buildSiteHelpers } from './site/helpers'

/**
 * Inputs accepted by `createAmbientRule`. `selector` is required (e.g.
 * `'h1 > span'`); `name` defaults to the selector text for display purposes.
 */
export interface CreateAmbientRuleInput {
  selector: string
  name?: string
  styles?: Partial<CSSPropertyBag>
  breakpointStyles?: Record<string, Partial<CSSPropertyBag>>
}

/**
 * Compute the next cascade `order` value for a newly-inserted style rule:
 * always >= every existing order so the new rule appends at the end of the
 * cascade. Imported CSS uses explicit `order` values from the source; this
 * helper is only for user-initiated creation through the slice.
 */
function nextRuleOrder(classes: Record<string, StyleRule>): number {
  let max = -1
  for (const cls of Object.values(classes)) {
    if (typeof cls.order === 'number' && cls.order > max) max = cls.order
  }
  return max + 1
}

/**
 * Defensive selector validity check using the browser's CSS engine. Throws
 * inside `querySelector` for invalid selectors; we turn that into a boolean
 * so the slice can reject the input cleanly.
 *
 * In headless tests happy-dom provides `document` with the same semantics.
 * In the (rare) case that `document` is unavailable, fall back to a permissive
 * accept — the publisher/canvas will still try to use the selector and any
 * downstream failure surfaces clearly.
 */
function isValidCssSelector(selector: string): boolean {
  if (typeof document === 'undefined') return true
  try {
    document.createDocumentFragment().querySelector(selector)
    return true
  } catch {
    return false
  }
}

/** Structural equality for two style conditions — used to dedupe layers. */
function sameCondition(a: StyleCondition, b: StyleCondition): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'breakpoint':
      return a.breakpointId === (b as Extract<StyleCondition, { kind: 'breakpoint' }>).breakpointId
    case 'media':
    case 'supports':
      return a.query === (b as Extract<StyleCondition, { kind: 'media' | 'supports' }>).query
    case 'container': {
      const bb = b as Extract<StyleCondition, { kind: 'container' }>
      return a.query === bb.query && (a.name ?? '') === (bb.name ?? '')
    }
  }
}

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
   * Returns the new StyleRule so callers can immediately activate it.
   * Throws if a class with the same name already exists.
   */
  createClass(name: string, styles?: Partial<CSSPropertyBag>): StyleRule

  /**
   * Create an ambient style rule — one whose `selector` is not a single class
   * name (e.g. `h1`, `h1 > span`, `.hero .title`, `a:hover`). Ambient rules
   * attach by CSS matching at render time; they are never written to a
   * node's `class=` attribute. The CSS importer is the primary caller.
   *
   * Throws if the selector is empty or syntactically invalid.
   */
  createAmbientRule(input: CreateAmbientRuleInput): StyleRule

  /** Shallow-merge a style patch into a class's base styles. */
  updateClassStyles(classId: string, patch: Partial<CSSPropertyBag>): void

  /** Shallow-merge a style patch into a class's breakpoint-specific styles. */
  setClassBreakpointStyles(
    classId: string,
    breakpointId: string,
    patch: Partial<CSSPropertyBag>,
  ): void

  // ── Conditional style layers (custom @media / @container / @supports) ──────
  /**
   * Add a conditional style layer to a rule. Returns the new layer's id, or
   * null if the rule doesn't exist / is locked / a layer with the same
   * condition already exists (in which case the existing id is returned).
   */
  addConditionalLayer(classId: string, condition: StyleCondition): string | null

  /** Shallow-merge a style patch into a conditional layer's styles. */
  updateConditionalLayerStyles(
    classId: string,
    layerId: string,
    patch: Partial<CSSPropertyBag>,
  ): void

  /** Remove a conditional layer entirely. */
  removeConditionalLayer(classId: string, layerId: string): void

  /**
   * Fully remove a CSS property from a class — both from base styles and
   * from every breakpoint override. Used by the X / clear affordances on
   * visual switchers (LayoutSection) where "clear this property" must mean
   * "make it disappear" regardless of which breakpoint tab is active.
   * No-ops (and does NOT push history) if the property isn't set anywhere.
   */
  removeClassStyleProperty(classId: string, property: keyof CSSPropertyBag): void

  /** Ensure a hidden node-scoped class exists for module instance style fields. */
  ensureNodeStyleClass(nodeId: string, moduleName?: string): StyleRule | null

  /** Rename a class. Throws if the new name is already taken. */
  renameClass(classId: string, name: string): void

  /** Duplicate a reusable class. Returns the new class, or null if not found. */
  duplicateClass(classId: string): StyleRule | null

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
  breakpointStyles: StyleRule['breakpointStyles'],
): StyleRule['breakpointStyles'] {
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

function uniqueClassCopyName(classes: Record<string, StyleRule>, originalName: string): string {
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
declare module '@site/store/types' {
  interface EditorStore extends ClassSlice {}
}

export const createClassSlice: EditorStoreSliceCreator<ClassSlice> = (set, get) => {
  const { mutateSite, mutateSiteState } = buildSiteHelpers(set, get)

  return {
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
    const existing = Object.values(site.styleRules).find((c) => c.name === name)
    if (existing) throw new Error(`[classSlice] A class named "${name}" already exists`)

    const now = Date.now()
    const newClass: StyleRule = {
      id: nanoid(),
      name,
      kind: 'class',
      selector: classKindSelector(name),
      order: nextRuleOrder(site.styleRules),
      styles,
      breakpointStyles: {},
      createdAt: now,
      updatedAt: now,
    }

    mutateSite((site) => {
      site.styleRules[newClass.id] = newClass
      return true
    })

    return newClass
  },

  createAmbientRule(input) {
    const { site } = get()
    if (!site) throw new Error('[classSlice] Site document is not initialized')

    const selector = input.selector.trim()
    if (selector.length === 0) {
      throw new Error('[classSlice] Ambient selector cannot be empty')
    }
    if (!isValidCssSelector(selector)) {
      throw new Error(`[classSlice] Invalid CSS selector: ${selector}`)
    }

    // Default display name to the selector text. Unlike class-kind rules,
    // ambient rule names are not required to be globally unique — multiple
    // rules can share a selector (cascade resolves by `order`).
    const name = (input.name && input.name.trim().length > 0) ? input.name.trim() : selector

    const now = Date.now()
    const newRule: StyleRule = {
      id: nanoid(),
      name,
      kind: 'ambient',
      selector,
      order: nextRuleOrder(site.styleRules),
      styles: input.styles ?? {},
      breakpointStyles: input.breakpointStyles ?? {},
      createdAt: now,
      updatedAt: now,
    }

    mutateSite((site) => {
      site.styleRules[newRule.id] = newRule
      return true
    })

    return newRule
  },

  updateClassStyles(classId, patch) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return
    if (!hasStylePatchChanges(cls.styles, patch)) return

    mutateSite((site) => {
      const draftClass = site.styleRules[classId]
      if (!draftClass) return false
      Object.assign(draftClass.styles, patch)
      // Remove keys explicitly set to undefined/null (allow clearing a property)
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) {
          delete draftClass.styles[k]
        }
      }
      draftClass.updatedAt = Date.now()
      return true
    })
  },

  setClassBreakpointStyles(classId, breakpointId, patch) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return
    const currentStyles = cls.breakpointStyles[breakpointId] ?? {}
    if (!hasStylePatchChanges(currentStyles, patch)) return

    mutateSite((site) => {
      const draftClass = site.styleRules[classId]
      if (!draftClass) return false
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
      return true
    })
  },

  addConditionalLayer(classId, condition) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!cls) return null
    if (isGeneratedClassLocked(cls)) return null

    // Reuse an existing layer with the same condition rather than duplicating.
    const existing = (cls.conditionalLayers ?? []).find((l) =>
      sameCondition(l.condition, condition),
    )
    if (existing) return existing.id

    const newId = nanoid()
    mutateSite((site) => {
      const draftClass = site.styleRules[classId]
      if (!draftClass) return false
      if (!draftClass.conditionalLayers) draftClass.conditionalLayers = []
      const layer: ConditionalStyleLayer = {
        id: newId,
        condition,
        styles: {},
        order: draftClass.conditionalLayers.length,
      }
      draftClass.conditionalLayers.push(layer)
      draftClass.updatedAt = Date.now()
      return true
    })
    return newId
  },

  updateConditionalLayerStyles(classId, layerId, patch) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return
    const layer = (cls.conditionalLayers ?? []).find((l) => l.id === layerId)
    if (!layer) return
    if (!hasStylePatchChanges(layer.styles, patch)) return

    mutateSite((site) => {
      const draftClass = site.styleRules[classId]
      const draftLayer = draftClass?.conditionalLayers?.find((l) => l.id === layerId)
      if (!draftLayer) return false
      Object.assign(draftLayer.styles, patch)
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === null) {
          delete draftLayer.styles[k]
        }
      }
      draftClass!.updatedAt = Date.now()
      return true
    })
  },

  removeConditionalLayer(classId, layerId) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return
    if (!(cls.conditionalLayers ?? []).some((l) => l.id === layerId)) return

    mutateSite((site) => {
      const draftClass = site.styleRules[classId]
      if (!draftClass?.conditionalLayers) return false
      draftClass.conditionalLayers = draftClass.conditionalLayers.filter((l) => l.id !== layerId)
      if (draftClass.conditionalLayers.length === 0) {
        delete draftClass.conditionalLayers
      }
      draftClass.updatedAt = Date.now()
      return true
    })
  },

  removeClassStyleProperty(classId, property) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return

    const propKey = property as string
    const isInBase = propKey in cls.styles
    const breakpointIdsWithProperty = Object.entries(cls.breakpointStyles)
      .filter(([, bpStyles]) => propKey in (bpStyles ?? {}))
      .map(([id]) => id)
    if (!isInBase && breakpointIdsWithProperty.length === 0) return

    mutateSite((site) => {
      const draftClass = site.styleRules[classId]
      if (!draftClass) return false
      delete (draftClass.styles as Record<string, unknown>)[propKey]
      for (const bpId of breakpointIdsWithProperty) {
        const bp = draftClass.breakpointStyles[bpId]
        if (bp) delete (bp as Record<string, unknown>)[propKey]
      }
      draftClass.updatedAt = Date.now()
      return true
    })
  },

  ensureNodeStyleClass(nodeId, moduleName = 'Module') {
    const { site } = get()
    if (!site) return null

    const node = findNodeWithClassIds(site, nodeId)
    if (!node) return null

    const existingId = node.classIds?.find((id) => {
      const cls = site.styleRules[id]
      return cls?.scope?.type === 'node' && cls.scope.nodeId === nodeId && cls.scope.role === 'module-style'
    })
    if (existingId && site.styleRules[existingId]) {
      return site.styleRules[existingId]
    }

    const now = Date.now()
    const instanceName = `${moduleName} instance ${nodeId.slice(0, 6)}`
    const newClass: StyleRule = {
      id: nanoid(),
      name: instanceName,
      kind: 'class',
      selector: classKindSelector(instanceName),
      order: nextRuleOrder(site.styleRules),
      description: 'Node-scoped module style layer',
      scope: { type: 'node', nodeId, role: 'module-style' },
      styles: {},
      breakpointStyles: {},
      tags: ['module-instance'],
      createdAt: now,
      updatedAt: now,
    }

    mutateSiteState((state, site) => {
      const mutated = mutateNodeClassIds(state, nodeId, (classIds) => {
        // Drop any prior module-style class scoped to this node before
        // appending the freshly created one. The filter is in-place via
        // splice so we don't reassign `node.classIds` inside the recipe.
        for (let i = classIds.length - 1; i >= 0; i--) {
          const cls = site.styleRules[classIds[i]]
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
      if (!mutated) return false
      site.styleRules[newClass.id] = newClass
      return true
    })

    return newClass
  },

  renameClass(classId, name) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return
    assertValidCssClassName(name)
    if (Object.is(cls.name, name)) return

    // Uniqueness check (allow keeping same name)
    const existing = Object.values(site.styleRules).find(
      (c) => c.name === name && c.id !== classId,
    )
    if (existing) throw new Error(`[classSlice] A class named "${name}" already exists`)

    mutateSite((site) => {
      const draftClass = site.styleRules[classId]
      if (!draftClass) return false
      draftClass.name = name
      draftClass.updatedAt = Date.now()
      return true
    })
  },

  duplicateClass(classId) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!site || !cls || !isUserVisibleClass(cls)) return null
    if (isGeneratedClassLocked(cls)) return null

    const now = Date.now()
    const copyName = uniqueClassCopyName(site.styleRules, cls.name)
    // Duplicating preserves the source rule's kind and selector pattern. For
    // class-kind rules the selector is rebuilt from the new (unique) name; for
    // ambient rules the selector text is copied verbatim so the rule still
    // matches the same elements after duplication.
    const kind = cls.kind ?? 'class'
    const selector = kind === 'class' ? classKindSelector(copyName) : (cls.selector || classKindSelector(copyName))
    const newClass: StyleRule = {
      id: nanoid(),
      name: copyName,
      kind,
      selector,
      order: nextRuleOrder(site.styleRules),
      description: cls.description,
      styles: { ...cls.styles },
      breakpointStyles: cloneBreakpointStyles(cls.breakpointStyles),
      tags: cls.tags ? [...cls.tags] : undefined,
      createdAt: now,
      updatedAt: now,
    }

    mutateSite((site) => {
      site.styleRules[newClass.id] = newClass
      return true
    })

    return newClass
  },

  deleteClass(classId) {
    const { site } = get()
    const cls = site?.styleRules[classId]
    if (!cls) return
    if (isGeneratedClassLocked(cls)) return

    mutateSiteState((state, site) => {
      if (!site.styleRules[classId]) return false
      // Remove from registry
      delete site.styleRules[classId]
      // Remove from every node on every page AND every Visual Component
      // tree — class IDs are global, so a deleted class must disappear
      // from both surfaces or a VC keeps a dangling reference.
      for (const page of site.pages) {
        for (const node of Object.values(page.nodes)) {
          if (node.classIds && node.classIds.includes(classId)) {
            node.classIds = node.classIds.filter((id) => id !== classId)
          }
        }
      }
      for (const vc of site.visualComponents) {
        for (const node of Object.values(vc.tree.nodes)) {
          if (node.classIds && node.classIds.includes(classId)) {
            node.classIds = node.classIds.filter((id) => id !== classId)
          }
        }
      }
      // Clear activeClassId if it pointed to the deleted class
      if (state.activeClassId === classId) {
        state.activeClassId = null
      }
      if (state.selectedSelectorClassId === classId) {
        state.selectedSelectorClassId = null
      }
      return true
    })
  },

  // ── Node ↔ class assignment ────────────────────────────────────────────────

  addNodeClass(nodeId, classId) {
    const { site } = get()
    const node = findNodeWithClassIds(site, nodeId)
    if (!node) return
    // No-op if already assigned
    if (node.classIds?.includes(classId)) return
    // Invariant: node.classIds only holds class-kind rule ids. Ambient rules
    // attach by selector matching, not by class-attribute assignment, so
    // pushing one here would leak into the rendered class attribute via
    // a never-matching token. Surface the misuse and bail.
    const cls = site?.styleRules[classId]
    if (cls && cls.kind && cls.kind !== 'class') {
      console.error(
        '[classSlice] addNodeClass refused: classId references an ambient rule',
        { nodeId, classId, selector: cls.selector },
      )
      return
    }

    mutateSiteState((state) => {
      const mutated = mutateNodeClassIds(state, nodeId, (classIds) => {
        if (!classIds.includes(classId)) classIds.push(classId)
      })
      return mutated
    })
  },

  removeNodeClass(nodeId, classId) {
    const { site } = get()
    const node = findNodeWithClassIds(site, nodeId)
    if (!node?.classIds?.includes(classId)) return

    mutateSiteState((state) => {
      const mutated = mutateNodeClassIds(state, nodeId, (classIds) => {
        const idx = classIds.indexOf(classId)
        if (idx >= 0) classIds.splice(idx, 1)
      })
      return mutated
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

    mutateSiteState((state) => {
      let moved = false
      const mutated = mutateNodeClassIds(state, nodeId, (arr) => {
        if (arr.length <= Math.max(fromIndex, toIndex)) return
        const [item] = arr.splice(fromIndex, 1)
        arr.splice(toIndex, 0, item)
        moved = true
      })
      return mutated && moved
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

    mutateSiteState((state) => {
      let moved = false
      const mutated = mutateNodeClassIds(state, nodeId, (arr) => {
        const i = arr.indexOf(classId)
        if (i === -1) return
        const target = direction === 'up' ? i - 1 : i + 1
        if (target < 0 || target >= arr.length) return
        const [item] = arr.splice(i, 1)
        arr.splice(target, 0, item)
        moved = true
      })
      return mutated && moved
    })
  },
  }
}
