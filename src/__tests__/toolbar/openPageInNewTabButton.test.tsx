import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React, { type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { Toolbar } from '@site/toolbar'
import { AdminSessionProvider } from '@admin/session'
import { StepUpProvider } from '@admin/shared/StepUp'
import { useEditorStore } from '@site/store/store'
import type { CmsCurrentUser } from '@core/persistence'
import { makePage, makeSite } from '../fixtures'

const now = '2026-05-07T10:00:00.000Z'

function toolbarUser(): CmsCurrentUser {
  return {
    id: 'toolbar-user',
    email: 'admin@example.com',
    displayName: 'Admin',
    status: 'active',
    role: {
      id: 'admin',
      slug: 'admin',
      name: 'Admin',
      description: '',
      isSystem: true,
      capabilities: ['site.read', 'site.structure.edit','site.content.edit','site.style.edit', 'pages.edit', 'pages.publish'],
    },
    capabilities: ['site.read', 'site.structure.edit','site.content.edit','site.style.edit', 'pages.edit', 'pages.publish'],
    lastLoginAt: null,
    failedLoginCount: 0,
    lockedUntil: null,
    passwordUpdatedAt: null,
    mfaEnabled: false,
    mfaEnabledAt: null,
    mfaRecoveryCodesRemaining: 0,
    avatarMediaId: null,
    avatarUrl: null,
    gravatarHash: '',
    createdAt: now,
    updatedAt: now,
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <AdminSessionProvider user={toolbarUser()}>
        <StepUpProvider>{children}</StepUpProvider>
      </AdminSessionProvider>
    </MemoryRouter>
  )
}

let originalFetch: typeof fetch

beforeEach(() => {
  localStorage.clear()
  originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ draftMatchesPublished: false }), { status: 200 })) as typeof fetch
  const home = makePage({ id: 'page-home', title: 'Home', slug: 'index' })
  const pricing = makePage({ id: 'page-pricing', title: 'Pricing', slug: 'pricing' })
  useEditorStore.setState({
    site: makeSite({ pages: [home, pricing] }),
    activePageId: 'page-pricing',
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    hasUnsavedChanges: false,
    previewOpen: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

describe('Toolbar publishing actions', () => {
  it('opens the active page in a new tab from the publishing actions menu', () => {
    const originalOpen = window.open
    const openCalls: unknown[] = []
    window.open = ((...args: unknown[]) => {
      openCalls.push(args)
      return null
    }) as typeof window.open

    try {
      render(<Wrapper><Toolbar /></Wrapper>)

      const toolbar = screen.getByTestId('toolbar')
      fireEvent.click(within(toolbar).getByRole('button', { name: /more publishing actions/i }))
      const menu = screen.getByRole('menu', { name: /publishing actions/i })
      const openButton = within(menu).getByRole('menuitem', { name: /open live page/i })

      fireEvent.click(openButton)

      expect(openCalls).toEqual([['/pricing', '_blank', 'noopener,noreferrer']])
    } finally {
      window.open = originalOpen
    }
  })
})
