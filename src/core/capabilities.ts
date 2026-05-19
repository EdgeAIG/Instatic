/**
 * Site-editing capabilities are split three ways:
 *
 *   site.structure.edit  — add/remove/move/duplicate/rename nodes; manage
 *                          pages, visual components, classes registry.
 *   site.content.edit    — modify content-typed props on existing nodes
 *                          (text, richtext, image src/alt, link href, etc.).
 *                          The "client / copy editor" surface.
 *   site.style.edit      — modify CSS classes, style overrides, breakpoints,
 *                          framework tokens.
 *
 * Mirrored from `server/auth/capabilities.ts` — keep both lists in sync.
 */
export const CORE_CAPABILITIES = [
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
] as const

export type CoreCapability = typeof CORE_CAPABILITIES[number]

/**
 * Convenience set — any of these means the user can mutate the draft site in
 * some way. Granular diff validation enforces which kinds of changes are
 * actually allowed for a given caller.
 */
export const SITE_WRITE_CAPABILITIES: readonly CoreCapability[] = [
  'site.structure.edit',
  'site.content.edit',
  'site.style.edit',
]
