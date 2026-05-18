/**
 * CRUD for data rows.
 *
 *   listDataRows             — list non-deleted rows in a table, optionally
 *                              restricted to rows owned by the calling user
 *   getDataRow               — read a single row with hydrated user references
 *   listDataAuthorOptions    — list active users for the author picker
 *   createDataRow            — insert a new draft
 *   saveDataRowDraft         — overwrite the draft cells and slug
 *   softDeleteDataRow        — set deleted_at
 *   updateDataRowTable       — move a row to another table (rejects on slug
 *                              conflict); was updateContentEntryCollection
 *   updateDataRowStatus      — flip between draft / unpublished
 *   updateDataRowAuthor      — reassign the author user id
 *
 * Mutations (other than soft-delete) always RETURN id only, then re-read the
 * hydrated row through `getDataRow` so callers receive consistently populated
 * user references. Soft-delete is the exception: a soft-deleted row is
 * filtered out by `getDataRow`'s `deleted_at is null` clause, so the row is
 * mapped directly from RETURNING (without user references — the delete handler
 * only consumes id / tableId / slug for audit logging).
 */
import { nanoid } from 'nanoid'
import type { DbClient } from '../../db/client'
import type { DataRow, DataRowCells, DataRowStatus } from '@core/data/schemas'
import { userRefAt, toIso, toIsoOrNull, type UserJoinColumns } from './shared'

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

interface CreateDataRowInput {
  id?: string
  tableId: string
  cells: DataRowCells
  /**
   * Denormalized slug derived from `cells.slug` (when the table has a slug
   * field) by the handler before calling this repo. Pass empty string for
   * tables that have no slug field.
   */
  slug: string
}

interface SaveDataRowDraftInput {
  cells: DataRowCells
  slug: string
}

interface ListDataRowsVisibility {
  /**
   * When set, only rows whose effective owner is this user id are returned.
   * Ownership: author overrides; when no author is assigned the creator is
   * the effective owner.
   */
  ownerUserId?: string | null
}

export type UpdateDataRowTableResult =
  | { ok: true; row: DataRow }
  | { ok: false; reason: 'row_not_found' | 'table_not_found' | 'slug_conflict' }

// ---------------------------------------------------------------------------
// Row shape returned by queries
// ---------------------------------------------------------------------------

interface DataRowRow extends UserJoinColumns {
  id: string
  table_id: string
  cells_json: Record<string, unknown>
  slug: string
  status: DataRowStatus
  author_user_id: string | null
  created_by_user_id: string | null
  updated_by_user_id: string | null
  published_by_user_id: string | null
  created_at: string | Date
  updated_at: string | Date
  published_at: string | Date | null
  deleted_at: string | Date | null
}

interface DataAuthorRow {
  id: string
  email: string
  display_name: string | null
  role_slug: string | null
  role_name: string | null
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

function mapRow(row: DataRowRow): DataRow {
  return {
    id: row.id,
    tableId: row.table_id,
    cells: row.cells_json,
    slug: row.slug,
    status: row.status,
    authorUserId: row.author_user_id ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    publishedByUserId: row.published_by_user_id ?? null,
    author: userRefAt(row, 'author'),
    createdBy: userRefAt(row, 'created_by'),
    updatedBy: userRefAt(row, 'updated_by'),
    publishedBy: userRefAt(row, 'published_by'),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    publishedAt: toIsoOrNull(row.published_at),
    deletedAt: toIsoOrNull(row.deleted_at),
  }
}

function isOwnedByUser(row: DataRow, ownerUserId: string): boolean {
  if (row.authorUserId === ownerUserId) return true
  if (row.authorUserId === null) return row.createdByUserId === ownerUserId
  return false
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function listDataRows(
  db: DbClient,
  tableId: string,
  visibility: ListDataRowsVisibility = {},
): Promise<DataRow[]> {
  const { rows } = await db<DataRowRow>`
    select data_rows.id,
           data_rows.table_id,
           data_rows.cells_json,
           data_rows.slug,
           data_rows.status,
           data_rows.author_user_id,
           data_rows.created_by_user_id,
           data_rows.updated_by_user_id,
           data_rows.published_by_user_id,
           author_users.email as author_email,
           author_users.display_name as author_display_name,
           author_roles.slug as author_role_slug,
           author_roles.name as author_role_name,
           creator_users.email as created_by_email,
           creator_users.display_name as created_by_display_name,
           creator_roles.slug as created_by_role_slug,
           creator_roles.name as created_by_role_name,
           updater_users.email as updated_by_email,
           updater_users.display_name as updated_by_display_name,
           updater_roles.slug as updated_by_role_slug,
           updater_roles.name as updated_by_role_name,
           publisher_users.email as published_by_email,
           publisher_users.display_name as published_by_display_name,
           publisher_roles.slug as published_by_role_slug,
           publisher_roles.name as published_by_role_name,
           data_rows.created_at,
           data_rows.updated_at,
           data_rows.published_at,
           data_rows.deleted_at
    from data_rows
    left join users author_users on author_users.id = data_rows.author_user_id
    left join roles author_roles on author_roles.id = author_users.role_id
    left join users creator_users on creator_users.id = data_rows.created_by_user_id
    left join roles creator_roles on creator_roles.id = creator_users.role_id
    left join users updater_users on updater_users.id = data_rows.updated_by_user_id
    left join roles updater_roles on updater_roles.id = updater_users.role_id
    left join users publisher_users on publisher_users.id = data_rows.published_by_user_id
    left join roles publisher_roles on publisher_roles.id = publisher_users.role_id
    where data_rows.table_id = ${tableId}
      and data_rows.deleted_at is null
    order by data_rows.updated_at desc, data_rows.created_at desc
  `
  const dataRows = rows.map(mapRow)
  if (visibility.ownerUserId) {
    const ownerUserId = visibility.ownerUserId
    return dataRows.filter((row) => isOwnedByUser(row, ownerUserId))
  }
  return dataRows
}

// ---------------------------------------------------------------------------
// Cross-table search (content provider)
// ---------------------------------------------------------------------------

/**
 * A lightweight row summary returned by spotlight content search.
 * Omits user references and cells to keep the response small.
 */
export interface DataRowSearchResult {
  id: string
  tableId: string
  tableSlug: string
  tableName: string
  slug: string
  status: DataRowStatus
  updatedAt: string
}

interface DataRowSearchRow {
  id: string
  table_id: string
  table_slug: string
  table_name: string
  slug: string
  status: DataRowStatus
  author_user_id: string | null
  created_by_user_id: string | null
  updated_at: string | Date
}

interface SearchDataRowsVisibility {
  /**
   * When set, only rows whose effective owner matches this user id are
   * returned. Ownership follows the same rule used by `listDataRows`:
   * `authorUserId` wins when present, otherwise `createdByUserId` is the
   * effective owner. Pass `null` (or omit) for callers who can see every
   * row (`content.edit.any` / `content.publish.any` / `content.manage`).
   */
  ownerUserId?: string | null
}

/**
 * Search non-deleted rows across all non-deleted data tables by slug.
 * The slug is a URL-safe, lowercased derivative of the content title,
 * making it a reliable text proxy for search without requiring dialect-
 * specific JSON extraction from cells_json.
 *
 * `visibility.ownerUserId` restricts the result set to rows owned by the
 * caller — required for `content.edit.own`-only roles so a slug fragment
 * typed in spotlight can't surface other authors' row metadata. Callers
 * with broad visibility (`canSeeAllDataRows`) should omit the filter.
 *
 * Both `lower()` and `LIKE` are ANSI SQL — safe for Postgres and SQLite.
 */
export async function searchDataRows(
  db: DbClient,
  query: string,
  limit: number,
  visibility: SearchDataRowsVisibility = {},
): Promise<DataRowSearchResult[]> {
  const likePattern = `%${query.toLowerCase()}%`
  const { rows } = await db<DataRowSearchRow>`
    select data_rows.id,
           data_rows.table_id,
           data_rows.slug,
           data_rows.status,
           data_rows.author_user_id,
           data_rows.created_by_user_id,
           data_rows.updated_at,
           data_tables.slug as table_slug,
           data_tables.name as table_name
    from data_rows
    join data_tables on data_tables.id = data_rows.table_id
    where data_rows.deleted_at is null
      and data_tables.deleted_at is null
      and lower(data_rows.slug) like ${likePattern}
    order by data_rows.updated_at desc
    limit ${limit}
  `
  const results = rows.map((r) => ({
    row: r,
    result: {
      id: r.id,
      tableId: r.table_id,
      tableSlug: r.table_slug,
      tableName: r.table_name,
      slug: r.slug,
      status: r.status,
      updatedAt: toIso(r.updated_at),
    },
  }))
  if (visibility.ownerUserId) {
    const ownerUserId = visibility.ownerUserId
    return results
      .filter(({ row }) => {
        if (row.author_user_id === ownerUserId) return true
        if (row.author_user_id === null) return row.created_by_user_id === ownerUserId
        return false
      })
      .map(({ result }) => result)
  }
  return results.map(({ result }) => result)
}

export async function getDataRow(
  db: DbClient,
  rowId: string,
): Promise<DataRow | null> {
  const { rows } = await db<DataRowRow>`
    select data_rows.id,
           data_rows.table_id,
           data_rows.cells_json,
           data_rows.slug,
           data_rows.status,
           data_rows.author_user_id,
           data_rows.created_by_user_id,
           data_rows.updated_by_user_id,
           data_rows.published_by_user_id,
           author_users.email as author_email,
           author_users.display_name as author_display_name,
           author_roles.slug as author_role_slug,
           author_roles.name as author_role_name,
           creator_users.email as created_by_email,
           creator_users.display_name as created_by_display_name,
           creator_roles.slug as created_by_role_slug,
           creator_roles.name as created_by_role_name,
           updater_users.email as updated_by_email,
           updater_users.display_name as updated_by_display_name,
           updater_roles.slug as updated_by_role_slug,
           updater_roles.name as updated_by_role_name,
           publisher_users.email as published_by_email,
           publisher_users.display_name as published_by_display_name,
           publisher_roles.slug as published_by_role_slug,
           publisher_roles.name as published_by_role_name,
           data_rows.created_at,
           data_rows.updated_at,
           data_rows.published_at,
           data_rows.deleted_at
    from data_rows
    left join users author_users on author_users.id = data_rows.author_user_id
    left join roles author_roles on author_roles.id = author_users.role_id
    left join users creator_users on creator_users.id = data_rows.created_by_user_id
    left join roles creator_roles on creator_roles.id = creator_users.role_id
    left join users updater_users on updater_users.id = data_rows.updated_by_user_id
    left join roles updater_roles on updater_roles.id = updater_users.role_id
    left join users publisher_users on publisher_users.id = data_rows.published_by_user_id
    left join roles publisher_roles on publisher_roles.id = publisher_users.role_id
    where data_rows.id = ${rowId}
      and data_rows.deleted_at is null
    limit 1
  `
  return rows[0] ? mapRow(rows[0]) : null
}

export async function listDataAuthorOptions(
  db: DbClient,
): Promise<Array<{ id: string; email: string; displayName: string; roleSlug: string | null; roleName: string | null }>> {
  const { rows } = await db<DataAuthorRow>`
    select users.id,
           users.email,
           users.display_name,
           roles.slug as role_slug,
           roles.name as role_name
    from users
    join roles on roles.id = users.role_id
    where users.deleted_at is null
      and users.status = ${'active'}
    order by users.display_name asc, users.email asc
  `
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name ?? row.email ?? row.id,
    roleSlug: row.role_slug,
    roleName: row.role_name,
  }))
}

export async function createDataRow(
  db: DbClient,
  input: CreateDataRowInput,
  actorUserId: string | null = null,
): Promise<DataRow> {
  const { rows } = await db<{ id: string }>`
    insert into data_rows (
      id,
      table_id,
      cells_json,
      slug,
      status,
      author_user_id,
      created_by_user_id,
      updated_by_user_id
    )
    values (
      ${input.id ?? nanoid()},
      ${input.tableId},
      ${input.cells},
      ${input.slug},
      ${'draft'},
      ${actorUserId},
      ${actorUserId},
      ${actorUserId}
    )
    returning id
  `
  const created = await getDataRow(db, rows[0].id)
  if (!created) throw new Error('data row was created but could not be re-read')
  return created
}

export async function saveDataRowDraft(
  db: DbClient,
  rowId: string,
  input: SaveDataRowDraftInput,
  actorUserId: string | null = null,
): Promise<DataRow | null> {
  const { rows } = await db<{ id: string }>`
    update data_rows
    set cells_json = ${input.cells},
        slug = ${input.slug},
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id
  `
  return rows[0] ? getDataRow(db, rows[0].id) : null
}

/**
 * Soft-delete is the one mutation that returns the row directly from
 * RETURNING rather than re-reading via `getDataRow`: the row now has
 * `deleted_at` set, so `getDataRow`'s `deleted_at is null` filter would mask
 * it. The handler only consumes id / tableId / slug for audit logging, so the
 * absence of hydrated user references on the returned shape is acceptable.
 */
export async function softDeleteDataRow(
  db: DbClient,
  rowId: string,
  actorUserId: string | null = null,
): Promise<DataRow | null> {
  const { rows } = await db<DataRowRow>`
    update data_rows
    set deleted_at = current_timestamp,
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id, table_id, cells_json, slug, status,
              author_user_id, created_by_user_id,
              updated_by_user_id, published_by_user_id,
              created_at, updated_at, published_at, deleted_at
  `
  return rows[0] ? mapRow(rows[0]) : null
}

/**
 * Move a row to another table. Refuses if the target table is missing or
 * already has a non-deleted row with the same (non-empty) slug. Returns a
 * discriminated union so handlers can map each failure mode to the right HTTP
 * status.
 */
export async function updateDataRowTable(
  db: DbClient,
  rowId: string,
  tableId: string,
  actorUserId: string | null = null,
): Promise<UpdateDataRowTableResult> {
  const row = await getDataRow(db, rowId)
  if (!row) return { ok: false, reason: 'row_not_found' }
  if (row.tableId === tableId) return { ok: true, row }

  const { rows: tableRows } = await db<{ id: string }>`
    select id from data_tables
    where id = ${tableId}
      and deleted_at is null
    limit 1
  `
  if (!tableRows[0]) return { ok: false, reason: 'table_not_found' }

  // Only check for slug conflicts when the row has a non-empty slug.
  if (row.slug) {
    const { rows: conflictRows } = await db<{ id: string }>`
      select id from data_rows
      where table_id = ${tableId}
        and slug = ${row.slug}
        and id <> ${rowId}
        and deleted_at is null
      limit 1
    `
    if (conflictRows[0]) return { ok: false, reason: 'slug_conflict' }
  }

  const { rows } = await db<{ id: string }>`
    update data_rows
    set table_id = ${tableId},
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id
  `
  if (!rows[0]) return { ok: false, reason: 'row_not_found' }
  const updated = await getDataRow(db, rows[0].id)
  if (!updated) return { ok: false, reason: 'row_not_found' }
  return { ok: true, row: updated }
}

/**
 * Flip a row between `draft` and `unpublished` (the only states reachable
 * from this endpoint — `published` goes through the dedicated publish flow).
 * Always clears `published_at` / `published_by_user_id` since neither remains
 * meaningful in the new state.
 */
export async function updateDataRowStatus(
  db: DbClient,
  rowId: string,
  status: 'draft' | 'unpublished',
  actorUserId: string | null = null,
): Promise<DataRow | null> {
  const { rows } = await db<{ id: string }>`
    update data_rows
    set status = ${status},
        published_at = null,
        published_by_user_id = null,
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id
  `
  return rows[0] ? getDataRow(db, rows[0].id) : null
}

export async function updateDataRowAuthor(
  db: DbClient,
  rowId: string,
  authorUserId: string,
  actorUserId: string | null = null,
): Promise<DataRow | null> {
  const { rows } = await db<{ id: string }>`
    update data_rows
    set author_user_id = ${authorUserId},
        updated_by_user_id = ${actorUserId},
        updated_at = current_timestamp
    where id = ${rowId}
      and deleted_at is null
    returning id
  `
  return rows[0] ? getDataRow(db, rows[0].id) : null
}
