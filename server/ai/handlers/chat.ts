/**
 * POST /admin/api/ai/chat/:scope
 *
 * Opens an NDJSON stream against a chat. Body:
 *   {
 *     conversationId: string,
 *     prompt:         string,
 *     snapshot?:      unknown   // scope-specific per-request context
 *   }
 *
 * The conversation row already carries `(credentialId, modelId)` from when
 * it was created. The handler:
 *   1. Verifies `ai.chat` + ownership of the conversation.
 *   2. Loads + decrypts the credential (rejects if rotated).
 *   3. Resolves the driver for the credential's provider.
 *   4. Builds an `AiStreamRequest` (system prompt + tools + history).
 *      Write tools are filtered out unless the caller has `ai.tools.write`.
 *   5. Persists the user message, then runs `runChat({ ... })`.
 *   6. Streams NDJSON events back as the driver produces them.
 */

import { Type } from '@core/utils/typeboxHelpers'
import { jsonResponse, readValidatedBody, badRequest } from '../../http'
import { requireCapability } from '../../auth/authz'
import type { DbClient } from '../../db/client'
import { createAuditEvent } from '../../repositories/audit'
import {
  appendMessage,
  listMessagesForConversation,
  readConversationForUser,
} from '../conversations/store'
import {
  readCredentialForUser,
  resolveCredentialForDriver,
  touchCredentialLastUsed,
} from '../credentials/store'
import { resolveDriver } from '../drivers'
import { selectToolsForScope } from '../tools'
import {
  buildSiteSystemPrompt,
  type SiteAgentSnapshot,
} from '../tools/site'
import {
  buildContentSystemPrompt,
  type ContentSnapshot,
} from '../tools/content'
import {
  createBridge,
  createConversationsPersister,
  encodeStreamEvent,
  runChat,
} from '../runtime'
import type {
  AiContentBlock,
  AiMessage,
  AiStreamEvent,
  ToolScope,
} from '../runtime/types'
import type { AiStreamRequest } from '../drivers/types'
import type { MessageRecord } from '../conversations/types'

const ChatRequestBodySchema = Type.Object({
  conversationId: Type.String({ minLength: 1 }),
  prompt: Type.String({ minLength: 1 }),
  // snapshot stays loose here — scope-specific shape; tools cast it inside
  // their handlers. The handler narrows below based on the conversation's
  // scope before passing to the system-prompt builder.
  snapshot: Type.Optional(Type.Unknown()),
})

const VALID_SCOPES: ToolScope[] = ['site', 'content', 'data', 'plugin']

/**
 * Match `/admin/api/ai/chat/:scope`. Returns `null` if path doesn't match.
 */
export function tryHandleAiChat(
  req: Request,
  db: DbClient,
  pathname: string,
): Promise<Response> | null {
  if (!pathname.startsWith('/admin/api/ai/chat/')) return null
  const scope = pathname.slice('/admin/api/ai/chat/'.length)
  if (!VALID_SCOPES.includes(scope as ToolScope)) return null
  return handleAiChat(req, db, scope as ToolScope)
}

async function handleAiChat(
  req: Request,
  db: DbClient,
  scope: ToolScope,
): Promise<Response> {
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }

  // `ai.chat` is the read floor for the conversation endpoint — required
  // for every caller. Write tools are filtered separately below based on
  // the caller's `ai.tools.write` capability so a Client granted chat
  // can use the agent for ideas without it being able to mutate the
  // editor store.
  const userOrResponse = await requireCapability(req, db, 'ai.chat')
  if (userOrResponse instanceof Response) return userOrResponse
  const user = userOrResponse

  const chatBody = await readValidatedBody(req, ChatRequestBodySchema)
  if (!chatBody) return badRequest('Invalid request body.')
  const { conversationId, prompt, snapshot } = chatBody

  const conversation = await readConversationForUser(db, user.id, conversationId)
  if (!conversation) {
    return jsonResponse({ error: 'Conversation not found' }, { status: 404 })
  }
  if (conversation.scope !== scope) {
    return jsonResponse(
      { error: `Conversation scope is "${conversation.scope}", not "${scope}".` },
      { status: 400 },
    )
  }
  if (!conversation.credentialId) {
    return jsonResponse(
      { error: 'Conversation has no credential set. Open AI settings to configure a provider.' },
      { status: 400 },
    )
  }

  const credential = await readCredentialForUser(db, user.id, conversation.credentialId)
  if (!credential) {
    return jsonResponse(
      { error: 'Credential not found or no longer accessible.' },
      { status: 404 },
    )
  }
  let resolvedCredential
  try {
    resolvedCredential = await resolveCredentialForDriver(credential)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Credential resolution failed.'
    return jsonResponse({ error: message }, { status: 409 })
  }

  const driver = resolveDriver(credential.providerId)
  // Capability-filtered toolset. Callers without `ai.tools.write` only see
  // read tools registered with the driver — the model has no way to
  // emit a write call. See B6 in the capabilities review.
  const tools = selectToolsForScope(scope, user.capabilities)

  // Append the user's message BEFORE streaming so it's persisted even if
  // the stream aborts mid-response.
  await appendMessage(db, conversation.id, {
    role: 'user',
    content: [{ kind: 'text', text: prompt }],
  })

  const existingMessages = await listMessagesForConversation(db, conversation.id)
  const messages = buildMessageHistory(existingMessages)

  const systemPrompt = buildSystemPromptForScope(scope, snapshot)

  // Capture totals reported by the persister so the audit row can hold
  // them when the stream completes (we read them off the conversation row
  // diff post-stream — see the post-loop block).
  const tokensAtStart = {
    prompt: conversation.promptTokensTotal,
    completion: conversation.completionTokensTotal,
    cost: conversation.costUsdTotal,
  }

  await createAuditEvent(db, {
    actorUserId: user.id,
    action: 'ai.chat.started',
    targetType: 'ai_conversation',
    targetId: conversation.id,
    metadata: {
      scope,
      providerId: credential.providerId,
      modelId: conversation.modelId,
    },
  })

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let streamClosed = false
      let destroyBridge: (() => void) | null = null
      let streamError: string | null = null

      const closeStream = () => {
        if (streamClosed) return
        streamClosed = true
        try { controller.close() } catch { /* already closed */ }
      }
      const emit = (event: AiStreamEvent): void => {
        if (streamClosed) return
        if (event.type === 'error') streamError = event.message
        try {
          controller.enqueue(encodeStreamEvent(event))
        } catch {
          streamClosed = true
        }
      }

      try {
        const { bridgeId, bridge, destroy } = createBridge(emit, req.signal)
        destroyBridge = destroy
        emit({ type: 'bridgeReady', bridgeId })

        const request: AiStreamRequest = {
          systemPrompt,
          // Full conversation history — direct HTTP drivers replay it every
          // turn (there is no server-side session to resume).
          messages,
          tools,
          modelId: conversation.modelId,
          credentials: resolvedCredential,
          signal: req.signal,
          bridge,
          toolContextBase: {
            db,
            userId: user.id,
            scope,
            conversationId: conversation.id,
            snapshot,
          },
        }

        const persister = createConversationsPersister(db, conversation.id, {
          providerId: credential.providerId,
          modelId: conversation.modelId,
        })
        await runChat({ driver, request, persister, emit })

        // Best-effort: record that this credential was used.
        await touchCredentialLastUsed(db, credential.id).catch(() => { /* noop */ })
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        // Full Error preserves the stack trace in the operator's terminal.
        console.error('[ai/chat] stream failed:', err)
        streamError = detail
        emit({ type: 'error', message: `AI chat failed: ${detail}` })
      } finally {
        if (destroyBridge) destroyBridge()
        closeStream()
        // Emit the terminal audit event. Re-read the conversation row to
        // capture the deltas the persister just committed.
        try {
          const post = await readConversationForUser(db, user.id, conversation.id)
          const promptDelta = post ? post.promptTokensTotal - tokensAtStart.prompt : 0
          const completionDelta = post ? post.completionTokensTotal - tokensAtStart.completion : 0
          const costDelta = post ? Number((post.costUsdTotal - tokensAtStart.cost).toFixed(6)) : 0
          await createAuditEvent(db, {
            actorUserId: user.id,
            action: streamError ? 'ai.chat.failed' : 'ai.chat.completed',
            targetType: 'ai_conversation',
            targetId: conversation.id,
            metadata: {
              scope,
              providerId: credential.providerId,
              modelId: conversation.modelId,
              promptTokens: promptDelta,
              completionTokens: completionDelta,
              costUsd: costDelta,
              ...(streamError ? { error: streamError.slice(0, 200) } : {}),
            },
          })
        } catch (auditErr) {
          // Audit failures must never break the user-visible stream — the
          // request already finished by the time we hit this branch.
          console.error('[ai/chat] audit emit failed:', auditErr)
        }
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSystemPromptForScope(
  scope: ToolScope,
  snapshot: unknown,
): string[] {
  if (scope === 'site') {
    // Snapshot type validation lives at the boundary that produced it
    // (the editor's renderEvidence + Phase 3 will add schema validation).
    return buildSiteSystemPrompt((snapshot ?? emptySiteAgentSnapshot()) as SiteAgentSnapshot)
  }
  if (scope === 'content') {
    return buildContentSystemPrompt((snapshot ?? emptyContentSnapshot()) as ContentSnapshot)
  }
  // Other scopes don't have system prompts yet. The driver gets a minimal
  // prompt so the conversation isn't completely contextless.
  return [
    `You are an AI assistant embedded in the "${scope}" workspace of a CMS. ` +
    `No scope-specific tools are wired up yet — respond conversationally only.`,
  ]
}

function emptySiteAgentSnapshot(): SiteAgentSnapshot {
  return {
    page: {
      id: '',
      title: 'Untitled',
      slug: '',
      rootNodeId: '',
      nodes: {},
    } as SiteAgentSnapshot['page'],
    site: {
      pages: [],
      breakpoints: [],
      styleRules: {},
      visualComponents: [],
      settings: { shortcuts: {} },
    } as unknown as SiteAgentSnapshot['site'],
    selectedNodeId: null,
    activeBreakpointId: '',
  }
}

function emptyContentSnapshot(): ContentSnapshot {
  return {
    collections: [],
    activeTableId: null,
    activeDocument: null,
    currentUser: { id: '', displayName: 'Anonymous', email: '' },
  }
}

/**
 * Reconstruct AiMessage history from the persisted MessageRecord rows.
 * Strips the assistant's leading toolCall blocks (they're driver state,
 * not visible history) — keeps text + tool_result-shaped tool messages.
 */
function buildMessageHistory(records: MessageRecord[]): AiMessage[] {
  const out: AiMessage[] = []
  for (const rec of records) {
    if (rec.role === 'user') {
      out.push({ role: 'user', content: rec.content as AiContentBlock[] })
    } else if (rec.role === 'assistant') {
      out.push({ role: 'assistant', content: rec.content as AiContentBlock[] })
    } else if (rec.role === 'tool' && rec.toolCallId) {
      const textBlock = rec.content.find((b) => b.kind === 'text')
      const text = textBlock?.kind === 'text' ? textBlock.text : ''
      out.push({
        role: 'tool',
        toolCallId: rec.toolCallId,
        output: { ok: text === '', data: undefined, error: text || undefined },
      })
    }
  }
  return out
}
