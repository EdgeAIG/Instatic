/**
 * Account → Activity tab.
 *
 * Shows the user's recent login activity from `login_attempts` — successes,
 * failures, lockouts, and rate-limit hits, both `user_id`-matched rows and
 * pre-lookup attempts that mention the user's email.
 *
 * The "suspicious activity" banner surfaces whenever there's a `locked` or
 * `rate_limited` event in the last 24 h — a low-cost nudge for the user to
 * change their password (when that flow ships in C.4).
 */
import { useEffect, useMemo, useState } from 'react'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@ui/components/DataTable'
import { CircleAlertIcon } from 'pixel-art-icons/icons/circle-alert'
import {
  listCmsLoginActivity,
  type CmsLoginActivityEvent,
  type CmsLoginActivityResult,
} from '@core/persistence'
import styles from '../AccountPage.module.css'

const LOOKBACK_24H_MS = 24 * 60 * 60 * 1000

const RESULT_LABELS: Record<CmsLoginActivityResult, string> = {
  success: 'Success',
  bad_password: 'Wrong password',
  no_user: 'Unknown user',
  account_disabled: 'Account suspended',
  locked: 'Account locked',
  rate_limited: 'Rate-limited',
}

function resultClass(result: CmsLoginActivityResult): string {
  switch (result) {
    case 'success':
      return styles.activityResultSuccess
    case 'locked':
    case 'rate_limited':
      return styles.activityResultLocked
    default:
      return styles.activityResultBad
  }
}

function isRecentSuspicious(event: CmsLoginActivityEvent, now: number): boolean {
  if (event.result !== 'locked' && event.result !== 'rate_limited') return false
  const ts = Date.parse(event.attemptedAt)
  if (Number.isNaN(ts)) return false
  return now - ts < LOOKBACK_24H_MS
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString()
}

export function ActivityTab() {
  const [events, setEvents] = useState<CmsLoginActivityEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // `now` is captured once at mount so the suspicious-banner threshold is
  // stable across renders. Calling `Date.now()` during render trips the
  // React 19 impure-call rule; the user-visible timestamps inside individual
  // rows are computed at format time, not against this anchor.
  const [mountedAt] = useState<number>(() => Date.now())

  useEffect(() => {
    let cancelled = false
    listCmsLoginActivity()
      .then((next) => {
        if (cancelled) return
        setEvents(next)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load activity')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const showSuspiciousBanner = useMemo(
    () => events.some((event) => isRecentSuspicious(event, mountedAt)),
    [events, mountedAt],
  )

  return (
    <section className={styles.section} aria-labelledby="account-activity-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="account-activity-title">Activity</h2>
          <p>Recent sign-in attempts on your account, including failures and lockouts.</p>
        </div>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}

      {showSuspiciousBanner && (
        <div className={styles.suspiciousBanner} role="status" data-testid="account-activity-suspicious">
          <CircleAlertIcon size={14} aria-hidden="true" />
          <span>
            Suspicious activity in the last 24 hours. Review the entries below — if any are unfamiliar,
            consider changing your password once that lands.
          </span>
        </div>
      )}

      {loading ? (
        <p className={styles.emptyState}>Loading activity…</p>
      ) : events.length === 0 ? (
        <p className={styles.emptyState}>No login activity yet.</p>
      ) : (
        <DataTable aria-label="Login activity" density="compact">
          <DataTableHead>
            <DataTableRow>
              <DataTableHeader scope="col">When</DataTableHeader>
              <DataTableHeader scope="col">IP</DataTableHeader>
              <DataTableHeader scope="col">Outcome</DataTableHeader>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {events.map((event) => (
              <DataTableRow key={event.id} aria-label={`Activity ${event.result}`}>
                <DataTableCell>
                  <span className={styles.secondaryText}>{formatDateTime(event.attemptedAt)}</span>
                </DataTableCell>
                <DataTableCell>
                  <span className={styles.secondaryText}>{event.ipAddress ?? 'unknown'}</span>
                </DataTableCell>
                <DataTableCell>
                  <span className={styles.activityRow}>
                    <span className={`${styles.activityResult} ${resultClass(event.result)}`}>
                      {RESULT_LABELS[event.result]}
                    </span>
                  </span>
                </DataTableCell>
              </DataTableRow>
            ))}
          </DataTableBody>
        </DataTable>
      )}
    </section>
  )
}
