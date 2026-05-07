import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PropertiesPanel } from '../../editor/components/PropertiesPanel/PropertiesPanel'
import { DynamicBindingControl } from '../../editor/components/PropertyControls/DynamicBindingControl'
import { useEditorStore } from '@core/editor-store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import type { DynamicPropBinding } from '@core/page-tree'
import '../../modules/base/index'

afterEach(cleanup)

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
    activeClassId: null,
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

function loadTemplateWithTextNode() {
  const root = makeNode({ id: 'root', moduleId: 'base.body', children: ['text-1'] })
  const text = makeNode({
    id: 'text-1',
    moduleId: 'base.text',
    props: { text: 'Static fallback', tag: 'p' },
  })
  const page = makePage({
    id: 'page-template',
    title: 'Post Template',
    slug: 'post-template',
    rootNodeId: 'root',
    nodes: { root, 'text-1': text },
    template: {
      enabled: true,
      context: 'entry',
      collectionId: 'posts',
      priority: 100,
      conditions: [],
    },
  })

  useEditorStore.setState({
    site: makeSite({ pages: [page] }),
    activePageId: page.id,
    selectedNodeId: 'text-1',
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

describe('dynamic binding controls', () => {
  it('binds and unbinds compatible module fields inside template context', () => {
    loadTemplateWithTextNode()
    render(<PropertiesPanel />)

    fireEvent.focus(screen.getByLabelText('Text'))
    fireEvent.click(screen.getByRole('menuitem', { name: /current post title/i }))

    let node = useEditorStore.getState().site?.pages[0].nodes['text-1']
    expect(node?.props.text).toBe('Static fallback')
    expect(node?.dynamicBindings?.text).toMatchObject({
      source: 'currentEntry',
      field: 'title',
    })
    expect(screen.getByRole('button', { name: /current post title/i })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /remove binding for text/i }))

    node = useEditorStore.getState().site?.pages[0].nodes['text-1']
    expect(node?.dynamicBindings).toBeUndefined()
  })

  it('offers featured media and first body image bindings for image controls', () => {
    let selectedBinding: DynamicPropBinding | undefined
    render(
      <DynamicBindingControl
        propKey="src"
        label="Image"
        control={{ type: 'image', label: 'Image' }}
        onSet={(binding) => {
          selectedBinding = binding
        }}
        onClear={() => {}}
      >
        <input aria-label="Image" />
      </DynamicBindingControl>,
    )

    fireEvent.focus(screen.getByLabelText('Image'))

    expect(screen.getByRole('menuitem', { name: /current post featured media/i })).toBeDefined()
    fireEvent.click(screen.getByRole('menuitem', { name: /current post first image/i }))

    expect(selectedBinding).toMatchObject({
      source: 'currentEntry',
      field: 'firstImage',
      format: 'media',
    })
  })
})
