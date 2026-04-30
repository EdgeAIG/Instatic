import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type {
  AgentRenderSnapshotContext,
  PageContext,
} from '../src/core/agent/types'

export interface PageBuilderToolContext {
  modules: PageContext['availableModules']
  classes: PageContext['classes']
  breakpoints: PageContext['breakpoints']
  activeBreakpointId: string
  page: {
    pageTitle: string
    rootNodeId: string
    selectedNodeId: string | null
    activeBreakpointId: string
    breakpoints: PageContext['breakpoints']
    nodes: PageContext['nodes']
  }
  renderSnapshots: PageContext['renderSnapshots']
}

export function buildPageBuilderToolContext(ctx: PageContext): PageBuilderToolContext {
  return {
    modules: ctx.availableModules,
    classes: ctx.classes,
    breakpoints: ctx.breakpoints,
    activeBreakpointId: ctx.activeBreakpointId,
    page: {
      pageTitle: ctx.pageTitle,
      rootNodeId: ctx.rootNodeId,
      selectedNodeId: ctx.selectedNodeId,
      activeBreakpointId: ctx.activeBreakpointId,
      breakpoints: ctx.breakpoints,
      nodes: ctx.nodes,
    },
    renderSnapshots: ctx.renderSnapshots ?? [],
  }
}

export function createPageBuilderMcpServer(ctx: PageContext) {
  const snapshot = buildPageBuilderToolContext(ctx)

  return createSdkMcpServer({
    name: 'page_builder',
    version: '1.0.0',
    alwaysLoad: true,
    tools: [
      tool(
        'list_modules',
        'List currently registered page-builder modules, including props and class-backed style targets.',
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
        'List reusable CSS classes available in this project, including their current styles.',
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
        'List configured responsive breakpoints for this project, including the currently active breakpoint.',
        {},
        async () => jsonToolResult({
          activeBreakpointId: snapshot.activeBreakpointId,
          breakpoints: snapshot.breakpoints,
        }),
        { alwaysLoad: true },
      ),
      tool(
        'inspect_page',
        'Inspect the active page tree, selected node, root node IDs, and configured breakpoints before planning edits.',
        {},
        async () => jsonToolResult({ page: snapshot.page }),
        { alwaysLoad: true },
      ),
      tool(
        'search_nodes',
        'Search existing page nodes by text, label, module ID, class ID, or class name before making small edits.',
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
        'Inspect one existing node with resolved props and resolved class styles for a configured breakpoint.',
        {
          nodeId: z.string(),
          breakpointId: z.string().optional(),
        },
        async (args) => jsonToolResult(inspectPageNode(snapshot, args)),
        { alwaysLoad: true },
      ),
      tool(
        'inspect_class',
        'Inspect one reusable CSS class by ID or name, including breakpoint styles and assigned nodes.',
        {
          classId: z.string(),
          breakpointId: z.string().optional(),
        },
        async (args) => jsonToolResult(inspectPageClass(snapshot, args)),
        { alwaysLoad: true },
      ),
      tool(
        'inspect_layout',
        'Inspect browser-collected layout boxes and warnings for a breakpoint canvas frame.',
        {
          breakpointId: z.string().optional(),
        },
        async (args) => jsonToolResult(inspectLayoutSnapshot(snapshot, args)),
        { alwaysLoad: true },
      ),
      tool(
        'render_snapshot',
        'Return a browser-collected screenshot for a breakpoint canvas frame, plus the same layout warnings used by inspect_layout.',
        {
          breakpointId: z.string().optional(),
        },
        async (args) => renderSnapshotToolResult(snapshot, args),
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
}

interface InspectClassArgs {
  classId: string
  breakpointId?: string
}

interface InspectSnapshotArgs {
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
  const resolvedProps = resolveNodeProps(node, breakpointId)
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

  return {
    node: {
      ...node,
      breakpointId,
      resolvedProps,
      classes,
      resolvedClassStyles: mergeResolvedClassStyles(classes),
    },
  }
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

export function inspectLayoutSnapshot(ctx: PageBuilderToolContext, args: InspectSnapshotArgs) {
  const snapshot = findRenderSnapshot(ctx, args.breakpointId)
  if (!snapshot) {
    return {
      layout: null,
      error: 'No browser layout snapshot is available for the requested breakpoint.',
    }
  }
  return { layout: snapshot.layout }
}

function renderSnapshotToolResult(ctx: PageBuilderToolContext, args: InspectSnapshotArgs): CallToolResult {
  const snapshot = findRenderSnapshot(ctx, args.breakpointId)
  if (!snapshot) {
    return jsonToolResult({
      snapshot: null,
      error: 'No browser render snapshot is available for the requested breakpoint.',
    })
  }

  const metadata = redactScreenshotData(snapshot)
  const content: CallToolResult['content'] = [
    {
      type: 'text',
      text: JSON.stringify({ snapshot: metadata }),
    },
  ]

  if (snapshot.screenshot.status === 'ok' && snapshot.screenshot.data && snapshot.screenshot.mimeType) {
    content.push({
      type: 'image',
      data: snapshot.screenshot.data,
      mimeType: snapshot.screenshot.mimeType,
    })
  }

  return {
    content,
    structuredContent: { snapshot: metadata },
  }
}

function findRenderSnapshot(
  ctx: PageBuilderToolContext,
  breakpointId: string | undefined,
): AgentRenderSnapshotContext | undefined {
  const targetId = breakpointId ?? ctx.activeBreakpointId
  return ctx.renderSnapshots.find((snapshot) => snapshot.breakpointId === targetId) ??
    ctx.renderSnapshots[0]
}

function redactScreenshotData(snapshot: AgentRenderSnapshotContext): AgentRenderSnapshotContext {
  return {
    ...snapshot,
    screenshot: {
      ...snapshot.screenshot,
      data: snapshot.screenshot.data ? '<image data returned as MCP image content>' : undefined,
    },
  }
}

function resolveNodeProps(
  node: PageContext['nodes'][number],
  breakpointId: string,
): Record<string, unknown> {
  const override = node.breakpointOverrides[breakpointId]
  return override && Object.keys(override).length > 0
    ? { ...node.props, ...override }
    : node.props
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
