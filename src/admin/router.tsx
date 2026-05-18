import { lazy, Suspense } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Navigate, Route, Routes } from './lib/routing'
import { useLocation } from './lib/routing'
import { ErrorBoundary } from '@ui/components/ErrorBoundary'
import { AppLoadingScreen } from './AppLoadingScreen'

const AdminEntry = lazy(() => import('./AdminEntry'))

function withSuspense(element: ReactElement): ReactElement {
  return <Suspense fallback={<AppLoadingScreen />}>{element}</Suspense>
}

/**
 * Per-route error boundary. Resets when the pathname changes so navigating
 * away from a broken route automatically clears the failure state — the user
 * never gets "stuck" on an error page just because they tried to come back.
 *
 * Location tag intentionally collapses to "admin-route" rather than embedding
 * the path: the architecture gate requires unique location strings per
 * placement, and we want a single boundary tag that covers every section.
 * The active pathname is surfaced via the toast body and the dev fallback.
 */
function RouteBoundary({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary location="admin-route" resetKeys={[pathname]}>
      {children}
    </ErrorBoundary>
  )
}

function withRouteBoundary(element: ReactElement): ReactElement {
  return <RouteBoundary>{withSuspense(element)}</RouteBoundary>
}

export function AdminRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin/site" replace />} />
      <Route path="/admin" element={<Navigate to="/admin/site" replace />} />
      <Route path="/admin/site" element={withRouteBoundary(<AdminEntry section="site" />)} />
      <Route path="/admin/content" element={withRouteBoundary(<AdminEntry section="content" />)} />
      <Route path="/admin/data" element={withRouteBoundary(<AdminEntry section="data" />)} />
      <Route path="/admin/media" element={withRouteBoundary(<AdminEntry section="media" />)} />
      <Route path="/admin/plugins" element={withRouteBoundary(<AdminEntry section="plugins" />)} />
      <Route path="/admin/users" element={withRouteBoundary(<AdminEntry section="users" />)} />
      <Route path="/admin/account" element={withRouteBoundary(<AdminEntry section="account" />)} />
      <Route
        path="/admin/plugins/:pluginId/:pageId"
        element={withRouteBoundary(<AdminEntry section="pluginPage" />)}
      />
    </Routes>
  )
}
