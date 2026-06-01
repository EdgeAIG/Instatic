/**
 * Multi-select — wrapNodes defaults gate.
 *
 * Mirrors the Task #414 single-wrap regression guard for the multi-wrap
 * action. The wrapper container created by `wrapNodes` MUST inherit the
 * module's `defaults` (resolved through the registry) — otherwise the new
 * wrapper renders with `props: {}` and `props.tag === undefined`, which
 * crashes ContainerEditor with "Element type is invalid".
 *
 * The fix lives in `siteSlice.wrapNodes`: it must call
 * `registry.get(containerModuleId)` and merge `mod?.defaults` before invoking
 * the mutation. This file enforces both the runtime behavior and the
 * source-shape of the slice action.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import type { ComponentType } from 'react'
import { useEditorStore } from '@site/store/store'
import { registry } from '@core/module-engine'
import type { AnyModuleDefinition, ModuleComponentProps } from '@core/module-engine'
import { SquareSolidIcon } from 'pixel-art-icons/icons/square-solid'

const TEST_MODULE_ID = 'test.multi-container'
const NullComponent: ComponentType<ModuleComponentProps<Record<string, unknown>>> = () => null

const testContainerModule: AnyModuleDefinition = {
  id: TEST_MODULE_ID,
  name: 'Test Multi Container',
  description: 'Container module used for multi-wrap defaults regression tests',
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
  const a = useEditorStore.getState().insertNode('base.text', {}, rootId)
  const b = useEditorStore.getState().insertNode('base.text', {}, rootId)
  return { rootId, a, b }
}

beforeEach(() => {
  if (!registry.has(TEST_MODULE_ID)) {
    registry.registerOrReplace(testContainerModule)
  }
})

afterEach(() => {
  registry.unregister(TEST_MODULE_ID)
})

describe('multi-wrap — wrapNodes defaults', () => {
  it('wrapNodes creates a defaulted wrapper with caller overrides', () => {
    const { a, b } = setupPage()
    const wrapperId = useEditorStore.getState().wrapNodes(
      [a, b],
      TEST_MODULE_ID,
      { tag: 'section', gap: 8 },
    )
    expect(wrapperId).toBeTruthy()
    const wrapper = useEditorStore.getState().site!.pages[0].nodes[wrapperId!]
    expect(wrapper.props).toMatchObject({
      tag: 'section',
      display: 'flex',
      gap: 8,
      padding: 16,
    })
  })
})
