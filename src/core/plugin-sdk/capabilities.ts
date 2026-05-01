import type { PluginPermission } from './types'

export type PluginCapabilitySurface = 'manifest' | 'admin' | 'editor' | 'server' | 'cms'
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
    permission: 'editor.toolbar',
    label: 'Add controls to the editor toolbar',
    description: 'Allows the plugin editor entrypoint to add toolbar buttons.',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.commands',
    label: 'Register editor commands',
    description: 'Allows the plugin editor entrypoint to register commands that can be invoked by editor UI.',
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
    label: 'Read and modify the editor canvas',
    description: 'Reserved for canvas-level plugin APIs.',
    risk: 'high',
    surfaces: ['editor'],
  },
  {
    permission: 'editor.panels',
    label: 'Add editor panels',
    description: 'Reserved for plugins that add panels to the editor workspace.',
    risk: 'medium',
    surfaces: ['editor'],
  },
  {
    permission: 'modules.register',
    label: 'Register page builder modules',
    description: 'Reserved for plugin-provided page builder modules.',
    risk: 'medium',
    surfaces: ['editor', 'manifest'],
  },
  {
    permission: 'hooks.register',
    label: 'Register CMS hooks and filters',
    description: 'Reserved for future CMS hook and filter APIs.',
    risk: 'high',
    surfaces: ['server', 'cms'],
  },
  {
    permission: 'storage.records',
    label: 'Store plugin-owned records',
    description: 'Compatibility alias for plugin-owned storage. Prefer cms.storage for new plugins.',
    risk: 'medium',
    surfaces: ['admin', 'editor', 'server', 'cms'],
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
