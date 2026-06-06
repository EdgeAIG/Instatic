/**
 * Timezone-aware day bucketing — shared by every server rollup that bins
 * timestamps into a "per calendar day" series (AI usage audit, dashboard
 * posts histogram, …).
 *
 * The bucket boundary depends on the VIEWER's timezone, which the database
 * doesn't know, so day keys are computed in JS rather than SQL. Using a full
 * IANA zone — not a fixed UTC offset — keeps buckets correct across DST
 * transitions inside a multi-week window and across sub-hour offsets (e.g.
 * Asia/Kathmandu +5:45). `created_at` stored as UTC, `substr(.., 1, 10)` in
 * SQL would yield the UTC date and misplace anything near local midnight.
 */

/**
 * Validate an IANA timezone string (e.g. from a `?tz=` query param). Returns
 * the zone when valid, or `'UTC'` when missing/unknown — callers must always
 * get a usable zone so the view still renders.
 */
export function resolveTimeZone(raw: string | null | undefined): string {
  if (!raw) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: raw })
    return raw
  } catch {
    return 'UTC'
  }
}

/**
 * Build a reusable `Date | ISO-string → "YYYY-MM-DD"` mapper for one IANA
 * timezone. The `Intl.DateTimeFormat` is constructed once and reused per row.
 * An invalid or unknown zone falls back to UTC rather than throwing. `en-CA`
 * formats as ISO-style `YYYY-MM-DD`.
 */
export function localDayKeyFactory(timeZone: string): (value: string | Date) => string {
  const formatter = makeDayFormatter(timeZone)
  return (value) => formatter.format(value instanceof Date ? value : new Date(value))
}

function makeDayFormatter(timeZone: string): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }
  try {
    return new Intl.DateTimeFormat('en-CA', options)
  } catch {
    return new Intl.DateTimeFormat('en-CA', { ...options, timeZone: 'UTC' })
  }
}
