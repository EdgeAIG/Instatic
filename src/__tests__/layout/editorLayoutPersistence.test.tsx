/**
 * Editor layout persistence + rail integration tests.
 *
 * These cover the user-facing layout contract: panel open/closed state is
 * restored from localStorage on refresh, and the permanent left rail can reopen
 * closed panels without using the top toolbar.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AdminLayout from '../../admin/AdminLayout'
import { useEditorStore } from '@core/editor-store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import '../../modules/base/index'

const LAYOUT_STORAGE_KEY = 'pb-editor-layout-v1'

afterEach(cleanup)

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    domTreePanel: { collapsed: false, x: 0, y: 0, width: 280 },
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    leftSidebarWidth: 320,
    focusedPanel: 'canvas',
    siteExplorerPanelOpen: false,
    selectorsPanelOpen: false,
    colorsPanelOpen: false,
    mediaExplorerPanelOpen: false,
    codeEditorPanelOpen: false,
    activeEditorFileId: null,
    dependenciesPanelOpen: false,
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

function renderEditorLayout({ preloadSite = true }: { preloadSite?: boolean } = {}) {
  if (preloadSite && !useEditorStore.getState().site) {
    loadSiteWithSelectedHeading()
  }
  render(<AdminLayout />)
}

function loadSiteWithSelectedHeading() {
  const rootId = 'root-1'
  const nodeId = 'heading-1'
  const rootNode = makeNode({ id: rootId, moduleId: 'base.body', children: [nodeId] })
  const headingNode = makeNode({
    id: nodeId,
    moduleId: 'base.text',
    props: { text: 'Hello', tag: 'h2', align: 'left' },
    children: [],
  })
  const page = makePage({
    id: 'page-1',
    rootNodeId: rootId,
    nodes: { [rootId]: rootNode, [nodeId]: headingNode },
  })
  const site = makeSite({ pages: [page] })
  useEditorStore.setState({
    site,
    activePageId: 'page-1',
    selectedNodeId: nodeId,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

describe('AdminLayout — CMS site hydration gate', () => {
  it('does not render editor chrome with an empty store while the CMS site hydrates', async () => {
    const loaded = makeSite({ name: 'Hydrated Site' })
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ site: loaded }), { status: 200 })
    ) as typeof fetch

    try {
      renderEditorLayout({ preloadSite: false })

      expect(screen.getByRole('status', { name: /loading page builder/i })).toBeDefined()
      expect(document.querySelector('[data-editor-skeleton="true"]')).toBeNull()
      expect(screen.queryByTestId('toolbar')).toBeNull()
      expect(screen.queryByText(/loading site/i)).toBeNull()

      expect(await screen.findByText('Hydrated Site')).toBeDefined()
      expect(screen.queryByText(/loading site/i)).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('does not overwrite an existing in-memory site when AdminLayout remounts during HMR', async () => {
    const existing = makeSite({ name: 'Existing HMR Site' })
    useEditorStore.setState({
      site: existing,
      activePageId: existing.pages[0].id,
    } as Parameters<typeof useEditorStore.setState>[0])

    let siteFetchCalls = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('/api/cms/site')) siteFetchCalls += 1
      return new Response(JSON.stringify({ error: 'draft site not found' }), { status: 404 })
    }) as typeof fetch

    try {
      renderEditorLayout({ preloadSite: false })

      expect(screen.getByText('Existing HMR Site')).toBeDefined()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(siteFetchCalls).toBe(0)
      expect(useEditorStore.getState().site?.name).toBe('Existing HMR Site')
      expect(screen.queryByText(/loading site/i)).toBeNull()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})

describe('AdminLayout — persisted panel layout', () => {
  it('restores panel visibility from localStorage on mount', async () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        panels: {
          dom: { open: false },
          properties: { open: true, mode: 'floating', width: 390 },
          site: { open: true },
          media: { open: true },
          codeeditor: { open: true },
          dependencies: { open: true },
          agent: { open: true },
        },
        sidebars: { leftWidth: 410 },
        activeEditorFileId: 'file-1',
      }),
    )
    loadSiteWithSelectedHeading()

    renderEditorLayout()

    await waitFor(() => {
      const state = useEditorStore.getState()
      expect(state.domTreePanel.collapsed).toBe(true)
      expect(state.propertiesPanel.collapsed).toBe(false)
      expect(state.propertiesPanelMode).toBe('floating')
      expect(state.propertiesPanel.width).toBe(390)
      expect(state.leftSidebarWidth).toBe(410)
      expect(state.siteExplorerPanelOpen).toBe(true)
      expect(state.mediaExplorerPanelOpen).toBe(false)
      expect(state.codeEditorPanelOpen).toBe(true)
      expect(state.activeEditorFileId).toBe('file-1')
      expect(state.dependenciesPanelOpen).toBe(false)
      expect(state.isAgentOpen).toBe(false)
    }, { timeout: 150 })
  })

  it('ignores retired Files panel layout records', async () => {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        panels: {
          files: { open: true },
          site: { open: false },
        },
      }),
    )

    renderEditorLayout()

    await waitFor(() => {
      const state = useEditorStore.getState()
      expect(state.siteExplorerPanelOpen).toBe(false)

      const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
      expect(stored.panels.files).toBeUndefined()
      expect(stored.panels.site.open).toBe(false)
    }, { timeout: 150 })
  })
})

describe('AdminLayout — permanent panel rail', () => {
  it('does not render the deferred timeline shell or rail button', () => {
    renderEditorLayout()

    expect(screen.queryByTestId('timeline-panel')).toBeNull()
    expect(screen.queryByTestId('panel-rail-timeline')).toBeNull()
  })

  it('renders a left panel rail that can toggle the Site panel', () => {
    renderEditorLayout()

    const rail = screen.queryByRole('navigation', { name: /panel dock/i })
    expect(rail).not.toBeNull()

    const siteButton = within(rail!).getByRole('button', { name: /open site panel/i })
    expect(siteButton.getAttribute('aria-pressed')).toBe('false')
    expect(within(rail!).queryByRole('button', { name: /properties panel/i })).toBeNull()
    expect(within(rail!).queryByRole('button', { name: /code editor/i })).toBeNull()

    fireEvent.click(siteButton)

    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(true)
    expect(siteButton.getAttribute('aria-pressed')).toBe('true')
  })

  it('orders primary rail panels by importance and uses the chosen panel icons', () => {
    renderEditorLayout()

    const rail = screen.getByRole('navigation', { name: /panel dock/i })
    const primaryButtons = within(rail).getAllByRole('button').slice(0, 5)

    expect(primaryButtons.map((button) => button.getAttribute('data-testid'))).toEqual([
      'panel-rail-layers',
      'panel-rail-agent',
      'panel-rail-site',
      'panel-rail-selectors',
      'panel-rail-colors',
    ])
    expect(primaryButtons.map((button) => button.getAttribute('data-icon'))).toEqual([
      'bulletlist-2-sharp',
      'ai-settings-solid',
      'files-stack-2',
      'paint-bucket',
      'colors-swatch',
    ])
    expect(primaryButtons.map((button) => button.getAttribute('data-accent'))).toEqual([
      'mint',
      'lilac',
      'sky',
      'peach',
      'peach',
    ])
  })

  it('docks left rail panels into an expanding sidebar and switches between them', () => {
    renderEditorLayout()

    const sidebar = screen.getByTestId('left-sidebar')
    const rail = within(sidebar).getByRole('navigation', { name: /panel dock/i })

    expect(sidebar.getAttribute('data-expanded')).toBe('true')
    expect(sidebar.getAttribute('data-active-panel')).toBe('layers')
    expect(sidebar.getAttribute('style')).toContain('--left-sidebar-panel-width: 320px')
    expect(within(sidebar).getByRole('separator', { name: /resize left sidebar/i })).toBeDefined()
    expect(within(sidebar).getByLabelText('DOM tree panel')).toBeDefined()

    fireEvent.click(within(rail).getByRole('button', { name: /open site panel/i }))

    expect(sidebar.getAttribute('data-expanded')).toBe('true')
    expect(sidebar.getAttribute('data-active-panel')).toBe('site')
    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(true)
    expect(useEditorStore.getState().dependenciesPanelOpen).toBe(false)
    expect(useEditorStore.getState().domTreePanel.collapsed).toBe(true)
    expect(useEditorStore.getState().isAgentOpen).toBe(false)
    expect(within(sidebar).getByTestId('site-explorer-panel')).toBeDefined()
    expect(within(sidebar).queryByTestId('deps-section')).toBeNull()

    fireEvent.click(within(rail).getByRole('button', { name: /close site panel/i }))

    expect(sidebar.getAttribute('data-expanded')).toBe('false')
    expect(sidebar.getAttribute('data-active-panel')).toBe('none')
    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(false)

    fireEvent.click(within(rail).getByRole('button', { name: /open colors panel/i }))

    expect(sidebar.getAttribute('data-expanded')).toBe('true')
    expect(sidebar.getAttribute('data-active-panel')).toBe('colors')
    expect(useEditorStore.getState().colorsPanelOpen).toBe(true)
    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(false)
    expect(useEditorStore.getState().mediaExplorerPanelOpen).toBe(false)
    expect(useEditorStore.getState().domTreePanel.collapsed).toBe(true)
    expect(within(sidebar).getByTestId('colors-panel')).toBeDefined()

    fireEvent.click(within(rail).getByRole('button', { name: /open media panel/i }))

    expect(sidebar.getAttribute('data-expanded')).toBe('true')
    expect(sidebar.getAttribute('data-active-panel')).toBe('media')
    expect(useEditorStore.getState().mediaExplorerPanelOpen).toBe(true)
    expect(useEditorStore.getState().colorsPanelOpen).toBe(false)
    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(false)
    expect(useEditorStore.getState().dependenciesPanelOpen).toBe(false)
    expect(useEditorStore.getState().domTreePanel.collapsed).toBe(true)
    expect(useEditorStore.getState().isAgentOpen).toBe(false)
    expect(within(sidebar).getByTestId('media-explorer-panel')).toBeDefined()

    fireEvent.click(within(rail).getByRole('button', { name: /open dependencies panel/i }))

    expect(sidebar.getAttribute('data-expanded')).toBe('true')
    expect(sidebar.getAttribute('data-active-panel')).toBe('dependencies')
    expect(sidebar.getAttribute('style')).toContain('--left-sidebar-panel-width: 320px')
    expect(useEditorStore.getState().dependenciesPanelOpen).toBe(true)
    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(false)
    expect(useEditorStore.getState().mediaExplorerPanelOpen).toBe(false)
    expect(useEditorStore.getState().domTreePanel.collapsed).toBe(true)
    expect(useEditorStore.getState().isAgentOpen).toBe(false)
    expect(within(sidebar).getByTestId('dependencies-panel')).toBeDefined()
    expect(within(sidebar).getByTestId('deps-section')).toBeDefined()

    fireEvent.click(within(rail).getByRole('button', { name: /open ai assistant panel/i }))

    expect(sidebar.getAttribute('data-expanded')).toBe('true')
    expect(sidebar.getAttribute('data-active-panel')).toBe('agent')
    expect(sidebar.getAttribute('style')).toContain('--left-sidebar-panel-width: 320px')
    expect(useEditorStore.getState().isAgentOpen).toBe(true)
    expect(useEditorStore.getState().dependenciesPanelOpen).toBe(false)
    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(false)
    expect(useEditorStore.getState().mediaExplorerPanelOpen).toBe(false)
    expect(useEditorStore.getState().domTreePanel.collapsed).toBe(true)
    expect(within(sidebar).getByTestId('agent-panel')).toBeDefined()
  })

  it('docks Properties into the right sidebar by default and can switch to floating mode', async () => {
    loadSiteWithSelectedHeading()
    renderEditorLayout()

    const rightSidebar = await screen.findByTestId('right-sidebar')

    await waitFor(() => {
      expect(rightSidebar.getAttribute('data-expanded')).toBe('true')
      expect(rightSidebar.getAttribute('data-mode')).toBe('docked')
    }, { timeout: 150 })

    expect(rightSidebar.getAttribute('style')).toContain('--right-sidebar-panel-width: 360px')
    expect(within(rightSidebar).getByTestId('properties-panel').getAttribute('data-variant')).toBe('docked')

    fireEvent.click(within(rightSidebar).getByRole('button', { name: /unpin properties panel/i }))

    await waitFor(() => {
      expect(useEditorStore.getState().propertiesPanelMode).toBe('floating')
      expect(rightSidebar.getAttribute('data-expanded')).toBe('false')
    }, { timeout: 150 })

    const floatingPanel = screen.getByTestId('properties-panel')
    expect(floatingPanel.getAttribute('data-variant')).toBe('floating')

    fireEvent.click(within(floatingPanel).getByRole('button', { name: /dock properties panel/i }))

    await waitFor(() => {
      expect(useEditorStore.getState().propertiesPanelMode).toBe('docked')
      expect(rightSidebar.getAttribute('data-expanded')).toBe('true')
      expect(within(rightSidebar).getByTestId('properties-panel').getAttribute('data-variant')).toBe('docked')
    }, { timeout: 150 })
  })

  it('marks the canvas stage while the right sidebar is open', async () => {
    loadSiteWithSelectedHeading()
    renderEditorLayout()

    const canvasStage = screen.getByTestId('canvas-root').closest('[data-right-sidebar-expanded]')
    expect(canvasStage).not.toBeNull()

    await waitFor(() => {
      expect(canvasStage!.getAttribute('data-right-sidebar-expanded')).toBe('true')
    }, { timeout: 150 })

    const rightSidebar = screen.getByTestId('right-sidebar')
    fireEvent.click(within(rightSidebar).getByRole('button', { name: /unpin properties panel/i }))

    await waitFor(() => {
      expect(canvasStage!.getAttribute('data-right-sidebar-expanded')).toBe('false')
    }, { timeout: 150 })
  })

  it('resizes both sidebars with keyboard-accessible handles and persists the widths', async () => {
    loadSiteWithSelectedHeading()
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        panels: {
          site: { open: true },
          properties: { open: true, mode: 'docked', width: 420 },
        },
        sidebars: { leftWidth: 410 },
      }),
    )

    renderEditorLayout()

    const leftSidebar = screen.getByTestId('left-sidebar')
    const rightSidebar = await screen.findByTestId('right-sidebar')

    await waitFor(() => {
      expect(leftSidebar.getAttribute('style')).toContain('--left-sidebar-panel-width: 410px')
      expect(rightSidebar.getAttribute('style')).toContain('--right-sidebar-panel-width: 420px')
    }, { timeout: 150 })

    fireEvent.keyDown(within(leftSidebar).getByRole('separator', { name: /resize left sidebar/i }), {
      key: 'ArrowRight',
    })
    fireEvent.keyDown(within(rightSidebar).getByRole('separator', { name: /resize right sidebar/i }), {
      key: 'ArrowLeft',
    })

    await waitFor(() => {
      const state = useEditorStore.getState()
      expect(state.leftSidebarWidth).toBe(420)
      expect(state.propertiesPanel.width).toBe(430)
      const stored = JSON.parse(localStorage.getItem(LAYOUT_STORAGE_KEY) ?? '{}')
      expect(stored.sidebars.leftWidth).toBe(420)
      expect(stored.panels.properties.width).toBe(430)
    }, { timeout: 150 })
  })

  it('keeps the Properties panel disconnected from the left rail', () => {
    renderEditorLayout()

    const sidebar = screen.getByTestId('left-sidebar')
    const rail = within(sidebar).getByRole('navigation', { name: /panel dock/i })

    expect(within(rail).queryByRole('button', { name: /properties panel/i })).toBeNull()

    act(() => {
      useEditorStore.setState({
        propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
        selectedNodeId: 'selected-for-shortcut',
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    fireEvent.keyDown(document, { key: 'R', ctrlKey: true, shiftKey: true })

    expect(sidebar.getAttribute('data-active-panel')).toBe('layers')
    expect(useEditorStore.getState().propertiesPanel.collapsed).toBe(true)
  })

  it('keeps panel keyboard shortcuts on the permanent rail', () => {
    renderEditorLayout()

    fireEvent.keyDown(document, { key: 'E', ctrlKey: true, shiftKey: true })
    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(true)

    fireEvent.keyDown(document, { key: 'M', ctrlKey: true, shiftKey: true })
    expect(useEditorStore.getState().mediaExplorerPanelOpen).toBe(true)
    expect(useEditorStore.getState().siteExplorerPanelOpen).toBe(false)

    fireEvent.keyDown(document, { key: 'R', ctrlKey: true, shiftKey: true })
    expect(useEditorStore.getState().propertiesPanel.collapsed).toBe(true)

    fireEvent.keyDown(document, { key: 'i', metaKey: true })
    expect(useEditorStore.getState().isAgentOpen).toBe(true)
  })
})
