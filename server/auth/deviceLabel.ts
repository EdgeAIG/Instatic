/**
 * Best-effort device label derived from a `User-Agent` string.
 *
 * Used to populate `sessions.device_label` at issue time so the Account →
 * Sessions tab can render a human-readable row per active session
 * ("Chrome on macOS", "Safari on iOS", "Firefox on Windows", …).
 *
 * Why a hand-rolled parser instead of `ua-parser-js`?
 *   - Tiny surface: a half-dozen regexes cover ~99% of real-world UAs hitting
 *     a CMS admin and produce a clean two-token label. The full library
 *     drags in a 30 KB dep for trivia we don't render.
 *   - Deterministic: easy to unit-test, and the label is a *cosmetic* hint —
 *     `ip_address` and `created_at` are still recorded verbatim for forensic
 *     review.
 *
 * The label is *not* a security signal. A user can spoof their UA at will;
 * the underlying session is still keyed on the cookie hash.
 *
 * The empty string is a valid result — used as a safe default for storage
 * (the column is `not null default ''`). The Sessions UI falls back to
 * "Unknown device" for empty labels.
 */

interface UaMatch {
  pattern: RegExp
  label: string
}

const BROWSERS: UaMatch[] = [
  // Order matters: more specific rules first. Edge / Brave / Vivaldi all
  // contain "Chrome" in their UA string.
  { pattern: /\bEdg(e|A|iOS)?\//i,           label: 'Edge' },
  { pattern: /\bOPR\/|\bOpera\b/i,           label: 'Opera' },
  { pattern: /\bVivaldi\//i,                 label: 'Vivaldi' },
  { pattern: /\bBrave\//i,                   label: 'Brave' },
  { pattern: /\bFirefox\//i,                 label: 'Firefox' },
  // Chrome on iOS reports as "CriOS" — keep it labelled as Chrome to match
  // user expectations (the user installed Chrome).
  { pattern: /\bCriOS\//i,                   label: 'Chrome' },
  { pattern: /\bChrome\//i,                  label: 'Chrome' },
  // Safari must come after Chrome — Chrome's UA contains "Safari".
  { pattern: /\bVersion\/.+ Safari\//i,      label: 'Safari' },
  { pattern: /\bSafari\//i,                  label: 'Safari' },
]

const PLATFORMS: UaMatch[] = [
  // iPad reports "iPad" on older iOS, "Macintosh" on recent iPadOS desktop
  // class — handle both. iPhone is unambiguous.
  { pattern: /\biPhone\b/i,                  label: 'iOS' },
  { pattern: /\biPad\b|iPadOS/i,             label: 'iPadOS' },
  { pattern: /\bAndroid\b/i,                 label: 'Android' },
  { pattern: /\bMacintosh\b|\bMac OS X\b/i,  label: 'macOS' },
  // Windows phones are extinct enough to merge into the desktop label.
  { pattern: /\bWindows\b/i,                 label: 'Windows' },
  { pattern: /\bCrOS\b/i,                    label: 'ChromeOS' },
  { pattern: /\bX11\b|\bLinux\b/i,           label: 'Linux' },
]

function firstMatch(ua: string, table: UaMatch[]): string | null {
  for (const entry of table) {
    if (entry.pattern.test(ua)) return entry.label
  }
  return null
}

/**
 * Build a "Browser on Platform" label from a User-Agent string.
 *
 * - `null` / empty UA → empty string. The DB column accepts empty as a
 *   not-null sentinel.
 * - One side known, the other unknown → `"Chrome"` or `"Linux"` alone.
 * - Both unknown → empty string.
 */
export function deriveDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return ''

  const browser = firstMatch(userAgent, BROWSERS)
  const platform = firstMatch(userAgent, PLATFORMS)

  if (browser && platform) return `${browser} on ${platform}`
  if (browser) return browser
  if (platform) return platform
  return ''
}
