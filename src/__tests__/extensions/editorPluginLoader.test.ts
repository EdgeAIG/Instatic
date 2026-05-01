import { beforeEach, describe, expect, it } from 'bun:test'
import { activateInstalledEditorPlugins } from '../../core/extensions/editorPluginLoader'
import { pluginRuntime } from '../../core/extensions/runtime'
import type { CmsPluginsPayload, PluginManifest } from '../../core/plugin-sdk'

const workflowManifest: PluginManifest = {
  id: 'acme.workflow',
  name: 'Workflow Tools',
  version: '1.0.0',
  apiVersion: 1,
  permissions: ['editor.commands', 'editor.toolbar'],
  grantedPermissions: ['editor.commands', 'editor.toolbar'],
  entrypoints: {
    editor: 'editor/index.js',
  },
  assetBasePath: '/uploads/plugins/acme.workflow/1.0.0',
  resources: [],
  adminPages: [],
}

beforeEach(() => {
  pluginRuntime.reset()
})

describe('installed editor plugin loader', () => {
  it('loads enabled packaged editor plugins and activates them with granted permissions', async () => {
    const payload: CmsPluginsPayload = {
      adminPages: [],
      plugins: [{
        id: workflowManifest.id,
        name: workflowManifest.name,
        version: workflowManifest.version,
        enabled: true,
        lifecycleStatus: 'active',
        lastError: null,
        grantedPermissions: ['editor.commands', 'editor.toolbar'],
        manifest: workflowManifest,
        installedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }],
    }
    const imported: string[] = []

    const result = await activateInstalledEditorPlugins({
      fetchImpl: async () => Response.json(payload),
      importModule: async (url) => {
        imported.push(url)
        return {
          activate(api) {
            api.editor.commands.register({
              id: 'workflow.approve',
              label: 'Approve Page',
              run: () => {},
            })
            api.editor.toolbar.addButton({
              id: 'workflow.approve',
              label: 'Approve',
              command: 'workflow.approve',
            })
          },
        }
      },
    })

    expect(imported).toEqual(['/uploads/plugins/acme.workflow/1.0.0/editor/index.js'])
    expect(result).toEqual({
      activated: ['acme.workflow'],
      failed: [],
    })
    expect(pluginRuntime.getToolbarButtons()).toEqual([{
      id: 'workflow.approve',
      label: 'Approve',
      command: 'workflow.approve',
      pluginId: 'acme.workflow',
    }])
  })

  it('resets stale registrations and skips disabled plugins', async () => {
    pluginRuntime.registerToolbarButton('stale.plugin', {
      id: 'stale.action',
      label: 'Stale',
      command: 'stale.action',
    })

    const result = await activateInstalledEditorPlugins({
      fetchImpl: async () => Response.json({
        adminPages: [],
        plugins: [{
          id: workflowManifest.id,
          name: workflowManifest.name,
          version: workflowManifest.version,
          enabled: false,
          lifecycleStatus: 'disabled',
          lastError: null,
          grantedPermissions: ['editor.commands', 'editor.toolbar'],
          manifest: workflowManifest,
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      } satisfies CmsPluginsPayload),
      importModule: async () => {
        throw new Error('Disabled plugins should not be imported')
      },
    })

    expect(result).toEqual({
      activated: [],
      failed: [],
    })
    expect(pluginRuntime.getToolbarButtons()).toEqual([])
  })

  it('skips enabled editor plugins with lifecycle errors', async () => {
    const imported: string[] = []

    const result = await activateInstalledEditorPlugins({
      fetchImpl: async () => Response.json({
        adminPages: [],
        plugins: [{
          id: workflowManifest.id,
          name: workflowManifest.name,
          version: workflowManifest.version,
          enabled: true,
          lifecycleStatus: 'error',
          lastError: 'activate exploded',
          grantedPermissions: ['editor.commands', 'editor.toolbar'],
          manifest: workflowManifest,
          installedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }],
      } satisfies CmsPluginsPayload),
      importModule: async (url) => {
        imported.push(url)
        return {
          activate() {},
        }
      },
    })

    expect(imported).toEqual([])
    expect(result).toEqual({
      activated: [],
      failed: [],
    })
  })
})
