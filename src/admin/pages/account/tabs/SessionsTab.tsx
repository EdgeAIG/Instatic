/**
 * Account → Sessions tab.
 *
 * Lists every live session the current user has across browsers and devices,
 * pinning the *current* one to the top with a "This device" badge. Each
 * other row exposes a "Sign out" action that calls
 * `DELETE /admin/api/cms/auth/sessions/:id`. A "Sign out everywhere else"
 * action in the section header revokes every non-current session in one go.
 *
 * The current session's row is intentionally non-revocable from this UI —
 * users should use the toolbar avatar's "Sign out" item to drop the cookie
 * along with the row. Calling `DELETE` against the current session id would
 * succeed on the server (well, it would 400 — see `auth.ts`) but leaves the
 * cookie around, so we don't even surface the affordance.
 *
 * Step-up auth (C.3) is intentionally not gating these actions yet. When it
 * lands, the call paths in this file will route through the step-up dialog
 * if the current session has no fresh re-auth window.
 */
import { useEffect, useState } from 'react'
import { Button } from '@ui/components/Button'
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeader,
  DataTableRow,
} from '@ui/components/DataTable'
import {
  listCmsSessions,
  logoutAllOtherCmsSessions,
  revokeCmsSession,
  type CmsSession,
} from '@core/persistence'
import { StepUpCancelledMessage, useStepUp } from '@admin/shared/StepUp'
import styles from '../AccountPage.module.css'

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString()
}

function formatLastSeen(value: string): string {
  const ms = Date.now() - new Date(value).getTime()
  if (Number.isNaN(ms) || ms < 0) return formatDateTime(value)
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`
  return formatDateTime(value)
}

/**
 * `reloadKey` ticks every time we want to re-fetch the session list (after a
 * revoke / logout-all). Bumping the state triggers the load effect's
 * dependency check, which keeps the load logic inline (the React 19 hook
 * rules dislike `setState` calls reaching into the effect from a memoised
 * callback closure).
 */
export function SessionsTab() {
  const { runStepUp } = useStepUp()
  const [sessions, setSessions] = useState<CmsSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    // The "loading" / "error" reset for re-fetches happens via the
    // surrounding action handlers (`handleRevoke`, `handleRevokeAllOthers`)
    // before they bump `reloadKey`. The effect itself only resolves the next
    // state; React 19's hook rules disallow synchronous setState inside the
    // effect body.
    listCmsSessions()
      .then((next) => {
        if (cancelled) return
        setSessions(next)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not load sessions')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  function reload(): void {
    setReloadKey((current) => current + 1)
  }

  async function handleRevoke(session: CmsSession): Promise<void> {
    if (busy) return
    setBusy(session.id)
    setError(null)
    setStatus(null)
    try {
      await runStepUp(() => revokeCmsSession(session.id))
      setStatus(`Signed out ${session.deviceLabel || 'device'}.`)
      reload()
    } catch (err) {
      // The user cancelled the step-up dialog — silent dismiss, not a
      // failure we want to scream about.
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      setError(err instanceof Error ? err.message : 'Could not sign out device')
    } finally {
      setBusy(null)
    }
  }

  async function handleRevokeAllOthers(): Promise<void> {
    if (busy) return
    setBusy('all')
    setError(null)
    setStatus(null)
    try {
      const revokedCount = await runStepUp(() => logoutAllOtherCmsSessions())
      setStatus(
        revokedCount === 0
          ? 'No other devices were signed in.'
          : `Signed out ${revokedCount} other ${revokedCount === 1 ? 'device' : 'devices'}.`,
      )
      reload()
    } catch (err) {
      if (err instanceof Error && err.message === StepUpCancelledMessage) return
      setError(err instanceof Error ? err.message : 'Could not sign out other devices')
    } finally {
      setBusy(null)
    }
  }

  const otherCount = sessions.filter((s) => !s.isCurrent).length

  return (
    <section className={styles.section} aria-labelledby="account-sessions-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="account-sessions-title">Sessions</h2>
          <p>Devices currently signed in to your account. Sign any out individually or all at once.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy !== null || otherCount === 0}
          onClick={() => void handleRevokeAllOthers()}
          data-testid="account-sessions-sign-out-others"
        >
          <span>{busy === 'all' ? 'Signing out…' : 'Sign out everywhere else'}</span>
        </Button>
      </div>

      {error && <p className={styles.error} role="alert">{error}</p>}
      {status && <p className={styles.cardStatus} role="status">{status}</p>}

      {loading ? (
        <p className={styles.emptyState}>Loading sessions…</p>
      ) : sessions.length === 0 ? (
        // The current session is always present, so this branch is only
        // reached on transient empty responses (e.g. the list raced with a
        // global revoke). Render an honest empty state rather than a fake
        // "this device" placeholder.
        <p className={styles.emptyState}>No active sessions.</p>
      ) : (
        <DataTable aria-label="Active sessions" density="compact">
          <DataTableHead>
            <DataTableRow>
              <DataTableHeader scope="col">Device</DataTableHeader>
              <DataTableHeader scope="col">IP</DataTableHeader>
              <DataTableHeader scope="col">Last active</DataTableHeader>
              <DataTableHeader scope="col" className={styles.actionsHeader}>Actions</DataTableHeader>
            </DataTableRow>
          </DataTableHead>
          <DataTableBody>
            {sessions.map((session) => {
              const labelText = session.deviceLabel || 'Unknown device'
              return (
                <DataTableRow key={session.id} aria-label={`Session ${labelText}`}>
                  <DataTableCell>
                    <div className={styles.deviceLabel}>
                      <strong>{labelText}</strong>
                      <span>Signed in {formatDateTime(session.createdAt)}</span>
                    </div>
                  </DataTableCell>
                  <DataTableCell>
                    <span className={styles.secondaryText}>{session.ipAddress ?? 'unknown'}</span>
                  </DataTableCell>
                  <DataTableCell>
                    <span className={styles.secondaryText}>
                      {session.isCurrent ? 'This device' : formatLastSeen(session.lastSeenAt)}
                    </span>
                  </DataTableCell>
                  <DataTableCell className={styles.actionsCell}>
                    {session.isCurrent ? (
                      <span className={styles.badgeMuted}>Current</span>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        disabled={busy !== null}
                        onClick={() => void handleRevoke(session)}
                        data-testid={`account-sessions-sign-out-${session.id}`}
                      >
                        <span>{busy === session.id ? 'Signing out…' : 'Sign out'}</span>
                      </Button>
                    )}
                  </DataTableCell>
                </DataTableRow>
              )
            })}
          </DataTableBody>
        </DataTable>
      )}
    </section>
  )
}
