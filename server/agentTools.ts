import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  AgentActionResult,
  AgentRenderSnapshotPayload,
  PageContext,
  ServerStreamEvent,
} from '../src/core/agent/types'

// ---------------------------------------------------------------------------
// Snapshot consumed by read-only tools (built once per request from PageContext)
// ---------------------------------------------------------------------------

interface PageBuilderToolContext {
  modules: PageContext['availableModules']
  classes: PageContext['classes']
  breakpoints: PageContext['breakpoints']
  pages: PageContext['pages']
  activeBreakpointId: string
  page: {
    pageId: string
    pageTitle: string
    rootNodeId: string
    selectedNodeId: string | null
    activeBreakpointId: string
    breakpoints: PageContext['breakpoints']
    nodes: PageContext['nodes']
  }
}

export function buildPageBuilderToolContext(ctx: PageContext): PageBuilderToolContext {
  return {
    modules: ctx.availableModules,
    classes: ctx.classes,
    breakpoints: ctx.breakpoints,
    pages: ctx.pages,
    activeBreakpointId: ctx.activeBreakpointId,
    page: {
      pageId: ctx.pageId,
      pageTitle: ctx.pageTitle,
      rootNodeId: ctx.rootNodeId,
      selectedNodeId: ctx.selectedNodeId,
      activeBreakpointId: ctx.activeBreakpointId,
      breakpoints: ctx.breakpoints,
      nodes: ctx.nodes,
    },
  }
}

// ---------------------------------------------------------------------------
// Bridge — write tools and render_snapshot don't run server-side. The MCP
// handler emits a `toolRequest` so the browser can apply the action against
// the live editor store (write tools) or capture an html-to-image render
// (render_snapshot), then POST the result back to /api/agent/tool-result.
// ---------------------------------------------------------------------------

export interface PageBuilderBridge {
  enqueueEvent(event: ServerStreamEvent): void
  callBrowser(name: string, input: unknown): Promise<AgentActionResult>
}

// ---------------------------------------------------------------------------
// Zod schemas — write-tool inputs (mirror AgentAction shapes in core/agent/types)
// ---------------------------------------------------------------------------

const stylePatchSchema = z.record(z.string(), z.union([z.string(), z.number()]))
const breakpointStylesSchema = z.record(z.string().min(1), stylePatchSchema)

const treeClassDefinitionSchema = z.object({
  name: z.string().min(1),
  styles: stylePatchSchema.optional(),
  breakpointStyles: breakpointStylesSchema.optional(),
})

type ZodTreeNode = z.ZodType<{
  moduleId: string
  props?: Record<string, unknown>
  classIds?: string[]
  children?: unknown[]
}>

const treeNodeSchema: ZodTreeNode = z.lazy(() =>
  z.object({
    moduleId: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    classIds: z.array(z.string().min(1)).optional(),
    children: z.array(treeNodeSchema).optional(),
  }),
) as ZodTreeNode

const insertNodeInputSchema = {
  moduleId: z.string().min(1),
  parentId: z.string().min(1),
  index: z.number().int().min(0).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  classIds: z.array(z.string().min(1)).optional(),
}

const insertTreeInputSchema = {
  parentId: z.string().min(1),
  index: z.number().int().min(0).optional(),
  classes: z.array(treeClassDefinitionSchema).optional(),
  tree: treeNodeSchema,
}

const deleteNodeInputSchema = {
  nodeId: z.string().min(1),
}

const updateNodePropsInputSchema = {
  nodeId: z.string().min(1),
  breakpointId: z.string().min(1).optional(),
  patch: z.record(z.string(), z.unknown()),
}

const moveNodeInputSchema = {
  nodeId: z.string().min(1),
  newParentId: z.string().min(1),
  newIndex: z.number().int().min(0),
}

const renameNodeInputSchema = {
  nodeId: z.string().min(1),
  label: z.string().min(1),
}

const createClassInputSchema = {
  name: z.string().min(1),
  styles: stylePatchSchema.optional(),
  breakpointStyles: breakpointStylesSchema.optional(),
}

const updateClassStylesInputSchema = {
  classId: z.string().min(1),
  breakpointId: z.string().min(1).optional(),
  patch: stylePatchSchema,
}

const assignClassInputSchema = {
  nodeId: z.string().min(1),
  classId: z.string().min(1),
}

const removeClassInputSchema = {
  nodeId: z.string().min(1),
  classId: z.string().min(1),
}

const addPageInputSchema = {
  title: z.string().min(1),
  slug: z.string().optional(),
}

const deletePageInputSchema = {
  pageId: z.string().min(1),
}

const renamePageInputSchema = {
  pageId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().optional(),
}

const duplicatePageInputSchema = {
  pageId: z.string().min(1),
  title: z.string().min(1),
  slug: z.string().optional(),
}

const duplicateNodeInputSchema = {
  nodeId: z.string().min(1),
  count: z.number().int().min(1).max(50).optional(),
}

const renderSnapshotInputSchema = {
  breakpointId: z.string().optional(),
}

// ---------------------------------------------------------------------------
// MCP server — read tools mutate nothing; write tools and render_snapshot
// forward to the bridge.
// ---------------------------------------------------------------------------

export function createPageBuilderMcpServer(
  ctx: PageContext,
  bridge: PageBuilderBridge,
) {
  const snapshot = buildPageBuilderToolContext(ctx)

  function asMutationToolResult(result: AgentActionResult, action: string): CallToolResult {
    if (!result.success) {
      const message = result.error ?? `Tool ${action} failed.`
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: { ok: false, error: message },
      }
    }
    const payload = result.nodeId
      ? { ok: true, nodeId: result.nodeId }
      : { ok: true }
    return {
      content: [{ type: 'text', text: JSON.stringify(payload) }],
      structuredContent: payload,
    }
  }

  function asSnapshotToolResult(result: AgentActionResult): CallToolResult {
    if (!result.success || !result.snapshot) {
      const message = result.error ?? 'No render snapshot available.'
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: { ok: false, error: message },
      }
    }
    const payload = result.snapshot
    const metadata = redactSnapshotForJson(payload)
    const content: CallToolResult['content'] = [
      { type: 'text', text: JSON.stringify({ snapshot: metadata }) },
    ]
    if (
      payload.screenshot.status === 'ok' &&
      payload.screenshot.data &&
      payload.screenshot.mimeType
    ) {
      content.push({
        type: 'image',
        data: payload.screenshot.data,
        mimeType: payload.screenshot.mimeType,
      })
    }
    return {
      content,
      structuredContent: { snapshot: metadata },
    }
  }

  async function callBridgeMutation(action: string, input: unknown): Promise<CallToolResult> {
    try {
      const result = await bridge.callBrowser(action, input)
      return asMutationToolResult(result, action)
    } catch (err) {
      const message = err instanceof Error ? err.message : `Tool ${action} failed.`
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: { ok: false, error: message },
      }
    }
  }

  async function callBridgeSnapshot(input: unknown): Promise<CallToolResult> {
    try {
      const result = await bridge.callBrowser('render_snapshot', input)
      return asSnapshotToolResult(result)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'render_snapshot failed.'
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: { ok: false, error: message },
      }
    }
  }

  return createSdkMcpServer({
    name: 'page_builder',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      // ── Discovery (read) tools ─────────────────────────────────────────────
      tool(
        'list_modules',
        'List every page-builder module currently registered in this site (base modules plus any modules contributed by activated plugins). Each module entry includes its id, display name, category, props (content/behaviour fields you pass to insertNode/insertTree), and class-backed style targets. Call this when you need to know what kinds of elements you can insert. Optional `category` filter narrows by the module category string (case-insensitive).',
        { category: z.string().optional() },
        async ({ category }) => {
          const normalizedCategory = category?.toLowerCase()
          const modules = normalizedCategory
            ? snapshot.modules.filter((mod) => mod.category.toLowerCase() === normalizedCategory)
            : snapshot.modules
          return jsonToolResult({ modules })
        },
        { alwaysLoad: true },
      ),
      tool(
        'list_classes',
        'List every reusable CSS class defined in the site, with its id, name, base styles, and per-breakpoint styles. Call this before assigning a class so you know it exists and what its styles look like, or to discover an existing class to reuse instead of creating a duplicate. Optional `query` filters the list by id or name (case-insensitive substring).',
        { query: z.string().optional() },
        async ({ query }) => {
          const normalizedQuery = query?.toLowerCase()
          const classes = normalizedQuery
            ? snapshot.classes.filter((cls) =>
              cls.id.toLowerCase().includes(normalizedQuery) ||
              cls.name.toLowerCase().includes(normalizedQuery),
            )
            : snapshot.classes
          return jsonToolResult({ classes })
        },
        { alwaysLoad: true },
      ),
      tool(
        'list_breakpoints',
        'List every responsive breakpoint configured for this site (id, label, width in px, icon name) and which one is currently active in the editor. Use the returned ids — never assume "mobile", "tablet", "desktop" — when passing breakpointId to updateNodeProps, updateClassStyles, createClass.breakpointStyles, or render_snapshot.',
        {},
        async () => jsonToolResult({
          activeBreakpointId: snapshot.activeBreakpointId,
          breakpoints: snapshot.breakpoints,
        }),
        { alwaysLoad: true },
      ),
      tool(
        'inspect_page',
        'Return the full active page tree: title, root node id, selected node id, configured breakpoints, and every node\'s id, moduleId, label, parent, children, props, classIds, and breakpointOverrides. Call this once when you need a global view (planning multi-element changes, reorganising sections, mass edits). For a single node prefer inspect_node.',
        {},
        async () => jsonToolResult({ page: snapshot.page }),
        { alwaysLoad: true },
      ),
      tool(
        'search_nodes',
        'Find existing nodes that match a query. Use this to locate the target of a small edit ("the heading at the top", "the primary CTA button") without dumping the whole tree via inspect_page. Filter by free-text `query` (matches id, moduleId, label, class names, and string prop values), `moduleId` (e.g. base.text), `classId`, or `className`. `limit` defaults to 25.',
        {
          query: z.string().optional(),
          moduleId: z.string().optional(),
          classId: z.string().optional(),
          className: z.string().optional(),
          limit: z.number().int().positive().max(100).optional(),
        },
        async (args) => jsonToolResult(searchPageNodes(snapshot, args)),
        { alwaysLoad: true },
      ),
      tool(
        'inspect_node',
        'Return one node\'s full detail PLUS its descendant subtree as a tree of light-info objects (id, moduleId, label, classIds, classNames, childCount, short textPreview, recursive children). One call gives you the whole structural picture for a section — you do NOT need to call inspect_node repeatedly to walk the tree. Detailed fields on the focal node: resolved props (base props + per-breakpoint overrides), assigned classes with resolved styles, merged class styles. `breakpointId` defaults to the active breakpoint. `maxDepth` defaults to 5 (deep enough for any reasonable section nesting); pass 0 for the focal node only.',
        {
          nodeId: z.string(),
          breakpointId: z.string().optional(),
          maxDepth: z.number().int().min(0).max(50).optional(),
        },
        async (args) => jsonToolResult(inspectPageNode(snapshot, args)),
        { alwaysLoad: true },
      ),
      tool(
        'inspect_class',
        'Return one class\'s detail: id, name, base styles, breakpoint-specific styles for the requested breakpoint, and every node currently assigned to it. Use this before updateClassStyles so you know the existing style values, or before reusing a class to confirm it does what you expect. `classId` accepts either the id or the class name.',
        {
          classId: z.string(),
          breakpointId: z.string().optional(),
        },
        async (args) => jsonToolResult(inspectPageClass(snapshot, args)),
        { alwaysLoad: true },
      ),
      tool(
        'render_snapshot',
        'Capture a fresh screenshot of the canvas frame for one breakpoint and return it alongside browser-collected layout data: viewport dimensions, per-node bounding boxes, image-load status, and warnings (horizontal-overflow, hidden-overflow, broken-image, invisible-node). Use this to verify visual changes, debug responsive issues, or inspect a layout you can\'t reason about from props alone. The image is returned as MCP image content so you can see it directly. `breakpointId` defaults to the active breakpoint.',
        renderSnapshotInputSchema,
        async (input) => callBridgeSnapshot(input),
        { alwaysLoad: true },
      ),
      tool(
        'list_pages',
        'List every page in the site (id, title, slug, active flag, isHomepage flag). The homepage is whichever page has slug "index". Use this for any site-level admin task: "duplicate the landing page", "list all my pages", "rename /pricing to /plans", "make this the homepage" (rename slug to "index").',
        {},
        async () => jsonToolResult({ pages: snapshot.pages }),
        { alwaysLoad: true },
      ),

      // ── Mutation (write) tools — bridged to the browser ────────────────────
      tool(
        'insertNode',
        'Insert one new node under an existing parent. Returns the new node\'s id (use it as parentId in subsequent inserts). Use this for single-element additions; for multi-element sections (hero, pricing card, CTA block) prefer insertTree, which inserts a nested tree and supporting CSS classes in a single call. `parentId` must be a real node id (root id, or an id from a prior tool result / inspect_page). `props` are content/behaviour fields per the module schema in list_modules. `classIds` may use class ids OR class names; unknown class names fail — create the class with createClass first.',
        insertNodeInputSchema,
        async (input) => callBridgeMutation('insertNode', input),
        { alwaysLoad: true },
      ),
      tool(
        'insertTree',
        'Insert a nested tree of nodes (and optionally create the supporting CSS classes for it) in a single call. Strongly preferred over chained insertNode calls for any multi-element build. `classes` are created/updated first, then referenced from `tree.children[].classIds` by class name. `tree.moduleId` is the root\'s module; `tree.children[]` are recursive — each child has the same shape. Returns the root node\'s id.',
        insertTreeInputSchema,
        async (input) => callBridgeMutation('insertTree', input),
        { alwaysLoad: true },
      ),
      tool(
        'deleteNode',
        'Remove a node and every descendant under it. Pass the real node id (from a prior tool result or inspect_page / search_nodes). Permanent within the session — the user can undo it via Cmd+Z but you cannot undo it from within the agent loop.',
        deleteNodeInputSchema,
        async (input) => callBridgeMutation('deleteNode', input),
        { alwaysLoad: true },
      ),
      tool(
        'updateNodeProps',
        'Patch one or more prop values on an existing node. The patch shallow-merges with the current props (omitted keys keep their current value; pass an empty string or null to clear). `breakpointId` writes a per-breakpoint override and is rejected for content props (text, tag, src, alt, href, …) — those are single-value across all breakpoints because the published page is one HTML document. For per-breakpoint *visual* variation use class breakpoint styles via createClass.breakpointStyles / updateClassStyles instead. Sanitises richtext-keyed props through DOMPurify automatically.',
        updateNodePropsInputSchema,
        async (input) => callBridgeMutation('updateNodeProps', input),
        { alwaysLoad: true },
      ),
      tool(
        'moveNode',
        'Move a node to a different parent and/or position in its parent\'s children array. `newIndex` is 0-based among the destination parent\'s children. Use this for re-ordering sections, reparenting nodes between containers, or moving a child to root.',
        moveNodeInputSchema,
        async (input) => callBridgeMutation('moveNode', input),
        { alwaysLoad: true },
      ),
      tool(
        'renameNode',
        'Set the user-facing label shown for a node in the DOM tree panel. Doesn\'t affect the rendered HTML — only the editor display. Useful when you build a complex tree and want each node to be findable by name in the layers panel.',
        renameNodeInputSchema,
        async (input) => callBridgeMutation('renameNode', input),
        { alwaysLoad: true },
      ),
      tool(
        'createClass',
        'Create a new reusable CSS class with optional base and per-breakpoint styles. CSS property names are camelCase (fontSize, backgroundColor, paddingTop, gridTemplateColumns, etc.). Returns the new class id; you can then pass it to assignClass, but you can also pass the class NAME to assignClass/updateClassStyles/removeClass — the executor resolves names automatically. Class names must be unique within the site.',
        createClassInputSchema,
        async (input) => callBridgeMutation('createClass', input),
        { alwaysLoad: true },
      ),
      tool(
        'updateClassStyles',
        'Patch the style declarations of an existing class. The patch shallow-merges with the current styles. Pass `breakpointId` to write breakpoint-specific overrides rather than changing the base styles. `classId` accepts either the class id or its name (the executor resolves names).',
        updateClassStylesInputSchema,
        async (input) => callBridgeMutation('updateClassStyles', input),
        { alwaysLoad: true },
      ),
      tool(
        'assignClass',
        'Attach an existing CSS class to a node. The class\'s styles cascade onto the node according to the project\'s class layering rules. `classId` accepts either the id or the class name.',
        assignClassInputSchema,
        async (input) => callBridgeMutation('assignClass', input),
        { alwaysLoad: true },
      ),
      tool(
        'removeClass',
        'Detach a CSS class from a node (does not delete the class itself; other nodes keep their assignment). `classId` accepts either the id or the class name.',
        removeClassInputSchema,
        async (input) => callBridgeMutation('removeClass', input),
        { alwaysLoad: true },
      ),
      tool(
        'addPage',
        'Add a new EMPTY page to the site with the given title and optional slug (defaults to a slugified title). Use this when the user asks to create a fresh page from scratch. For "create a page like this one" or "copy the landing page", use duplicatePage instead. Returns the new page id in `nodeId`.',
        addPageInputSchema,
        async (input) => callBridgeMutation('addPage', input),
        { alwaysLoad: true },
      ),
      tool(
        'deletePage',
        'Permanently delete a page and all of its content. Cannot delete the only remaining page in a site (a site must have at least one page). Use list_pages first if you need to find the page id.',
        deletePageInputSchema,
        async (input) => callBridgeMutation('deletePage', input),
        { alwaysLoad: true },
      ),
      tool(
        'renamePage',
        'Change a page\'s title and/or slug. Pass `slug` as "index" to make this page the site\'s homepage (the homepage convention is whichever page lives at slug "index"). Pass `slug` as undefined to keep the current slug. Use list_pages first if you need to find the page id.',
        renamePageInputSchema,
        async (input) => callBridgeMutation('renamePage', input),
        { alwaysLoad: true },
      ),
      tool(
        'duplicatePage',
        'Deep-clone an existing page (every node, prop, class assignment, and breakpoint override) under a new title and slug. Use this for "copy this page", "make a /pricing page like the /plans page", or any template-style workflow. Every node in the new page gets a fresh id; class assignments are preserved. Returns the new page id in `nodeId`.',
        duplicatePageInputSchema,
        async (input) => callBridgeMutation('duplicatePage', input),
        { alwaysLoad: true },
      ),
      tool(
        'duplicateNode',
        'Deep-clone a node and its entire subtree (props, classIds, breakpoint overrides, all descendants) right after the original in the same parent. Pass `count` (1-50, default 1) to produce N clones in one call — the canonical way to handle "make 6 cards from the existing 3" or "add another section like this one". Returns the first new node\'s id in `nodeId`. The clones share class assignments with the original, so styling stays consistent.',
        duplicateNodeInputSchema,
        async (input) => callBridgeMutation('duplicateNode', input),
        { alwaysLoad: true },
      ),
    ],
  })
}

interface SearchNodesArgs {
  query?: string
  moduleId?: string
  classId?: string
  className?: string
  limit?: number
}

interface InspectNodeArgs {
  nodeId: string
  breakpointId?: string
  /** How deep to walk descendants. Default 5; pass 0 for no descendants. */
  maxDepth?: number
}

interface DescendantNode {
  id: string
  moduleId: string
  label?: string
  classIds: string[]
  classNames: string[]
  childCount: number
  textPreview?: string
  children: DescendantNode[]
}

interface InspectClassArgs {
  classId: string
  breakpointId?: string
}

export function searchPageNodes(ctx: PageBuilderToolContext, args: SearchNodesArgs) {
  const query = args.query?.trim().toLowerCase()
  const classId = args.classId?.trim()
  const className = args.className?.trim().toLowerCase()
  const limit = args.limit ?? 25
  const classNameMatches = className
    ? new Set(ctx.classes
      .filter((cls) => cls.name.toLowerCase().includes(className))
      .map((cls) => cls.id))
    : null

  const nodes = ctx.page.nodes
    .filter((node) => {
      if (args.moduleId && node.moduleId !== args.moduleId) return false
      if (classId && !node.classIds.includes(classId)) return false
      if (classNameMatches && !node.classIds.some((id) => classNameMatches.has(id))) return false
      if (!query) return true

      const classNames = node.classIds
        .map((id) => ctx.classes.find((cls) => cls.id === id)?.name ?? '')
        .join(' ')
      const haystack = [
        node.id,
        node.moduleId,
        node.label ?? '',
        classNames,
        ...Object.values(node.props).map((value) => stringifySearchValue(value)),
      ].join(' ').toLowerCase()
      return haystack.includes(query)
    })
    .slice(0, limit)
    .map((node) => ({
      id: node.id,
      moduleId: node.moduleId,
      label: node.label,
      parentId: node.parentId,
      childCount: node.children.length,
      classIds: node.classIds,
      classNames: node.classIds.map((id) => ctx.classes.find((cls) => cls.id === id)?.name ?? id),
      text: Object.entries(node.props)
        .filter(([, value]) => typeof value === 'string')
        .map(([key, value]) => `${key}: ${value}`)
        .join('; '),
    }))

  return { nodes }
}

export function inspectPageNode(ctx: PageBuilderToolContext, args: InspectNodeArgs) {
  const node = ctx.page.nodes.find((item) => item.id === args.nodeId)
  if (!node) return { node: null, error: `Node not found: ${args.nodeId}` }

  const breakpointId = args.breakpointId ?? ctx.activeBreakpointId
  const resolvedProps = resolveNodeProps(node, breakpointId, ctx.modules)
  const classes = node.classIds.map((classId) => {
    const cls = ctx.classes.find((item) => item.id === classId)
    if (!cls) return { id: classId, missing: true }
    const breakpointStyles = cls.breakpointStyles?.[breakpointId] ?? {}
    return {
      id: cls.id,
      name: cls.name,
      styles: cls.styles ?? {},
      breakpointStyles,
      resolvedStyles: {
        ...(cls.styles ?? {}),
        ...breakpointStyles,
      },
    }
  })

  const maxDepth = Math.max(0, args.maxDepth ?? 5)
  const descendants = buildDescendantTree(ctx, node.children, 1, maxDepth)

  return {
    node: {
      ...node,
      breakpointId,
      resolvedProps,
      classes,
      resolvedClassStyles: mergeResolvedClassStyles(classes),
      descendants,
    },
  }
}

function buildDescendantTree(
  ctx: PageBuilderToolContext,
  childIds: string[],
  depth: number,
  maxDepth: number,
): DescendantNode[] {
  if (depth > maxDepth || childIds.length === 0) return []
  const nodes: DescendantNode[] = []
  for (const id of childIds) {
    const child = ctx.page.nodes.find((node) => node.id === id)
    if (!child) continue
    nodes.push({
      id: child.id,
      moduleId: child.moduleId,
      label: child.label,
      classIds: child.classIds,
      classNames: child.classIds.map((classId) => ctx.classes.find((cls) => cls.id === classId)?.name ?? classId),
      childCount: child.children.length,
      textPreview: extractTextPreview(child.props),
      children: buildDescendantTree(ctx, child.children, depth + 1, maxDepth),
    })
  }
  return nodes
}

const TEXT_PREVIEW_KEYS = ['text', 'label', 'title', 'heading', 'content', 'caption', 'alt']
const TEXT_PREVIEW_MAX_LENGTH = 80

function extractTextPreview(props: Record<string, unknown>): string | undefined {
  // Try common text-bearing prop keys first.
  for (const key of TEXT_PREVIEW_KEYS) {
    const value = props[key]
    if (typeof value === 'string' && value.trim()) {
      return truncate(value)
    }
  }
  // Fallback: any string prop with non-empty content.
  for (const value of Object.values(props)) {
    if (typeof value === 'string' && value.trim()) {
      return truncate(value)
    }
  }
  return undefined
}

function truncate(text: string): string {
  if (text.length <= TEXT_PREVIEW_MAX_LENGTH) return text
  return `${text.slice(0, TEXT_PREVIEW_MAX_LENGTH - 1).trimEnd()}…`
}

export function inspectPageClass(ctx: PageBuilderToolContext, args: InspectClassArgs) {
  const cls = ctx.classes.find((item) => item.id === args.classId || item.name === args.classId)
  if (!cls) return { class: null, error: `Class not found: ${args.classId}` }

  const breakpointId = args.breakpointId ?? ctx.activeBreakpointId
  const breakpointStyles = cls.breakpointStyles?.[breakpointId] ?? {}
  const assignedNodes = ctx.page.nodes
    .filter((node) => node.classIds.includes(cls.id))
    .map((node) => ({
      id: node.id,
      moduleId: node.moduleId,
      label: node.label,
      parentId: node.parentId,
    }))

  return {
    class: {
      id: cls.id,
      name: cls.name,
      breakpointId,
      styles: cls.styles ?? {},
      breakpointStyles,
      resolvedStyles: {
        ...(cls.styles ?? {}),
        ...breakpointStyles,
      },
      assignedNodes,
    },
  }
}

function redactSnapshotForJson(payload: AgentRenderSnapshotPayload): AgentRenderSnapshotPayload {
  return {
    ...payload,
    screenshot: {
      ...payload.screenshot,
      data: payload.screenshot.data ? '<image data returned as MCP image content>' : undefined,
    },
  }
}

function resolveNodeProps(
  node: PageContext['nodes'][number],
  breakpointId: string,
  modules: PageContext['availableModules'],
): Record<string, unknown> {
  const override = node.breakpointOverrides[breakpointId]
  if (!override || Object.keys(override).length === 0) return node.props
  // Filter to props the module schema marks `breakpointOverridable` —
  // content props are single-value across breakpoints because the published
  // page is one HTML document. Kept consistent with the canvas/publisher
  // resolveProps behaviour.
  const moduleDef = modules.find((m) => m.id === node.moduleId)
  if (!moduleDef) return { ...node.props, ...override }
  const overridable = new Set(
    moduleDef.props.filter((p) => p.breakpointOverridable === true).map((p) => p.key),
  )
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(override)) {
    if (overridable.has(key)) filtered[key] = value
  }
  if (Object.keys(filtered).length === 0) return node.props
  return { ...node.props, ...filtered }
}

function mergeResolvedClassStyles(classes: Array<{
  resolvedStyles?: Record<string, unknown>
}>): Record<string, unknown> {
  return classes.reduce<Record<string, unknown>>((acc, cls) => ({
    ...acc,
    ...(cls.resolvedStyles ?? {}),
  }), {})
}

function stringifySearchValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function jsonToolResult(data: Record<string, unknown>): CallToolResult {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(data),
      },
    ],
    structuredContent: data,
  }
}
