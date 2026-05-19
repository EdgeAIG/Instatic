import { lazy, Suspense, useState } from 'react'
import type { CmsCurrentUser } from '@core/persistence'
import { AppLoadingScreen } from './AppLoadingScreen'
import type { AdminWorkspace } from './workspace'
import { AdminSessionProvider } from './session'
import { StepUpProvider } from './shared/StepUp'
import { canAccessWorkspace, firstAccessibleWorkspace, workspacePath } from './access'
import { Navigate, useInRouterContext } from './lib/routing'
import { SpotlightRoot } from './spotlight'
import { AdminPreAuthForm, type PreAuthPhase } from './preauth/AdminPreAuthForm'
import { useAdminBoot } from './preauth/useAdminBoot'
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
const DashboardPage = lazy(() =>
  import('./pages/dashboard/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
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

type AdminSection = AdminWorkspace

// After boot, the pre-auth form can lift us into MFA or into the editor.
// `null` means "follow whatever the boot hook resolved to" — the form has
// not produced a transition yet.
type PreAuthOverride =
  | { phase: PreAuthPhase }
  | { phase: 'editor'; user: CmsCurrentUser }

interface AdminEntryProps {
  section?: AdminSection
}

export default function AdminEntry({ section = 'dashboard' }: AdminEntryProps) {
  const boot = useAdminBoot()
  const [override, setOverride] = useState<PreAuthOverride | null>(null)

  if (boot.status === 'loading') return <AppLoadingScreen />

  const livePhase = override?.phase ?? boot.phase
  const liveUser =
    override?.phase === 'editor' ? override.user : boot.currentUser

  if (livePhase === 'editor') {
    if (!liveUser) return <AppLoadingScreen />
    return <AuthenticatedAdmin section={section} currentUser={liveUser} />
  }

  return (
    <AdminPreAuthForm
      phase={livePhase}
      publicSite={boot.publicSite}
      initialError={boot.initialError}
      onPhaseChange={(phase) => setOverride({ phase })}
      onAuthenticated={(user) => setOverride({ phase: 'editor', user })}
    />
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
      {/* StepUpProvider wraps SpotlightRoot so spotlight commands can
          consume `useStepUp()` — required by step-up-gated actions invoked
          from the palette (e.g. `editor.publish`). Both providers stay
          inside AdminSessionProvider (the palette's CommandContext reads
          the authenticated user) and above the workspace switch so the
          palette and the step-up dialog are available across every
          workspace. */}
      <StepUpProvider>
        <SpotlightRoot>
          <Suspense fallback={<AppLoadingScreen />}>
            {section === 'dashboard' ? <DashboardPage /> :
              section === 'site' ? <SitePage /> :
              section === 'content' ? <ContentPage /> :
              section === 'data' ? <DataPage /> :
              section === 'media' ? <MediaPage /> :
              section === 'plugins' ? <PluginsPage /> :
              section === 'users' ? <UsersPage /> :
              section === 'pluginPage' ? <PluginPage /> :
              section === 'account' ? <AccountPage /> :
              <DashboardPage />}
          </Suspense>
        </SpotlightRoot>
      </StepUpProvider>
    </AdminSessionProvider>
  )
}
