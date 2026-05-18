/**
 * Capability guards for data table and row endpoints.
 *
 * Capability strings stay `content.*` — the resources moved from the old
 * `content_*` tables to the unified `data_*` store, but user-facing
 * capability identifiers remain stable so no role configuration changes are
 * needed.
 *
 * Mapping:
 *   content.create       — create new rows
 *   content.edit.own     — read / edit own rows
 *   content.edit.any     — read / edit all rows
 *   content.publish.own  — publish own rows
 *   content.publish.any  — publish all rows
 *   content.manage       — tables CRUD + all row operations
 */
import type { CoreCapability } from '../../../auth/capabilities'
import {
  requireAnyCapability,
  requireCapability,
  userHasAnyCapability,
  userHasCapability,
} from '../../../auth/authz'
import type { DbClient } from '../../../db/client'
import { jsonResponse } from '../../../http'
import type { AuthUser } from '../../../repositories/users'

const DATA_ACCESS_CAPABILITIES = [
  'content.create',
  'content.edit.own',
  'content.edit.any',
  'content.publish.own',
  'content.publish.any',
  'content.manage',
] satisfies CoreCapability[]

const DATA_ANY_VISIBILITY_CAPABILITIES = [
  'content.edit.any',
  'content.publish.any',
  'content.manage',
] satisfies CoreCapability[]

const DATA_OWN_READ_CAPABILITIES = [
  'content.edit.own',
  'content.publish.own',
] satisfies CoreCapability[]

const DATA_EDIT_CAPABILITIES = [
  'content.edit.own',
  'content.edit.any',
  'content.manage',
] satisfies CoreCapability[]

const DATA_REASSIGN_CAPABILITIES = [
  'content.edit.any',
  'content.manage',
] satisfies CoreCapability[]

const DATA_PUBLISH_CAPABILITIES = [
  'content.publish.own',
  'content.publish.any',
] satisfies CoreCapability[]

interface OwnedDataRow {
  authorUserId: string | null
  createdByUserId: string | null
}

export function forbidden(): Response {
  return jsonResponse({ error: 'Forbidden' }, { status: 403 })
}

export async function requireDataAccess(req: Request, db: DbClient): Promise<AuthUser | Response> {
  return requireAnyCapability(req, db, DATA_ACCESS_CAPABILITIES)
}

export async function requireDataManager(req: Request, db: DbClient): Promise<AuthUser | Response> {
  return requireCapability(req, db, 'content.manage')
}

export async function requireDataEditor(req: Request, db: DbClient): Promise<AuthUser | Response> {
  return requireAnyCapability(req, db, DATA_EDIT_CAPABILITIES)
}

export async function requireDataCreator(req: Request, db: DbClient): Promise<AuthUser | Response> {
  return requireCapability(req, db, 'content.create')
}

export async function requireDataAuthorManager(req: Request, db: DbClient): Promise<AuthUser | Response> {
  return requireAnyCapability(req, db, DATA_REASSIGN_CAPABILITIES)
}

export async function requireDataPublisher(req: Request, db: DbClient): Promise<AuthUser | Response> {
  return requireAnyCapability(req, db, DATA_PUBLISH_CAPABILITIES)
}

export function canSeeAllDataRows(user: AuthUser): boolean {
  return userHasAnyCapability(user, DATA_ANY_VISIBILITY_CAPABILITIES)
}

function ownsDataRow(user: AuthUser, row: OwnedDataRow): boolean {
  return row.authorUserId === user.id || (!row.authorUserId && row.createdByUserId === user.id)
}

export function canReadDataRow(user: AuthUser, row: OwnedDataRow): boolean {
  return canSeeAllDataRows(user) ||
    (ownsDataRow(user, row) && userHasAnyCapability(user, DATA_OWN_READ_CAPABILITIES))
}

export function canEditDataRow(user: AuthUser, row: OwnedDataRow): boolean {
  return userHasAnyCapability(user, ['content.edit.any', 'content.manage']) ||
    (ownsDataRow(user, row) && userHasCapability(user, 'content.edit.own'))
}

export function canPublishDataRow(user: AuthUser, row: OwnedDataRow): boolean {
  return userHasCapability(user, 'content.publish.any') ||
    (ownsDataRow(user, row) && userHasCapability(user, 'content.publish.own'))
}
