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
import { useEditorStore } from '@core/editor-store/store'
import { registry } from '@core/module-engine/registry'
import type { AnyModuleDefinition, ModuleComponentProps } from '@core/module-engine/types'
import { SquareIcon } from 'pixel-art-icons/icons/square'

const TEST_MODULE_ID = 'test.multi-container'
const NullComponent: ComponentType<ModuleComponentProps<Record<string, unknown>>> = () => null

const testContainerModule: AnyModuleDefinition = {
  id: TEST_MODULE_ID,
  name: 'Test Multi Container',
  description: 'Container module used for multi-wrap defaults regression tests',
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
  it('Gate 1a: wrapNodes creates wrapper with module defaults (not empty props)', () => {
    const { a, b } = setupPage()
    const wrapperId = useEditorStore.getState().wrapNodes([a, b], TEST_MODULE_ID)
    expect(wrapperId).toBeTruthy()
    const wrapper = useEditorStore.getState().site!.pages[0].nodes[wrapperId!]
    expect(wrapper).toBeDefined()
    expect(Object.keys(wrapper.props).length).toBeGreaterThan(0)
  })

  it('Gate 1b: wrapper node has tag prop set to "div" (not undefined)', () => {
    const { a, b } = setupPage()
    const wrapperId = useEditorStore.getState().wrapNodes([a, b], TEST_MODULE_ID)
    const wrapper = useEditorStore.getState().site!.pages[0].nodes[wrapperId!]
    expect(wrapper.props.tag).toBe('div')
  })

  it('Gate 1c: caller-supplied defaults override module defaults', () => {
    const { a, b } = setupPage()
    const wrapperId = useEditorStore.getState().wrapNodes(
      [a, b],
      TEST_MODULE_ID,
      { tag: 'section', gap: 8 },
    )
    const wrapper = useEditorStore.getState().site!.pages[0].nodes[wrapperId!]
    expect(wrapper.props.tag).toBe('section')
    expect(wrapper.props.gap).toBe(8)
    // Non-overridden defaults are still present
    expect(wrapper.props.display).toBe('flex')
  })
})

describe('multi-wrap — source code guard (siteSlice)', () => {
  it('Gate 2: siteSlice.ts wrapNodes action uses registry.get() to merge defaults', async () => {
    const path = await import('path')
    const fs = await import('fs')
    const filePath = path.resolve(
      __dirname,
      '../../core/editor-store/slices/siteSlice.ts',
    )
    const src = fs.readFileSync(filePath, 'utf-8')

    // The wrapNodes action must resolve module defaults via registry.get()
    // and pass `resolvedDefaults` to the page-tree mutation. This mirrors
    // the wrapNode invariant captured by Task #414.
    const wrapCallMatch = src.match(
      /wrapNodes:\s*\(nodeIds[^]*?wrapperId\s*=\s*wrapNodes\(tree,\s*nodeIds,\s*containerModuleId,\s*(\w+)\)/,
    )
    expect(wrapCallMatch).not.toBeNull()
    expect(wrapCallMatch?.[1]).toBe('resolvedDefaults')
  })
})
