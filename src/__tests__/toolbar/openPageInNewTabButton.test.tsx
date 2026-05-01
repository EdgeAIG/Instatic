import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Toolbar } from '../../editor/components/Toolbar'
import { useEditorStore } from '../../core/editor-store/store'
import { makePage, makeSite } from '../fixtures'

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
    hoveredNodeId: null,
    hasUnsavedChanges: false,
    previewOpen: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

describe('OpenPageInNewTabButton', () => {
  it('opens the active page in a new tab from the toolbar button before Preview', () => {
    const originalOpen = window.open
    const openCalls: unknown[] = []
    window.open = ((...args: unknown[]) => {
      openCalls.push(args)
      return null
    }) as typeof window.open

    try {
      render(<Toolbar />)

      const toolbar = screen.getByTestId('toolbar')
      const buttons = within(toolbar).getAllByRole('button')
      const openButton = within(toolbar).getByRole('button', { name: /open page in new tab/i })
      const previewButton = within(toolbar).getByRole('button', { name: /preview page/i })

      expect(buttons.indexOf(openButton)).toBe(buttons.indexOf(previewButton) - 1)

      fireEvent.click(openButton)

      expect(openCalls).toEqual([['/pricing', '_blank', 'noopener,noreferrer']])
    } finally {
      window.open = originalOpen
    }
  })
})
