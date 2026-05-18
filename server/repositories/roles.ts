import { nanoid } from 'nanoid'
import type { DbClient } from '../db/client'
import {
  normalizeCapabilities,
  OWNER_ROLE_ID,
  SYSTEM_ROLES,
  type CoreCapability,
} from '../auth/capabilities'
import type { RoleRow } from '../types'

export interface Role {
  id: string
  slug: string
  name: string
  description: string
  isSystem: boolean
  capabilities: CoreCapability[]
  createdAt: string
  updatedAt: string
}

export class RoleMutationError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'RoleMutationError'
    this.status = status
  }
}

function rowToRole(row: RoleRow): Role {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: Boolean(row.is_system),
    capabilities: normalizeCapabilities(row.capabilities_json),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

function slugFromRoleName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function listRoles(db: DbClient): Promise<Role[]> {
  const { rows } = await db<RoleRow>`
    select id, slug, name, description, is_system, capabilities_json, created_at, updated_at
    from roles
    order by is_system desc, name asc
  `
  return rows.map(rowToRole)
}

async function getRole(db: DbClient, roleId: string): Promise<Role | null> {
  const { rows } = await db<RoleRow>`
    select id, slug, name, description, is_system, capabilities_json, created_at, updated_at
    from roles
    where id = ${roleId}
    limit 1
  `
  return rows[0] ? rowToRole(rows[0]) : null
}

export async function createCustomRole(
  db: DbClient,
  input: {
    name: string
    slug?: string
    description: string
    capabilities: CoreCapability[]
  },
): Promise<Role> {
  const name = input.name.trim()
  if (!name) throw new RoleMutationError('Role name is required')

  const slug = slugFromRoleName(input.slug || name)
  if (!slug) throw new RoleMutationError('Role slug is required')

  const id = nanoid()
  const { rows } = await db<RoleRow>`
    insert into roles (id, slug, name, description, is_system, capabilities_json)
    values (${id}, ${slug}, ${name}, ${input.description.trim()}, ${false}, ${input.capabilities})
    returning id, slug, name, description, is_system, capabilities_json, created_at, updated_at
  `
  return rowToRole(rows[0]!)
}

/**
 * Update an existing role. Built-in (system) roles other than Owner are
 * editable just like custom roles — only the Owner is locked.
 *
 * Owner-role policy:
 *  - capabilities are managed by the system (synced from `CORE_CAPABILITIES`
 *    at boot via `syncOwnerRoleCapabilities`) and cannot be edited
 *  - the row itself cannot be renamed or re-described — its presence is a
 *    structural invariant of the installation
 */
export async function updateRole(
  db: DbClient,
  roleId: string,
  input: {
    name?: string
    slug?: string
    description?: string
    capabilities?: CoreCapability[]
  },
): Promise<Role | null> {
  const current = await getRole(db, roleId)
  if (!current) return null
  if (current.id === OWNER_ROLE_ID) {
    throw new RoleMutationError('The Owner role is locked and cannot be edited', 409)
  }

  const name = input.name === undefined ? current.name : input.name.trim()
  if (!name) throw new RoleMutationError('Role name is required')
  const slug = input.slug === undefined ? current.slug : slugFromRoleName(input.slug)
  if (!slug) throw new RoleMutationError('Role slug is required')
  const description = input.description === undefined ? current.description : input.description.trim()
  const capabilities = input.capabilities ?? current.capabilities

  const { rows } = await db<RoleRow>`
    update roles
    set slug = ${slug},
        name = ${name},
        description = ${description},
        capabilities_json = ${capabilities},
        updated_at = current_timestamp
    where id = ${roleId}
    returning id, slug, name, description, is_system, capabilities_json, created_at, updated_at
  `
  return rows[0] ? rowToRole(rows[0]) : null
}

/**
 * Delete a custom role. System roles (built-ins) cannot be deleted — they
 * are part of the installation's expected role registry. Use `updateRole`
 * to edit a non-owner system role's name/capabilities instead.
 */
export async function deleteCustomRole(db: DbClient, roleId: string): Promise<Role | null> {
  const current = await getRole(db, roleId)
  if (!current) return null
  if (current.isSystem) throw new RoleMutationError('System roles cannot be deleted', 409)

  const { rows } = await db<{ count: number }>`
    select count(*) as count
    from users
    where role_id = ${roleId}
      and deleted_at is null
  `
  if (Number(rows[0]?.count ?? 0) > 0) {
    throw new RoleMutationError('Cannot delete a role assigned to users', 409)
  }

  const result = await db`delete from roles where id = ${roleId}`
  return result.rowCount > 0 ? current : null
}

/**
 * Boot-time sync — UPSERT every entry from `SYSTEM_ROLES` so the four built-in
 * roles (owner, admin, client, member) always exist after a fresh install OR
 * an upgrade that introduces a new system role.
 *
 *  - Owner: name / description / capabilities are ALWAYS resynced from the
 *    code constants. Adding a new capability to `CORE_CAPABILITIES` therefore
 *    propagates to every existing installation on the next boot — owners are
 *    never stranded on a stale grant list.
 *  - Other system roles: inserted on first boot only. Subsequent boots leave
 *    the persisted row untouched so user-customised name / description /
 *    capabilities survive upgrades. Use the admin UI to edit them.
 *
 * Called from `server/index.ts` after `runMigrations`.
 */
export async function syncSystemRoles(db: DbClient): Promise<void> {
  for (const role of SYSTEM_ROLES) {
    const isOwner = role.id === OWNER_ROLE_ID
    if (isOwner) {
      // Force-resync the Owner row to whatever the code declares.
      await db`
        insert into roles (id, slug, name, description, is_system, capabilities_json)
        values (${role.id}, ${role.slug}, ${role.name}, ${role.description}, ${true}, ${role.capabilities})
        on conflict (id) do update
        set slug = excluded.slug,
            name = excluded.name,
            description = excluded.description,
            is_system = excluded.is_system,
            capabilities_json = excluded.capabilities_json,
            updated_at = current_timestamp
      `
    } else {
      // First-boot seed for the role; preserve any later customisation.
      await db`
        insert into roles (id, slug, name, description, is_system, capabilities_json)
        values (${role.id}, ${role.slug}, ${role.name}, ${role.description}, ${true}, ${role.capabilities})
        on conflict (id) do nothing
      `
    }
  }
}

