import { describe, expect, it } from 'bun:test'
import { createTestDb } from '../helpers/createTestDb'
import { createSite, getSetupStatus } from '../../../server/repositories/setup'
import { createUser, findUserByEmail } from '../../../server/repositories/users'
import { createSession, findUserBySessionHash, revokeSessionByHash } from '../../../server/auth/sessions'
import { hashPassword } from '../../../server/auth/tokens'

describe('CMS repositories', () => {
  it('reports setup incomplete until site and active owner exist', async () => {
    const { db, cleanup } = await createTestDb()
    try {
      expect(await getSetupStatus(db)).toMatchObject({
        hasSite: false,
        hasAdmin: false,
        hasOwner: false,
        needsSetup: true,
      })

      await createSite(db, 'Example Site', {})
      await createUser(db, {
        id: 'owner_1',
        email: 'Owner@Example.com',
        displayName: 'Owner',
        passwordHash: await hashPassword('long-enough-password'),
        roleId: 'owner',
        allowOwnerRole: true,
      })

      expect(await getSetupStatus(db)).toMatchObject({
        hasSite: true,
        hasAdmin: true,
        hasOwner: true,
        needsSetup: false,
      })
    } finally {
      await cleanup()
    }
  })

  it('creates and finds users by normalized email', async () => {
    const { db, cleanup } = await createTestDb()
    try {
      await createUser(db, {
        id: 'user_1',
        email: 'Owner@Example.com',
        displayName: 'Owner',
        passwordHash: 'hash',
        roleId: 'member',
      })

      expect(await findUserByEmail(db, 'owner@example.com')).toMatchObject({
        id: 'user_1',
        email: 'Owner@Example.com',
        role: { slug: 'member' },
      })
    } finally {
      await cleanup()
    }
  })

  it('stores session token hashes and rejects revoked sessions', async () => {
    const { db, cleanup } = await createTestDb()
    try {
      await createUser(db, {
        id: 'user_1',
        email: 'owner@example.com',
        displayName: 'Owner',
        passwordHash: 'hash',
        roleId: 'member',
      })
      await createSession(db, {
        idHash: 'abc123',
        userId: 'user_1',
        expiresAt: new Date('2030-01-01'),
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      })

      expect(await findUserBySessionHash(db, 'abc123')).toMatchObject({ id: 'user_1' })
      await revokeSessionByHash(db, 'abc123')
      expect(await findUserBySessionHash(db, 'abc123')).toBeNull()
    } finally {
      await cleanup()
    }
  })
})
