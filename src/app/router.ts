import { createElement, lazy, Suspense } from 'react'
import type { ReactElement } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLoadingScreen } from './AppLoadingScreen'

const AdminEntry = lazy(() => import('./AdminEntry'))

function withSuspense(element: ReactElement) {
  return createElement(
    Suspense,
    { fallback: createElement(AppLoadingScreen) },
    element,
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: createElement(Navigate, { to: '/admin/site', replace: true }),
  },
  {
    path: '/admin',
    element: createElement(Navigate, { to: '/admin/site', replace: true }),
  },
  {
    path: '/admin/site',
    element: withSuspense(createElement(AdminEntry, { section: 'site' })),
  },
  {
    path: '/admin/content',
    element: withSuspense(createElement(AdminEntry, { section: 'content' })),
  },
  {
    path: '/admin/plugins',
    element: withSuspense(createElement(AdminEntry, { section: 'plugins' })),
  },
  {
    path: '/admin/plugins/:pluginId/:pageId',
    element: withSuspense(createElement(AdminEntry, { section: 'pluginPage' })),
  },
])
