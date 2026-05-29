/**
 * Posts widget reader — aggregate totals across every `kind: 'postType'`
 * table plus a dense 28-day publish histogram for the widget's mini bar
 * chart.
 */
import type { DbClient } from '../../../db/client'
import { readStatusCounts } from './shared'
import type { PostsStats } from './types'

const TWENTY_EIGHT_DAYS_MS = 28 * 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const HISTOGRAM_DAYS = 28

export async function readPostsStats(db: DbClient): Promise<PostsStats> {
  const sinceIso = new Date(Date.now() - TWENTY_EIGHT_DAYS_MS).toISOString()
  const { rows: postTypeRows } = await db<{ id: string }>`
    select id
    from data_tables
    where kind = 'postType'
      and deleted_at is null
  `
  const postTypeIds = postTypeRows.map((r) => r.id)

  // Read per-table counts + the histogram in parallel — they are
  // independent queries against the same rows.
  const [countsArr, histogram] = await Promise.all([
    Promise.all(postTypeIds.map((id) => readStatusCounts(db, id))),
    readPostsHistogram(db, postTypeIds, sinceIso),
  ])

  let postsTotal = 0
  let postsScheduled = 0
  for (const c of countsArr) {
    postsTotal += c.total
    postsScheduled += c.scheduled
  }

  // Densify into [28] oldest-first.
  const daily28 = Array.from({ length: HISTOGRAM_DAYS }, (_, i) => {
    const d = new Date(Date.now() - (HISTOGRAM_DAYS - 1 - i) * DAY_MS)
    const key = d.toISOString().slice(0, 10)
    return histogram.get(key) ?? 0
  })

  return {
    total: postsTotal,
    categories: postTypeIds.length,
    scheduled: postsScheduled,
    daily28,
  }
}

/**
 * 28-day publish histogram across ALL post-type tables. Groups by the
 * date portion of `published_at` (interpreted in UTC). The caller
 * post-processes the rows into a dense [28]-array so the front-end can
 * render bars without conditional gaps.
 *
 * We deliberately pull every published row in the window and bin
 * client-side because portable date-truncation SQL is dialect-painful
 * (Postgres `::text` cast is forbidden by the `db-postgres-isms`
 * architecture gate, and SQLite stores timestamps as strings already).
 * Cardinality is bounded by the trailing-28-day window times the table
 * count — comfortably under any reasonable per-day publish rate.
 */
async function readPostsHistogram(
  db: DbClient,
  postTypeTableIds: readonly string[],
  sinceIso: string,
): Promise<Map<string, number>> {
  if (postTypeTableIds.length === 0) return new Map()
  const { rows } = await db<{ table_id: string; published_at: string | Date }>`
    select table_id, published_at
    from data_rows
    where deleted_at is null
      and status = 'published'
      and published_at is not null
      and published_at >= ${sinceIso}
  `
  const counts = new Map<string, number>()
  const postTypeSet = new Set(postTypeTableIds)
  for (const r of rows) {
    if (!postTypeSet.has(r.table_id)) continue
    const iso = typeof r.published_at === 'string'
      ? r.published_at
      : r.published_at.toISOString()
    const day = iso.slice(0, 10)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  return counts
}
