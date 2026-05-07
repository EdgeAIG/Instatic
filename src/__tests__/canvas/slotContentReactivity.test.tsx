/**
 * slotContentReactivity.test.tsx
 *
 * Renders a real CanvasRoot containing a base.visual-component-ref whose
 * VC has a base.slot-outlet, with a base.text dropped into the materialized
 * slot-instance. Then mutates the text node's `props.text` via
 * `updateNodeProps` and asserts the canvas DOM reflects the new value.
 *
 * If this test ever fails, the user-reported bug is back: editing a text
 * inside a slot doesn't update the canvas preview.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { useEditorStore } from '@core/editor-store/store'
import { CanvasRoot } from '../../editor/components/Canvas/CanvasRoot'
import type { BaseNode } from '@core/page-tree/baseNode'
import { makeNode, makePage, makeSite } from '../fixtures'
import '../../modules/base'

afterEach(cleanup)

function freshStore() {
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    propertiesPanel: { collapsed: true, x: 0, y: 0, width: 360 },
    packageJson: {},
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(freshStore)

describe('slot content reactivity in the canvas', () => {
  it('editing a text inside a slot-instance updates the inlined canvas render', async () => {
    // Set up a VC with a slot-outlet at the root.
    const slotOutletId = 'outlet-1'
    const vcRootId = 'vc-root'
    const vc = {
      id: 'vc-1',
      name: 'HeroSection',
      tree: {
        rootNodeId: vcRootId,
        nodes: {
          [vcRootId]: {
            id: vcRootId,
            moduleId: 'base.body',
            props: {},
            children: [slotOutletId],
            breakpointOverrides: {},
            classIds: [],
          } as BaseNode,
          [slotOutletId]: {
            id: slotOutletId,
            moduleId: 'base.slot-outlet',
            props: { slotName: 'children' },
            children: [],
            breakpointOverrides: {},
            classIds: [],
          } as BaseNode,
        },
      },
      params: [],
      breakpoints: [],
      classIds: [],
      createdAt: 0,
    }

    const page = makePage({
      id: 'p1',
      slug: 'home',
      title: 'Home',
      rootNodeId: 'root',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: [] }),
      },
    })

    const site = makeSite({ pages: [page], visualComponents: [vc] })
    useEditorStore.setState({
      site,
      activePageId: 'p1',
      activeDocument: null,
    } as Parameters<typeof useEditorStore.setState>[0])

    // Drop the VC ref on the page → sync auto-materializes the slot-instance.
    let refId = ''
    act(() => {
      refId = useEditorStore.getState().insertComponentRef('root', 'vc-1')!
    })
    expect(refId).toBeTruthy()

    const slotInstId = useEditorStore.getState().site!.pages[0].nodes[refId].children[0]
    expect(slotInstId).toBeTruthy()

    // Insert a text node into the slot-instance with INITIAL content.
    let textId = ''
    act(() => {
      textId = useEditorStore.getState().insertNode(
        'base.text',
        { text: 'Initial text' },
        slotInstId,
      )!
    })
    expect(textId).toBeTruthy()

    // Render the canvas.
    render(
      <DndContext>
        <CanvasRoot />
      </DndContext>,
    )

    // The initial text must appear somewhere in the rendered canvas.
    expect(await screen.findAllByText('Initial text')).not.toHaveLength(0)

    // Mutate the text node.
    act(() => {
      useEditorStore.getState().updateNodeProps(textId, { text: 'Edited text' })
    })

    // The canvas must update to show the new text.
    expect(await screen.findAllByText('Edited text')).not.toHaveLength(0)

    // The old text must be gone from the canvas.
    expect(screen.queryByText('Initial text')).toBeNull()
  })
})
