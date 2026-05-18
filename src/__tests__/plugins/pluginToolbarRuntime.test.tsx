import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React, { type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from '@admin/lib/routing'
import { Toolbar } from '@site/toolbar'
import { AdminSessionProvider } from '@admin/session'
import { StepUpProvider } from '@admin/shared/StepUp'
import { pluginRuntime } from '@core/plugins/runtime'
import { useEditorStore } from '@site/store/store'
import type { CmsCurrentUser } from '@core/persistence'
import { makeSite } from '../fixtures'

const now = '2026-05-07T10:00:00.000Z'

function adminUser(): CmsCurrentUser {
  return {
    id: 'toolbar-user',
    email: 'admin@example.com',
    displayName: 'Toolbar User',
    status: 'active',
    role: {
      id: 'admin',
      slug: 'admin',
      name: 'Admin',
      description: '',
      isSystem: true,
      capabilities: ['site.read', 'site.structure.edit','site.content.edit','site.style.edit'],
    },
    capabilities: ['site.read', 'site.structure.edit','site.content.edit','site.style.edit'],
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
      <AdminSessionProvider user={adminUser()}>
        <StepUpProvider>{children}</StepUpProvider>
      </AdminSessionProvider>
    </MemoryRouter>
  )
}

beforeEach(() => {
  const site = makeSite({ name: 'Runtime Site' })
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
  pluginRuntime.reset()
})

afterEach(() => {
  pluginRuntime.reset()
  cleanup()
})

describe('Toolbar plugin runtime buttons', () => {
  it('renders plugin-registered toolbar buttons and runs their commands', async () => {
    let ran = false
    pluginRuntime.registerCommand('acme.workflow', {
      id: 'workflow.approve',
      label: 'Approve Page',
      run: () => { ran = true },
    })
    pluginRuntime.registerToolbarButton('acme.workflow', {
      id: 'workflow.approve',
      label: 'Approve',
      command: 'workflow.approve',
    })

    render(
      <Wrapper>
        <Toolbar rightSlot={<span>right</span>} />
      </Wrapper>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => {
      expect(ran).toBe(true)
    })
  })

  it('shows plugin command completion feedback in the toolbar', async () => {
    pluginRuntime.registerCommand('acme.workflow', {
      id: 'workflow.requestApproval',
      label: 'Request Approval',
      run: () => ({ message: 'Approval request created for Home' }),
    })
    pluginRuntime.registerToolbarButton('acme.workflow', {
      id: 'workflow.requestApproval',
      label: 'Request Approval',
      command: 'workflow.requestApproval',
    })

    render(
      <Wrapper>
        <Toolbar rightSlot={<span>right</span>} />
      </Wrapper>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Request Approval' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Approval request created for Home')
    })
  })
})
