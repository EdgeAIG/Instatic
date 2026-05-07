import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEditorStore } from '@core/editor-store/store'
import { CanvasNotch } from '../../editor/components/Canvas/CanvasNotch'
import '../../modules/base/index'

beforeEach(() => {
  localStorage.clear()
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

  it('keeps Add-menu inserted modules selected when the canvas listens for background clicks', async () => {
    const user = userEvent.setup()
    renderInsideCanvasClickBoundary()

    await user.click(screen.getByTestId('canvas-notch-add-btn'))
    await user.click(screen.getByRole('menuitem', { name: 'Text' }))

    const state = useEditorStore.getState()
    expect(state.selectedNodeId).toBeTruthy()
    expect(state.propertiesPanel.collapsed).toBe(false)
  })
})
