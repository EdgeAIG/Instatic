import { afterEach, describe, expect, it } from 'bun:test'
import { handleCmsRequest } from '../../../server/handlers/cms'
import type { DbClient } from '../../../server/db'
import { createTestDb, type TestDb } from '../helpers/createTestDb'

const ownedPassword = 'long-enough-password'

async function body(res: Response): Promise<Record<string, unknown>> {
  return res.json() as Promise<Record<string, unknown>>
}

async function request(
  db: DbClient,
  path: string,
  options: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  const req = new Request(`http://localhost${path}`, {
    ...options,
    headers,
  })
  if (options.cookie) req.headers.set('cookie', options.cookie)
  return handleCmsRequest(req, db)
}

async function setupOwner(db: DbClient): Promise<string> {
  const setup = await request(db, '/admin/api/cms/setup', {
    method: 'POST',
    body: JSON.stringify({
      siteName: 'Ownership Test',
      email: 'owner@example.com',
      password: ownedPassword,
    }),
  })
  expect(setup.status).toBe(201)
  return stepUp(db, await login(db, 'owner@example.com'))
}

async function login(db: DbClient, email: string): Promise<string> {
  const res = await request(db, '/admin/api/cms/login', {
    method: 'POST',
    body: JSON.stringify({ email, password: ownedPassword }),
  })
  expect(res.status).toBe(200)
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  expect(cookie).toContain('pb_admin_session=')
  return cookie
}

async function stepUp(db: DbClient, cookie: string): Promise<string> {
  const res = await request(db, '/admin/api/cms/auth/step-up', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ password: ownedPassword }),
  })
  expect(res.status).toBe(200)
  const steppedCookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  expect(steppedCookie).toContain('pb_admin_session=')
  return steppedCookie
}

async function createUser(
  db: DbClient,
  ownerCookie: string,
  input: { email: string; displayName: string; roleId: string },
): Promise<string> {
  const res = await request(db, '/admin/api/cms/users', {
    method: 'POST',
    cookie: ownerCookie,
    body: JSON.stringify({ ...input, password: ownedPassword }),
  })
  expect(res.status).toBe(201)
  const payload = await body(res) as { user: { id: string } }
  return payload.user.id
}

/**
 * Create a custom role with the given capabilities and return its id. Used
 * by the ownership tests, which need granular capability sets (own-edit vs
 * any-edit, etc.) that no built-in role exposes — built-in roles are now
 * limited to owner / admin / client / member.
 */
async function createCustomRole(
  db: DbClient,
  ownerCookie: string,
  input: { slug: string; name: string; capabilities: string[] },
): Promise<string> {
  const res = await request(db, '/admin/api/cms/roles', {
    method: 'POST',
    cookie: ownerCookie,
    body: JSON.stringify({
      name: input.name,
      slug: input.slug,
      description: '',
      capabilities: input.capabilities,
    }),
  })
  expect(res.status).toBe(201)
  const payload = await body(res) as { role: { id: string } }
  return payload.role.id
}

const OWN_EDIT_CAPS = [
  'site.read',
  'content.create',
  'content.edit.own',
  'content.publish.own',
]

const ANY_EDIT_CAPS = [
  'site.read',
  'content.create',
  'content.edit.any',
  'content.publish.any',
  'content.manage',
  'media.manage',
]

async function createRow(
  db: DbClient,
  cookie: string,
  title: string,
): Promise<string> {
  const res = await request(db, '/admin/api/cms/data/tables/posts/rows', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ cells: { title } }),
  })
  expect(res.status).toBe(201)
  const payload = await body(res) as { row: { id: string } }
  return payload.row.id
}

describe('CMS data ownership authorization', () => {
  const cleanupFns: Array<() => Promise<void>> = []

  afterEach(async () => {
    while (cleanupFns.length) await cleanupFns.pop()?.()
  })

  async function makeDb(): Promise<TestDb> {
    const testDb = await createTestDb()
    cleanupFns.push(testDb.cleanup)
    return testDb
  }

  it('filters own-edit users to their rows and lets any-edit users see all rows', async () => {
    const { db } = await makeDb()
    const ownerCookie = await setupOwner(db)
    const ownEditRoleId = await createCustomRole(db, ownerCookie, {
      slug: 'own-editor', name: 'Own Editor', capabilities: OWN_EDIT_CAPS,
    })
    const anyEditRoleId = await createCustomRole(db, ownerCookie, {
      slug: 'any-editor', name: 'Any Editor', capabilities: ANY_EDIT_CAPS,
    })
    await createUser(db, ownerCookie, { email: 'editor-one@example.com', displayName: 'Editor One', roleId: ownEditRoleId })
    await createUser(db, ownerCookie, { email: 'editor-two@example.com', displayName: 'Editor Two', roleId: ownEditRoleId })
    await createUser(db, ownerCookie, { email: 'manager@example.com', displayName: 'Manager', roleId: anyEditRoleId })
    const editorOneCookie = await login(db, 'editor-one@example.com')
    const editorTwoCookie = await login(db, 'editor-two@example.com')
    const managerCookie = await login(db, 'manager@example.com')

    await createRow(db, editorOneCookie, 'Editor One Draft')
    await createRow(db, editorTwoCookie, 'Editor Two Draft')

    const ownList = await request(db, '/admin/api/cms/data/tables/posts/rows', {
      method: 'GET',
      cookie: editorOneCookie,
    })
    expect(ownList.status).toBe(200)
    const ownRows = (await body(ownList)).rows as Array<{ cells: { title: string } }>
    expect(ownRows.map((r) => r.cells.title)).toEqual(['Editor One Draft'])

    const allList = await request(db, '/admin/api/cms/data/tables/posts/rows', {
      method: 'GET',
      cookie: managerCookie,
    })
    expect(allList.status).toBe(200)
    const allRows = (await body(allList)).rows as Array<{ cells: { title: string } }>
    expect(allRows.map((r) => r.cells.title).sort()).toEqual([
      'Editor One Draft',
      'Editor Two Draft',
    ])
  })

  it('blocks own-edit users from mutating rows owned by someone else', async () => {
    const { db } = await makeDb()
    const ownerCookie = await setupOwner(db)
    const ownEditRoleId = await createCustomRole(db, ownerCookie, {
      slug: 'own-editor', name: 'Own Editor', capabilities: OWN_EDIT_CAPS,
    })
    const editorTwoId = await createUser(db, ownerCookie, {
      email: 'second-editor@example.com',
      displayName: 'Second Editor',
      roleId: ownEditRoleId,
    })
    await createUser(db, ownerCookie, { email: 'first-editor@example.com', displayName: 'First Editor', roleId: ownEditRoleId })
    const firstEditorCookie = await login(db, 'first-editor@example.com')
    const secondEditorCookie = await login(db, 'second-editor@example.com')
    const secondRowId = await createRow(db, secondEditorCookie, 'Second Editor Draft')

    const readOther = await request(db, `/admin/api/cms/data/rows/${secondRowId}`, {
      method: 'GET',
      cookie: firstEditorCookie,
    })
    expect(readOther.status).toBe(403)

    const saveOther = await request(db, `/admin/api/cms/data/rows/${secondRowId}`, {
      method: 'PATCH',
      cookie: firstEditorCookie,
      body: JSON.stringify({
        cells: {
          title: 'Hijacked',
          slug: 'hijacked',
          body: '',
          featuredMedia: null,
          seoTitle: '',
          seoDescription: '',
        },
      }),
    })
    expect(saveOther.status).toBe(403)

    const reassignOther = await request(db, `/admin/api/cms/data/rows/${secondRowId}/author`, {
      method: 'PATCH',
      cookie: firstEditorCookie,
      body: JSON.stringify({ authorUserId: editorTwoId }),
    })
    expect(reassignOther.status).toBe(403)
  })

  it('lets own-publish users publish their rows and any-edit users reassign authors', async () => {
    const { db } = await makeDb()
    const ownerCookie = await setupOwner(db)
    const ownEditRoleId = await createCustomRole(db, ownerCookie, {
      slug: 'own-editor', name: 'Own Editor', capabilities: OWN_EDIT_CAPS,
    })
    const anyEditRoleId = await createCustomRole(db, ownerCookie, {
      slug: 'any-editor', name: 'Any Editor', capabilities: ANY_EDIT_CAPS,
    })
    const editorOneId = await createUser(db, ownerCookie, {
      email: 'publish-editor@example.com',
      displayName: 'Publish Editor',
      roleId: ownEditRoleId,
    })
    const managerId = await createUser(db, ownerCookie, {
      email: 'assign-manager@example.com',
      displayName: 'Assign Manager',
      roleId: anyEditRoleId,
    })
    const editorCookie = await login(db, 'publish-editor@example.com')
    const managerCookie = await login(db, 'assign-manager@example.com')
    const rowId = await createRow(db, editorCookie, 'Publishable Draft')

    const publish = await request(db, `/admin/api/cms/data/rows/${rowId}/publish`, {
      method: 'POST',
      cookie: editorCookie,
    })
    expect(publish.status).toBe(200)
    expect(await body(publish)).toMatchObject({ row: { status: 'published', authorUserId: editorOneId } })

    const reassign = await request(db, `/admin/api/cms/data/rows/${rowId}/author`, {
      method: 'PATCH',
      cookie: managerCookie,
      body: JSON.stringify({ authorUserId: managerId }),
    })
    expect(reassign.status).toBe(200)
    expect(await body(reassign)).toMatchObject({ row: { authorUserId: managerId } })
  })
})
