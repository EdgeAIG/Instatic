/**
 * userFlowSlotEdit.test.tsx
 *
 * Mirrors the user-reported flow as faithfully as possible:
 *
 *   1. Create a fresh site (no VC yet).
 *   2. `createVisualComponent('HeroSection')` (matches the toolbar action).
 *   3. Enter VC edit mode (`setActiveDocument`).
 *   4. Insert a `base.slot-outlet` into the VC's tree via `insertNode`.
 *   5. Exit VC edit mode (back to page mode).
 *   6. Drop the VC ref on the page via `insertComponentRef` →
 *      `syncSlotInstances` should auto-materialize the slot-instance.
 *   7. Insert a `base.text` into the slot-instance via `useInsertModule`
 *      with the slot-instance as the explicit parent.
 *   8. Select the text node (simulating DOM-panel row click).
 *   9. Render the canvas + property panel.
 *  10. Type into the textarea bound to `text` prop.
 *  11. Assert the canvas DOM updates immediately.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { useEditorStore } from '@core/editor-store/store'
import { CanvasRoot } from '../../editor/components/Canvas/CanvasRoot'
import { PropertiesPanel } from '../../editor/components/PropertiesPanel/PropertiesPanel'
import '../../modules/base'

afterEach(cleanup)

beforeEach(() => {
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    packageJson: {},
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

describe("user's full flow: create VC → drop ref → insert text → edit text", () => {
  it('a text edited via the property panel updates the canvas', async () => {
    // 1. Fresh site.
    act(() => {
      useEditorStore.getState().createSite('Test Site')
    })
    const activePageId = useEditorStore.getState().activePageId
    expect(activePageId).toBeTruthy()

    // 2. Create a VC.
    let vcId = ''
    act(() => {
      vcId = useEditorStore.getState().createVisualComponent('HeroSection')
    })
    expect(vcId).toBeTruthy()

    // 3. Enter VC edit mode.
    act(() => {
      useEditorStore.getState().setActiveDocument({ kind: 'visualComponent', vcId })
    })

    // 4. Insert a slot-outlet into the VC tree at the root.
    const vcRootId = useEditorStore.getState().site!.visualComponents.find(
      (v) => v.id === vcId,
    )!.tree.rootNodeId
    let slotOutletId = ''
    act(() => {
      slotOutletId = useEditorStore.getState().insertNode(
        'base.slot-outlet',
        { slotName: 'children' },
        vcRootId,
      )!
    })
    expect(slotOutletId).toBeTruthy()

    // 5. Exit VC edit mode.
    act(() => {
      useEditorStore.getState().setActiveDocument(null)
    })

    // 6. Drop the VC ref on the homepage.
    const pageRootId = useEditorStore.getState().site!.pages[0].rootNodeId
    let refId = ''
    act(() => {
      refId = useEditorStore.getState().insertComponentRef(pageRootId, vcId)!
    })
    expect(refId).toBeTruthy()

    // syncSlotInstances should have created a slot-instance child.
    const refNode = useEditorStore.getState().site!.pages[0].nodes[refId]
    expect(refNode.children).toHaveLength(1)
    const slotInstId = refNode.children[0]
    const slotInst = useEditorStore.getState().site!.pages[0].nodes[slotInstId]
    expect(slotInst.moduleId).toBe('base.slot-instance')
    expect(slotInst.props.slotName).toBe('children')

    // 7. Insert a text into the slot-instance.
    let textId = ''
    act(() => {
      textId = useEditorStore.getState().insertNode(
        'base.text',
        { text: 'Initial text' },
        slotInstId,
      )!
    })

    // Verify it landed in the slot-instance.
    const slotAfter = useEditorStore.getState().site!.pages[0].nodes[slotInstId]
    expect(slotAfter.children).toContain(textId)

    // 8. Select the text.
    act(() => {
      useEditorStore.getState().selectNode(textId)
    })

    // 9. Render canvas + property panel.
    render(
      <DndContext>
        <CanvasRoot />
        <PropertiesPanel />
      </DndContext>,
    )

    expect(await screen.findAllByText('Initial text')).not.toHaveLength(0)

    // 10. Edit via the textarea (id="ctrl-text" comes from PropertyControlRenderer).
    const textarea = document.getElementById('ctrl-text') as HTMLTextAreaElement | null
    expect(textarea).not.toBeNull()
    expect(textarea!.value).toBe('Initial text')

    act(() => {
      fireEvent.change(textarea!, { target: { value: 'Edited text' } })
    })

    // 11. Both store AND canvas DOM must reflect the new value.
    expect(
      useEditorStore.getState().site!.pages[0].nodes[textId].props.text,
    ).toBe('Edited text')

    expect(await screen.findAllByText('Edited text')).not.toHaveLength(0)
    expect(screen.queryByText('Initial text')).toBeNull()
  })
})
