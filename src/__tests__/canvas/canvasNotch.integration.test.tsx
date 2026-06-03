import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditorStore } from '@site/store/store'
import { CanvasNotch } from '@site/canvas/CanvasNotch'
import { __resetModuleInserterPreferenceForTests } from '@site/module-picker/useModuleInserterPreference'
import '@modules/base/index'

const originalFetch = globalThis.fetch

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  localStorage.clear()
  __resetModuleInserterPreferenceForTests()
  globalThis.fetch = mock(async () => jsonResponse({ error: 'Preference not set' }, 404)) as typeof fetch
  useEditorStore.setState({
    site: null,
    activePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    propertiesPanel: { collapsed: true, x: 0, y: 0, width: 360 },
    packageJson: {},
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  })
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

function renderInsideCanvasClickBoundary() {
  useEditorStore.getState().createSite('Test SiteDocument')

  render(
    <div onClick={() => useEditorStore.getState().clearSelection()}>
      <CanvasNotch />
    </div>,
  )
}

describe('CanvasNotch insertion events', () => {
  it('keeps quick-inserted modules selected when the canvas listens for background clicks', async () => {
    const user = userEvent.setup()
    renderInsideCanvasClickBoundary()

    await user.click(screen.getByTestId('canvas-notch-text-btn'))

    const state = useEditorStore.getState()
    expect(state.selectedNodeId).toBeTruthy()
    expect(state.propertiesPanel.collapsed).toBe(false)
  })

  it('keeps dialog-inserted modules selected when the canvas listens for background clicks', async () => {
    const user = userEvent.setup()
    renderInsideCanvasClickBoundary()

    await user.click(screen.getByTestId('canvas-notch-add-btn'))
    const dialog = screen.getByRole('dialog', { name: 'Add to canvas' })
    await user.click(within(dialog).getByRole('button', { name: /^Text\b/ }))

    const state = useEditorStore.getState()
    expect(state.selectedNodeId).toBeTruthy()
    expect(state.propertiesPanel.collapsed).toBe(false)
  })

  it('renders server favorite modules as notch shortcuts', async () => {
    globalThis.fetch = mock(async () =>
      jsonResponse({
        value: { favorites: [{ kind: 'module', id: 'base.list' }] },
      }),
    ) as typeof fetch
    const user = userEvent.setup()
    renderInsideCanvasClickBoundary()

    await user.click(await screen.findByTestId('canvas-notch-list-btn'))

    const state = useEditorStore.getState()
    const page = state.site?.pages.find((item) => item.id === state.activePageId)
    const listNodes = page
      ? Object.values(page.nodes).filter((node) => node.moduleId === 'base.list')
      : []
    expect(listNodes).toHaveLength(1)
    expect(state.propertiesPanel.collapsed).toBe(false)
  })
})
