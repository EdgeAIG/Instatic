/**
 * Capability groupings shown in the role-edit dialog.
 *
 * The order here is the visual order in the dialog. Each entry maps to a
 * `<section>` with its own "Select all / Clear" header. New capabilities
 * MUST be added to one of the groups — the role-edit dialog only renders
 * capabilities listed here.
 */
import type { CapabilityGroup } from '../types'

export const CAPABILITY_GROUPS: CapabilityGroup[] = [
  {
    title: 'Site',
    capabilities: [
      'site.read',
      'site.structure.edit',
      'site.content.edit',
      'site.style.edit',
    ],
  },
  { title: 'Pages', capabilities: ['pages.edit', 'pages.publish'] },
  {
    title: 'Content',
    capabilities: [
      'content.create',
      'content.edit.own',
      'content.edit.any',
      'content.publish.own',
      'content.publish.any',
      'content.manage',
    ],
  },
  { title: 'Media', capabilities: ['media.manage'] },
  { title: 'Runtime', capabilities: ['runtime.manage'] },
  { title: 'Plugins', capabilities: ['plugins.manage'] },
  { title: 'Users & Roles', capabilities: ['users.manage', 'roles.manage'] },
  { title: 'Audit', capabilities: ['audit.read'] },
]
