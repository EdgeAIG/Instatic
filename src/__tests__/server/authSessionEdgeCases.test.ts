import { describe, expect, it } from 'bun:test'
import {
  createCapabilityTestHarness,
  readJson,
  type CapabilityTestHarness,
} from '../helpers/capabilityHarness'

interface ListedSession {
  id: string
  isCurrent: boolean
}

async function listSessions(
  harness: CapabilityTestHarness,
  cookie: string,
): Promise<ListedSession[]> {
  const res = await harness.cms('/admin/api/cms/auth/sessions', { cookie })
  expect(res.status).toBe(200)
  const body = await readJson<{ sessions: ListedSession[] }>(res)
  return body.sessions
}

async function createAccount(harness: CapabilityTestHarness): Promise<{ cookie: string; email: string }> {
  await harness.setupOwner()
  return harness.createRoleUser({
    name: 'Session Edge User',
    slug: `session-edge-${crypto.randomUUID().slice(0, 8)}`,
    capabilities: [],
  })
}

describe('account session edge cases', () => {
  it('returns a recoverable 404 envelope for an unknown secondary session id', async () => {
    const harness = await createCapabilityTestHarness()
    const account = await createAccount(harness)
    const steppedCookie = await harness.stepUp(account.cookie)

    const before = await listSessions(harness, steppedCookie)
    expect(before).toHaveLength(1)

    const res = await harness.cms('/admin/api/cms/auth/sessions/not-a-live-session', {
      method: 'DELETE',
      cookie: steppedCookie,
    })
    expect(res.status).toBe(404)
    await expect(readJson<{ error: string }>(res)).resolves.toEqual({
      error: 'Session not found',
    })

    const after = await listSessions(harness, steppedCookie)
    expect(after.map((session) => session.id)).toEqual(before.map((session) => session.id))
    expect(after).toHaveLength(1)
    expect(after[0]?.isCurrent).toBe(true)
  })

  it('treats logout-all with only the current session as a safe no-op', async () => {
    const harness = await createCapabilityTestHarness()
    const account = await createAccount(harness)
    const steppedCookie = await harness.stepUp(account.cookie)

    const before = await listSessions(harness, steppedCookie)
    expect(before).toHaveLength(1)
    expect(before[0]?.isCurrent).toBe(true)

    const res = await harness.cms('/admin/api/cms/auth/logout-all', {
      method: 'POST',
      cookie: steppedCookie,
    })
    expect(res.status).toBe(200)
    await expect(readJson<{ ok: boolean; revokedCount: number }>(res)).resolves.toEqual({
      ok: true,
      revokedCount: 0,
    })

    const after = await listSessions(harness, steppedCookie)
    expect(after.map((session) => session.id)).toEqual(before.map((session) => session.id))
    expect(after).toHaveLength(1)
    expect(after[0]?.isCurrent).toBe(true)
  })

  it('treats repeated logout from an already-revoked session as a safe cookie clear', async () => {
    const harness = await createCapabilityTestHarness()
    const account = await createAccount(harness)

    const firstLogout = await harness.cms('/admin/api/cms/logout', {
      method: 'POST',
      cookie: account.cookie,
    })
    expect(firstLogout.status).toBe(200)
    await expect(readJson<{ ok: boolean }>(firstLogout)).resolves.toEqual({ ok: true })
    expect(firstLogout.headers.get('set-cookie') ?? '').toContain('Max-Age=0')

    const repeatedLogout = await harness.cms('/admin/api/cms/logout', {
      method: 'POST',
      cookie: account.cookie,
    })
    expect(repeatedLogout.status).toBe(200)
    await expect(readJson<{ ok: boolean }>(repeatedLogout)).resolves.toEqual({ ok: true })
    expect(repeatedLogout.headers.get('set-cookie') ?? '').toContain('Max-Age=0')

    const me = await harness.cms('/admin/api/cms/me', { cookie: account.cookie })
    expect(me.status).toBe(401)
  })
})
