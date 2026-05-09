/**
 * Integration tests — step-up auth.
 *
 * Exercises POST /admin/api/cms/auth/step-up plus the three sensitive
 * endpoints it gates (DELETE users/:id, DELETE auth/sessions/:id,
 * POST auth/logout-all) against a real SQLite test DB.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { DbClient } from '../../../server/db'
import { handleCmsRequest } from '../../../server/handlers/cms'
import { findUserByEmail } from '../../../server/repositories/users'
import { listAuditEvents } from '../../../server/repositories/audit'
import { createSession } from '../../../server/auth/sessions'
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  hashSessionToken,
  sessionExpiry,
} from '../../../server/auth/tokens'
import { loginPerIpRateLimit, loginRateLimit } from '../../../server/auth/rateLimit'
import { STEP_UP_WINDOW_MS } from '../../../server/auth/authz'
import { createTestDb } from '../helpers/createTestDb'

const PASSWORD = 'long-enough-password'
const EMAIL = 'owner@example.com'
const IP = '203.0.113.10'

async function setup(db: DbClient): Promise<void> {
  const res = await handleCmsRequest(
    new Request('http://localhost/admin/api/cms/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteName: 'StepUp Test', email: EMAIL, password: PASSWORD }),
    }),
    db,
  )
  expect(res.status).toBe(201)
}

async function login(db: DbClient): Promise<string> {
  const res = await handleCmsRequest(
    new Request('http://localhost/admin/api/cms/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': IP,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    }),
    db,
  )
  expect(res.status).toBe(200)
  const setCookie = res.headers.get('set-cookie') ?? ''
  return setCookie.split(';')[0]
}

async function stepUp(db: DbClient, cookie: string, password: string): Promise<Response> {
  const req = new Request('http://localhost/admin/api/cms/auth/step-up', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  req.headers.set('cookie', cookie)
  return handleCmsRequest(req, db)
}

async function logoutAll(db: DbClient, cookie: string): Promise<Response> {
  const req = new Request('http://localhost/admin/api/cms/auth/logout-all', { method: 'POST' })
  req.headers.set('cookie', cookie)
  return handleCmsRequest(req, db)
}

function resetLimiters(): void {
  loginRateLimit.reset(`${IP}|${EMAIL}`)
  loginRateLimit.reset(`unknown|${EMAIL}`)
  loginPerIpRateLimit.reset(IP)
}

describe('Step-up auth', () => {
  let testDb: { db: DbClient; cleanup: () => Promise<void> }

  beforeEach(async () => {
    testDb = await createTestDb()
    resetLimiters()
    await setup(testDb.db)
  })

  afterEach(async () => {
    await testDb.cleanup()
    resetLimiters()
  })

  it('POST /step-up with the correct password opens a 15-minute window', async () => {
    const { db } = testDb
    const cookie = await login(db)
    const before = Date.now()

    const res = await stepUp(db, cookie, PASSWORD)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; stepUpExpiresAt: string }
    expect(body.ok).toBe(true)

    const expiresAt = Date.parse(body.stepUpExpiresAt)
    expect(expiresAt).toBeGreaterThanOrEqual(before + STEP_UP_WINDOW_MS - 1000)
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + STEP_UP_WINDOW_MS + 1000)
  })

  it('POST /step-up with the wrong password returns 401 and emits a login.failure audit', async () => {
    const { db } = testDb
    const cookie = await login(db)

    const res = await stepUp(db, cookie, 'completely-wrong-password')
    expect(res.status).toBe(401)

    const events = await listAuditEvents(db)
    const stepUpFailures = events.filter((event) =>
      event.action === 'login.failure' && event.metadata.reason === 'step_up'
    )
    expect(stepUpFailures).toHaveLength(1)
  })

  it('POST /step-up when the account is locked returns 423 with Retry-After', async () => {
    const { db } = testDb
    const cookie = await login(db)

    const user = await findUserByEmail(db, EMAIL)
    // Manually push the account into a locked state — the lockout policy
    // already has end-to-end coverage in authLockoutLogin.test.ts.
    const lockedUntil = new Date(Date.now() + 60_000).toISOString()
    await db`update users set locked_until = ${lockedUntil} where id = ${user!.id}`

    const res = await stepUp(db, cookie, PASSWORD)
    expect(res.status).toBe(423)
    expect(res.headers.get('retry-after')).not.toBeNull()
  })

  it('logout-all rejects with 401 step_up_required when no fresh window exists', async () => {
    const { db } = testDb
    const cookie = await login(db)

    const res = await logoutAll(db, cookie)
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('step_up_required')
  })

  it('logout-all succeeds after a successful step-up', async () => {
    const { db } = testDb
    const cookie = await login(db)
    const stepUpRes = await stepUp(db, cookie, PASSWORD)
    expect(stepUpRes.status).toBe(200)

    const res = await logoutAll(db, cookie)
    expect(res.status).toBe(200)
  })

  it('DELETE /auth/sessions/:id rejects without a fresh window', async () => {
    const { db } = testDb
    const cookie = await login(db)
    const user = await findUserByEmail(db, EMAIL)
    // Inject a sibling session to revoke.
    const otherToken = createSessionToken()
    const otherIdHash = await hashSessionToken(otherToken)
    await createSession(db, {
      idHash: otherIdHash,
      userId: user!.id,
      expiresAt: sessionExpiry(),
      ipAddress: '198.51.100.30',
      userAgent: null,
    })

    const req = new Request(`http://localhost/admin/api/cms/auth/sessions/${otherIdHash}`, {
      method: 'DELETE',
    })
    req.headers.set('cookie', cookie)
    const res = await handleCmsRequest(req, db)
    expect(res.status).toBe(401)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('step_up_required')

    // Sibling session is still alive — was NOT revoked.
    const remaining = await db`select revoked_at from sessions where id_hash = ${otherIdHash}`
    expect(remaining.rows[0]?.revoked_at).toBeNull()
  })

  it('DELETE /users/:id rejects without a fresh window', async () => {
    const { db } = testDb
    const ownerCookie = await login(db)
    // Create a target admin user via the API.
    const stepUpRes = await stepUp(db, ownerCookie, PASSWORD)
    expect(stepUpRes.status).toBe(200)
    const createReq = new Request('http://localhost/admin/api/cms/users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'target@example.com',
        displayName: 'Target',
        password: PASSWORD,
        roleId: 'admin',
      }),
    })
    createReq.headers.set('cookie', ownerCookie)
    const createRes = await handleCmsRequest(createReq, db)
    expect(createRes.status).toBe(201)
    const created = await createRes.json() as { user: { id: string } }

    // Roll the step-up window backwards so the next call is gated again.
    await db`
      update sessions
      set step_up_expires_at = ${new Date(Date.now() - 1000)}
    `

    const deleteReq = new Request(`http://localhost/admin/api/cms/users/${created.user.id}`, {
      method: 'DELETE',
    })
    deleteReq.headers.set('cookie', ownerCookie)
    const deleteRes = await handleCmsRequest(deleteReq, db)
    expect(deleteRes.status).toBe(401)
    const body = await deleteRes.json() as { error: string }
    expect(body.error).toBe('step_up_required')
  })
})
