import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { SelectorsPanel } from '../../editor/components/SelectorsPanel'
import { PropertiesPanel } from '../../editor/components/PropertiesPanel/PropertiesPanel'
import {
  formatSelectorUsage,
  getReusableClasses,
  getSelectorStyleSummary,
  getSelectorUsage,
} from '../../editor/components/SelectorsPanel/selectorUsage'
import { useEditorStore } from '@core/editor-store/store'
import type { CSSClass } from '@core/page-tree/schemas'
import { makeNode, makePage, makeSite } from '../fixtures'
import '../../modules/base/index'

const SRC_ROOT = join(import.meta.dir, '../../')

afterEach(cleanup)

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeClassId: null,
    selectedSelectorClassId: null,
    selectorsPanelOpen: false,
    siteExplorerPanelOpen: false,
    mediaExplorerPanelOpen: false,
    dependenciesPanelOpen: false,
    domTreePanel: { collapsed: true, x: 0, y: 0, width: 280 },
    propertiesPanel: { collapsed: true, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

function makeClass(
  id: string,
  name: string,
  styles: Record<string, unknown> = {},
  overrides: Partial<CSSClass> = {},
): CSSClass {
  return {
    id,
    name,
    styles,
    breakpointStyles: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function loadSiteWithSelectors() {
  const rootNode = makeNode({ id: 'root-1', moduleId: 'base.body', children: ['text-1', 'button-1'] })
  const textNode = makeNode({ id: 'text-1', moduleId: 'base.text', classIds: ['hero-title'], props: { text: 'Hero', tag: 'h1' } })
  const buttonNode = makeNode({ id: 'button-1', moduleId: 'base.button', classIds: ['hero-title', 'cta-button'], props: { label: 'Buy' } })
  const page = makePage({
    id: 'page-1',
    rootNodeId: 'root-1',
    nodes: {
      'root-1': rootNode,
      'text-1': textNode,
      'button-1': buttonNode,
    },
  })

  useEditorStore.setState({
    site: makeSite({
      pages: [page],
      classes: {
        'hero-title': makeClass('hero-title', 'hero-title', { fontSize: '48px', color: '#111' }, {
          breakpointStyles: { mobile: { fontSize: '32px' } },
        }),
        'cta-button': makeClass('cta-button', 'cta-button', { padding: '12px' }),
        'unused-card': makeClass('unused-card', 'unused-card'),
        'text-m': makeClass('text-m', 'text-m', { fontSize: '16px' }, {
          generated: {
            origin: 'framework',
            family: 'typography',
            sourceId: 'group-1',
            generatorId: 'gen-1',
            tokenName: 'text',
            step: 'm',
            locked: true,
          },
        }),
        'internal-style': makeClass('internal-style', 'Text instance text-1', { color: '#333' }, {
          scope: { type: 'node', nodeId: 'text-1', role: 'module-style' },
          tags: ['module-instance'],
        }),
      },
    }),
    activePageId: 'page-1',
    selectorsPanelOpen: true,
  } as Parameters<typeof useEditorStore.setState>[0])

  return { textNodeId: 'text-1', buttonNodeId: 'button-1' }
}

describe('selectorUsage helpers', () => {
  it('formats reusable selector usage and style summaries', () => {
    loadSiteWithSelectors()
    const state = useEditorStore.getState()

    expect(getReusableClasses(state.site!.classes).map((cls) => cls.id)).toEqual([
      'hero-title',
      'cta-button',
      'unused-card',
      'text-m',
    ])
    expect(getSelectorUsage(state.site, 'hero-title')).toBe(2)
    expect(getSelectorUsage(state.site, 'unused-card')).toBe(0)
    expect(formatSelectorUsage(0)).toBe('Unused')
    expect(formatSelectorUsage(1)).toBe('Used 1 time')
    expect(formatSelectorUsage(2)).toBe('Used 2 times')
    expect(getSelectorStyleSummary(state.site!.classes['hero-title'])).toBe('2 props · 1 breakpoint')
    expect(getSelectorStyleSummary(state.site!.classes['unused-card'])).toBe('No styles')
  })
})

describe('SelectorsPanel', () => {
  it('lists only reusable user classes with usage and style metadata', () => {
    loadSiteWithSelectors()
    render(
      <>
        <SelectorsPanel variant="docked" />
        <PropertiesPanel variant="docked" />
      </>,
    )

    const panel = screen.getByTestId('selectors-panel')
    expect(within(panel).getByRole('button', { name: /edit selector \.hero-title/i })).toBeDefined()
    expect(within(panel).getByRole('button', { name: /edit selector \.cta-button/i })).toBeDefined()
    expect(within(panel).getByRole('button', { name: /edit selector \.unused-card/i })).toBeDefined()
    expect(within(panel).getByRole('button', { name: /edit selector \.text-m/i })).toBeDefined()
    expect(within(panel).getByText('.hero-title')).toBeDefined()
    expect(within(panel).getByText('.cta-button')).toBeDefined()
    expect(within(panel).getByText('.unused-card')).toBeDefined()
    expect(within(panel).queryByText('Text instance text-1')).toBeNull()
    expect(within(panel).getByText('Used 2 times')).toBeDefined()
    expect(within(panel).getByText('2 props · 1 breakpoint')).toBeDefined()
  })

  it('filters selectors by All / User / Utility', () => {
    loadSiteWithSelectors()
    render(<SelectorsPanel variant="docked" />)

    const panel = screen.getByTestId('selectors-panel')
    const filterGroup = within(panel).getByRole('group', { name: /selector type/i })
    const allButton = within(filterGroup).getByRole('button', { name: /^all$/i })
    const userButton = within(filterGroup).getByRole('button', { name: /^user$/i })
    const utilityButton = within(filterGroup).getByRole('button', { name: /^utility$/i })

    expect(allButton.getAttribute('aria-pressed')).toBe('true')
    expect(within(panel).getByRole('button', { name: /edit selector \.hero-title/i })).toBeDefined()
    expect(within(panel).getByRole('button', { name: /edit selector \.text-m/i })).toBeDefined()

    fireEvent.click(userButton)
    expect(within(panel).getByRole('button', { name: /edit selector \.hero-title/i })).toBeDefined()
    expect(within(panel).getByRole('button', { name: /edit selector \.cta-button/i })).toBeDefined()
    expect(within(panel).getByRole('button', { name: /edit selector \.unused-card/i })).toBeDefined()
    expect(within(panel).queryByRole('button', { name: /edit selector \.text-m/i })).toBeNull()

    fireEvent.click(utilityButton)
    expect(within(panel).getByRole('button', { name: /edit selector \.text-m/i })).toBeDefined()
    expect(within(panel).queryByRole('button', { name: /edit selector \.hero-title/i })).toBeNull()
    expect(within(panel).queryByRole('button', { name: /edit selector \.cta-button/i })).toBeNull()
    expect(within(panel).queryByRole('button', { name: /edit selector \.unused-card/i })).toBeNull()

    fireEvent.click(allButton)
    expect(within(panel).getByRole('button', { name: /edit selector \.hero-title/i })).toBeDefined()
    expect(within(panel).getByRole('button', { name: /edit selector \.text-m/i })).toBeDefined()
  })

  it('combines the User filter with the search query', () => {
    loadSiteWithSelectors()
    render(<SelectorsPanel variant="docked" />)

    const panel = screen.getByTestId('selectors-panel')
    fireEvent.click(within(panel).getByRole('button', { name: /^user$/i }))
    fireEvent.change(within(panel).getByRole('searchbox', { name: /search selectors/i }), {
      target: { value: 'cta' },
    })

    expect(within(panel).getByRole('button', { name: /edit selector \.cta-button/i })).toBeDefined()
    expect(within(panel).queryByRole('button', { name: /edit selector \.hero-title/i })).toBeNull()
    expect(within(panel).queryByRole('button', { name: /edit selector \.text-m/i })).toBeNull()
  })

  it('shows an empty utility message when no utility classes exist', () => {
    loadSiteWithSelectors()
    const { 'text-m': _utility, ...rest } = useEditorStore.getState().site!.classes
    void _utility
    useEditorStore.setState({
      site: makeSite({ pages: useEditorStore.getState().site!.pages, classes: rest }),
    } as Parameters<typeof useEditorStore.setState>[0])

    render(<SelectorsPanel variant="docked" />)
    fireEvent.click(screen.getByRole('button', { name: /^utility$/i }))
    expect(screen.getByText(/no utility selectors yet/i)).toBeDefined()
  })

  it('shows empty and search-empty states', () => {
    loadSiteWithSelectors()
    useEditorStore.setState({
      site: makeSite({ pages: useEditorStore.getState().site!.pages, classes: {} }),
    } as Parameters<typeof useEditorStore.setState>[0])
    render(<SelectorsPanel variant="docked" />)
    expect(screen.getByText(/no reusable selectors yet/i)).toBeDefined()

    cleanup()
    loadSiteWithSelectors()
    render(<SelectorsPanel variant="docked" />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search selectors/i }), {
      target: { value: 'missing' },
    })
    expect(screen.getByText(/no selectors match/i)).toBeDefined()
  })

  it('filters selector rows by search text', () => {
    loadSiteWithSelectors()
    render(<SelectorsPanel variant="docked" />)

    fireEvent.change(screen.getByRole('searchbox', { name: /search selectors/i }), {
      target: { value: 'cta' },
    })

    expect(screen.queryByRole('button', { name: /edit selector \.hero-title/i })).toBeNull()
    expect(screen.getByRole('button', { name: /edit selector \.cta-button/i })).toBeDefined()
  })

  it('creates a reusable selector from the panel toolbar and opens it for editing', async () => {
    loadSiteWithSelectors()
    render(
      <>
        <SelectorsPanel variant="docked" />
        <PropertiesPanel variant="docked" />
      </>,
    )

    fireEvent.click(screen.getByRole('button', { name: /create selector/i }))
    fireEvent.change(screen.getByRole('textbox', { name: /class name/i }), {
      target: { value: '.feature-card' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }))

    const created = Object.values(useEditorStore.getState().site!.classes).find(
      (cls) => cls.name === 'feature-card',
    )
    expect(created).toBeDefined()
    expect(useEditorStore.getState().activeClassId).toBe(created!.id)
    await waitFor(() => expect(screen.getByTestId('properties-panel')).toBeDefined())
    expect(useEditorStore.getState().propertiesPanel.collapsed).toBe(false)
    const propertiesPanel = screen.getByTestId('properties-panel')
    expect(within(propertiesPanel).getByRole('heading', { name: '.feature-card' })).toBeDefined()
    expect(within(propertiesPanel).getByRole('button', { name: /rename selector \.feature-card/i })).toBeDefined()
    expect(within(propertiesPanel).queryByRole('region', { name: /selector feature-card/i })).toBeNull()
  })

  it('selecting a row opens the global class editor in the right properties panel', async () => {
    loadSiteWithSelectors()
    render(
      <>
        <SelectorsPanel variant="docked" />
        <PropertiesPanel variant="docked" />
      </>,
    )

    const selectorsPanel = screen.getByTestId('selectors-panel')
    fireEvent.click(within(selectorsPanel).getByRole('button', { name: /edit selector \.hero-title/i }))

    expect(within(selectorsPanel).queryByRole('searchbox', { name: /search class style properties to add/i })).toBeNull()
    await waitFor(() => expect(screen.getByTestId('properties-panel')).toBeDefined())
    const propertiesPanel = screen.getByTestId('properties-panel')
    expect(within(propertiesPanel).getByRole('heading', { name: '.hero-title' })).toBeDefined()
    expect(within(propertiesPanel).queryByRole('region', { name: /selector hero-title/i })).toBeNull()
    expect(within(propertiesPanel).getByRole('searchbox', { name: /search class style properties to add/i })).toBeDefined()
    expect(screen.queryByRole('textbox', { name: /add or create a css class/i })).toBeNull()
    expect(useEditorStore.getState().activeClassId).toBe('hero-title')
    expect(useEditorStore.getState().propertiesPanel.collapsed).toBe(false)

    fireEvent.click(within(propertiesPanel).getByRole('button', { name: /rename selector \.hero-title/i }))
    const classNameInput = within(propertiesPanel).getByRole('textbox', { name: /class name/i })
    expect((classNameInput as HTMLInputElement).value).toBe('.hero-title')
    fireEvent.change(classNameInput, { target: { value: '.feature-heading' } })
    fireEvent.blur(classNameInput)

    await waitFor(() => {
      expect(useEditorStore.getState().site!.classes['hero-title'].name).toBe('feature-heading')
    })
    expect(within(propertiesPanel).getByRole('heading', { name: '.feature-heading' })).toBeDefined()
  })

  it('edit from the selector context menu opens the right properties panel editor', async () => {
    loadSiteWithSelectors()
    render(
      <>
        <SelectorsPanel variant="docked" />
        <PropertiesPanel variant="docked" />
      </>,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /edit selector \.cta-button/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^edit$/i }))

    await waitFor(() => expect(screen.getByTestId('properties-panel')).toBeDefined())
    const propertiesPanel = screen.getByTestId('properties-panel')
    expect(within(propertiesPanel).getByRole('heading', { name: '.cta-button' })).toBeDefined()
    expect(useEditorStore.getState().activeClassId).toBe('cta-button')
  })

  it('opens selector context menu from pointer and keyboard', () => {
    loadSiteWithSelectors()
    render(
      <>
        <SelectorsPanel variant="docked" />
        <PropertiesPanel variant="docked" />
      </>,
    )
    const row = screen.getByRole('button', { name: /edit selector \.hero-title/i })

    fireEvent.contextMenu(row, { clientX: 20, clientY: 30 })
    expect(screen.getByRole('menu', { name: /selector actions/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeDefined()

    fireEvent.click(document.body)
    fireEvent.keyDown(row, { key: 'ContextMenu' })
    expect(screen.getByRole('menu', { name: /selector actions/i })).toBeDefined()
  })

  it('duplicates a selector from the context menu without copying assignments', async () => {
    const { buttonNodeId } = loadSiteWithSelectors()
    render(
      <>
        <SelectorsPanel variant="docked" />
        <PropertiesPanel variant="docked" />
      </>,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: /edit selector \.cta-button/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /duplicate/i }))

    const classes = useEditorStore.getState().site!.classes
    const copy = Object.values(classes).find((cls) => cls.name === 'cta-button-copy')
    expect(copy).toBeDefined()
    expect(copy!.styles).toEqual({ padding: '12px' })
    expect(useEditorStore.getState().site!.pages[0].nodes[buttonNodeId].classIds).toEqual(['hero-title', 'cta-button'])
    await waitFor(() => expect(screen.getByTestId('properties-panel')).toBeDefined())
    expect(within(screen.getByTestId('properties-panel')).getByRole('heading', { name: '.cta-button-copy' })).toBeDefined()
  })

  it('applies and removes a selector from the selected element via context menu', () => {
    const { textNodeId } = loadSiteWithSelectors()
    useEditorStore.setState({ selectedNodeId: textNodeId } as Parameters<typeof useEditorStore.setState>[0])
    render(<SelectorsPanel variant="docked" />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /edit selector \.cta-button/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /apply to selected element/i }))
    expect(useEditorStore.getState().site!.pages[0].nodes[textNodeId].classIds ?? []).toContain('cta-button')

    fireEvent.contextMenu(screen.getByRole('button', { name: /edit selector \.cta-button/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /remove from selected element/i }))
    expect(useEditorStore.getState().site!.pages[0].nodes[textNodeId].classIds ?? []).not.toContain('cta-button')
  })

  it('renames and deletes selectors with confirmation', () => {
    loadSiteWithSelectors()
    render(<SelectorsPanel variant="docked" />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /edit selector \.unused-card/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    const dialogClassNameInput = screen.getByRole('textbox', { name: /class name/i })
    expect((dialogClassNameInput as HTMLInputElement).value).toBe('.unused-card')
    fireEvent.change(dialogClassNameInput, {
      target: { value: '.renamed-card' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    expect(useEditorStore.getState().site!.classes['unused-card'].name).toBe('renamed-card')

    fireEvent.contextMenu(screen.getByRole('button', { name: /edit selector \.renamed-card/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    const deleteDialog = screen.getByRole('dialog', { name: /delete selector/i })
    expect(deleteDialog.textContent).toContain('Delete .renamed-card?')
    expect(deleteDialog.textContent).not.toContain('renamed-card (')
    expect(within(deleteDialog).getByText(/this selector is unused/i)).toBeDefined()
    fireEvent.click(within(deleteDialog).getByRole('button', { name: /delete selector/i }))
    expect(useEditorStore.getState().site!.classes['unused-card']).toBeUndefined()
  })

  it('copies the user-facing selector from the context menu', async () => {
    loadSiteWithSelectors()
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text
        },
      },
    })

    try {
      render(<SelectorsPanel variant="docked" />)
      fireEvent.contextMenu(screen.getByRole('button', { name: /edit selector \.hero-title/i }))
      fireEvent.click(screen.getByRole('menuitem', { name: /copy selector/i }))
      await Promise.resolve()
      expect(copied).toBe('.hero-title')
    } finally {
      if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard)
    }
  })
})

describe('SelectorsPanel architecture', () => {
  it('wires selectors into the panel rail and left sidebar', () => {
    const railSource = readFileSync(join(SRC_ROOT, 'editor/components/PanelRail/PanelRail.tsx'), 'utf-8')
    const sidebarSource = readFileSync(join(SRC_ROOT, 'editor/components/LeftSidebar/LeftSidebar.tsx'), 'utf-8')

    expect(railSource).toContain("id: 'selectors'")
    expect(sidebarSource).toContain('SelectorsPanel')
  })

  it('new selectors panel files avoid inline styles Tailwind and important flags', () => {
    const files = [
      'editor/components/SelectorsPanel/SelectorsPanel.tsx',
      'editor/components/SelectorsPanel/SelectorsPanel.module.css',
    ]

    for (const file of files) {
      const source = readFileSync(join(SRC_ROOT, file), 'utf-8')
      expect(source).not.toContain('style={')
      expect(source).not.toContain('className="')
      expect(source).not.toContain('!important')
    }
  })
})
