import { describe, expect, it } from 'bun:test'
import {
  createCmsPluginResourceRecord,
  deleteCmsPluginResourceRecord,
  listCmsPluginResourceRecords,
  updateCmsPluginResourceRecord,
} from '../../core/persistence/cmsPluginRecords'

describe('CMS plugin records client', () => {
  it('lists and creates plugin resource records with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const records = await listCmsPluginResourceRecords('acme.books', 'books', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        records: [{
          id: 'record_1',
          pluginId: 'acme.books',
          resourceId: 'books',
          data: { title: 'Invisible Cities' },
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
        }],
      }), { status: 200 })
    })

    await createCmsPluginResourceRecord('acme.books', 'books', {
      title: 'The Dispossessed',
    }, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        record: {
          id: 'record_2',
          pluginId: 'acme.books',
          resourceId: 'books',
          data: { title: 'The Dispossessed' },
          createdAt: '2026-05-01T10:05:00.000Z',
          updatedAt: '2026-05-01T10:05:00.000Z',
        },
      }), { status: 201 })
    })

    expect(records[0].data.title).toBe('Invisible Cities')
    expect(calls[0]).toMatchObject({
      input: '/api/cms/plugins/acme.books/resources/books/records',
      init: { method: 'GET', credentials: 'include' },
    })
    expect(calls[1]).toMatchObject({
      input: '/api/cms/plugins/acme.books/resources/books/records',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[1].init?.body).toBe(JSON.stringify({ data: { title: 'The Dispossessed' } }))
  })

  it('updates and deletes plugin resource records', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const updated = await updateCmsPluginResourceRecord('acme.books', 'books', 'record_1', {
      title: 'Solaris',
    }, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        record: {
          id: 'record_1',
          pluginId: 'acme.books',
          resourceId: 'books',
          data: { title: 'Solaris' },
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:10:00.000Z',
        },
      }), { status: 200 })
    })

    await deleteCmsPluginResourceRecord('acme.books', 'books', 'record_1', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    expect(updated.data.title).toBe('Solaris')
    expect(calls[0]).toMatchObject({
      input: '/api/cms/plugins/acme.books/resources/books/records/record_1',
      init: {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify({ data: { title: 'Solaris' } }))
    expect(calls[1]).toMatchObject({
      input: '/api/cms/plugins/acme.books/resources/books/records/record_1',
      init: { method: 'DELETE', credentials: 'include' },
    })
  })

  it('surfaces plugin record API errors from the response body', async () => {
    await expect(
      listCmsPluginResourceRecords('acme.books', 'books', async () =>
        new Response(JSON.stringify({ error: 'Plugin resource not found' }), { status: 404 })),
    ).rejects.toThrow('Plugin resource not found')
  })
})
