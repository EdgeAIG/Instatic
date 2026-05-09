/**
 * Account → Profile tab.
 *
 * Read-only first cut: displays the user's identity (avatar + display name +
 * email + role). The interactive bits — display-name edit, email change,
 * avatar upload — land in subsequent change-sets:
 *
 *   - Display name + avatar upload: needs a `PATCH /me` endpoint and the
 *     avatar upload UI; queued behind the file-upload primitive plumbing.
 *   - Email change: needs the email-verification flow (C.4 / Stage B in
 *     `docs/multi-user-scope.md`).
 *
 * Showing the section now (instead of waiting) makes it the canonical place
 * the user looks for their identity, so when those flows ship they slot in
 * without changing the IA.
 */
import type { CmsCurrentUser } from '@core/persistence'
import styles from '../AccountPage.module.css'

interface ProfileTabProps {
  user: CmsCurrentUser
}

function deriveInitial(user: CmsCurrentUser): string {
  const source = (user.displayName.trim() || user.email).trim()
  if (!source) return '?'
  return source[0]?.toUpperCase() ?? '?'
}

export function ProfileTab({ user }: ProfileTabProps) {
  const displayName = user.displayName.trim() || user.email
  const showRenamePrompt = user.displayName.trim() === '' || user.displayName.trim() === user.email

  return (
    <section className={styles.section} aria-labelledby="account-profile-title">
      <div className={styles.sectionHeader}>
        <div>
          <h2 id="account-profile-title">Profile</h2>
          <p>Your name, email, and role across the install.</p>
        </div>
      </div>

      <div className={styles.card}>
        <div className={styles.profileGrid}>
          <div className={styles.avatarCircle} aria-hidden="true">
            {deriveInitial(user)}
          </div>
          <div className={styles.profileFields}>
            <div className={styles.profileField}>
              <span className={styles.profileFieldLabel}>Name</span>
              <span className={styles.profileFieldValue}>{displayName}</span>
            </div>
            <div className={styles.profileField}>
              <span className={styles.profileFieldLabel}>Email</span>
              <span className={styles.profileFieldValue}>{user.email}</span>
            </div>
            <div className={styles.profileField}>
              <span className={styles.profileFieldLabel}>Role</span>
              <span className={styles.profileFieldValue}>{user.role.name}</span>
            </div>
          </div>
        </div>
        {showRenamePrompt && (
          <p className={styles.cardStatus}>
            Add a display name in a future release to personalise your account.
          </p>
        )}
      </div>
    </section>
  )
}
