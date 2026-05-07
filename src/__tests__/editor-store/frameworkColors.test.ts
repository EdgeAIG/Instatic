import { beforeEach, describe, expect, it } from 'bun:test'
import { useEditorStore } from '@core/editor-store/store'
import { frameworkColorClassId } from '@core/framework/colors'
import type { FrameworkColorToken } from '@core/framework/schemas'
import { makeNode, makePage, makeSite } from '../fixtures'

function resetStore() {
  useEditorStore.setState({
    site: makeSite(),
    activePageId: 'page-1',
    selectedNodeId: null,
    selectedNodeIds: [],
    activeClassId: null,
    selectedSelectorClassId: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

describe('framework color store actions', () => {
  it('creates a color token with a category label and generated locked utilities', () => {
    const token = useEditorStore.getState().createFrameworkColorToken({
      category: 'Brand',
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      darkModeEnabled: true,
      generateUtilities: {
        text: true,
        background: true,
        border: true,
        fill: true,
      },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: false, count: 0 },
    })

    const state = useEditorStore.getState()
    expect(state.site!.settings.framework!.colors.tokens[0]).toMatchObject({
      id: token.id,
      category: 'Brand',
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      darkModeEnabled: true,
    })
    expect(token.darkValue).toStartWith('hsla(')
    expect(token.darkValue).not.toBe(token.lightValue)

    const textClass = state.site!.classes[frameworkColorClassId(token.id, 'base', 'text')]
    const fillClass = state.site!.classes[frameworkColorClassId(token.id, 'base', 'fill')]
    expect(textClass).toMatchObject({
      name: 'text-primary',
      styles: { color: 'var(--primary)' },
      generated: { locked: true, family: 'color', sourceId: token.id },
    })
    expect(fillClass).toMatchObject({
      name: 'fill-primary',
      styles: { fill: 'var(--primary)' },
      generated: { locked: true, utility: 'fill' },
    })
  })

  it('keeps generated class assignments stable when a color slug changes', () => {
    const page = makePage({
      id: 'page-1',
      rootNodeId: 'root',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['hero'] }),
        hero: makeNode({ id: 'hero', moduleId: 'base.text', classIds: [] }),
      },
    })
    useEditorStore.setState({
      site: makeSite({ pages: [page] }),
      activePageId: 'page-1',
    } as Parameters<typeof useEditorStore.setState>[0])

    const token = useEditorStore.getState().createFrameworkColorToken({
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      generateUtilities: {
        text: true,
        background: false,
        border: false,
        fill: false,
      },
    })
    const classId = frameworkColorClassId(token.id, 'base', 'text')
    useEditorStore.getState().addNodeClass('hero', classId)

    useEditorStore.getState().updateFrameworkColorToken(token.id, {
      slug: 'brand-primary',
    })

    const state = useEditorStore.getState()
    expect(state.site!.pages[0].nodes.hero.classIds).toEqual([classId])
    expect(state.site!.classes[classId].name).toBe('text-brand-primary')
    expect(state.site!.classes[classId].styles).toEqual({ color: 'var(--brand-primary)' })
  })

  it('removes disabled generated utility classes from nodes', () => {
    const page = makePage({
      id: 'page-1',
      rootNodeId: 'root',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['hero'] }),
        hero: makeNode({ id: 'hero', moduleId: 'base.text', classIds: [] }),
      },
    })
    useEditorStore.setState({
      site: makeSite({ pages: [page] }),
      activePageId: 'page-1',
    } as Parameters<typeof useEditorStore.setState>[0])

    const token = useEditorStore.getState().createFrameworkColorToken({
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      generateUtilities: {
        text: false,
        background: true,
        border: false,
        fill: false,
      },
    })
    const classId = frameworkColorClassId(token.id, 'base', 'background')
    useEditorStore.getState().addNodeClass('hero', classId)

    useEditorStore.getState().updateFrameworkColorToken(token.id, {
      generateUtilities: {
        text: false,
        background: false,
        border: false,
        fill: false,
      },
    })

    const state = useEditorStore.getState()
    expect(state.site!.classes[classId]).toBeUndefined()
    expect(state.site!.pages[0].nodes.hero.classIds).toEqual([])
  })

  it('prevents locked generated utility classes from being edited through class actions', () => {
    const token = useEditorStore.getState().createFrameworkColorToken({
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      generateUtilities: {
        text: true,
        background: false,
        border: false,
        fill: false,
      },
    })
    const classId = frameworkColorClassId(token.id, 'base', 'text')

    useEditorStore.getState().updateClassStyles(classId, { color: 'red' })
    useEditorStore.getState().setClassBreakpointStyles(classId, 'mobile', { color: 'blue' })
    useEditorStore.getState().renameClass(classId, 'text-edited')
    const duplicate = useEditorStore.getState().duplicateClass(classId)
    useEditorStore.getState().deleteClass(classId)

    const state = useEditorStore.getState()
    expect(duplicate).toBeNull()
    expect(state.site!.classes[classId]).toMatchObject({
      name: 'text-primary',
      styles: { color: 'var(--primary)' },
      breakpointStyles: {},
      generated: { locked: true },
    })
  })

  it('claims user-authored classes whose names collide with framework utilities on reconcile', () => {
    // Reproduces the regression where a class like `text-primary-l-3`
    // could exist as a plain user class (no `generated` metadata, no
    // lock) while the framework also generated a class with the same
    // name. Both lived in `site.classes` under different IDs; the user
    // version was editable, defeating the lock.
    const token: FrameworkColorToken = {
      id: 'primary-token',
      category: '',
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      darkValue: 'hsla(238, 100%, 42%, 1)',
      darkModeEnabled: true,
      generateUtilities: { text: true, background: false, border: false, fill: false },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: true, count: 4 },
      order: 0,
      createdAt: 1,
      updatedAt: 2,
    }
    const userClassId = 'user-class-text-primary-l-3'
    const page = makePage({
      id: 'page-1',
      rootNodeId: 'root',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['hero'] }),
        hero: makeNode({
          id: 'hero',
          moduleId: 'base.text',
          classIds: [userClassId],
        }),
      },
    })
    const site = makeSite({
      pages: [page],
      settings: {
        ...makeSite().settings,
        framework: { colors: { tokens: [token] } },
      },
      classes: {
        [userClassId]: {
          id: userClassId,
          name: 'text-primary-l-3',
          styles: { color: 'red' },
          breakpointStyles: {},
          createdAt: 0,
          updatedAt: 0,
        },
      },
    })

    useEditorStore.getState().loadSite(site)

    const classes = useEditorStore.getState().site!.classes
    const frameworkId = frameworkColorClassId(token.id, 'tint-3', 'text')

    // Framework class exists and is locked.
    expect(classes[frameworkId]).toMatchObject({
      name: 'text-primary-l-3',
      generated: { locked: true, sourceId: token.id },
    })
    // The colliding user class is gone — only the framework version
    // owns the name now.
    expect(classes[userClassId]).toBeUndefined()
    const named = Object.values(classes).filter((c) => c.name === 'text-primary-l-3')
    expect(named).toHaveLength(1)
    // The node assignment was remapped from the user class ID to the
    // framework class ID (preserving the pill on the element).
    expect(useEditorStore.getState().site!.pages[0].nodes.hero.classIds).toEqual([frameworkId])
  })

  it('previewFrameworkChange returns the affected classes and assignments without mutating', () => {
    const tokenId = 'primary-token'
    const tintClassId = frameworkColorClassId(tokenId, 'tint-2', 'text')
    const baseClassId = frameworkColorClassId(tokenId, 'base', 'text')
    const token: FrameworkColorToken = {
      id: tokenId,
      category: '',
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      darkValue: 'hsla(238, 100%, 42%, 1)',
      darkModeEnabled: false,
      generateUtilities: { text: true, background: false, border: false, fill: false },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: true, count: 2 },
      order: 0,
      createdAt: 1,
      updatedAt: 2,
    }
    const page = makePage({
      id: 'page-1',
      rootNodeId: 'root',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['hero'] }),
        hero: makeNode({
          id: 'hero',
          moduleId: 'base.text',
          label: 'Hero text',
          classIds: [tintClassId, baseClassId],
        }),
      },
    })
    const site = makeSite({
      pages: [page],
      settings: {
        ...makeSite().settings,
        framework: { colors: { tokens: [token] } },
      },
      classes: {},
    })
    useEditorStore.getState().loadSite(site)

    // Pre-condition: both classes exist and are assigned.
    const before = useEditorStore.getState().site!
    expect(before.classes[tintClassId]).toBeDefined()
    expect(before.classes[baseClassId]).toBeDefined()

    // Preview: turn tints off — should report tint-N as the
    // soon-to-be-removed class, used on the hero node.
    const impact = useEditorStore.getState().previewFrameworkChange((draft) => {
      const tk = draft.settings.framework!.colors.tokens.find((t) => t.id === tokenId)
      if (tk) tk.generateTints = { enabled: false, count: 0 }
    })
    expect(impact).not.toBeNull()
    // Both tint-1 and tint-2 are generated (count: 2) and both are
    // removed when tints are disabled. The dialog can render the full
    // removal list even when only some of them are currently assigned.
    expect(impact!.removedClasses.map((c) => c.name).sort()).toEqual([
      'text-primary-l-1',
      'text-primary-l-2',
    ])
    expect(impact!.usages).toHaveLength(1)
    expect(impact!.usages[0]).toMatchObject({
      classId: tintClassId,
      className: 'text-primary-l-2',
      source: { kind: 'page', pageId: 'page-1', nodeId: 'hero', nodeLabel: 'Hero text' },
    })

    // Preview must not mutate the live site.
    const after = useEditorStore.getState().site!
    expect(after).toBe(before)
    expect(after.classes[tintClassId]).toBeDefined()
    expect(after.pages[0].nodes.hero.classIds).toEqual([tintClassId, baseClassId])
  })

  it('previewFrameworkChange returns null when nothing is removed-and-in-use', () => {
    const token: FrameworkColorToken = {
      id: 'primary-token',
      category: '',
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      darkValue: 'hsla(238, 100%, 42%, 1)',
      darkModeEnabled: false,
      generateUtilities: { text: true, background: false, border: false, fill: false },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: true, count: 2 },
      order: 0,
      createdAt: 1,
      updatedAt: 2,
    }
    // No assignments anywhere — disabling tints removes classes that
    // were in `site.classes` but used by no node, so no dialog needed.
    const site = makeSite({
      settings: {
        ...makeSite().settings,
        framework: { colors: { tokens: [token] } },
      },
      classes: {},
    })
    useEditorStore.getState().loadSite(site)

    const impact = useEditorStore.getState().previewFrameworkChange((draft) => {
      const tk = draft.settings.framework!.colors.tokens.find((t) => t.id === 'primary-token')
      if (tk) tk.generateTints = { enabled: false, count: 0 }
    })
    expect(impact).toBeNull()
  })

  it('removes orphan framework classes whose generated metadata was lost', () => {
    // Reproduces the user-reported regression: a class with a framework
    // ID survived a round-trip without its `generated` metadata, so
    // it looked like a regular editable user class. Reconcile must
    // recognise framework classes by ID prefix and remove orphans
    // entirely (not just unmark them) when they're no longer desired.
    const tokenId = 'primary-token'
    const orphanFrameworkId = frameworkColorClassId(tokenId, 'tint-3', 'text')
    const token: FrameworkColorToken = {
      id: tokenId,
      category: '',
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      darkValue: 'hsla(238, 100%, 42%, 1)',
      darkModeEnabled: true,
      generateUtilities: { text: true, background: false, border: false, fill: false },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: false, count: 0 },
      order: 0,
      createdAt: 1,
      updatedAt: 2,
    }
    const page = makePage({
      id: 'page-1',
      rootNodeId: 'root',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['hero'] }),
        hero: makeNode({
          id: 'hero',
          moduleId: 'base.text',
          classIds: [orphanFrameworkId],
        }),
      },
    })
    const site = makeSite({
      pages: [page],
      settings: {
        ...makeSite().settings,
        framework: { colors: { tokens: [token] } },
      },
      classes: {
        // Orphan: framework-prefixed ID, but `generated` is missing
        // (the persistence round-trip lost it). Old prune logic would
        // have skipped this class because it lacked the metadata,
        // leaving an editable, badge-less ghost behind.
        [orphanFrameworkId]: {
          id: orphanFrameworkId,
          name: 'text-primary-l-3',
          styles: { color: 'red' },
          breakpointStyles: {},
          createdAt: 0,
          updatedAt: 0,
        },
      },
    })

    useEditorStore.getState().loadSite(site)

    const state = useEditorStore.getState()
    expect(state.site!.classes[orphanFrameworkId]).toBeUndefined()
    // The orphan was removed from the node's class list, too.
    expect(state.site!.pages[0].nodes.hero.classIds).toEqual([])
  })

  it('reconciles generated utility classes when loading a site with framework colors', () => {
    const token: FrameworkColorToken = {
      id: 'primary-token',
      category: '',
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      darkValue: 'hsla(238, 100%, 42%, 1)',
      darkModeEnabled: true,
      generateUtilities: {
        text: true,
        background: false,
        border: false,
        fill: false,
      },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: false, count: 0 },
      order: 0,
      createdAt: 1,
      updatedAt: 2,
    }
    const site = makeSite({
      settings: {
        ...makeSite().settings,
        framework: {
          colors: {
            tokens: [token],
          },
        },
      },
      classes: {},
    })

    useEditorStore.getState().loadSite(site)

    expect(useEditorStore.getState().site!.classes[frameworkColorClassId(token.id, 'base', 'text')]).toMatchObject({
      name: 'text-primary',
      styles: { color: 'var(--primary)' },
      generated: { locked: true, sourceId: token.id },
    })
  })

  it('duplicates and reorders framework color tokens with regenerated utility classes', () => {
    const first = useEditorStore.getState().createFrameworkColorToken({
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      generateUtilities: { text: true },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: false, count: 0 },
    })
    const second = useEditorStore.getState().createFrameworkColorToken({
      slug: 'secondary',
      lightValue: 'hsla(0, 94%, 68%, 1)',
      generateUtilities: { text: true },
      generateTransparent: false,
      generateShades: { enabled: false, count: 0 },
      generateTints: { enabled: false, count: 0 },
    })

    const copy = useEditorStore.getState().duplicateFrameworkColorToken(first.id)

    expect(copy).toMatchObject({
      slug: 'primary-copy',
      lightValue: first.lightValue,
      generateUtilities: first.generateUtilities,
    })
    expect(useEditorStore.getState().site!.classes[frameworkColorClassId(copy!.id, 'base', 'text')]).toMatchObject({
      name: 'text-primary-copy',
      generated: { locked: true, sourceId: copy!.id },
    })

    useEditorStore.getState().reorderFrameworkColorToken(second.id, 'up')

    const orderedSlugs = useEditorStore.getState().site!.settings.framework!.colors.tokens
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((token) => token.slug)
    expect(orderedSlugs).toEqual(['secondary', 'primary', 'primary-copy'])
  })

  it('canonicalizes a new token category to match an existing label case-insensitively', () => {
    useEditorStore.getState().createFrameworkColorToken({
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      category: 'Brand',
    })
    const second = useEditorStore.getState().createFrameworkColorToken({
      slug: 'secondary',
      lightValue: 'hsla(0, 94%, 68%, 1)',
      category: 'brand',
    })

    expect(second.category).toBe('Brand')
  })

  it('canonicalizes an updated token category to match an existing label case-insensitively', () => {
    useEditorStore.getState().createFrameworkColorToken({
      slug: 'primary',
      lightValue: 'hsla(238, 100%, 62%, 1)',
      category: 'Brand',
    })
    const second = useEditorStore.getState().createFrameworkColorToken({
      slug: 'secondary',
      lightValue: 'hsla(0, 94%, 68%, 1)',
    })

    useEditorStore.getState().updateFrameworkColorToken(second.id, { category: 'BRAND' })

    const updated = useEditorStore.getState().site!.settings.framework!.colors.tokens.find(
      (token) => token.id === second.id,
    )
    expect(updated?.category).toBe('Brand')
  })
})
