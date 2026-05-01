import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SiteExplorerPanel } from '../../editor/components/SiteExplorerPanel'
import { useEditorStore } from '../../core/editor-store/store'
import { makeNode, makePage, makeSite } from '../fixtures'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    siteExplorerPanelOpen: false,
    selectedNodeId: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

function loadTemplateSite() {
  const homeRoot = makeNode({ id: 'root-home', moduleId: 'base.root' })
  const templateRoot = makeNode({ id: 'root-template', moduleId: 'base.root' })
  templateRoot.dynamicBindings = {
    text: { source: 'currentEntry', field: 'title' },
  }

  const home = makePage({
    id: 'page-home',
    title: 'Home',
    slug: 'index',
    rootNodeId: 'root-home',
    nodes: { 'root-home': homeRoot },
  })
  const template = makePage({
    id: 'page-template',
    title: 'Post Template',
    slug: 'post-template',
    rootNodeId: 'root-template',
    nodes: { 'root-template': templateRoot },
    template: {
      enabled: true,
      context: 'entry',
      collectionId: 'posts',
      priority: 20,
      conditions: [],
    },
  })

  useEditorStore.setState({
    site: makeSite({ pages: [home, template] }),
    activePageId: home.id,
    activeDocument: { kind: 'page', pageId: home.id },
    siteExplorerPanelOpen: true,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

describe('SiteExplorerPanel templates', () => {
  it('shows pages and templates in separate sections', () => {
    loadTemplateSite()
    render(<SiteExplorerPanel variant="docked" />)

    const panel = screen.getByTestId('site-explorer-panel')
    const pagesSection = within(panel).getByRole('heading', { name: 'Pages' }).closest('section')!
    const templatesSection = within(panel).getByRole('heading', { name: 'Templates' }).closest('section')!

    expect(within(pagesSection).getByRole('button', { name: /open page home/i })).toBeDefined()
    expect(within(pagesSection).queryByRole('button', { name: /open template post template/i })).toBeNull()
    expect(within(templatesSection).getByRole('button', { name: /open template post template/i })).toBeDefined()
  })

  it('converts a page to a template from the context menu', () => {
    loadTemplateSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /open page home/i }), {
      clientX: 100,
      clientY: 120,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /use as template/i }))

    const dialog = screen.getByRole('dialog', { name: 'Template settings' })
    expect(within(dialog).queryByLabelText('Preview entry ID')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('Priority'), {
      target: { value: '50' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    const page = useEditorStore.getState().site?.pages.find((candidate) => candidate.id === 'page-home')
    expect(page?.template).toMatchObject({
      enabled: true,
      context: 'entry',
      collectionId: 'posts',
      priority: 50,
    })
  })

  it('uses the shared Select dropdown for the template collection field', async () => {
    let collectionRequests = 0
    globalThis.fetch = async (input: RequestInfo | URL) => {
      if (String(input) === '/api/cms/content/collections') {
        collectionRequests += 1
        return new Response(JSON.stringify({
          collections: [
            {
              id: 'posts',
              name: 'Posts',
              slug: 'posts',
              routeBase: '/posts',
              singularLabel: 'Post',
              pluralLabel: 'Posts',
              createdAt: '2026-05-01T10:00:00.000Z',
              updatedAt: '2026-05-01T10:00:00.000Z',
            },
            {
              id: 'projects',
              name: 'Projects',
              slug: 'projects',
              routeBase: '/projects',
              singularLabel: 'Project',
              pluralLabel: 'Projects',
              createdAt: '2026-05-01T10:00:00.000Z',
              updatedAt: '2026-05-01T10:00:00.000Z',
            },
          ],
        }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      return new Response(JSON.stringify({ error: `Unhandled ${String(input)}` }), { status: 500 })
    }

    loadTemplateSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /open page home/i }), {
      clientX: 100,
      clientY: 120,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /use as template/i }))

    const dialog = screen.getByRole('dialog', { name: 'Template settings' })
    const collectionControl = within(dialog).getByRole('combobox', { name: 'Collection' })
    expect(collectionControl.tagName).toBe('INPUT')

    await waitFor(() => expect(collectionRequests).toBe(1))
    fireEvent.click(collectionControl)
    const collectionMenu = await screen.findByRole('menu', { name: 'Collection' })
    fireEvent.click(within(collectionMenu).getByRole('menuitem', { name: 'Projects' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    const page = useEditorStore.getState().site?.pages.find((candidate) => candidate.id === 'page-home')
    expect(page?.template?.collectionId).toBe('projects')
  })

  it('converts a template back to a page and drops bindings', () => {
    loadTemplateSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /open template post template/i }), {
      clientX: 100,
      clientY: 120,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /convert to page/i }))

    const page = useEditorStore.getState().site?.pages.find((candidate) => candidate.id === 'page-template')
    expect(page?.template).toBeUndefined()
    expect(page?.nodes['root-template'].dynamicBindings).toBeUndefined()
  })
})
