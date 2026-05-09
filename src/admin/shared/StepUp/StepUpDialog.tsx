/**
 * StepUpDialog — pure presentational dialog used by `StepUpProvider`.
 *
 * Single-input modal that asks the current user to re-enter their password.
 * On submit, the parent provider POSTs to `/admin/api/cms/auth/step-up`
 * and (on success) retries the original sensitive action; on cancel, the
 * provider rejects the pending promise with `step_up_cancelled`.
 *
 * The component is intentionally state-light — `password`, `error`,
 * `submitting` are owned here, but the *flow state* (which action is
 * pending, whether to retry) lives in the provider.
 *
 * No native `<dialog>`: the editor shell already uses portal-rendered
 * `role="dialog"` overlays elsewhere (see `SettingsModal`), and the same
 * idiom (backdrop + ESC + focus management on the Cancel button) gives
 * consistent behaviour across the admin.
 */
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '@ui/components/Button'
import styles from './StepUpDialog.module.css'

interface StepUpDialogProps {
  /** Why the action requires re-auth — shown above the password field. */
  reason?: string
  /** True while a step-up POST or the original action is in flight. */
  submitting: boolean
  /** Last error message to render under the input (wrong password, etc.). */
  error: string | null
  onSubmit: (password: string) => void
  onCancel: () => void
}

export function StepUpDialog({
  reason,
  submitting,
  error,
  onSubmit,
  onCancel,
}: StepUpDialogProps) {
  const [password, setPassword] = useState('')
  const titleId = useId()
  const passwordId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)

  // Focus the cancel button on open so ESC / Tab feel right. The password
  // input takes focus the moment the user hits Tab once.
  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  // ESC closes the dialog (treated as cancel).
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onCancel])

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || password.length === 0) return
    onSubmit(password)
  }

  return (
    <div
      className={styles.backdrop}
      role="presentation"
      onClick={(event) => {
        // Backdrop click cancels the action — same affordance as ESC.
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={styles.dialog}
        data-testid="step-up-dialog"
      >
        <h2 id={titleId} className={styles.title}>Confirm your password</h2>
        <p className={styles.body}>
          {reason ?? 'This action requires a recent password re-entry. You\'ll stay signed in here.'}
        </p>
        <form className={styles.field} onSubmit={handleSubmit}>
          <label htmlFor={passwordId} className={styles.label}>Password</label>
          <input
            id={passwordId}
            type="password"
            autoFocus
            required
            disabled={submitting}
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            data-testid="step-up-password"
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button
              ref={cancelRef}
              type="button"
              variant="secondary"
              size="sm"
              disabled={submitting}
              onClick={onCancel}
              data-testid="step-up-cancel"
            >
              <span>Cancel</span>
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={submitting || password.length === 0}
              data-testid="step-up-confirm"
            >
              <span>{submitting ? 'Confirming…' : 'Confirm'}</span>
            </Button>
          </div>
        </form>
      </section>
    </div>
  )
}
