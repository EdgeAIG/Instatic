import { describe, expect, it } from 'bun:test'
import type { DbResult } from '../../../server/db'
import { handleServerRequest } from '../../../server/router'
import type { PublishedPageSnapshot } from '../../../server/repositories/publish'
import { makePage, makeSite } from '../publisher/helpers'
import { createFakeDb } from './dbTestFake'

type QueryHandler = (sql: string, params: unknown[]) => DbResult | undefined

function makeTemplateRouteFakeDb(handlers: QueryHandler[]) {
  return createFakeDb(async (rawSql, params): Promise<DbResult> => {
    const sql = rawSql.replace(/\s+/g, ' ').trim().toLowerCase()
    for (const handler of handlers) {
      const result = handler(sql, params)
      if (result) return result
    }
    throw new Error(`Unhandled SQL: ${rawSql}`)
  })
}

function rowDate(value: string) {
  return new Date(value)
}

describe('CMS dynamic template routes', () => {
  it('renders a published data row through the highest priority page template', async () => {
    const page = makePage({
      root: { moduleId: 'base.body', props: {}, children: ['title'] },
      title: {
        moduleId: 'base.text',
        props: { text: 'Static title', tag: 'h1' },
        dynamicBindings: { text: { source: 'currentEntry', field: 'title' } },
      },
    })
    page.id = 'post-template'
    page.title = 'Post Template'
    page.slug = 'post-template'
    page.template = {
      enabled: true,
      context: 'entry',
      tableSlug: 'posts',
      priority: 100,
      conditions: [],
    }
    const snapshot: PublishedPageSnapshot = {
      cmsSnapshotVersion: 1,
      pageId: page.id,
      site: makeSite({ pages: [page] }),
    }

    const db = makeTemplateRouteFakeDb([
      (sql) => {
        if (sql.startsWith('select id, name, version, enabled, lifecycle_status')) {
          return { rows: [], rowCount: 0 }
        }
        return undefined
      },
      (sql, params) => {
        if (!sql.startsWith('select page_versions.snapshot_json')) return undefined

        if (sql.includes('where pages.slug = $1')) {
          expect(params).toEqual(['posts/dynamic-post'])
          return { rows: [], rowCount: 0 }
        }

        return { rows: [{ snapshot_json: snapshot }], rowCount: 1 }
      },
      (sql, params) => {
        if (!sql.startsWith('select data_row_versions.id')) return undefined
        expect(params).toEqual(['/posts', 'dynamic-post'])
        return {
          rows: [{
            id: 'version_1',
            row_id: 'row_1',
            table_id: 'posts',
            table_slug: 'posts',
            table_kind: 'postType',
            table_route_base: '/posts',
            version_number: 1,
            cells_json: {
              title: 'Dynamic Post',
              slug: 'dynamic-post',
              body: 'Body',
              featuredMedia: null,
              seoTitle: '',
              seoDescription: '',
            },
            slug: 'dynamic-post',
            published_at: rowDate('2026-05-01T10:00:00Z'),
            created_at: rowDate('2026-05-01T10:00:00Z'),
          }],
          rowCount: 1,
        }
      },
    ])

    const res = await handleServerRequest(new Request('http://localhost/posts/dynamic-post'), { db })
    const html = await res.text()

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(html).toContain('<h1>Dynamic Post</h1>')
    expect(html).not.toContain('Static title')
  })

  it('redirects an old published data row slug to the active published slug', async () => {
    const db = makeTemplateRouteFakeDb([
      (sql, params) => {
        if (!sql.startsWith('select page_versions.snapshot_json')) return undefined

        if (sql.includes('where pages.slug = $1')) {
          expect(params).toEqual(['posts/untitled'])
        }
        return { rows: [], rowCount: 0 }
      },
      (sql, params) => {
        if (!sql.startsWith('select data_row_versions.id')) return undefined
        expect(params).toEqual(['/posts', 'untitled'])
        return { rows: [], rowCount: 0 }
      },
      (sql, params) => {
        if (!sql.startsWith('select data_row_redirects.id')) return undefined
        expect(params).toEqual(['/posts', 'untitled'])
        return {
          rows: [{
            id: 'redirect_1',
            from_route_base: '/posts',
            from_slug: 'untitled',
            target_route_base: '/posts',
            target_slug: 'post',
          }],
          rowCount: 1,
        }
      },
    ])

    const res = await handleServerRequest(new Request('http://localhost/posts/untitled'), { db })

    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/posts/post')
  })
})
