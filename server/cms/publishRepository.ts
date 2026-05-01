import { nanoid } from 'nanoid'
import type { SiteDocument } from '../../src/core/page-tree/types'
import type { DbClient } from './db'
import { loadDraftSite } from './siteRepository'

export interface PublishedPageSnapshot {
  cmsSnapshotVersion: 1
  pageId: string
  site: SiteDocument
}

interface PublishResult {
  publishedPages: number
}

interface DraftPublishStatus {
  hasPublishedVersion: boolean
  draftMatchesPublished: boolean
  draftPages: number
  publishedPages: number
  lastPublishedAt?: string
}

interface ActivePublishedRow {
  page_id: string
  snapshot_json: PublishedPageSnapshot
  published_at: string | Date
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function createSnapshot(site: SiteDocument, pageId: string): PublishedPageSnapshot {
  return {
    cmsSnapshotVersion: 1,
    pageId,
    site: structuredClone(site),
  }
}

export async function getDraftPublishStatus(db: DbClient): Promise<DraftPublishStatus> {
  const site = await loadDraftSite(db)
  if (!site) {
    return {
      hasPublishedVersion: false,
      draftMatchesPublished: false,
      draftPages: 0,
      publishedPages: 0,
    }
  }

  const result = await db.query<ActivePublishedRow>(
    `select pages.id as page_id,
            page_versions.snapshot_json,
            page_versions.published_at
     from pages
     join page_versions on page_versions.id = pages.active_version_id
     where pages.status = 'published'
       and pages.active_version_id is not null
     order by pages.sort_order asc, pages.created_at asc`,
  )

  const publishedRows = result.rows
  const draftSiteJson = canonicalJson(site)
  const draftPageIds = new Set(site.pages.map((page) => page.id))
  const draftMatchesPublished =
    publishedRows.length === site.pages.length &&
    publishedRows.every((row) =>
      draftPageIds.has(row.page_id) &&
      canonicalJson(row.snapshot_json.site) === draftSiteJson
    )
  const lastPublishedAt = publishedRows
    .map((row) => new Date(row.published_at).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0]

  return {
    hasPublishedVersion: publishedRows.length > 0,
    draftMatchesPublished,
    draftPages: site.pages.length,
    publishedPages: publishedRows.length,
    ...(lastPublishedAt ? { lastPublishedAt: new Date(lastPublishedAt).toISOString() } : {}),
  }
}

export async function publishDraftSite(
  db: DbClient,
  adminUserId: string,
): Promise<PublishResult> {
  await db.query('begin')
  try {
    const site = await loadDraftSite(db)
    if (!site) throw new Error('draft site not found')

    for (const page of site.pages) {
      const versionResult = await db.query<{ next_version: number }>(
        `select coalesce(max(version), 0)::int + 1 as next_version
         from page_versions
         where page_id = $1`,
        [page.id],
      )
      const version = Number(versionResult.rows[0]?.next_version ?? 1)
      const versionId = nanoid()

      await db.query(
        `insert into page_versions (id, page_id, version, snapshot_json, published_by)
         values ($1, $2, $3, $4, $5)`,
        [versionId, page.id, version, createSnapshot(site, page.id), adminUserId],
      )
      await db.query(
        `update pages
         set active_version_id = $1,
             status = 'published',
             updated_at = now()
         where id = $2`,
        [versionId, page.id],
      )
    }

    await db.query('commit')
    return { publishedPages: site.pages.length }
  } catch (err) {
    await db.query('rollback')
    throw err
  }
}

export async function getPublishedPageBySlug(
  db: DbClient,
  slug: string,
): Promise<PublishedPageSnapshot | null> {
  const result = await db.query<{ snapshot_json: PublishedPageSnapshot }>(
    `select page_versions.snapshot_json
     from pages
     join page_versions on page_versions.id = pages.active_version_id
     where pages.slug = $1
       and pages.status = 'published'
     limit 1`,
    [slug],
  )
  return result.rows[0]?.snapshot_json ?? null
}

export async function getLatestPublishedSiteSnapshot(
  db: DbClient,
): Promise<PublishedPageSnapshot | null> {
  const result = await db.query<{ snapshot_json: PublishedPageSnapshot }>(
    `select page_versions.snapshot_json
     from pages
     join page_versions on page_versions.id = pages.active_version_id
     where pages.status = 'published'
       and pages.active_version_id is not null
     order by pages.sort_order asc, pages.created_at asc
     limit 1`,
  )
  return result.rows[0]?.snapshot_json ?? null
}
