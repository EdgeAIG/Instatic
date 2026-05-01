import { describe, expect, it } from 'bun:test'
import { SESSION_COOKIE_NAME, hashSessionToken } from '../../../server/cms/auth'
import type { DbClient, DbResult } from '../../../server/cms/db'
import { handleCmsRequest } from '../../../server/cms/handlers'

class PluginResourcesFakeDb implements DbClient {
  admins: Record<string, unknown>[] = [
    {
      id: 'admin_1',
      email: 'owner@example.com',
      password_hash: 'hash',
      created_at: new Date('2026-01-01').toISOString(),
    },
  ]
  sessions: Record<string, unknown>[] = []
  plugins: Record<string, unknown>[] = []
  records: Record<string, unknown>[] = []

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
  ): Promise<DbResult<Row>> {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase()
    if (normalized.startsWith('select admin_users.id, admin_users.email')) {
      const session = this.sessions.find((s) => String(s.id_hash) === String(params[0]))
      if (!session) return { rows: [], rowCount: 0 }
      const admin = this.admins.find((a) => a.id === session.admin_user_id)
      return { rows: admin ? [admin as Row] : [], rowCount: admin ? 1 : 0 }
    }
    if (normalized.startsWith('select id, name, version, enabled') && normalized.includes('where id = $1')) {
      const plugin = this.plugins.find((candidate) => candidate.id === params[0])
      return { rows: plugin ? [plugin as Row] : [], rowCount: plugin ? 1 : 0 }
    }
    if (normalized.startsWith('select id, name, version, enabled')) {
      return { rows: [...this.plugins] as Row[], rowCount: this.plugins.length }
    }
    if (normalized.startsWith('insert into installed_plugins')) {
      const now = new Date('2026-05-01T10:00:00.000Z').toISOString()
      const row = {
        id: params[0],
        name: params[1],
        version: params[2],
        enabled: true,
        lifecycle_status: 'installed',
        last_error: null,
        manifest_json: params[3],
        granted_permissions_json: params[4] ?? [],
        installed_at: now,
        updated_at: now,
      }
      this.plugins.push(row)
      return { rows: [row as Row], rowCount: 1 }
    }
    if (normalized.startsWith('update installed_plugins set lifecycle_status')) {
      const row = this.plugins.find((plugin) => plugin.id === params[0])
      if (!row) return { rows: [], rowCount: 0 }
      row.lifecycle_status = params[1]
      row.last_error = params[2] ?? null
      row.updated_at = new Date('2026-05-01T10:06:00.000Z').toISOString()
      return { rows: [row as Row], rowCount: 1 }
    }
    if (normalized.startsWith('select id, plugin_id, resource_id, data_json')) {
      const rows = this.records.filter((record) =>
        record.plugin_id === params[0] && record.resource_id === params[1]
      )
      return { rows: rows as Row[], rowCount: rows.length }
    }
    if (normalized.startsWith('insert into plugin_records')) {
      const now = new Date('2026-05-01T10:10:00.000Z').toISOString()
      const row = {
        id: params[0],
        plugin_id: params[1],
        resource_id: params[2],
        data_json: params[3],
        created_at: now,
        updated_at: now,
      }
      this.records.push(row)
      return { rows: [row as Row], rowCount: 1 }
    }
    if (normalized.startsWith('update plugin_records set data_json')) {
      const row = this.records.find((record) =>
        record.id === params[0] &&
        record.plugin_id === params[1] &&
        record.resource_id === params[2]
      )
      if (!row) return { rows: [], rowCount: 0 }
      row.data_json = params[3]
      row.updated_at = new Date('2026-05-01T10:15:00.000Z').toISOString()
      return { rows: [row as Row], rowCount: 1 }
    }
    if (normalized.startsWith('delete from plugin_records')) {
      const index = this.records.findIndex((record) =>
        record.id === params[0] &&
        record.plugin_id === params[1] &&
        record.resource_id === params[2]
      )
      if (index === -1) return { rows: [], rowCount: 0 }
      this.records.splice(index, 1)
      return { rows: [], rowCount: 1 }
    }
    throw new Error(`Unhandled SQL: ${sql}`)
  }
}

async function createCookie(db: PluginResourcesFakeDb): Promise<string> {
  const token = 'valid-session-token'
  db.sessions.push({
    id_hash: await hashSessionToken(token),
    admin_user_id: 'admin_1',
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

const booksPlugin = {
  id: 'acme.books',
  name: 'Books',
  version: '1.0.0',
  apiVersion: 1,
  resources: [
    {
      id: 'books',
      title: 'Books',
      singularLabel: 'Book',
      pluralLabel: 'Books',
      fields: [
        { id: 'title', label: 'Title', type: 'text', required: true },
        { id: 'author', label: 'Author', type: 'text' },
      ],
    },
  ],
  adminPages: [
    {
      id: 'books',
      title: 'Books',
      navLabel: 'Books',
      content: { kind: 'resource', heading: 'Books', resource: 'books' },
    },
  ],
}

describe('CMS plugin resource handlers', () => {
  it('requires an admin session for plugin record access', async () => {
    const res = await handleCmsRequest(
      cmsRequest('http://localhost/api/cms/plugins/acme.books/resources/books/records'),
      new PluginResourcesFakeDb(),
    )

    expect(res.status).toBe(401)
  })

  it('creates, lists, updates, and deletes backend records for an enabled plugin resource', async () => {
    const db = new PluginResourcesFakeDb()
    const cookie = await createCookie(db)

    const install = await handleCmsRequest(cmsRequest('http://localhost/api/cms/plugins', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(booksPlugin),
    }), db)
    expect(install.status).toBe(201)

    const create = await handleCmsRequest(cmsRequest(
      'http://localhost/api/cms/plugins/acme.books/resources/books/records',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { title: 'Invisible Cities', author: 'Italo Calvino', ignored: 'drop' } }),
      },
    ), db)
    expect(create.status).toBe(201)
    const createdBody = await create.json() as { record: { id: string; data: Record<string, unknown> } }
    expect(createdBody.record.data).toEqual({ title: 'Invisible Cities', author: 'Italo Calvino' })

    const list = await handleCmsRequest(cmsRequest(
      'http://localhost/api/cms/plugins/acme.books/resources/books/records',
      { headers: { cookie } },
    ), db)
    expect(list.status).toBe(200)
    expect(await list.json()).toMatchObject({
      resource: { id: 'books', title: 'Books' },
      records: [{ data: { title: 'Invisible Cities' } }],
    })

    const update = await handleCmsRequest(cmsRequest(
      `http://localhost/api/cms/plugins/acme.books/resources/books/records/${createdBody.record.id}`,
      {
        method: 'PATCH',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { title: 'The Left Hand of Darkness' } }),
      },
    ), db)
    expect(update.status).toBe(200)
    expect(await update.json()).toMatchObject({
      record: { data: { title: 'The Left Hand of Darkness' } },
    })

    const remove = await handleCmsRequest(cmsRequest(
      `http://localhost/api/cms/plugins/acme.books/resources/books/records/${createdBody.record.id}`,
      { method: 'DELETE', headers: { cookie } },
    ), db)
    expect(remove.status).toBe(200)
    expect(await remove.json()).toEqual({ ok: true })
    expect(db.records).toHaveLength(0)
  })

  it('rejects records that do not match the plugin resource schema', async () => {
    const db = new PluginResourcesFakeDb()
    const cookie = await createCookie(db)

    await handleCmsRequest(cmsRequest('http://localhost/api/cms/plugins', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(booksPlugin),
    }), db)

    const res = await handleCmsRequest(cmsRequest(
      'http://localhost/api/cms/plugins/acme.books/resources/books/records',
      {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ data: { author: 'Missing title' } }),
      },
    ), db)

    expect(res.status).toBe(400)
    expect(db.records).toHaveLength(0)
  })
})
