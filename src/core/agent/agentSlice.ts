/**
 * Phase D — Agent store slice.
 *
 * Manages the AI Agent Panel's conversation state. The agent communicates
 * via AGENT_API_PATH (see agentConfig.ts) — the Vite dev server proxies
 * the route to the local Bun agent server (port 3001) which runs the Claude
 * Agent SDK with ambient Claude Code credentials. No API key, no endpoint
 * configuration, no env var required (Constraint #385).
 *
 * Stream protocol:
 *   Browser POSTs { prompt, messages, pageContext } to AGENT_API_PATH.
 *   Server streams NDJSON: one ServerStreamEvent per line.
 *   Browser reads the stream, dispatches actions, updates conversation.
 *
 * Guideline #254 (Performance):
 *   Text deltas are batched via rAF buffer before committing to the store
 *   to prevent excessive React re-renders during streaming.
 */

import { produce } from 'immer'
import { nanoid } from 'nanoid'
import type { StateCreator } from 'zustand'
import type { EditorStore } from '../editor-store/store'
import { registry } from '../module-engine/registry'
import type {
  AnyModuleDefinition,
  ModuleStyleBinding,
  PropertyControl,
  PropertySchema,
} from '../module-engine/types'
import { executeAgentActions } from './executor'
import { AGENT_API_PATH } from './agentConfig'
import { stripAgentActionBlocks } from './actionBlocks'
import { collectAgentRenderSnapshots } from './renderEvidence'
import type {
  AgentModuleContext,
  AgentModulePropContext,
  AgentModuleStyleContext,
  AgentMessage,
  AgentToolCall,
  AgentRequestBody,
  ServerStreamEvent,
  PageContext,
} from './types'

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

export interface AgentSlice {
  // ── UI state ───────────────────────────────────────────────────────────────
  isAgentOpen: boolean
  isAgentStreaming: boolean
  agentMessages: AgentMessage[]
  agentError: string | null
  agentSessionId: string | null
  agentSessionProjectId: string | null

  // ── Actions ────────────────────────────────────────────────────────────────
  openAgent(): void
  closeAgent(): void
  toggleAgent(): void

  /**
   * Send a user message and stream the assistant response.
   * Uses the Vite proxy path `/api/agent` → local Bun server → Claude Agent SDK.
   * No endpoint configuration required (Constraint #385).
   * @param content  The user's message text.
   */
  sendAgentMessage(content: string): Promise<void>

  /** Abort an in-progress streaming request. */
  abortAgent(): void

  /** Clear all messages and reset error state. */
  clearAgentMessages(): void
}

type EditorStoreSet = Parameters<StateCreator<EditorStore, [], [], AgentSlice>>[0]

const AGENT_SESSION_STORAGE_PREFIX = 'pb-agent-session:'

function readStoredAgentSessionId(projectId: string | null | undefined): string | null {
  if (!projectId || typeof localStorage === 'undefined') return null
  const sessionId = localStorage.getItem(`${AGENT_SESSION_STORAGE_PREFIX}${projectId}`)
  return sessionId && sessionId.trim() ? sessionId.trim() : null
}

function writeStoredAgentSessionId(projectId: string | null | undefined, sessionId: string): void {
  if (!projectId || typeof localStorage === 'undefined') return
  localStorage.setItem(`${AGENT_SESSION_STORAGE_PREFIX}${projectId}`, sessionId)
}

function clearStoredAgentSessionId(projectId: string | null | undefined): void {
  if (!projectId || typeof localStorage === 'undefined') return
  localStorage.removeItem(`${AGENT_SESSION_STORAGE_PREFIX}${projectId}`)
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const createAgentSlice: StateCreator<EditorStore, [], [], AgentSlice> = (set, get) => {
  // AbortController held in closure (not reactive — intentional, not needed in UI)
  let _abortController: AbortController | null = null

  // rAF-buffered text accumulation (Guideline #254)
  let _pendingText = ''
  let _pendingAssistantId = ''
  let _rafHandle = 0

  function flushPendingText() {
    _rafHandle = 0
    if (!_pendingText || !_pendingAssistantId) return
    const text = _pendingText
    const id = _pendingAssistantId
    _pendingText = ''
    set(
      produce((state: EditorStore) => {
        const msg = state.agentMessages.find((m) => m.id === id)
        if (msg) msg.content += text
      }),
    )
  }

  function scheduleFlush() {
    if (_rafHandle === 0) {
      _rafHandle = requestAnimationFrame(flushPendingText)
    }
  }

  function appendTextDelta(assistantId: string, text: string) {
    _pendingAssistantId = assistantId
    _pendingText += text
    scheduleFlush()
  }

  return {
    // ── State ────────────────────────────────────────────────────────────────
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    agentSessionId: null,
    agentSessionProjectId: null,

    // ── UI actions ───────────────────────────────────────────────────────────
    openAgent() {
      set({ isAgentOpen: true })
    },

    closeAgent() {
      set({ isAgentOpen: false })
    },

    toggleAgent() {
      set((s) => ({ isAgentOpen: !s.isAgentOpen }))
    },

    abortAgent() {
      _abortController?.abort()
      _abortController = null
      set({ isAgentStreaming: false })
    },

    clearAgentMessages() {
      clearStoredAgentSessionId(get().project?.id)
      set({
        agentMessages: [],
        agentError: null,
        agentSessionId: null,
        agentSessionProjectId: null,
      })
    },

    // ── sendAgentMessage ─────────────────────────────────────────────────────
    async sendAgentMessage(content) {
      // Route via Vite dev proxy (AGENT_API_PATH) → local Bun agent server.
      // No API key or endpoint configuration required (Constraint #385).
      const endpoint = AGENT_API_PATH

      if (get().isAgentStreaming) return // one request at a time

      const projectId = get().project?.id ?? null
      const stateSessionId = get().agentSessionProjectId === projectId
        ? get().agentSessionId
        : null
      const resumeSessionId = stateSessionId ?? readStoredAgentSessionId(projectId)
      if (resumeSessionId && resumeSessionId !== get().agentSessionId) {
        set({
          agentSessionId: resumeSessionId,
          agentSessionProjectId: projectId,
        })
      }

      // Add user message
      const userMsg: AgentMessage = {
        id: nanoid(),
        role: 'user',
        content,
        toolCalls: [],
        timestamp: Date.now(),
      }

      // Create assistant placeholder
      const assistantId = nanoid()
      const assistantMsg: AgentMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        timestamp: Date.now(),
      }

      set(
        produce((state: EditorStore) => {
          state.agentMessages.push(userMsg)
          state.agentMessages.push(assistantMsg)
          state.agentError = null
          state.isAgentStreaming = true
        }),
      )

      // Build conversation history (prior messages)
      const priorMessages = get()
        .agentMessages.filter((m) => m.id !== userMsg.id && m.id !== assistantId)
        .map((m) => ({
          role: m.role,
          content: m.role === 'assistant'
            ? stripAgentActionBlocks(m.content)
            : m.content,
        }))
        .filter((m) => m.content.trim().length > 0)

      // Start streaming
      _abortController = new AbortController()

      const runAgentRequest = async (
        requestPrompt: string,
        pageContext: PageContext,
      ): Promise<void> => {
        const body: AgentRequestBody = {
          prompt: requestPrompt,
          sessionId: resumeSessionId ?? undefined,
          messages: priorMessages,
          pageContext,
        }
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: _abortController?.signal,
        })

        if (!res.ok) {
          if (res.status === 502) {
            // 502 = agent server not reachable (safe status code — not raw SDK error text)
            console.error('[AgentSlice] 502 — agent server unreachable')
            set({ agentError: 'Agent server is not running. Start it with: bun run dev:all' })
            set(
              produce((state: EditorStore) => {
                const msg = state.agentMessages.find((m) => m.id === assistantId)
                if (msg && !msg.content) msg.content = '_(agent error)_'
              }),
            )
            return
          }
          throw new Error(`Agent request failed: ${res.status} ${res.statusText}`)
        }

        if (!res.body) throw new Error('Agent response has no body')

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let lineBuffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          lineBuffer += decoder.decode(value, { stream: true })
          const lines = lineBuffer.split('\n')
          lineBuffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue
            let event: ServerStreamEvent
            try {
              event = JSON.parse(trimmed) as ServerStreamEvent
            } catch {
              continue // skip malformed lines
            }
            await processStreamEvent(event, assistantId, appendTextDelta, set, get)
          }
        }

        // Flush any remaining text
        flushPendingText()
      }

      try {
        const initialPageContext = await buildCurrentLivePageContext(get)
        await runAgentRequest(content, initialPageContext)
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          // User aborted — treat as normal end
          flushPendingText()
        } else {
          // CWE-209 (Constraint #388): never surface raw error details in the UI.
          // Log internally; show fixed copy to the user only.
          console.error('[AgentSlice] sendAgentMessage error:', err)
          set({ agentError: 'Something went wrong. Please try again.' })
          // Mark assistant message as error
          set(
            produce((state: EditorStore) => {
              const msg = state.agentMessages.find((m) => m.id === assistantId)
              if (msg && !msg.content) msg.content = '_(agent error)_'
            }),
          )
        }
      } finally {
        _abortController = null
        set({ isAgentStreaming: false })
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Stream event processor
// ---------------------------------------------------------------------------

export async function processStreamEvent(
  event: ServerStreamEvent,
  assistantId: string,
  appendText: (id: string, text: string) => void,
  set: EditorStoreSet,
  get: () => EditorStore,
): Promise<void> {
  switch (event.type) {
    case 'text': {
      const msg = get().agentMessages.find((m) => m.id === assistantId)
      if (msg?.toolCalls.some((toolCall) => toolCall.status === 'error')) break
      appendText(assistantId, event.text)
      break
    }

    case 'actions': {
      // Execute each action in the browser's Zustand store
      const actions = event.actions
      if (!actions.length) break

      // Add tool call placeholders
      const toolCalls: AgentToolCall[] = actions.map((a) => ({
        id: nanoid(),
        source: 'page-builder',
        actionType: a.type,
        params: a,
        result: null,
        status: 'pending' as const,
      }))

      set(
        produce((state: EditorStore) => {
          const msg = state.agentMessages.find((m) => m.id === assistantId)
          if (msg) msg.toolCalls.push(...toolCalls)
        }),
      )

      // Execute (async, but actions are synchronous Zustand mutations)
      const results = await executeAgentActions(actions)
      const hasFailure = results.some((result) => !result.success)

      // Update tool call statuses
      set(
        produce((state: EditorStore) => {
          const msg = state.agentMessages.find((m) => m.id === assistantId)
          if (!msg) return
          toolCalls.forEach((tc, idx) => {
            const found = msg.toolCalls.find((c) => c.id === tc.id)
            if (!found) return
            const res = results[idx]
            if (res) {
              found.result = res
              found.status = res.success ? 'success' : 'error'
            } else if (hasFailure) {
              found.result = {
                success: false,
                error: 'Skipped because a previous action failed.',
              }
              found.status = 'error'
            }
          })
        }),
      )
      if (hasFailure) {
        set(
          produce((state: EditorStore) => {
            state.agentError = 'Some actions could not be completed. The page may be partially updated.'
            const msg = state.agentMessages.find((m) => m.id === assistantId)
            if (!msg || msg.content.includes("couldn't complete all changes")) return
            const notice = "I couldn't complete all changes. Some actions failed, so I stopped before applying the rest."
            msg.content = msg.content.trimEnd()
              ? `${msg.content.trimEnd()}\n\n${notice}`
              : notice
          }),
        )
      }
      break
    }

    case 'toolStatus': {
      set(
        produce((state: EditorStore) => {
          const msg = state.agentMessages.find((m) => m.id === assistantId)
          if (!msg) return

          const existing = msg.toolCalls.find((toolCall) => toolCall.externalId === event.toolCallId)
          if (existing) {
            existing.status = event.status
            existing.params = event.input && typeof event.input === 'object'
              ? event.input as Record<string, unknown>
              : existing.params
            existing.result = event.status === 'pending'
              ? null
              : {
                  success: event.status === 'success',
                  error: event.status === 'error' ? event.error ?? 'Tool call failed.' : undefined,
                }
            return
          }

          msg.toolCalls.push({
            id: nanoid(),
            externalId: event.toolCallId,
            source: 'sdk',
            actionType: event.name,
            params: event.input && typeof event.input === 'object'
              ? event.input as Record<string, unknown>
              : {},
            result: event.status === 'pending'
              ? null
              : {
                  success: event.status === 'success',
                  error: event.status === 'error' ? event.error ?? 'Tool call failed.' : undefined,
                },
            status: event.status,
          })
        }),
      )
      break
    }

    case 'session': {
      const projectId = get().project?.id ?? null
      writeStoredAgentSessionId(projectId, event.sessionId)
      set({
        agentSessionId: event.sessionId,
        agentSessionProjectId: projectId,
      })
      break
    }

    case 'error': {
      // CWE-209 (Constraint #388): server error messages may contain internal
      // details. Log them server-side; propagate only fixed copy to the UI.
      console.error('[AgentSlice] Server error event:', event.message)
      set({ agentError: 'Something went wrong. Please try again.' })
      break
    }

    case 'done':
    case 'actionResult':
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Page context builder
// ---------------------------------------------------------------------------

export function buildPageContext(
  state: EditorStore,
  activePage: import('../page-tree/types').Page | undefined,
): PageContext {
  if (!activePage || !state.project) {
    return {
      pageTitle: 'Untitled',
      rootNodeId: '',
      activeBreakpointId: state.activeBreakpointId,
      breakpoints: [],
      nodes: [],
      availableModules: [],
      selectedNodeId: null,
      classes: [],
      renderSnapshots: [],
    }
  }

  // Build parent map for context
  const parentMap: Record<string, string | null> = {}
  for (const node of Object.values(activePage.nodes)) {
    for (const childId of node.children) {
      parentMap[childId] = node.id
    }
    if (!parentMap[node.id]) parentMap[node.id] = null
  }

  const nodes = Object.values(activePage.nodes).map((node) => ({
    id: node.id,
    moduleId: node.moduleId,
    label: node.label,
    parentId: parentMap[node.id] ?? null,
    children: node.children,
    props: node.props,
    breakpointOverrides: toSerializableBreakpointRecords(node.breakpointOverrides ?? {}),
    classIds: node.classIds ?? [],
  }))

  const availableModules = registry
    .list()
    .filter((mod) => mod.id !== 'base.root')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(moduleDefinitionToAgentContext)

  const classes = Object.values(state.project.classes ?? {}).map((c) => ({
    id: c.id,
    name: c.name,
    styles: toSerializableRecord(c.styles ?? {}),
    breakpointStyles: toSerializableBreakpointStyles(c.breakpointStyles ?? {}),
  }))

  return {
    pageTitle: activePage.title,
    rootNodeId: activePage.rootNodeId,
    activeBreakpointId: state.activeBreakpointId,
    breakpoints: state.project.breakpoints.map((breakpoint) => ({
      id: breakpoint.id,
      label: breakpoint.label,
      width: breakpoint.width,
      icon: breakpoint.icon,
    })),
    nodes,
    availableModules,
    selectedNodeId: state.selectedNodeId,
    classes,
    renderSnapshots: [],
  }
}

export async function buildLivePageContext(
  state: EditorStore,
  activePage: import('../page-tree/types').Page | undefined,
): Promise<PageContext> {
  const context = buildPageContext(state, activePage)
  return {
    ...context,
    renderSnapshots: await collectAgentRenderSnapshots({
      breakpoints: context.breakpoints,
    }),
  }
}

async function buildCurrentLivePageContext(get: () => EditorStore): Promise<PageContext> {
  const storeState = get()
  const activePage = storeState.project?.pages.find(
    (p) => p.id === storeState.activePageId,
  ) ?? storeState.project?.pages[0]
  return buildLivePageContext(storeState, activePage)
}

function moduleDefinitionToAgentContext(mod: AnyModuleDefinition): AgentModuleContext {
  return {
    id: mod.id,
    name: mod.name,
    description: mod.description,
    category: mod.category,
    canHaveChildren: mod.canHaveChildren,
    defaults: toSerializableRecord(mod.defaults ?? {}),
    props: schemaToAgentProps(mod.schema, mod.defaults ?? {}),
    styles: agentStylesForModule(mod),
  }
}

function agentStylesForModule(mod: AnyModuleDefinition): AgentModuleStyleContext[] {
  const styles = styleBindingsToAgentStyles(mod.classStyleBindings ?? {})
  const existingKeys = new Set(styles.map((style) => style.key))
  const extraStyles = genericAgentStyleHintsForModule(mod).filter((style) => !existingKeys.has(style.key))
  return [...styles, ...extraStyles]
}

function genericAgentStyleHintsForModule(mod: AnyModuleDefinition): AgentModuleStyleContext[] {
  if (mod.id === 'base.text' || mod.category.toLowerCase() === 'typography') {
    return [
      { key: 'fontFamily', type: 'text', label: 'Font family', defaultValue: 'inherit', cssProperties: ['fontFamily'] },
      { key: 'fontSize', type: 'text', label: 'Font size', defaultValue: '16px', cssProperties: ['fontSize'] },
      { key: 'fontWeight', type: 'select', label: 'Font weight', defaultValue: '400', cssProperties: ['fontWeight'], options: [
        { label: 'Regular', value: '400' },
        { label: 'Medium', value: '500' },
        { label: 'Semi bold', value: '600' },
        { label: 'Bold', value: '700' },
        { label: 'Black', value: '900' },
      ] },
      { key: 'lineHeight', type: 'text', label: 'Line height', defaultValue: '1.4', cssProperties: ['lineHeight'] },
      { key: 'letterSpacing', type: 'text', label: 'Letter spacing', defaultValue: '0px', cssProperties: ['letterSpacing'] },
      { key: 'color', type: 'color', label: 'Text color', defaultValue: 'inherit', cssProperties: ['color'] },
      { key: 'textAlign', type: 'select', label: 'Text align', defaultValue: 'left', cssProperties: ['textAlign'], options: [
        { label: 'Left', value: 'left' },
        { label: 'Center', value: 'center' },
        { label: 'Right', value: 'right' },
        { label: 'Justify', value: 'justify' },
      ] },
      { key: 'marginBottom', type: 'text', label: 'Bottom margin', defaultValue: '0px', cssProperties: ['marginBottom'] },
    ]
  }

  return []
}

function schemaToAgentProps(
  schema: PropertySchema,
  defaults: Record<string, unknown>,
): AgentModulePropContext[] {
  const props: AgentModulePropContext[] = []

  for (const [key, control] of Object.entries(schema)) {
    if (control.type === 'group') {
      props.push(...schemaToAgentProps(control.children, defaults))
      continue
    }
    props.push(controlToAgentProp(key, control, defaults[key]))
  }

  return props
}

function styleBindingsToAgentStyles(
  bindings: Record<string, ModuleStyleBinding>,
): AgentModuleStyleContext[] {
  return Object.entries(bindings).map(([key, binding]) => {
    const control = binding.control
    const style: AgentModuleStyleContext = {
      key,
      type: control?.type ?? 'style',
      label: binding.label ?? control?.label ?? key,
      description: control?.description,
      defaultValue: toSerializableValue(binding.defaultValue),
      cssProperties: binding.properties.map(String),
    }

    if (control?.type === 'select') {
      style.options = control.options.map((option) => ({
        label: option.label,
        value: toSerializableValue(option.value),
      }))
    }

    return style
  })
}

function controlToAgentProp(
  key: string,
  control: Exclude<PropertyControl, { type: 'group' }>,
  defaultValue: unknown,
): AgentModulePropContext {
  const prop: AgentModulePropContext = {
    key,
    type: control.type,
    label: control.label,
    description: control.description,
    defaultValue: toSerializableValue(defaultValue),
  }

  if (control.type === 'select') {
    prop.options = control.options.map((option) => ({
      label: option.label,
      value: toSerializableValue(option.value),
    }))
  }

  return prop
}

function toSerializableRecord(record: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    result[key] = toSerializableValue(value)
  }
  return result
}

function toSerializableBreakpointStyles(
  breakpointStyles: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return toSerializableBreakpointRecords(breakpointStyles)
}

function toSerializableBreakpointRecords(
  breakpointStyles: Record<string, Partial<Record<string, unknown>>>,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}
  for (const [breakpointId, styles] of Object.entries(breakpointStyles)) {
    result[breakpointId] = toSerializableRecord(styles)
  }
  return result
}

function toSerializableValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) return value.map(toSerializableValue)

  if (typeof value === 'object' && value) {
    const result: Record<string, unknown> = {}
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toSerializableValue(nestedValue)
    }
    return result
  }

  return String(value)
}
