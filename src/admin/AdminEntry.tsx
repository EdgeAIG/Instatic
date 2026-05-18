import { lazy, Suspense, useEffect, useId, useState } from 'react'
import type { FormEvent } from 'react'
import { Button } from '@ui/components/Button'
import { Input } from '@ui/components/Input'
import { DatabaseSolidIcon } from 'pixel-art-icons/icons/database-solid'
import { LoaderIcon } from 'pixel-art-icons/icons/loader'
import {
  getCmsPublicSite,
  getCmsSetupStatus,
  getCurrentCmsUser,
  loginCms,
  setupCms,
  verifyCmsMfa,
  type CmsCurrentUser,
  type CmsPublicSite,
} from '@core/persistence'
import { AppLoadingScreen } from './AppLoadingScreen'
import type { AdminWorkspace } from './workspace'
import { AdminSessionProvider } from './session'
import { StepUpProvider } from './shared/StepUp'
import { canAccessWorkspace, firstAccessibleWorkspace, workspacePath } from './access'
import { Navigate } from './lib/routing'
import { useInRouterContext } from './lib/routing'
import { SpotlightProvider } from './spotlight'
import styles from './AdminEntry.module.css'

// Section pages are split into per-workspace chunks so that admins who only
// ever open one section (e.g. a user manager who never opens the visual
// editor) don't pay to download the others. Each `lazy(...)` becomes its own
// rolldown chunk; named-export → default-export adapter keeps the page files
// using their existing named exports (which the rest of the codebase imports).
//
// Side-effect imports for `@modules/base` and `@core/loops/sources` live
// inside `SitePage.tsx` so they only load when the visual editor mounts —
// they're not used by Users / Content / Plugins / Account.
const SitePage = lazy(() =>
  import('./pages/site/SitePage').then((m) => ({ default: m.SitePage })),
)
const ContentPage = lazy(() =>
  import('./pages/content/ContentPage').then((m) => ({ default: m.ContentPage })),
)
const MediaPage = lazy(() =>
  import('./pages/media/MediaPage').then((m) => ({ default: m.MediaPage })),
)
const PluginsPage = lazy(() =>
  import('./pages/plugins/PluginsPage').then((m) => ({ default: m.PluginsPage })),
)
const PluginPage = lazy(() =>
  import('./pages/plugins/PluginPage').then((m) => ({ default: m.PluginPage })),
)
const UsersPage = lazy(() =>
  import('./pages/users/UsersPage').then((m) => ({ default: m.UsersPage })),
)
const AccountPage = lazy(() =>
  import('./pages/account/AccountPage').then((m) => ({ default: m.AccountPage })),
)
const DataPage = lazy(() =>
  import('./pages/data/DataPage').then((m) => ({ default: m.DataPage })),
)

type AdminPhase = 'loading' | 'setup' | 'login' | 'mfa' | 'editor'
type AdminSection = AdminWorkspace

interface AdminEntryProps {
  section?: AdminSection
}

export default function AdminEntry({ section = 'site' }: AdminEntryProps) {
  const [phase, setPhase] = useState<AdminPhase>('loading')
  const [siteName, setSiteName] = useState('My Site')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<CmsCurrentUser | null>(null)
  // Operator-provided site identity (logo + name) shown on the unauthenticated
  // login / setup / MFA screens. Falls back to `{ null, null }` when the
  // install hasn't picked a favicon — the brand row then renders the default
  // DatabaseSolidIcon + "Page Builder CMS" text.
  const [publicSite, setPublicSite] = useState<CmsPublicSite>({ name: null, faviconUrl: null })
  const siteNameId = useId()
  const emailId = useId()
  const passwordId = useId()
  const mfaCodeId = useId()

  useEffect(() => {
    let cancelled = false

    async function loadAdminState() {
      // Site identity (logo + name) is rendered on every pre-auth phase.
      // Fetched in parallel with setup status / current-user so the brand
      // row hydrates as soon as the network resolves — never blocks login.
      void getCmsPublicSite()
        .then((next) => {
          if (!cancelled) setPublicSite(next)
        })
        .catch(() => {
          // Brand row falls back to the default mark on failure.
        })

      try {
        const status = await getCmsSetupStatus()
        if (cancelled) return

        if (status.needsSetup) {
          setPhase('setup')
          return
        }

        try {
          const user = await getCurrentCmsUser()
          if (!cancelled) {
            setCurrentUser(user)
            setPhase('editor')
          }
        } catch (_err) {
          // No active admin session; show the login form.
          if (!cancelled) {
            setCurrentUser(null)
            setPhase('login')
          }
        }
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
      setCurrentUser(await getCurrentCmsUser())
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
      const result = await loginCms({ email, password })
      if (result.mfaRequired) {
        setPassword('')
        setMfaCode('')
        setPhase('mfa')
        return
      }
      setCurrentUser(await getCurrentCmsUser())
      setPhase('editor')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleMfaVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await verifyCmsMfa({ code: mfaCode })
      setCurrentUser(await getCurrentCmsUser())
      setMfaCode('')
      setPhase('editor')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'MFA verification failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (phase === 'loading') return <AppLoadingScreen />
  if (phase === 'editor') {
    if (!currentUser) return <AppLoadingScreen />
    return <AuthenticatedAdmin section={section} currentUser={currentUser} />
  }

  const isSetup = phase === 'setup'
  const isMfa = phase === 'mfa'
  const title = isSetup ? 'Set Up CMS' : isMfa ? 'Two-Factor Authentication' : 'Admin Login'
  const submitLabel =
    submitting ? (isSetup ? 'Setting up' : isMfa ? 'Verifying' : 'Signing in') :
    isSetup ? 'Create Admin' :
    isMfa ? 'Verify' :
    'Sign In'

  // Pre-auth brand row: when the install has picked a favicon, render it
  // in place of the default icon AND swap the "Page Builder CMS" label for
  // the operator-configured site name. When neither is set, keep the
  // default mark + product name so a fresh clone still looks like itself.
  const brandLabel = publicSite.name ?? 'Page Builder CMS'

  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="admin-entry-title">
        <div className={styles.brandRow}>
          {publicSite.faviconUrl ? (
            <img
              className={styles.brandFavicon}
              src={publicSite.faviconUrl}
              alt=""
              aria-hidden="true"
              draggable={false}
            />
          ) : (
            <div className={styles.brandIcon} aria-hidden="true">
              <DatabaseSolidIcon size={16} />
            </div>
          )}
          <span>{brandLabel}</span>
        </div>

        <h1 id="admin-entry-title" className={styles.title}>{title}</h1>

        <form
          className={styles.form}
          onSubmit={isSetup ? handleSetup : isMfa ? handleMfaVerify : handleLogin}
        >
          {isMfa ? (
            <label className={styles.field} htmlFor={mfaCodeId}>
              <span>Authentication code</span>
              <Input
                id={mfaCodeId}
                value={mfaCode}
                onChange={(event) => setMfaCode(event.target.value)}
                required
                inputMode="numeric"
                autoComplete="one-time-code"
                data-testid="admin-mfa-code"
              />
            </label>
          ) : isSetup && (
            <label className={styles.field} htmlFor={siteNameId}>
              <span>Site name</span>
              <Input
                id={siteNameId}
                value={siteName}
                onChange={(event) => setSiteName(event.target.value)}
                required
                autoComplete="organization"
              />
            </label>
          )}

          {!isMfa && (
            <>
              <label className={styles.field} htmlFor={emailId}>
                <span>Email</span>
                <Input
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
                <Input
                  id={passwordId}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={isSetup ? 12 : undefined}
                  type="password"
                  autoComplete={isSetup ? 'new-password' : 'current-password'}
                />
              </label>
            </>
          )}

          {error && (
            <p role="alert" className={styles.error}>
              {error}
            </p>
          )}

          <Button
            variant="primary"
            size="md"
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

function AuthenticatedAdmin({
  section,
  currentUser,
}: {
  section: AdminSection
  currentUser: CmsCurrentUser
}) {
  const inRouter = useInRouterContext()
  const fallbackWorkspace = firstAccessibleWorkspace(currentUser)

  if (!canAccessWorkspace(currentUser, section)) {
    if (inRouter && fallbackWorkspace) {
      return <Navigate to={workspacePath(fallbackWorkspace)} replace />
    }
    return (
      <main className={styles.page}>
        <section className={styles.panel} role="alert">
          <h1 className={styles.title}>Access unavailable</h1>
          <p className={styles.error}>Your role does not include access to this admin section.</p>
        </section>
      </main>
    )
  }

  return (
    <AdminSessionProvider user={currentUser}>
      {/* StepUpProvider wraps SpotlightProvider so spotlight commands can
          consume `useStepUp()` — required by step-up-gated actions invoked
          from the palette (e.g. `editor.publish`). Both providers stay
          inside AdminSessionProvider (the palette's CommandContext reads
          the authenticated user) and above the workspace switch so the
          palette and the step-up dialog are available across every
          workspace. */}
      <StepUpProvider>
        <SpotlightProvider>
          <Suspense fallback={<AppLoadingScreen />}>
            {section === 'content' ? <ContentPage /> :
              section === 'data' ? <DataPage /> :
              section === 'media' ? <MediaPage /> :
              section === 'plugins' ? <PluginsPage /> :
              section === 'users' ? <UsersPage /> :
              section === 'pluginPage' ? <PluginPage /> :
              section === 'account' ? <AccountPage /> :
              <SitePage />}
          </Suspense>
        </SpotlightProvider>
      </StepUpProvider>
    </AdminSessionProvider>
  )
}
