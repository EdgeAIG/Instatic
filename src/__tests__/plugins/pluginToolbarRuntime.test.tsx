import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Toolbar } from '../../editor/components/Toolbar'
import { pluginRuntime } from '../../core/extensions/runtime'
import { useEditorStore } from '../../core/editor-store/store'
import { makeSite } from '../fixtures'

beforeEach(() => {
  const site = makeSite({ name: 'Runtime Site' })
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
    selectedNodeId: null,
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

    render(<Toolbar rightSlot={<span>right</span>} />)

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

    render(<Toolbar rightSlot={<span>right</span>} />)

    fireEvent.click(screen.getByRole('button', { name: 'Request Approval' }))

    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toBe('Approval request created for Home')
    })
  })
})
