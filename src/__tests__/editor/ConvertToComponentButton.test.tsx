/**
 * ConvertToComponentButton — component tests
 *
 * CTB-1  Idle state: "Componentize" button is rendered
 * CTB-2  Click → transitions to editing state (input + Create + Cancel)
 * CTB-3  Submit invalid name → role="alert" rendered, no VC created
 * CTB-4  Submit valid name → activeDocument switches to new VC
 * CTB-5  Escape key → cancels back to idle
 * CTB-6  Cancel button → cancels back to idle
 *
 * @see src/editor/components/PropertiesPanel/ConvertToComponentButton.tsx
 * @see Contribution #619 Phase 3 §3
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ConvertToComponentButton } from '../../editor/components/PropertiesPanel/ConvertToComponentButton'
import { useEditorStore } from '@core/editor-store/store'
import { makeSite, makePage, makeNode } from '../fixtures'

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 280 },
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed the store with a page containing a non-root, non-ref node.
 * Returns the node id to pass as `nodeId` prop to ConvertToComponentButton.
 */
function setupPageWithNode(): { nodeId: string; rootId: string } {
  const rootId = 'root-1'
  const nodeId = 'text-1'
  const rootNode = makeNode({ id: rootId, moduleId: 'base.body', children: [nodeId] })
  const textNode = makeNode({ id: nodeId, moduleId: 'base.text', props: { text: 'Hello' }, children: [] })
  const page = makePage({
    id: 'page-1',
    rootNodeId: rootId,
    nodes: { [rootId]: rootNode, [nodeId]: textNode },
  })
  const site = makeSite({ pages: [page] })
  useEditorStore.setState({
    site,
    activePageId: 'page-1',
    activeDocument: { kind: 'page', pageId: 'page-1' },
  } as Parameters<typeof useEditorStore.setState>[0])
  return { nodeId, rootId }
}

// ---------------------------------------------------------------------------
// CTB-1 — idle state renders "Componentize" button
// ---------------------------------------------------------------------------

describe('CTB-1 — idle state', () => {
  it('renders a "Componentize" button in idle state', () => {
    render(<ConvertToComponentButton nodeId="any" />)
    expect(screen.getByRole('button', { name: /componentize/i })).toBeDefined()
  })

  it('does NOT show the name input in idle state', () => {
    render(<ConvertToComponentButton nodeId="any" />)
    expect(screen.queryByRole('textbox', { name: /component name/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CTB-2 — click → editing state with input + Create + Cancel
// ---------------------------------------------------------------------------

describe('CTB-2 — click transitions to editing state', () => {
  it('shows the component name input, Create button, and Cancel button after click', () => {
    render(<ConvertToComponentButton nodeId="any" />)

    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))

    expect(screen.getByRole('textbox', { name: /component name/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /create/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /cancel/i })).toBeDefined()
  })

  it('hides the "Componentize" button when in editing state', () => {
    render(<ConvertToComponentButton nodeId="any" />)

    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))

    expect(screen.queryByRole('button', { name: /componentize/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CTB-3 — submit invalid name → role="alert", no VC created
// ---------------------------------------------------------------------------

describe('CTB-3 — invalid name shows alert and does not create a VC', () => {
  it('typing a duplicate name and pressing Enter shows a validation alert', () => {
    // Seed a page with a node AND a pre-existing VC named "Taken" so the
    // duplicate-name validation triggers PROJECT_DUPLICATE.
    const { nodeId } = setupPageWithNode()
    const existingVc = {
      id: 'vc-existing',
      name: 'Taken',
      rootNode: { id: 'r', moduleId: 'base.body', props: {}, children: [], breakpointOverrides: {}, classIds: [] },
      params: [],
      breakpoints: [],
      classIds: [],
      createdAt: 1,
    }
    useEditorStore.setState((s) => ({
      site: { ...s.site!, visualComponents: [existingVc] },
    }) as Parameters<typeof useEditorStore.setState>[0])

    render(<ConvertToComponentButton nodeId={nodeId} />)

    // Enter editing state
    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))

    const input = screen.getByRole('textbox', { name: /component name/i }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Taken' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // Error alert must appear
    expect(screen.getByRole('alert')).toBeDefined()
    // No new VC should have been created (the seeded one remains)
    expect(useEditorStore.getState().site!.visualComponents).toHaveLength(1)
  })

  it('clicking Create with an empty name is a no-op (no alert, no VC)', () => {
    const site = makeSite({ visualComponents: [] })
    useEditorStore.setState({ site } as Parameters<typeof useEditorStore.setState>[0])

    render(<ConvertToComponentButton nodeId="any-node" />)

    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))
    // Input value is '' (defaultValue="")
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    // Empty name is guarded by `if (!name) return` — no alert, no VC
    expect(screen.queryByRole('alert')).toBeNull()
    expect(useEditorStore.getState().site!.visualComponents).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// CTB-4 — valid name → activeDocument switches to new VC
// ---------------------------------------------------------------------------

describe('CTB-4 — valid name converts node and switches to VC canvas', () => {
  it('pressing Enter with a valid name creates a VC and switches activeDocument', () => {
    const { nodeId } = setupPageWithNode()

    render(<ConvertToComponentButton nodeId={nodeId} />)

    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))

    const input = screen.getByRole('textbox', { name: /component name/i }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'MyCard' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // activeDocument must switch to the new VC
    const activeDoc = useEditorStore.getState().activeDocument
    expect(activeDoc?.kind).toBe('visualComponent')

    // The new VC must be in site.visualComponents
    expect(useEditorStore.getState().site!.visualComponents).toHaveLength(1)
    expect(useEditorStore.getState().site!.visualComponents[0].name).toBe('MyCard')
  })

  it('clicking Create with a valid name also converts the node', () => {
    const { nodeId } = setupPageWithNode()

    render(<ConvertToComponentButton nodeId={nodeId} />)

    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))

    const input = screen.getByRole('textbox', { name: /component name/i }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'HeroSection' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

    expect(useEditorStore.getState().activeDocument?.kind).toBe('visualComponent')
  })
})

// ---------------------------------------------------------------------------
// CTB-5 — Escape key → cancels back to idle
// ---------------------------------------------------------------------------

describe('CTB-5 — Escape key cancels back to idle', () => {
  it('pressing Escape in the name input resets to idle state', () => {
    render(<ConvertToComponentButton nodeId="any" />)

    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))
    expect(screen.getByRole('textbox', { name: /component name/i })).toBeDefined()

    const input = screen.getByRole('textbox', { name: /component name/i })
    fireEvent.keyDown(input, { key: 'Escape' })

    // Input and action buttons gone; "Componentize" button back
    expect(screen.queryByRole('textbox', { name: /component name/i })).toBeNull()
    expect(screen.getByRole('button', { name: /componentize/i })).toBeDefined()
  })

  it('Escape also clears any inline validation error', () => {
    // Seed a page-with-node site that already has a VC named "Taken" so
    // typing "Taken" triggers PROJECT_DUPLICATE.
    const { nodeId } = setupPageWithNode()
    const existingVc = {
      id: 'vc-existing',
      name: 'Taken',
      rootNode: { id: 'r', moduleId: 'base.body', props: {}, children: [], breakpointOverrides: {}, classIds: [] },
      params: [],
      breakpoints: [],
      classIds: [],
      createdAt: 1,
    }
    useEditorStore.setState((s) => ({
      site: { ...s.site!, visualComponents: [existingVc] },
    }) as Parameters<typeof useEditorStore.setState>[0])

    render(<ConvertToComponentButton nodeId={nodeId} />)

    // Produce a validation error first
    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))
    const input = screen.getByRole('textbox', { name: /component name/i })
    fireEvent.change(input, { target: { value: 'Taken' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toBeDefined()

    // Escape cancels and clears the error
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /componentize/i })).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// CTB-6 — Cancel button → cancels back to idle
// ---------------------------------------------------------------------------

describe('CTB-6 — Cancel button returns to idle', () => {
  it('clicking Cancel resets to idle state', () => {
    render(<ConvertToComponentButton nodeId="any" />)

    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))
    expect(screen.getByRole('textbox', { name: /component name/i })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(screen.queryByRole('textbox', { name: /component name/i })).toBeNull()
    expect(screen.getByRole('button', { name: /componentize/i })).toBeDefined()
  })

  it('Cancel also clears a validation error', () => {
    const { nodeId } = setupPageWithNode()
    const existingVc = {
      id: 'vc-existing',
      name: 'Taken',
      rootNode: { id: 'r', moduleId: 'base.body', props: {}, children: [], breakpointOverrides: {}, classIds: [] },
      params: [],
      breakpoints: [],
      classIds: [],
      createdAt: 1,
    }
    useEditorStore.setState((s) => ({
      site: { ...s.site!, visualComponents: [existingVc] },
    }) as Parameters<typeof useEditorStore.setState>[0])

    render(<ConvertToComponentButton nodeId={nodeId} />)

    // Produce a validation error
    fireEvent.click(screen.getByRole('button', { name: /componentize/i }))
    const input = screen.getByRole('textbox', { name: /component name/i })
    fireEvent.change(input, { target: { value: 'Taken' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByRole('alert')).toBeDefined()

    // Cancel clears it
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: /componentize/i })).toBeDefined()
  })
})
