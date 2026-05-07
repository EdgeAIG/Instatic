/**
 * VCBreadcrumb — integration tests
 *
 * Tests the breadcrumb component rendered in VC edit mode:
 *   1. Renders null when activeDocument is not a VC
 *   2. Renders breadcrumb chips + back button when in VC mode
 *   3. Back button calls exitVisualComponentMode
 *   4. Clicking the name chip enters edit mode
 *   5. Renaming with an invalid name shows role="alert"
 *   6. Renaming with a valid name calls renameVisualComponent + updates display
 *   7. Pressing Escape reverts the name
 *
 * Uses @testing-library/react with happy-dom (preloaded via bunfig.toml).
 * Architecture source: Phase 4 Layer 3 (Task #A2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { useEditorStore } from '@core/editor-store/store'
import VCBreadcrumb from '../../editor/components/Toolbar/VCBreadcrumb'

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    previousActivePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

// ---------------------------------------------------------------------------
// Fixture: site with one page and one VC
// ---------------------------------------------------------------------------

function setupVCMode(): { vcId: string; pageId: string } {
  const store = useEditorStore.getState()
  const site = store.createSite('Test Site')
  const pageId = site.pages[0].id
  useEditorStore.setState({ activePageId: pageId })

  const vcId = store.createVisualComponent('HeroSection')

  act(() => {
    useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId })
  })

  return { vcId, pageId }
}

beforeEach(resetStore)
afterEach(cleanup)

// ---------------------------------------------------------------------------
// 1 — Renders null when not in VC mode
// ---------------------------------------------------------------------------

describe('VCBreadcrumb — renders null when not in VC mode', () => {
  it('returns nothing when activeDocument is null', () => {
    render(<VCBreadcrumb />)
    expect(screen.queryByTestId('vc-breadcrumb')).toBeNull()
  })

  it('returns nothing when activeDocument.kind is "page"', () => {
    const store = useEditorStore.getState()
    store.createSite('Test Site')
    const pageId = useEditorStore.getState().site!.pages[0].id
    act(() => {
      useEditorStore.getState().setActiveDocument({ kind: 'page', pageId })
    })
    render(<VCBreadcrumb />)
    expect(screen.queryByTestId('vc-breadcrumb')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2 — Renders breadcrumb when in VC mode
// ---------------------------------------------------------------------------

describe('VCBreadcrumb — renders in VC mode', () => {
  it('renders the breadcrumb container', () => {
    setupVCMode()
    render(<VCBreadcrumb />)
    expect(screen.getByTestId('vc-breadcrumb')).toBeDefined()
  })

  it('renders the back button', () => {
    setupVCMode()
    render(<VCBreadcrumb />)
    expect(screen.getByTestId('vc-breadcrumb-back')).toBeDefined()
  })

  it('renders the VC name chip', () => {
    setupVCMode()
    render(<VCBreadcrumb />)
    const nameChip = screen.getByTestId('vc-breadcrumb-name')
    expect(nameChip.textContent).toBe('HeroSection')
  })

  it('renders the static breadcrumb chips: Site and Components', () => {
    setupVCMode()
    render(<VCBreadcrumb />)
    // Check text content of the rendered breadcrumb
    const breadcrumb = screen.getByTestId('vc-breadcrumb')
    expect(breadcrumb.textContent).toContain('Site')
    expect(breadcrumb.textContent).toContain('Components')
    expect(breadcrumb.textContent).toContain('HeroSection')
  })
})

// ---------------------------------------------------------------------------
// 3 — Back button calls exitVisualComponentMode
// ---------------------------------------------------------------------------

describe('VCBreadcrumb — back button', () => {
  it('calls exitVisualComponentMode when back button is clicked', () => {
    const { pageId } = setupVCMode()
    render(<VCBreadcrumb />)

    act(() => {
      fireEvent.click(screen.getByTestId('vc-breadcrumb-back'))
    })

    const s = useEditorStore.getState()
    expect(s.activeDocument).toBeNull()
    // Should restore the page
    expect(s.activePageId).toBe(pageId)
  })
})

// ---------------------------------------------------------------------------
// 4 — Name chip entering edit mode
// ---------------------------------------------------------------------------

describe('VCBreadcrumb — inline name editing', () => {
  it('clicking the name chip shows an input', () => {
    setupVCMode()
    render(<VCBreadcrumb />)

    act(() => {
      fireEvent.click(screen.getByTestId('vc-breadcrumb-name'))
    })

    expect(screen.getByTestId('vc-breadcrumb-name-input')).toBeDefined()
  })

  it('the input is pre-filled with the current VC name', () => {
    setupVCMode()
    render(<VCBreadcrumb />)

    act(() => {
      fireEvent.click(screen.getByTestId('vc-breadcrumb-name'))
    })

    const input = screen.getByTestId('vc-breadcrumb-name-input') as HTMLInputElement
    expect(input.value).toBe('HeroSection')
  })

  // ---------------------------------------------------------------------------
  // 5 — Invalid rename shows role="alert"
  // ---------------------------------------------------------------------------

  it('shows role="alert" when invalid name is submitted (duplicate name)', () => {
    const { vcId } = setupVCMode()

    // Add a second VC so we can trigger PROJECT_DUPLICATE on rename
    act(() => {
      useEditorStore.setState((s) => {
        const site = s.site!
        const otherVC = {
          id: 'vc-other',
          name: 'TakenName',
          tree: {
            rootNodeId: 'r',
            nodes: { r: { id: 'r', moduleId: 'base.body', props: {}, children: [], breakpointOverrides: {}, classIds: [] } },
          },
          params: [],
          breakpoints: [],
          classIds: [],
          createdAt: 1,
        }
        return {
          site: {
            ...site,
            visualComponents: [
              ...(site.visualComponents ?? []),
              otherVC,
            ],
          },
        } as Parameters<typeof useEditorStore.setState>[0]
      })
    })
    expect(vcId).toBeDefined()

    render(<VCBreadcrumb />)

    act(() => {
      fireEvent.click(screen.getByTestId('vc-breadcrumb-name'))
    })

    const input = screen.getByTestId('vc-breadcrumb-name-input') as HTMLInputElement

    act(() => {
      fireEvent.change(input, { target: { value: 'TakenName' } })
      fireEvent.blur(input)
    })

    const alert = screen.getByRole('alert')
    expect(alert).toBeDefined()
    expect(alert.textContent).toContain('TakenName')
  })

  it('accepts a name with spaces (free-form)', () => {
    const { vcId } = setupVCMode()
    render(<VCBreadcrumb />)

    act(() => {
      fireEvent.click(screen.getByTestId('vc-breadcrumb-name'))
    })

    const input = screen.getByTestId('vc-breadcrumb-name-input') as HTMLInputElement

    act(() => {
      fireEvent.change(input, { target: { value: 'Hero Section' } })
      fireEvent.blur(input)
    })

    // Spaces are valid → rename committed and input dismissed
    expect(screen.queryByTestId('vc-breadcrumb-name-input')).toBeNull()
    const vc = useEditorStore.getState().site!.visualComponents!.find((v) => v.id === vcId)
    expect(vc?.name).toBe('Hero Section')
  })

  // ---------------------------------------------------------------------------
  // 6 — Valid rename updates the store and display
  // ---------------------------------------------------------------------------

  it('valid rename calls renameVisualComponent and updates the breadcrumb', () => {
    const { vcId } = setupVCMode()
    render(<VCBreadcrumb />)

    act(() => {
      fireEvent.click(screen.getByTestId('vc-breadcrumb-name'))
    })

    const input = screen.getByTestId('vc-breadcrumb-name-input') as HTMLInputElement

    act(() => {
      fireEvent.change(input, { target: { value: 'CardSection' } })
      fireEvent.blur(input)
    })

    // Store should have the new name
    const vc = useEditorStore.getState().site!.visualComponents!.find((v) => v.id === vcId)
    expect(vc?.name).toBe('CardSection')

    // Input should be dismissed
    expect(screen.queryByTestId('vc-breadcrumb-name-input')).toBeNull()

    // Name chip should show the new name
    expect(screen.getByTestId('vc-breadcrumb-name').textContent).toBe('CardSection')
  })

  it('pressing Enter submits the rename', () => {
    const { vcId } = setupVCMode()
    render(<VCBreadcrumb />)

    act(() => {
      fireEvent.click(screen.getByTestId('vc-breadcrumb-name'))
    })

    const input = screen.getByTestId('vc-breadcrumb-name-input') as HTMLInputElement

    act(() => {
      fireEvent.change(input, { target: { value: 'FooterSection' } })
      fireEvent.keyDown(input, { key: 'Enter' })
    })

    const vc = useEditorStore.getState().site!.visualComponents!.find((v) => v.id === vcId)
    expect(vc?.name).toBe('FooterSection')
  })

  // ---------------------------------------------------------------------------
  // 7 — Escape reverts the name
  // ---------------------------------------------------------------------------

  it('pressing Escape reverts to original name and dismisses input', () => {
    setupVCMode()
    render(<VCBreadcrumb />)

    act(() => {
      fireEvent.click(screen.getByTestId('vc-breadcrumb-name'))
    })

    const input = screen.getByTestId('vc-breadcrumb-name-input') as HTMLInputElement

    act(() => {
      fireEvent.change(input, { target: { value: 'SomethingElse' } })
      fireEvent.keyDown(input, { key: 'Escape' })
    })

    // Input should be gone
    expect(screen.queryByTestId('vc-breadcrumb-name-input')).toBeNull()

    // Name chip should show the original name
    expect(screen.getByTestId('vc-breadcrumb-name').textContent).toBe('HeroSection')
  })
})

// ---------------------------------------------------------------------------
// Source-code structural checks
// ---------------------------------------------------------------------------

describe('VCBreadcrumb — structural source checks', () => {
  it('source does not use autoFocus', () => {
    const src = require('fs').readFileSync(
      new URL('../../editor/components/Toolbar/VCBreadcrumb.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).not.toContain('autoFocus')
  })

  it('source uses role="alert" for validation errors', () => {
    const src = require('fs').readFileSync(
      new URL('../../editor/components/Toolbar/VCBreadcrumb.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('role="alert"')
  })

  it('source uses exitVisualComponentMode from the store', () => {
    const src = require('fs').readFileSync(
      new URL('../../editor/components/Toolbar/VCBreadcrumb.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('exitVisualComponentMode')
  })

  it('source uses renameVisualComponent from the store', () => {
    const src = require('fs').readFileSync(
      new URL('../../editor/components/Toolbar/VCBreadcrumb.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('renameVisualComponent')
  })

  it('source uses validateComponentName for validation', () => {
    const src = require('fs').readFileSync(
      new URL('../../editor/components/Toolbar/VCBreadcrumb.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('validateComponentName')
  })

  it('Toolbar.tsx imports and renders VCBreadcrumb', () => {
    const src = require('fs').readFileSync(
      new URL('../../editor/components/Toolbar/Toolbar.tsx', import.meta.url),
      'utf-8',
    )
    expect(src).toContain('VCBreadcrumb')
    expect(src).toContain('breadcrumbRegion')
  })
})
