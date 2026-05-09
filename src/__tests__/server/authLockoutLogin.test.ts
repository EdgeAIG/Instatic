/**
 * Integration tests — login handler × lockout policy.
 *
 * Exercises the full flow against a real SQLite test DB: rate limits, per-account
 * lockout, audit-event emission, login_attempts row creation, and reset on a
 * subsequent successful login.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import type { DbClient } from '../../../server/db'
import { handleCmsRequest } from '../../../server/handlers/cms'
import { findUserByEmail } from '../../../server/repositories/users'
import { listAuditEvents } from '../../../server/repositories/audit'
import { listLoginAttemptsForUser, listLoginAttemptsForIp } from '../../../server/repositories/loginAttempts'
import { LOCKOUT_THRESHOLD, LOCKOUT_INITIAL_MS } from '../../../server/auth/lockout'
import { loginPerIpRateLimit, loginRateLimit } from '../../../server/auth/rateLimit'
import { createTestDb } from '../helpers/createTestDb'

const PASSWORD = 'long-enough-password'
const EMAIL = 'owner@example.com'

async function setup(db: DbClient): Promise<void> {
  const res = await handleCmsRequest(
    new Request('http://localhost/admin/api/cms/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteName: 'Lockout Test', email: EMAIL, password: PASSWORD }),
    }),
    db,
  )
  expect(res.status).toBe(201)
}

interface LoginOptions {
  email?: string
  password?: string
  ip?: string | null
}

async function login(db: DbClient, opts: LoginOptions = {}): Promise<Response> {
  const email = opts.email ?? EMAIL
  const password = opts.password ?? PASSWORD
  const ip = opts.ip ?? '203.0.113.10'
  const headers = new Headers({ 'content-type': 'application/json' })
  if (ip) headers.set('x-forwarded-for', ip)
  return handleCmsRequest(
    new Request('http://localhost/admin/api/cms/login', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password }),
    }),
    db,
  )
}

function resetLimitersFor(email: string, ip: string): void {
  loginRateLimit.reset(`${ip}|${email}`)
  loginRateLimit.reset(`unknown|${email}`)
  loginPerIpRateLimit.reset(ip)
}

describe('login handler — lockout integration', () => {
  let testDb: { db: DbClient; cleanup: () => Promise<void> }

  beforeEach(async () => {
    testDb = await createTestDb()
    await setup(testDb.db)
    // Each test uses a unique IP to avoid the in-process rate limiter
    // accumulating across tests in the same file. resetLimitersFor() clears
    // the buckets the test is about to use.
    resetLimitersFor(EMAIL, '203.0.113.10')
    resetLimitersFor(EMAIL, '203.0.113.20')
  })

  afterEach(async () => {
    await testDb.cleanup()
    resetLimitersFor(EMAIL, '203.0.113.10')
    resetLimitersFor(EMAIL, '203.0.113.20')
  })

  it('locks the account after THRESHOLD consecutive failed attempts and emits login.locked', async () => {
    const { db } = testDb

    // 4 failures — counter rises but no lock yet.
    for (let i = 0; i < LOCKOUT_THRESHOLD - 1; i++) {
      // Reset the per-(ip, email) bucket between attempts so we hit the
      // lockout path instead of the rate-limit path. The lockout policy is a
      // separate defense layer.
      resetLimitersFor(EMAIL, '203.0.113.10')
      const res = await login(db, { password: 'wrong-password' })
      expect(res.status).toBe(401)
    }
    {
      const user = await findUserByEmail(db, EMAIL)
      expect(user?.failedLoginCount).toBe(LOCKOUT_THRESHOLD - 1)
      expect(user?.lockedUntil).toBeNull()
    }

    // The Nth failure triggers the lock — server returns 423 with Retry-After.
    resetLimitersFor(EMAIL, '203.0.113.10')
    const triggering = await login(db, { password: 'wrong-password' })
    expect(triggering.status).toBe(423)
    const retryAfter = Number(triggering.headers.get('retry-after'))
    expect(retryAfter).toBeGreaterThan(0)
    // First-cycle lock is 15 min — Retry-After should be in that ballpark
    // (allow generous slack for slow CI clocks).
    expect(retryAfter).toBeLessThanOrEqual(LOCKOUT_INITIAL_MS / 1000)

    const user = await findUserByEmail(db, EMAIL)
    expect(user?.failedLoginCount).toBe(LOCKOUT_THRESHOLD)
    expect(user?.lockedUntil).not.toBeNull()

    const events = await listAuditEvents(db)
    const actions = events.map((e) => e.action)
    expect(actions).toContain('login.locked')
    expect(actions.filter((a) => a === 'login.failure').length).toBe(LOCKOUT_THRESHOLD)
  })

  it('records every attempt to login_attempts with the correct result', async () => {
    const { db } = testDb

    resetLimitersFor(EMAIL, '203.0.113.10')
    await login(db, { password: 'wrong-password' })
    resetLimitersFor(EMAIL, '203.0.113.10')
    await login(db, { email: 'no-such@example.com', password: 'irrelevant' })
    resetLimitersFor(EMAIL, '203.0.113.10')
    await login(db) // success

    const user = await findUserByEmail(db, EMAIL)
    expect(user).not.toBeNull()
    const userAttempts = await listLoginAttemptsForUser(db, user!.id)
    const results = userAttempts.map((a) => a.result).sort()
    // bad_password + success — 'no_user' has user_id=null and won't appear here.
    expect(results).toEqual(['bad_password', 'success'])

    const ipAttempts = await listLoginAttemptsForIp(db, '203.0.113.10')
    const ipResults = ipAttempts.map((a) => a.result).sort()
    expect(ipResults).toEqual(['bad_password', 'no_user', 'success'])
  })

  it('continues to reject login while inside the lockout window', async () => {
    const { db } = testDb

    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      resetLimitersFor(EMAIL, '203.0.113.10')
      await login(db, { password: 'wrong-password' })
    }

    // Inside the window — even the correct password is rejected with 423.
    resetLimitersFor(EMAIL, '203.0.113.10')
    const lockedRes = await login(db)
    expect(lockedRes.status).toBe(423)
    expect(lockedRes.headers.get('retry-after')).not.toBeNull()
  })

  it('resets the failed counter and clears locked_until on a successful login', async () => {
    const { db } = testDb

    // Two failures, then a correct login. Counter should drop back to 0.
    resetLimitersFor(EMAIL, '203.0.113.10')
    await login(db, { password: 'wrong-password' })
    resetLimitersFor(EMAIL, '203.0.113.10')
    await login(db, { password: 'wrong-password' })

    const before = await findUserByEmail(db, EMAIL)
    expect(before?.failedLoginCount).toBe(2)

    resetLimitersFor(EMAIL, '203.0.113.10')
    const success = await login(db)
    expect(success.status).toBe(200)

    const after = await findUserByEmail(db, EMAIL)
    expect(after?.failedLoginCount).toBe(0)
    expect(after?.lockedUntil).toBeNull()

    // login.unlocked is emitted because the user had a non-zero failed counter
    // when the successful login happened.
    const events = await listAuditEvents(db)
    expect(events.map((e) => e.action)).toContain('login.unlocked')
  })

  it('the per-(IP, email) rate limit returns 429 + Retry-After + login.rate_limited audit', async () => {
    const { db } = testDb

    // Exhaust the per-(ip,email) bucket (5 attempts in 15-min window).
    // Use a unique IP so the per-IP cap (30) doesn't trip first.
    const ip = '203.0.113.20'
    for (let i = 0; i < 5; i++) {
      await login(db, { password: 'wrong-password', ip })
    }
    const blocked = await login(db, { password: 'wrong-password', ip })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('retry-after')).not.toBeNull()

    const events = await listAuditEvents(db)
    expect(events.map((e) => e.action)).toContain('login.rate_limited')

    // The blocked attempt is captured in login_attempts with result='rate_limited'.
    const ipAttempts = await listLoginAttemptsForIp(db, ip)
    expect(ipAttempts.some((a) => a.result === 'rate_limited')).toBe(true)
  })

  it('logs IP-only attempts when the email does not match a user', async () => {
    const { db } = testDb

    await login(db, { email: 'ghost@example.com', password: 'irrelevant' })

    const ipAttempts = await listLoginAttemptsForIp(db, '203.0.113.10')
    const ghost = ipAttempts.find((a) => a.emailNorm === 'ghost@example.com')
    expect(ghost).toBeDefined()
    expect(ghost?.result).toBe('no_user')
    expect(ghost?.userId).toBeNull()
  })

  it('does not increment the counter for a non-existent email', async () => {
    const { db } = testDb

    for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
      resetLimitersFor('ghost@example.com', '203.0.113.10')
      await login(db, { email: 'ghost@example.com', password: 'irrelevant' })
    }

    // The owner account is unaffected.
    const owner = await findUserByEmail(db, EMAIL)
    expect(owner?.failedLoginCount).toBe(0)
    expect(owner?.lockedUntil).toBeNull()
  })
})
