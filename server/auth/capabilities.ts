import { Type, type Static } from '@core/utils/typeboxHelpers'

/**
 * Site-editing capabilities are split three ways:
 *
 *   site.structure.edit  — add/remove/move/duplicate/rename nodes; manage
 *                          pages, visual components, classes registry.
 *                          Anything that changes the tree shape or page roster.
 *   site.content.edit    — modify content-typed props on existing nodes
 *                          (text, richtext, image src/alt, link href, etc.).
 *                          Does NOT permit structural changes or style changes.
 *                          This is the "client / copy editor" surface.
 *   site.style.edit      — modify CSS classes, style overrides, breakpoints,
 *                          framework tokens (colors, typography, spacing).
 *
 * The built-in Editor role has all three. The built-in Client role has only
 * `site.content.edit` (plus `site.read`). A future "designer" role could have
 * `site.style.edit` without structural rights.
 */
const CoreCapabilitySchema = Type.Union([
  Type.Literal('dashboard.read'),
  Type.Literal('site.read'),
  Type.Literal('site.structure.edit'),
  Type.Literal('site.content.edit'),
  Type.Literal('site.style.edit'),
  Type.Literal('pages.edit'),
  Type.Literal('pages.publish'),
  Type.Literal('content.create'),
  Type.Literal('content.edit.own'),
  Type.Literal('content.edit.any'),
  Type.Literal('content.publish.own'),
  Type.Literal('content.publish.any'),
  Type.Literal('content.manage'),
  Type.Literal('media.manage'),
  Type.Literal('runtime.manage'),
  Type.Literal('plugins.manage'),
  Type.Literal('users.manage'),
  Type.Literal('roles.manage'),
  Type.Literal('audit.read'),
])

export type CoreCapability = Static<typeof CoreCapabilitySchema>

const CORE_CAPABILITIES: CoreCapability[] = [
  'dashboard.read',
  'site.read',
  'site.structure.edit',
  'site.content.edit',
  'site.style.edit',
  'pages.edit',
  'pages.publish',
  'content.create',
  'content.edit.own',
  'content.edit.any',
  'content.publish.own',
  'content.publish.any',
  'content.manage',
  'media.manage',
  'runtime.manage',
  'plugins.manage',
  'users.manage',
  'roles.manage',
  'audit.read',
]

/**
 * Convenience set — any of these capabilities means the user can mutate the
 * draft site in some way. The save handler accepts a write if the caller has
 * at least one of them; granular diff validation enforces which kinds of
 * changes are actually allowed.
 */
export const SITE_WRITE_CAPABILITIES: readonly CoreCapability[] = [
  'site.structure.edit',
  'site.content.edit',
  'site.style.edit',
]

export interface SystemRoleDefinition {
  id: string
  slug: string
  name: string
  description: string
  capabilities: CoreCapability[]
}

/**
 * The four built-in system roles. Owner is special — its capability set is
 * resyncing from `CORE_CAPABILITIES` on every server boot via
 * `syncOwnerRoleCapabilities` so that adding a new capability to the codebase
 * never strands existing Owner accounts on a stale grant list. The other
 * three are seeded once and freely editable by users with `roles.manage`.
 */
const adminCapabilities: CoreCapability[] = CORE_CAPABILITIES.filter(
  // `roles.manage` is owner-only by design — only the installation owner
  // edits capabilities. Admin manages everything else (users, content,
  // plugins, runtime).
  (cap) => cap !== 'roles.manage',
)

const clientCapabilities: CoreCapability[] = [
  'dashboard.read',
  'site.read',
  'site.content.edit',
]

export const SYSTEM_ROLES: SystemRoleDefinition[] = [
  {
    id: 'owner',
    slug: 'owner',
    name: 'Owner',
    description: 'Permanent installation owner with full system access.',
    capabilities: CORE_CAPABILITIES,
  },
  {
    id: 'admin',
    slug: 'admin',
    name: 'Admin',
    description: 'Full admin access (cannot manage roles).',
    capabilities: adminCapabilities,
  },
  {
    id: 'client',
    slug: 'client',
    name: 'Client',
    description: 'Can edit page copy (text, images, links) but not structure or styles.',
    capabilities: clientCapabilities,
  },
  {
    id: 'member',
    slug: 'member',
    name: 'Member',
    description: 'Public-facing member account — no admin access by default.',
    capabilities: [],
  },
]

/**
 * The Owner role id is the well-known constant the boot-time sync targets.
 */
export const OWNER_ROLE_ID = 'owner'

export function isCoreCapability(value: unknown): value is CoreCapability {
  return typeof value === 'string' && CORE_CAPABILITIES.includes(value as CoreCapability)
}

export function normalizeCapabilities(value: unknown): CoreCapability[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<CoreCapability>()
  for (const item of value) {
    if (isCoreCapability(item)) seen.add(item)
  }
  return [...seen].sort((a, b) => CORE_CAPABILITIES.indexOf(a) - CORE_CAPABILITIES.indexOf(b))
}

export function roleHasCapability(capabilities: readonly CoreCapability[], capability: CoreCapability): boolean {
  return capabilities.includes(capability)
}
