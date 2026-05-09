/**
 * StepUpProvider — wraps the authenticated admin shell, exposes
 * `useStepUp().runStepUp(action)`, and renders the modal that prompts for a
 * password re-entry whenever the server rejects an action with
 * `step_up_required`.
 *
 * Flow:
 *
 *   1. Component calls `runStepUp(() => doSensitiveThing())`.
 *   2. Provider runs `doSensitiveThing` directly. Most calls succeed —
 *      the user already has a fresh window, no dialog appears.
 *   3. If the action throws `Error('step_up_required')`, the provider
 *      records the pending action and opens the dialog.
 *   4. User enters password and submits. Provider posts to
 *      `/admin/api/cms/auth/step-up`. On success it retries the action
 *      and resolves with its result; on failure it shows the error in
 *      the dialog and lets the user retry.
 *   5. User clicks Cancel (or hits ESC) → the provider rejects with
 *      `Error('step_up_cancelled')` so callers can swallow the
 *      cancellation without conflating it with a real failure.
 *
 * Single dialog instance per provider — concurrent `runStepUp` calls queue
 * in source order; the dialog handles them one at a time. That's the
 * right shape for typical admin work (a user clicks one delete button at
 * a time).
 */
import { useRef, useState, type ReactNode } from 'react'
import { isStepUpRequiredError, stepUpCms } from '@core/persistence'
import { StepUpDialog } from './StepUpDialog'
import { StepUpCancelledMessage, StepUpContext, type StepUpContextValue } from './StepUpContext'

interface PendingState<T = unknown> {
  action: () => Promise<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
}

export function StepUpProvider({ children }: { children: ReactNode }) {
  // The pending action is held in a ref because the dialog handlers
  // (submit / cancel) must close over the *current* pending entry, not a
  // stale one. The dialog's render state (`open`, `error`, `submitting`)
  // lives in useState so React re-renders normally.
  //
  // No manual `useCallback` / `useMemo` here — the React Compiler can't
  // analyse the generic `runStepUp<T>` signature, and the provider value
  // is consumed via `runStepUp(action)` (call site), not via referential
  // equality, so a fresh identity each render is harmless.
  const pendingRef = useRef<PendingState | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function runStepUp<T>(action: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      void (async () => {
        try {
          // First attempt — usually succeeds because the session already
          // has a fresh window. Avoids opening the dialog every time.
          const result = await action()
          resolve(result)
        } catch (err) {
          if (!isStepUpRequiredError(err)) {
            reject(err instanceof Error ? err : new Error(String(err)))
            return
          }
          // Park the action; the dialog handlers will resume it.
          pendingRef.current = {
            action: action as () => Promise<unknown>,
            resolve: resolve as (value: unknown) => void,
            reject,
          }
          setError(null)
          setSubmitting(false)
          setOpen(true)
        }
      })()
    })
  }

  function handleCancel(): void {
    const pending = pendingRef.current
    pendingRef.current = null
    setOpen(false)
    setError(null)
    setSubmitting(false)
    pending?.reject(new Error(StepUpCancelledMessage))
  }

  async function handleSubmit(password: string): Promise<void> {
    const pending = pendingRef.current
    if (!pending) {
      setOpen(false)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      // Re-authenticate. Failure here means the password was wrong (or
      // the account is locked, or the session went away). We surface the
      // server's message inline and let the user retry.
      await stepUpCms({ password })
    } catch (err) {
      setSubmitting(false)
      setError(err instanceof Error ? err.message : 'Could not confirm password.')
      return
    }

    // Step-up succeeded — retry the original action with a fresh window.
    try {
      const result = await pending.action()
      pendingRef.current = null
      setOpen(false)
      setSubmitting(false)
      pending.resolve(result)
    } catch (err) {
      // The action itself failed AFTER step-up (e.g. the target row was
      // already deleted, or a permission changed). Surface the message
      // and let the user dismiss.
      setSubmitting(false)
      setError(err instanceof Error ? err.message : 'Action failed.')
    }
  }

  const value: StepUpContextValue = { runStepUp }

  return (
    <StepUpContext.Provider value={value}>
      {children}
      {open && (
        <StepUpDialog
          submitting={submitting}
          error={error}
          onSubmit={(password) => void handleSubmit(password)}
          onCancel={handleCancel}
        />
      )}
    </StepUpContext.Provider>
  )
}
