/**
 * modulePickerDropdown.test.tsx
 *
 * Tests for the site-VC integration in ModulePickerDropdown:
 * - VCs appear in the Components category with name + param count
 * - Search filter matches VC names
 * - Clicking a VC row calls insertComponentRef and closes dropdown
 * - base.slot-outlet visibility gated by VC edit mode
 * - base.visual-component-ref never shown
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ModulePickerDropdown } from '../../editor/components/Toolbar/ModulePickerDropdown'
import { useEditorStore } from '@core/editor-store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import type { VisualComponent } from '@core/visualComponents/schemas'
import '../../modules/base/index'

afterEach(cleanup)

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeDocument: null,
    siteExplorerPanelOpen: false,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

function makeVC(id: string, name: string, paramCount = 0): VisualComponent {
  const rootId = `root-${id}`
  return {
    id,
    name,
    tree: {
      rootNodeId: rootId,
      nodes: {
        [rootId]: {
          id: rootId,
          moduleId: 'base.body',
          props: {},
          children: [],
          breakpointOverrides: {},
          classIds: [],
        },
      },
    },
    params: Array.from({ length: paramCount }, (_, i) => ({
      id: `param-${i}`,
      name: `param${i}`,
      type: 'string' as const,
      defaultValue: '',
      required: false,
    })),
    breakpoints: [],
    classIds: [],
    createdAt: 1_700_000_000_000,
  }
}

function loadSite(
  vcs: VisualComponent[] = [],
  activeDocument: { kind: 'visualComponent'; vcId: string } | null = null,
) {
  const home = makePage({
    id: 'page-home',
    title: 'Home',
    slug: 'index',
    rootNodeId: 'root-home',
    nodes: {
      'root-home': makeNode({ id: 'root-home', moduleId: 'base.body' }),
    },
  })

  useEditorStore.setState({
    site: makeSite({ pages: [home], files: [], visualComponents: vcs }),
    activePageId: 'page-home',
    activeDocument,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

describe('ModulePickerDropdown — Visual Components', () => {
  it('lists site VCs as menu items inside the picker', () => {
    loadSite([
      makeVC('vc-1', 'HeroCard', 3),
      makeVC('vc-2', 'PricingTable', 1),
    ])
    render(<ModulePickerDropdown />)

    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    const menu = screen.getByRole('menu', { name: 'Add module' })
    expect(within(menu).getByText('HeroCard')).toBeDefined()
    expect(within(menu).getByText('PricingTable')).toBeDefined()
  })

  it('renders data-vc-id attribute on VC menu items', () => {
    loadSite([makeVC('vc-abc', 'MyComponent', 0)])
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    const menu = screen.getByRole('menu', { name: 'Add module' })
    const vcItem = within(menu).getByText('MyComponent').closest('[data-vc-id]')
    expect(vcItem?.getAttribute('data-vc-id')).toBe('vc-abc')
  })

  it('filters VCs by search query', () => {
    loadSite([
      makeVC('vc-1', 'HeroCard', 2),
      makeVC('vc-2', 'PricingTable', 1),
    ])
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    const searchBox = screen.getByRole('searchbox', { name: 'Search modules' })
    fireEvent.change(searchBox, { target: { value: 'hero' } })

    const menu = screen.getByRole('menu', { name: 'Add module' })
    expect(within(menu).getByText('HeroCard')).toBeDefined()
    expect(within(menu).queryByText('PricingTable')).toBeNull()
  })

  it('calls insertComponentRef with correct parent when a VC row is clicked', () => {
    loadSite([makeVC('vc-1', 'HeroCard', 0)])
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    // Use the data-vc-id to find and click the VC item
    const vcItem = screen
      .getByRole('menu', { name: 'Add module' })
      .querySelector('[data-vc-id="vc-1"]') as HTMLElement
    expect(vcItem).not.toBeNull()
    fireEvent.click(vcItem)

    const state = useEditorStore.getState()
    const page = state.site?.pages.find((p) => p.id === 'page-home')
    const nodes = page?.nodes
    const refs = nodes
      ? Object.values(nodes).filter((n) => n.moduleId === 'base.visual-component-ref')
      : []
    expect(refs.length).toBe(1)
    expect(refs[0]?.props.componentId).toBe('vc-1')
  })

  it('closes the dropdown after clicking a VC row', () => {
    loadSite([makeVC('vc-1', 'HeroCard', 0)])
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    // Picker shell is open — ContextMenu with aria-label="Add module"
    expect(screen.getByRole('menu', { name: 'Add module' })).toBeDefined()

    const vcItem = screen
      .getByRole('menu', { name: 'Add module' })
      .querySelector('[data-vc-id="vc-1"]') as HTMLElement
    fireEvent.click(vcItem)

    // Dropdown should be closed
    expect(screen.queryByRole('menu', { name: 'Add module' })).toBeNull()
  })

  it('hides base.visual-component-ref from the picker in page mode', () => {
    loadSite([])
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    // base.visual-component-ref should not appear as a module item
    const menu = screen.getByRole('menu', { name: 'Add module' })
    const vcRefItem = within(menu).queryAllByRole('menuitem').find(
      (el) => el.getAttribute('data-module-id') === 'base.visual-component-ref',
    )
    expect(vcRefItem).toBeUndefined()
  })

  it('hides base.slot-outlet in page mode (name: Slot)', () => {
    loadSite([])
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    // base.slot-outlet (display name: "Slot") should not appear in page mode
    const menu = screen.getByRole('menu', { name: 'Add module' })
    const slotItem = within(menu).queryAllByRole('menuitem').find(
      (el) => el.getAttribute('data-module-id') === 'base.slot-outlet',
    )
    expect(slotItem).toBeUndefined()
  })

  it('shows base.slot-outlet in VC edit mode', () => {
    const vc = makeVC('vc-1', 'HeroCard', 0)
    loadSite([vc], { kind: 'visualComponent', vcId: vc.id })
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    // base.slot-outlet (display name: "Slot") should be visible in VC mode
    const menu = screen.getByRole('menu', { name: 'Add module' })
    const slotItem = within(menu).queryAllByRole('menuitem').find(
      (el) => el.getAttribute('data-module-id') === 'base.slot-outlet',
    )
    expect(slotItem).toBeDefined()
  })

  it('hides base.slot-instance in page mode (auto-materialized only)', () => {
    loadSite([])
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    // base.slot-instance is materialized as a VC ref child by syncSlotInstances —
    // it must NEVER appear as a user-insertable option in the picker. Otherwise
    // the picker shows two "Slot" entries (one for slot-outlet, one for
    // slot-instance) and orphan slot-instance nodes leak into the tree.
    const menu = screen.getByRole('menu', { name: 'Add module' })
    const slotInstanceItem = within(menu).queryAllByRole('menuitem').find(
      (el) => el.getAttribute('data-module-id') === 'base.slot-instance',
    )
    expect(slotInstanceItem).toBeUndefined()
  })

  it('hides base.slot-instance in VC edit mode (auto-materialized only)', () => {
    const vc = makeVC('vc-1', 'HeroCard', 0)
    loadSite([vc], { kind: 'visualComponent', vcId: vc.id })
    render(<ModulePickerDropdown />)
    fireEvent.click(screen.getByTestId('toolbar-add-module-btn'))

    // Same rule as page mode — slot-instance is structural-only, never picker-visible.
    const menu = screen.getByRole('menu', { name: 'Add module' })
    const slotInstanceItem = within(menu).queryAllByRole('menuitem').find(
      (el) => el.getAttribute('data-module-id') === 'base.slot-instance',
    )
    expect(slotInstanceItem).toBeUndefined()
  })
})
