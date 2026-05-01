import { describe, expect, it } from 'bun:test'
import type { DbClient, DbResult } from '../../../server/cms/db'
import { handleServerRequest } from '../../../server/router'
import type { PublishedPageSnapshot } from '../../../server/cms/publishRepository'
import { makePage, makeSite } from '../publisher/helpers'

type QueryHandler = (sql: string, params: unknown[]) => DbResult | undefined

class TemplateRouteFakeDb implements DbClient {
  constructor(private readonly handlers: QueryHandler[]) {}

  async query<Row = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<DbResult<Row>> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    for (const handler of this.handlers) {
      const result = handler(normalized, params)
      if (result) return result as DbResult<Row>
    }
    throw new Error(`Unhandled SQL: ${sql}`)
  }
}

function rowDate(value: string) {
  return new Date(value)
}

describe('CMS dynamic template routes', () => {
  it('renders a published content entry through the highest priority page template', async () => {
    const page = makePage({
      root: { moduleId: 'base.root', props: {}, children: ['title'] },
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
      collectionId: 'posts',
      priority: 100,
      conditions: [],
    }
    const snapshot: PublishedPageSnapshot = {
      cmsSnapshotVersion: 1,
      pageId: page.id,
      site: makeSite({ pages: [page] }),
    }

    const db = new TemplateRouteFakeDb([
      (sql, params) => {
        if (!sql.startsWith('select page_versions.snapshot_json')) return undefined

        if (sql.includes('where pages.slug = $1')) {
          expect(params).toEqual(['posts/dynamic-post'])
          return { rows: [], rowCount: 0 }
        }

        return { rows: [{ snapshot_json: snapshot }], rowCount: 1 }
      },
      (sql, params) => {
        if (!sql.startsWith('select content_entry_versions.id')) return undefined
        expect(params).toEqual(['/posts', 'dynamic-post'])
        return {
          rows: [{
            id: 'version_1',
            entry_id: 'entry_1',
            collection_id: 'posts',
            collection_slug: 'posts',
            collection_route_base: '/posts',
            version_number: 1,
            title: 'Dynamic Post',
            slug: 'dynamic-post',
            body_markdown: 'Body',
            featured_media_id: null,
            featured_media_path: null,
            seo_title: '',
            seo_description: '',
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
    expect(html).toContain('<h1 class="pb-text">Dynamic Post</h1>')
    expect(html).not.toContain('Static title')
  })

  it('redirects an old published content slug to the active published slug', async () => {
    const db = new TemplateRouteFakeDb([
      (sql, params) => {
        if (!sql.startsWith('select page_versions.snapshot_json')) return undefined

        if (sql.includes('where pages.slug = $1')) {
          expect(params).toEqual(['posts/untitled'])
        }
        return { rows: [], rowCount: 0 }
      },
      (sql, params) => {
        if (!sql.startsWith('select content_entry_versions.id')) return undefined
        expect(params).toEqual(['/posts', 'untitled'])
        return { rows: [], rowCount: 0 }
      },
      (sql, params) => {
        if (!sql.startsWith('select content_entry_redirects.id')) return undefined
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
