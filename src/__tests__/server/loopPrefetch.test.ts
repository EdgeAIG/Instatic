/**
 * Tests for the server-side loop pre-fetch helper.
 * Uses the dbTestFake harness so tests don't require a real DB.
 */

import { describe, expect, it } from 'bun:test'
import {
  collectLoopNodes,
  prefetchLoopData,
  publishedDataRowToLoopItem,
  readLoopProps,
} from '../../../server/publish/loopPrefetch'
import type { DbResult } from '../../../server/db'
import { createFakeDb } from './dbTestFake'
import { makePage, makeSite } from '../publisher/helpers'

// Make sure the built-in sources are registered.
import '@core/loops/sources'

describe('loopPrefetch', () => {
  it('maps published data row authorship into public loop fields', () => {
    const item = publishedDataRowToLoopItem({
      id: 'version_1',
      rowId: 'row_1',
      tableId: 'posts',
      tableSlug: 'posts',
      tableKind: 'postType',
      tableRouteBase: '/posts',
      versionNumber: 1,
      cells: {
        title: 'Published post',
        slug: 'published-post',
        body: 'Body',
        seoTitle: '',
        seoDescription: '',
      },
      slug: 'published-post',
      featuredMediaId: null,
      featuredMediaPath: null,
      authorUserId: 'author_1',
      authorName: 'Author Name',
      authorRoleSlug: 'editor',
      authorRoleName: 'Editor',
      publishedByUserId: 'publisher_1',
      publishedByName: 'Publisher Name',
      publishedByRoleSlug: 'admin',
      publishedByRoleName: 'Admin',
      publishedAt: '2026-05-01T10:02:00.000Z',
      createdAt: '2026-05-01T10:02:00.000Z',
    })

    expect(item.fields).toMatchObject({
      author: {
        displayName: 'Author Name',
        roleSlug: 'editor',
        roleName: 'Editor',
      },
      authorName: 'Author Name',
      authorRoleName: 'Editor',
      authorRoleSlug: 'editor',
      publishedBy: {
        displayName: 'Publisher Name',
        roleSlug: 'admin',
        roleName: 'Admin',
      },
      publishedByName: 'Publisher Name',
      publishedByRoleName: 'Admin',
      publishedByRoleSlug: 'admin',
    })
    expect('authorUserId' in item.fields).toBe(false)
    expect('authorId' in item.fields).toBe(false)
    expect('publishedByUserId' in item.fields).toBe(false)
    expect('publishedById' in item.fields).toBe(false)
  })

  it('readLoopProps coerces missing/invalid props into safe defaults', () => {
    const props = readLoopProps({
      id: 'l',
      moduleId: 'base.loop',
      props: {},
      children: [],
      breakpointOverrides: {},
      classIds: [],
    })
    expect(props.sourceId).toBe('')
    expect(props.limit).toBe(10)
    expect(props.offset).toBe(0)
    expect(props.direction).toBe('desc')
    expect(props.pagination).toBe('none')
    expect(props.pageSize).toBe(10)
  })

  it('collectLoopNodes returns every base.loop reachable from the root', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['loop1', 'box'] },
      box: { moduleId: 'base.container', children: ['loop2'] },
      loop1: { moduleId: 'base.loop', children: [] },
      loop2: { moduleId: 'base.loop', children: [] },
    })
    const nodes = collectLoopNodes(page)
    expect(nodes.map((n) => n.id).sort()).toEqual(['loop1', 'loop2'])
  })

  it('returns empty map when the page has no loops', async () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['text'] },
      text: { moduleId: 'base.text', props: {} },
    })
    const db = createFakeDb(async () => ({ rows: [], rowCount: 0 }))
    const result = await prefetchLoopData(page, makeSite(), db)
    expect(result.size).toBe(0)
  })

  it('returns empty data for loops referencing an unregistered source', async () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['loop'] },
      loop: { moduleId: 'base.loop', props: { sourceId: 'unknown.source' } },
    })
    const db = createFakeDb(async () => ({ rows: [], rowCount: 0 }))
    const result = await prefetchLoopData(page, makeSite(), db)
    expect(result.size).toBe(1)
    expect(result.get('loop')?.items).toEqual([])
  })

  it('data.rows source returns empty when table has no rows', async () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['loop'] },
      loop: {
        moduleId: 'base.loop',
        props: {
          sourceId: 'data.rows',
          filters: { tableId: 'posts' },
          orderBy: 'publishedAt',
          direction: 'desc',
          limit: 5,
          offset: 0,
        },
      },
    })
    const db = createFakeDb(async (sql): Promise<DbResult> => {
      if (sql.includes('count(*)')) return { rows: [{ total: 0 }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
    const result = await prefetchLoopData(page, makeSite(), db)
    expect(result.get('loop')?.items).toEqual([])
    expect(result.get('loop')?.totalItems).toBe(0)
  })

  it('site.pages source loops actual site pages', async () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['loop'] },
      loop: {
        moduleId: 'base.loop',
        props: {
          sourceId: 'site.pages',
          filters: {},
          orderBy: 'definition',
          direction: 'asc',
          limit: 10,
          offset: 0,
        },
      },
    })
    const site = makeSite({
      pages: [
        { id: 'p1', slug: 'about', title: 'About', nodes: { r: { id: 'r', moduleId: 'base.body', props: {}, children: [], breakpointOverrides: {}, classIds: [] } }, rootNodeId: 'r' },
        { id: 'p2', slug: 'contact', title: 'Contact', nodes: { r: { id: 'r', moduleId: 'base.body', props: {}, children: [], breakpointOverrides: {}, classIds: [] } }, rootNodeId: 'r' },
      ],
    })
    const db = createFakeDb(async () => ({ rows: [], rowCount: 0 }))
    const result = await prefetchLoopData(page, site, db)
    const data = result.get('loop')
    expect(data?.totalItems).toBe(2)
    expect(data?.items.map((it) => it.fields.title)).toEqual(['About', 'Contact'])
  })
})
