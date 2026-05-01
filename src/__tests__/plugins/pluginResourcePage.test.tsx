import { afterEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PluginPageRenderer } from '../../plugins/PluginPageRenderer'
import type { PluginAdminAppModule, PluginAdminPageRoute } from '../../core/plugin-sdk'

const originalFetch = globalThis.fetch

const booksPage: PluginAdminPageRoute = {
  pluginId: 'acme.books',
  pluginName: 'Books',
  id: 'books',
  title: 'Books',
  navLabel: 'Books',
  route: '/admin/plugins/acme.books/books',
  content: {
    kind: 'resource',
    heading: 'Books',
    resource: 'books',
  },
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

describe('PluginPageRenderer resource pages', () => {
  it('loads backend records and creates new records through the plugin resource API', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      const url = String(input)

      if (url === '/api/cms/plugins/acme.books/resources/books/records' && init?.method === 'GET') {
        return json({
          resource: {
            id: 'books',
            title: 'Books',
            singularLabel: 'Book',
            pluralLabel: 'Books',
            fields: [
              { id: 'title', label: 'Title', type: 'text', required: true },
              { id: 'author', label: 'Author', type: 'text' },
            ],
          },
          records: [{
            id: 'record_1',
            pluginId: 'acme.books',
            resourceId: 'books',
            data: { title: 'Invisible Cities', author: 'Italo Calvino' },
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T10:00:00.000Z',
          }],
        })
      }

      if (url === '/api/cms/plugins/acme.books/resources/books/records' && init?.method === 'POST') {
        return json({
          record: {
            id: 'record_2',
            pluginId: 'acme.books',
            resourceId: 'books',
            data: JSON.parse(String(init.body)).data,
            createdAt: '2026-05-01T10:05:00.000Z',
            updatedAt: '2026-05-01T10:05:00.000Z',
          },
        }, 201)
      }

      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(<PluginPageRenderer page={booksPage} />)

    expect(await screen.findByText('Invisible Cities')).toBeDefined()

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'The Dispossessed' } })
    fireEvent.change(screen.getByLabelText('Author'), { target: { value: 'Ursula K. Le Guin' } })
    fireEvent.click(screen.getByRole('button', { name: /create book/i }))

    await waitFor(() => {
      expect(calls.some((call) =>
        String(call.input) === '/api/cms/plugins/acme.books/resources/books/records' &&
        call.init?.method === 'POST' &&
        call.init.body === JSON.stringify({
          data: {
            title: 'The Dispossessed',
            author: 'Ursula K. Le Guin',
          },
        })
      )).toBe(true)
    })
  })

  it('mounts packaged JavaScript admin app pages with a plugin-scoped CMS API', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init })
      return json({
        resource: {
          id: 'approvals',
          title: 'Approvals',
          fields: [
            { id: 'pageTitle', label: 'Page Title', type: 'text', required: true },
          ],
        },
        records: [{
          id: 'record_1',
          pluginId: 'acme.workflow',
          resourceId: 'approvals',
          data: { pageTitle: 'Home', status: 'approved' },
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
        }],
      })
    }

    render(
      <PluginPageRenderer
        page={{
          pluginId: 'acme.workflow',
          pluginName: 'Workflow Tools',
          id: 'dashboard',
          title: 'Dashboard',
          route: '/admin/plugins/acme.workflow/dashboard',
          content: {
            kind: 'app',
            heading: 'Workflow Dashboard',
            entry: 'admin/dashboard.js',
            assetPath: '/uploads/plugins/acme.workflow/1.0.0',
          },
        }}
        importModule={async (url) => {
          expect(url).toBe('/uploads/plugins/acme.workflow/1.0.0/admin/dashboard.js')
          return {
            async render({ root, api }) {
              const records = await api.cms.storage.collection('approvals').list()
              root.innerHTML = `<strong>Approvals: ${records.length}</strong>`
            },
          }
        }}
      />,
    )

    expect(await screen.findByText('Approvals: 1')).toBeDefined()
    expect(calls[0]?.input).toBe('/api/cms/plugins/acme.workflow/resources/approvals/records')
  })

  it('keeps stale async admin app renders from duplicating the visible plugin UI', async () => {
    const appPage: PluginAdminPageRoute = {
      pluginId: 'acme.workflow',
      pluginName: 'Workflow Tools',
      id: 'dashboard',
      title: 'Dashboard',
      route: '/admin/plugins/acme.workflow/dashboard',
      content: {
        kind: 'app',
        heading: 'Workflow Dashboard',
        entry: 'admin/dashboard.js',
        assetPath: '/uploads/plugins/acme.workflow/1.0.0',
      },
    }

    const imports: Array<(mod: PluginAdminAppModule) => void> = []
    const importModule = async () =>
      await new Promise<PluginAdminAppModule>((resolve) => {
        imports.push(resolve)
      })

    const appModule: PluginAdminAppModule = {
      render({ root }: { root: HTMLElement }) {
        const marker = document.createElement('strong')
        marker.textContent = 'Workflow dashboard app'
        root.appendChild(marker)
      },
    }

    const { rerender } = render(<PluginPageRenderer page={{ ...appPage }} importModule={importModule} />)

    await waitFor(() => {
      expect(imports).toHaveLength(1)
    })

    rerender(<PluginPageRenderer page={{ ...appPage }} importModule={importModule} />)

    await waitFor(() => {
      expect(imports).toHaveLength(2)
    })

    await act(async () => {
      imports[0](appModule)
      imports[1](appModule)
    })

    await waitFor(() => {
      expect(screen.getAllByText('Workflow dashboard app')).toHaveLength(1)
    })
  })
})
