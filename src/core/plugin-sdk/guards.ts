import type { PluginManifest, PluginPermission } from './types'

export function hasPluginPermission(
  manifest: Pick<PluginManifest, 'grantedPermissions'>,
  permission: PluginPermission,
): boolean {
  return new Set(manifest.grantedPermissions ?? []).has(permission)
}

export function assertPluginPermission(
  manifest: Pick<PluginManifest, 'id' | 'grantedPermissions'>,
  permission: PluginPermission,
): void {
  if (!hasPluginPermission(manifest, permission)) {
    throw new Error(`Plugin "${manifest.id}" requires permission "${permission}"`)
  }
}
