import { describe, expect, it, beforeEach } from 'bun:test'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'fs'
import { DndContext } from '@dnd-kit/core'
import { CanvasRoot } from '../../editor/components/Canvas/CanvasRoot'
import { useEditorStore } from '@core/editor-store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import '../../modules/base'

/** CanvasRoot uses useDroppable and must be rendered inside a DndContext. */
function renderCanvas() {
  return render(<DndContext><CanvasRoot /></DndContext>)
}

const CANVAS_BREAKPOINT_SELECTOR_CSS = new URL(
  '../../editor/components/Canvas/CanvasBreakpointSelector.module.css',
  import.meta.url,
)
const CANVAS_BREAKPOINT_SELECTOR_TSX = new URL(
  '../../editor/components/Canvas/CanvasBreakpointSelector.tsx',
  import.meta.url,
)

beforeEach(() => {
  cleanup()
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    selectedSelectorClassId: null,
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    focusedPanel: 'canvas',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

function loadCanvasWithSelectedText() {
  const rootId = 'root-1'
  const nodeId = 'text-1'
  const rootNode = makeNode({ id: rootId, moduleId: 'base.body', children: [nodeId] })
  const textNode = makeNode({
    id: nodeId,
    moduleId: 'base.text',
    props: { text: 'Hello', tag: 'h2' },
    children: [],
  })
  const page = makePage({
    id: 'page-1',
    rootNodeId: rootId,
    nodes: { [rootId]: rootNode, [nodeId]: textNode },
  })
  useEditorStore.setState({
    site: makeSite({ pages: [page] }),
    activePageId: 'page-1',
    selectedNodeId: nodeId,
    activeBreakpointId: 'mobile',
  } as Parameters<typeof useEditorStore.setState>[0])
  return { nodeId }
}

describe('CanvasBreakpointSelector', () => {
  it('renders as top-right canvas chrome only when docked properties are open', () => {
    loadCanvasWithSelectedText()
    const { rerender } = renderCanvas()

    expect(screen.getByTestId('canvas-breakpoint-selector')).toBeDefined()
    expect((screen.getByRole('combobox', { name: /canvas breakpoint/i }) as HTMLInputElement).value).toBe('Mobile')

    act(() => {
      useEditorStore.setState({
        propertiesPanelMode: 'floating',
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    rerender(<DndContext><CanvasRoot /></DndContext>)
    expect(screen.queryByTestId('canvas-breakpoint-selector')).toBeNull()

    act(() => {
      useEditorStore.setState({
        propertiesPanelMode: 'docked',
        propertiesPanel: { collapsed: true, x: 0, y: 0, width: 360 },
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    rerender(<DndContext><CanvasRoot /></DndContext>)
    expect(screen.queryByTestId('canvas-breakpoint-selector')).toBeNull()
  })

  it('changes the active canvas breakpoint without clearing the selected node', () => {
    const { nodeId } = loadCanvasWithSelectedText()
    renderCanvas()

    fireEvent.click(screen.getByRole('combobox', { name: /canvas breakpoint/i }))
    fireEvent.click(screen.getByRole('option', { name: /tablet 768px/i }))

    const state = useEditorStore.getState()
    expect(state.activeBreakpointId).toBe('tablet')
    expect(state.selectedNodeId).toBe(nodeId)
  })

  it('keeps the closed trigger compact while opening a wider breakpoint menu', () => {
    loadCanvasWithSelectedText()
    renderCanvas()

    fireEvent.click(screen.getByRole('combobox', { name: /canvas breakpoint/i }))

    const menuStyle = screen.getByRole('listbox', { name: /canvas breakpoint/i }).getAttribute('style')
    expect(menuStyle).toContain('--context-menu-min-width: 164px')
    expect(menuStyle).toContain('--context-menu-width: 164px')
  })

  it('uses icon-only vertical black inverted-corner chrome with a mint-accent select', () => {
    const css = readFileSync(CANVAS_BREAKPOINT_SELECTOR_CSS, 'utf-8')
    const tsx = readFileSync(CANVAS_BREAKPOINT_SELECTOR_TSX, 'utf-8')

    // Inverted-corner notch chrome — structural assertions (no border, vertical
    // stack, borderless combobox input, mint accent surface). The actual radius
    // and width values live in the CSS module and are free to be tuned.
    expect(css).toContain('border: 0')
    expect(css).toContain('flex-direction: column')
    expect(css).toContain('flex: 0 0 0')
    expect(css).toContain('width: 0')
    expect(css).toContain('color: transparent')
    expect(css).toContain('border-radius: 0 0 0 var(--breakpoint-notch-radius)')
    expect(css).toContain('left: calc(1px - var(--breakpoint-notch-corner))')
    expect(css).toContain('bottom: calc(1px - var(--breakpoint-notch-corner))')
    expect(css).toContain('var(--editor-mint-surface)')
    expect(tsx).toContain('menuPlacement="left-start"')
  })
})
