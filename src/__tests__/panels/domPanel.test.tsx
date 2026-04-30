/**
 * DomPanel DOM integration tests — J6 (Guideline #213 / #221 / #234).
 *
 * Covers:
 *   1. data-testid="dom-panel" / "dom-panel-ready" present (Guideline #221)
 *   2. role="complementary" + aria-label on panel container
 *   3. Empty state text shown when page has only root node
 *   4. "No project loaded" state when project is null
 *   5. data-panel attribute present (event propagation guard, Guideline #192)
 *   6. Toggle button aria-expanded reflects collapsed state
 *   7. Collapse toggle: panel collapses and focus moves to toggle button
 *   8. Tree container has role="tree" when page is loaded
 *   9. Tree node rows have tabIndex=0 and role="treeitem" (Guideline #234)
 *  10. Tree node rows use shared 28px compact TreeRow height
 *  11. Tree node focus ring: boxShadow changes on focus/blur
 *  12. stopPropagation on panel click (Guideline #192)
 *
 * Uses @testing-library/react for all tests — requires the happy-dom GlobalWindow
 * setup from src/__tests__/setup.ts (preloaded via bunfig.toml).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import React from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { DomPanel } from '../../editor/components/DomPanel/DomPanel'
import { useEditorStore } from '../../core/editor-store/store'
import { makeProject, makePage, makeNode } from '../fixtures'

const TREE_ROW_CSS_PATH = join(import.meta.dir, '../../editor/ui/Tree/TreeRow.module.css')
const TREE_NODE_CSS_PATH = join(import.meta.dir, '../../editor/components/DomPanel/TreeNode.module.css')
const TREE_NODE_SOURCE_PATH = join(import.meta.dir, '../../editor/components/DomPanel/TreeNode.tsx')
const DOM_PANEL_SOURCE_PATH = join(import.meta.dir, '../../editor/components/DomPanel/DomPanel.tsx')

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore() {
  // Clear localStorage so the panel's restore-on-mount effect doesn't override
  // the store state we set below (the component reads from localStorage on mount).
  localStorage.clear()
  useEditorStore.setState({
    project: null,
    activePageId: null,
    selectedNodeId: null,
    hoveredNodeId: null,
    domTreePanel: { collapsed: false, x: 0, y: 0, width: 280 },
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 280 },
    focusedPanel: 'canvas',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

/** Load a project into the store (simulates opening a project). */
function loadProject(rootHasChildren = false) {
  const rootId = 'root-1'
  const childId = 'node-child-1'

  const nodes: Record<string, ReturnType<typeof makeNode>> = {
    [rootId]: makeNode({ id: rootId, moduleId: 'base.root', children: rootHasChildren ? [childId] : [] }),
  }
  if (rootHasChildren) {
    nodes[childId] = makeNode({ id: childId, moduleId: 'base.heading', children: [] })
  }

  const page = makePage({ id: 'page-1', rootNodeId: rootId, nodes })
  const project = makeProject({ pages: [page] })

  useEditorStore.setState({
    project,
    activePageId: 'page-1',
  } as Parameters<typeof useEditorStore.setState>[0])
}

function loadContainerProject() {
  const rootId = 'root-1'
  const containerId = 'container-1'
  const textId = 'text-1'

  const nodes: Record<string, ReturnType<typeof makeNode>> = {
    [rootId]: makeNode({ id: rootId, moduleId: 'base.root', children: [containerId] }),
    [containerId]: makeNode({ id: containerId, moduleId: 'base.container', children: [textId] }),
    [textId]: makeNode({ id: textId, moduleId: 'base.text', children: [] }),
  }

  const page = makePage({ id: 'page-1', rootNodeId: rootId, nodes })
  const project = makeProject({ pages: [page] })

  useEditorStore.setState({
    project,
    activePageId: 'page-1',
  } as Parameters<typeof useEditorStore.setState>[0])
}

function loadSiblingContainerProject() {
  const rootId = 'root-1'
  const firstContainerId = 'container-1'
  const firstTextId = 'text-1'
  const secondContainerId = 'container-2'
  const secondTextId = 'text-2'

  const nodes: Record<string, ReturnType<typeof makeNode>> = {
    [rootId]: makeNode({
      id: rootId,
      moduleId: 'base.root',
      children: [firstContainerId, secondContainerId],
    }),
    [firstContainerId]: makeNode({
      id: firstContainerId,
      moduleId: 'base.container',
      children: [firstTextId],
    }),
    [firstTextId]: makeNode({ id: firstTextId, moduleId: 'base.text', children: [] }),
    [secondContainerId]: makeNode({
      id: secondContainerId,
      moduleId: 'base.container',
      children: [secondTextId],
    }),
    [secondTextId]: makeNode({ id: secondTextId, moduleId: 'base.text', children: [] }),
  }

  const page = makePage({ id: 'page-1', rootNodeId: rootId, nodes })
  const project = makeProject({ pages: [page] })

  useEditorStore.setState({
    project,
    activePageId: 'page-1',
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

// ---------------------------------------------------------------------------
// 1 — data-testid (Guideline #221)
// ---------------------------------------------------------------------------

describe('DomPanel — data-testid (Guideline #221)', () => {
  it('renders data-testid="dom-panel" when no project is loaded', () => {
    render(<DomPanel />)
    expect(screen.getByTestId('dom-panel')).toBeDefined()
  })

  it('renders data-testid="dom-panel-ready" once a project/page is loaded', () => {
    loadProject()
    render(<DomPanel />)
    expect(screen.getByTestId('dom-panel-ready')).toBeDefined()
  })

  it('data-testid="dom-panel-tree" present inside loaded panel', () => {
    loadProject(true)
    render(<DomPanel />)
    expect(screen.getByTestId('dom-panel-tree')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 2 — ARIA landmark (role + aria-label)
// ---------------------------------------------------------------------------

describe('DomPanel — ARIA landmark', () => {
  it('has role="complementary" on panel container', () => {
    render(<DomPanel />)
    const panel = screen.getByRole('complementary')
    expect(panel).toBeDefined()
  })

  it('has aria-label="DOM tree panel"', () => {
    render(<DomPanel />)
    const panel = screen.getByLabelText('DOM tree panel')
    expect(panel).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 3 — Empty states
// ---------------------------------------------------------------------------

describe('DomPanel — empty states', () => {
  it('shows "No project loaded" when project is null', () => {
    render(<DomPanel />)
    expect(screen.getByText('No project loaded')).toBeDefined()
  })

  it('shows "no elements" hint when page has only root node', () => {
    loadProject(false) // only root, no children
    render(<DomPanel />)
    expect(screen.getByText(/no elements yet/i)).toBeDefined()
  })

  it('renders tree rows when page has child nodes', () => {
    loadProject(true) // root + 1 child
    render(<DomPanel />)
    // Tree rows with role=treeitem should exist
    const treeItems = screen.getAllByRole('treeitem')
    expect(treeItems.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// 4 — data-panel attribute (Guideline #192)
// ---------------------------------------------------------------------------

describe('DomPanel — data-panel attribute (Guideline #192)', () => {
  it('panel container carries data-panel attribute for event guard', () => {
    render(<DomPanel />)
    const panel = screen.getByRole('complementary')
    expect(panel.hasAttribute('data-panel')).toBe(true)
  })

  it('click events on the panel do not propagate to parent (stopPropagation)', () => {
    let parentClicked = false
    render(
      <div onClick={() => { parentClicked = true }}>
        <DomPanel />
      </div>
    )
    const panel = screen.getByRole('complementary')
    fireEvent.click(panel)
    expect(parentClicked).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5 — Close button (replaced old collapse toggle)
//     Panel now fully hides when collapsed=true — no icon strip.
//     Header shows a close (✕) button that triggers toggleDomTreePanel.
// ---------------------------------------------------------------------------

describe('DomPanel — collapse toggle', () => {
  it('close button is visible when panel is open', () => {
    render(<DomPanel />)
    const btn = screen.getByRole('button', { name: /close layers panel/i })
    expect(btn).toBeDefined()
  })

  it('clicking close button hides the panel (collapsed becomes true, renders null)', () => {
    render(<DomPanel />)
    const btn = screen.getByRole('button', { name: /close layers panel/i })
    fireEvent.click(btn)
    // After closing, the panel root is fully unmounted (collapsed=true → null)
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('panel renders nothing when collapsed=true (fully closed, no icon strip)', () => {
    useEditorStore.setState({
      domTreePanel: { collapsed: true, x: 0, y: 0, width: 280 },
    } as Parameters<typeof useEditorStore.setState>[0])
    render(<DomPanel />)
    // Panel is fully unmounted — no complementary landmark or strip
    expect(screen.queryByRole('complementary')).toBeNull()
  })

  it('"Layers" heading is visible when panel is expanded', () => {
    render(<DomPanel />)
    expect(screen.getByText('Layers')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 6 — Tree accessibility (role="tree", role="treeitem", tabIndex, minHeight)
// ---------------------------------------------------------------------------

describe('DomPanel — tree accessibility', () => {
  it('tree container has role="tree" (WAI-ARIA tree pattern)', () => {
    loadProject(true)
    render(<DomPanel />)
    const tree = screen.getByRole('tree')
    expect(tree).toBeDefined()
  })

  it('tree has aria-label="Page element tree"', () => {
    loadProject(true)
    render(<DomPanel />)
    const tree = screen.getByRole('tree')
    expect(tree.getAttribute('aria-label')).toBe('Page element tree')
  })

  it('tree node rows have role="treeitem" (Guideline #234)', () => {
    loadProject(true)
    render(<DomPanel />)
    const items = screen.getAllByRole('treeitem')
    expect(items.length).toBeGreaterThan(0)
  })

  it('tree node rows have tabIndex=0 for keyboard navigation', () => {
    loadProject(true)
    render(<DomPanel />)
    const items = screen.getAllByRole('treeitem')
    for (const item of items) {
      expect(item.getAttribute('tabindex')).toBe('0')
    }
  })

  it('tree node rows have compact height of 28px (Guideline #357 — compact density)', () => {
    // Guideline #357 (user directive #1532): WCAG 2.5.5 touch target requirement
    // is explicitly waived for editor chrome. Row height is 28px for compact density.
    // Shared TreeRow owns the row visual contract for structural trees.
    // (CSS Modules are not injected into happy-dom, so DOM class checks are unreliable).
    const css = readFileSync(TREE_ROW_CSS_PATH, 'utf8')
    // Find the .row block and check height is 28px
    const hasCompactHeight = /\.row\s*\{[^}]*height:\s*28px/s.test(css)
    expect(hasCompactHeight).toBe(true)
  })

  it('drop indicators are CSS overlays that do not change tree row height', () => {
    const css = readFileSync(TREE_NODE_CSS_PATH, 'utf8')

    expect(css).toContain('.dropBefore::before')
    expect(css).toContain('.dropAfter::after')
    expect(css).toContain('position: absolute')

    const beforeAfterBlocks = css.match(/\.dropBefore::before,\n\.dropAfter::after\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(beforeAfterBlocks).not.toMatch(/(?:^|\n)\s*(height:\s*(?:2[89]|[3-9]\d)px|margin|padding)\b/)

    const insideBlock = css.match(/\.dropInside\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(insideBlock).toContain('outline')
    expect(insideBlock).not.toMatch(/(?:^|\n)\s*(height|margin|padding)\b/)
  })

  it('drag overlay is portaled outside the transformed panel to keep pointer alignment', () => {
    const source = readFileSync(DOM_PANEL_SOURCE_PATH, 'utf8')

    expect(source).toContain('createPortal')
    expect(source).toContain('document.body')
    expect(source).toMatch(/createPortal\(\s*dragOverlay/s)
  })

  it('selected tree node has aria-selected="true"', () => {
    loadProject(true)
    // Select the root node (root is always visible regardless of expand state)
    useEditorStore.setState({ selectedNodeId: 'root-1' } as Parameters<typeof useEditorStore.setState>[0])
    render(<DomPanel />)
    const selected = screen.getByRole('treeitem', { selected: true })
    expect(selected).toBeDefined()
  })

  it('unselected tree node has aria-selected="false"', () => {
    loadProject(true)
    useEditorStore.setState({ selectedNodeId: null } as Parameters<typeof useEditorStore.setState>[0])
    render(<DomPanel />)
    const items = screen.getAllByRole('treeitem')
    // All items should have aria-selected=false when nothing selected
    for (const item of items) {
      expect(item.getAttribute('aria-selected')).toBe('false')
    }
  })
})

// ---------------------------------------------------------------------------
// 7 — Open container group highlight
// ---------------------------------------------------------------------------

describe('DomPanel — open container group highlight', () => {
  it('marks the whole expanded container wrapper as an open group', () => {
    loadContainerProject()
    render(<DomPanel />)

    const rootItem = screen.getByRole('treeitem', { name: /root/i })
    fireEvent.click(rootItem)

    const containerWrapper = document.querySelector('[data-node-id="container-1"]')
    expect(containerWrapper?.getAttribute('data-open-container-group')).toBeNull()

    const containerItem = screen.getByRole('treeitem', { name: /container/i })
    fireEvent.click(containerItem)

    expect(containerWrapper?.getAttribute('data-open-container-group')).toBe('true')
  })

  it('styles open container groups with a rounded background on the wrapper', () => {
    const source = readFileSync(TREE_NODE_SOURCE_PATH, 'utf8')
    const rowCss = readFileSync(TREE_ROW_CSS_PATH, 'utf8')
    const css = readFileSync(TREE_NODE_CSS_PATH, 'utf8')

    expect(source).toContain('styles.openContainerGroup')
    expect(css).toContain('.openContainerGroup')

    const rowBlock = rowCss.match(/\.row\s*\{[^}]*\}/s)?.[0] ?? ''
    const block = css.match(/\.openContainerGroup\s*\{[^}]*\}/s)?.[0] ?? ''
    expect(block).toContain('background:')
    expect(rowBlock).toMatch(/border-radius:\s*8px/)
    expect(block).toMatch(/border-radius:\s*8px/)
    expect(block).not.toContain('18px')
  })

  it('moves the open group highlight when selecting a different expanded container', () => {
    loadSiblingContainerProject()
    render(<DomPanel />)

    fireEvent.click(screen.getByRole('treeitem', { name: /root/i }))

    const firstWrapper = document.querySelector('[data-node-id="container-1"]')
    const secondWrapper = document.querySelector('[data-node-id="container-2"]')

    const containerItems = screen.getAllByRole('treeitem', { name: /container/i })
    fireEvent.click(containerItems[0])

    expect(firstWrapper?.getAttribute('data-open-container-group')).toBe('true')
    expect(secondWrapper?.getAttribute('data-open-container-group')).toBeNull()

    fireEvent.click(containerItems[1])

    expect(firstWrapper?.getAttribute('data-open-container-group')).toBeNull()
    expect(secondWrapper?.getAttribute('data-open-container-group')).toBe('true')
  })
})

// ---------------------------------------------------------------------------
// 8 — Keyboard navigation in tree rows
// ---------------------------------------------------------------------------

describe('DomPanel — tree keyboard navigation', () => {
  it('pressing Enter on a tree row selects the node', () => {
    loadProject(true)
    useEditorStore.setState({ selectedNodeId: null } as Parameters<typeof useEditorStore.setState>[0])
    render(<DomPanel />)
    // Root is always the first (and only top-level) treeitem visible
    const items = screen.getAllByRole('treeitem')
    const rootItem = items[0]

    fireEvent.keyDown(rootItem, { key: 'Enter' })
    expect(useEditorStore.getState().selectedNodeId).toBe('root-1')
  })

  it('pressing Space on a tree row selects the node', () => {
    loadProject(true)
    useEditorStore.setState({ selectedNodeId: null } as Parameters<typeof useEditorStore.setState>[0])
    render(<DomPanel />)
    const items = screen.getAllByRole('treeitem')
    const rootItem = items[0]

    fireEvent.keyDown(rootItem, { key: ' ' })
    expect(useEditorStore.getState().selectedNodeId).toBe('root-1')
  })

  it('pressing ArrowRight on collapsed root expands its children', () => {
    loadProject(true)
    render(<DomPanel />)
    const items = screen.getAllByRole('treeitem')
    const rootItem = items[0]

    // Initially collapsed — no child items visible
    expect(screen.getAllByRole('treeitem').length).toBe(1)

    fireEvent.keyDown(rootItem, { key: 'ArrowRight' })
    // After expanding, child treeitem should appear
    expect(screen.getAllByRole('treeitem').length).toBe(2)
  })

  it('clicking a parent row expands its children like the Files tree', () => {
    loadProject(true)
    render(<DomPanel />)
    const rootItem = screen.getAllByRole('treeitem')[0]

    expect(screen.getAllByRole('treeitem').length).toBe(1)

    fireEvent.click(rootItem)

    expect(screen.getAllByRole('treeitem').length).toBe(2)
    expect(useEditorStore.getState().selectedNodeId).toBe('root-1')
  })

  it('commits inline tree rename to the node label', () => {
    loadContainerProject()
    render(<DomPanel />)

    fireEvent.click(screen.getByRole('treeitem', { name: /root/i }))
    const containerItem = screen.getByRole('treeitem', { name: /container/i })

    fireEvent.contextMenu(containerItem, { clientX: 40, clientY: 40 })
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    const input = screen.getByRole('textbox', { name: /rename base\.container/i }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Hero Group' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    const renamedNode = useEditorStore.getState().project?.pages[0].nodes['container-1']
    expect(renamedNode?.label).toBe('Hero Group')
    expect(renamedNode?.props.label).toBeUndefined()
    expect(screen.getByRole('treeitem', { name: /hero group/i })).toBeDefined()
  })
})
