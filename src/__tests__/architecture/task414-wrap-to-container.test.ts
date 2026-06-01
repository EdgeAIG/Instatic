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
import { useEditorStore } from '@site/store/store'
import { registry } from '@core/module-engine'
import type { AnyModuleDefinition, ModuleComponentProps } from '@core/module-engine'
import { SquareSolidIcon } from 'pixel-art-icons/icons/square-solid'

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
  icon: SquareSolidIcon,
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
  it('wrapNode creates a defaulted wrapper and moves the target under it', () => {
    const { rootId, childId } = setupPage()
    const state = useEditorStore.getState()

    const wrapperId = state.wrapNode(childId, TEST_MODULE_ID, { tag: 'section', gap: 8 })
    const afterState = useEditorStore.getState().site!.pages[0]
    const wrapper = afterState.nodes[wrapperId]

    expect(wrapper).toBeDefined()
    expect(wrapper.props).toMatchObject({
      tag: 'section',
      display: 'flex',
      gap: 8,
      padding: 16,
    })
    expect(afterState.nodes[rootId].children).toContain(wrapperId)
    expect(afterState.nodes[rootId].children).not.toContain(childId)
    expect(afterState.nodes[wrapperId].children).toContain(childId)
  })
})
