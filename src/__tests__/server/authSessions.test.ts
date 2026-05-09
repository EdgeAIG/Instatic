/**
 * Integration tests — Account → Sessions endpoints.
 *
 * Exercises GET /admin/api/cms/auth/sessions, DELETE /sessions/:id, and
 * POST /auth/logout-all against a real SQLite test DB. Verifies the
 * cross-user revoke guard, the current-session pin, and the cookie-survives
 * behaviour of "logout all other devices".
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { DbClient } from '../../../server/db'
import { handleCmsRequest } from '../../../server/handlers/cms'
import { findUserByEmail } from '../../../server/repositories/users'
import { createSession } from '../../../server/auth/sessions'
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  hashSessionToken,
  sessionExpiry,
} from '../../../server/auth/tokens'
import { loginPerIpRateLimit, loginRateLimit } from '../../../server/auth/rateLimit'
import { createTestDb } from '../helpers/createTestDb'

const PASSWORD = 'long-enough-password'
const EMAIL = 'owner@example.com'

interface SessionListResponse {
  sessions: Array<{
    id: string
    deviceLabel: string
    ipAddress: string | null
    userAgent: string | null
    isCurrent: boolean
    createdAt: string
    lastSeenAt: string
    expiresAt: string
  }>
}

async function setup(db: DbClient): Promise<void> {
  const res = await handleCmsRequest(
    new Request('http://localhost/admin/api/cms/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteName: 'Sessions Test', email: EMAIL, password: PASSWORD }),
    }),
    db,
  )
  expect(res.status).toBe(201)
}

async function login(db: DbClient, ip = '203.0.113.10', ua = 'Mozilla/5.0 Chrome/120 Safari/537.36'): Promise<string> {
  const res = await handleCmsRequest(
    new Request('http://localhost/admin/api/cms/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': ip,
        'user-agent': ua,
      },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    }),
    db,
  )
  expect(res.status).toBe(200)
  const setCookie = res.headers.get('set-cookie') ?? ''
  const cookieValue = setCookie.split(';')[0]
  expect(cookieValue.startsWith(`${SESSION_COOKIE_NAME}=`)).toBe(true)
  return cookieValue
}

/**
 * Inject an extra session for the same user directly into the DB. Used to
 * simulate "this user has sessions on multiple devices" without spinning up
 * the login flow N times (which would burn rate-limit buckets).
 */
async function injectSession(
  db: DbClient,
  userId: string,
  opts: { ip?: string; userAgent?: string; deviceLabel?: string } = {},
): Promise<{ token: string; idHash: string }> {
  const token = createSessionToken()
  const idHash = await hashSessionToken(token)
  await createSession(db, {
    idHash,
    userId,
    expiresAt: sessionExpiry(),
    ipAddress: opts.ip ?? '198.51.100.20',
    userAgent: opts.userAgent ?? 'Mozilla/5.0 (iPhone) Mobile/15E148 Safari/604.1',
    deviceLabel: opts.deviceLabel,
  })
  return { token, idHash }
}

async function listSessions(db: DbClient, cookie: string): Promise<SessionListResponse> {
  const req = new Request('http://localhost/admin/api/cms/auth/sessions', { method: 'GET' })
  req.headers.set('cookie', cookie)
  const res = await handleCmsRequest(req, db)
  expect(res.status).toBe(200)
  return res.json() as Promise<SessionListResponse>
}

/**
 * Open a step-up window on the cookie's session — the sensitive endpoints
 * (DELETE /sessions/:id, POST /logout-all) require one. Tests that exercise
 * those endpoints call this once after login, then proceed.
 */
async function openStepUpWindow(db: DbClient, cookie: string): Promise<void> {
  const req = new Request('http://localhost/admin/api/cms/auth/step-up', {
    method: 'POST',
    body: JSON.stringify({ password: PASSWORD }),
    headers: { 'content-type': 'application/json' },
  })
  req.headers.set('cookie', cookie)
  const res = await handleCmsRequest(req, db)
  expect(res.status).toBe(200)
}

function resetLimiters(ip = '203.0.113.10'): void {
  loginRateLimit.reset(`${ip}|${EMAIL}`)
  loginRateLimit.reset(`unknown|${EMAIL}`)
  loginPerIpRateLimit.reset(ip)
}

describe('Account → Sessions endpoints', () => {
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

  it('GET /sessions returns the current user\'s live sessions with the current one flagged', async () => {
    const { db } = testDb
    const cookie = await login(db)
    const user = await findUserByEmail(db, EMAIL)
    expect(user).not.toBeNull()
    await injectSession(db, user!.id, { ip: '198.51.100.30', deviceLabel: 'Firefox on Linux' })

    const { sessions } = await listSessions(db, cookie)
    expect(sessions).toHaveLength(2)

    const current = sessions.filter((s) => s.isCurrent)
    expect(current).toHaveLength(1)
    expect(current[0]?.deviceLabel).toContain('Chrome')

    const others = sessions.filter((s) => !s.isCurrent)
    expect(others[0]?.deviceLabel).toBe('Firefox on Linux')
    expect(others[0]?.ipAddress).toBe('198.51.100.30')
  })

  it('GET /sessions hides revoked sessions', async () => {
    const { db } = testDb
    const cookie = await login(db)
    const user = await findUserByEmail(db, EMAIL)

    const ghost = await injectSession(db, user!.id, { deviceLabel: 'Ghost device' })
    // Manually revoke the injected session and verify it disappears.
    await db`update sessions set revoked_at = current_timestamp where id_hash = ${ghost.idHash}`

    const { sessions } = await listSessions(db, cookie)
    expect(sessions.find((s) => s.deviceLabel === 'Ghost device')).toBeUndefined()
  })

  it('DELETE /sessions/:id revokes another device but rejects the current one', async () => {
    const { db } = testDb
    const cookie = await login(db)
    await openStepUpWindow(db, cookie)
    const user = await findUserByEmail(db, EMAIL)
    const other = await injectSession(db, user!.id, { deviceLabel: 'Other device' })

    // Revoking the current session is rejected with 400 — clients must use /logout.
    const currentTokenHash = await hashSessionToken(cookie.split('=')[1] ?? '')
    const selfReq = new Request(`http://localhost/admin/api/cms/auth/sessions/${currentTokenHash}`, { method: 'DELETE' })
    selfReq.headers.set('cookie', cookie)
    const selfRes = await handleCmsRequest(selfReq, db)
    expect(selfRes.status).toBe(400)

    // Revoking the other session works.
    const otherReq = new Request(`http://localhost/admin/api/cms/auth/sessions/${other.idHash}`, { method: 'DELETE' })
    otherReq.headers.set('cookie', cookie)
    const otherRes = await handleCmsRequest(otherReq, db)
    expect(otherRes.status).toBe(200)

    // List should now only show the current session.
    const { sessions } = await listSessions(db, cookie)
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.isCurrent).toBe(true)
  })

  it('DELETE /sessions/:id rejects a session belonging to another user (cross-user guard)', async () => {
    const { db } = testDb
    const ownerCookie = await login(db)
    await openStepUpWindow(db, ownerCookie)
    const owner = await findUserByEmail(db, EMAIL)

    // Create a second user and a session for them.
    const otherUser = await db<{ id: string }>`
      insert into users (id, email, email_normalized, display_name, password_hash, status, role_id)
      values ('user_other', 'other@example.com', 'other@example.com', 'Other', 'x', 'active', 'admin')
      returning id
    `
    const otherSession = await injectSession(db, otherUser.rows[0]!.id, { deviceLabel: 'Other user device' })

    // Owner tries to revoke other user's session — must NOT succeed.
    const req = new Request(`http://localhost/admin/api/cms/auth/sessions/${otherSession.idHash}`, { method: 'DELETE' })
    req.headers.set('cookie', ownerCookie)
    const res = await handleCmsRequest(req, db)
    expect(res.status).toBe(404)

    // Other user's session row remains live.
    const remaining = await db`select revoked_at from sessions where id_hash = ${otherSession.idHash}`
    expect(remaining.rows[0]?.revoked_at).toBeNull()

    // Sanity check: owner can still see own session.
    const { sessions } = await listSessions(db, ownerCookie)
    expect(sessions.every((s) => s.deviceLabel !== 'Other user device')).toBe(true)
    // Suppress unused-var lint: `owner` is captured to keep the test readable.
    expect(owner).not.toBeNull()
  })

  it('POST /logout-all revokes other sessions but keeps the current one alive', async () => {
    const { db } = testDb
    const cookie = await login(db)
    await openStepUpWindow(db, cookie)
    const user = await findUserByEmail(db, EMAIL)
    await injectSession(db, user!.id, { deviceLabel: 'Phone' })
    await injectSession(db, user!.id, { deviceLabel: 'Tablet' })

    const before = await listSessions(db, cookie)
    expect(before.sessions).toHaveLength(3)

    const req = new Request('http://localhost/admin/api/cms/auth/logout-all', { method: 'POST' })
    req.headers.set('cookie', cookie)
    const res = await handleCmsRequest(req, db)
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean; revokedCount: number }
    expect(body.ok).toBe(true)
    expect(body.revokedCount).toBe(2)

    const after = await listSessions(db, cookie)
    expect(after.sessions).toHaveLength(1)
    expect(after.sessions[0]?.isCurrent).toBe(true)
  })

  it('GET /sessions requires authentication', async () => {
    const { db } = testDb
    const res = await handleCmsRequest(
      new Request('http://localhost/admin/api/cms/auth/sessions', { method: 'GET' }),
      db,
    )
    expect(res.status).toBe(401)
  })

  it('records device_label on createSession from the User-Agent', async () => {
    const { db } = testDb
    const cookie = await login(db, '203.0.113.10', 'Mozilla/5.0 (Macintosh) AppleWebKit Version/17 Safari/605')

    const { sessions } = await listSessions(db, cookie)
    const current = sessions.find((s) => s.isCurrent)
    expect(current?.deviceLabel).toBe('Safari on macOS')
  })
})
