/**
 * Unit tests for `deriveDeviceLabel` — the User-Agent → "Browser on Platform"
 * parser used to populate `sessions.device_label`.
 *
 * The label is cosmetic, not a security signal — the goal is "good enough for
 * the Sessions tab", not perfect UA classification.
 */
import { describe, expect, it } from 'bun:test'
import { deriveDeviceLabel } from '../../../server/auth/deviceLabel'

describe('deriveDeviceLabel', () => {
  it('returns empty string for null / empty input', () => {
    expect(deriveDeviceLabel(null)).toBe('')
    expect(deriveDeviceLabel(undefined)).toBe('')
    expect(deriveDeviceLabel('')).toBe('')
  })

  it('detects Chrome on macOS', () => {
    expect(
      deriveDeviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      ),
    ).toBe('Chrome on macOS')
  })

  it('detects Safari on macOS (and ranks Safari below Chrome)', () => {
    expect(
      deriveDeviceLabel(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      ),
    ).toBe('Safari on macOS')
  })

  it('detects Firefox on Windows', () => {
    expect(
      deriveDeviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:120.0) Gecko/20100101 Firefox/120.0',
      ),
    ).toBe('Firefox on Windows')
  })

  it('detects Edge on Windows', () => {
    expect(
      deriveDeviceLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0',
      ),
    ).toBe('Edge on Windows')
  })

  it('detects Safari on iOS', () => {
    expect(
      deriveDeviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari on iOS')
  })

  it('detects Chrome on iOS via the CriOS marker', () => {
    expect(
      deriveDeviceLabel(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Chrome on iOS')
  })

  it('detects Chrome on Android', () => {
    expect(
      deriveDeviceLabel(
        'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome on Android')
  })

  it('falls back to platform-only when browser is unrecognised', () => {
    expect(deriveDeviceLabel('curl/8.4.0')).toBe('')
    expect(deriveDeviceLabel('Mozilla/5.0 (X11; Linux x86_64) some-bot/1.0')).toBe('Linux')
  })
})
