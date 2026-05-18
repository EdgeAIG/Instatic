import { describe, expect, it } from 'bun:test'
import {
  listCmsDataTables,
  createCmsDataTable,
  updateCmsDataTable,
  deleteCmsDataTable,
  listCmsDataRows,
  createCmsDataRow,
  saveCmsDataRowDraft,
  publishCmsDataRow,
  updateCmsDataRowStatus,
  updateCmsDataRowTable,
  updateCmsDataRowAuthor,
  deleteCmsDataRow,
  listCmsDataAuthors,
} from '@core/persistence/cmsData'

describe('CMS data client', () => {
  it('lists data tables with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const tables = await listCmsDataTables(async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        tables: [{
          id: 'posts',
          name: 'Posts',
          slug: 'posts',
          kind: 'postType',
          routeBase: '/posts',
          singularLabel: 'Post',
          pluralLabel: 'Posts',
          primaryFieldId: 'title',
          fields: [],
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
        }],
      }), { status: 200 })
    })

    expect(tables[0].slug).toBe('posts')
    expect(tables[0].routeBase).toBe('/posts')
    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/tables',
      init: { method: 'GET', credentials: 'include' },
    })
  })

  it('updates table identity and route settings with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const update = {
      name: 'Articles',
      slug: 'articles',
      routeBase: '/articles',
      singularLabel: 'Article',
      pluralLabel: 'Articles',
      fields: [],
    }

    const table = await updateCmsDataTable('posts', update, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        table: {
          id: 'posts',
          kind: 'postType',
          primaryFieldId: 'title',
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:02:00.000Z',
          ...update,
        },
      }), { status: 200 })
    })

    expect(table.name).toBe('Articles')
    expect(table.slug).toBe('articles')
    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/tables/posts',
      init: {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify(update))
  })

  it('creates tables with field definitions', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const input = {
      name: 'Products',
      slug: 'products',
      kind: 'postType' as const,
      routeBase: '/products',
      singularLabel: 'Product',
      pluralLabel: 'Products',
      primaryFieldId: 'title',
      fields: [
        { type: 'text', id: 'title', label: 'Title', required: true, builtIn: true },
        { type: 'text', id: 'slug', label: 'Slug', required: true, builtIn: true },
      ],
    }

    const table = await createCmsDataTable(input, async (requestInput, init) => {
      calls.push({ input: requestInput, init })
      return new Response(JSON.stringify({
        table: {
          id: 'products',
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
          ...input,
        },
      }), { status: 201 })
    })

    expect(table.id).toBe('products')
    expect(table.fields).toHaveLength(2)
    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/tables',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify(input))
  })

  it('creates and lists rows inside a table', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    await listCmsDataRows('posts', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ rows: [] }), { status: 200 })
    })

    await createCmsDataRow('posts', { cells: { title: 'Hello' } }, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        row: {
          id: 'row_1',
          tableId: 'posts',
          status: 'draft',
          authorUserId: null,
          cells: { title: 'Hello', slug: '', body: '', featuredMedia: null, seoTitle: '', seoDescription: '' },
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
          publishedAt: null,
        },
      }), { status: 201 })
    })

    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/tables/posts/rows',
      init: { method: 'GET', credentials: 'include' },
    })
    expect(calls[1]).toMatchObject({
      input: '/admin/api/cms/data/tables/posts/rows',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[1].init?.body).toBe(JSON.stringify({ cells: { title: 'Hello' } }))
  })

  it('lists data authors with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const authors = await listCmsDataAuthors(async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        authors: [{
          id: 'user_author',
          email: 'author@example.com',
          displayName: 'Author Name',
          roleSlug: 'editor',
          roleName: 'Editor',
        }],
      }), { status: 200 })
    })

    expect(authors).toEqual([{
      id: 'user_author',
      email: 'author@example.com',
      displayName: 'Author Name',
      roleSlug: 'editor',
      roleName: 'Editor',
    }])
    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/authors',
      init: { method: 'GET', credentials: 'include' },
    })
  })

  it('saves and publishes rows with JSON bodies', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const draft = {
      cells: {
        title: 'Hello',
        slug: 'hello',
        body: '# Hello',
        featuredMedia: null,
        seoTitle: 'SEO',
        seoDescription: 'Description',
      },
    }

    await saveCmsDataRowDraft('row_1', draft, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        row: {
          id: 'row_1',
          tableId: 'posts',
          status: 'draft',
          authorUserId: null,
          cells: draft.cells,
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:01:00.000Z',
          publishedAt: null,
        },
      }), { status: 200 })
    })

    await publishCmsDataRow('row_1', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ row: { id: 'row_1', status: 'published' } }), { status: 200 })
    })

    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/rows/row_1',
      init: {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify(draft))
    expect(calls[1]).toMatchObject({
      input: '/admin/api/cms/data/rows/row_1/publish',
      init: { method: 'POST', credentials: 'include' },
    })
  })

  it('updates a row status with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const row = await updateCmsDataRowStatus('row_1', 'unpublished', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        row: {
          id: 'row_1',
          tableId: 'posts',
          status: 'unpublished',
          authorUserId: null,
          cells: { title: 'Hello', slug: 'hello', body: '# Hello', featuredMedia: null, seoTitle: '', seoDescription: '' },
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:03:00.000Z',
          publishedAt: null,
        },
      }), { status: 200 })
    })

    expect(row.status).toBe('unpublished')
    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/rows/row_1/status',
      init: {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify({ status: 'unpublished' }))
  })

  it('moves rows between tables with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const row = await updateCmsDataRowTable('row_1', 'products', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        row: {
          id: 'row_1',
          tableId: 'products',
          status: 'draft',
          authorUserId: null,
          cells: { title: 'Hello', slug: 'hello', body: '', featuredMedia: null, seoTitle: '', seoDescription: '' },
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:03:00.000Z',
          publishedAt: null,
        },
      }), { status: 200 })
    })

    expect(row.tableId).toBe('products')
    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/rows/row_1/table',
      init: {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify({ tableId: 'products' }))
  })

  it('updates a row author with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const row = await updateCmsDataRowAuthor('row_1', 'user_author_2', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        row: {
          id: 'row_1',
          tableId: 'posts',
          status: 'draft',
          authorUserId: 'user_author_2',
          cells: { title: 'Hello', slug: 'hello', body: '', featuredMedia: null, seoTitle: '', seoDescription: '' },
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:03:00.000Z',
          publishedAt: null,
        },
      }), { status: 200 })
    })

    expect(row.authorUserId).toBe('user_author_2')
    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/rows/row_1/author',
      init: {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify({ authorUserId: 'user_author_2' }))
  })

  it('deletes tables and rows with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    await deleteCmsDataRow('row_1', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        row: {
          id: 'row_1',
          tableId: 'posts',
          status: 'draft',
          authorUserId: null,
          cells: { title: 'Hello', slug: 'hello', body: '', featuredMedia: null, seoTitle: '', seoDescription: '' },
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:03:00.000Z',
          publishedAt: null,
        },
      }), { status: 200 })
    })

    await deleteCmsDataTable('products', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        table: {
          id: 'products',
          name: 'Products',
          slug: 'products',
          kind: 'postType',
          routeBase: '/products',
          singularLabel: 'Product',
          pluralLabel: 'Products',
          primaryFieldId: 'title',
          fields: [],
          createdByUserId: null,
          updatedByUserId: null,
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:03:00.000Z',
        },
      }), { status: 200 })
    })

    expect(calls[0]).toMatchObject({
      input: '/admin/api/cms/data/rows/row_1',
      init: { method: 'DELETE', credentials: 'include' },
    })
    expect(calls[1]).toMatchObject({
      input: '/admin/api/cms/data/tables/products',
      init: { method: 'DELETE', credentials: 'include' },
    })
  })

  it('surfaces API errors from the response body', async () => {
    await expect(
      listCmsDataTables(async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
    ).rejects.toThrow('Unauthorized')
  })
})
