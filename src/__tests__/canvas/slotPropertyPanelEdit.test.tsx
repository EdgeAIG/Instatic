/**
 * slotPropertyPanelEdit.test.tsx
 *
 * Reproduces the user-reported bug at the React layer:
 *   1. Page contains a VC ref with a slot-outlet inside its VC.
 *   2. User adds a `base.text` to the materialized slot-instance.
 *   3. User selects the text in the DOM panel.
 *   4. PropertyPanel renders a Textarea bound to the text node's `props.text`.
 *   5. Typing in the textarea fires `updateNodeProps` per keystroke.
 *   6. The canvas (CanvasRoot) must show the new text immediately.
 *
 * If this test ever fails, the user's bug is real: the canvas isn't
 * subscribing reactively to slot-content edits.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { useEditorStore } from '@core/editor-store/store'
import { CanvasRoot } from '../../editor/components/Canvas/CanvasRoot'
import { PropertiesPanel } from '../../editor/components/PropertiesPanel/PropertiesPanel'
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
    // Anchor activeBreakpointId at 'desktop' so PropertiesPanel.handleChange
    // routes through `updateNodeProps` (writes to props.text). If a prior
    // test left this at 'mobile' / 'tablet', the same handler would write
    // to breakpointOverrides instead and silently break this test.
    activeBreakpointId: 'desktop',
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    packageJson: {},
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(freshStore)

describe('slot-content edit via PropertyPanel', () => {
  it('typing in the text Textarea updates the canvas', async () => {
    // VC with slot-outlet at root.
    const vc = {
      id: 'vc-1',
      name: 'HeroSection',
      tree: {
        rootNodeId: 'vc-root',
        nodes: {
          'vc-root': {
            id: 'vc-root',
            moduleId: 'base.body',
            props: {},
            children: ['outlet-1'],
            breakpointOverrides: {},
            classIds: [],
          } as BaseNode,
          'outlet-1': {
            id: 'outlet-1',
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
    useEditorStore.setState({
      site: makeSite({ pages: [page], visualComponents: [vc] }),
      activePageId: 'p1',
      activeDocument: null,
    } as Parameters<typeof useEditorStore.setState>[0])

    let refId = ''
    let textId = ''
    act(() => {
      refId = useEditorStore.getState().insertComponentRef('root', 'vc-1')!
    })
    const slotInstId = useEditorStore.getState().site!.pages[0].nodes[refId].children[0]
    act(() => {
      textId = useEditorStore.getState().insertNode(
        'base.text',
        { text: 'Initial text' },
        slotInstId,
      )!
    })

    // Select the text via the store directly (simulates DOM panel row click).
    act(() => {
      useEditorStore.getState().selectNode(textId)
    })

    // Render canvas + property panel together.
    render(
      <DndContext>
        <CanvasRoot />
        <PropertiesPanel />
      </DndContext>,
    )

    // Sanity: initial text appears on canvas.
    expect(await screen.findAllByText('Initial text')).not.toHaveLength(0)

    // Find the textarea bound to the text prop in the PropertiesPanel.
    // PropertyControlRenderer assigns id="ctrl-text" to the textarea.
    const textarea = document.getElementById('ctrl-text') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    expect(textarea!.value).toBe('Initial text')

    // Simulate a typing event — fireEvent.change replaces the textarea content
    // and fires the onChange handler with the new value (one keystroke worth).
    act(() => {
      fireEvent.change(textarea!, { target: { value: 'Edited text' } })
    })

    // The store must hold the new value.
    expect(
      useEditorStore.getState().site!.pages[0].nodes[textId].props.text,
    ).toBe('Edited text')

    // The canvas DOM must reflect the new value.
    expect(await screen.findAllByText('Edited text')).not.toHaveLength(0)
    expect(screen.queryByText('Initial text')).toBeNull()
  })

  it('edits propagate when the slot-outlet is nested deep inside the VC tree', async () => {
    // Mirror the user's actual VC layout from the screenshot:
    //   vc-root (base.body)
    //   └─ section (.hero)
    //      └─ div (.page-wrap.hero-grid)
    //         └─ slot-outlet
    const vc = {
      id: 'vc-2',
      name: 'HeroSection',
      tree: {
        rootNodeId: 'vc-root',
        nodes: {
          'vc-root': {
            id: 'vc-root',
            moduleId: 'base.body',
            props: {},
            children: ['section-1'],
            breakpointOverrides: {},
            classIds: [],
          } as BaseNode,
          'section-1': {
            id: 'section-1',
            moduleId: 'base.container',
            props: { tag: 'section' },
            children: ['grid-1'],
            breakpointOverrides: {},
            classIds: [],
          } as BaseNode,
          'grid-1': {
            id: 'grid-1',
            moduleId: 'base.container',
            props: { tag: 'div' },
            children: ['outlet-2'],
            breakpointOverrides: {},
            classIds: [],
          } as BaseNode,
          'outlet-2': {
            id: 'outlet-2',
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
      id: 'p2',
      slug: 'home',
      title: 'Home',
      rootNodeId: 'root',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: [] }),
      },
    })
    useEditorStore.setState({
      site: makeSite({ pages: [page], visualComponents: [vc] }),
      activePageId: 'p2',
      activeDocument: null,
    } as Parameters<typeof useEditorStore.setState>[0])

    let refId = ''
    let textId = ''
    act(() => {
      refId = useEditorStore.getState().insertComponentRef('root', 'vc-2')!
    })
    const slotInstId = useEditorStore.getState().site!.pages[0].nodes[refId].children[0]
    act(() => {
      textId = useEditorStore.getState().insertNode(
        'base.text',
        { text: 'Nested initial' },
        slotInstId,
      )!
    })
    act(() => {
      useEditorStore.getState().selectNode(textId)
    })

    render(
      <DndContext>
        <CanvasRoot />
        <PropertiesPanel />
      </DndContext>,
    )

    expect(await screen.findAllByText('Nested initial')).not.toHaveLength(0)

    const textarea = document.getElementById('ctrl-text') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    expect(textarea!.value).toBe('Nested initial')

    act(() => {
      fireEvent.change(textarea!, { target: { value: 'Nested edited' } })
    })

    expect(
      useEditorStore.getState().site!.pages[0].nodes[textId].props.text,
    ).toBe('Nested edited')

    expect(await screen.findAllByText('Nested edited')).not.toHaveLength(0)
    expect(screen.queryByText('Nested initial')).toBeNull()
  })
})
