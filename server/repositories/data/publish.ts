/**
 * Publishing flow + public-route lookups for data rows.
 *
 *   publishDataRow                — append a new data_row_versions row, flip
 *                                   the row to `published`, write
 *                                   `active_version_id`, and (when the slug
 *                                   changed) record a redirect from the
 *                                   previous public path
 *   getPublishedDataRowByRoute    — resolve a public URL to the active
 *                                   published version of a row; resolves
 *                                   `featuredMediaPath` via a second query
 *                                   against `media_assets` (app code reads the
 *                                   cell value — SQL stays dialect-naive)
 *   getDataRowRedirectByRoute     — resolve a public URL to a redirect target
 *                                   when the URL belongs to a
 *                                   previously-published slug
 */
import { nanoid } from 'nanoid'
import type { DbClient } from '../../db/client'
import type { DataRow, DataRowVersion, DataRowRedirect, PublishedDataRow } from '@core/data/schemas'
import { normalizeRouteBase } from '@core/templates/templateMatching'
import { readFeaturedMediaCell } from '@core/data/cells'
import { getDataRow } from './rows'

// ---------------------------------------------------------------------------
// Internal row shapes
// ---------------------------------------------------------------------------

interface PublishedDataRowQueryRow {
  id: string
  row_id: string
  table_id: string
  table_slug: string
  table_kind: string
  table_route_base: string
  version_number: number
  cells_json: Record<string, unknown>
  slug: string
  author_user_id?: string | null
  author_display_name?: string | null
  author_role_slug?: string | null
  author_role_name?: string | null
  published_by_user_id?: string | null
  published_by_display_name?: string | null
  published_by_role_slug?: string | null
  published_by_role_name?: string | null
  published_at: string | Date
  created_at: string | Date
}

interface PreviousPublishedRouteRow {
  previous_slug: string
  previous_route_base: string
}

interface DataRowRedirectRow {
  id: string
  from_route_base: string
  from_slug: string
  target_route_base: string
  target_slug: string
}

interface MediaAssetRow {
  public_path: string | null
}

interface PublishDataRowResult {
  row: DataRow
  version: DataRowVersion
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toIso = (value: string | Date): string =>
  typeof value === 'string' ? value : value.toISOString()

function publicDataPath(routeBase: string, slug: string): string {
  const normalizedBase = normalizeRouteBase(routeBase)
  return `${normalizedBase === '/' ? '' : normalizedBase}/${slug}`
}

function previousRouteChanged(previous: PreviousPublishedRouteRow, currentSlug: string): boolean {
  return (
    previous.previous_slug.length > 0 &&
    publicDataPath(previous.previous_route_base, previous.previous_slug) !==
      publicDataPath(previous.previous_route_base, currentSlug)
  )
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export async function publishDataRow(
  db: DbClient,
  rowId: string,
  publisherUserId: string,
): Promise<PublishDataRowResult> {
  return db.transaction(async (tx) => {
    const row = await getDataRow(tx, rowId)
    if (!row) throw new Error('data row not found')

    const previousRoute = await readPreviousPublishedRoute(tx, rowId)
    const versionNumber = await nextVersionNumber(tx, rowId)
    const versionId = nanoid()

    await tx`
      insert into data_row_versions
        (id, row_id, version_number, cells_json, slug, published_by_user_id)
      values (
        ${versionId},
        ${row.id},
        ${versionNumber},
        ${row.cells},
        ${row.slug},
        ${publisherUserId}
      )
    `

    const { rows: updateRows } = await tx<{ id: string }>`
      update data_rows
      set status = 'published',
          active_version_id = ${versionId},
          published_by_user_id = ${publisherUserId},
          published_at = current_timestamp,
          updated_by_user_id = ${publisherUserId},
          updated_at = current_timestamp
      where id = ${row.id}
        and deleted_at is null
      returning id
    `
    if (!updateRows[0]) throw new Error('data row publish update failed')

    if (previousRoute && previousRouteChanged(previousRoute, row.slug)) {
      await tx`
        insert into data_row_redirects (id, table_id, from_route_base, from_slug, target_row_id)
        values (
          ${nanoid()},
          ${row.tableId},
          ${normalizeRouteBase(previousRoute.previous_route_base)},
          ${previousRoute.previous_slug},
          ${row.id}
        )
        on conflict (from_route_base, from_slug) do update
          set table_id = excluded.table_id,
              target_row_id = excluded.target_row_id
      `
    }

    const publishedRow = await getDataRow(tx, row.id)
    if (!publishedRow) throw new Error('data row could not be re-read after publish')

    const publishedAt = publishedRow.publishedAt ?? new Date().toISOString()
    return {
      row: publishedRow,
      version: {
        id: versionId,
        rowId: publishedRow.id,
        versionNumber,
        cells: publishedRow.cells,
        slug: publishedRow.slug,
        publishedByUserId: publisherUserId,
        publishedAt,
        createdAt: publishedAt,
      },
    }
  })
}

async function readPreviousPublishedRoute(
  db: DbClient,
  rowId: string,
): Promise<PreviousPublishedRouteRow | null> {
  const { rows } = await db<PreviousPublishedRouteRow>`
    select data_row_versions.slug as previous_slug,
           data_tables.route_base as previous_route_base
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    where data_rows.id = ${rowId}
      and data_rows.deleted_at is null
      and data_tables.deleted_at is null
    limit 1
  `
  return rows[0] ?? null
}

async function nextVersionNumber(db: DbClient, rowId: string): Promise<number> {
  const { rows } = await db<{ next_version: number }>`
    select coalesce(max(version_number), 0) + 1 as next_version
    from data_row_versions
    where row_id = ${rowId}
  `
  return Number(rows[0]?.next_version ?? 1)
}

// ---------------------------------------------------------------------------
// Public-route lookups
// ---------------------------------------------------------------------------

/**
 * Resolve a public URL (tableRouteBase + rowSlug) to the active published
 * version of a data row.
 *
 * `featuredMediaPath` is resolved in app code: first we read
 * `cells.featuredMedia` (via `readFeaturedMediaCell`) from the version's
 * `cells_json`, then — only when a media id is present — we do a second
 * query against `media_assets` for the `public_path`. This keeps the primary
 * query dialect-naive (no JSON-extract functions, no PG-specific operators).
 */
export async function getPublishedDataRowByRoute(
  db: DbClient,
  tableRouteBase: string,
  rowSlug: string,
): Promise<PublishedDataRow | null> {
  const normalizedBase = normalizeRouteBase(tableRouteBase)

  const { rows } = await db<PublishedDataRowQueryRow>`
    select data_row_versions.id,
           data_row_versions.row_id,
           data_rows.table_id,
           data_tables.slug as table_slug,
           data_tables.kind as table_kind,
           data_tables.route_base as table_route_base,
           data_row_versions.version_number,
           data_row_versions.cells_json,
           data_row_versions.slug,
           data_rows.author_user_id,
           author_users.display_name as author_display_name,
           author_roles.slug as author_role_slug,
           author_roles.name as author_role_name,
           data_row_versions.published_by_user_id,
           publisher_users.display_name as published_by_display_name,
           publisher_roles.slug as published_by_role_slug,
           publisher_roles.name as published_by_role_name,
           data_row_versions.published_at,
           data_row_versions.created_at
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    left join users author_users on author_users.id = data_rows.author_user_id
    left join roles author_roles on author_roles.id = author_users.role_id
    left join users publisher_users on publisher_users.id = data_row_versions.published_by_user_id
    left join roles publisher_roles on publisher_roles.id = publisher_users.role_id
    where data_tables.route_base = ${normalizedBase}
      and data_row_versions.slug = ${rowSlug}
      and data_rows.status = 'published'
      and data_rows.deleted_at is null
      and data_tables.deleted_at is null
    limit 1
  `

  if (!rows[0]) return null

  const queryRow = rows[0]
  const cells = queryRow.cells_json

  // Resolve featuredMediaPath in app code: read the cell value, then do a
  // second query only when a media id is present. This avoids any
  // dialect-specific JSON extraction in the primary query.
  const featuredMediaId = readFeaturedMediaCell(cells)
  let featuredMediaPath: string | null = null

  if (featuredMediaId) {
    const { rows: mediaRows } = await db<MediaAssetRow>`
      select public_path from media_assets
      where id = ${featuredMediaId}
      limit 1
    `
    featuredMediaPath = mediaRows[0]?.public_path ?? null
  }

  return {
    id: queryRow.id,
    rowId: queryRow.row_id,
    tableId: queryRow.table_id,
    tableSlug: queryRow.table_slug,
    tableKind: queryRow.table_kind as PublishedDataRow['tableKind'],
    tableRouteBase: normalizeRouteBase(queryRow.table_route_base),
    versionNumber: Number(queryRow.version_number),
    cells,
    slug: queryRow.slug,
    featuredMediaId,
    featuredMediaPath,
    authorUserId: queryRow.author_user_id ?? null,
    authorName: queryRow.author_display_name ?? null,
    authorRoleSlug: queryRow.author_role_slug ?? null,
    authorRoleName: queryRow.author_role_name ?? null,
    publishedByUserId: queryRow.published_by_user_id ?? null,
    publishedByName: queryRow.published_by_display_name ?? null,
    publishedByRoleSlug: queryRow.published_by_role_slug ?? null,
    publishedByRoleName: queryRow.published_by_role_name ?? null,
    publishedAt: toIso(queryRow.published_at),
    createdAt: toIso(queryRow.created_at),
  }
}

export async function getDataRowRedirectByRoute(
  db: DbClient,
  tableRouteBase: string,
  rowSlug: string,
): Promise<DataRowRedirect | null> {
  const normalizedBase = normalizeRouteBase(tableRouteBase)

  const { rows } = await db<DataRowRedirectRow>`
    select data_row_redirects.id,
           data_row_redirects.from_route_base,
           data_row_redirects.from_slug,
           data_tables.route_base as target_route_base,
           data_row_versions.slug as target_slug
    from data_row_redirects
    join data_rows target_rows on target_rows.id = data_row_redirects.target_row_id
    join data_tables on data_tables.id = target_rows.table_id
    join data_row_versions on data_row_versions.id = target_rows.active_version_id
    where data_row_redirects.from_route_base = ${normalizedBase}
      and data_row_redirects.from_slug = ${rowSlug}
      and target_rows.status = 'published'
      and target_rows.deleted_at is null
      and data_tables.deleted_at is null
    limit 1
  `

  if (!rows[0]) return null

  const queryRow = rows[0]
  const fromPath = publicDataPath(queryRow.from_route_base, queryRow.from_slug)
  const targetPath = publicDataPath(queryRow.target_route_base, queryRow.target_slug)
  if (fromPath === targetPath) return null

  return { id: queryRow.id, fromPath, targetPath }
}
