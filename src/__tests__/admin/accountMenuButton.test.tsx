/**
 * AccountMenuButton — toolbar avatar dropdown.
 *
 * Verifies:
 *   - Renders nothing when there's no session user (defensive — admin shell
 *     may not have hydrated).
 *   - Trigger displays initials derived from displayName, falling back to
 *     email when displayName is empty.
 *   - Opening the menu shows the user's display name, email, and role label.
 *   - "Sign out" calls the logout endpoint and navigates to /admin.
 *   - "Sign out all devices" calls the logout-all endpoint and shows a
 *     status message; the menu does NOT close (we want the user to see the
 *     confirmation before they dismiss).
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { AccountMenuButton } from '@admin/shared/AccountMenuButton'
import { AdminSessionProvider } from '@admin/session'
import { StepUpProvider } from '@admin/shared/StepUp'
import { MemoryRouter, Route, Routes, useLocation } from '@admin/lib/routing'
import type { CmsCurrentUser } from '@core/persistence'

const now = '2026-05-09T10:00:00.000Z'
const originalFetch = globalThis.fetch
const originalLocation = window.location

function makeUser(overrides: Partial<CmsCurrentUser> = {}): CmsCurrentUser {
  return {
    id: 'owner_1',
    email: 'owner@example.com',
    displayName: 'Olivia Owner',
    status: 'active',
    role: {
      id: 'owner',
      slug: 'owner',
      name: 'Owner',
      description: '',
      isSystem: true,
      capabilities: ['site.read'],
    },
    capabilities: ['site.read'],
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    avatarMediaId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Render the menu inside the same provider stack as production: a router
 * (admin shell is always router-mounted) and a session provider (the menu
 * uses `useAuthenticatedAdminUser`, which throws outside it).
 */
function renderWithUser(user: CmsCurrentUser) {
  return render(
    <MemoryRouter initialEntries={['/admin/site']}>
      <AdminSessionProvider user={user}>
        <StepUpProvider>
          <AccountMenuButton />
        </StepUpProvider>
      </AdminSessionProvider>
    </MemoryRouter>,
  )
}

describe('AccountMenuButton', () => {
  beforeEach(() => {
    // Replace location.assign with a stub so the redirect on sign-out doesn't
    // attempt to navigate the test runner away.
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: { ...originalLocation, assign: mock(() => {}) },
    })
  })

  afterEach(() => {
    cleanup()
    globalThis.fetch = originalFetch
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
  })

  it('uses the first letter of the display name for the initials', () => {
    renderWithUser(makeUser({ displayName: 'Alice Admin' }))
    const trigger = screen.getByTestId('account-menu-trigger')
    expect(trigger.textContent?.trim()).toBe('A')
    expect(trigger.getAttribute('aria-label')).toContain('Alice Admin')
  })

  it('falls back to the email when displayName is empty', () => {
    renderWithUser(makeUser({ displayName: '', email: 'me@example.com' }))
    const trigger = screen.getByTestId('account-menu-trigger')
    expect(trigger.textContent?.trim()).toBe('M')
  })

  it('opens a dropdown with the user header and the three actions', () => {
    renderWithUser(makeUser())
    fireEvent.click(screen.getByTestId('account-menu-trigger'))

    expect(screen.getByText('Olivia Owner')).toBeTruthy()
    expect(screen.getByText('owner@example.com')).toBeTruthy()
    expect(screen.getByText('Owner')).toBeTruthy()
    expect(screen.getByTestId('account-menu-go-to-account')).toBeTruthy()
    expect(screen.getByTestId('account-menu-sign-out')).toBeTruthy()
    expect(screen.getByTestId('account-menu-sign-out-all')).toBeTruthy()
  })

  it('calls /logout and navigates to /admin on sign out', async () => {
    let logoutCalled = false
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/admin/api/cms/logout')) {
        logoutCalled = true
        return jsonResponse({ ok: true })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch
    const assignSpy = window.location.assign as ReturnType<typeof mock>

    renderWithUser(makeUser())
    fireEvent.click(screen.getByTestId('account-menu-trigger'))
    fireEvent.click(screen.getByTestId('account-menu-sign-out'))

    await waitFor(() => {
      expect(logoutCalled).toBe(true)
    })
    await waitFor(() => {
      expect(assignSpy).toHaveBeenCalledWith('/admin')
    })
  })

  it('calls /logout-all and surfaces the revoked count in the menu', async () => {
    globalThis.fetch = mock(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.endsWith('/admin/api/cms/auth/logout-all')) {
        return jsonResponse({ ok: true, revokedCount: 3 })
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    renderWithUser(makeUser())
    fireEvent.click(screen.getByTestId('account-menu-trigger'))
    fireEvent.click(screen.getByTestId('account-menu-sign-out-all'))

    await waitFor(() => {
      expect(screen.getByText('Signed out 3 devices.')).toBeTruthy()
    })
  })

  it('shows a friendly status when no other devices were signed in', async () => {
    globalThis.fetch = mock(async () => jsonResponse({ ok: true, revokedCount: 0 })) as typeof fetch

    renderWithUser(makeUser())
    fireEvent.click(screen.getByTestId('account-menu-trigger'))
    fireEvent.click(screen.getByTestId('account-menu-sign-out-all'))

    await waitFor(() => {
      expect(screen.getByText('No other devices were signed in.')).toBeTruthy()
    })
  })

  it('"Account & security" navigates to /admin/account via the router', async () => {
    // Soft navigation keeps the editor store alive (so the toolbar's site
    // name persists) and runs the View Transitions fade. Hard navigation
    // would reboot the React app and is reserved for sign-out.
    const assignSpy = window.location.assign as ReturnType<typeof mock>
    let observedPathname = ''
    function PathProbe() {
      observedPathname = useLocation().pathname
      return null
    }

    render(
      <MemoryRouter initialEntries={['/admin/site']}>
        <AdminSessionProvider user={makeUser()}>
          <StepUpProvider>
            <AccountMenuButton />
            <Routes>
              <Route path="/admin/site" element={<PathProbe />} />
              <Route path="/admin/account" element={<PathProbe />} />
            </Routes>
          </StepUpProvider>
        </AdminSessionProvider>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByTestId('account-menu-trigger'))
    fireEvent.click(screen.getByTestId('account-menu-go-to-account'))

    await waitFor(() => {
      expect(observedPathname).toBe('/admin/account')
    })
    expect(assignSpy).not.toHaveBeenCalled()
  })

  it('renders the error message in role="alert" when logout-all fails', async () => {
    globalThis.fetch = mock(async () => jsonResponse({ error: 'kaboom' }, 500)) as typeof fetch

    renderWithUser(makeUser())
    fireEvent.click(screen.getByTestId('account-menu-trigger'))
    fireEvent.click(screen.getByTestId('account-menu-sign-out-all'))

    await waitFor(() => {
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain('kaboom')
    })
  })
})
