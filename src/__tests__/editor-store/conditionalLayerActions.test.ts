/**
 * Store actions for conditional style layers (CSS fidelity Phase 2b).
 *
 * addConditionalLayer / updateConditionalLayerStyles / removeConditionalLayer
 * on the style-rule slice.
 */

import { describe, it, expect } from 'bun:test'
import { useEditorStore } from '@site/store/store'
import '@modules/base'

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
    activeClassId: null,
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    hasUnsavedChanges: false,
  })
  useEditorStore.getState().createSite('Test')
}

function classId(): string {
  return useEditorStore.getState().createClass('card').id
}

describe('addConditionalLayer', () => {
  it('creates a media layer and returns its id', () => {
    freshStore()
    const id = classId()
    const layerId = useEditorStore.getState().addConditionalLayer(id, {
      kind: 'media',
      query: '(max-width: 860px)',
    })
    expect(layerId).toBeTruthy()
    const cls = useEditorStore.getState().site!.styleRules[id]
    expect(cls.conditionalLayers).toHaveLength(1)
    expect(cls.conditionalLayers![0].condition).toEqual({ kind: 'media', query: '(max-width: 860px)' })
  })

  it('reuses the existing layer for an identical condition', () => {
    freshStore()
    const id = classId()
    const a = useEditorStore.getState().addConditionalLayer(id, { kind: 'media', query: '(min-width: 1px)' })
    const b = useEditorStore.getState().addConditionalLayer(id, { kind: 'media', query: '(min-width: 1px)' })
    expect(a).toBe(b)
    expect(useEditorStore.getState().site!.styleRules[id].conditionalLayers).toHaveLength(1)
  })

  it('container conditions distinguish by name', () => {
    freshStore()
    const id = classId()
    useEditorStore.getState().addConditionalLayer(id, { kind: 'container', query: '(min-width: 400px)', name: 'a' })
    useEditorStore.getState().addConditionalLayer(id, { kind: 'container', query: '(min-width: 400px)', name: 'b' })
    expect(useEditorStore.getState().site!.styleRules[id].conditionalLayers).toHaveLength(2)
  })
})

describe('updateConditionalLayerStyles', () => {
  it('merges a style patch into the layer', () => {
    freshStore()
    const id = classId()
    const layerId = useEditorStore.getState().addConditionalLayer(id, { kind: 'media', query: '(max-width: 860px)' })!
    useEditorStore.getState().updateConditionalLayerStyles(id, layerId, { color: 'red' })
    useEditorStore.getState().updateConditionalLayerStyles(id, layerId, { fontSize: '14px' })
    const layer = useEditorStore.getState().site!.styleRules[id].conditionalLayers![0]
    expect(layer.styles).toMatchObject({ color: 'red', fontSize: '14px' })
  })

  it('an undefined value deletes the property from the layer', () => {
    freshStore()
    const id = classId()
    const layerId = useEditorStore.getState().addConditionalLayer(id, { kind: 'media', query: '(max-width: 860px)' })!
    useEditorStore.getState().updateConditionalLayerStyles(id, layerId, { color: 'red' })
    useEditorStore.getState().updateConditionalLayerStyles(id, layerId, { color: undefined })
    expect(useEditorStore.getState().site!.styleRules[id].conditionalLayers![0].styles).not.toHaveProperty('color')
  })
})

describe('removeConditionalLayer', () => {
  it('removes the layer; clears the array when empty', () => {
    freshStore()
    const id = classId()
    const layerId = useEditorStore.getState().addConditionalLayer(id, { kind: 'media', query: '(max-width: 860px)' })!
    useEditorStore.getState().removeConditionalLayer(id, layerId)
    expect(useEditorStore.getState().site!.styleRules[id].conditionalLayers).toBeUndefined()
  })
})
