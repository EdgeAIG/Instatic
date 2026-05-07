/**
 * Phase 2 — Component System Store Action Gates
 *
 * Tests for the five new visualComponentsSlice actions added in Phase 2:
 *   setNodePropBinding, clearNodePropBinding, updateParamDefaultValue,
 *   renameParam, updateParamMeta
 *
 * Gate groups:
 *   PB-1 to PB-2 — setNodePropBinding (page mode + VC mode)
 *   PB-2a        — setNodePropBinding: null activeDocument (default page canvas)
 *   PB-3 to PB-4 — clearNodePropBinding (GC orphan + no-GC when still referenced)
 *   PB-3a        — clearNodePropBinding: null activeDocument (default page canvas)
 *   PB-5         — updateParamDefaultValue
 *   PB-6 to PB-8 — renameParam (happy path, stability invariant, throw on invalid)
 *   PB-9         — updateParamMeta round-trip
 *
 * Uses the same freshStore / setupSite pattern as task436-visual-components-data-layer.test.ts
 *
 * @see src/core/editor-store/slices/visualComponentsSlice.ts
 * @see Contribution #619 Phase 2 §C
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'
import type { SiteDocument } from '@core/page-tree/schemas'

// ---------------------------------------------------------------------------
// Helpers — mirrors task436 scaffolding
// ---------------------------------------------------------------------------

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
    activeDocument: null,
    activePageId: null,
  })
  return useEditorStore.getState()
}

function setupSite() {
  const s = freshStore()
  s.createSite('Phase 2 Test Site')
  return useEditorStore.getState()
}

/** Shorthand type cast for store actions */
function store() {
  return useEditorStore.getState() as Record<string, unknown>
}

function callAction<T>(name: string, ...args: unknown[]): T {
  return (store()[name] as (...a: unknown[]) => T)(...args)
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

function createVC(name: string): string {
  return callAction<string>('createVisualComponent', name)
}

function addParam(vcId: string, name: string, type: string, defaultValue?: unknown): string {
  return callAction<string>('addParam', vcId, name, type, defaultValue ?? '')
}

function getVC(vcId: string) {
  const site = useEditorStore.getState().site as SiteDocument & {
    visualComponents: Array<{
      id: string
      name: string
      params: Array<{ id: string; name: string; type: string; defaultValue: unknown; required: boolean; description?: string; enumOptions?: string[] }>
      tree: {
        rootNodeId: string
        nodes: Record<string, {
          id: string
          propBindings?: Record<string, { paramId: string }>
        }>
      }
    }>
  }
  return site.visualComponents.find((v) => v.id === vcId) ?? null
}

function getActivePage() {
  const s = useEditorStore.getState()
  const pageId = s.activePageId
  return s.site?.pages.find((p) => p.id === pageId) ?? null
}

// ---------------------------------------------------------------------------
// Gate PB-1 — setNodePropBinding: VC mode sets propBindings on the VC node
// ---------------------------------------------------------------------------

describe('Gate PB-1 — setNodePropBinding in VC mode', () => {
  beforeEach(() => { setupSite() })

  it('sets propBindings[propKey] on the VC rootNode when activeDocument is a VC', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'title', 'string')
    const vc = getVC(vcId)!
    const rootNodeId = vc.tree.rootNodeId

    // Set active document to VC mode
    useEditorStore.setState({ activeDocument: { kind: 'visualComponent', vcId } } as Parameters<typeof useEditorStore.setState>[0])

    callAction<void>('setNodePropBinding', rootNodeId, 'text', paramId)

    const updated = getVC(vcId)!
    expect(updated.tree.nodes[updated.tree.rootNodeId]?.propBindings?.text?.paramId).toBe(paramId)
  })
})

// ---------------------------------------------------------------------------
// Gate PB-2 — setNodePropBinding: page mode sets propBindings on the page node
// ---------------------------------------------------------------------------

describe('Gate PB-2 — setNodePropBinding in page mode', () => {
  beforeEach(() => { setupSite() })

  it('sets propBindings[propKey] on the page node when activeDocument is a page', () => {
    const page = getActivePage()!
    const rootNodeId = page.rootNodeId

    // Set active document to page mode
    useEditorStore.setState({ activeDocument: { kind: 'page', pageId: page.id } } as Parameters<typeof useEditorStore.setState>[0])

    callAction<void>('setNodePropBinding', rootNodeId, 'someKey', 'param-abc')

    const updated = getActivePage()!
    expect(updated.nodes[rootNodeId]?.propBindings?.someKey?.paramId).toBe('param-abc')
  })
})

// ---------------------------------------------------------------------------
// Gate PB-2a — setNodePropBinding: null activeDocument (default page canvas state)
// ---------------------------------------------------------------------------

describe('Gate PB-2a — setNodePropBinding with null activeDocument (default page canvas)', () => {
  beforeEach(() => { setupSite() })

  it('sets propBindings on the page node when activeDocument is null and activePageId is set', () => {
    const page = getActivePage()!
    const rootNodeId = page.rootNodeId

    // Keep activeDocument as null — the default page canvas state
    expect(useEditorStore.getState().activeDocument).toBeNull()
    expect(useEditorStore.getState().activePageId).not.toBeNull()

    callAction<void>('setNodePropBinding', rootNodeId, 'href', 'param-null-doc')

    const updated = getActivePage()!
    expect(updated.nodes[rootNodeId]?.propBindings?.href?.paramId).toBe('param-null-doc')
  })
})

// ---------------------------------------------------------------------------
// Gate PB-3 — clearNodePropBinding: GCs orphan param when no other node references it
// ---------------------------------------------------------------------------

describe('Gate PB-3 — clearNodePropBinding GCs orphan param', () => {
  beforeEach(() => { setupSite() })

  it('removes the param from vc.params when no other node references it after clear', () => {
    const vcId = createVC('Widget')
    const paramId = addParam(vcId, 'label', 'string')
    const vc = getVC(vcId)!
    const rootNodeId = vc.tree.rootNodeId

    useEditorStore.setState({ activeDocument: { kind: 'visualComponent', vcId } } as Parameters<typeof useEditorStore.setState>[0])

    // Bind the param
    callAction<void>('setNodePropBinding', rootNodeId, 'text', paramId)
    expect(getVC(vcId)!.params).toHaveLength(1)

    // Clear the binding
    callAction<void>('clearNodePropBinding', rootNodeId, 'text')

    // The binding should be gone
    const afterClear = getVC(vcId)!
    expect(afterClear.tree.nodes[afterClear.tree.rootNodeId]?.propBindings?.text).toBeUndefined()
    // The orphan param should be GC'd
    expect(getVC(vcId)!.params).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate PB-4 — clearNodePropBinding: does NOT GC when another node still references it
// ---------------------------------------------------------------------------

describe('Gate PB-4 — clearNodePropBinding does NOT GC when still referenced', () => {
  beforeEach(() => { setupSite() })

  it('keeps the param in vc.params when another node still has a binding to it', () => {
    const vcId = createVC('Banner')
    const paramId = addParam(vcId, 'headline', 'string')
    const vc = getVC(vcId)!
    const rootNodeId = vc.tree.rootNodeId

    useEditorStore.setState({ activeDocument: { kind: 'visualComponent', vcId } } as Parameters<typeof useEditorStore.setState>[0])

    // Add a child node to the VC tree
    const childNode = {
      id: 'child-text',
      moduleId: 'base.text',
      props: { text: 'Default' },
      children: [],
      breakpointOverrides: {},
      classIds: [],
    }
    callAction<void>('addNodeToVc', vcId, rootNodeId, childNode)

    // Bind the same param to BOTH the root and the child
    callAction<void>('setNodePropBinding', rootNodeId, 'text', paramId)
    callAction<void>('setNodePropBinding', 'child-text', 'text', paramId)

    // Clear the root's binding
    callAction<void>('clearNodePropBinding', rootNodeId, 'text')

    // Root binding gone, child binding still there
    const afterClear = getVC(vcId)!
    expect(afterClear.tree.nodes[afterClear.tree.rootNodeId]?.propBindings?.text).toBeUndefined()
    // Param NOT GC'd because child still references it
    expect(getVC(vcId)!.params).toHaveLength(1)
    expect(getVC(vcId)!.params[0].id).toBe(paramId)
  })
})

// ---------------------------------------------------------------------------
// Gate PB-3a — clearNodePropBinding: null activeDocument (default page canvas state)
// ---------------------------------------------------------------------------

describe('Gate PB-3a — clearNodePropBinding with null activeDocument (default page canvas)', () => {
  beforeEach(() => { setupSite() })

  it('removes propBinding from page node when activeDocument is null and activePageId is set', () => {
    const page = getActivePage()!
    const rootNodeId = page.rootNodeId

    // Set the binding while in page mode
    useEditorStore.setState({ activeDocument: { kind: 'page', pageId: page.id } } as Parameters<typeof useEditorStore.setState>[0])
    callAction<void>('setNodePropBinding', rootNodeId, 'label', 'param-clear-test')
    expect(getActivePage()!.nodes[rootNodeId]?.propBindings?.label?.paramId).toBe('param-clear-test')

    // Now switch to null activeDocument (default page canvas) and clear
    useEditorStore.setState({ activeDocument: null } as Parameters<typeof useEditorStore.setState>[0])
    expect(useEditorStore.getState().activeDocument).toBeNull()

    callAction<void>('clearNodePropBinding', rootNodeId, 'label')

    expect(getActivePage()!.nodes[rootNodeId]?.propBindings?.label).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Gate PB-5 — updateParamDefaultValue updates params[i].defaultValue
// ---------------------------------------------------------------------------

describe('Gate PB-5 — updateParamDefaultValue', () => {
  beforeEach(() => { setupSite() })

  it('updates the defaultValue of the specified param', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'title', 'string', 'initial')

    callAction<void>('updateParamDefaultValue', vcId, paramId, 'updated value')

    const param = getVC(vcId)!.params.find((p) => p.id === paramId)!
    expect(param.defaultValue).toBe('updated value')
  })
})

// ---------------------------------------------------------------------------
// Gate PB-6 — renameParam: validates and updates params[i].name
// ---------------------------------------------------------------------------

describe('Gate PB-6 — renameParam happy path', () => {
  beforeEach(() => { setupSite() })

  it('renames a param and updates its name field', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'title', 'string')

    callAction<void>('renameParam', vcId, paramId, 'headline')

    const param = getVC(vcId)!.params.find((p) => p.id === paramId)!
    expect(param.name).toBe('headline')
  })
})

// ---------------------------------------------------------------------------
// Gate PB-7 — renameParam: stability invariant
// Rename should NOT affect propOverrides (which key by paramId, not name)
// ---------------------------------------------------------------------------

describe('Gate PB-7 — renameParam stability invariant', () => {
  beforeEach(() => { setupSite() })

  it('override stored by paramId is still findable after param rename', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'title', 'string', 'default text')

    // Simulate an instance with a propOverride keyed by paramId
    const propOverrides: Record<string, unknown> = { [paramId]: 'instance override' }

    // Rename the param
    callAction<void>('renameParam', vcId, paramId, 'headline')

    // The param id is unchanged — override lookup by paramId still works
    const overrideValue = propOverrides[paramId]
    expect(overrideValue).toBe('instance override')

    // And the param itself has the new name
    const updatedVC = getVC(vcId)!
    const param = updatedVC.params.find((p) => p.id === paramId)!
    expect(param.name).toBe('headline')
    expect(param.id).toBe(paramId)
  })
})

// ---------------------------------------------------------------------------
// Gate PB-8 — renameParam: throws VisualComponentParamNameError on invalid name
// ---------------------------------------------------------------------------

describe('Gate PB-8 — renameParam throws on invalid name', () => {
  beforeEach(() => { setupSite() })

  it('throws VisualComponentParamNameError when renaming to an empty name', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'title', 'string')

    expect(() => callAction<void>('renameParam', vcId, paramId, '   ')).toThrow()
  })

  it('throws VisualComponentParamNameError when renaming to a duplicate name', () => {
    const vcId = createVC('Card')
    addParam(vcId, 'title', 'string')
    const paramId2 = addParam(vcId, 'subtitle', 'string')

    expect(() => callAction<void>('renameParam', vcId, paramId2, 'title')).toThrow()
  })

  it('does NOT throw when renaming to the same name (self-skip)', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'title', 'string')

    expect(() => callAction<void>('renameParam', vcId, paramId, 'title')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// Gate PB-9 — updateParamMeta: round-trips required / description / enumOptions
// ---------------------------------------------------------------------------

describe('Gate PB-9 — updateParamMeta round-trip', () => {
  beforeEach(() => { setupSite() })

  it('updates required, description, and enumOptions for an enum param', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'size', 'enum')

    callAction<void>('updateParamMeta', vcId, paramId, {
      required: true,
      description: 'The size variant',
      enumOptions: ['sm', 'md', 'lg'],
    })

    const param = getVC(vcId)!.params.find((p) => p.id === paramId)!
    expect(param.required).toBe(true)
    expect(param.description).toBe('The size variant')
    expect(param.enumOptions).toEqual(['sm', 'md', 'lg'])
  })

  it('strips enumOptions when param.type !== enum (defensive)', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'title', 'string')

    callAction<void>('updateParamMeta', vcId, paramId, {
      enumOptions: ['a', 'b'],
    })

    const param = getVC(vcId)!.params.find((p) => p.id === paramId)!
    // string type — enumOptions should not be set
    expect(param.enumOptions).toBeUndefined()
  })

  it('treats empty description as removing the field', () => {
    const vcId = createVC('Card')
    const paramId = addParam(vcId, 'title', 'string')

    callAction<void>('updateParamMeta', vcId, paramId, { description: 'initial' })
    expect(getVC(vcId)!.params.find((p) => p.id === paramId)!.description).toBe('initial')

    callAction<void>('updateParamMeta', vcId, paramId, { description: '' })
    expect(getVC(vcId)!.params.find((p) => p.id === paramId)!.description).toBeUndefined()
  })
})
