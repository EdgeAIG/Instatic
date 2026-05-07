import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ClassPicker } from '../../editor/components/PropertiesPanel/ClassPicker'
import { PropertiesPanel } from '../../editor/components/PropertiesPanel/PropertiesPanel'
import { SelectorsPanel } from '../../editor/components/SelectorsPanel'
import { useEditorStore } from '@core/editor-store/store'
import type { CSSClass } from '@core/page-tree/schemas'
import { makeNode, makePage, makeSite } from '../fixtures'
import '../../modules/base/index'

const GENERATED_CLASS_ID = 'framework:color:primary-token:base:text'

function generatedTextClass(): CSSClass {
  return {
    id: GENERATED_CLASS_ID,
    name: 'text-primary',
    styles: { color: 'var(--primary)' },
    breakpointStyles: {},
    generated: {
      origin: 'framework',
      family: 'color',
      sourceId: 'primary-token',
      utility: 'text',
      tokenName: 'primary',
      locked: true,
    },
    tags: ['framework', 'utility', 'color'],
    createdAt: 1,
    updatedAt: 1,
  }
}

function resetStore() {
  const page = makePage({
    id: 'page-1',
    rootNodeId: 'root',
    nodes: {
      root: makeNode({ id: 'root', moduleId: 'base.body', children: ['hero'] }),
      hero: makeNode({ id: 'hero', moduleId: 'base.text', props: { text: 'Hero', tag: 'h1' }, classIds: [] }),
    },
  })
  useEditorStore.setState({
    site: makeSite({
      pages: [page],
      classes: {
        [GENERATED_CLASS_ID]: generatedTextClass(),
      },
    }),
    activePageId: 'page-1',
    activeDocument: null,
    selectedNodeId: 'hero',
    activeClassId: null,
    selectedSelectorClassId: null,
    selectorsPanelOpen: false,
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)
afterEach(cleanup)

describe('generated utility classes in editor panels', () => {
  it('marks generated utility suggestions in the class picker', () => {
    render(<ClassPicker nodeId="hero" />)

    fireEvent.change(screen.getByRole('textbox', { name: /add or create a css class/i }), {
      target: { value: 'text' },
    })

    expect(screen.getByRole('menu', { name: /class suggestions/i })).toBeDefined()
    expect(screen.getByText('text-primary')).toBeDefined()
    expect(screen.getByText('Utility')).toBeDefined()
  })

  it('shows a locked state instead of class composer controls for generated utilities', () => {
    useEditorStore.setState({
      activeClassId: GENERATED_CLASS_ID,
      site: {
        ...useEditorStore.getState().site!,
        pages: [
          {
            ...useEditorStore.getState().site!.pages[0],
            nodes: {
              ...useEditorStore.getState().site!.pages[0].nodes,
              hero: {
                ...useEditorStore.getState().site!.pages[0].nodes.hero,
                classIds: [GENERATED_CLASS_ID],
              },
            },
          },
        ],
      },
    } as Parameters<typeof useEditorStore.setState>[0])

    render(<PropertiesPanel variant="docked" />)

    const panel = screen.getByTestId('properties-panel')
    expect(within(panel).getByText('Generated utility')).toBeDefined()
    expect(within(panel).getByText(/utility classes have a single purpose/i)).toBeDefined()
    expect(within(panel).queryByRole('searchbox', { name: /search class style properties to add/i })).toBeNull()
  })

  it('shows the locked state when a generated utility is opened from the selectors panel', () => {
    // Reproduces the regression where clicking a utility class in the
    // SelectorsPanel routes through `SelectorInspector` and previously
    // rendered an editable ClassComposer instead of the locked state.
    useEditorStore.setState({
      selectedNodeId: null,
    selectedNodeIds: [],
      activeClassId: GENERATED_CLASS_ID,
      selectedSelectorClassId: GENERATED_CLASS_ID,
    } as Parameters<typeof useEditorStore.setState>[0])

    render(<PropertiesPanel variant="docked" />)

    const panel = screen.getByTestId('properties-panel')
    expect(within(panel).getByText('Generated utility')).toBeDefined()
    expect(within(panel).getByText(/utility classes have a single purpose/i)).toBeDefined()
    expect(within(panel).queryByRole('searchbox', { name: /search class style properties to add/i })).toBeNull()
  })

  it('marks generated utilities in the selectors panel and disables editing actions', () => {
    useEditorStore.setState({
      selectorsPanelOpen: true,
    } as Parameters<typeof useEditorStore.setState>[0])

    render(<SelectorsPanel variant="docked" />)

    const row = screen.getByRole('button', { name: /edit selector \.text-primary/i })
    expect(within(row).getByText('Utility')).toBeDefined()

    fireEvent.contextMenu(row)

    expect(screen.getByRole('menuitem', { name: /view utility/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /rename/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('menuitem', { name: /duplicate/i }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('menuitem', { name: /delete/i }).hasAttribute('disabled')).toBe(true)
  })
})
