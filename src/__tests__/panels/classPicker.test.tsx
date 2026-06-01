/**
 * Component-level tests for `ClassPicker`.
 *
 * The unit-level derivation logic is covered by `useClassPickerSuggestions.test.ts`;
 * this file exercises the rendered component end-to-end (input ↔ store ↔ DOM)
 * to drive the parent component's coverage and push its CRAP score below the
 * "critical" threshold without further extraction.
 *
 * Each test stands up a fresh editor store, a single-node page, renders
 * `<ClassPicker nodeId={...} />`, and drives it through DOM events the same
 * way a user would. Class state lives in the store; assertions read it back
 * via `useEditorStore.getState()`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ClassPicker } from '@site/panels/PropertiesPanel/ClassPicker'
import { useEditorStore } from '@site/store/store'
import { makeSite, makePage, makeNode } from '../fixtures'
import '@modules/base/index'

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Store setup
// ---------------------------------------------------------------------------

function resetStore() {
  localStorage.clear()
  document.body.innerHTML = ''
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    activeClassId: null,
    previewClassAssignment: null,
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

beforeEach(resetStore)

function loadSiteWithNode(): { nodeId: string } {
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
  const site = makeSite({ pages: [page] })
  useEditorStore.setState({ site, activePageId: 'page-1' } as Parameters<typeof useEditorStore.setState>[0])
  return { nodeId }
}

function selectClass(nodeId: string, name: string) {
  const state = useEditorStore.getState()
  const cls = state.createClass(name)
  state.addNodeClass(nodeId, cls.id)
  return cls
}

function createAmbient(selector: string) {
  return useEditorStore.getState().createAmbientRule({ selector })
}

function addRenderedCanvasElement(html: string) {
  const host = document.createElement('div')
  host.setAttribute('data-testid', 'canvas-host')
  host.innerHTML = html
  document.body.appendChild(host)
}

function addRenderedCanvasFrame(html: string) {
  const frame = document.createElement('iframe')
  document.body.appendChild(frame)
  if (!frame.contentDocument) throw new Error('Test iframe did not create a contentDocument')
  frame.contentDocument.body.innerHTML = html
}

// ---------------------------------------------------------------------------
// Renders
// ---------------------------------------------------------------------------

describe('ClassPicker — rendering', () => {
  it('renders the search input with the expected placeholder', () => {
    const { nodeId } = loadSiteWithNode()
    render(<ClassPicker nodeId={nodeId} />)
    expect(screen.getByPlaceholderText('Add or create selector…')).toBeTruthy()
  })

  it('renders an assigned class as a selector pill with a dotted class label', () => {
    const { nodeId } = loadSiteWithNode()
    selectClass(nodeId, 'header')
    render(<ClassPicker nodeId={nodeId} />)
    // Class-kind rules display as CSS selectors so they are visually distinct
    // from ambient selectors and plain text.
    expect(screen.getByRole('button', { name: /edit class \.header|deselect class \.header/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Remove class .header' })).toBeTruthy()
  })

  it('renders the trailing action node when supplied', () => {
    const { nodeId } = loadSiteWithNode()
    render(
      <ClassPicker nodeId={nodeId} trailingAction={<span data-testid="trailing">tt</span>} />,
    )
    expect(screen.getByTestId('trailing')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Input → suggestions flow
// ---------------------------------------------------------------------------

describe('ClassPicker — search + create', () => {
  it('shows the create-new affordance when typing a name no class has', async () => {
    const user = userEvent.setup()
    const { nodeId } = loadSiteWithNode()
    render(<ClassPicker nodeId={nodeId} />)

    const input = screen.getByPlaceholderText('Add or create selector…')
    await user.click(input)
    await user.type(input, 'brand-new')
    expect(screen.getByText('+ Create class “.brand-new”')).toBeTruthy()

    // Submit button tooltip surfaces the create intent.
    const submit = screen.getByRole('button', { name: 'Submit selector' })
    expect(submit.getAttribute('aria-label')).toBe('Submit selector')
    expect(submit.hasAttribute('disabled')).toBe(false)

    await user.click(submit)
    // Class should now exist on the node.
    const state = useEditorStore.getState()
    const node = state.site!.pages[0].nodes[nodeId]
    const classNames = node.classIds.map((id) => state.site!.styleRules[id]?.name)
    expect(classNames).toContain('brand-new')
  })

  it('disables the submit button when query is empty', () => {
    const { nodeId } = loadSiteWithNode()
    render(<ClassPicker nodeId={nodeId} />)
    const submit = screen.getByRole('button', { name: 'Submit selector' })
    // Button + tooltip combo uses aria-disabled rather than the native
    // attribute so mouseenter still fires the tooltip.
    expect(submit.getAttribute('aria-disabled')).toBe('true')
  })

  it('submitting an exact-match name on an unassigned class adds the class', async () => {
    const user = userEvent.setup()
    const { nodeId } = loadSiteWithNode()
    // Pre-create a class that the node doesn't have yet.
    const cls = useEditorStore.getState().createClass('header')
    render(<ClassPicker nodeId={nodeId} />)

    const input = screen.getByPlaceholderText('Add or create selector…')
    await user.click(input)
    await user.type(input, 'header')
    await user.keyboard('{Enter}')

    const node = useEditorStore.getState().site!.pages[0].nodes[nodeId]
    expect(node.classIds).toContain(cls.id)
  })

  it('Escape on a non-empty query closes the suggestions dropdown', async () => {
    const user = userEvent.setup()
    const { nodeId } = loadSiteWithNode()
    useEditorStore.getState().createClass('alpha')
    render(<ClassPicker nodeId={nodeId} />)

    const input = screen.getByPlaceholderText('Add or create selector…')
    await user.click(input)
    await user.type(input, 'a')

    // Suggestion menu is open. Escape closes it.
    await user.keyboard('{Escape}')
    // Submit button should still exist; the dropdown contextmenu is gone
    // (Suggestions dropdown is portaled; checking it disappears via DOM presence.)
    expect(screen.queryByRole('menu', { name: 'Selector suggestions' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Pill interactions
// ---------------------------------------------------------------------------

describe('ClassPicker — assigned pill', () => {
  it('clicking a pill toggles activeClassId in the store', async () => {
    const user = userEvent.setup()
    const { nodeId } = loadSiteWithNode()
    const cls = selectClass(nodeId, 'card')
    render(<ClassPicker nodeId={nodeId} />)

    const pill = screen.getByRole('button', { name: /edit class \.card|deselect class \.card/i })
    await user.click(pill)
    expect(useEditorStore.getState().activeClassId).toBe(cls.id)

    await user.click(pill)
    expect(useEditorStore.getState().activeClassId).toBeNull()
  })

  it('clicking the X removes the class from the node but keeps it in the registry', async () => {
    const user = userEvent.setup()
    const { nodeId } = loadSiteWithNode()
    const cls = selectClass(nodeId, 'card')
    render(<ClassPicker nodeId={nodeId} />)

    const remove = screen.getByRole('button', { name: 'Remove class .card' })
    await user.click(remove)

    const node = useEditorStore.getState().site!.pages[0].nodes[nodeId]
    expect(node.classIds).not.toContain(cls.id)
    // Class definition itself survives.
    expect(useEditorStore.getState().site!.styleRules[cls.id]?.name).toBe('card')
  })

  it('Enter on a focused pill toggles activeClassId via keyboard', () => {
    const { nodeId } = loadSiteWithNode()
    const cls = selectClass(nodeId, 'header')
    render(<ClassPicker nodeId={nodeId} />)

    const pill = screen.getByRole('button', { name: /edit class \.header|deselect class \.header/i })
    const initiallyActive = useEditorStore.getState().activeClassId === cls.id
    pill.focus()
    fireEvent.keyDown(pill, { key: 'Enter' })

    expect(useEditorStore.getState().activeClassId).toBe(initiallyActive ? null : cls.id)
  })

  it('right-click on a pill opens a class context menu', () => {
    const { nodeId } = loadSiteWithNode()
    selectClass(nodeId, 'header')
    render(<ClassPicker nodeId={nodeId} />)

    const pill = screen.getByRole('button', { name: /edit class \.header|deselect class \.header/i })
    fireEvent.contextMenu(pill, { clientX: 0, clientY: 0 })

    // Context menu opens — assert at least the Remove item is present.
    expect(screen.getByRole('menuitem', { name: /remove from this element/i })).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Ambient selector pills + suggestions
// ---------------------------------------------------------------------------

describe('ClassPicker — ambient selectors', () => {
  it('renders a matching ambient selector as a non-removable pill that can be edited', async () => {
    const user = userEvent.setup()
    const { nodeId } = loadSiteWithNode()
    addRenderedCanvasElement(`<section class="hero"><h1 data-node-id="${nodeId}" class="title"></h1></section>`)
    const ambient = createAmbient('.hero .title')

    render(<ClassPicker nodeId={nodeId} />)

    const pill = screen.getByRole('button', { name: 'Edit selector .hero .title' })
    expect(pill).toBeTruthy()
    const remove = screen.getByRole('button', { name: 'Remove selector .hero .title' })
    expect(remove.getAttribute('aria-disabled')).toBe('true')

    await user.click(pill)
    expect(useEditorStore.getState().activeClassId).toBe(ambient.id)
  })

  it('shows non-matching ambient selectors as disabled dropdown rows', async () => {
    const user = userEvent.setup()
    const { nodeId } = loadSiteWithNode()
    addRenderedCanvasElement(`<h1 data-node-id="${nodeId}" class="title"></h1>`)
    createAmbient('.card')

    render(<ClassPicker nodeId={nodeId} />)

    const input = screen.getByPlaceholderText('Add or create selector…')
    await user.click(input)

    expect(screen.getByText('Ambient selectors')).toBeTruthy()
    expect(screen.getByText("Doesn't match this element")).toBeTruthy()
    const row = screen.getByRole('menuitem', { name: /\.card doesn't match this element/i })
    expect(row.getAttribute('aria-disabled')).toBe('true')
  })

  it('matches ambient selectors against elements inside the canvas iframe', () => {
    const { nodeId } = loadSiteWithNode()
    addRenderedCanvasFrame(`<h1 data-node-id="${nodeId}" class="title"></h1>`)
    createAmbient('*')

    render(<ClassPicker nodeId={nodeId} />)

    expect(screen.getByRole('button', { name: 'Edit selector *' })).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Empty-query suggestions sections
// ---------------------------------------------------------------------------

describe('ClassPicker — empty-query suggestions', () => {
  it('opens the suggestions dropdown on focus and lists All-classes when there is no usage history', () => {
    const { nodeId } = loadSiteWithNode()
    useEditorStore.getState().createClass('alpha')
    useEditorStore.getState().createClass('beta')
    render(<ClassPicker nodeId={nodeId} />)

    const input = screen.getByPlaceholderText('Add or create selector…')
    act(() => input.focus())

    // Both class-kind rules should appear with their CSS class selector prefix.
    expect(screen.getByRole('menuitem', { name: '.alpha' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '.beta' })).toBeTruthy()
  })

  it('clicking a suggestion assigns it to the node', async () => {
    const user = userEvent.setup()
    const { nodeId } = loadSiteWithNode()
    const cls = useEditorStore.getState().createClass('alpha')
    render(<ClassPicker nodeId={nodeId} />)

    const input = screen.getByPlaceholderText('Add or create selector…')
    await user.click(input)

    const item = await screen.findByRole('menuitem', { name: '.alpha' })
    await user.click(item)

    const node = useEditorStore.getState().site!.pages[0].nodes[nodeId]
    expect(node.classIds).toContain(cls.id)
  })
})
