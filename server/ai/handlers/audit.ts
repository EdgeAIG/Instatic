/**
 * AI usage audit handler — `GET /admin/api/ai/audit?since=ISO&tz=IANA`.
 *
 * Returns the four rollups consumed by the `/admin/ai` Audit tab + the
 * dashboard "AI usage this month" widget:
 *
 *   { totals, byUser, byScope, byDay }
 *
 * Gated by the `ai.audit.read` capability. `since` defaults to 30 days ago
 * when not provided. Wider lookbacks are accepted — the rollups scan the
 * messages table directly with an index on (created_at).
 */

import { jsonResponse } from '../../http'
import { requireCapability } from '../../auth/authz'
import { resolveTimeZone } from '../../time'
import type { DbClient } from '../../db/client'
import {
  getUsageByDay,
  getUsageByModel,
  getUsageByScope,
  getUsageByUser,
  getUsageTotals,
} from '../audit/store'

export function tryHandleAiAudit(
  req: Request,
  db: DbClient,
  url: URL,
  pathname: string,
): Promise<Response> | null {
  if (pathname !== '/admin/api/ai/audit') return null
  return handleAuditList(req, db, url)
}

async function handleAuditList(
  req: Request,
  db: DbClient,
  url: URL,
): Promise<Response> {
  if (req.method !== 'GET') {
    return jsonResponse({ error: 'Method not allowed' }, { status: 405 })
  }
  const userOrResponse = await requireCapability(req, db, 'ai.audit.read')
  if (userOrResponse instanceof Response) return userOrResponse

  const sinceIso = resolveSince(url.searchParams.get('since'))
  const timeZone = resolveTimeZone(url.searchParams.get('tz'))

  const [totals, byUser, byScope, byModel, byDay] = await Promise.all([
    getUsageTotals(db, sinceIso),
    getUsageByUser(db, sinceIso),
    getUsageByScope(db, sinceIso),
    getUsageByModel(db, sinceIso),
    getUsageByDay(db, sinceIso, timeZone),
  ])

  return jsonResponse({
    since: sinceIso,
    totals,
    byUser,
    byScope,
    byModel,
    byDay,
  })
}

/**
 * Parse the `since` query param. Accepts ISO 8601 strings; falls back to
 * 30 days ago when missing or invalid. The dashboard widget passes "this
 * month" (start-of-month); the Audit tab passes whatever the range tabs
 * (Today / 7d / 30d / All) computed.
 */
function resolveSince(raw: string | null): string {
  if (raw) {
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString()
  }
  const fallback = new Date()
  fallback.setUTCDate(fallback.getUTCDate() - 30)
  return fallback.toISOString()
}
