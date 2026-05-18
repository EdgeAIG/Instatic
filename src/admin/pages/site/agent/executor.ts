/**
 * Browser-side executor for page-builder write tools.
 *
 * The Claude Agent SDK calls these tools server-side (see server/handlers/agent/tools.ts)
 * which emits a `toolRequest` stream event so the browser can apply the
 * mutation against the live editor store. The browser then POSTs the result
 * back to /admin/api/agent/tool-result; the server-side MCP tool handler returns
 * the result to the SDK and Claude continues the loop.
 *
 * No batch semantics, no rollback. Each tool call is its own atomic mutation
 * — successful mutations push history entries normally so Cmd+Z reverts them.
 * Failed tool calls return an error result; Claude reads the error in the
 * next turn and decides how to recover.
 *
 * Constraint #272 — every input is validated with TypeBox before dispatch.
 * Constraint #283/#286 — no Anthropic SDK imports here.
 * Constraint #299 — richtext props are sanitized via DOMPurify before storage.
 */

import { Type, type Static, parseValue } from '@core/utils/typeboxHelpers'
import type { EditorStore } from '@site/store/types'
import { registry } from '@core/module-engine/registry'
import { sanitizeRichtext, isRichtextPropKey } from '@core/sanitize'
import { getAgentStoreApi } from './storeRef'
import { captureAgentRenderSnapshot } from './renderEvidence'
import type { AgentActionResult, InsertTreeNode } from './types'

// Live access to the editor store. Routed through `./storeRef` so this module
// has no static import edge back into `editor-store/store.ts`.
const getStoreState = (): EditorStore => getAgentStoreApi<EditorStore>().getState()

// ---------------------------------------------------------------------------
// Per-tool TypeBox schemas
//
// Tool names and shapes mirror the AgentAction interfaces in ./types and the
// Zod schemas in server/handlers/agent/tools.ts. The server validates the input via
// the SDK's Zod gate before sending toolRequest; this second pass is defence-
// in-depth at the store boundary (Constraint #272).
// ---------------------------------------------------------------------------

const insertNodeSchema = Type.Object({
  moduleId: Type.String({ minLength: 1 }),
  parentId: Type.String({ minLength: 1 }),
  index: Type.Optional(Type.Integer({ minimum: 0 })),
  props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  classIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
})

const classStylePatchSchema = Type.Record(
  Type.String(),
  Type.Union([Type.String(), Type.Number()]),
)

const classBreakpointStylesSchema = Type.Record(
  Type.String({ minLength: 1 }),
  classStylePatchSchema,
)

const classDefinitionSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  styles: Type.Optional(classStylePatchSchema),
  breakpointStyles: Type.Optional(classBreakpointStylesSchema),
})

const insertTreeNodeSchema = Type.Recursive((Self) =>
  Type.Object({
    moduleId: Type.String({ minLength: 1 }),
    props: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    classIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    children: Type.Optional(Type.Array(Self)),
  }),
)

const insertTreeSchema = Type.Object({
  parentId: Type.String({ minLength: 1 }),
  index: Type.Optional(Type.Integer({ minimum: 0 })),
  classes: Type.Optional(Type.Array(classDefinitionSchema)),
  tree: insertTreeNodeSchema,
})

const deleteNodeSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
})

const updateNodePropsSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  breakpointId: Type.Optional(Type.String({ minLength: 1 })),
  patch: Type.Record(Type.String(), Type.Unknown()),
})

const moveNodeSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  newParentId: Type.String({ minLength: 1 }),
  newIndex: Type.Integer({ minimum: 0 }),
})

const renameNodeSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
})

const createClassSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  styles: Type.Optional(classStylePatchSchema),
  breakpointStyles: Type.Optional(classBreakpointStylesSchema),
})

const updateClassStylesSchema = Type.Object({
  classId: Type.String({ minLength: 1 }),
  breakpointId: Type.Optional(Type.String({ minLength: 1 })),
  patch: classStylePatchSchema,
})

const assignClassSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  classId: Type.String({ minLength: 1 }),
})

const removeClassSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  classId: Type.String({ minLength: 1 }),
})

const addPageSchema = Type.Object({
  title: Type.String({ minLength: 1 }),
  slug: Type.Optional(Type.String()),
})

const deletePageSchema = Type.Object({
  pageId: Type.String({ minLength: 1 }),
})

const renamePageSchema = Type.Object({
  pageId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  slug: Type.Optional(Type.String()),
})

const duplicatePageSchema = Type.Object({
  pageId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  slug: Type.Optional(Type.String()),
})

const duplicateNodeSchema = Type.Object({
  nodeId: Type.String({ minLength: 1 }),
  count: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
})

const renderSnapshotSchema = Type.Object({
  breakpointId: Type.Optional(Type.String({ minLength: 1 })),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a classId that may be either a real nanoid (checked first) or a
 * class name (fallback lookup). Returns the resolved ID string, or null if
 * no matching class is found.
 *
 * Lets Claude reference a class by name in tools that only accept a single
 * class identifier (assignClass/updateClassStyles/removeClass), without
 * needing to remember the generated nanoid from a previous createClass call.
 */
function resolveClassId(
  store: EditorStore,
  classIdOrName: string,
): string | null {
  const classes = store.site?.classes
  if (!classes) return null
  if (classes[classIdOrName]) return classIdOrName
  // Filter (not find) so we can detect ambiguity. Uniqueness is enforced at
  // createClass time in the class slice; this guard is defence-in-depth.
  const matches = Object.values(classes).filter((c) => c.name === classIdOrName)
  if (matches.length > 1) return null
  return matches[0]?.id ?? null
}

const EMPTY_TREE_CHILDREN: InsertTreeNode[] = []
const EMPTY_TREE_CLASS_IDS: string[] = []
const EMPTY_PROPS: Record<string, unknown> = {}
const EMPTY_CLASS_STYLES: Record<string, string | number> = {}
const EMPTY_BREAKPOINT_STYLES: Record<string, Record<string, string | number>> = {}

function resolveOrCreateClassId(
  store: EditorStore,
  classIdOrName: string,
  styles: Record<string, string | number> = {},
): string | null {
  const resolved = resolveClassId(store, classIdOrName)
  if (resolved) return resolved
  try {
    return store.createClass(classIdOrName, styles).id
  } catch {
    return null
  }
}

function resolveKnownClassIds(
  store: EditorStore,
  classIdsOrNames: string[],
): { classIds: string[]; missing: null } | { classIds: null; missing: string } {
  const resolved: string[] = []
  for (const classIdOrName of classIdsOrNames) {
    const classId = resolveClassId(store, classIdOrName)
    if (!classId) return { classIds: null, missing: classIdOrName }
    if (!resolved.includes(classId)) resolved.push(classId)
  }
  return { classIds: resolved, missing: null }
}

function ensureClassIdWithStyles(
  store: EditorStore,
  classIdOrName: string,
  styles: Record<string, string | number> = {},
  breakpointStyles: Record<string, Record<string, string | number>> = {},
): string | null {
  const breakpointError = validateBreakpointStyles(store, breakpointStyles)
  if (breakpointError) return null
  const classId = resolveOrCreateClassId(store, classIdOrName, styles)
  if (!classId) return null
  if (Object.keys(styles).length > 0) {
    store.updateClassStyles(classId, styles)
  }
  applyClassBreakpointStyles(store, classId, breakpointStyles)
  return classId
}

function validateBreakpointId(
  store: EditorStore,
  breakpointId: string,
): string | null {
  const site = store.site
  if (!site) return `Breakpoint not found: ${breakpointId}`
  return site.breakpoints.some((breakpoint) => breakpoint.id === breakpointId)
    ? null
    : `Breakpoint not found: ${breakpointId}`
}

function validateBreakpointStyles(
  store: EditorStore,
  breakpointStyles: Record<string, Record<string, string | number>>,
): string | null {
  for (const breakpointId of Object.keys(breakpointStyles)) {
    const error = validateBreakpointId(store, breakpointId)
    if (error) return error
  }
  return null
}

function applyClassBreakpointStyles(
  store: EditorStore,
  classId: string,
  breakpointStyles: Record<string, Record<string, string | number>>,
): void {
  for (const [breakpointId, styles] of Object.entries(breakpointStyles)) {
    if (Object.keys(styles).length > 0) {
      store.setClassBreakpointStyles(classId, breakpointId, styles)
    }
  }
}

function validateRegisteredModule(moduleId: string): string | null {
  const mod = registry.get(moduleId)
  if (!mod) return `Module not found: ${moduleId}`
  if (typeof mod.component !== 'function') return `Module component unavailable: ${moduleId}`
  return null
}

function validateTreeModules(node: InsertTreeNode): string | null {
  const moduleError = validateRegisteredModule(node.moduleId)
  if (moduleError) return moduleError
  for (const child of node.children ?? EMPTY_TREE_CHILDREN) {
    const childError = validateTreeModules(child)
    if (childError) return childError
  }
  return null
}

function sanitizeNodeProps(props: Record<string, unknown>): Record<string, unknown> {
  const sanitizedProps: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    sanitizedProps[key] = isRichtextPropKey(key) && typeof value === 'string'
      ? sanitizeRichtext(value)
      : value
  }
  return sanitizedProps
}

function ensureTreeClassIds(
  store: EditorStore,
  node: InsertTreeNode,
): string | null {
  const resolved = resolveKnownClassIds(store, node.classIds ?? EMPTY_TREE_CLASS_IDS)
  if (resolved.missing) return resolved.missing
  for (const child of node.children ?? EMPTY_TREE_CHILDREN) {
    const unresolved = ensureTreeClassIds(store, child)
    if (unresolved) return unresolved
  }
  return null
}

function insertTreeNode(
  store: EditorStore,
  node: InsertTreeNode,
  parentId: string,
  index: number | undefined,
): string {
  const nodeId = store.insertNode(
    node.moduleId,
    sanitizeNodeProps(node.props ?? EMPTY_PROPS),
    parentId,
    index,
  )

  const resolved = resolveKnownClassIds(store, node.classIds ?? EMPTY_TREE_CLASS_IDS)
  const classIds = resolved.classIds ?? EMPTY_TREE_CLASS_IDS
  for (const classId of classIds) {
    store.addNodeClass(nodeId, classId)
  }

  for (const child of node.children ?? EMPTY_TREE_CHILDREN) {
    insertTreeNode(store, child, nodeId, undefined)
  }

  return nodeId
}

// ---------------------------------------------------------------------------
// Per-tool implementations
// ---------------------------------------------------------------------------

function runInsertNode(input: Static<typeof insertNodeSchema>): AgentActionResult {
  const store = getStoreState()
  const moduleError = validateRegisteredModule(input.moduleId)
  if (moduleError) return { success: false, error: moduleError }

  const resolvedClassIds = resolveKnownClassIds(store, input.classIds ?? EMPTY_TREE_CLASS_IDS)
  if (resolvedClassIds.missing) {
    return { success: false, error: `Class not found: ${resolvedClassIds.missing}` }
  }
  const classIds = resolvedClassIds.classIds ?? EMPTY_TREE_CLASS_IDS

  const sanitizedProps = sanitizeNodeProps(input.props ?? EMPTY_PROPS)
  const nodeId = store.insertNode(
    input.moduleId,
    sanitizedProps,
    input.parentId,
    input.index,
  )
  for (const classId of classIds) {
    store.addNodeClass(nodeId, classId)
  }
  return { success: true, nodeId }
}

function runInsertTree(input: Static<typeof insertTreeSchema>): AgentActionResult {
  const moduleError = validateTreeModules(input.tree as InsertTreeNode)
  if (moduleError) return { success: false, error: moduleError }

  for (const classDef of input.classes ?? []) {
    const breakpointError = validateBreakpointStyles(
      getStoreState(),
      classDef.breakpointStyles ?? EMPTY_BREAKPOINT_STYLES,
    )
    if (breakpointError) return { success: false, error: breakpointError }
  }

  for (const classDef of input.classes ?? []) {
    const classId = ensureClassIdWithStyles(
      getStoreState(),
      classDef.name,
      classDef.styles ?? EMPTY_CLASS_STYLES,
      classDef.breakpointStyles ?? EMPTY_BREAKPOINT_STYLES,
    )
    if (!classId) return { success: false, error: `Class could not be created: ${classDef.name}` }
  }

  const unresolvedClass = ensureTreeClassIds(getStoreState(), input.tree as InsertTreeNode)
  if (unresolvedClass) {
    return { success: false, error: `Class could not be resolved: ${unresolvedClass}` }
  }

  const nodeId = insertTreeNode(
    getStoreState(),
    input.tree as InsertTreeNode,
    input.parentId,
    input.index,
  )
  return { success: true, nodeId }
}

function runDeleteNode(input: Static<typeof deleteNodeSchema>): AgentActionResult {
  getStoreState().deleteNode(input.nodeId)
  return { success: true }
}

function runUpdateNodeProps(input: Static<typeof updateNodePropsSchema>): AgentActionResult {
  const store = getStoreState()
  const sanitizedPatch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.patch)) {
    sanitizedPatch[key] = isRichtextPropKey(key) && typeof value === 'string'
      ? sanitizeRichtext(value)
      : value
  }
  if (input.breakpointId) {
    const breakpointError = validateBreakpointId(store, input.breakpointId)
    if (breakpointError) return { success: false, error: breakpointError }

    // Per-breakpoint writes are restricted to props the module schema marks
    // `breakpointOverridable: true`. Content props (text, tag, src, alt, …)
    // are single-value across all breakpoints because the published page is
    // one HTML document. Reject the call rather than silently dropping
    // non-overridable keys, so the agent gets a clear signal.
    const node = findNodeAcrossSite(store, input.nodeId)
    if (!node) {
      return { success: false, error: `Node not found: ${input.nodeId}` }
    }
    const definition = registry.get(node.moduleId)
    if (!definition) {
      return { success: false, error: `Unknown module on node: ${node.moduleId}` }
    }
    const nonOverridable = Object.keys(sanitizedPatch).filter(
      (key) => definition.schema[key]?.breakpointOverridable !== true,
    )
    if (nonOverridable.length > 0) {
      return {
        success: false,
        error:
          `Cannot store breakpoint overrides for non-responsive prop(s) on ${node.moduleId}: ` +
          `${nonOverridable.join(', ')}. ` +
          `Module props are content (single value across breakpoints) unless the schema marks them ` +
          `\`breakpointOverridable: true\`. For per-breakpoint *visual* variation use class breakpoint ` +
          `styles via updateClassStyles / createClass.breakpointStyles instead.`,
      }
    }
    store.setBreakpointOverride(input.nodeId, input.breakpointId, sanitizedPatch)
  } else {
    store.updateNodeProps(input.nodeId, sanitizedPatch)
  }
  return { success: true }
}

/**
 * Locate a node by ID across every page and visual-component tree on the site.
 *
 * Mutations touch the active canvas tree, but the agent passes node IDs that
 * may belong to any page or VC. We need the node's `moduleId` to look the
 * schema up before calling `setBreakpointOverride`, so a single-shot
 * cross-tree search is the simplest correct lookup.
 */
function findNodeAcrossSite(store: EditorStore, nodeId: string) {
  const site = store.site
  if (!site) return undefined
  for (const page of site.pages) {
    const node = page.nodes[nodeId]
    if (node) return node
  }
  for (const vc of site.visualComponents ?? []) {
    const node = vc.tree.nodes[nodeId]
    if (node) return node
  }
  return undefined
}

function runMoveNode(input: Static<typeof moveNodeSchema>): AgentActionResult {
  getStoreState().moveNode(input.nodeId, input.newParentId, input.newIndex)
  return { success: true }
}

function runRenameNode(input: Static<typeof renameNodeSchema>): AgentActionResult {
  getStoreState().renameNode(input.nodeId, input.label)
  return { success: true }
}

function runCreateClass(input: Static<typeof createClassSchema>): AgentActionResult {
  const store = getStoreState()
  const breakpointError = validateBreakpointStyles(
    store,
    input.breakpointStyles ?? EMPTY_BREAKPOINT_STYLES,
  )
  if (breakpointError) return { success: false, error: breakpointError }
  const cls = store.createClass(
    input.name,
    input.styles ?? EMPTY_CLASS_STYLES,
  )
  applyClassBreakpointStyles(
    store,
    cls.id,
    input.breakpointStyles ?? EMPTY_BREAKPOINT_STYLES,
  )
  return { success: true, nodeId: cls.id }
}

function runUpdateClassStyles(input: Static<typeof updateClassStylesSchema>): AgentActionResult {
  const store = getStoreState()
  const classId = resolveOrCreateClassId(store, input.classId, input.patch)
  if (!classId) return { success: false, error: `Class not found: ${input.classId}` }
  if (input.breakpointId) {
    const breakpointError = validateBreakpointId(store, input.breakpointId)
    if (breakpointError) return { success: false, error: breakpointError }
    store.setClassBreakpointStyles(classId, input.breakpointId, input.patch)
  } else {
    store.updateClassStyles(classId, input.patch)
  }
  return { success: true }
}

function runAssignClass(input: Static<typeof assignClassSchema>): AgentActionResult {
  const store = getStoreState()
  const classId = resolveClassId(store, input.classId)
  if (!classId) return { success: false, error: `Class not found: ${input.classId}` }
  store.addNodeClass(input.nodeId, classId)
  return { success: true }
}

function runRemoveClass(input: Static<typeof removeClassSchema>): AgentActionResult {
  const store = getStoreState()
  const classId = resolveClassId(store, input.classId)
  if (!classId) return { success: false, error: `Class not found: ${input.classId}` }
  store.removeNodeClass(input.nodeId, classId)
  return { success: true }
}

function runAddPage(input: Static<typeof addPageSchema>): AgentActionResult {
  const page = getStoreState().addPage(input.title, input.slug)
  return { success: true, nodeId: page.id }
}

function runDeletePage(input: Static<typeof deletePageSchema>): AgentActionResult {
  const store = getStoreState()
  const site = store.site
  if (!site) return { success: false, error: 'No active site.' }
  if (!site.pages.some((p) => p.id === input.pageId)) {
    return { success: false, error: `Page not found: ${input.pageId}` }
  }
  if (site.pages.length <= 1) {
    return { success: false, error: 'Cannot delete the last page in a site.' }
  }
  store.deletePage(input.pageId)
  return { success: true }
}

function runRenamePage(input: Static<typeof renamePageSchema>): AgentActionResult {
  const store = getStoreState()
  const site = store.site
  if (!site) return { success: false, error: 'No active site.' }
  if (!site.pages.some((p) => p.id === input.pageId)) {
    return { success: false, error: `Page not found: ${input.pageId}` }
  }
  store.renamePage(input.pageId, input.title, input.slug)
  return { success: true }
}

function runDuplicatePage(input: Static<typeof duplicatePageSchema>): AgentActionResult {
  const store = getStoreState()
  const site = store.site
  if (!site) return { success: false, error: 'No active site.' }
  if (!site.pages.some((p) => p.id === input.pageId)) {
    return { success: false, error: `Page not found: ${input.pageId}` }
  }
  const newPage = store.duplicatePage(input.pageId, input.title, input.slug)
  return { success: true, nodeId: newPage.id }
}

function runDuplicateNode(input: Static<typeof duplicateNodeSchema>): AgentActionResult {
  const store = getStoreState()
  const count = input.count ?? 1
  const newIds: string[] = []
  // Chain — clone the latest, not the source — so the resulting order is
  // [source, clone1, clone2, …, cloneN] rather than reverse-stacked.
  let lastId = input.nodeId
  for (let i = 0; i < count; i++) {
    const newId = store.duplicateNode(lastId)
    if (!newId) {
      return {
        success: false,
        error: i === 0
          ? `Could not duplicate node: ${input.nodeId}`
          : `Duplicated ${i} of ${count} nodes before failing.`,
      }
    }
    newIds.push(newId)
    lastId = newId
  }
  return { success: true, nodeId: newIds[0] }
}

async function runRenderSnapshot(
  input: Static<typeof renderSnapshotSchema>,
): Promise<AgentActionResult> {
  const snapshot = await captureAgentRenderSnapshot({
    breakpointId: input.breakpointId,
    captureScreenshot: true,
  })
  if (!snapshot) {
    return {
      success: false,
      error: 'No canvas frame found for the requested breakpoint.',
    }
  }
  return { success: true, snapshot }
}

// ---------------------------------------------------------------------------
// Public dispatch — called by the agent slice when a toolRequest event arrives
// ---------------------------------------------------------------------------

/**
 * Apply a single page-builder write tool against the editor store.
 *
 * The browser receives a `toolRequest` event from the server stream,
 * dispatches the tool here, and POSTs the result back to /admin/api/agent/tool-result
 * so the server-side MCP tool handler can return the result to Claude.
 */
export async function executeAgentTool(
  toolName: string,
  rawInput: unknown,
): Promise<AgentActionResult> {
  try {
    switch (toolName) {
      case 'insertNode':
        return runInsertNode(parseValue(insertNodeSchema, rawInput))
      case 'insertTree':
        return runInsertTree(parseValue(insertTreeSchema, rawInput))
      case 'deleteNode':
        return runDeleteNode(parseValue(deleteNodeSchema, rawInput))
      case 'updateNodeProps':
        return runUpdateNodeProps(parseValue(updateNodePropsSchema, rawInput))
      case 'moveNode':
        return runMoveNode(parseValue(moveNodeSchema, rawInput))
      case 'renameNode':
        return runRenameNode(parseValue(renameNodeSchema, rawInput))
      case 'createClass':
        return runCreateClass(parseValue(createClassSchema, rawInput))
      case 'updateClassStyles':
        return runUpdateClassStyles(parseValue(updateClassStylesSchema, rawInput))
      case 'assignClass':
        return runAssignClass(parseValue(assignClassSchema, rawInput))
      case 'removeClass':
        return runRemoveClass(parseValue(removeClassSchema, rawInput))
      case 'addPage':
        return runAddPage(parseValue(addPageSchema, rawInput))
      case 'deletePage':
        return runDeletePage(parseValue(deletePageSchema, rawInput))
      case 'renamePage':
        return runRenamePage(parseValue(renamePageSchema, rawInput))
      case 'duplicatePage':
        return runDuplicatePage(parseValue(duplicatePageSchema, rawInput))
      case 'duplicateNode':
        return runDuplicateNode(parseValue(duplicateNodeSchema, rawInput))
      case 'render_snapshot':
        return await runRenderSnapshot(parseValue(renderSnapshotSchema, rawInput))
      default:
        return { success: false, error: `Unknown page-builder tool: ${toolName}` }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, error: message }
  }
}
