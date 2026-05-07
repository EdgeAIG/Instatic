/**
 * ComponentParamsOverview — component tests
 *
 * CPO-1  Empty state — "Promote a property" hint shown when VC has zero params
 * CPO-2  Renders one row per param in declaration order
 * CPO-3  Click row → selectNode(originatingNodeId) called with correct id
 * CPO-4  Slot param click → selects the base.slot-outlet node
 * CPO-5  Remove × button → removeParamWithCleanup called, param spliced from store
 * CPO-6  Orphan param (no origin) row renders but click is disabled
 *
 * @see src/editor/components/PropertiesPanel/ComponentParamsOverview.tsx
 * @see Contribution #619 Phase 3 §2
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ComponentParamsOverview } from '../../editor/components/PropertiesPanel/ComponentParamsOverview'
import { useEditorStore } from '@core/editor-store/store'
import type { VisualComponent, VCNode, VCParam } from '@core/visualComponents/schemas'
import { makeSite } from '../fixtures'

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
// Minimal VC / VCNode / VCParam builder helpers
// ---------------------------------------------------------------------------

function makeVCNode(overrides: {
  id: string
  moduleId?: string
  props?: Record<string, unknown>
  children?: string[]
  classIds?: string[]
  propBindings?: Record<string, { paramId: string }>
  label?: string
}): VCNode {
  return {
    id: overrides.id,
    moduleId: overrides.moduleId ?? 'base.container',
    props: overrides.props ?? {},
    breakpointOverrides: {},
    children: overrides.children ?? [],
    classIds: overrides.classIds ?? [],
    ...(overrides.propBindings !== undefined && { propBindings: overrides.propBindings }),
    ...(overrides.label !== undefined && { label: overrides.label }),
  }
}

function makeVCParam(overrides: {
  id: string
  name: string
  type: VCParam['type']
  defaultValue?: unknown
  required?: boolean
  enumOptions?: string[]
}): VCParam {
  return {
    id: overrides.id,
    name: overrides.name,
    type: overrides.type,
    defaultValue: overrides.defaultValue ?? '',
    required: overrides.required ?? false,
    ...(overrides.enumOptions !== undefined && { enumOptions: overrides.enumOptions }),
  }
}

function makeVC(overrides: {
  id?: string
  name?: string
  params?: VCParam[]
  /** All nodes in the flat tree. First node is the root if rootId is not specified. */
  nodes?: VCNode[]
  rootId?: string
}): VisualComponent {
  const defaultRoot = makeVCNode({ id: 'vc-root' })
  const nodes = overrides.nodes ?? [defaultRoot]
  const rootId = overrides.rootId ?? nodes[0]?.id ?? 'vc-root'
  const nodesMap: Record<string, VCNode> = {}
  for (const n of nodes) nodesMap[n.id] = n
  return {
    id: overrides.id ?? 'vc-test',
    name: overrides.name ?? 'TestComponent',
    tree: { nodes: nodesMap, rootNodeId: rootId },
    params: overrides.params ?? [],
    breakpoints: [],
    classIds: [],
    createdAt: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// CPO-1 — empty state hint
// ---------------------------------------------------------------------------

describe('CPO-1 — empty state hint when VC has zero params', () => {
  it('renders "Promote a property" hint when params list is empty', () => {
    const vc = makeVC({ params: [] })
    render(<ComponentParamsOverview vc={vc} />)
    expect(screen.getByText(/Promote a property/i)).toBeDefined()
  })

  it('does NOT render the param list when params is empty', () => {
    const vc = makeVC({ params: [] })
    render(<ComponentParamsOverview vc={vc} />)
    expect(screen.queryByRole('list', { name: /component params/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// CPO-2 — one row per param in declaration order
// ---------------------------------------------------------------------------

describe('CPO-2 — renders params in declaration order', () => {
  it('renders one list item per param and maintains insertion order', () => {
    const vc = makeVC({
      params: [
        makeVCParam({ id: 'p1', name: 'title', type: 'string' }),
        makeVCParam({ id: 'p2', name: 'image', type: 'image' }),
        makeVCParam({ id: 'p3', name: 'children', type: 'slot' }),
      ],
    })
    render(<ComponentParamsOverview vc={vc} />)

    const list = screen.getByRole('list', { name: /component params/i })
    const items = Array.from(list.querySelectorAll('li'))
    expect(items).toHaveLength(3)

    // Declaration order must be preserved
    expect(items[0].textContent).toContain('title')
    expect(items[1].textContent).toContain('image')
    expect(items[2].textContent).toContain('children')
  })

  it('shows type chip for each param', () => {
    const vc = makeVC({
      params: [
        makeVCParam({ id: 'p1', name: 'title', type: 'string' }),
        makeVCParam({ id: 'p2', name: 'flag', type: 'boolean' }),
      ],
    })
    render(<ComponentParamsOverview vc={vc} />)

    // Each param's type is rendered in the row
    expect(screen.getByText('string')).toBeDefined()
    expect(screen.getByText('boolean')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// CPO-3 — click bound row → selectNode(originatingNodeId)
// ---------------------------------------------------------------------------

describe('CPO-3 — clicking a bound param row calls selectNode(origin.nodeId)', () => {
  it('selecting a string-param row navigates to the origin node', () => {
    const innerNode = makeVCNode({
      id: 'n1',
      moduleId: 'base.text',
      propBindings: { text: { paramId: 'p-title' } },
    })
    const rootNode = makeVCNode({
      id: 'vc-root',
      children: ['n1'],
    })
    const vc = makeVC({
      nodes: [rootNode, innerNode],
      rootId: 'vc-root',
      params: [makeVCParam({ id: 'p-title', name: 'title', type: 'string' })],
    })

    render(<ComponentParamsOverview vc={vc} />)

    const rowBtn = screen.getByRole('button', { name: /Select origin of title/i })
    expect((rowBtn as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(rowBtn)

    // selectNode should update selectedNodeId in the store
    expect(useEditorStore.getState().selectedNodeId).toBe('n1')
  })
})

// ---------------------------------------------------------------------------
// CPO-4 — slot param click → selects base.slot-outlet node
// ---------------------------------------------------------------------------

describe('CPO-4 — slot param row selects the base.slot-outlet node', () => {
  it('clicking a slot param row calls selectNode with the slot-outlet id', () => {
    const slotOutlet = makeVCNode({
      id: 'slot-outlet-1',
      moduleId: 'base.slot-outlet',
      props: { slotName: 'children' },
    })
    const rootNode = makeVCNode({
      id: 'vc-root',
      children: ['slot-outlet-1'],
    })
    const vc = makeVC({
      nodes: [rootNode, slotOutlet],
      rootId: 'vc-root',
      params: [makeVCParam({ id: 'p-children', name: 'children', type: 'slot' })],
    })

    render(<ComponentParamsOverview vc={vc} />)

    const rowBtn = screen.getByRole('button', { name: /Select origin of children/i })
    expect((rowBtn as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(rowBtn)

    expect(useEditorStore.getState().selectedNodeId).toBe('slot-outlet-1')
  })
})

// ---------------------------------------------------------------------------
// CPO-5 — remove × button → removeParamWithCleanup + param gone from store
// ---------------------------------------------------------------------------

describe('CPO-5 — remove button triggers removeParamWithCleanup', () => {
  it('clicking × removes the param from site.visualComponents in the store', () => {
    const vcId = 'vc-remove-test'
    const paramId = 'p-removable'

    // Place the VC in the store so removeParamWithCleanup can look it up
    const vc = makeVC({
      id: vcId,
      params: [makeVCParam({ id: paramId, name: 'title', type: 'string' })],
    })
    const site = makeSite({ visualComponents: [vc] })
    useEditorStore.setState({ site } as Parameters<typeof useEditorStore.setState>[0])

    // Render with the live VC reference from the store
    const vcFromStore = useEditorStore.getState().site!.visualComponents.find(
      (v) => v.id === vcId,
    )!
    render(<ComponentParamsOverview vc={vcFromStore} />)

    // One param → one remove button
    const removeBtn = screen.getByRole('button', { name: /Remove param/i })
    fireEvent.click(removeBtn)

    // Param must be spliced from the store
    const paramsAfter = useEditorStore
      .getState()
      .site!.visualComponents.find((v) => v.id === vcId)!.params
    expect(paramsAfter).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// CPO-6 — orphan param: row disabled, selectedNodeId unchanged
// ---------------------------------------------------------------------------

describe('CPO-6 — orphan param row is disabled', () => {
  it('an unbound param renders a disabled row button', () => {
    // rootNode has no propBindings → param has no origin (orphan)
    const vc = makeVC({
      params: [makeVCParam({ id: 'p-ghost', name: 'ghost', type: 'string' })],
    })

    render(<ComponentParamsOverview vc={vc} />)

    const rowBtn = screen.getByRole('button', { name: /Select origin of ghost/i })
    expect((rowBtn as HTMLButtonElement).disabled).toBe(true)
  })

  it('clicking the disabled orphan row does NOT change selectedNodeId', () => {
    const vc = makeVC({
      params: [makeVCParam({ id: 'p-ghost', name: 'ghost', type: 'string' })],
    })

    render(<ComponentParamsOverview vc={vc} />)

    const before = useEditorStore.getState().selectedNodeId
    const rowBtn = screen.getByRole('button', { name: /Select origin of ghost/i })
    fireEvent.click(rowBtn)

    // selectedNodeId must not change
    expect(useEditorStore.getState().selectedNodeId).toBe(before)
  })
})
