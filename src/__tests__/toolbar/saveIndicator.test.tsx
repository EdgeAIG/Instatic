import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { SaveIndicator } from '../../editor/components/Toolbar/SaveIndicator'
import { EDITOR_PREFS_KEY } from '../../editor/preferences/editorPreferences'
import { useEditorStore } from '../../core/editor-store/store'
import { makeProject } from '../fixtures'

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    project: makeProject(),
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)
afterEach(cleanup)

describe('SaveIndicator — manual save mode', () => {
  it('uses the primary button variant for manual Save', () => {
    const { readFileSync } = require('fs')
    const src = readFileSync(
      new URL('../../editor/components/Toolbar/SaveIndicator.tsx', import.meta.url),
      'utf-8',
    )

    expect(src).toContain('variant="primary"')
  })

  it('renders a Save button instead of the unsaved-changes label when auto-save is disabled', () => {
    localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify({ autoSave: false }))
    useEditorStore.setState({ hasUnsavedChanges: true } as Parameters<typeof useEditorStore.setState>[0])

    render(<SaveIndicator onSave={() => {}} />)

    expect(screen.getByRole('button', { name: /save project/i })).toBeDefined()
    expect(screen.queryByText('Unsaved changes')).toBeNull()
  })

  it('runs the manual save action from the Save button', async () => {
    localStorage.setItem(EDITOR_PREFS_KEY, JSON.stringify({ autoSave: false }))
    useEditorStore.setState({ hasUnsavedChanges: true } as Parameters<typeof useEditorStore.setState>[0])
    let saveCalls = 0

    render(
      <SaveIndicator
        onSave={async () => {
          saveCalls += 1
          useEditorStore.getState().setHasUnsavedChanges(false)
        }}
      />,
    )

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save project/i }))
    })

    expect(saveCalls).toBe(1)
    expect(screen.getByTestId('save-indicator').textContent).toContain('Saved')
  })
})
