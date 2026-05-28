/**
 * OpenAI driver — `@openai/agents` SDK.
 *
 * Auth:
 *   API key only. Driver constructs a per-call `OpenAIProvider({ apiKey })`
 *   and wires it via a per-call `Runner({ modelProvider })`. The host
 *   process env is never mutated; concurrent chats with different keys
 *   don't race.
 *
 * Tool registration:
 *   AiTool inputSchemas are TypeBox; the SDK's `tool()` accepts JSON Schema
 *   directly when called with `strict: false`. We strip TypeBox's symbol
 *   metadata via `JSON.parse(JSON.stringify(schema))` and force
 *   `additionalProperties: true` (non-strict).
 *
 * Streaming:
 *   `Runner.run(agent, input, { stream: true })` returns a `StreamedRunResult`
 *   which is `AsyncIterable<RunStreamEvent>`. Driver normalises three flavours
 *   into canonical AiStreamEvent:
 *     - `RunRawModelStreamEvent` with `data.type === 'output_text_delta'`
 *                          → `{ type: 'text', text }`
 *     - `RunItemStreamEvent` with `name === 'tool_called'`
 *                          → `{ type: 'toolCall', ... }`
 *     - `RunItemStreamEvent` with `name === 'tool_output'`
 *                          → `{ type: 'toolResult', ... }`
 *     - `RunRawModelStreamEvent` with `data.type === 'response_done'`
 *                          → `{ type: 'usage', ... }`
 *
 * Tool routing:
 *   Each SDK tool's `execute` calls our handler (for server-side tools) or
 *   `bridge.callBrowser(name, input)` (for browser-bridged tools). The SDK's
 *   internal loop drives tool calls automatically; the result returns to the
 *   model on the next turn.
 *
 * Gated by `ai-driver-isolation.test.ts` — this is the only legal importer
 * of `@openai/agents` in the repo.
 */

import {
  Agent,
  MaxTurnsExceededError,
  Runner,
  tool,
  type RunStreamEvent,
} from '@openai/agents'
import { OpenAIProvider } from '@openai/agents'
import { parseValue } from '@core/utils/typeboxHelpers'

// Locally inlined — the SDK's helper types `JsonObjectSchema` and
// `JsonSchemaDefinitionEntry` aren't part of its public surface. The shape
// here matches `JsonObjectSchemaNonStrict<...>` from
// node_modules/@openai/agents-core/dist/types/helpers.d.ts.
type OpenAiJsonObjectSchema = {
  type: 'object'
  properties: Record<string, Record<string, unknown>>
  required: string[]
  additionalProperties: true
  description?: string
}
import type {
  AiAuthMode,
  AiMessage,
  AiProviderId,
  AiStreamEvent,
  AiTool,
  AiToolOutput,
  ToolContext,
} from '../runtime/types'
import type {
  AiProvider,
  AiProviderModel,
  AiResolvedCredential,
  AiStreamRequest,
} from './types'

const SUPPORTED_AUTH_MODES: AiAuthMode[] = ['apiKey']

// Static model list — current as of May 2026. Same maintenance pattern as
// anthropic.ts (one update per provider release cycle; the alternative of
// hitting `client.models.list` on every model-picker open is too slow).
//
// Sources:
//   - https://developers.openai.com/api/docs/models/all
//   - https://developers.openai.com/api/docs/models/gpt-5.5
//   - https://developers.openai.com/api/docs/models/gpt-5.4
const MODELS: AiProviderModel[] = [
  {
    id: 'gpt-5.5',
    label: 'GPT-5.5',
    tier: 'smartest',
    capabilities: { toolCalling: true, visionInput: true, promptCache: false, streaming: true },
  },
  {
    id: 'gpt-5.4',
    label: 'GPT-5.4',
    tier: 'smart',
    capabilities: { toolCalling: true, visionInput: true, promptCache: false, streaming: true },
  },
  {
    id: 'gpt-5.4-mini',
    label: 'GPT-5.4 Mini',
    tier: 'fast',
    capabilities: { toolCalling: true, visionInput: true, promptCache: false, streaming: true },
  },
  {
    id: 'gpt-5.4-nano',
    label: 'GPT-5.4 Nano',
    tier: 'cheap',
    capabilities: { toolCalling: true, visionInput: true, promptCache: false, streaming: true },
  },
]

export const openaiDriver: AiProvider = {
  id: 'openai' as AiProviderId,
  label: 'OpenAI',
  supportedAuthModes: SUPPORTED_AUTH_MODES,

  capabilities(modelId: string) {
    const model = MODELS.find((m) => m.id === modelId)
    return model?.capabilities ?? {
      toolCalling: true,
      visionInput: false,
      promptCache: false,
      streaming: true,
    }
  },

  async listModels(_creds: AiResolvedCredential) {
    return MODELS
  },

  async *stream(req: AiStreamRequest): AsyncIterable<AiStreamEvent> {
    yield* runOpenAiStream(req)
  },
}

// ---------------------------------------------------------------------------
// Stream loop
// ---------------------------------------------------------------------------

async function* runOpenAiStream(req: AiStreamRequest): AsyncIterable<AiStreamEvent> {
  // Defensive: a non-apiKey credential reaching the driver implies a
  // mismatched DB row or a bypassed UI. Fail cleanly instead of letting
  // the SDK respond with a generic 401.
  if (req.credentials.authMode !== 'apiKey' || !req.credentials.apiKey) {
    yield {
      type: 'error',
      message:
        'OpenAI requires an API key. Add an API-key credential in /admin/ai/providers and pick it for the site default.',
    }
    return
  }

  const agent = buildAgent(req)
  const runner = buildRunner(req.credentials)
  const input = serialiseLastUserMessage(req.messages)

  try {
    const result = await runner.run(agent, input, {
      stream: true,
      signal: req.signal,
      // No cap on tool-call iterations. The SDK defaults to 10
      // (DEFAULT_MAX_TURNS in @openai/agents-core/runner/constants),
      // which is a silent safety belt that surfaces as a confusing
      // mid-build error. Passing `null` disables the check at
      // turnPreparation.mjs:15. The model itself decides when to stop;
      // cost is bounded by the user's token budget + the abort button
      // in the UI, not by an arbitrary turn count.
      maxTurns: null,
    })
    for await (const event of result) {
      const translated = translateEvent(event)
      if (translated) yield translated
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'OpenAI stream failed.'
    console.error('[ai/openai] stream error:', detail)
    // MaxTurnsExceeded should be unreachable now that maxTurns is null,
    // but keep the catch in case a future SDK change re-enables an
    // internal cap. Surface the limit verbatim without prescribing what
    // the user should do — model + prompt are theirs to choose.
    if (err instanceof MaxTurnsExceededError) {
      yield {
        type: 'error',
        message: `AI stopped: ${detail}.`,
      }
      return
    }
    const classified = classifyAuthOrBillingError(err)
    yield {
      type: 'error',
      message: classified ?? `OpenAI error: ${detail}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Agent + Runner construction
// ---------------------------------------------------------------------------

function buildAgent(req: AiStreamRequest): Agent {
  return new Agent({
    name: 'page-builder-agent',
    // Agents SDK flattens an `instructions` string into the system prompt;
    // we join our cache-tagged array (the cache marker is no-op here).
    instructions: req.systemPrompt.join('\n\n'),
    model: req.modelId,
    tools: req.tools.map((t) =>
      toolToSdkTool(t, req.bridge, req.signal, req.toolContextBase),
    ),
  })
}

function buildRunner(creds: AiResolvedCredential): Runner {
  const provider = new OpenAIProvider({ apiKey: creds.apiKey! })
  return new Runner({ modelProvider: provider })
}

// ---------------------------------------------------------------------------
// AiTool → SDK tool()
// ---------------------------------------------------------------------------

function toolToSdkTool(
  aiTool: AiTool,
  bridge: AiStreamRequest['bridge'],
  signal: AbortSignal,
  toolContextBase: AiStreamRequest['toolContextBase'],
): ReturnType<typeof tool> {
  const parameters = typeboxToJsonObjectSchema(aiTool.inputSchema)
  return tool({
    name: aiTool.name,
    description: aiTool.description,
    parameters,
    // `strict: false` — our schemas use optionals (which strict mode forbids)
    // and recursive references (insertTree). Non-strict tolerates both.
    strict: false,
    async execute(input) {
      return callAiTool(aiTool, input, bridge, signal, toolContextBase)
    },
  })
}

async function callAiTool(
  aiTool: AiTool,
  rawInput: unknown,
  bridge: AiStreamRequest['bridge'],
  signal: AbortSignal,
  toolContextBase: AiStreamRequest['toolContextBase'],
): Promise<unknown> {
  // Defence in depth: validate against TypeBox before dispatching.
  let validated: unknown
  try {
    validated = parseValue(aiTool.inputSchema, rawInput)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invalid tool input.'
    return { ok: false, error: message }
  }

  if (aiTool.execution === 'server') {
    if (!aiTool.handler) {
      return { ok: false, error: `Tool ${aiTool.name} declares execution='server' but has no handler.` }
    }
    try {
      const ctx: ToolContext = {
        ...toolContextBase,
        signal,
      }
      return await aiTool.handler(validated, ctx)
    } catch (err) {
      const message = err instanceof Error ? err.message : `Tool ${aiTool.name} failed.`
      return { ok: false, error: message }
    }
  }

  // Browser-execution: forward to the bridge.
  try {
    const result: AiToolOutput = await bridge.callBrowser(aiTool.name, validated)
    return result
  } catch (err) {
    const message = err instanceof Error ? err.message : `Tool ${aiTool.name} failed.`
    return { ok: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// TypeBox → JSON Schema (non-strict)
// ---------------------------------------------------------------------------

/**
 * Convert a TypeBox Type.Object schema to the SDK's `JsonObjectSchema` shape.
 *
 * TypeBox schemas ARE JSON Schemas at runtime (the `[Kind]` symbol is the
 * only TypeBox-specific addition, and JSON.stringify drops symbol-keyed
 * properties automatically). We strip those, then force the SDK's
 * non-strict shape: `additionalProperties: true`.
 */
function typeboxToJsonObjectSchema(schema: unknown): OpenAiJsonObjectSchema {
  const plain = JSON.parse(JSON.stringify(schema)) as {
    type?: string
    properties?: Record<string, Record<string, unknown>>
    required?: string[]
  }
  if (plain.type !== 'object' || !plain.properties) {
    // Fall back to an empty schema — the SDK still calls the tool but
    // without enforced input shape. Surfaces in logs if we ever hit it.
    console.warn('[ai/openai] tool inputSchema is not a Type.Object — falling back to empty schema.')
    return {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true,
    }
  }
  return {
    type: 'object',
    properties: plain.properties,
    required: plain.required ?? [],
    additionalProperties: true,
  }
}

// ---------------------------------------------------------------------------
// Stream event translation
// ---------------------------------------------------------------------------

function translateEvent(event: RunStreamEvent): AiStreamEvent | null {
  if (event.type === 'raw_model_stream_event') {
    return translateRawEvent(event.data)
  }
  if (event.type === 'run_item_stream_event') {
    return translateItemEvent(event)
  }
  // `agent_updated_stream_event` — no equivalent in our wire format.
  return null
}

function translateRawEvent(data: { type?: string } & Record<string, unknown>): AiStreamEvent | null {
  if (data.type === 'output_text_delta') {
    const delta = data.delta
    if (typeof delta === 'string' && delta.length > 0) {
      return { type: 'text', text: delta }
    }
    return null
  }
  if (data.type === 'response_done') {
    // The SDK wraps usage on the response payload. Extract token counts
    // best-effort; fall back to zero if shape varies across SDK versions.
    const response = data.response as { usage?: { inputTokens?: number; outputTokens?: number } } | undefined
    const usage = response?.usage
    return {
      type: 'usage',
      promptTokens: usage?.inputTokens ?? 0,
      completionTokens: usage?.outputTokens ?? 0,
    }
  }
  return null
}

function translateItemEvent(event: {
  name: string
  item: { type: string; rawItem?: unknown; output?: unknown; agent?: unknown }
}): AiStreamEvent | null {
  if (event.name === 'tool_called') {
    const raw = event.item.rawItem as {
      name?: string
      callId?: string
      arguments?: string
      type?: string
    } | undefined
    if (!raw) return null
    const toolCallId = raw.callId ?? `tool-${Math.random().toString(36).slice(2)}`
    const toolName = raw.name ?? 'tool'
    let input: unknown = {}
    if (typeof raw.arguments === 'string' && raw.arguments.length > 0) {
      try { input = JSON.parse(raw.arguments) } catch { input = raw.arguments }
    }
    return {
      type: 'toolCall',
      toolCallId,
      toolName,
      input,
      status: 'pending',
    }
  }
  if (event.name === 'tool_output') {
    const raw = event.item.rawItem as { callId?: string; name?: string } | undefined
    const output = event.item.output
    const toolCallId = raw?.callId ?? 'unknown'
    const toolName = raw?.name ?? 'tool'
    // Our convention: an AiToolOutput-shaped object reports ok/error.
    // Anything else is treated as a successful raw return value.
    if (output && typeof output === 'object' && 'ok' in output) {
      const aio = output as AiToolOutput
      return {
        type: 'toolResult',
        toolCallId,
        toolName,
        ok: aio.ok,
        error: aio.error,
      }
    }
    return { type: 'toolResult', toolCallId, toolName, ok: true }
  }
  return null
}

// ---------------------------------------------------------------------------
// Messages → input string
// ---------------------------------------------------------------------------

function serialiseLastUserMessage(messages: AiMessage[]): string {
  const last = messages.at(-1)
  if (last && last.role === 'user') {
    return last.content
      .map((block) => {
        if (block.kind === 'text') return block.text
        if (block.kind === 'image') return '[image attached]'
        return ''
      })
      .join(' ')
  }
  return messages
    .filter((m): m is Extract<AiMessage, { role: 'user' }> => m.role === 'user')
    .map((m) => m.content.map((b) => (b.kind === 'text' ? b.text : '')).join(' '))
    .join('\n')
}

// ---------------------------------------------------------------------------
// Error classification — surface clearer messages for auth/billing.
// ---------------------------------------------------------------------------

function classifyAuthOrBillingError(err: unknown): string | null {
  if (!(err instanceof Error)) return null
  const msg = err.message.toLowerCase()
  if (msg.includes('apikey') || msg.includes('api key') || msg.includes('401') || msg.includes('unauthorized')) {
    return 'OpenAI authentication failed. Check your API key in /admin/ai/providers.'
  }
  if (msg.includes('quota') || msg.includes('billing') || msg.includes('429')) {
    return 'OpenAI quota or billing limit reached. Check your account.'
  }
  return null
}
