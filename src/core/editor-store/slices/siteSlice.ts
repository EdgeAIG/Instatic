import { nanoid } from 'nanoid'
import type { EditorStoreSliceCreator } from '../types'
import { renderCache } from '@core/engine/renderCache'
import { registry } from '@core/module-engine/registry'
import { wouldCreateCycle } from '@core/visualComponents/recursionGuard'
import {
  type CSSClass,
  type FontEntry,
  type SiteDocument,
  type Page,
  type PageNode,
  type NodeTree,
  type BaseNode,
  type Breakpoint,
  type SiteSettings,
  type PageTemplateConfig,
  type DynamicPropBinding,
  type FrameworkColorToken,
  type FrameworkColorUtilityType,
  type FrameworkPreferencesSettings,
  type FrameworkScaleManualSize,
  type FrameworkScaleMode,
  type FrameworkSpacingClassGenerator,
  type FrameworkSpacingGroup,
  type FrameworkTypographyClassGenerator,
  type FrameworkTypographyGroup,
  DEFAULT_BREAKPOINTS,
  DEFAULT_SITE_SETTINGS,
  createNode,
  addPage,
  deletePage,
  renamePage,
  reorderPages,
  duplicatePage,
  insertNode,
  deleteNode,
  updateNodeProps,
  setBreakpointOverride,
  clearBreakpointOverride,
  renameNode,
  toggleNodeLocked,
  toggleNodeHidden,
  moveNode,
  moveNodes,
  duplicateNode,
  wrapNode,
  wrapNodes,
} from '@core/page-tree'
import { syncSlotInstances, applySlotSyncResult } from '@core/visualComponents/slotSync'
import {
  clonePackageJson,
  DEFAULT_SITE_PACKAGE_JSON,
} from '@core/site-dependencies/manifest'
import {
  cloneSiteRuntimeConfig,
  DEFAULT_SITE_RUNTIME,
} from '@core/site-runtime'
import {
  generateDefaultDarkColor,
  normalizeFrameworkColorSlug,
} from '@core/framework/colors'
import { generateFrameworkUtilityClasses } from '@core/framework/generate'
import { DEFAULT_FRAMEWORK_PREFERENCES } from '@core/framework/preferences'
import {
  previewFrameworkClassRemovals,
  type FrameworkChangeImpact,
} from '@core/framework/changeImpact'
import {
  buildDefaultSpacingGroup,
  buildDefaultTypographyGroup,
  makeFreshSpacingGroup,
  makeFreshTypographyGroup,
  nextSpacingTabValues,
  nextTypographyTabValues,
} from '@core/framework/defaults'

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
  duplicatePage: (sourcePageId: string, title: string, slug?: string) => Page
  reorderPages: (fromIndex: number, toIndex: number) => void
  convertPageToTemplate: (pageId: string, config: PageTemplateConfig) => void
  convertTemplateToPage: (pageId: string) => void

  // Node mutations (operate on the active page)
  insertNode: (moduleId: string, defaults: Record<string, unknown>, parentId: string, index?: number) => string

  /**
   * Insert a `base.visual-component-ref` node into the active document.
   *
   * - In VC mode: inserts via `mutateActiveTree` and guards against cyclic references.
   *   Returns `null` if the insertion would create a cycle.
   * - In page mode: inserts via `insertNode`. Returns `null` if `componentId` is empty.
   * - Auto-materializes `base.slot-instance` children after insertion via `syncSlotInstances`.
   * - Returns the new node's id on success, or `null` on no-op / cycle prevented.
   */
  insertComponentRef: (parentId: string, componentId: string) => string | null
  deleteNode: (nodeId: string) => void
  /** Multi-delete: removes every id and its descendants in one undo step. */
  deleteNodes: (nodeIds: string[]) => void
  updateNodeProps: (nodeId: string, patch: Record<string, unknown>) => void
  setBreakpointOverride: (nodeId: string, breakpointId: string, patch: Record<string, unknown>) => void
  clearBreakpointOverride: (nodeId: string, breakpointId: string) => void
  renameNode: (nodeId: string, label: string) => void
  toggleNodeLocked: (nodeId: string) => void
  toggleNodeHidden: (nodeId: string) => void
  moveNode: (nodeId: string, newParentId: string, newIndex: number) => void
  /** Multi-move: moves every top-level id into newParent at newIndex (single undo step). */
  moveNodes: (nodeIds: string[], newParentId: string, newIndex: number) => void
  duplicateNode: (nodeId: string) => string
  /** Multi-duplicate: duplicates every id in place (single undo step). Returns the new ids. */
  duplicateNodes: (nodeIds: string[]) => string[]
  wrapNode: (nodeId: string, containerModuleId: string, defaults?: Record<string, unknown>) => string
  /**
   * Wrap a multi-selection inside one new container with closest-common-ancestor
   * semantics. Returns the new wrapper id, or `null` when the selection is empty.
   */
  wrapNodes: (nodeIds: string[], containerModuleId: string, defaults?: Record<string, unknown>) => string | null
  setNodeDynamicBinding: (nodeId: string, propKey: string, binding: DynamicPropBinding) => void
  clearNodeDynamicBinding: (nodeId: string, propKey: string) => void

  // Breakpoint mutations
  addBreakpoint: (bp: Omit<Breakpoint, 'id'>) => Breakpoint
  updateBreakpoint: (id: string, patch: Partial<Omit<Breakpoint, 'id'>>) => void
  removeBreakpoint: (id: string) => void
  reorderBreakpoints: (fromIndex: number, toIndex: number) => void

  // SiteDocument settings mutations
  updateSiteSettings: (patch: Partial<SiteSettings>) => void

  // Framework color mutations
  createFrameworkColorToken: (input: CreateFrameworkColorTokenInput) => FrameworkColorToken
  updateFrameworkColorToken: (tokenId: string, patch: UpdateFrameworkColorTokenPatch) => void
  duplicateFrameworkColorToken: (tokenId: string) => FrameworkColorToken | null
  reorderFrameworkColorToken: (tokenId: string, direction: 'up' | 'down') => void
  deleteFrameworkColorToken: (tokenId: string) => void

  // Framework preferences
  updateFrameworkPreferences: (patch: Partial<FrameworkPreferencesSettings>) => void

  // Framework typography mutations
  toggleFrameworkTypographyDisabled: () => void
  createFrameworkTypographyGroup: () => FrameworkTypographyGroup
  updateFrameworkTypographyGroup: (groupId: string, patch: UpdateFrameworkTypographyGroupPatch) => void
  duplicateFrameworkTypographyGroup: (groupId: string) => FrameworkTypographyGroup | null
  resetFrameworkTypographyGroup: (groupId: string) => void
  deleteFrameworkTypographyGroup: (groupId: string) => void
  upsertFrameworkTypographyManualSize: (
    groupId: string,
    sizeId: string,
    patch: Partial<FrameworkScaleManualSize>,
  ) => void
  setFrameworkTypographyClassGenerators: (classes: FrameworkTypographyClassGenerator[]) => void

  // Framework spacing mutations
  toggleFrameworkSpacingDisabled: () => void
  createFrameworkSpacingGroup: () => FrameworkSpacingGroup
  updateFrameworkSpacingGroup: (groupId: string, patch: UpdateFrameworkSpacingGroupPatch) => void
  duplicateFrameworkSpacingGroup: (groupId: string) => FrameworkSpacingGroup | null
  resetFrameworkSpacingGroup: (groupId: string) => void
  deleteFrameworkSpacingGroup: (groupId: string) => void
  upsertFrameworkSpacingManualSize: (
    groupId: string,
    sizeId: string,
    patch: Partial<FrameworkScaleManualSize>,
  ) => void
  setFrameworkSpacingClassGenerators: (classes: FrameworkSpacingClassGenerator[]) => void

  // ─── Site fonts library ─────────────────────────────────────────────────
  /**
   * Add a font to the library. The caller (UI) is responsible for first calling
   * the server install endpoint, which downloads the woff2 files; the resulting
   * `FontEntry` returned by the server is what gets passed here. The action
   * itself is purely client-side — it only mutates `settings.fonts.items`.
   * Duplicate `family` (case-insensitive) on the same `source` is a no-op.
   */
  addFont: (entry: FontEntry) => void
  /** Remove an installed font by id. Server file cleanup is the caller's job. */
  removeFont: (fontId: string) => void

  /**
   * Preview the destructive impact of a framework-related change without
   * committing it. Returns the list of framework classes that would be
   * removed and every place those classes are still assigned, or `null`
   * if the change removes nothing-in-use (silent commit is fine).
   *
   * The caller writes a small mutation function that mirrors what the
   * actual store action would do at the framework-settings level. This
   * function clones the current site, applies the mutation to the clone,
   * runs every framework reconciler, then diffs.
   */
  previewFrameworkChange: (
    applyChange: (site: SiteDocument) => void,
  ) => FrameworkChangeImpact | null

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

type ColorVariantOptions = { enabled: boolean; count: number }

interface CreateFrameworkColorTokenInput {
  category?: string
  slug: string
  lightValue: string
  darkValue?: string
  darkModeEnabled?: boolean
  generateUtilities?: Partial<Record<FrameworkColorUtilityType, boolean>>
  generateTransparent?: boolean
  generateShades?: Partial<ColorVariantOptions>
  generateTints?: Partial<ColorVariantOptions>
}

type UpdateFrameworkColorTokenPatch = Partial<{
  category: string
  slug: string
  lightValue: string
  darkValue: string
  darkModeEnabled: boolean
  generateUtilities: Partial<Record<FrameworkColorUtilityType, boolean>>
  generateTransparent: boolean
  generateShades: Partial<ColorVariantOptions>
  generateTints: Partial<ColorVariantOptions>
  order: number
}>

export type UpdateFrameworkTypographyGroupPatch = Partial<{
  name: string
  namingConvention: string
  steps: string
  baseScaleIndex: number
  mode: FrameworkScaleMode
  isDisabled: boolean
  /** Patch into the `min` breakpoint config — fields are merged, untouched fields preserved. */
  min: Partial<FrameworkTypographyGroup['min']>
  max: Partial<FrameworkTypographyGroup['max']>
  manualSizes: FrameworkScaleManualSize[]
}>

export type UpdateFrameworkSpacingGroupPatch = Partial<{
  name: string
  namingConvention: string
  steps: string
  baseScaleIndex: number
  mode: FrameworkScaleMode
  isDisabled: boolean
  min: Partial<FrameworkSpacingGroup['min']>
  max: Partial<FrameworkSpacingGroup['max']>
  manualSizes: FrameworkScaleManualSize[]
}>

function createDefaultSiteDocument(name: string): SiteDocument {
  const rootNode = createNode('base.body')
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
    runtime: cloneSiteRuntimeConfig(DEFAULT_SITE_RUNTIME),
    breakpoints: DEFAULT_BREAKPOINTS,
    settings: structuredClone(DEFAULT_SITE_SETTINGS),
    classes: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

const DEFAULT_COLOR_UTILITIES: Record<FrameworkColorUtilityType, boolean> = {
  text: true,
  background: true,
  border: true,
  fill: false,
}

const DEFAULT_COLOR_VARIANTS: ColorVariantOptions = { enabled: true, count: 4 }

function ensureFrameworkColors(site: SiteDocument): NonNullable<SiteSettings['framework']>['colors'] {
  if (!site.settings.framework) {
    site.settings.framework = { colors: { tokens: [] } }
  }
  if (!site.settings.framework.colors) {
    site.settings.framework.colors = { tokens: [] }
  }
  site.settings.framework.colors.tokens ??= []
  return site.settings.framework.colors
}

function normalizeCategoryLabel(input: string | undefined | null): string {
  return typeof input === 'string' ? input.trim() : ''
}

/**
 * Match a new category label against existing tokens case-insensitively.
 * If any other token already uses a category with the same letters (regardless
 * of case), the canonical casing of that existing label wins — this prevents
 * "Brand" and "brand" from drifting into separate categories when the user
 * forgets the original capitalization.
 */
function canonicalizeCategoryLabel(
  input: string | undefined | null,
  tokens: FrameworkColorToken[],
  excludeTokenId?: string,
): string {
  const trimmed = normalizeCategoryLabel(input)
  if (!trimmed) return ''
  const lower = trimmed.toLowerCase()
  for (const token of tokens) {
    if (token.id === excludeTokenId) continue
    const existing = token.category.trim()
    if (existing && existing.toLowerCase() === lower) return existing
  }
  return trimmed
}

function nextOrder(items: Array<{ order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1
}

function uniqueColorSlug(
  tokens: FrameworkColorToken[],
  desiredSlug: string,
  excludeTokenId?: string,
): string {
  const base = normalizeFrameworkColorSlug(desiredSlug)
  const existing = new Set(
    tokens
      .filter((token) => token.id !== excludeTokenId)
      .map((token) => normalizeFrameworkColorSlug(token.slug)),
  )
  if (!existing.has(base)) return base

  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) {
    suffix += 1
  }
  return `${base}-${suffix}`
}

function createFrameworkColorTokenFromInput(
  input: CreateFrameworkColorTokenInput,
  colors: NonNullable<SiteSettings['framework']>['colors'],
): FrameworkColorToken {
  const now = Date.now()
  const lightValue = input.lightValue.trim()
  return {
    id: nanoid(),
    category: canonicalizeCategoryLabel(input.category, colors.tokens),
    slug: uniqueColorSlug(colors.tokens, input.slug),
    lightValue,
    darkValue: input.darkValue?.trim() || generateDefaultDarkColor(lightValue),
    darkModeEnabled: input.darkModeEnabled ?? false,
    generateUtilities: {
      ...DEFAULT_COLOR_UTILITIES,
      ...(input.generateUtilities ?? {}),
    },
    generateTransparent: input.generateTransparent ?? true,
    generateShades: {
      ...DEFAULT_COLOR_VARIANTS,
      ...(input.generateShades ?? {}),
    },
    generateTints: {
      ...DEFAULT_COLOR_VARIANTS,
      ...(input.generateTints ?? {}),
    },
    order: nextOrder(colors.tokens),
    createdAt: now,
    updatedAt: now,
  }
}

function applyFrameworkColorTokenPatch(
  token: FrameworkColorToken,
  patch: UpdateFrameworkColorTokenPatch,
  colors: NonNullable<SiteSettings['framework']>['colors'],
): void {
  if (patch.category !== undefined) {
    token.category = canonicalizeCategoryLabel(patch.category, colors.tokens, token.id)
  }
  if (patch.slug !== undefined) token.slug = uniqueColorSlug(colors.tokens, patch.slug, token.id)
  if (patch.lightValue !== undefined) token.lightValue = patch.lightValue.trim()
  if (patch.darkValue !== undefined) token.darkValue = patch.darkValue.trim()
  if (patch.darkModeEnabled !== undefined) {
    token.darkModeEnabled = patch.darkModeEnabled
    if (patch.darkModeEnabled && !patch.darkValue && !token.darkValue) {
      token.darkValue = generateDefaultDarkColor(token.lightValue)
    }
  }
  if (patch.generateUtilities) {
    token.generateUtilities = {
      ...token.generateUtilities,
      ...patch.generateUtilities,
    }
  }
  if (patch.generateTransparent !== undefined) token.generateTransparent = patch.generateTransparent
  if (patch.generateShades) {
    token.generateShades = { ...token.generateShades, ...patch.generateShades }
  }
  if (patch.generateTints) {
    token.generateTints = { ...token.generateTints, ...patch.generateTints }
  }
  if (patch.order !== undefined) token.order = patch.order
  token.updatedAt = Date.now()
}

function cloneFrameworkColorToken(
  token: FrameworkColorToken,
  colors: NonNullable<SiteSettings['framework']>['colors'],
): FrameworkColorToken {
  const now = Date.now()
  return {
    ...structuredClone(token),
    id: nanoid(),
    slug: uniqueColorSlug(colors.tokens, `${token.slug}-copy`),
    order: nextOrder(colors.tokens),
    createdAt: now,
    updatedAt: now,
  }
}

function reorderFrameworkColorTokenInGroup(
  colors: NonNullable<SiteSettings['framework']>['colors'],
  tokenId: string,
  direction: 'up' | 'down',
): void {
  const token = colors.tokens.find((candidate) => candidate.id === tokenId)
  if (!token) return

  const group = colors.tokens
    .filter((candidate) => candidate.category === token.category)
    .sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug))
  const currentIndex = group.findIndex((candidate) => candidate.id === tokenId)
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= group.length) return

  const orderValues = group.map((candidate) => candidate.order).sort((a, b) => a - b)
  const reordered = [...group]
  const [moved] = reordered.splice(currentIndex, 1)
  reordered.splice(targetIndex, 0, moved)

  for (let index = 0; index < reordered.length; index += 1) {
    reordered[index].order = orderValues[index] ?? index
    reordered[index].updatedAt = Date.now()
  }
}

// ---------------------------------------------------------------------------
// Framework class reconciliation
//
// Three families (color, typography, spacing) each generate a deterministic
// set of locked utility classes (`text-primary`, `bg-primary-l-2`, `text-xs`,
// `padding-md`, etc.) keyed by stable framework IDs of the form
// `framework:<family>:<...>`.
//
// Reconciliation rules:
//   1. CLAIM — any non-framework class whose name collides with a framework
//      class is replaced by the framework version. Existing
//      assignments are remapped to the framework ID and the colliding class
//      is deleted. This keeps the lock invariant: a framework name is always
//      backed by the framework class, never by a leftover class with the
//      same name (which would silently lose the locked state and badge).
//   2. PRUNE — every class whose ID lives in the framework namespace but is
//      not in the desired set is deleted and stripped
//      from every assignment list. Detection is by ID prefix, not by
//      `generated` metadata, so orphans whose metadata was somehow lost
//      in a prior round-trip are still cleaned up — no leftover "ghost"
//      classes that look editable because their lock marker disappeared.
//   3. UPSERT — desired framework classes are written, preserving the
//      previously-recorded createdAt timestamp when the same ID already
//      existed (so timestamps don't churn on every reconcile).
// ---------------------------------------------------------------------------

const FRAMEWORK_ID_PREFIX = 'framework:'

/**
 * Visit every node-like value in the site that holds a `classIds: string[]`
 * list and let `mutator` produce a new list. Covers Page nodes, the
 * VisualComponent itself, and every VCNode in the VC's flat tree.nodes map.
 */
function mutateAllClassIdLists(
  site: SiteDocument,
  mutator: (classIds: string[]) => string[],
): void {
  const apply = (target: { classIds?: string[] }) => {
    if (!target.classIds) return
    target.classIds = mutator(target.classIds)
  }

  for (const page of site.pages) {
    for (const node of Object.values(page.nodes)) apply(node)
  }

  for (const vc of site.visualComponents) {
    apply(vc as { classIds?: string[] })
    for (const node of Object.values(vc.tree.nodes)) apply(node)
  }
}

function pruneClassIdFromSite(site: SiteDocument, classId: string): void {
  mutateAllClassIdLists(site, (ids) =>
    ids.includes(classId) ? ids.filter((id) => id !== classId) : ids,
  )
}

function remapClassIdInSite(
  site: SiteDocument,
  fromId: string,
  toId: string,
): void {
  mutateAllClassIdLists(site, (ids) => {
    if (!ids.includes(fromId)) return ids
    const seen = new Set<string>()
    const out: string[] = []
    for (const id of ids) {
      const next = id === fromId ? toId : id
      if (seen.has(next)) continue
      seen.add(next)
      out.push(next)
    }
    return out
  })
}

function reconcileFrameworkClasses(site: SiteDocument): void {
  reconcileFrameworkClassRegistry(site, generateFrameworkUtilityClasses(site.settings.framework))
}

function reconcileFrameworkClassRegistry(
  site: SiteDocument,
  nextClasses: Record<string, CSSClass>,
): void {
  const nextClassIds = new Set(Object.keys(nextClasses))
  const frameworkIdByName = new Map<string, string>()
  for (const [classId, cls] of Object.entries(nextClasses)) {
    frameworkIdByName.set(cls.name, classId)
  }

  // 1. CLAIM — replace non-framework classes whose name collides with a
  //    framework class. Node-scoped classes (module-style
  //    instance layers) are off-limits; their names live in a different
  //    namespace.
  for (const [classId, cls] of Object.entries(site.classes)) {
    if (cls.scope) continue
    if (classId.startsWith(FRAMEWORK_ID_PREFIX)) continue
    const frameworkId = frameworkIdByName.get(cls.name)
    if (!frameworkId) continue
    remapClassIdInSite(site, classId, frameworkId)
    delete site.classes[classId]
  }

  // 2. PRUNE — delete every class whose ID lives in the framework namespace
  //    but isn't in the desired set. Recognising by ID prefix
  //    means orphans whose `generated` metadata was lost (e.g. through a
  //    prior persistence round-trip) are still cleaned up rather than
  //    silently downgraded into editable user classes.
  for (const classId of Object.keys(site.classes)) {
    if (!classId.startsWith(FRAMEWORK_ID_PREFIX)) continue
    if (nextClassIds.has(classId)) continue
    delete site.classes[classId]
    pruneClassIdFromSite(site, classId)
  }

  // 3. UPSERT — write the desired classes, preserving prior createdAt.
  for (const [classId, nextClass] of Object.entries(nextClasses)) {
    const existing = site.classes[classId]
    site.classes[classId] = {
      ...nextClass,
      createdAt: existing?.createdAt ?? nextClass.createdAt,
    }
  }
}

function ensureFrameworkTypography(
  site: SiteDocument,
): NonNullable<NonNullable<SiteSettings['framework']>['typography']> {
  if (!site.settings.framework) {
    site.settings.framework = { colors: { tokens: [] } }
  }
  if (!site.settings.framework.typography) {
    site.settings.framework.typography = { groups: [], classes: [] }
  }
  site.settings.framework.typography.groups ??= []
  site.settings.framework.typography.classes ??= []
  return site.settings.framework.typography
}

function ensureFrameworkSpacing(
  site: SiteDocument,
): NonNullable<NonNullable<SiteSettings['framework']>['spacing']> {
  if (!site.settings.framework) {
    site.settings.framework = { colors: { tokens: [] } }
  }
  if (!site.settings.framework.spacing) {
    site.settings.framework.spacing = { groups: [], classes: [] }
  }
  site.settings.framework.spacing.groups ??= []
  site.settings.framework.spacing.classes ??= []
  return site.settings.framework.spacing
}

function nextOrderValue(items: Array<{ order: number }>): number {
  return items.reduce((max, item) => Math.max(max, item.order), -1) + 1
}

function applyFrameworkTypographyGroupPatch(
  group: FrameworkTypographyGroup,
  patch: UpdateFrameworkTypographyGroupPatch,
): void {
  if (patch.name !== undefined) group.name = patch.name
  if (patch.namingConvention !== undefined) group.namingConvention = patch.namingConvention
  if (patch.steps !== undefined) group.steps = patch.steps
  if (patch.baseScaleIndex !== undefined) group.baseScaleIndex = patch.baseScaleIndex
  if (patch.mode !== undefined) group.mode = patch.mode
  if (patch.isDisabled !== undefined) group.isDisabled = patch.isDisabled
  if (patch.min) group.min = { ...group.min, ...patch.min }
  if (patch.max) group.max = { ...group.max, ...patch.max }
  if (patch.manualSizes !== undefined) group.manualSizes = patch.manualSizes
  group.updatedAt = Date.now()
}

function applyFrameworkSpacingGroupPatch(
  group: FrameworkSpacingGroup,
  patch: UpdateFrameworkSpacingGroupPatch,
): void {
  if (patch.name !== undefined) group.name = patch.name
  if (patch.namingConvention !== undefined) group.namingConvention = patch.namingConvention
  if (patch.steps !== undefined) group.steps = patch.steps
  if (patch.baseScaleIndex !== undefined) group.baseScaleIndex = patch.baseScaleIndex
  if (patch.mode !== undefined) group.mode = patch.mode
  if (patch.isDisabled !== undefined) group.isDisabled = patch.isDisabled
  if (patch.min) group.min = { ...group.min, ...patch.min }
  if (patch.max) group.max = { ...group.max, ...patch.max }
  if (patch.manualSizes !== undefined) group.manualSizes = patch.manualSizes
  group.updatedAt = Date.now()
}


// Contribute this slice's fields to the combined `EditorStore` type via TS
// module augmentation. See `../types.ts` for why we use this pattern.
declare module '@core/editor-store/types' {
  interface EditorStore extends SiteSlice {}
}

export const createSiteSlice: EditorStoreSliceCreator<SiteSlice> = (set, get) => {
  // ---------------------------------------------------------------------------
  // Internal helpers — note: these use `get()` before calling set() so they
  // can snapshot the current site for history.
  // ---------------------------------------------------------------------------

  /** Snapshot current site into undo history, then clear redo stack. */
  function pushHistory(): void {
    const { site } = get()
    if (!site) return
    set((state) => {
      const snapshot = structuredClone(site)
      state._historyPast.push(snapshot)
      if (state._historyPast.length > MAX_HISTORY) {
        state._historyPast.shift() // evict oldest
      }
      state._historyFuture = []
      state.canUndo = true
      state.canRedo = false
    })
  }

  /** Mutate the active page — auto-snapshots history first. */
  function mutatePage(fn: (page: Page) => void): void {
    pushHistory()
    set((state) => {
      if (!state.site) return
      const page = state.site.pages.find((p) => p.id === state.activePageId)
      if (!page) return
      fn(page)
      state.site.updatedAt = Date.now()
      state.hasUnsavedChanges = true
    })
  }

  /**
   * Mutate the active node tree — auto-snapshots history first.
   *
   * Routes to the correct tree based on `activeDocument`:
   *   - Page mode (null or kind === 'page'): passes the active Page directly —
   *     Page IS NodeTree<PageNode> so no conversion needed.
   *   - VC mode (kind === 'visualComponent'): passes vc.tree directly —
   *     VCNode (= BaseNode) is structurally compatible with PageNode (which only
   *     adds optional `dynamicBindings`), so the cast is safe for all tree
   *     mutations that operate on BaseNode-level fields.
   *     After the mutation, propagates any change in the VC's slot-outlet set
   *     to every consumer VC ref across all pages via `syncSlotInstances`.
   *     This is what makes adding a `base.slot-outlet` to a VC automatically
   *     materialize a `base.slot-instance` child on every consumer.
   */
  function mutateActiveTree(fn: (tree: NodeTree<PageNode>) => void): void {
    pushHistory()
    set((state) => {
      if (!state.site) return
      const { activeDocument } = state

      if (activeDocument?.kind === 'visualComponent') {
        const vc = state.site.visualComponents.find((v) => v.id === activeDocument.vcId)
        if (!vc) return
        // VCNode is structurally compatible with PageNode (dynamicBindings is optional).
        // All tree mutations operate on BaseNode-level fields, so the cast is safe.
        fn(vc.tree as NodeTree<PageNode>)
        state.site.updatedAt = Date.now()
        state.hasUnsavedChanges = true

        // Propagate slot-outlet changes to every consumer VC ref. Idempotent
        // when the slot-outlet set is unchanged. Cheap: O(pages × refs × tree
        // size); for non-trivial sites still well below a frame budget.
        reconcileVCRefsForVc(state, vc.id)
        return
      }

      // Page mode (activeDocument is null or kind === 'page').
      // Page IS NodeTree<PageNode> — pass directly, no conversion needed.
      const pageId = activeDocument?.kind === 'page' ? activeDocument.pageId : state.activePageId
      const page = state.site.pages.find((p) => p.id === pageId)
      if (!page) return
      fn(page)
      state.site.updatedAt = Date.now()
      state.hasUnsavedChanges = true
    })
  }

  /**
   * Walk every page's tree, find every `base.visual-component-ref` that points
   * at the given vcId, and run `syncSlotInstances` on each so its slot-instance
   * children match the VC's current set of slot-outlets.
   *
   * MUST be called inside an Immer producer (operates on draft state).
   */
  function reconcileVCRefsForVc(
    state: { site: SiteDocument | null },
    vcId: string,
  ): void {
    if (!state.site) return
    const vc = state.site.visualComponents.find((v) => v.id === vcId)
    if (!vc) return

    for (const page of state.site.pages) {
      const treeNodes = page.nodes as Record<string, BaseNode>
      // Snapshot ids first — applySlotSyncResult mutates the map.
      const refIds = Object.keys(treeNodes).filter((id) => {
        const n = treeNodes[id]
        return (
          n?.moduleId === 'base.visual-component-ref' &&
          (n.props as Record<string, unknown>).componentId === vcId
        )
      })
      for (const refId of refIds) {
        const refNode = treeNodes[refId]
        if (!refNode) continue
        const syncResult = syncSlotInstances(refNode, vc, treeNodes)
        applySlotSyncResult(treeNodes, syncResult, refId)
      }
    }
  }

  /** Mutate the site — auto-snapshots history first. */
  function mutateSite(fn: (site: SiteDocument) => void): void {
    pushHistory()
    set((state) => {
      if (!state.site) return
      fn(state.site)
      state.site.updatedAt = Date.now()
      state.hasUnsavedChanges = true
    })
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
      set((state) => {
        state._historyPast.pop()
        state._historyFuture.push(structuredClone(site))
        const packageJson = clonePackageJson(previous.packageJson)
        const siteRuntime = cloneSiteRuntimeConfig(previous.runtime)
        state.site = { ...previous, packageJson, runtime: siteRuntime }
        state.packageJson = packageJson
        state.siteRuntime = siteRuntime
        state.canUndo = state._historyPast.length > 0
        state.canRedo = true
        state.hasUnsavedChanges = true
        // Keep activePageId valid
        if (!state.site.pages.find((p) => p.id === state.activePageId)) {
          state.activePageId = state.site.pages[0]?.id ?? null
        }
      })
    },

    redo: () => {
      const { _historyFuture, site } = get()
      if (_historyFuture.length === 0 || !site) return
      const next = _historyFuture[_historyFuture.length - 1]
      set((state) => {
        state._historyFuture.pop()
        state._historyPast.push(structuredClone(site))
        const packageJson = clonePackageJson(next.packageJson)
        const siteRuntime = cloneSiteRuntimeConfig(next.runtime)
        state.site = { ...next, packageJson, runtime: siteRuntime }
        state.packageJson = packageJson
        state.siteRuntime = siteRuntime
        state.canUndo = true
        state.canRedo = state._historyFuture.length > 0
        state.hasUnsavedChanges = true
        // Keep activePageId valid
        if (!state.site.pages.find((p) => p.id === state.activePageId)) {
          state.activePageId = state.site.pages[0]?.id ?? null
        }
      })
    },

    // ─── SiteDocument lifecycle ────────────────────────────────────────────────────
    createSite: (name) => {
      const site = createDefaultSiteDocument(name)
      const siteRuntime = cloneSiteRuntimeConfig(site.runtime)
      set({
        site: { ...site, runtime: siteRuntime },
        packageJson: clonePackageJson(site.packageJson),
        siteRuntime,
        activePageId: site.pages[0].id,
        // Reset activeDocument — any previously-open VC reference belongs to
        // the prior site and would cause `mutateActiveTree` to silently no-op
        // (early-return) when the VC id is not present in the new site.
        activeDocument: null,
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
      reconcileFrameworkClasses(site)
      const packageJson = clonePackageJson(site.packageJson)
      const siteRuntime = cloneSiteRuntimeConfig(site.runtime)
      set({
        site: { ...site, packageJson, runtime: siteRuntime },
        packageJson,
        siteRuntime,
        activePageId: site.pages[0]?.id ?? null,
        // Reset activeDocument — see createSite for rationale.
        activeDocument: null,
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
        siteRuntime: cloneSiteRuntimeConfig(DEFAULT_SITE_RUNTIME),
        activePageId: null,
        // Reset activeDocument — without a site there can be no active doc.
        activeDocument: null,
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

    duplicatePage: (sourcePageId, title, slug) => {
      let newPage!: Page
      mutateSite((p) => {
        newPage = duplicatePage(p, sourcePageId, title, slug)
      })
      return newPage
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
          delete node.dynamicBindings
        }
      })
    },

    // ─── Node mutations ───────────────────────────────────────────────────────
    insertNode: (moduleId, defaults, parentId, index) => {
      const mod = registry.get(moduleId)
      const resolvedDefaults = { ...(mod?.defaults ?? {}), ...defaults }
      const newNode = createNode(moduleId, resolvedDefaults)
      mutateActiveTree((tree) => insertNode(tree, newNode, parentId, index))
      return newNode.id
    },

    insertComponentRef: (parentId, componentId) => {
      if (!componentId) return null

      const { activeDocument, site } = get()

      // In VC mode, guard against cyclic component references before insertion.
      if (activeDocument?.kind === 'visualComponent' && site) {
        if (wouldCreateCycle(site.visualComponents, activeDocument.vcId, componentId)) {
          console.warn('[component-system] cycle prevented by recursion guard')
          return null
        }
      }

      // Insert the VC ref node (no props beyond componentId + propOverrides).
      const refNodeId = get().insertNode(
        'base.visual-component-ref',
        { componentId, propOverrides: {} },
        parentId,
      )

      // Immediately materialize slot-instance children for each slot param the VC declares.
      // `insertNode` → `mutateActiveTree` already pushed history; we mutate inside another
      // set() call here to keep the slot-instance insertion as part of the same logical action.
      const currentSite = get().site
      const vc = currentSite?.visualComponents.find((v) => v.id === componentId)
      if (vc) {
        set((state) => {
          if (!state.site) return
          const { activeDocument: ad } = state

          type NodeMap = Record<string, import('@core/page-tree/baseNode').BaseNode>
          const treeNodes: NodeMap | null = (() => {
            if (ad?.kind === 'visualComponent') {
              const activeVc = state.site!.visualComponents.find((v) => v.id === ad.vcId)
              return activeVc ? (activeVc.tree.nodes as NodeMap) : null
            }
            const pageId = ad?.kind === 'page' ? ad.pageId : state.activePageId
            const page = state.site!.pages.find((p) => p.id === pageId)
            return page ? (page.nodes as NodeMap) : null
          })()

          if (!treeNodes) return

          const vcRefNode = treeNodes[refNodeId]
          if (!vcRefNode) return

          const syncResult = syncSlotInstances(vcRefNode, vc, treeNodes)
          applySlotSyncResult(treeNodes, syncResult, refNodeId)
          state.site.updatedAt = Date.now()
        })
      }

      return refNodeId
    },

    deleteNode: (nodeId) => {
      mutateActiveTree((tree) => deleteNode(tree, nodeId))
      if (get().selectedNodeId === nodeId) set({ selectedNodeId: null })
    },

    updateNodeProps: (nodeId, patch) => {
      mutateActiveTree((tree) => updateNodeProps(tree, nodeId, patch))
    },

    setBreakpointOverride: (nodeId, breakpointId, patch) => {
      mutateActiveTree((tree) => setBreakpointOverride(tree, nodeId, breakpointId, patch))
    },

    clearBreakpointOverride: (nodeId, breakpointId) => {
      mutateActiveTree((tree) => clearBreakpointOverride(tree, nodeId, breakpointId))
    },

    renameNode: (nodeId, label) => {
      mutateActiveTree((tree) => renameNode(tree, nodeId, label))
    },

    toggleNodeLocked: (nodeId) => {
      mutateActiveTree((tree) => toggleNodeLocked(tree, nodeId))
    },

    toggleNodeHidden: (nodeId) => {
      mutateActiveTree((tree) => toggleNodeHidden(tree, nodeId))
    },

    moveNode: (nodeId, newParentId, newIndex) => {
      mutateActiveTree((tree) => moveNode(tree, nodeId, newParentId, newIndex))
    },

    moveNodes: (nodeIds, newParentId, newIndex) => {
      if (nodeIds.length === 0) return
      mutateActiveTree((tree) => moveNodes(tree, nodeIds, newParentId, newIndex))
    },

    duplicateNode: (nodeId) => {
      let newId = ''
      mutateActiveTree((tree) => { newId = duplicateNode(tree, nodeId) })
      return newId
    },

    duplicateNodes: (nodeIds) => {
      if (nodeIds.length === 0) return []
      const newIds: string[] = []
      mutateActiveTree((tree) => {
        for (const id of nodeIds) {
          // Skip the root and any id missing from the tree — duplicateNode
          // throws on the root, and silently skipping orphans matches the
          // delete/move guards.
          if (!tree.nodes[id] || id === tree.rootNodeId) continue
          newIds.push(duplicateNode(tree, id))
        }
      })
      return newIds
    },

    deleteNodes: (nodeIds) => {
      if (nodeIds.length === 0) return
      mutateActiveTree((tree) => {
        // Delete each id; descendants of an already-deleted id are gone, so the
        // helper's "node not found" branch handles the redundant case cleanly.
        // We sort by depth-DESC so leaves go first, avoiding noisy throws when
        // a parent is deleted before its child in the same batch.
        const ordered = [...nodeIds].sort(
          (a, b) => depthInTree(tree, b) - depthInTree(tree, a),
        )
        for (const id of ordered) {
          if (id === tree.rootNodeId) continue
          if (!tree.nodes[id]) continue
          deleteNode(tree, id)
        }
      })
    },

    wrapNode: (nodeId, containerModuleId, defaults = {}) => {
      // Auto-resolve the module's schema defaults so the wrapper node renders correctly.
      // Without this, wrapNode(id, 'base.container') produces props:{} → props.tag=undefined
      // → React.createElement(undefined) → "Element type is invalid" crash (Task #414).
      const mod = registry.get(containerModuleId)
      const resolvedDefaults = { ...(mod?.defaults ?? {}), ...defaults }
      let wrapperId = ''
      mutateActiveTree((tree) => { wrapperId = wrapNode(tree, nodeId, containerModuleId, resolvedDefaults) })
      return wrapperId
    },

    wrapNodes: (nodeIds, containerModuleId, defaults = {}) => {
      if (nodeIds.length === 0) return null
      // Same defaults-resolution rule as `wrapNode` (Task #414 — defaults must
      // come from the module registry so the wrapper renders).
      const mod = registry.get(containerModuleId)
      const resolvedDefaults = { ...(mod?.defaults ?? {}), ...defaults }
      let wrapperId: string | null = null
      mutateActiveTree((tree) => {
        wrapperId = wrapNodes(tree, nodeIds, containerModuleId, resolvedDefaults)
      })
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

    createFrameworkColorToken: (input) => {
      const { site } = get()
      if (!site) throw new Error('[siteSlice] Site document is not initialized')
      // Read-only view of the (Immer-frozen) live site — `ensureFrameworkColors`
      // mutates and would throw on the frozen object. The actual write happens
      // inside `mutateSite` below where Immer's draft is mutable.
      const colors = site.settings.framework?.colors ?? { tokens: [] }
      const token = createFrameworkColorTokenFromInput(input, colors)

      mutateSite((draftSite) => {
        const draftColors = ensureFrameworkColors(draftSite)
        draftColors.tokens.push(token)
        reconcileFrameworkClasses(draftSite)
      })

      return token
    },

    updateFrameworkColorToken: (tokenId, patch) => {
      mutateSite((site) => {
        const colors = ensureFrameworkColors(site)
        const token = colors.tokens.find((candidate) => candidate.id === tokenId)
        if (!token) return
        applyFrameworkColorTokenPatch(token, patch, colors)
        reconcileFrameworkClasses(site)
      })
    },

    duplicateFrameworkColorToken: (tokenId) => {
      const { site } = get()
      if (!site) return null
      // Read-only view of the (Immer-frozen) live site — see note in
      // `createFrameworkColorToken` for why we don't call `ensureFrameworkColors`
      // here. The actual write happens inside `mutateSite` below.
      const colors = site.settings.framework?.colors ?? { tokens: [] }
      const token = colors.tokens.find((candidate) => candidate.id === tokenId)
      if (!token) return null
      const copy = cloneFrameworkColorToken(token, colors)

      mutateSite((draftSite) => {
        const draftColors = ensureFrameworkColors(draftSite)
        draftColors.tokens.push(copy)
        reconcileFrameworkClasses(draftSite)
      })

      return copy
    },

    reorderFrameworkColorToken: (tokenId, direction) => {
      mutateSite((site) => {
        const colors = ensureFrameworkColors(site)
        reorderFrameworkColorTokenInGroup(colors, tokenId, direction)
        reconcileFrameworkClasses(site)
      })
    },

    deleteFrameworkColorToken: (tokenId) => {
      mutateSite((site) => {
        const colors = ensureFrameworkColors(site)
        colors.tokens = colors.tokens.filter((token) => token.id !== tokenId)
        reconcileFrameworkClasses(site)
      })
    },

    previewFrameworkChange: (applyChange) => {
      const { site } = get()
      if (!site) return null
      const draft = structuredClone(site)
      applyChange(draft)
      reconcileFrameworkClasses(draft)
      return previewFrameworkClassRemovals(site, draft)
    },

    // ─── Framework preferences ───────────────────────────────────────────────
    updateFrameworkPreferences: (patch) => {
      mutateSite((site) => {
        if (!site.settings.framework) {
          site.settings.framework = { colors: { tokens: [] } }
        }
        const current = site.settings.framework.preferences ?? DEFAULT_FRAMEWORK_PREFERENCES
        site.settings.framework.preferences = { ...current, ...patch }
      })
    },

    // ─── Framework typography ───────────────────────────────────────────────
    toggleFrameworkTypographyDisabled: () => {
      mutateSite((site) => {
        const typography = ensureFrameworkTypography(site)
        typography.isDisabled = !typography.isDisabled
        reconcileFrameworkClasses(site)
      })
    },

    createFrameworkTypographyGroup: () => {
      const { site } = get()
      if (!site) throw new Error('[siteSlice] Site document is not initialized')
      // Read-only view of the (Immer-frozen) live site — `ensureFrameworkTypography`
      // mutates and would throw on the frozen object when typography (or framework)
      // is absent. The actual write happens inside `mutateSite` below.
      const groups = site.settings.framework?.typography?.groups ?? []
      const { name, varName } = nextTypographyTabValues(groups)
      const order = nextOrderValue(groups)
      const group = makeFreshTypographyGroup(name, varName, order)

      mutateSite((draftSite) => {
        const draftTypography = ensureFrameworkTypography(draftSite)
        draftTypography.groups.push(group)
        reconcileFrameworkClasses(draftSite)
      })
      return group
    },

    updateFrameworkTypographyGroup: (groupId, patch) => {
      mutateSite((site) => {
        const typography = ensureFrameworkTypography(site)
        const group = typography.groups.find((g) => g.id === groupId)
        if (!group) return
        applyFrameworkTypographyGroupPatch(group, patch)
        reconcileFrameworkClasses(site)
      })
    },

    duplicateFrameworkTypographyGroup: (groupId) => {
      const { site } = get()
      if (!site) return null
      // Read-only view of the (Immer-frozen) live site — see note in
      // `createFrameworkTypographyGroup`. The actual write is inside `mutateSite`.
      const groups = site.settings.framework?.typography?.groups ?? []
      const source = groups.find((g) => g.id === groupId)
      if (!source) return null

      const { name, varName } = nextTypographyTabValues(groups)
      const order = nextOrderValue(groups)
      const now = Date.now()
      const copy: FrameworkTypographyGroup = {
        ...structuredClone(source),
        id: nanoid(),
        name,
        namingConvention: varName,
        manualSizes: source.manualSizes?.map((m) => ({
          ...m,
          id: nanoid(),
          name: m.name.replace(source.namingConvention, varName),
        })),
        order,
        createdAt: now,
        updatedAt: now,
      }

      mutateSite((draftSite) => {
        const draftTypography = ensureFrameworkTypography(draftSite)
        draftTypography.groups.push(copy)
        reconcileFrameworkClasses(draftSite)
      })
      return copy
    },

    resetFrameworkTypographyGroup: (groupId) => {
      mutateSite((site) => {
        const typography = ensureFrameworkTypography(site)
        const idx = typography.groups.findIndex((g) => g.id === groupId)
        if (idx < 0) return
        const order = typography.groups[idx].order
        typography.groups[idx] = { ...buildDefaultTypographyGroup(order), id: groupId }
        reconcileFrameworkClasses(site)
      })
    },

    deleteFrameworkTypographyGroup: (groupId) => {
      mutateSite((site) => {
        const typography = ensureFrameworkTypography(site)
        typography.groups = typography.groups.filter((g) => g.id !== groupId)
        typography.classes = typography.classes?.filter((c) => c.tabId !== groupId) ?? []
        reconcileFrameworkClasses(site)
      })
    },

    upsertFrameworkTypographyManualSize: (groupId, sizeId, patch) => {
      mutateSite((site) => {
        const typography = ensureFrameworkTypography(site)
        const group = typography.groups.find((g) => g.id === groupId)
        if (!group) return
        group.manualSizes ??= []
        const idx = group.manualSizes.findIndex((m) => m.id === sizeId)
        if (idx < 0) {
          if (typeof patch.name !== 'string' || patch.min === undefined || patch.max === undefined) return
          group.manualSizes.push({
            id: sizeId,
            name: patch.name,
            min: patch.min,
            max: patch.max,
          })
        } else {
          group.manualSizes[idx] = { ...group.manualSizes[idx], ...patch }
        }
        group.updatedAt = Date.now()
        reconcileFrameworkClasses(site)
      })
    },

    setFrameworkTypographyClassGenerators: (classes) => {
      mutateSite((site) => {
        const typography = ensureFrameworkTypography(site)
        typography.classes = classes
        reconcileFrameworkClasses(site)
      })
    },

    // ─── Site fonts library ─────────────────────────────────────────────
    addFont: (entry) => {
      mutateSite((site) => {
        site.settings.fonts ??= { items: [] }
        const lib = site.settings.fonts
        const familyLower = entry.family.toLowerCase()
        const idx = lib.items.findIndex(
          (f) => f.family.toLowerCase() === familyLower && f.source === entry.source,
        )
        if (idx >= 0) {
          // Re-install of the same font: replace the existing entry so newly
          // selected variants/subsets supersede the previous selection.
          lib.items[idx] = { ...entry, updatedAt: Date.now() }
        } else {
          lib.items.push(entry)
        }
      })
    },

    removeFont: (fontId) => {
      mutateSite((site) => {
        if (!site.settings.fonts) return
        site.settings.fonts.items = site.settings.fonts.items.filter((f) => f.id !== fontId)
      })
    },

    // ─── Framework spacing ───────────────────────────────────────────────
    toggleFrameworkSpacingDisabled: () => {
      mutateSite((site) => {
        const spacing = ensureFrameworkSpacing(site)
        spacing.isDisabled = !spacing.isDisabled
        reconcileFrameworkClasses(site)
      })
    },

    createFrameworkSpacingGroup: () => {
      const { site } = get()
      if (!site) throw new Error('[siteSlice] Site document is not initialized')
      // Read-only view of the (Immer-frozen) live site — `ensureFrameworkSpacing`
      // mutates and would throw on the frozen object when spacing (or framework)
      // is absent. The actual write happens inside `mutateSite` below.
      const groups = site.settings.framework?.spacing?.groups ?? []
      const { name, varName } = nextSpacingTabValues(groups)
      const order = nextOrderValue(groups)
      const group = makeFreshSpacingGroup(name, varName, order)

      mutateSite((draftSite) => {
        const draftSpacing = ensureFrameworkSpacing(draftSite)
        draftSpacing.groups.push(group)
        reconcileFrameworkClasses(draftSite)
      })
      return group
    },

    updateFrameworkSpacingGroup: (groupId, patch) => {
      mutateSite((site) => {
        const spacing = ensureFrameworkSpacing(site)
        const group = spacing.groups.find((g) => g.id === groupId)
        if (!group) return
        applyFrameworkSpacingGroupPatch(group, patch)
        reconcileFrameworkClasses(site)
      })
    },

    duplicateFrameworkSpacingGroup: (groupId) => {
      const { site } = get()
      if (!site) return null
      // Read-only view of the (Immer-frozen) live site — see note in
      // `createFrameworkSpacingGroup`. The actual write is inside `mutateSite`.
      const groups = site.settings.framework?.spacing?.groups ?? []
      const source = groups.find((g) => g.id === groupId)
      if (!source) return null

      const { name, varName } = nextSpacingTabValues(groups)
      const order = nextOrderValue(groups)
      const now = Date.now()
      const copy: FrameworkSpacingGroup = {
        ...structuredClone(source),
        id: nanoid(),
        name,
        namingConvention: varName,
        manualSizes: source.manualSizes?.map((m) => ({
          ...m,
          id: nanoid(),
          name: m.name.replace(source.namingConvention, varName),
        })),
        order,
        createdAt: now,
        updatedAt: now,
      }

      mutateSite((draftSite) => {
        const draftSpacing = ensureFrameworkSpacing(draftSite)
        draftSpacing.groups.push(copy)
        reconcileFrameworkClasses(draftSite)
      })
      return copy
    },

    resetFrameworkSpacingGroup: (groupId) => {
      mutateSite((site) => {
        const spacing = ensureFrameworkSpacing(site)
        const idx = spacing.groups.findIndex((g) => g.id === groupId)
        if (idx < 0) return
        const order = spacing.groups[idx].order
        spacing.groups[idx] = { ...buildDefaultSpacingGroup(order), id: groupId }
        reconcileFrameworkClasses(site)
      })
    },

    deleteFrameworkSpacingGroup: (groupId) => {
      mutateSite((site) => {
        const spacing = ensureFrameworkSpacing(site)
        spacing.groups = spacing.groups.filter((g) => g.id !== groupId)
        spacing.classes = spacing.classes?.filter((c) => c.tabId !== groupId) ?? []
        reconcileFrameworkClasses(site)
      })
    },

    upsertFrameworkSpacingManualSize: (groupId, sizeId, patch) => {
      mutateSite((site) => {
        const spacing = ensureFrameworkSpacing(site)
        const group = spacing.groups.find((g) => g.id === groupId)
        if (!group) return
        group.manualSizes ??= []
        const idx = group.manualSizes.findIndex((m) => m.id === sizeId)
        if (idx < 0) {
          if (typeof patch.name !== 'string' || patch.min === undefined || patch.max === undefined) return
          group.manualSizes.push({
            id: sizeId,
            name: patch.name,
            min: patch.min,
            max: patch.max,
          })
        } else {
          group.manualSizes[idx] = { ...group.manualSizes[idx], ...patch }
        }
        group.updatedAt = Date.now()
        reconcileFrameworkClasses(site)
      })
    },

    setFrameworkSpacingClassGenerators: (classes) => {
      mutateSite((site) => {
        const spacing = ensureFrameworkSpacing(site)
        spacing.classes = classes
        reconcileFrameworkClasses(site)
      })
    },
  }
}

/**
 * Compute a node's depth in the active tree by walking up to root.
 * Used by `deleteNodes` to delete leaves before parents within a single batch
 * so descendants aren't double-removed (which would throw inside the helper).
 *
 * Returns 0 for the root, +Infinity for orphans (sorts last in DESC order →
 * effectively a no-op when the orphan slot is reached).
 */
function depthInTree(tree: NodeTree<PageNode>, nodeId: string): number {
  if (nodeId === tree.rootNodeId) return 0
  let current = nodeId
  let depth = 0
  const visited = new Set<string>()
  while (!visited.has(current)) {
    visited.add(current)
    const parent = Object.values(tree.nodes).find((n) => n.children.includes(current))
    if (!parent) return Infinity
    depth++
    if (parent.id === tree.rootNodeId) return depth
    current = parent.id
  }
  return depth
}
