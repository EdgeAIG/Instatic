import type { DataRow } from '@core/data/schemas'
import type { CmsCurrentUser } from '@core/persistence'
import { SITE_WRITE_CAPABILITIES, type CoreCapability } from '@core/capabilities'
import type { AdminWorkspace } from './workspace'

const CONTENT_ACCESS_CAPABILITIES: CoreCapability[] = [
  'content.create',
  'content.edit.own',
  'content.edit.any',
  'content.publish.own',
  'content.publish.any',
  'content.manage',
]

export function hasCapability(user: CmsCurrentUser | null, capability: CoreCapability): boolean {
  return Boolean(user?.capabilities.includes(capability))
}

function hasAnyCapability(user: CmsCurrentUser | null, capabilities: readonly CoreCapability[]): boolean {
  return capabilities.some((capability) => hasCapability(user, capability))
}

export function hasAllCapabilities(user: CmsCurrentUser | null, capabilities: readonly CoreCapability[]): boolean {
  return capabilities.every((capability) => hasCapability(user, capability))
}

// ---------------------------------------------------------------------------
// Site-editor capability helpers
//
// The editor surfaces three granular capabilities:
//   - site.structure.edit  — DnD, add/remove/move/rename nodes, manage pages
//   - site.content.edit    — modify content-typed props (text, image, href)
//   - site.style.edit      — class styles, breakpoints, framework tokens
//
// A user may hold any subset. The editor renders based on which they hold.
// ---------------------------------------------------------------------------

/** Caller can perform structural edits (DnD, add/remove/move nodes, pages). */
export function canEditStructure(user: CmsCurrentUser | null): boolean {
  // Anonymous in tests / SSR is treated as full-access — the gate is the
  // browser's authenticated session, not the absence of a user object.
  if (!user) return true
  return hasAllCapabilities(user, ['site.structure.edit', 'pages.edit'])
}

/** Caller can modify content-typed props on existing nodes. */
export function canEditContent(user: CmsCurrentUser | null): boolean {
  if (!user) return true
  return hasCapability(user, 'site.content.edit')
}

/** Caller can modify CSS classes, style overrides, breakpoints, tokens. */
export function canEditStyle(user: CmsCurrentUser | null): boolean {
  if (!user) return true
  return hasCapability(user, 'site.style.edit')
}

/** Caller can save the draft site in any form (structure + content + style). */
export function canSaveDraftSite(user: CmsCurrentUser | null): boolean {
  if (!user) return true
  return hasAnyCapability(user, SITE_WRITE_CAPABILITIES)
}

function ownsDataRow(user: CmsCurrentUser | null, row: DataRow | null): boolean {
  if (!user || !row) return false
  return row.authorUserId === user.id || (!row.authorUserId && row.createdByUserId === user.id)
}

function canAccessContent(user: CmsCurrentUser | null): boolean {
  return hasAnyCapability(user, CONTENT_ACCESS_CAPABILITIES)
}

export function canCreateContent(user: CmsCurrentUser | null): boolean {
  return hasCapability(user, 'content.create')
}

export function canManageContentCollections(user: CmsCurrentUser | null): boolean {
  return hasCapability(user, 'content.manage')
}

export function canEditAnyContent(user: CmsCurrentUser | null): boolean {
  return hasAnyCapability(user, ['content.edit.any', 'content.manage'])
}

export function canEditContentEntry(user: CmsCurrentUser | null, row: DataRow | null): boolean {
  return canEditAnyContent(user) || (ownsDataRow(user, row) && hasCapability(user, 'content.edit.own'))
}

export function canPublishContentEntry(user: CmsCurrentUser | null, row: DataRow | null): boolean {
  return hasCapability(user, 'content.publish.any') ||
    (ownsDataRow(user, row) && hasCapability(user, 'content.publish.own'))
}

function canAccessUsersWorkspace(user: CmsCurrentUser | null): boolean {
  return hasAnyCapability(user, ['users.manage', 'roles.manage', 'audit.read'])
}

export function canAccessWorkspace(user: CmsCurrentUser | null, workspace: AdminWorkspace): boolean {
  switch (workspace) {
    case 'site':
      // site.read covers the read-only canvas viewer. Editors of any flavour
      // (structure / content / style) also have site.read on a well-formed
      // role, so this single check is sufficient.
      return hasCapability(user, 'site.read')
    case 'content':
      return canAccessContent(user)
    case 'data':
      return canAccessContent(user)
    case 'media':
      return hasCapability(user, 'media.manage')
    case 'plugins':
    case 'pluginPage':
      return hasCapability(user, 'plugins.manage')
    case 'users':
      return canAccessUsersWorkspace(user)
    case 'account':
      // Self-targeted page — every authenticated user can manage their own
      // profile + devices. Anonymous visitors fall through to false.
      return user !== null
  }
}

export function firstAccessibleWorkspace(user: CmsCurrentUser | null): AdminWorkspace | null {
  const order: AdminWorkspace[] = ['site', 'content', 'data', 'media', 'plugins', 'users']
  return order.find((workspace) => canAccessWorkspace(user, workspace)) ?? null
}

export function workspacePath(workspace: AdminWorkspace): string {
  switch (workspace) {
    case 'site':
      return '/admin/site'
    case 'content':
      return '/admin/content'
    case 'data':
      return '/admin/data'
    case 'media':
      return '/admin/media'
    case 'plugins':
      return '/admin/plugins'
    case 'users':
      return '/admin/users'
    case 'pluginPage':
      return '/admin/plugins'
    case 'account':
      return '/admin/account'
  }
}
