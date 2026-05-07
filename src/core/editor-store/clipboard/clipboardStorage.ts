/**
 * Clipboard storage — TypeBox-validated localStorage persistence for the
 * editor clipboard.
 *
 * The clipboard is intentionally global (not per-site): copying a node in
 * one site should let the user paste it into another. The payload survives
 * page reloads because the data lives in localStorage under a single key.
 *
 * Persistence shape (versioned, additive — bump VERSION on incompatible
 * changes; `safeParseJson` will fall back to "no clipboard" on mismatch):
 *
 *   {
 *     version: 2,
 *     rootNodeIds: string[],              // ordered roots (multi-select copy)
 *     nodes: Record<string, PageNode>,    // every node reachable from any root
 *     classes: Record<string, CSSClass>,  // classes referenced by the nodes
 *     copiedAt: number
 *   }
 *
 * Version 2 (this file) — multi-root copy/paste. A single-node copy is
 * persisted as `rootNodeIds: [id]`. The previous v1 shape (single
 * `rootNodeId`) is intentionally NOT supported on read; safeParseJson
 * silently drops v1 payloads (the user's local clipboard is disposable).
 *
 * Any read failure (missing JSON, schema mismatch, unsupported version) is
 * treated as "no clipboard available" — never throws into UI.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'
import { CSSClassSchema, PageNodeSchema } from '@core/page-tree/schemas'
import { safeParseJson } from '@core/utils/jsonValidate'

export const CLIPBOARD_STORAGE_KEY = 'pb-clipboard-v1'
export const CLIPBOARD_VERSION = 2

export const ClipboardPayloadSchema = Type.Object({
  version: Type.Literal(CLIPBOARD_VERSION),
  /**
   * Ordered root node ids INSIDE `nodes`. A single-node copy uses a 1-length
   * array; a multi-select copy preserves selection order. Each root's subtree
   * is reachable through `nodes` via the standard children array.
   */
  rootNodeIds: Type.Array(Type.String()),
  /** Flat map of every node in every captured subtree. */
  nodes: Type.Record(Type.String(), PageNodeSchema),
  /**
   * Classes referenced by any node in the payload. Carried alongside the
   * nodes so a cross-site paste can reconstruct styling. Same-site pastes
   * already have matching IDs in `site.classes` and ignore this map.
   */
  classes: Type.Record(Type.String(), CSSClassSchema),
  copiedAt: Type.Number(),
})

export type ClipboardPayload = Static<typeof ClipboardPayloadSchema>

function storageAvailable(): boolean {
  return typeof localStorage !== 'undefined'
}

/** Read the clipboard payload from localStorage. Returns null on any failure. */
export function readClipboardPayload(): ClipboardPayload | null {
  if (!storageAvailable()) return null
  const raw = localStorage.getItem(CLIPBOARD_STORAGE_KEY)
  if (!raw) return null
  const result = safeParseJson(raw, ClipboardPayloadSchema)
  return result.ok ? result.value : null
}

/** Write the clipboard payload to localStorage. Best-effort — swallows errors. */
export function writeClipboardPayload(payload: ClipboardPayload): void {
  if (!storageAvailable()) return
  try {
    localStorage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // Quota exceeded / private browsing: clipboard persistence is best-effort.
    // The in-memory entry on the slice still works for the current session.
  }
}

/** Remove any persisted clipboard payload. */
export function clearClipboardPayload(): void {
  if (!storageAvailable()) return
  try {
    localStorage.removeItem(CLIPBOARD_STORAGE_KEY)
  } catch {
    // Ignore — same rationale as writeClipboardPayload.
  }
}
