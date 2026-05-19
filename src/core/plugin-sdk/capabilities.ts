import type { PluginPermission } from './types'

export type PluginCapabilitySurface = 'manifest' | 'admin' | 'editor' | 'server' | 'cms' | 'frontend'
export type PluginCapabilityRisk = 'low' | 'medium' | 'high' | 'dangerous'

export interface PluginCapability {
  permission: PluginPermission
  label: string
  description: string
  risk: PluginCapabilityRisk
  surfaces: PluginCapabilitySurface[]
}

export const PLUGIN_CAPABILITIES: PluginCapability[] = [
  {
    permission: 'admin.navigation',
    label: 'Add pages to the admin navigation',
    description: 'Allows the plugin to add pages to the CMS admin sidebar and plugin page router.',
    risk: 'low',
    surfaces: ['manifest', 'admin'],
  },
  {
    permission: 'cms.storage',
    label: 'Read and write plugin backend storage',
    description: 'Allows the plugin to read and write records in resources declared by its manifest.',
    risk: 'medium',
    surfaces: ['admin', 'editor', 'server', 'cms'],
  },
  {
    permission: 'cms.routes',
    label: 'Register backend CMS routes',
    description: 'Allows the plugin server entrypoint to register authenticated backend routes.',
    risk: 'high',
    surfaces: ['server', 'cms'],
  },
  {
    permission: 'cms.hooks',
    label: 'Subscribe to CMS lifecycle events and filters',
    description: 'Allows the plugin server entrypoint to listen to CMS events (publish, content changes, page updates) and to register filters that transform values before they leave the CMS.',
    risk: 'high',
    surfaces: ['server', 'cms'],
  },
  {
    permission: 'editor.toolbar',
    label: 'Add controls to the editor toolbar',
    description: 'Allows the plugin editor entrypoint to add toolbar buttons.',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.commands',
    label: 'Register editor commands',
    description: 'Allows the plugin editor entrypoint to register commands that can be invoked by editor UI. Also grants registration of Command Spotlight palette commands (api.editor.palette.registerCommand) and live-search providers (api.editor.palette.registerProvider).',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.store.read',
    label: 'Read editor state',
    description: 'Allows the plugin to inspect the current editor store state.',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.store.write',
    label: 'Modify editor state',
    description: 'Allows the plugin to mutate editor store state through a host transaction.',
    risk: 'high',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.canvas',
    label: 'Add canvas overlays',
    description: 'Allows the plugin to register canvas overlay React components — annotation pins, custom selection adornments, measurement tools — that mount on top of the rendered canvas via `editor.canvas.registerOverlay`.',
    risk: 'high',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.panels',
    label: 'Add editor panels',
    description: 'Allows the plugin to register panels that mount in the editor\'s left sidebar (custom inspectors, plugin dashboards, review queues).',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'modules.register',
    label: 'Register page builder modules',
    description: 'Allows the plugin to ship new modules that show up in the canvas module library.',
    risk: 'high',
    surfaces: ['editor', 'manifest'],
  },
  {
    permission: 'loops.register',
    label: 'Register loop entity sources',
    description: 'Allows the plugin to register data sources for the base.loop module (e.g. external collections, custom queries).',
    risk: 'medium',
    surfaces: ['editor', 'server', 'manifest'],
  },
  {
    permission: 'visualComponents.register',
    label: 'Install Visual Components / templates into the site',
    description: 'Allows the plugin to ship Visual Components, page templates, and class packs that are imported into the user\'s site on activation.',
    risk: 'medium',
    surfaces: ['admin', 'manifest'],
  },
  {
    permission: 'dashboard.widgets.register',
    label: 'Register dashboard widgets',
    description: 'Allows the plugin to add cards to the admin dashboard grid (e.g. analytics charts, queue counters, plugin-specific stats). Each widget runs as a regular React component inside the host\'s admin shell.',
    risk: 'medium',
    surfaces: ['admin'],
  },
  {
    permission: 'frontend.scripts',
    label: 'Inject scripts into published pages',
    description: 'Allows the plugin to ship a JavaScript file that is loaded on every published page (analytics, third-party widgets, custom runtimes).',
    risk: 'high',
    surfaces: ['frontend', 'manifest'],
  },
  {
    permission: 'frontend.tracker',
    label: 'Receive frontend analytics events',
    description: 'Allows the plugin to receive structured tracker events from published pages and store them in plugin-owned storage.',
    risk: 'medium',
    surfaces: ['frontend', 'server', 'manifest'],
  },
  {
    permission: 'cms.schedule',
    label: 'Register scheduled jobs',
    description: 'Allows the plugin to register handlers that fire on a cadence (hourly / daily / weekly / monthly / every-N-minutes). Each handler runs inside the QuickJS sandbox with a per-fire wall-clock budget; the host scheduler tick drives dispatch and records run history.',
    risk: 'high',
    surfaces: ['server'],
  },
  {
    permission: 'unstable.internals',
    label: 'Use unstable internal APIs',
    description: 'Reserved for trusted first-party plugins that need unstable host internals.',
    risk: 'dangerous',
    surfaces: ['admin', 'editor', 'server', 'cms'],
  },
]

const capabilityByPermission = new Map(
  PLUGIN_CAPABILITIES.map((capability) => [capability.permission, capability]),
)

export function isPluginPermission(value: unknown): value is PluginPermission {
  return typeof value === 'string' && capabilityByPermission.has(value as PluginPermission)
}

export function permissionLabel(permission: PluginPermission): string {
  return capabilityByPermission.get(permission)?.label ?? permission
}

export function permissionDescription(permission: PluginPermission): string {
  return capabilityByPermission.get(permission)?.description ?? ''
}

export function permissionsForSurface(surface: PluginCapabilitySurface): PluginPermission[] {
  return PLUGIN_CAPABILITIES
    .filter((capability) => capability.surfaces.includes(surface))
    .map((capability) => capability.permission)
}
