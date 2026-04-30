/**
 * Phase D — AI Agent: shared message and action types.
 *
 * These types live in core/ (no SDK imports) so they can be imported by
 * both the browser-side AgentPanel and the executor without violating
 * Constraints #283/#286 (no Anthropic SDK in src/).
 *
 * The wire format between the server and browser is NDJSON (newline-delimited
 * JSON). Each line is a `ServerStreamEvent` value, JSON-serialised.
 */

// ---------------------------------------------------------------------------
// Agent actions — the page-builder operations Claude can request
// ---------------------------------------------------------------------------

export type AgentActionType =
  | 'insertNode'
  | 'insertTree'
  | 'deleteNode'
  | 'updateNodeProps'
  | 'moveNode'
  | 'renameNode'
  | 'createClass'
  | 'updateClassStyles'
  | 'assignClass'
  | 'removeClass'
  | 'addPage'
  | 'updateProjectSettings'

export interface InsertNodeAction {
  type: 'insertNode'
  moduleId: string
  /** Existing parent node ID. Required unless parentRef is provided. */
  parentId?: string
  /** Temporary ref from an earlier insertNode in the same action batch. */
  parentRef?: string
  /** Temporary ref name for later actions in the same batch. */
  ref?: string
  /** 0-based insertion index among parent's children. Appends if omitted. */
  index?: number
  /** Initial prop values for the new node. */
  props?: Record<string, unknown>
  /**
   * Optional classes to attach immediately after insertion.
   * Values may be existing class IDs or class names created earlier in the same batch.
   */
  classIds?: string[]
}

export interface AgentTreeClassDefinition {
  name: string
  styles?: Record<string, string | number>
  /** Per-breakpoint class styles keyed by configured Breakpoint.id. */
  breakpointStyles?: Record<string, Record<string, string | number>>
}

export interface InsertTreeNode {
  moduleId: string
  /** Temporary ref name for later actions in the same batch. */
  ref?: string
  /** Initial prop values for the new node. */
  props?: Record<string, unknown>
  /**
   * Optional classes to attach immediately after insertion.
   * Values must be existing class IDs, existing class names, or class names
   * declared in insertTree.classes.
   */
  classIds?: string[]
  children?: InsertTreeNode[]
}

export interface InsertTreeAction {
  type: 'insertTree'
  /** Existing parent node ID. Required unless parentRef is provided. */
  parentId?: string
  /** Temporary ref from an earlier insertNode/insertTree in the same action batch. */
  parentRef?: string
  /** 0-based insertion index among parent's children. Appends if omitted. */
  index?: number
  /** CSS classes to create/update before inserting the tree. */
  classes?: AgentTreeClassDefinition[]
  /** Root node of the tree to insert. */
  tree: InsertTreeNode
}

export interface DeleteNodeAction {
  type: 'deleteNode'
  nodeId?: string
  /** Temporary ref from an earlier insertNode in the same action batch. */
  nodeRef?: string
}

export interface UpdateNodePropsAction {
  type: 'updateNodeProps'
  nodeId?: string
  /** Temporary ref from an earlier insertNode in the same action batch. */
  nodeRef?: string
  /** Optional configured breakpoint ID. When set, writes a breakpoint prop override. */
  breakpointId?: string
  patch: Record<string, unknown>
}

export interface MoveNodeAction {
  type: 'moveNode'
  nodeId?: string
  /** Temporary ref from an earlier insertNode in the same action batch. */
  nodeRef?: string
  newParentId?: string
  /** Temporary ref for the destination parent created earlier in the same batch. */
  newParentRef?: string
  /** 0-based position in newParent's children. */
  newIndex: number
}

export interface RenameNodeAction {
  type: 'renameNode'
  nodeId?: string
  /** Temporary ref from an earlier insertNode in the same action batch. */
  nodeRef?: string
  label: string
}

export interface CreateClassAction {
  type: 'createClass'
  name: string
  styles?: Record<string, string | number>
  /** Per-breakpoint class styles keyed by configured Breakpoint.id. */
  breakpointStyles?: Record<string, Record<string, string | number>>
}

export interface UpdateClassStylesAction {
  type: 'updateClassStyles'
  classId: string
  /** Optional configured breakpoint ID. When set, writes class breakpoint styles. */
  breakpointId?: string
  patch: Record<string, string | number>
}

export interface AssignClassAction {
  type: 'assignClass'
  nodeId?: string
  /** Temporary ref from an earlier insertNode in the same action batch. */
  nodeRef?: string
  classId: string
}

export interface RemoveClassAction {
  type: 'removeClass'
  nodeId?: string
  /** Temporary ref from an earlier insertNode in the same action batch. */
  nodeRef?: string
  classId: string
}

export interface AddPageAction {
  type: 'addPage'
  title: string
  slug?: string
}

export interface UpdateProjectSettingsAction {
  type: 'updateProjectSettings'
  patch: Record<string, unknown>
}

export type AgentAction =
  | InsertNodeAction
  | InsertTreeAction
  | DeleteNodeAction
  | UpdateNodePropsAction
  | MoveNodeAction
  | RenameNodeAction
  | CreateClassAction
  | UpdateClassStylesAction
  | AssignClassAction
  | RemoveClassAction
  | AddPageAction
  | UpdateProjectSettingsAction

// ---------------------------------------------------------------------------
// Execution result
// ---------------------------------------------------------------------------

export interface AgentActionResult {
  success: boolean
  /** Returned by insertNode (the new node ID). */
  nodeId?: string
  error?: string
}

// ---------------------------------------------------------------------------
// Server → Browser stream events (NDJSON wire format)
// ---------------------------------------------------------------------------

/** A chunk of text from the assistant's message. */
export interface TextEvent {
  type: 'text'
  text: string
}

/** One or more validated page-builder actions to execute in the browser. */
export interface ActionsEvent {
  type: 'actions'
  actions: AgentAction[]
}

/** A single action has been executed and the result is available. */
export interface ActionResultEvent {
  type: 'actionResult'
  actionType: AgentActionType
  result: AgentActionResult
}

/** Stream finished normally. */
export interface DoneEvent {
  type: 'done'
}

/** Stream terminated due to a server-side error. */
export interface ErrorEvent {
  type: 'error'
  message: string
}

/** Status update for SDK/MCP tools used by Claude before page-builder actions. */
export interface ToolStatusEvent {
  type: 'toolStatus'
  toolCallId: string
  name: string
  status: 'pending' | 'success' | 'error'
  input?: unknown
  error?: string
}

/** Current Claude Agent SDK session ID for follow-up resume calls. */
export interface SessionEvent {
  type: 'session'
  sessionId: string
}

export type ServerStreamEvent =
  | TextEvent
  | ActionsEvent
  | ActionResultEvent
  | ToolStatusEvent
  | SessionEvent
  | DoneEvent
  | ErrorEvent

// ---------------------------------------------------------------------------
// Browser conversation model
// ---------------------------------------------------------------------------

export interface AgentToolCall {
  id: string
  externalId?: string
  source?: 'page-builder' | 'sdk'
  actionType: string
  params: AgentAction | Record<string, unknown>
  result: AgentActionResult | null
  status: 'pending' | 'success' | 'error'
}

export interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolCalls: AgentToolCall[]
  timestamp: number
}

// ---------------------------------------------------------------------------
// Browser → Server request body
// ---------------------------------------------------------------------------

export interface AgentRequestBody {
  /** The user's new message. */
  prompt: string
  /** Claude Agent SDK session ID to resume for follow-up turns. */
  sessionId?: string
  /**
   * Full conversation context — every prior message in this session
   * including earlier assistant text and tool results. Allows the server
   * to provide a fallback transcript if the SDK session is unavailable.
   */
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  /**
   * Snapshot of the current page tree injected into the system prompt.
   * Lets the server give Claude accurate context without a separate read call.
   */
  pageContext: PageContext
}

export interface AgentModulePropOptionContext {
  label: string
  value: unknown
}

export interface AgentModulePropContext {
  key: string
  type: string
  label: string
  description?: string
  defaultValue?: unknown
  options?: AgentModulePropOptionContext[]
}

export interface AgentModuleStyleContext {
  key: string
  type: string
  label: string
  description?: string
  defaultValue?: unknown
  cssProperties: string[]
  options?: AgentModulePropOptionContext[]
}

export interface AgentModuleContext {
  id: string
  name: string
  description?: string
  category: string
  canHaveChildren: boolean
  defaults: Record<string, unknown>
  props: AgentModulePropContext[]
  styles: AgentModuleStyleContext[]
}

export interface AgentBreakpointContext {
  id: string
  label: string
  width: number
  icon: string
}

export interface AgentLayoutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface AgentLayoutNodeContext {
  nodeId: string
  moduleId?: string
  label?: string
  text: string
  rect: AgentLayoutRect
  visible: boolean
  computed: {
    display: string
    position: string
    overflow: string
    color: string
    backgroundColor: string
    fontSize: string
    lineHeight: string
  }
}

export interface AgentLayoutImageContext {
  nodeId?: string
  src: string
  alt?: string
  complete: boolean
  naturalWidth: number
  naturalHeight: number
  rect: AgentLayoutRect
}

export interface AgentLayoutWarningContext {
  type: 'horizontal-overflow' | 'vertical-overflow' | 'hidden-overflow' | 'broken-image' | 'invisible-node'
  severity: 'info' | 'warning' | 'error'
  message: string
  nodeId?: string
}

export interface AgentLayoutReportContext {
  breakpointId: string
  viewport: {
    width: number
    height: number
    scrollWidth: number
    scrollHeight: number
  }
  nodes: AgentLayoutNodeContext[]
  images: AgentLayoutImageContext[]
  warnings: AgentLayoutWarningContext[]
}

export interface AgentScreenshotContext {
  status: 'ok' | 'unavailable' | 'error'
  mimeType?: string
  data?: string
  width?: number
  height?: number
  error?: string
}

export interface AgentRenderSnapshotContext {
  breakpointId: string
  label: string
  width: number
  capturedAt: number
  screenshot: AgentScreenshotContext
  layout: AgentLayoutReportContext
}

export interface PageContext {
  /** Active page title */
  pageTitle: string
  /** Root node ID of the active page */
  rootNodeId: string
  /** Configured breakpoint ID currently active in the editor. */
  activeBreakpointId: string
  /** Live breakpoint configuration for the project. */
  breakpoints: AgentBreakpointContext[]
  /** All nodes on the active page (flat map, serialisable subset) */
  nodes: Array<{
    id: string
    moduleId: string
    label?: string
    parentId: string | null
    children: string[]
    props: Record<string, unknown>
    breakpointOverrides: Record<string, Partial<Record<string, unknown>>>
    classIds: string[]
  }>
  /** Live module registry snapshot so Claude knows what can be inserted. */
  availableModules: AgentModuleContext[]
  /** Currently selected node ID, if any */
  selectedNodeId: string | null
  /**
   * CSS class registry — all classes defined in the project.
   * Use the `id` in assignClass/updateClassStyles for existing classes.
   * For a class created in the same action batch, use its `name` as the
   * classId — the executor resolves names automatically.
   */
  classes: Array<{
    id: string
    name: string
    styles?: Record<string, unknown>
    breakpointStyles?: Record<string, Record<string, unknown>>
  }>
  /** Browser-collected render/layout snapshots for canvas breakpoint frames. */
  renderSnapshots: AgentRenderSnapshotContext[]
}
