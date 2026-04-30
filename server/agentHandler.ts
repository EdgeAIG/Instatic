/**
 * Phase D — Agent server endpoint handler.
 *
 * Uses the Claude Agent SDK (@anthropic-ai/claude-agent-sdk) to run
 * Claude as a page builder assistant. Streams NDJSON back to the browser.
 *
 * Auth: ambient Claude Code credentials (claude auth login) — Constraint #385.
 * No API key, no endpoint URL, no environment variable required.
 *
 * Architecture:
 * - Browser POSTs { prompt, messages, pageContext }
 * - This handler runs query() with a custom system prompt + tools: []
 * - Claude responds with text that may include <pb:actions> JSON blocks
 * - Handler parses action blocks, validates the JSON, streams events:
 *     { type: "text", text: "..." }
 *     { type: "actions", actions: [...] }
 *     { type: "done" }
 *     { type: "error", message: "..." }
 *
 * Constraint #272 — tool calls validated before dispatch:
 * The server validates action JSON structure before forwarding.
 * Full Zod validation happens in the browser executor (executor.ts).
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk'
import { buildSystemPrompt } from '../src/core/agent/systemPrompt'
import {
  buildAgentResponseEventsFromText,
  createAgentResponseStreamParser,
  type AgentResponseStreamParser,
} from '../src/core/agent/actionBlocks'
import { createPageBuilderMcpServer } from './agentTools'
import type {
  AgentRequestBody,
  ServerStreamEvent,
} from '../src/core/agent/types'

// ---------------------------------------------------------------------------
// NDJSON stream helpers
// ---------------------------------------------------------------------------

function encodeEvent(event: ServerStreamEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + '\n')
}

// ---------------------------------------------------------------------------
// SDK stream translation
// ---------------------------------------------------------------------------

interface StreamingToolState {
  id: string
  name: string
  inputJson: string
}

export interface AgentSdkStreamState {
  sessionId: string | null
  sawPartialAssistantMessage: boolean
  textParser: AgentResponseStreamParser
  toolsByIndex: Map<number, StreamingToolState>
  toolNamesById: Map<string, string>
}

export function createAgentSdkStreamState(): AgentSdkStreamState {
  return {
    sessionId: null,
    sawPartialAssistantMessage: false,
    textParser: createAgentResponseStreamParser(),
    toolsByIndex: new Map(),
    toolNamesById: new Map(),
  }
}

export function getServerStreamEventsFromSdkMessage(
  message: unknown,
  state: AgentSdkStreamState,
): ServerStreamEvent[] {
  const sdkMessage = message as { type?: string }
  const events = getSessionEventsFromSdkMessage(message, state)

  if (sdkMessage.type === 'stream_event') {
    state.sawPartialAssistantMessage = true
    events.push(...getServerStreamEventsFromPartialMessage(message, state))
    return events
  }

  if (sdkMessage.type === 'assistant') {
    if (!state.sawPartialAssistantMessage) {
      events.push(...getServerStreamEventsFromCompleteAssistantMessage(message, state))
    }
    return events
  }

  if (sdkMessage.type === 'user') {
    events.push(...getServerStreamEventsFromUserMessage(message, state))
    return events
  }

  return events
}

function getSessionEventsFromSdkMessage(
  message: unknown,
  state: AgentSdkStreamState,
): ServerStreamEvent[] {
  const sessionId = getSdkSessionId(message)
  if (!sessionId || sessionId === state.sessionId) return []
  state.sessionId = sessionId
  return [{ type: 'session', sessionId }]
}

function getSdkSessionId(message: unknown): string | null {
  const sessionId = (message as { session_id?: unknown }).session_id
  return typeof sessionId === 'string' && sessionId.trim()
    ? sessionId.trim()
    : null
}

function getServerStreamEventsFromPartialMessage(
  message: unknown,
  state: AgentSdkStreamState,
): ServerStreamEvent[] {
  const event = (message as { event?: Record<string, unknown> }).event
  if (!event) return []

  if (event.type === 'content_block_delta') {
    const delta = event.delta as Record<string, unknown> | undefined
    if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return state.textParser.push(delta.text)
    }
    if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      const tool = state.toolsByIndex.get(Number(event.index))
      if (tool) tool.inputJson += delta.partial_json
    }
    return []
  }

  if (event.type === 'content_block_start') {
    const block = event.content_block as Record<string, unknown> | undefined
    if (block?.type !== 'tool_use') return []

    const index = Number(event.index)
    const id = typeof block.id === 'string' ? block.id : `tool-${index}`
    const name = typeof block.name === 'string' ? block.name : 'tool'
    const input = block.input
    state.toolsByIndex.set(index, {
      id,
      name,
      inputJson: typeof input === 'string' ? input : '',
    })
    state.toolNamesById.set(id, name)
    return [{
      type: 'toolStatus',
      toolCallId: id,
      name,
      status: 'pending',
      input: input ?? {},
    }]
  }

  if (event.type === 'content_block_stop') {
    const index = Number(event.index)
    const tool = state.toolsByIndex.get(index)
    if (!tool) return []
    state.toolsByIndex.delete(index)
    const input = parseMaybeJson(tool.inputJson)
    return [{
      type: 'toolStatus',
      toolCallId: tool.id,
      name: tool.name,
      status: 'pending',
      input: input ?? {},
    }]
  }

  if (event.type === 'message_stop') {
    return state.textParser.flush()
  }

  return []
}

function getServerStreamEventsFromCompleteAssistantMessage(
  message: unknown,
  state: AgentSdkStreamState,
): ServerStreamEvent[] {
  const events: ServerStreamEvent[] = []
  const blocks = getMessageContentBlocks(message)
  let text = ''

  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      text += block.text
      continue
    }

    if (block.type === 'tool_use') {
      const id = typeof block.id === 'string' ? block.id : `tool-${state.toolNamesById.size + 1}`
      const name = typeof block.name === 'string' ? block.name : 'tool'
      state.toolNamesById.set(id, name)
      events.push({
        type: 'toolStatus',
        toolCallId: id,
        name,
        status: 'pending',
        input: block.input ?? {},
      })
    }
  }

  events.unshift(...buildAgentResponseEventsFromText(text))
  return events
}

function getServerStreamEventsFromUserMessage(
  message: unknown,
  state: AgentSdkStreamState,
): ServerStreamEvent[] {
  return getMessageContentBlocks(message)
    .filter((block) => block.type === 'tool_result' && typeof block.tool_use_id === 'string')
    .map((block): ServerStreamEvent => {
      const toolCallId = String(block.tool_use_id)
      return {
        type: 'toolStatus',
        toolCallId,
        name: state.toolNamesById.get(toolCallId) ?? 'tool',
        status: block.is_error ? 'error' : 'success',
        error: block.is_error ? 'Tool call failed.' : undefined,
      }
    })
}

function getMessageContentBlocks(message: unknown): Array<Record<string, unknown>> {
  const content = (message as { message?: { content?: unknown } }).message?.content
  return Array.isArray(content)
    ? content.filter((block): block is Record<string, unknown> => Boolean(block) && typeof block === 'object')
    : []
}

function parseMaybeJson(value: string): unknown {
  if (!value.trim()) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

// ---------------------------------------------------------------------------
// SDK query options
// ---------------------------------------------------------------------------

const PAGE_BUILDER_ALLOWED_TOOLS = [
  'mcp__page_builder__list_modules',
  'mcp__page_builder__list_classes',
  'mcp__page_builder__list_breakpoints',
  'mcp__page_builder__inspect_page',
  'mcp__page_builder__search_nodes',
  'mcp__page_builder__inspect_node',
  'mcp__page_builder__inspect_class',
  'mcp__page_builder__inspect_layout',
  'mcp__page_builder__render_snapshot',
]

const DISALLOWED_CLAUDE_TOOLS = [
  'Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep',
  'WebFetch', 'WebSearch', 'TodoWrite',
]

type PageBuilderMcpServer = ReturnType<typeof createPageBuilderMcpServer>

export function buildAgentQueryOptions({
  systemPrompt,
  pageBuilderMcpServer,
  sessionId,
}: {
  systemPrompt: string
  pageBuilderMcpServer: PageBuilderMcpServer
  sessionId?: string
}): Options {
  const options: Options = {
    systemPrompt,
    cwd: process.cwd(),
    // Disable ALL Claude Code built-in tools — Claude only uses page-builder MCP.
    tools: [],
    mcpServers: {
      page_builder: pageBuilderMcpServer,
    },
    includePartialMessages: true,
    allowedTools: PAGE_BUILDER_ALLOWED_TOOLS,
    // Prevent Claude Code from writing to the filesystem.
    disallowedTools: DISALLOWED_CLAUDE_TOOLS,
  }

  if (sessionId) options.resume = sessionId

  return options
}

function normalizeResumeSessionId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

// ---------------------------------------------------------------------------
// handleAgentRequest
// ---------------------------------------------------------------------------

/**
 * Handle a POST /api/agent request.
 * Returns a streaming Response with NDJSON lines.
 */
export async function handleAgentRequest(req: Request): Promise<Response> {
  // CORS preflight handled by the server before reaching here.
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let body: AgentRequestBody
  try {
    body = (await req.json()) as AgentRequestBody
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  const { prompt, pageContext } = body
  if (!prompt || typeof prompt !== 'string') {
    return new Response('Missing prompt', { status: 400 })
  }

  const systemPrompt = buildSystemPrompt(pageContext)
  const pageBuilderMcpServer = createPageBuilderMcpServer(pageContext)
  const resumeSessionId = normalizeResumeSessionId(body.sessionId)

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const streamState = createAgentSdkStreamState()

        for await (const message of query({
          prompt,
          options: buildAgentQueryOptions({
            systemPrompt,
            pageBuilderMcpServer,
            sessionId: resumeSessionId,
          }),
        })) {
          for (const event of getServerStreamEventsFromSdkMessage(message, streamState)) {
            controller.enqueue(encodeEvent(event))
          }

          if (message.type === 'assistant') {
            // Guard: SDK sets message.error instead of message.message on auth/billing failure
            // Constraint #388: log server-side, never forward raw SDK error details to browser
            const sdkMsg = message as {
              type: 'assistant'
              message?: { content: Array<{ type: string; text?: string }> }
              error?: unknown
            }
            if (!sdkMsg.message) {
              console.error('[agentHandler] SDK assistant message unavailable (auth/billing error):', sdkMsg.error)
              controller.enqueue(
                encodeEvent({ type: 'error', message: 'Agent authentication or billing error. Check your Claude credentials.' }),
              )
              controller.close()
              return
            }
          } else if (message.type === 'result') {
            // Check for result-level error (safety refusal, context overflow, etc.)
            // Constraint #388: log errors server-side, never forward raw SDK content to browser
            const resultMsg = message as {
              type: 'result'
              is_error?: boolean
              subtype?: string
              errors?: string[]
            }
            if (resultMsg.is_error) {
              console.error('[agentHandler] SDK result error:', resultMsg.subtype, resultMsg.errors)
              controller.enqueue(
                encodeEvent({ type: 'error', message: 'Agent session ended with an error. Please try again.' }),
              )
              controller.close()
              return
            }
          }
        }

        controller.enqueue(encodeEvent({ type: 'done' }))
        controller.close()
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        console.error('[agentHandler] query failed:', message)
        // Emit error event then close
        try {
          controller.enqueue(encodeEvent({ type: 'error', message: 'Agent session failed. Please try again.' }))
          controller.close()
        } catch {
          // Controller already closed
        }
      }
    },
  })

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no', // disable Nginx proxy buffering for SSE
    },
  })
}
