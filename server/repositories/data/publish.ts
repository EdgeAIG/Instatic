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
import { selectEntryTemplate } from '@core/templates/templateMatching'
import { readFeaturedMediaCell } from '@core/data/cells'
import { getDataRow } from './rows'
import { getLatestPublishedSiteSnapshot } from '../publish'
import {
  renderPublishedDataRowTemplate,
} from '../../publish/publicRenderer'
import { applyPublishedHtmlPipeline } from '../../publish/publishedHtmlPipeline'
import { removeArtefactInPlace, updateArtefactInPlace } from '../../publish/staticArtefact'
import { bumpPublishVersion, getPublishVersion } from '../../publish/renderCache'

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
// Internal shape for table route info lookup
// ---------------------------------------------------------------------------

interface RowTableRouteInfo {
  tableRouteBase: string
  tableSlug: string
}

// ---------------------------------------------------------------------------
// Publish
// ---------------------------------------------------------------------------

export async function publishDataRow(
  db: DbClient,
  rowId: string,
  /**
   * The user attributed as the publisher. `null` is allowed for system
   * actors that have no user context — e.g. the scheduled-publish tick
   * (`server/publish/publishScheduler.ts`) which fires once
   * `scheduled_publish_at` is in the past. The `published_by_user_id`
   * column on `data_rows` is nullable (`on delete set null`), so a
   * null publisher round-trips cleanly through the schema.
   */
  publisherUserId: string | null,
  uploadsDir?: string,
): Promise<PublishDataRowResult> {
  // Capture previous route inside the transaction and extract it for
  // use in the post-transaction disk artefact write.
  let capturedPreviousRoute: PreviousPublishedRouteRow | null = null

  const result = await db.transaction(async (tx) => {
    const row = await getDataRow(tx, rowId)
    if (!row) throw new Error('data row not found')

    capturedPreviousRoute = await readPreviousPublishedRoute(tx, rowId)
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

    if (capturedPreviousRoute && previousRouteChanged(capturedPreviousRoute, row.slug)) {
      await tx`
        insert into data_row_redirects (id, table_id, from_route_base, from_slug, target_row_id)
        values (
          ${nanoid()},
          ${row.tableId},
          ${normalizeRouteBase(capturedPreviousRoute.previous_route_base)},
          ${capturedPreviousRoute.previous_slug},
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

  // Layer A: incremental artefact update outside the transaction.
  // Disk artefacts are derived state — errors are logged but do not fail
  // the publish. The next full publish (publishDraftSite) will rebuild.
  if (uploadsDir) {
    // Bake with the NEXT publish version — `bumpPublishVersion()` below is the
    // synchronous statement right after this await resolves, so a hole-shell
    // baked here carries the version that becomes current with no gap.
    const nextPublishVersion = getPublishVersion() + 1
    await writeDataRowArtefact(db, uploadsDir, result.row, capturedPreviousRoute, nextPublishVersion).catch((err) => {
      console.error('[publish:row] static artefact write failed (live renderer remains active):', err)
    })
  }

  // Layer B: invalidate the in-memory render cache so the next visitor request
  // re-renders against the freshly committed row version.
  bumpPublishVersion()

  return result
}

/**
 * After a successful `publishDataRow` transaction, write (or remove) the disk
 * artefact for the row's entry-template page.
 *
 * The artefact is baked whether or not the template is fully static: a static
 * template bakes a complete document; a template with dynamic nodes bakes its
 * static SHELL with `<pb-hole>` placeholders (the hole runtime hydrates each
 * fragment from `/_pb/hole/`). Either way HTML + CSS + JS come from disk.
 *
 * Steps:
 *   1. Remove the old artefact if the slug changed (old URL no longer valid).
 *   2. Look up the table route info and site snapshot.
 *   3. Render through the template (stamping `publishVersion`) and write the
 *      artefact into the active slot.
 */
async function writeDataRowArtefact(
  db: DbClient,
  uploadsDir: string,
  publishedRow: DataRow,
  previousRoute: PreviousPublishedRouteRow | null,
  publishVersion: number,
): Promise<void> {
  const tableInfo = await getRowTableRouteInfo(db, publishedRow.id)
  if (!tableInfo) return

  // Remove old artefact when the slug changed (old URL is now stale).
  if (previousRoute && previousRouteChanged(previousRoute, publishedRow.slug)) {
    const oldPath = publicDataPath(previousRoute.previous_route_base, previousRoute.previous_slug)
    await removeArtefactInPlace(uploadsDir, oldPath).catch((err) => {
      console.error('[publish:row] failed to remove stale artefact at', oldPath, err)
    })
  }

  // Find the entry template for this row's table.
  const siteSnapshot = await getLatestPublishedSiteSnapshot(db)
  if (!siteSnapshot) return

  const template = selectEntryTemplate(siteSnapshot.site, tableInfo.tableSlug)
  if (!template) return

  // Fetch the full PublishedDataRow (needed for templateContext + media path).
  const publishedDataRow = await getPublishedDataRowByRoute(db, tableInfo.tableRouteBase, publishedRow.slug)
  if (!publishedDataRow) return

  const newPath = publicDataPath(tableInfo.tableRouteBase, publishedRow.slug)
  const syntheticUrl = new URL(`http://localhost${newPath}`)
  const rendered = await renderPublishedDataRowTemplate(siteSnapshot, publishedDataRow, {
    db,
    url: syntheticUrl,
    publishVersion,
  })
  if (!rendered) return

  const html = await applyPublishedHtmlPipeline(rendered, db)
  await updateArtefactInPlace(uploadsDir, newPath, html)
}

/**
 * Fetch the `route_base` and `slug` of the `data_tables` row that owns
 * the given data row. Used by `writeDataRowArtefact` to resolve
 * the public URL path without joining the table into every other query.
 */
async function getRowTableRouteInfo(
  db: DbClient,
  rowId: string,
): Promise<RowTableRouteInfo | null> {
  const { rows } = await db<{ route_base: string; table_slug: string }>`
    select data_tables.route_base,
           data_tables.slug as table_slug
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    where data_rows.id = ${rowId}
      and data_rows.deleted_at is null
      and data_tables.deleted_at is null
    limit 1
  `
  if (!rows[0]) return null
  return {
    tableRouteBase: normalizeRouteBase(rows[0].route_base),
    tableSlug: rows[0].table_slug,
  }
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
