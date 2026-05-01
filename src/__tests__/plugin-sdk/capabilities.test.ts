import { describe, expect, it } from 'bun:test'
import {
  PLUGIN_CAPABILITIES,
  isPluginPermission,
  permissionDescription,
  permissionLabel,
  permissionsForSurface,
} from '../../core/plugin-sdk'

describe('plugin capability registry', () => {
  it('contains author-facing metadata for every permission', () => {
    for (const capability of PLUGIN_CAPABILITIES) {
      expect(capability.permission).toBeString()
      expect(capability.label.length).toBeGreaterThan(0)
      expect(capability.description.length).toBeGreaterThan(0)
      expect(['low', 'medium', 'high', 'dangerous']).toContain(capability.risk)
      expect(capability.surfaces.length).toBeGreaterThan(0)
    }
  })

  it('looks up labels and descriptions by permission', () => {
    expect(permissionLabel('cms.routes')).toBe('Register backend CMS routes')
    expect(permissionDescription('cms.routes')).toContain('backend')
  })

  it('validates known permissions and rejects unknown values', () => {
    expect(isPluginPermission('cms.storage')).toBe(true)
    expect(isPluginPermission('cms.database.drop')).toBe(false)
  })

  it('lists permissions by surface', () => {
    expect(permissionsForSurface('server')).toContain('cms.routes')
    expect(permissionsForSurface('editor')).toContain('editor.toolbar')
    expect(permissionsForSurface('admin')).toContain('admin.navigation')
  })
})
