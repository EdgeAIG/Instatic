/**
 * Content-scope browser bridge — turns a server-issued `toolRequest` into
 * a live mutation against the content workspace via the registered
 * `ContentBridgeHandle`.
 *
 * The chat panel's stream loop calls `executeContentTool(name, input)`
 * when scope === 'content'; the result is POSTed to /admin/api/ai/tool-result.
 *
 * Per-tool inputs are re-validated against TypeBox at this boundary —
 * defence in depth. The server already validated against the same schema
 * (via Anthropic Zod or OpenAI JSON Schema) but the canonical TypeBox
 * shape is the single source of truth and may carry stricter constraints
 * the SDK translation drops.
 *
 * Mirrors `src/admin/pages/site/agent/executor.ts` — same shape, same
 * `AgentActionResult` return type, plugs into the same stream-event
 * processor in `agentSlice.ts`.
 */

import { Type, parseValue, type Static } from '@core/utils/typeboxHelpers'
import type { AgentActionResult } from '@site/agent/types'
import { getContentBridgeHandle } from './contentBridgeHandle'

// ---------------------------------------------------------------------------
// Per-tool TypeBox schemas — mirror server/ai/tools/content/writeTools.ts.
// ---------------------------------------------------------------------------

const FieldsRecord = Type.Record(Type.String(), Type.Unknown())

const StatusUnion = Type.Union([
  Type.Literal('draft'),
  Type.Literal('unpublished'),
  Type.Literal('published'),
  Type.Literal('scheduled'),
])

const CreateDocumentSchema = Type.Object({
  tableId: Type.String({ minLength: 1 }),
  fields: Type.Optional(FieldsRecord),
  status: Type.Optional(StatusUnion),
})

const DeleteDocumentSchema = Type.Object({
  documentId: Type.String({ minLength: 1 }),
})

const SetDocumentStatusSchema = Type.Object({
  documentId: Type.String({ minLength: 1 }),
  status: StatusUnion,
  scheduledAt: Type.Optional(Type.String({ minLength: 1 })),
})

const SetDocumentFieldSchema = Type.Object({
  documentId: Type.String({ minLength: 1 }),
  fieldId: Type.String({ minLength: 1 }),
  value: Type.Unknown(),
})

const SetDocumentFieldsSchema = Type.Object({
  documentId: Type.String({ minLength: 1 }),
  fields: FieldsRecord,
})

const SetDocumentAuthorSchema = Type.Object({
  documentId: Type.String({ minLength: 1 }),
  userId: Type.String({ minLength: 1 }),
})

const SetActiveDocumentSchema = Type.Object({
  documentId: Type.String({ minLength: 1 }),
})

const SetActiveCollectionSchema = Type.Object({
  tableId: Type.String({ minLength: 1 }),
})

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

/**
 * Execute one content-scope write tool. Always resolves with a result
 * (never throws) — failures become `{ success: false, error }` so the
 * server-side bridge resolver fires and the driver loop sees a tool error
 * rather than hanging.
 */
export async function executeContentTool(
  toolName: string,
  rawInput: unknown,
): Promise<AgentActionResult> {
  try {
    const handle = getContentBridgeHandle()
    switch (toolName) {
      case 'create_document':
        return await handleCreateDocument(handle, rawInput)
      case 'delete_document':
        return await handleDeleteDocument(handle, rawInput)
      case 'set_document_status':
        return await handleSetDocumentStatus(handle, rawInput)
      case 'set_document_field':
        return await handleSetDocumentField(handle, rawInput)
      case 'set_document_fields':
        return await handleSetDocumentFields(handle, rawInput)
      case 'set_document_author':
        return await handleSetDocumentAuthor(handle, rawInput)
      case 'set_active_document':
        return await handleSetActiveDocument(handle, rawInput)
      case 'set_active_collection':
        return await handleSetActiveCollection(handle, rawInput)
      default:
        return {
          success: false,
          error: `Unknown content tool: ${toolName}`,
        }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : `Tool ${toolName} failed.`
    return { success: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Per-tool handlers
// ---------------------------------------------------------------------------

async function handleCreateDocument(
  handle: ReturnType<typeof getContentBridgeHandle>,
  rawInput: unknown,
): Promise<AgentActionResult> {
  const input = parseInput(CreateDocumentSchema, rawInput) as Static<typeof CreateDocumentSchema>
  const documentId = await handle.createDocument({
    tableId: input.tableId,
    fields: input.fields,
    status: input.status,
  })
  // Reuse `nodeId` (the legacy site-editor envelope field) so the server-
  // side bridge result handler's existing shape doesn't need a fork. The
  // agent reads it from the tool_result block as "the new id".
  return { success: true, nodeId: documentId }
}

async function handleDeleteDocument(
  handle: ReturnType<typeof getContentBridgeHandle>,
  rawInput: unknown,
): Promise<AgentActionResult> {
  const input = parseInput(DeleteDocumentSchema, rawInput) as Static<typeof DeleteDocumentSchema>
  await handle.deleteDocument(input.documentId)
  return { success: true }
}

async function handleSetDocumentStatus(
  handle: ReturnType<typeof getContentBridgeHandle>,
  rawInput: unknown,
): Promise<AgentActionResult> {
  const input = parseInput(SetDocumentStatusSchema, rawInput) as Static<typeof SetDocumentStatusSchema>
  if (input.status === 'scheduled' && !input.scheduledAt) {
    return {
      success: false,
      error: "scheduledAt is required when status='scheduled'.",
    }
  }
  await handle.setDocumentStatus({
    documentId: input.documentId,
    status: input.status,
    scheduledAt: input.scheduledAt,
  })
  return { success: true }
}

async function handleSetDocumentField(
  handle: ReturnType<typeof getContentBridgeHandle>,
  rawInput: unknown,
): Promise<AgentActionResult> {
  const input = parseInput(SetDocumentFieldSchema, rawInput) as Static<typeof SetDocumentFieldSchema>
  await handle.setDocumentField({
    documentId: input.documentId,
    fieldId: input.fieldId,
    value: input.value,
  })
  return { success: true }
}

async function handleSetDocumentFields(
  handle: ReturnType<typeof getContentBridgeHandle>,
  rawInput: unknown,
): Promise<AgentActionResult> {
  const input = parseInput(SetDocumentFieldsSchema, rawInput) as Static<typeof SetDocumentFieldsSchema>
  await handle.setDocumentFields({
    documentId: input.documentId,
    fields: input.fields,
  })
  return { success: true }
}

async function handleSetDocumentAuthor(
  handle: ReturnType<typeof getContentBridgeHandle>,
  rawInput: unknown,
): Promise<AgentActionResult> {
  const input = parseInput(SetDocumentAuthorSchema, rawInput) as Static<typeof SetDocumentAuthorSchema>
  await handle.setDocumentAuthor({
    documentId: input.documentId,
    userId: input.userId,
  })
  return { success: true }
}

async function handleSetActiveDocument(
  handle: ReturnType<typeof getContentBridgeHandle>,
  rawInput: unknown,
): Promise<AgentActionResult> {
  const input = parseInput(SetActiveDocumentSchema, rawInput) as Static<typeof SetActiveDocumentSchema>
  const ok = await handle.selectDocument(input.documentId)
  if (!ok) {
    return {
      success: false,
      error: `Document ${input.documentId} not found (or not in a content collection).`,
    }
  }
  return { success: true }
}

async function handleSetActiveCollection(
  handle: ReturnType<typeof getContentBridgeHandle>,
  rawInput: unknown,
): Promise<AgentActionResult> {
  const input = parseInput(SetActiveCollectionSchema, rawInput) as Static<typeof SetActiveCollectionSchema>
  const ok = await handle.selectCollection(input.tableId)
  if (!ok) {
    return {
      success: false,
      error: `Collection ${input.tableId} not found.`,
    }
  }
  return { success: true }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseInput<T>(schema: Parameters<typeof parseValue>[0], raw: unknown): T {
  // Wraps parseValue so handlers stay short. Throws on invalid shape; the
  // catch in `executeContentTool` converts to `{ success: false, error }`.
  return parseValue(schema, raw) as T
}
