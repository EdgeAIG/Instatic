/**
 * Unit tests for the per-account lockout policy in `server/auth/lockout.ts`.
 *
 * Covers the pure-function half (decision math). The end-to-end interaction
 * with the login handler is exercised by `authLockoutLogin.test.ts`.
 */
import { describe, expect, it } from 'bun:test'
import {
  LOCKOUT_CAP_MS,
  LOCKOUT_INITIAL_MS,
  LOCKOUT_THRESHOLD,
  evaluateFailedAttempt,
  evaluateLockState,
} from '../../../server/auth/lockout'

const NOW = new Date('2026-05-01T00:00:00.000Z')

describe('evaluateFailedAttempt', () => {
  it('does not trigger before THRESHOLD failures', () => {
    for (let prev = 0; prev < LOCKOUT_THRESHOLD - 1; prev++) {
      const result = evaluateFailedAttempt(prev, NOW)
      expect(result.triggered).toBe(false)
      expect(result.lockedUntil).toBeNull()
      expect(result.failedLoginCount).toBe(prev + 1)
    }
  })

  it('triggers a 15-min lock at the THRESHOLDth failure (cycle 1)', () => {
    const result = evaluateFailedAttempt(LOCKOUT_THRESHOLD - 1, NOW)
    expect(result.triggered).toBe(true)
    expect(result.failedLoginCount).toBe(LOCKOUT_THRESHOLD)
    expect(result.lockedUntil?.getTime()).toBe(NOW.getTime() + LOCKOUT_INITIAL_MS)
  })

  it('does not re-trigger between cycles (failures 6–9)', () => {
    for (let prev = LOCKOUT_THRESHOLD; prev < LOCKOUT_THRESHOLD * 2 - 1; prev++) {
      const result = evaluateFailedAttempt(prev, NOW)
      expect(result.triggered).toBe(false)
      expect(result.lockedUntil).toBeNull()
    }
  })

  it('doubles the lock duration on each subsequent cycle', () => {
    const cycle2 = evaluateFailedAttempt(LOCKOUT_THRESHOLD * 2 - 1, NOW)
    expect(cycle2.triggered).toBe(true)
    expect(cycle2.lockedUntil?.getTime()).toBe(NOW.getTime() + LOCKOUT_INITIAL_MS * 2)

    const cycle3 = evaluateFailedAttempt(LOCKOUT_THRESHOLD * 3 - 1, NOW)
    expect(cycle3.triggered).toBe(true)
    expect(cycle3.lockedUntil?.getTime()).toBe(NOW.getTime() + LOCKOUT_INITIAL_MS * 4)

    const cycle4 = evaluateFailedAttempt(LOCKOUT_THRESHOLD * 4 - 1, NOW)
    expect(cycle4.triggered).toBe(true)
    expect(cycle4.lockedUntil?.getTime()).toBe(NOW.getTime() + LOCKOUT_INITIAL_MS * 8)
  })

  it('caps the lock duration at LOCKOUT_CAP_MS (24 h)', () => {
    // The doubling reaches the cap somewhere around cycle 8 (15 min × 2^7 =
    // 32 h > 24 h). Verify a cycle deep enough to exceed the cap is clamped.
    const deep = evaluateFailedAttempt(LOCKOUT_THRESHOLD * 12 - 1, NOW)
    expect(deep.triggered).toBe(true)
    expect(deep.lockedUntil?.getTime()).toBe(NOW.getTime() + LOCKOUT_CAP_MS)
  })
})

describe('evaluateLockState', () => {
  it('reports unlocked when lockedUntil is null', () => {
    expect(evaluateLockState(null, NOW)).toEqual({ locked: false, retryAfterMs: 0 })
  })

  it('reports locked when lockedUntil is in the future', () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString()
    const state = evaluateLockState(future, NOW)
    expect(state.locked).toBe(true)
    expect(state.retryAfterMs).toBe(60_000)
  })

  it('reports unlocked when lockedUntil has elapsed', () => {
    const past = new Date(NOW.getTime() - 1).toISOString()
    expect(evaluateLockState(past, NOW)).toEqual({ locked: false, retryAfterMs: 0 })
  })

  it('treats an unparseable lockedUntil as unlocked', () => {
    expect(evaluateLockState('not-a-date', NOW)).toEqual({ locked: false, retryAfterMs: 0 })
  })

  it('retryAfterMs equals lockedUntil - now', () => {
    const future = new Date(NOW.getTime() + 12_345).toISOString()
    const state = evaluateLockState(future, NOW)
    expect(state.retryAfterMs).toBe(12_345)
  })
})
