/**
 * Account → Security tab.
 *
 * Placeholder shell for security-relevant actions. Each card is rendered now
 * with the right copy and CTA shape so the IA is stable; the action buttons
 * are disabled until the implementation lands:
 *
 *   - Password change         → C.4 (HIBP + step-up)
 *   - Two-factor auth (TOTP)  → C.4
 *   - Recovery codes          → C.4
 *   - Connected sign-ins      → future (OAuth / passkeys)
 *
 * This intentionally does NOT hide the section while features are missing —
 * the user expects "Security" to exist on a self-hosted CMS, and the empty
 * shell makes the gap legible. The disabled buttons carry tooltips that say
 * what is shipping next.
 */
import type { CmsCurrentUser } from '@core/persistence'
import { Button } from '@ui/components/Button'
import styles from '../AccountPage.module.css'

interface SecurityTabProps {
  user: CmsCurrentUser
}

interface SecurityCardProps {
  title: string
  description: string
  status: string
  statusActive?: boolean
  actionLabel: string
  actionDisabledReason: string
  testId: string
}

function SecurityCard({
  title,
  description,
  status,
  statusActive = false,
  actionLabel,
  actionDisabledReason,
  testId,
}: SecurityCardProps) {
  return (
    <div className={styles.card} data-testid={testId}>
      <div className={styles.cardHeader}>
        <div>
          <h3 className={styles.cardTitle}>{title}</h3>
          <p className={styles.cardDesc}>{description}</p>
        </div>
        <div className={styles.cardActions}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled
            tooltip={actionDisabledReason}
          >
            <span>{actionLabel}</span>
          </Button>
        </div>
      </div>
      <p
        className={
          statusActive
            ? `${styles.cardStatus} ${styles.cardStatusActive}`
            : styles.cardStatus
        }
        role="status"
      >
        {status}
      </p>
    </div>
  )
}

export function SecurityTab({ user }: SecurityTabProps) {
  // `lastLoginAt` is the closest signal we have today for "when did this
  // account last interact with auth". Once the password-change flow ships,
  // a `password_updated_at` column will replace this.
  const lastLogin = user.lastLoginAt
    ? new Date(user.lastLoginAt).toLocaleString()
    : 'Never'

  return (
    <section className={styles.section} aria-labelledby="account-security-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="account-security-title">Security</h2>
          <p>Password, two-factor authentication, and connected sign-ins.</p>
        </div>
      </div>

      <div className={styles.cards}>
        <SecurityCard
          testId="security-password-card"
          title="Password"
          description="Change your password. Required at least 12 characters and not in any known breach corpus."
          status={`Last login: ${lastLogin}`}
          actionLabel="Change password"
          actionDisabledReason="Password change ships in C.4 (Stage C of the auth roadmap)."
        />
        <SecurityCard
          testId="security-mfa-card"
          title="Two-factor authentication"
          description="Add a TOTP authenticator app (Google Authenticator, 1Password, Authy) for a second factor."
          status="Off"
          actionLabel="Enable"
          actionDisabledReason="MFA enrolment ships in C.4."
        />
        <SecurityCard
          testId="security-recovery-card"
          title="Recovery codes"
          description="One-time codes you can use to sign in if you lose access to your authenticator app."
          status="No recovery codes generated yet."
          actionLabel="Generate codes"
          actionDisabledReason="Recovery codes ship in C.4 alongside MFA."
        />
        <SecurityCard
          testId="security-connected-card"
          title="Connected sign-ins"
          description="OAuth providers and passkeys you can use to sign in alongside your password."
          status="Email + password is the only sign-in method right now."
          actionLabel="Add provider"
          actionDisabledReason="OAuth and passkeys are out of scope for the C-stage rollout."
        />
      </div>
    </section>
  )
}
