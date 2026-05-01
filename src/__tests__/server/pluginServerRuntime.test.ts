import { beforeEach, describe, expect, it } from 'bun:test'
import {
  activateServerPlugin,
  handleServerPluginRuntimeRequest,
  runServerPluginLifecycleHook,
  serverPluginRuntime,
} from '../../../server/cms/serverPluginRuntime'
import type { DbClient, DbResult } from '../../../server/cms/db'
import type { PluginManifest } from '../../core/plugin-sdk'

class RuntimeFakeDb implements DbClient {
  async query<Row extends Record<string, unknown> = Record<string, unknown>>(): Promise<DbResult<Row>> {
    return { rows: [], rowCount: 0 }
  }
}

const workflowManifest: PluginManifest = {
  id: 'acme.workflow',
  name: 'Workflow Tools',
  version: '1.0.0',
  apiVersion: 1,
  permissions: ['cms.routes', 'cms.storage'],
  grantedPermissions: ['cms.routes', 'cms.storage'],
  resources: [],
  adminPages: [],
}

beforeEach(() => {
  serverPluginRuntime.reset()
})

describe('server plugin runtime SDK', () => {
  it('lets trusted server plugin code register authenticated backend routes', async () => {
    await activateServerPlugin(workflowManifest, {
      activate(api) {
        api.cms.routes.get('/approvals', async () => ({
          approvals: [{ pageId: 'page_home', status: 'approved' }],
        }))
      },
    }, new RuntimeFakeDb())

    const res = await handleServerPluginRuntimeRequest(
      new Request('http://localhost/api/cms/plugins/acme.workflow/runtime/approvals'),
      new RuntimeFakeDb(),
    )

    expect(res?.status).toBe(200)
    expect(await res?.json()).toEqual({
      approvals: [{ pageId: 'page_home', status: 'approved' }],
    })
  })

  it('blocks backend route registration without the cms.routes permission grant', async () => {
    await expect(activateServerPlugin({
      ...workflowManifest,
      grantedPermissions: ['cms.storage'],
    }, {
      activate(api) {
        api.cms.routes.get('/approvals', async () => ({ ok: true }))
      },
    }, new RuntimeFakeDb())).rejects.toThrow('requires permission "cms.routes"')
  })

  it('uses the shared permission guard error format', async () => {
    await expect(activateServerPlugin({
      ...workflowManifest,
      grantedPermissions: [],
    }, {
      activate(api) {
        api.cms.routes.get('/blocked', () => ({ ok: true }))
      },
    }, new RuntimeFakeDb())).rejects.toThrow('Plugin "acme.workflow" requires permission "cms.routes"')
  })

  it('runs optional lifecycle hooks with plugin metadata and logging helpers', async () => {
    const calls: string[] = []
    const mod = {
      install(api) {
        calls.push(`${api.plugin.id}:${api.plugin.version}:${api.plugin.permissions.join(',')}`)
        api.plugin.log('installed')
      },
    }

    await runServerPluginLifecycleHook(workflowManifest, mod, new RuntimeFakeDb(), 'install')

    expect(calls).toEqual(['acme.workflow:1.0.0:cms.routes,cms.storage'])
  })
})
