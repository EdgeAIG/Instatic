import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CodeEditorPanel } from '@site/code-editor'
import { useEditorStore } from '@site/store/store'
import { makePage, makeSite } from '../fixtures'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime'

afterEach(cleanup)

function resetStore() {
  const home = makePage({ id: 'page-home', title: 'Home', slug: 'index' })
  const about = makePage({ id: 'page-about', title: 'About', slug: 'about' })
  const runtime = normalizeSiteRuntimeConfig(undefined)

  useEditorStore.setState({
    site: makeSite({
      pages: [home, about],
      runtime,
      files: [{
        id: 'style-1',
        path: 'src/styles/theme.css',
        type: 'style',
        content: '.brand { color: red }',
        createdAt: 1,
        updatedAt: 1,
      }],
    }),
    siteRuntime: runtime,
    activePageId: 'page-home',
    activeEditorFileId: 'style-1',
    activeMediaAssetPreview: null,
    codeEditorPanelOpen: true,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

describe('Stylesheet settings pane', () => {
  it('renders next to active stylesheet files and updates runtime config', () => {
    render(<CodeEditorPanel />)

    expect(screen.getByLabelText('Stylesheet settings')).toBeDefined()
    expect(screen.getByText('Stylesheet')).toBeDefined()

    // Enable toggle starts On (default) → click turns it Off.
    fireEvent.click(screen.getByRole('button', { name: 'Stylesheet enabled' }))
    expect(useEditorStore.getState().siteRuntime.styles['style-1'].enabled).toBe(false)

    // Scope → Specific pages, then pick the two pages.
    fireEvent.change(screen.getByRole('combobox', { name: 'Stylesheet scope' }), {
      target: { value: 'pages' },
    })
    expect(useEditorStore.getState().siteRuntime.styles['style-1'].scope).toEqual({
      type: 'pages',
      pageIds: [],
    })

    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    expect(useEditorStore.getState().siteRuntime.styles['style-1'].scope).toEqual({
      type: 'pages',
      pageIds: ['page-about'],
    })

    fireEvent.change(screen.getByLabelText('Stylesheet priority'), {
      target: { value: '5' },
    })
    expect(useEditorStore.getState().siteRuntime.styles['style-1'].priority).toBe(5)
  })

  it('does not render the script runtime pane for stylesheets', () => {
    render(<CodeEditorPanel />)
    expect(screen.queryByLabelText('Script runtime settings')).toBeNull()
  })
})
