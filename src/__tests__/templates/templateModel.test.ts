import { describe, expect, it } from 'bun:test'
import { makeSite } from '../fixtures'
import { validateSite } from '../../core/persistence/validate'
import { useEditorStore } from '../../core/editor-store/store'

describe('dynamic template model', () => {
  it('validates and preserves page template metadata and node dynamic bindings', () => {
    const site = makeSite()
    const page = site.pages[0]
    const root = page.nodes[page.rootNodeId]
    page.template = {
      enabled: true,
      context: 'entry',
      collectionId: 'posts',
      priority: 100,
      conditions: [],
    }
    root.dynamicBindings = {
      text: { source: 'currentEntry', field: 'title', format: 'plain', fallback: 'static' },
    }

    const validated = validateSite(site)

    expect(validated.pages[0].template).toEqual(page.template)
    expect(validated.pages[0].nodes[page.rootNodeId].dynamicBindings?.text).toEqual({
      source: 'currentEntry',
      field: 'title',
      format: 'plain',
      fallback: 'static',
    })
  })

  it('converts a template back to a page by removing template metadata and all bindings', () => {
    const site = makeSite()
    const page = site.pages[0]
    const root = page.nodes[page.rootNodeId]
    page.template = { enabled: true, context: 'entry', collectionId: 'posts', priority: 100, conditions: [] }
    root.dynamicBindings = {
      text: { source: 'currentEntry', field: 'title' },
    }

    useEditorStore.setState({ site, activePageId: page.id, hasUnsavedChanges: false })
    useEditorStore.getState().convertTemplateToPage(page.id)

    const nextPage = useEditorStore.getState().site?.pages[0]
    expect(nextPage?.template).toBeUndefined()
    expect(nextPage?.nodes[page.rootNodeId].dynamicBindings).toBeUndefined()
    expect(useEditorStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('sets and removes a node dynamic binding without changing the static prop fallback', () => {
    const site = makeSite()
    const page = site.pages[0]
    const root = page.nodes[page.rootNodeId]
    root.props = { text: 'Static fallback' }

    useEditorStore.setState({ site, activePageId: page.id, hasUnsavedChanges: false })
    useEditorStore.getState().setNodeDynamicBinding(root.id, 'text', {
      source: 'currentEntry',
      field: 'title',
    })

    expect(useEditorStore.getState().site?.pages[0].nodes[root.id].props.text).toBe('Static fallback')
    expect(useEditorStore.getState().site?.pages[0].nodes[root.id].dynamicBindings?.text?.field).toBe('title')

    useEditorStore.getState().clearNodeDynamicBinding(root.id, 'text')

    expect(useEditorStore.getState().site?.pages[0].nodes[root.id].props.text).toBe('Static fallback')
    expect(useEditorStore.getState().site?.pages[0].nodes[root.id].dynamicBindings).toBeUndefined()
  })
})
