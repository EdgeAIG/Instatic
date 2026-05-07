/**
 * Task #414 — "Wrap to Container" crash regression guard
 *
 * Root cause: `wrapNode(nodeId, 'base.container')` was creating the new
 * container node with `props: {}` — no tag, no display, nothing.
 * ContainerEditor then evaluated `props.tag = undefined` → passed undefined
 * to `React.createElement(undefined, ...)` → React threw:
 *   "Element type is invalid: expected a string or class/function but got: undefined.
 *    Check the render method of ContainerEditor."
 *
 * Fix (siteSlice.ts): before calling the mutation, the store action now
 * looks up the module definition from the registry and merges its `defaults`
 * so the new wrapper node is created with a fully-populated props object.
 *
 * These gates document and protect that fix.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import type { ComponentType } from 'react'
import { useEditorStore } from '@core/editor-store/store'
import { registry } from '@core/module-engine/registry'
import type { AnyModuleDefinition, ModuleComponentProps } from '@core/module-engine/types'
import { SquareIcon } from 'pixel-art-icons/icons/square'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_MODULE_ID = 'test.container'

// Inert component stub for the registry — props are unused, output is null.
const NullComponent: ComponentType<ModuleComponentProps<Record<string, unknown>>> = () => null

/** Minimal module definition with 'tag' and other required defaults. */
const testContainerModule: AnyModuleDefinition = {
  id: TEST_MODULE_ID,
  name: 'Test Container',
  description: 'Container module used for Task #414 regression tests',
  category: 'Layout',
  version: '1.0.0',
  icon: SquareIcon,
  trusted: true,
  canHaveChildren: true,
  schema: {
    tag: { type: 'select', label: 'Tag', options: [{ label: 'div', value: 'div' }] },
    display: { type: 'select', label: 'Display', options: [{ label: 'Flex', value: 'flex' }] },
  },
  defaults: {
    tag: 'div',
    display: 'flex',
    gap: 16,
    padding: 16,
  },
  component: NullComponent,
  render: () => ({ html: '' }),
}

function freshStore() {
  useEditorStore.setState({
    site: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    hasUnsavedChanges: false,
  })
  return useEditorStore.getState()
}

function setupPage() {
  const s = freshStore()
  const site = s.createSite('Test')
  const rootId = site.pages[0].rootNodeId
  // Insert a child node to wrap
  const childId = useEditorStore.getState().insertNode('base.text', {}, rootId)
  return { rootId, childId }
}

// ---------------------------------------------------------------------------
// Registry cleanup: register before suite, unregister after
// ---------------------------------------------------------------------------

beforeEach(() => {
  if (!registry.has(TEST_MODULE_ID)) {
    registry.registerOrReplace(testContainerModule)
  }
})

afterEach(() => {
  registry.unregister(TEST_MODULE_ID)
})

// ---------------------------------------------------------------------------
// Gate 1 — wrapNode in store action uses module defaults
// ---------------------------------------------------------------------------

describe('Task #414 — wrapNode defaults', () => {
  it('Gate 1a: wrapNode creates wrapper node with module defaults (not empty props)', () => {
    const { childId } = setupPage()
    const state = useEditorStore.getState()
    const page = state.site!.pages[0]

    const wrapperId = state.wrapNode(childId, TEST_MODULE_ID)

    const wrapper = useEditorStore.getState().site!.pages[0].nodes[wrapperId]
    expect(wrapper).toBeDefined()
    // props must NOT be empty — module defaults must be merged in
    expect(Object.keys(wrapper.props).length).toBeGreaterThan(0)
  })

  it('Gate 1b: wrapper node has tag prop set to "div" (not undefined)', () => {
    const { childId } = setupPage()
    const state = useEditorStore.getState()

    const wrapperId = state.wrapNode(childId, TEST_MODULE_ID)

    const wrapper = useEditorStore.getState().site!.pages[0].nodes[wrapperId]
    // This is the critical check: before the fix, props.tag was undefined,
    // causing React.createElement(undefined) → "Element type is invalid" crash
    expect(wrapper.props.tag).toBe('div')
  })

  it('Gate 1c: caller-supplied defaults override module defaults', () => {
    const { childId } = setupPage()
    const state = useEditorStore.getState()

    const wrapperId = state.wrapNode(childId, TEST_MODULE_ID, { tag: 'section', gap: 8 })

    const wrapper = useEditorStore.getState().site!.pages[0].nodes[wrapperId]
    expect(wrapper.props.tag).toBe('section')
    expect(wrapper.props.gap).toBe(8)
    // Non-overridden defaults are still present
    expect(wrapper.props.display).toBe('flex')
  })

  it('Gate 1d: wrapped node becomes child of the wrapper (tree structure)', () => {
    const { rootId, childId } = setupPage()
    const state = useEditorStore.getState()

    const wrapperId = state.wrapNode(childId, TEST_MODULE_ID)
    const afterState = useEditorStore.getState().site!.pages[0]

    // Wrapper takes the original node's slot in the parent
    expect(afterState.nodes[rootId].children).toContain(wrapperId)
    expect(afterState.nodes[rootId].children).not.toContain(childId)
    // Original node is the wrapper's first child
    expect(afterState.nodes[wrapperId].children).toContain(childId)
  })
})

// ---------------------------------------------------------------------------
// Gate 2 — siteSlice.wrapNode source code safety check
// ---------------------------------------------------------------------------

describe('Task #414 — source code guard (siteSlice)', () => {
  it('Gate 2: siteSlice.ts wrapNode action uses registry.get() to merge defaults', async () => {
    const path = await import('path')
    const fs = await import('fs')
    const filePath = path.resolve(
      __dirname,
      '../../core/editor-store/slices/siteSlice.ts',
    )
    const src = fs.readFileSync(filePath, 'utf-8')

    // The wrapNode action must call registry.get(containerModuleId) before
    // invoking the mutation — this is what provides the defaults.
    expect(src).toContain('registry.get(containerModuleId)')
    expect(src).toContain('mod?.defaults')

    // The mutation call must use resolvedDefaults, not a bare empty object.
    // After the tree-unification refactor (Task 2) the helper is mutateActiveTree,
    // not mutatePage — update the pattern accordingly.
    const wrapCallMatch = src.match(/mutateActiveTree\(\(tree\)\s*=>\s*\{\s*wrapperId\s*=\s*wrapNode\(tree,\s*nodeId,\s*containerModuleId,\s*(\w+)\)/)
    expect(wrapCallMatch).not.toBeNull()
    // Ensure it's passing resolvedDefaults (not {} or undefined)
    expect(wrapCallMatch?.[1]).toBe('resolvedDefaults')
  })
})
