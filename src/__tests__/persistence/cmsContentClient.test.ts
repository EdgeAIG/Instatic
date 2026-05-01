import { describe, expect, it } from 'bun:test'
import {
  createCmsContentEntry,
  listCmsContentCollections,
  listCmsContentEntries,
  publishCmsContentEntry,
  saveCmsContentEntryDraft,
  updateCmsContentCollection,
  updateCmsContentEntryStatus,
} from '../../core/persistence/cmsContent'

describe('CMS content client', () => {
  it('lists content collections with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const collections = await listCmsContentCollections(async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        collections: [{
          id: 'posts',
          name: 'Posts',
          slug: 'posts',
          routeBase: '/blog',
          singularLabel: 'Post',
          pluralLabel: 'Posts',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
        }],
      }), { status: 200 })
    })

    expect(collections[0].slug).toBe('posts')
    expect(collections[0].routeBase).toBe('/blog')
    expect(calls[0]).toMatchObject({
      input: '/api/cms/content/collections',
      init: { method: 'GET', credentials: 'include' },
    })
  })

  it('updates collection route settings with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const collection = await updateCmsContentCollection('posts', { routeBase: '/blog' }, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        collection: {
          id: 'posts',
          name: 'Posts',
          slug: 'posts',
          routeBase: '/blog',
          singularLabel: 'Post',
          pluralLabel: 'Posts',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:02:00.000Z',
        },
      }), { status: 200 })
    })

    expect(collection.routeBase).toBe('/blog')
    expect(calls[0]).toMatchObject({
      input: '/api/cms/content/collections/posts',
      init: {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify({ routeBase: '/blog' }))
  })

  it('creates and lists entries inside a collection', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    await listCmsContentEntries('posts', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ entries: [] }), { status: 200 })
    })

    await createCmsContentEntry('posts', { title: 'Hello', slug: 'hello' }, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        entry: {
          id: 'entry_1',
          collectionId: 'posts',
          title: 'Hello',
          slug: 'hello',
          status: 'draft',
          bodyMarkdown: '',
          featuredMediaId: null,
          seoTitle: '',
          seoDescription: '',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
          publishedAt: null,
          deletedAt: null,
        },
      }), { status: 201 })
    })

    expect(calls[0]).toMatchObject({
      input: '/api/cms/content/collections/posts/entries',
      init: { method: 'GET', credentials: 'include' },
    })
    expect(calls[1]).toMatchObject({
      input: '/api/cms/content/collections/posts/entries',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[1].init?.body).toBe(JSON.stringify({ title: 'Hello', slug: 'hello' }))
  })

  it('saves and publishes entries with JSON bodies', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const draft = {
      title: 'Hello',
      slug: 'hello',
      bodyMarkdown: '# Hello',
      featuredMediaId: null,
      seoTitle: 'SEO',
      seoDescription: 'Description',
    }

    await saveCmsContentEntryDraft('entry_1', draft, async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        entry: {
          id: 'entry_1',
          collectionId: 'posts',
          status: 'draft',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
          publishedAt: null,
          deletedAt: null,
          ...draft,
        },
      }), { status: 200 })
    })

    await publishCmsContentEntry('entry_1', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({ entry: { id: 'entry_1', status: 'published' } }), { status: 200 })
    })

    expect(calls[0]).toMatchObject({
      input: '/api/cms/content/entries/entry_1',
      init: {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify(draft))
    expect(calls[1]).toMatchObject({
      input: '/api/cms/content/entries/entry_1/publish',
      init: { method: 'POST', credentials: 'include' },
    })
  })

  it('updates an entry status with session credentials', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []

    const entry = await updateCmsContentEntryStatus('entry_1', 'unpublished', async (input, init) => {
      calls.push({ input, init })
      return new Response(JSON.stringify({
        entry: {
          id: 'entry_1',
          collectionId: 'posts',
          title: 'Hello',
          slug: 'hello',
          status: 'unpublished',
          bodyMarkdown: '# Hello',
          featuredMediaId: null,
          seoTitle: '',
          seoDescription: '',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:03:00.000Z',
          publishedAt: null,
          deletedAt: null,
        },
      }), { status: 200 })
    })

    expect(entry.status).toBe('unpublished')
    expect(calls[0]).toMatchObject({
      input: '/api/cms/content/entries/entry_1/status',
      init: {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
      },
    })
    expect(calls[0].init?.body).toBe(JSON.stringify({ status: 'unpublished' }))
  })

  it('surfaces API errors from the response body', async () => {
    await expect(
      listCmsContentCollections(async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })),
    ).rejects.toThrow('Unauthorized')
  })
})
