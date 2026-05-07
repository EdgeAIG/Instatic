/**
 * treeBackgroundContextMenu.test.tsx
 *
 * Tests for the DOM panel's empty-area right-click menu:
 * - "Insert module" submenu trigger is always present.
 * - Hovering opens a `ContextMenuSubmenu` with the shared `ModulePicker`.
 * - Picking a base module inserts it as a child of the page root.
 * - Picking a Visual Component inserts a `base.visual-component-ref` at root.
 * - Paste only appears when the clipboard has an entry; clicking pastes at root.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { TreeBackgroundContextMenu } from '../../editor/components/DomPanel/TreeBackgroundContextMenu'
import { useEditorStore } from '@core/editor-store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import type { VisualComponent } from '@core/visualComponents/schemas'
import '../../modules/base/index'

afterEach(cleanup)

function makeVC(id: string, name: string): VisualComponent {
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
    params: [],
    breakpoints: [],
    classIds: [],
    createdAt: 1_700_000_000_000,
  }
}

function resetStore(vcs: VisualComponent[] = []) {
  localStorage.clear()
  const home = makePage({
    id: 'page-home',
    title: 'Home',
    slug: 'index',
    rootNodeId: 'root-home',
    nodes: {
      'root-home': makeNode({ id: 'root-home', moduleId: 'base.body', children: [] }),
    },
  })
  useEditorStore.setState({
    site: makeSite({ pages: [home], files: [], visualComponents: vcs }),
    activePageId: 'page-home',
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeDocument: null,
    clipboardEntry: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

const noop = () => {}

function renderMenu(vcs: VisualComponent[] = []) {
  resetStore(vcs)
  return render(
    <TreeBackgroundContextMenu
      x={100}
      y={200}
      onClose={noop}
    />,
  )
}

function openInsertSubmenu() {
  const trigger = screen.getByRole('menuitem', { name: /insert module/i })
  fireEvent.mouseEnter(trigger)
  return trigger
}

beforeEach(() => resetStore())

describe('TreeBackgroundContextMenu — Insert module submenu', () => {
  it('renders the "Insert module" submenu trigger', () => {
    renderMenu()
    expect(screen.getByRole('menuitem', { name: /insert module/i })).toBeDefined()
  })

  it('opens the module picker submenu on hover', () => {
    renderMenu()
    openInsertSubmenu()

    expect(screen.getByRole('menu', { name: 'Insert module' })).toBeDefined()
    expect(screen.getByRole('searchbox', { name: 'Search modules' })).toBeDefined()
  })

  it('inserts a base module at the page root when picked', () => {
    renderMenu()
    openInsertSubmenu()

    const submenu = screen.getByRole('menu', { name: 'Insert module' })
    const textOption = within(submenu).getAllByRole('menuitem').find(
      (el) => el.getAttribute('data-module-id') === 'base.text',
    )
    expect(textOption).toBeDefined()
    fireEvent.click(textOption!)

    const state = useEditorStore.getState()
    const page = state.site?.pages.find((p) => p.id === 'page-home')
    const root = page?.nodes['root-home']
    expect(root?.children.length).toBe(1)

    const insertedId = root?.children[0]
    const inserted = insertedId ? page?.nodes[insertedId] : null
    expect(inserted?.moduleId).toBe('base.text')
  })

  it('inserts a Visual Component at the page root when picked', () => {
    const vc = makeVC('vc-abc', 'MyCard')
    renderMenu([vc])
    openInsertSubmenu()

    const submenu = screen.getByRole('menu', { name: 'Insert module' })
    const vcItem = submenu.querySelector('[data-vc-id="vc-abc"]') as HTMLElement
    expect(vcItem).not.toBeNull()
    fireEvent.click(vcItem)

    const state = useEditorStore.getState()
    const page = state.site?.pages.find((p) => p.id === 'page-home')
    const root = page?.nodes['root-home']
    expect(root?.children.length).toBe(1)

    const insertedId = root?.children[0]
    const inserted = insertedId ? page?.nodes[insertedId] : null
    expect(inserted?.moduleId).toBe('base.visual-component-ref')
    expect(inserted?.props.componentId).toBe('vc-abc')
  })
})

describe('TreeBackgroundContextMenu — Paste action', () => {
  it('Paste is NOT present when clipboard is empty', () => {
    renderMenu()
    expect(screen.queryByRole('menuitem', { name: /^paste$/i })).toBeNull()
  })

  it('Paste IS present when clipboard has an entry', () => {
    resetStore()

    // Seed a clipboard entry by copying an actual node first. We add a node,
    // copy it via the public store action, then render the menu. This keeps
    // the test path identical to the runtime path (no faked entries).
    const insertedId = useEditorStore.getState().insertNode(
      'base.text',
      {},
      'root-home',
    )
    useEditorStore.getState().copyNode(insertedId)

    render(
      <TreeBackgroundContextMenu
        x={100}
        y={200}
        onClose={noop}
      />,
    )

    expect(screen.getByRole('menuitem', { name: /^paste$/i })).toBeDefined()
  })

  it('clicking Paste pastes the clipboard subtree at the page root', () => {
    resetStore()

    // Build a small subtree under root, copy one node, then delete it so the
    // paste lands at root rather than as a sibling next to the original.
    const containerId = useEditorStore.getState().insertNode(
      'base.container',
      {},
      'root-home',
    )
    useEditorStore.getState().copyNode(containerId)
    useEditorStore.getState().deleteNode(containerId)

    // Sanity check — clipboard is set, root is empty.
    expect(useEditorStore.getState().clipboardEntry).not.toBeNull()
    {
      const page = useEditorStore.getState().site?.pages.find((p) => p.id === 'page-home')
      expect(page?.nodes['root-home']?.children.length).toBe(0)
    }

    render(
      <TreeBackgroundContextMenu
        x={100}
        y={200}
        onClose={noop}
      />,
    )

    const pasteItem = screen.getByRole('menuitem', { name: /^paste$/i })
    fireEvent.click(pasteItem)

    const state = useEditorStore.getState()
    const page = state.site?.pages.find((p) => p.id === 'page-home')
    const root = page?.nodes['root-home']
    expect(root?.children.length).toBe(1)

    const pastedId = root?.children[0]
    const pasted = pastedId ? page?.nodes[pastedId] : null
    expect(pasted?.moduleId).toBe('base.container')
    // Pasted subtree gets fresh ids — must NOT reuse the original.
    expect(pastedId).not.toBe(containerId)
  })
})
