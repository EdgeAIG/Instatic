/**
 * Agent store slice — drives the AI Assistant panel.
 *
 * The browser opens a streaming NDJSON request against AGENT_API_PATH (the
 * Vite proxy forwards to the local Bun agent server, which runs the Claude
 * Agent SDK with ambient Claude Code credentials — Constraint #385).
 *
 * Wire protocol (server → browser, NDJSON, one ServerStreamEvent per line):
 *   bridgeReady   first event; carries bridgeId for tool-result POSTs
 *   text          chunk of assistant text
 *   toolStatus    SDK tool-call lifecycle (read + write tools)
 *   toolRequest   server asks the browser to apply a write tool
 *   session       Claude Agent SDK session id (for follow-up resume)
 *   error         server-side terminal error
 *   done          stream finished cleanly
 *
 * When a `toolRequest` arrives, the browser dispatches it through the
 * executor (which validates inputs and mutates the Zustand store), then
 * POSTs the result to AGENT_TOOL_RESULT_PATH so the server-side MCP tool
 * handler can return the result to Claude. There is no separate <pb:actions>
 * DSL — every page mutation is a real MCP tool call.
 *
 * Guideline #254 (Performance):
 *   Text deltas are batched via rAF buffer before committing to the store
 *   to prevent excessive React re-renders during streaming.
 */

import { nanoid } from 'nanoid'
import type { EditorStore, EditorStoreSliceCreator } from '@site/store/types'
import { registry } from '@core/module-engine/registry'
import type {
  AnyModuleDefinition,
  PropertyControl,
  PropertySchema,
} from '@core/module-engine/types'
import { Type } from '@core/utils/typeboxHelpers'
import type { Page } from '@core/page-tree'
import {
  AGENT_TOOL_RESULT_PATH,
  AI_CONVERSATIONS_PATH,
  AI_DEFAULTS_PATH,
} from './agentConfig'
import { safeParseJson } from '@core/utils/jsonValidate'
import type {
  AgentActionResult,
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
// Scope-agnostic config — the site editor and the content workspace each
// supply their own. See `createAgentSlice(config)` below.
// ---------------------------------------------------------------------------

export type AgentToolScope = 'site' | 'content' | 'data' | 'plugin'

export interface AgentSliceConfig {
  /**
   * Conversation scope. Used in URL paths (`/admin/api/ai/chat/${scope}`,
   * `?scope=${scope}`), conversation-create body, and the per-scope default
   * lookup. Keep it aligned with `server/ai/runtime/types.ts → ToolScope`.
   */
  readonly scope: AgentToolScope
  /**
   * Build the per-request snapshot. The slice has no knowledge of the host
   * store's shape; the config closure pulls from whatever store the host
   * mounted the agent in (site editor reads page tree; content workspace
   * reads active doc + collections).
   */
  buildSnapshot(): unknown
  /**
   * Dispatch a write-tool request. The slice forwards the server's
   * `toolRequest` event to this function and POSTs the result back; the
   * config's implementation talks to the host's bridge (executor.ts for
   * site, contentBridge.ts for content, …).
   */
  dispatchTool(toolName: string, input: unknown): Promise<AgentActionResult>
  /**
   * Optional copy override for the "no AI provider configured" error so
   * each scope can point the user at the right /admin/ai page.
   */
  readonly noProviderMessage?: string
}

// ---------------------------------------------------------------------------
// Stream-event schema
//
// Discriminated union mirrors ServerStreamEvent from ./types. Tool-input
// payloads pass through as Unknown — the executor validates each call's input
// at the dispatch boundary. The schema here catches malformed envelopes from
// the server, which is the failure mode the streaming reader needs to defend
// against.
// ---------------------------------------------------------------------------

const ServerStreamEventSchema = Type.Union([
  Type.Object({ type: Type.Literal('text'), text: Type.String() }),
  Type.Object({
    type: Type.Literal('bridgeReady'),
    bridgeId: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('toolRequest'),
    requestId: Type.String(),
    toolName: Type.String(),
    input: Type.Unknown(),
  }),
  Type.Object({
    type: Type.Literal('toolCall'),
    toolCallId: Type.String(),
    toolName: Type.String(),
    input: Type.Unknown(),
    status: Type.Literal('pending'),
  }),
  Type.Object({
    type: Type.Literal('toolResult'),
    toolCallId: Type.String(),
    toolName: Type.String(),
    ok: Type.Boolean(),
    error: Type.Optional(Type.String()),
  }),
  Type.Object({ type: Type.Literal('session'), sessionId: Type.String() }),
  Type.Object({
    type: Type.Literal('usage'),
    promptTokens: Type.Number(),
    completionTokens: Type.Number(),
    costUsd: Type.Optional(Type.Number()),
  }),
  Type.Object({ type: Type.Literal('done') }),
  Type.Object({ type: Type.Literal('error'), message: Type.String() }),
])

// ---------------------------------------------------------------------------
// Slice interface
// ---------------------------------------------------------------------------

/**
 * Summary view of a conversation as shown in the history popover. Wire shape
 * mirrors `ConversationView` from `server/ai/conversations/types.ts`.
 */
export interface AgentConversationSummary {
  id: string
  title: string
  credentialId: string | null
  modelId: string
  updatedAt: string
}

/**
 * Wire shape returned by `GET /admin/api/ai/conversations/:id`. Used by
 * `loadAgentConversation` to hydrate the visible thread when the user opens
 * a past chat.
 */
interface ConversationDetailWire {
  id: string
  title: string
  credentialId: string | null
  modelId: string
  promptTokensTotal: number
  completionTokensTotal: number
  costUsdTotal: number
  createdAt: string
  updatedAt: string
  contextJson: string | null
  messages: Array<{
    id: string
    position: number
    role: 'user' | 'assistant' | 'tool'
    content: Array<{ kind: 'text'; text: string } | { kind: 'image'; mimeType: string; data: string } | { kind: 'toolCall'; toolCallId: string; toolName: string; input: unknown }>
    toolCallId: string | null
    toolName: string | null
    createdAt: string
  }>
}

export interface AgentSlice {
  // ── UI state ───────────────────────────────────────────────────────────────
  isAgentOpen: boolean
  isAgentStreaming: boolean
  agentMessages: AgentMessage[]
  agentError: string | null
  agentSessionId: string | null
  /**
   * Active conversation row id in `ai_conversations`. Created lazily on the
   * first sendAgentMessage call (uses the site default credential/model);
   * persisted across messages in this editor session. Reset by
   * clearAgentMessages or startNewAgentConversation.
   */
  agentConversationId: string | null
  /** Currently-active (credentialId, modelId) — surfaced by the model picker. */
  agentActiveCredentialId: string | null
  agentActiveModelId: string | null
  /** Conversation summaries for the history popover. */
  agentConversations: AgentConversationSummary[]

  // ── Actions ────────────────────────────────────────────────────────────────
  openAgent(): void
  closeAgent(): void
  toggleAgent(): void

  /**
   * Send a user message and stream the assistant response.
   * Routes via the Vite proxy `/admin/api/ai/chat/site` → local Bun server →
   * driver resolved from the conversation's credential.
   *
   * Creates the conversation row on first call using the site default. If no
   * default is configured server-side, surfaces a "set up a provider" error.
   */
  sendAgentMessage(content: string): Promise<void>

  /** Abort an in-progress streaming request. */
  abortAgent(): void

  /** Clear all messages, reset error state, and forget the active conversation. */
  clearAgentMessages(): void

  /** Fetch the latest conversation list (site scope) for the history popover. */
  loadAgentConversations(): Promise<void>

  /** Load an existing conversation: hydrate messages and set it as active. */
  loadAgentConversation(id: string): Promise<void>

  /**
   * Start a brand-new conversation thread. Same as clearAgentMessages but
   * surfaces a distinct intent: the user wants to start a new chat (the
   * next sendAgentMessage will create a fresh conversation row).
   */
  startNewAgentConversation(): void

  /**
   * Soft-delete a conversation. Clears the active one if it matches.
   */
  deleteAgentConversation(id: string): Promise<void>

  /**
   * Change which credential + model the current conversation uses. If a
   * conversation row exists, PUTs the change so the next send uses the new
   * provider. If no current conversation, stages the values for the next
   * conversation-create call.
   */
  setAgentProvider(credentialId: string, modelId: string): Promise<void>
}

type EditorStoreSet = Parameters<EditorStoreSliceCreator<AgentSlice>>[0]

// Session-id is in-memory only. While the editor stays open, follow-up
// messages reuse the SDK session id (Claude has continuity across the
// thread). On page reload the message thread vanishes too, so starting
// fresh is the right behaviour — we don't want a ghost session from a
// thread the user can no longer see. A future "saved conversations" UI
// will persist threads + their session ids explicitly with a "new chat"
// button to start fresh.

// ---------------------------------------------------------------------------
// Bridge runtime — set on `bridgeReady`, read on `toolRequest`
// ---------------------------------------------------------------------------

export interface AgentBridgeRuntime {
  bridgeId: string | null
}

/**
 * Sink for assistant text deltas. `append` accumulates a delta; `flush`
 * drains accumulated text into the message's blocks immediately. The slice's
 * implementation rAF-batches `append` calls; the toolStatus handler calls
 * `flush` so any pending text lands BEFORE a tool-call block is appended,
 * preserving chronological order in the UI.
 */
export interface AgentTextStreamSink {
  append(assistantId: string, text: string): void
  flush(): void
}

/**
 * Convert the legacy `AgentActionResult` (carries `success`, `nodeId`,
 * `snapshot`) into the new `AiToolOutput` shape (`{ ok, data?, error? }`).
 * The Phase 1 server expects the canonical shape; the executor returns the
 * legacy shape for now to minimise blast radius. Adapter lives here.
 */
function toAiToolOutput(result: AgentActionResult): {
  ok: boolean
  data?: unknown
  error?: string
} {
  if (!result.success) {
    return { ok: false, error: result.error ?? 'Tool call failed.' }
  }
  // Pack the legacy ancillary fields into `data` so the driver can see them.
  // Drivers translate `data` straight into the model's tool_result content.
  const data: Record<string, unknown> = {}
  if (result.nodeId !== undefined) data.nodeId = result.nodeId
  if (result.snapshot !== undefined) data.snapshot = result.snapshot
  return { ok: true, data }
}

async function postToolResult(
  bridgeId: string,
  requestId: string,
  result: AgentActionResult,
  signal: AbortSignal | null,
): Promise<void> {
  try {
    const res = await fetch(AGENT_TOOL_RESULT_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bridgeId,
        requestId,
        result: toAiToolOutput(result),
      }),
      signal: signal ?? undefined,
    })
    if (!res.ok) {
      // 404 means the bridge is gone (stream closed before our POST landed) —
      // expected race during abort. Anything else is a routing/config issue
      // that would silently leave the agent loop hung server-side.
      console.error(
        `[AgentSlice] tool-result POST failed: ${res.status} ${res.statusText}`,
        { bridgeId, requestId },
      )
    }
  } catch (err) {
    // Network failure or user abort. Server cleans up pending tool resolvers
    // when its bridge is destroyed, so Claude's loop fails with a tool error
    // there.
    if (err instanceof Error && err.name === 'AbortError') return
    console.error('[AgentSlice] Failed to post tool-result:', err)
  }
}

// ---------------------------------------------------------------------------
// Conversation bootstrap
//
// On first send we POST to /admin/api/ai/conversations to create a row, then
// reuse its id for every subsequent send in this session. The conversation
// row carries `(credentialId, modelId)`; the chat handler reads them from
// the row.
//
// If no site default exists yet, conversation creation will 400 — the panel
// renders a "no credential configured" banner in that case.
// ---------------------------------------------------------------------------

/**
 * Translate persisted MessageRecord rows back into the in-memory AgentMessage
 * shape (text + toolCall blocks; tool-result messages are folded back into the
 * preceding tool-call block's `result` so the UI renders the same way fresh
 * messages would).
 */
function rehydrateMessages(
  records: ConversationDetailWire['messages'],
): AgentMessage[] {
  const out: AgentMessage[] = []
  const toolCallIndex = new Map<string, AgentToolCall>() // toolCallId → block

  for (const rec of records) {
    if (rec.role === 'tool' && rec.toolCallId) {
      // Fold into the matching tool-call block.
      const existing = toolCallIndex.get(rec.toolCallId)
      if (existing) {
        const errText = rec.content
          .filter((b): b is { kind: 'text'; text: string } => b.kind === 'text')
          .map((b) => b.text)
          .join(' ')
          .trim()
        const ok = errText === ''
        existing.status = ok ? 'success' : 'error'
        existing.result = { success: ok, error: ok ? undefined : errText }
      }
      continue
    }

    const msg: AgentMessage = {
      id: rec.id,
      role: rec.role === 'user' ? 'user' : 'assistant',
      blocks: [],
      timestamp: Date.parse(rec.createdAt) || Date.now(),
    }

    for (const block of rec.content) {
      if (block.kind === 'text') {
        msg.blocks.push({ kind: 'text', text: block.text })
      } else if (block.kind === 'toolCall') {
        const toolCall: AgentToolCall = {
          id: nanoid(),
          externalId: block.toolCallId,
          actionType: block.toolName,
          params: (block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>)
            : {}),
          result: null,
          status: 'pending',
        }
        msg.blocks.push({ kind: 'toolCall', toolCall })
        toolCallIndex.set(block.toolCallId, toolCall)
      }
      // image blocks — skip in v1; could render via <img> later.
    }
    out.push(msg)
  }

  return out
}

interface ScopeDefaultEntry {
  credentialId: string
  modelId: string
}

async function fetchScopeDefault(scope: AgentToolScope): Promise<ScopeDefaultEntry | null> {
  try {
    const res = await fetch(AI_DEFAULTS_PATH)
    if (!res.ok) return null
    const body = await res.json() as { defaults?: Record<string, ScopeDefaultEntry> }
    return body.defaults?.[scope] ?? null
  } catch (err) {
    console.error(`[AgentSlice] Failed to fetch ${scope} default:`, err)
    return null
  }
}

interface CreatedConversation {
  id: string
}

async function createConversationForScope(
  scope: AgentToolScope,
  credentialId: string,
  modelId: string,
  contextJson: string | undefined,
): Promise<CreatedConversation> {
  const res = await fetch(AI_CONVERSATIONS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scope,
      credentialId,
      modelId,
      ...(contextJson ? { contextJson } : {}),
    }),
  })
  if (!res.ok) {
    let detail = `Conversation create failed: ${res.status}`
    try {
      const body = await res.json() as { error?: string }
      if (body?.error) detail = body.error
    } catch { /* fall through */ }
    throw new Error(detail)
  }
  const body = await res.json() as { conversation: CreatedConversation }
  return body.conversation
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

declare module '@site/store/types' {
  interface EditorStore extends AgentSlice {}
}

/**
 * Slice factory — site editor + content workspace each call this with their
 * own scope/snapshot/dispatcher config. Returns a Zustand state creator the
 * host store composes via the usual `...createAgentSlice(config)(...args)`
 * spread.
 *
 * Return type is intentionally an `EditorStoreSliceCreator<AgentSlice>` so
 * the site editor's existing composition keeps working. The content
 * workspace's standalone AgentSlice-only store calls it with a small cast
 * (see `contentAgentStore.ts`) — both at compile time and at runtime the
 * slice only touches AgentSlice keys, so wider stores compose cleanly.
 */
export function createAgentSlice(
  config: AgentSliceConfig,
): EditorStoreSliceCreator<AgentSlice> {
  return (set, get) => {
  // AbortController held in closure (not reactive — intentional, not needed in UI)
  let _abortController: AbortController | null = null

  // rAF-buffered text accumulation (Guideline #254). Pending deltas are
  // flushed once per animation frame, OR explicitly before any tool-call
  // block is added so chronological ordering is preserved.
  let _pendingText = ''
  let _pendingAssistantId = ''
  let _rafHandle = 0

  /**
   * Append `text` to the last text block of `msg`, or push a new text block
   * if the trailing block is a tool call. This is what keeps text/tool
   * ordering chronological — text that arrives after a tool call goes into
   * its own block AFTER the tool, not concatenated into earlier text.
   */
  function appendTextToBlocks(msg: AgentMessage, text: string): void {
    const last = msg.blocks[msg.blocks.length - 1]
    if (last && last.kind === 'text') {
      last.text += text
    } else {
      msg.blocks.push({ kind: 'text', text })
    }
  }

  function flushPendingText() {
    _rafHandle = 0
    if (!_pendingText || !_pendingAssistantId) return
    const text = _pendingText
    const id = _pendingAssistantId
    _pendingText = ''
    set((state) => {
      const msg = state.agentMessages.find((m) => m.id === id)
      if (msg) appendTextToBlocks(msg, text)
    })
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

  // Single text-stream sink passed into processStreamEvent. The sink's
  // `flush()` is called from the toolStatus handler to drain any pending
  // text deltas BEFORE a tool-call block is added — that's what keeps the
  // visual order in the panel chronologically correct.
  const textSink: AgentTextStreamSink = {
    append: appendTextDelta,
    flush: flushPendingText,
  }

  return {
    // ── State ────────────────────────────────────────────────────────────────
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    agentSessionId: null,
    agentConversationId: null,
    agentActiveCredentialId: null,
    agentActiveModelId: null,
    agentConversations: [],

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
      set({
        agentMessages: [],
        agentError: null,
        agentSessionId: null,
        agentConversationId: null,
        agentActiveCredentialId: null,
        agentActiveModelId: null,
      })
    },

    startNewAgentConversation() {
      // Same shape as clearAgentMessages — kept as a separate action for
      // intent clarity (the UI's "+ New chat" button calls this).
      set({
        agentMessages: [],
        agentError: null,
        agentSessionId: null,
        agentConversationId: null,
        agentActiveCredentialId: null,
        agentActiveModelId: null,
      })
    },

    async loadAgentConversations() {
      try {
        const res = await fetch(`${AI_CONVERSATIONS_PATH}?scope=${config.scope}`)
        if (!res.ok) return
        const body = await res.json() as { conversations: AgentConversationSummary[] }
        set({ agentConversations: body.conversations })
      } catch (err) {
        console.error('[AgentSlice] Failed to load conversations:', err)
      }
    },

    async loadAgentConversation(id: string) {
      try {
        const res = await fetch(`${AI_CONVERSATIONS_PATH}/${encodeURIComponent(id)}`)
        if (!res.ok) {
          set({ agentError: 'Conversation not found.' })
          return
        }
        const body = await res.json() as { conversation: ConversationDetailWire }
        set({
          agentConversationId: body.conversation.id,
          agentActiveCredentialId: body.conversation.credentialId,
          agentActiveModelId: body.conversation.modelId,
          agentMessages: rehydrateMessages(body.conversation.messages),
          agentError: null,
        })
      } catch (err) {
        console.error('[AgentSlice] Failed to load conversation:', err)
        set({ agentError: 'Failed to load conversation.' })
      }
    },

    async deleteAgentConversation(id: string) {
      try {
        const res = await fetch(`${AI_CONVERSATIONS_PATH}/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        })
        if (!res.ok) return
        set((state) => {
          state.agentConversations = state.agentConversations.filter((c) => c.id !== id)
          if (state.agentConversationId === id) {
            state.agentConversationId = null
            state.agentMessages = []
            state.agentActiveCredentialId = null
            state.agentActiveModelId = null
          }
        })
      } catch (err) {
        console.error('[AgentSlice] Failed to delete conversation:', err)
      }
    },

    async setAgentProvider(credentialId: string, modelId: string) {
      const currentId = get().agentConversationId
      // Always reflect the picker selection locally so the dropdown's
      // displayed value updates immediately.
      set({ agentActiveCredentialId: credentialId, agentActiveModelId: modelId })
      if (!currentId) return  // staged for the next conversation-create call
      try {
        const res = await fetch(`${AI_CONVERSATIONS_PATH}/${encodeURIComponent(currentId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ credentialId, modelId }),
        })
        if (!res.ok) {
          set({ agentError: 'Failed to update conversation provider.' })
        }
      } catch (err) {
        console.error('[AgentSlice] Failed to update provider:', err)
        set({ agentError: 'Failed to update conversation provider.' })
      }
    },

    // ── sendAgentMessage ─────────────────────────────────────────────────────
    async sendAgentMessage(content) {
      if (get().isAgentStreaming) return // one request at a time

      const userMsg: AgentMessage = {
        id: nanoid(),
        role: 'user',
        blocks: [{ kind: 'text', text: content }],
        timestamp: Date.now(),
      }

      const assistantId = nanoid()
      const assistantMsg: AgentMessage = {
        id: assistantId,
        role: 'assistant',
        blocks: [],
        timestamp: Date.now(),
      }

      set((state) => {
        state.agentMessages.push(userMsg)
        state.agentMessages.push(assistantMsg)
        state.agentError = null
        state.isAgentStreaming = true
      })

      _abortController = new AbortController()
      const bridge: AgentBridgeRuntime = { bridgeId: null }

      try {
        const snapshot = config.buildSnapshot()

        // Ensure we have a conversation row before streaming. Created lazily
        // from the staged picker values OR the scope default. If neither, we
        // surface a clear actionable error.
        let conversationId = get().agentConversationId
        if (!conversationId) {
          const staged = {
            credentialId: get().agentActiveCredentialId,
            modelId: get().agentActiveModelId,
          }
          let credentialId = staged.credentialId
          let modelId = staged.modelId
          if (!credentialId || !modelId) {
            const scopeDefault = await fetchScopeDefault(config.scope)
            if (!scopeDefault) {
              set({
                agentError:
                  config.noProviderMessage
                  ?? `No AI provider configured for the "${config.scope}" scope. Open /admin/ai/providers to add a credential, then /admin/ai/defaults to pick one.`,
              })
              set((state) => {
                const msg = state.agentMessages.find((m) => m.id === assistantId)
                if (msg && msg.blocks.length === 0) {
                  msg.blocks.push({ kind: 'text', text: '_(no AI provider configured)_' })
                }
              })
              return
            }
            credentialId = scopeDefault.credentialId
            modelId = scopeDefault.modelId
          }
          const conv = await createConversationForScope(
            config.scope,
            credentialId,
            modelId,
            JSON.stringify(snapshot),
          )
          conversationId = conv.id
          set({
            agentConversationId: conversationId,
            agentActiveCredentialId: credentialId,
            agentActiveModelId: modelId,
          })
        }

        const body: AgentRequestBody = {
          conversationId,
          prompt: content,
          snapshot,
        }
        const res = await fetch(`/admin/api/ai/chat/${config.scope}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: _abortController.signal,
        })

        if (!res.ok) {
          if (res.status === 502) {
            console.error('[AgentSlice] 502 — agent server unreachable')
            set({ agentError: 'AI server is not running. Start it with: bun run dev' })
            set((state) => {
              const msg = state.agentMessages.find((m) => m.id === assistantId)
              if (msg && msg.blocks.length === 0) {
                msg.blocks.push({ kind: 'text', text: '_(agent error)_' })
              }
            })
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
            const parsed = safeParseJson(trimmed, ServerStreamEventSchema)
            if (!parsed.ok) continue
            const event = parsed.value as ServerStreamEvent
            await processStreamEvent(
              event,
              assistantId,
              textSink,
              set,
              bridge,
              _abortController?.signal ?? null,
              config.dispatchTool,
            )
          }
        }

        flushPendingText()
      } catch (err) {
        // Abort the fetch so any in-flight MCP tool handler on the server
        // rejects cleanly (via destroyBridge in the stream's finally block)
        // instead of waiting forever for a tool-result that won't arrive.
        _abortController?.abort()

        if (err instanceof Error && err.name === 'AbortError') {
          flushPendingText()
        } else {
          // Admin-only surface (capability gated) — show the actual
          // failure cause so the operator can act. Network / unexpected
          // throws still get a prefix so they're distinguishable from
          // server-classified driver errors.
          const detail = err instanceof Error ? err.message : String(err)
          console.error('[AgentSlice] sendAgentMessage error:', err)
          set({ agentError: `Agent request failed: ${detail}` })
          set((state) => {
            const msg = state.agentMessages.find((m) => m.id === assistantId)
            if (msg && msg.blocks.length === 0) {
              msg.blocks.push({ kind: 'text', text: '_(agent error)_' })
            }
          })
        }
      } finally {
        _abortController = null
        set({ isAgentStreaming: false })
      }
    },
  }
  }
}

// ---------------------------------------------------------------------------
// Stream event processor
// ---------------------------------------------------------------------------

export async function processStreamEvent(
  event: ServerStreamEvent,
  assistantId: string,
  textSink: AgentTextStreamSink,
  set: EditorStoreSet,
  bridge: AgentBridgeRuntime,
  signal: AbortSignal | null,
  dispatchTool: (toolName: string, input: unknown) => Promise<AgentActionResult>,
): Promise<void> {
  switch (event.type) {
    case 'text': {
      textSink.append(assistantId, event.text)
      break
    }

    case 'bridgeReady': {
      bridge.bridgeId = event.bridgeId
      break
    }

    case 'toolRequest': {
      // Defensive: the dispatcher already converts caught throws into
      // `{ success: false, error }`, but if anything ever escapes (or if
      // the bridge evolves) we still need to ALWAYS POST a result so the
      // server's bridge resolver fires and the driver loop sees a tool
      // error rather than hanging forever.
      let result: AgentActionResult
      try {
        result = await dispatchTool(event.toolName, event.input)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.error(`[AgentSlice] tool ${event.toolName} threw unexpectedly:`, err)
        result = { success: false, error: `Browser exception: ${message}` }
      }
      if (!bridge.bridgeId) {
        console.error('[AgentSlice] toolRequest received before bridgeReady')
        break
      }
      await postToolResult(bridge.bridgeId, event.requestId, result, signal)
      break
    }

    case 'toolCall': {
      // Driver issued a tool call (status: pending). Drain any pending text
      // deltas BEFORE adding the block so the chronological order
      // text → tool → text is preserved.
      textSink.flush()
      set((state) => {
        const msg = state.agentMessages.find((m) => m.id === assistantId)
        if (!msg) return
        const inputAsRecord = event.input && typeof event.input === 'object'
          ? (event.input as Record<string, unknown>)
          : null
        const existing = msg.blocks.find(
          (block): block is { kind: 'toolCall'; toolCall: AgentToolCall } =>
            block.kind === 'toolCall' && block.toolCall.externalId === event.toolCallId,
        )
        if (existing) {
          // Re-emitted (e.g. Anthropic's content_block_start then _stop):
          // refresh the input but keep the pending status.
          if (inputAsRecord) existing.toolCall.params = inputAsRecord
          return
        }
        msg.blocks.push({
          kind: 'toolCall',
          toolCall: {
            id: nanoid(),
            externalId: event.toolCallId,
            actionType: event.toolName,
            params: inputAsRecord ?? {},
            result: null,
            status: 'pending',
          },
        })
      })
      break
    }

    case 'toolResult': {
      // Paired with the preceding `toolCall` (matched by toolCallId).
      // Flip its status to success/error + attach the result envelope so
      // the UI can render any failure message inline with the badge.
      textSink.flush()
      set((state) => {
        const msg = state.agentMessages.find((m) => m.id === assistantId)
        if (!msg) return
        const block = msg.blocks.find(
          (b): b is { kind: 'toolCall'; toolCall: AgentToolCall } =>
            b.kind === 'toolCall' && b.toolCall.externalId === event.toolCallId,
        )
        if (!block) return
        block.toolCall.status = event.ok ? 'success' : 'error'
        block.toolCall.result = {
          success: event.ok,
          error: event.ok ? undefined : event.error ?? 'Tool call failed.',
        }
      })
      break
    }

    case 'usage': {
      // Token + cost totals — persisted server-side automatically. Nothing
      // to do in the UI for now (Phase 6 surfaces these in the audit page).
      break
    }

    case 'session': {
      set({
        agentSessionId: event.sessionId,
      })
      break
    }

    case 'error': {
      // Surface the server's error message verbatim — drivers already
      // classify and shape these to be user-facing (auth/billing/quota
      // shows actionable copy, raw stack traces are stripped at the driver
      // boundary). The admin needs the actual reason, not a "Something
      // went wrong" placeholder; this surface is admin-only (capability
      // gated) so info-disclosure concerns don't apply.
      console.error('[AgentSlice] Server error event:', event.message)
      set({ agentError: event.message })
      break
    }

    case 'done':
    default:
      break
  }
}

// ---------------------------------------------------------------------------
// Page context builder
// ---------------------------------------------------------------------------

export function buildPageContext(
  state: EditorStore,
  activePage: Page | undefined,
): PageContext {
  if (!activePage || !state.site) {
    return {
      pageId: '',
      pageTitle: 'Untitled',
      rootNodeId: '',
      pages: [],
      activeBreakpointId: state.activeBreakpointId,
      breakpoints: [],
      nodes: [],
      availableModules: [],
      selectedNodeId: null,
      classes: [],
    }
  }

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
    .filter((mod) => mod.id !== 'base.body')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(moduleDefinitionToAgentContext)

  const classes = Object.values(state.site.classes ?? {}).map((c) => ({
    id: c.id,
    name: c.name,
    styles: toSerializableRecord(c.styles ?? {}),
    breakpointStyles: toSerializableBreakpointStyles(c.breakpointStyles ?? {}),
  }))

  const pages = state.site.pages.map((page) => ({
    id: page.id,
    title: page.title,
    slug: page.slug,
    active: page.id === activePage.id,
    isHomepage: page.slug === 'index',
  }))

  return {
    pageId: activePage.id,
    pageTitle: activePage.title,
    rootNodeId: activePage.rootNodeId,
    pages,
    activeBreakpointId: state.activeBreakpointId,
    breakpoints: state.site.breakpoints.map((breakpoint) => ({
      id: breakpoint.id,
      label: breakpoint.label,
      width: breakpoint.width,
      icon: breakpoint.icon,
    })),
    nodes,
    availableModules,
    selectedNodeId: state.selectedNodeId,
    classes,
  }
}

/**
 * Convenience wrapper around `buildPageContext` — looks up the active
 * page on the store and forwards it. Exported so the site editor's
 * agent-slice config can drop it straight into `buildSnapshot`.
 */
export function buildCurrentPageContext(get: () => EditorStore): PageContext {
  const storeState = get()
  const activePage = storeState.site?.pages.find(
    (p) => p.id === storeState.activePageId,
  ) ?? storeState.site?.pages[0]
  return buildPageContext(storeState, activePage)
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
    styles: genericAgentStyleHintsForModule(mod),
  }
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

  if (control.breakpointOverridable === true) {
    prop.breakpointOverridable = true
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
