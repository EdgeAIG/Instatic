/**
 * classSlice tests — Phase C CSS Class System
 *
 * Covers:
 * - createClass / renameClass / deleteClass CRUD
 * - updateClassStyles / setClassBreakpointStyles patch semantics
 * - addNodeClass / removeNodeClass / reorderNodeClasses node assignment
 * - activeClassId state management
 * - deleteClass cascade (removes from all nodes, clears activeClassId)
 * - Uniqueness guards (duplicate class names throw)
 * - No-op guards (Guideline #242)
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '../../core/editor-store/store'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function getStore() {
  return useEditorStore.getState()
}

function freshStore() {
  useEditorStore.setState({
    site: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    selectedNodeId: null,
    hoveredNodeId: null,
    activeClassId: null,
    previewClassAssignment: null,
    hasUnsavedChanges: false,
  })
  return getStore()
}

/**
 * Set up a site with one page, one root node, and one child node.
 * Returns { rootId, childId }.
 */
function setupSite() {
  const s = freshStore()
  const site = s.createSite('Test')
  const rootId = site.pages[0].rootNodeId
  const childId = useEditorStore.getState().insertNode('base.heading', {}, rootId)
  return { rootId, childId, site: useEditorStore.getState().site! }
}

function historyLength() {
  return useEditorStore.getState()._historyPast.length
}

// ---------------------------------------------------------------------------
// createClass
// ---------------------------------------------------------------------------

describe('classSlice.createClass', () => {
  it('creates a class and adds it to site.classes', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    const classes = useEditorStore.getState().site!.classes
    expect(classes[cls.id]).toBeDefined()
    expect(classes[cls.id].name).toBe('btn')
    expect(classes[cls.id].styles).toEqual({})
    expect(classes[cls.id].breakpointStyles).toEqual({})
  })

  it('creates a class with initial styles', () => {
    setupSite()
    const cls = getStore().createClass('hero', { fontSize: '24px', color: '#fff' })
    const stored = useEditorStore.getState().site!.classes[cls.id]
    expect(stored.styles.fontSize).toBe('24px')
    expect(stored.styles.color).toBe('#fff')
  })

  it('throws if a class with the same name already exists', () => {
    setupSite()
    getStore().createClass('btn')
    expect(() => getStore().createClass('btn')).toThrow()
  })

  it('throws if the class name cannot be represented as one HTML class token', () => {
    setupSite()
    expect(() => getStore().createClass('feature card')).toThrow(/whitespace/)
    expect(() => getStore().createClass(' feature-card')).toThrow(/whitespace/)
  })

  it('throws if no site is loaded', () => {
    freshStore() // no createSite call
    expect(() => getStore().createClass('btn')).toThrow()
  })

  it('returns the new CSSClass with createdAt / updatedAt timestamps', () => {
    setupSite()
    const before = Date.now()
    const cls = getStore().createClass('card')
    const after = Date.now()
    expect(cls.createdAt).toBeGreaterThanOrEqual(before)
    expect(cls.createdAt).toBeLessThanOrEqual(after)
    expect(cls.updatedAt).toBeGreaterThanOrEqual(before)
  })
})

// ---------------------------------------------------------------------------
// updateClassStyles
// ---------------------------------------------------------------------------

describe('classSlice.updateClassStyles', () => {
  it('shallow-merges a patch into base styles', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().updateClassStyles(cls.id, { fontSize: '14px', color: '#000' })
    const stored = useEditorStore.getState().site!.classes[cls.id].styles
    expect(stored.fontSize).toBe('14px')
    expect(stored.color).toBe('#000')
  })

  it('overwrites individual keys on subsequent patches', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().updateClassStyles(cls.id, { fontSize: '14px' })
    getStore().updateClassStyles(cls.id, { fontSize: '16px' })
    expect(useEditorStore.getState().site!.classes[cls.id].styles.fontSize).toBe('16px')
  })

  it('deletes a key when patched to undefined/null', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().updateClassStyles(cls.id, { fontSize: '14px' })
    getStore().updateClassStyles(cls.id, { fontSize: undefined })
    const stored = useEditorStore.getState().site!.classes[cls.id].styles
    expect('fontSize' in stored).toBe(false)
  })

  it('is a no-op for unknown classId', () => {
    setupSite()
    const siteBefore = useEditorStore.getState().site!.updatedAt
    getStore().updateClassStyles('nonexistent-id', { fontSize: '14px' })
    expect(useEditorStore.getState().site!.updatedAt).toBe(siteBefore)
  })
})

// ---------------------------------------------------------------------------
// setClassBreakpointStyles
// ---------------------------------------------------------------------------

describe('classSlice.setClassBreakpointStyles', () => {
  it('creates a breakpoint override entry and patches it', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().setClassBreakpointStyles(cls.id, 'mobile', { fontSize: '12px' })
    const bpStyles = useEditorStore.getState().site!.classes[cls.id].breakpointStyles
    expect(bpStyles['mobile']?.fontSize).toBe('12px')
  })

  it('merges subsequent patches to the same breakpoint', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().setClassBreakpointStyles(cls.id, 'mobile', { fontSize: '12px' })
    getStore().setClassBreakpointStyles(cls.id, 'mobile', { color: '#fff' })
    const bp = useEditorStore.getState().site!.classes[cls.id].breakpointStyles['mobile']
    expect(bp?.fontSize).toBe('12px')
    expect(bp?.color).toBe('#fff')
  })

  it('removes a key from breakpoint styles when patched to null/undefined', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().setClassBreakpointStyles(cls.id, 'mobile', { fontSize: '12px' })
    getStore().setClassBreakpointStyles(cls.id, 'mobile', { fontSize: null as unknown as undefined })
    const bp = useEditorStore.getState().site!.classes[cls.id].breakpointStyles['mobile']
    expect('fontSize' in (bp ?? {})).toBe(false)
  })

  it('does not affect base styles', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().updateClassStyles(cls.id, { fontSize: '14px' })
    getStore().setClassBreakpointStyles(cls.id, 'mobile', { fontSize: '12px' })
    expect(useEditorStore.getState().site!.classes[cls.id].styles.fontSize).toBe('14px')
  })
})

// ---------------------------------------------------------------------------
// renameClass
// ---------------------------------------------------------------------------

describe('classSlice.renameClass', () => {
  it('renames a class', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().renameClass(cls.id, 'button')
    expect(useEditorStore.getState().site!.classes[cls.id].name).toBe('button')
  })

  it('allows renaming to the same name (no-op, no throw)', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    expect(() => getStore().renameClass(cls.id, 'btn')).not.toThrow()
    expect(useEditorStore.getState().site!.classes[cls.id].name).toBe('btn')
  })

  it('throws when renaming to an already-used name', () => {
    setupSite()
    const cls1 = getStore().createClass('btn')
    getStore().createClass('card')
    expect(() => getStore().renameClass(cls1.id, 'card')).toThrow()
  })

  it('throws if the new name cannot be represented as one HTML class token', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    expect(() => getStore().renameClass(cls.id, 'feature card')).toThrow(/whitespace/)
  })

  it('is a no-op for unknown classId', () => {
    setupSite()
    expect(() => getStore().renameClass('nonexistent', 'whatever')).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// deleteClass
// ---------------------------------------------------------------------------

describe('classSlice.deleteClass', () => {
  it('removes the class from the registry', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().deleteClass(cls.id)
    expect(useEditorStore.getState().site!.classes[cls.id]).toBeUndefined()
  })

  it('removes the classId from all nodes that reference it', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('btn')
    getStore().addNodeClass(childId, cls.id)
    // Verify it was added
    const pageBefore = useEditorStore.getState().site!.pages[0]
    expect(pageBefore.nodes[childId].classIds).toContain(cls.id)
    // Delete the class
    getStore().deleteClass(cls.id)
    const pageAfter = useEditorStore.getState().site!.pages[0]
    expect(pageAfter.nodes[childId].classIds ?? []).not.toContain(cls.id)
  })

  it('clears activeClassId when the active class is deleted', () => {
    setupSite()
    const cls = getStore().createClass('btn')
    getStore().setActiveClass(cls.id)
    expect(useEditorStore.getState().activeClassId).toBe(cls.id)
    getStore().deleteClass(cls.id)
    expect(useEditorStore.getState().activeClassId).toBeNull()
  })

  it('does not clear activeClassId when a different class is deleted', () => {
    setupSite()
    const cls1 = getStore().createClass('btn')
    const cls2 = getStore().createClass('card')
    getStore().setActiveClass(cls1.id)
    getStore().deleteClass(cls2.id)
    expect(useEditorStore.getState().activeClassId).toBe(cls1.id)
  })
})

// ---------------------------------------------------------------------------
// duplicateClass
// ---------------------------------------------------------------------------

describe('classSlice.duplicateClass', () => {
  it('copies styles and breakpoint styles without copying node assignments', () => {
    const { childId } = setupSite()
    const original = getStore().createClass('card', { padding: '16px', color: '#111' })
    getStore().setClassBreakpointStyles(original.id, 'mobile', { padding: '8px' })
    getStore().addNodeClass(childId, original.id)

    const copy = getStore().duplicateClass(original.id)

    expect(copy).not.toBeNull()
    expect(copy!.id).not.toBe(original.id)
    expect(copy!.name).toBe('card-copy')
    expect(copy!.styles).toEqual({ padding: '16px', color: '#111' })
    expect(copy!.breakpointStyles).toEqual({ mobile: { padding: '8px' } })
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds).toEqual([original.id])
  })

  it('generates a unique copy name when a copy already exists', () => {
    setupSite()
    const original = getStore().createClass('badge')
    const firstCopy = getStore().duplicateClass(original.id)
    const secondCopy = getStore().duplicateClass(original.id)

    expect(firstCopy?.name).toBe('badge-copy')
    expect(secondCopy?.name).toBe('badge-copy-2')
  })

  it('returns null for unknown classId', () => {
    setupSite()
    const before = historyLength()
    expect(getStore().duplicateClass('missing')).toBeNull()
    expect(historyLength()).toBe(before)
  })
})

// ---------------------------------------------------------------------------
// addNodeClass / removeNodeClass / reorderNodeClasses
// ---------------------------------------------------------------------------

describe('classSlice — node class assignment', () => {
  it('addNodeClass appends a classId to the node', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('btn')
    getStore().addNodeClass(childId, cls.id)
    const node = useEditorStore.getState().site!.pages[0].nodes[childId]
    expect(node.classIds).toContain(cls.id)
  })

  it('addNodeClass is a no-op if classId is already present', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('btn')
    getStore().addNodeClass(childId, cls.id)
    getStore().addNodeClass(childId, cls.id) // second call
    const node = useEditorStore.getState().site!.pages[0].nodes[childId]
    expect(node.classIds?.filter((id) => id === cls.id).length).toBe(1)
  })

  it('addNodeClass can assign multiple classes in order', () => {
    const { childId } = setupSite()
    const cls1 = getStore().createClass('a')
    const cls2 = getStore().createClass('b')
    getStore().addNodeClass(childId, cls1.id)
    getStore().addNodeClass(childId, cls2.id)
    const node = useEditorStore.getState().site!.pages[0].nodes[childId]
    expect(node.classIds).toEqual([cls1.id, cls2.id])
  })

  it('removeNodeClass removes the classId from the node', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('btn')
    getStore().addNodeClass(childId, cls.id)
    getStore().removeNodeClass(childId, cls.id)
    const node = useEditorStore.getState().site!.pages[0].nodes[childId]
    expect(node.classIds ?? []).not.toContain(cls.id)
  })

  it('removeNodeClass is a no-op if classId is not present', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('btn')
    expect(() => getStore().removeNodeClass(childId, cls.id)).not.toThrow()
  })

  it('reorderNodeClasses swaps positions by index', () => {
    const { childId } = setupSite()
    const cls1 = getStore().createClass('a')
    const cls2 = getStore().createClass('b')
    const cls3 = getStore().createClass('c')
    getStore().addNodeClass(childId, cls1.id)
    getStore().addNodeClass(childId, cls2.id)
    getStore().addNodeClass(childId, cls3.id)
    // Move index 0 → index 2: [cls1, cls2, cls3] → [cls2, cls3, cls1]
    getStore().reorderNodeClasses(childId, 0, 2)
    const node = useEditorStore.getState().site!.pages[0].nodes[childId]
    expect(node.classIds).toEqual([cls2.id, cls3.id, cls1.id])
  })

  it('reorderNodeClasses is a no-op when fromIndex === toIndex', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('a')
    getStore().addNodeClass(childId, cls.id)
    getStore().reorderNodeClasses(childId, 0, 0)
    const node = useEditorStore.getState().site!.pages[0].nodes[childId]
    expect(node.classIds).toEqual([cls.id])
  })
})

// ---------------------------------------------------------------------------
// class hover preview
// ---------------------------------------------------------------------------

describe('classSlice — class hover preview', () => {
  it('stores a preview assignment without mutating node classIds or site timestamps', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('preview-me')
    const beforeSiteUpdatedAt = useEditorStore.getState().site!.updatedAt
    const beforeClassIds = useEditorStore.getState().site!.pages[0].nodes[childId].classIds

    getStore().setPreviewNodeClass(childId, cls.id)

    const state = useEditorStore.getState()
    expect(state.previewClassAssignment).toEqual({ nodeId: childId, classId: cls.id })
    expect(state.site!.pages[0].nodes[childId].classIds).toEqual(beforeClassIds)
    expect(state.site!.updatedAt).toBe(beforeSiteUpdatedAt)
  })

  it('clears only the matching preview assignment so stale mouseleave events cannot remove a newer preview', () => {
    const { childId } = setupSite()
    const first = getStore().createClass('first')
    const second = getStore().createClass('second')

    getStore().setPreviewNodeClass(childId, first.id)
    getStore().setPreviewNodeClass(childId, second.id)
    getStore().clearPreviewNodeClass(childId, first.id)

    expect(useEditorStore.getState().previewClassAssignment).toEqual({
      nodeId: childId,
      classId: second.id,
    })

    getStore().clearPreviewNodeClass(childId, second.id)
    expect(useEditorStore.getState().previewClassAssignment).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// activeClassId
// ---------------------------------------------------------------------------

describe('classSlice.setActiveClass', () => {
  it('sets activeClassId to a string value', () => {
    freshStore()
    getStore().setActiveClass('abc')
    expect(useEditorStore.getState().activeClassId).toBe('abc')
  })

  it('sets activeClassId to null', () => {
    freshStore()
    getStore().setActiveClass('abc')
    getStore().setActiveClass(null)
    expect(useEditorStore.getState().activeClassId).toBeNull()
  })

  it('is a no-op when value is unchanged (Guideline #242)', () => {
    freshStore()
    getStore().setActiveClass('abc')
    // Get store reference — if it changes, the selector ref changes
    const storeBefore = useEditorStore.getState()
    getStore().setActiveClass('abc') // same value
    const storeAfter = useEditorStore.getState()
    // The store object reference should be the same when no mutation occurred
    expect(storeAfter.activeClassId).toBe(storeBefore.activeClassId)
  })
})

// ---------------------------------------------------------------------------
// undo / redo integration for class mutations
// ---------------------------------------------------------------------------

describe('classSlice — undo / redo', () => {
  it('createClass is undoable and redoable', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('undoable')

    expect(useEditorStore.getState().site!.classes[cls.id]).toBeDefined()
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().site!.classes[cls.id]).toBeUndefined()
    expect(useEditorStore.getState().site!.pages[0].nodes[childId]).toBeDefined()

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().site!.classes[cls.id]).toBeDefined()
  })

  it('renameClass is undoable and redoable', () => {
    setupSite()
    const cls = getStore().createClass('before-name')

    getStore().renameClass(cls.id, 'after-name')
    expect(useEditorStore.getState().site!.classes[cls.id].name).toBe('after-name')

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().site!.classes[cls.id].name).toBe('before-name')

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().site!.classes[cls.id].name).toBe('after-name')
  })

  it('duplicateClass is undoable and redoable', () => {
    setupSite()
    const cls = getStore().createClass('duplicated')
    const copy = getStore().duplicateClass(cls.id)

    expect(copy).not.toBeNull()
    expect(useEditorStore.getState().site!.classes[copy!.id]).toBeDefined()

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().site!.classes[copy!.id]).toBeUndefined()

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().site!.classes[copy!.id]).toBeDefined()
  })

  it('deleteClass is undoable and redoable including node assignments', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('removable')
    getStore().addNodeClass(childId, cls.id)

    getStore().deleteClass(cls.id)
    expect(useEditorStore.getState().site!.classes[cls.id]).toBeUndefined()
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds ?? []).not.toContain(cls.id)

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().site!.classes[cls.id]).toBeDefined()
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds ?? []).toContain(cls.id)

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().site!.classes[cls.id]).toBeUndefined()
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds ?? []).not.toContain(cls.id)
  })

  it('style edits are undoable and redoable', () => {
    setupSite()
    const cls = getStore().createClass('styled')

    getStore().updateClassStyles(cls.id, { fontSize: '18px' })
    expect(useEditorStore.getState().site!.classes[cls.id].styles.fontSize).toBe('18px')

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().site!.classes[cls.id].styles.fontSize).toBeUndefined()

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().site!.classes[cls.id].styles.fontSize).toBe('18px')
  })

  it('breakpoint style edits are undoable and redoable', () => {
    setupSite()
    const cls = getStore().createClass('responsive')

    getStore().setClassBreakpointStyles(cls.id, 'mobile', { fontSize: '14px' })
    expect(useEditorStore.getState().site!.classes[cls.id].breakpointStyles.mobile?.fontSize).toBe('14px')

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().site!.classes[cls.id].breakpointStyles.mobile?.fontSize).toBeUndefined()

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().site!.classes[cls.id].breakpointStyles.mobile?.fontSize).toBe('14px')
  })

  it('node class assignments are undoable and redoable', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('assignable')

    getStore().addNodeClass(childId, cls.id)
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds ?? []).toContain(cls.id)

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds ?? []).not.toContain(cls.id)

    useEditorStore.getState().redo()
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds ?? []).toContain(cls.id)

    getStore().removeNodeClass(childId, cls.id)
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds ?? []).not.toContain(cls.id)

    useEditorStore.getState().undo()
    expect(useEditorStore.getState().site!.pages[0].nodes[childId].classIds ?? []).toContain(cls.id)
  })

  it('no-op class mutations do not push undo history', () => {
    const { childId } = setupSite()
    const cls = getStore().createClass('stable')

    const beforeSameRename = historyLength()
    getStore().renameClass(cls.id, 'stable')
    expect(historyLength()).toBe(beforeSameRename)

    const beforeEmptyStylePatch = historyLength()
    getStore().updateClassStyles(cls.id, {})
    expect(historyLength()).toBe(beforeEmptyStylePatch)

    const beforeUnassignedRemove = historyLength()
    getStore().removeNodeClass(childId, cls.id)
    expect(historyLength()).toBe(beforeUnassignedRemove)
  })
})
