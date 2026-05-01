import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import {
  activateEditorPlugin,
  pluginRuntime,
} from '../../core/extensions/runtime'
import { useEditorStore } from '../../core/editor-store/store'
import type {
  EditorPluginModule,
  PluginAdminAppModule,
  PluginManifest,
  PluginRecord,
  ServerPluginApi,
  ServerPluginModule,
} from '../../core/plugin-sdk'
import { makeSite } from '../fixtures'

const workflowManifest: PluginManifest = {
  id: 'acme.workflow',
  name: 'Workflow Tools',
  version: '1.0.0',
  apiVersion: 1,
  description: 'Adds an approval workflow dashboard.',
  permissions: ['editor.toolbar', 'editor.commands', 'editor.store.read', 'cms.storage'],
  grantedPermissions: ['editor.toolbar', 'editor.commands', 'editor.store.read', 'cms.storage'],
  entrypoints: {
    editor: 'editor/index.js',
  },
  resources: [],
  adminPages: [],
}

beforeEach(() => {
  const site = makeSite({ name: 'Workflow Site' })
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
  } as Parameters<typeof useEditorStore.setState>[0])
  pluginRuntime.reset()
})

afterEach(() => {
  pluginRuntime.reset()
  document.body.replaceChildren()
  cleanup()
})

function workflowRecord(data: Record<string, unknown>, id = `record_${Date.now()}`): PluginRecord {
  return {
    id,
    pluginId: 'acme.workflow',
    resourceId: 'approvals',
    data,
    createdAt: '2026-05-01T10:00:00.000Z',
    updatedAt: '2026-05-01T10:00:00.000Z',
  }
}

describe('Workflow Tools example plugin', () => {
  it('creates an approval request from the editor command and returns visible feedback', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const editorModule = await import('../../../examples/plugins/workflow-tools/editor/index.js') as EditorPluginModule

    await activateEditorPlugin(workflowManifest, editorModule, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        record: workflowRecord(JSON.parse(String(init?.body)).data, 'record_1'),
      }), { status: 201 })
    })

    const result = await pluginRuntime.runCommand('workflow.requestApproval')

    expect(calls[0]?.input).toBe('/api/cms/plugins/acme.workflow/resources/approvals/records')
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({
      data: {
        'page-title': 'Home',
        status: 'pending',
        notes: 'Created from the editor toolbar.',
      },
    })
    expect(result && typeof result === 'object' ? result.message : '').toBe('Approval request created for Home')
  })

  it('renders a dashboard that creates and approves workflow records', async () => {
    const dashboardModule = await import('../../../examples/plugins/workflow-tools/admin/dashboard.js') as PluginAdminAppModule
    const records: PluginRecord[] = []
    const root = document.createElement('div')
    document.body.appendChild(root)

    await dashboardModule.render({
      root,
      page: {
        pluginId: 'acme.workflow',
        pluginName: 'Workflow Tools',
        id: 'dashboard',
        title: 'Workflow',
        route: '/admin/plugins/acme.workflow/dashboard',
        content: {
          kind: 'app',
          heading: 'Workflow Dashboard',
          entry: 'admin/dashboard.js',
        },
      },
      api: {
        cms: {
          routes: {
            fetch: async () => new Response(null),
            json: async (path: string) => {
              if (path === 'status') return { total: records.length }
              if (path === 'seed') {
                const record = workflowRecord({
                  'page-title': 'Homepage',
                  status: 'pending',
                }, 'record_seed')
                records.unshift(record)
                return { record }
              }
              return null
            },
          },
          storage: {
            collection: () => ({
              list: async () => records,
              create: async (data) => {
                const record = workflowRecord(data, 'record_1')
                records.unshift(record)
                return record
              },
              update: async (recordId, data) => {
                const index = records.findIndex((record) => record.id === recordId)
                records[index] = {
                  ...records[index],
                  data,
                  updatedAt: '2026-05-01T10:05:00.000Z',
                }
                return records[index]
              },
              delete: async () => {},
            }),
          },
        },
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Request approval' }))

    await waitFor(() => {
      expect(screen.getByText('Landing Page')).toBeDefined()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(screen.getByText('approved')).toBeDefined()
    })

    dashboardModule.cleanup?.({ root } as Parameters<NonNullable<typeof dashboardModule.cleanup>>[0])
  })

  it('exports server lifecycle hooks that register routes and clean plugin storage', async () => {
    const serverModule = await import('../../../examples/plugins/workflow-tools/server/index.js') as ServerPluginModule
    const routes: string[] = []
    const logs: string[] = []
    const records: PluginRecord[] = [
      workflowRecord({ 'page-title': 'Old Draft', status: 'pending' }, 'record_old'),
    ]
    const api: ServerPluginApi = {
      plugin: {
        id: 'acme.workflow',
        version: '1.0.0',
        permissions: ['cms.storage', 'cms.routes'],
        log: (...args) => logs.push(args.join(' ')),
      },
      cms: {
        routes: {
          get: (path) => routes.push(`GET ${path}`),
          post: (path) => routes.push(`POST ${path}`),
          patch: (path) => routes.push(`PATCH ${path}`),
          delete: (path) => routes.push(`DELETE ${path}`),
        },
        storage: {
          collection: () => ({
            list: async () => records,
            create: async (data) => {
              const record = workflowRecord(data, `record_${records.length + 1}`)
              records.unshift(record)
              return record
            },
            update: async (recordId, data) => {
              const index = records.findIndex((record) => record.id === recordId)
              if (index === -1) return null
              records[index] = { ...records[index], data }
              return records[index]
            },
            delete: async (recordId) => {
              const index = records.findIndex((record) => record.id === recordId)
              if (index === -1) return false
              records.splice(index, 1)
              return true
            },
          }),
        },
      },
    }

    await serverModule.install?.(api)
    await serverModule.activate?.(api)
    await serverModule.deactivate?.(api)
    await serverModule.uninstall?.(api)

    expect(routes).toEqual(['GET /status', 'POST /seed'])
    expect(records).toHaveLength(0)
    expect(logs).toContain('Workflow Tools installed')
    expect(logs).toContain('Workflow Tools activated')
    expect(logs).toContain('Workflow Tools deactivated')
  })
})
