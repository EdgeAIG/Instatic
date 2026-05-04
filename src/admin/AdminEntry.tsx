import { useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@ui/components/Button'
import { DatabaseIcon } from 'pixel-art-icons/icons/database'
import { LoaderIcon } from 'pixel-art-icons/icons/loader'
import {
  getCmsSetupStatus,
  loginCms,
  probeCmsSession,
  setupCms,
} from '@core/persistence'
import { ContentPage } from './content/ContentPage'
import { PluginPage } from './plugins/PluginPage'
import { PluginsPage } from './plugins/PluginsPage'
import { SitePage } from './site/SitePage'
import { AppLoadingScreen } from './AppLoadingScreen'
import type { AdminWorkspace } from './workspace'
import styles from './AdminEntry.module.css'

// Register base modules with the global registry. Kept here (not in main.tsx)
// so the publisher / page-tree / sanitize stack only ships in the lazy admin
// chunk, never on the login / setup cold path.
import '../modules/base'

type AdminPhase = 'loading' | 'setup' | 'login' | 'editor'
type AdminSection = AdminWorkspace

interface AdminEntryProps {
  section?: AdminSection
}

export default function AdminEntry({ section = 'site' }: AdminEntryProps) {
  const [phase, setPhase] = useState<AdminPhase>('loading')
  const [siteName, setSiteName] = useState('My Site')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const siteNameId = useId()
  const emailId = useId()
  const passwordId = useId()

  useEffect(() => {
    let cancelled = false

    async function loadAdminState() {
      try {
        const status = await getCmsSetupStatus()
        if (cancelled) return

        if (status.needsSetup) {
          setPhase('setup')
          return
        }

        const authenticated = await probeCmsSession()
        if (!cancelled) setPhase(authenticated ? 'editor' : 'login')
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'CMS is unavailable')
          setPhase('login')
        }
      }
    }

    void loadAdminState()
    return () => { cancelled = true }
  }, [])

  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password.length < 12) {
      setError('Password must be at least 12 characters')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await setupCms({ siteName, email, password })
      await loginCms({ email, password })
      setPhase('editor')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Setup failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await loginCms({ email, password })
      setPhase('editor')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'loading') return <AppLoadingScreen />
  if (phase === 'editor') {
    if (section === 'content') return <ContentPage />
    if (section === 'plugins') return <PluginsPage />
    if (section === 'pluginPage') return <PluginPage />
    return <SitePage />
  }

  const isSetup = phase === 'setup'
  const title = isSetup ? 'Set Up CMS' : 'Admin Login'
  const submitLabel =
    submitting ? (isSetup ? 'Setting up' : 'Signing in') :
    isSetup ? 'Create Admin' :
    'Sign In'

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="admin-entry-title">
        <div className={styles.brandRow}>
          <div className={styles.brandIcon} aria-hidden="true">
            <DatabaseIcon size={16} />
          </div>
          <span>Page Builder CMS</span>
        </div>

        <h1 id="admin-entry-title" className={styles.title}>{title}</h1>

        <form
          className={styles.form}
          onSubmit={isSetup ? handleSetup : handleLogin}
        >
          {isSetup && (
            <label className={styles.field} htmlFor={siteNameId}>
              <span>Site name</span>
              <input
                id={siteNameId}
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
                required
                autoComplete="organization"
              />
            </label>
          )}

          <label className={styles.field} htmlFor={emailId}>
            <span>Email</span>
            <input
              id={emailId}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              autoComplete="email"
            />
          </label>

          <label className={styles.field} htmlFor={passwordId}>
            <span>Password</span>
            <input
              id={passwordId}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={isSetup ? 12 : undefined}
              type="password"
              autoComplete={isSetup ? 'new-password' : 'current-password'}
            />
          </label>

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          <Button
            variant="primary"
            size="lg"
            type="submit"
            fullWidth
            disabled={submitting}
            aria-busy={submitting}
          >
            {submitting && (
              <LoaderIcon size={14} className={styles.spinIcon} aria-hidden="true" />
            )}
            <span>{submitLabel}</span>
          </Button>
        </form>
      </section>
    </main>
  )
}
