import { describe, expect, it } from 'bun:test'
import type { SiteDocument } from '@core/page-tree/schemas'
import { SESSION_COOKIE_NAME, hashSessionToken } from '../../../server/auth/tokens'
import type { DbClient, DbResult } from '../../../server/db'
import { handleCmsRequest } from '../../../server/handlers/cms'

function makeFakeDb() {
  let siteRow: Record<string, unknown> | null = null
  const admins: Record<string, unknown>[] = [
    {
      id: 'admin_1',
      email: 'owner@example.com',
      password_hash: 'hash',
      created_at: new Date('2026-01-01').toISOString(),
    },
  ]
  const sessions: Record<string, unknown>[] = []
  let pages: Record<string, unknown>[] = []

  const handle = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>> => {
    // Reconstruct a parameterized SQL string for pattern matching.
    const sql = strings.reduce<string>((acc, str, i) => (i === 0 ? str : `${acc}$${i}${str}`), '')
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()

    if (normalized.includes('from sessions') && normalized.includes('join users')) {
      const session = sessions.find((s) => String(s.id_hash) === String(values[0]))
      if (!session) return { rows: [], rowCount: 0 }
      const admin = admins.find((a) => a.id === session.user_id)
      return {
        rows: admin ? [{
          ...admin,
          email_normalized: admin.email,
          display_name: 'Owner',
          status: 'active',
          role_id: 'owner',
          last_login_at: null,
          updated_at: admin.created_at,
          deleted_at: null,
          role_slug: 'owner',
          role_name: 'Owner',
          role_description: '',
          role_is_system: true,
          role_capabilities_json: ['site.read', 'site.structure.edit','site.content.edit','site.style.edit', 'pages.edit'],
        } as Row] : [],
        rowCount: admin ? 1 : 0,
      }
    }
    if (normalized.includes('update sessions') && normalized.includes('last_seen_at')) {
      return { rows: [], rowCount: 1 }
    }
    // saveDraftSite insert into site (via transaction) — values[0]=name, values[1]=siteShell
    if (normalized.includes('insert into site')) {
      siteRow = {
        id: 'default',
        name: values[0],
        settings_json: values[1],
        created_at: new Date('2026-01-01').toISOString(),
        updated_at: new Date('2026-01-02').toISOString(),
      }
      return { rows: [], rowCount: 1 }
    }
    // saveDraftSite insert into pages (via transaction) — values[0..4]=id, title, slug, page, index
    if (normalized.includes('insert into pages')) {
      const page = {
        id: values[0],
        title: values[1],
        slug: values[2],
        draft_document_json: values[3],
        sort_order: values[4],
      }
      const index = pages.findIndex((p) => p.id === page.id)
      if (index >= 0) pages[index] = page
      else pages.push(page)
      return { rows: [], rowCount: 1 }
    }
    // saveDraftSite select existing page IDs for stale-page diffing
    if (normalized === 'select id from pages') {
      return { rows: pages.map((p) => ({ id: p.id })) as Row[], rowCount: pages.length }
    }
    // saveDraftSite delete a single stale page — values[0]=pageId
    if (normalized.includes('delete from pages where id =')) {
      pages = pages.filter((p) => String(p.id) !== String(values[0]))
      return { rows: [], rowCount: 1 }
    }
    // loadDraftSite: select site — no interpolated values
    if (normalized.includes('select id, name, settings_json')) {
      return { rows: siteRow ? [siteRow as Row] : [], rowCount: siteRow ? 1 : 0 }
    }
    // loadDraftSite: select pages — no interpolated values
    if (normalized.includes('select id, title, slug, draft_document_json')) {
      return {
        rows: [...pages].sort((a, b) => Number(a.sort_order) - Number(b.sort_order)) as Row[],
        rowCount: pages.length,
      }
    }
    throw new Error(`Unhandled SQL: ${sql}`)
  }

  handle.transaction = async <T>(cb: (tx: DbClient) => Promise<T>): Promise<T> =>
    cb(handle as unknown as DbClient)

  // Test fake: `unsafe()` forwards directly to the SQL handler. The same
  // pattern-matching logic as the tagged-template entry path.
  handle.unsafe = async <Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<DbResult<Row>> => {
    const fakeStrings = [sql] as unknown as TemplateStringsArray
    return handle<Row>(fakeStrings, ...(params ?? []))
  }

  return Object.assign(handle as DbClient, {
    get site() { return siteRow },
    admins,
    sessions,
    get pages() { return pages },
  })
}

function site(): SiteDocument {
  return {
    id: 'project_1',
    name: 'CMS Site',
    pages: [
      {
        id: 'page_home',
        title: 'Home',
        slug: 'index',
        rootNodeId: 'root',
        nodes: {
          root: {
            id: 'root',
            moduleId: 'base.body',
            props: {},
            breakpointOverrides: {},
            children: [],
          },
        },
      },
    ],
    files: [],
    visualComponents: [],
    breakpoints: [
      { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
    ],
    settings: {
      colorTokens: {},
      shortcuts: {},
    },
    classes: {},
    createdAt: 1000,
    updatedAt: 2000,
  }
}

async function createCookie(db: ReturnType<typeof makeFakeDb>): Promise<string> {
  const token = 'valid-session-token'
  db.sessions.push({
    id_hash: await hashSessionToken(token),
    user_id: 'admin_1',
    expires_at: new Date('2030-01-01').toISOString(),
  })
  return `${SESSION_COOKIE_NAME}=${token}`
}

function cmsRequest(
  url: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Request {
  const headers = new Map(
    Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  )
  return {
    url,
    method: init.method ?? 'GET',
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null
      },
    },
    async json() {
      return init.body ? JSON.parse(init.body) : {}
    },
  } as Request
}

describe('cms site handlers', () => {
  it('requires an admin session for draft site reads', async () => {
    const db = makeFakeDb()
    const res = await handleCmsRequest(cmsRequest('http://localhost/admin/api/cms/site'), db)

    expect(res.status).toBe(401)
  })

  it('saves and loads the draft site for an authenticated admin', async () => {
    const db = makeFakeDb()
    const cookie = await createCookie(db)

    const save = await handleCmsRequest(cmsRequest('http://localhost/admin/api/cms/site', {
      method: 'PUT',
      body: JSON.stringify({ site: site() }),
      headers: {
        'content-type': 'application/json',
        cookie,
      },
    }), db)
    expect(save.status).toBe(200)

    const load = await handleCmsRequest(cmsRequest('http://localhost/admin/api/cms/site', {
      headers: { cookie },
    }), db)
    expect(load.status).toBe(200)
    expect(await load.json()).toMatchObject({
      site: {
        id: 'project_1',
        name: 'CMS Site',
        pages: [{ id: 'page_home', slug: 'index' }],
      },
    })
  })
})
