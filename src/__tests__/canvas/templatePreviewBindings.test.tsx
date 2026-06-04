import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEditorStore } from '@site/store/store'
import { CanvasRoot } from '@site/canvas/CanvasRoot'
import { makeNode, makePage, makeSite } from '../fixtures'
import '@modules/base'

function renderCanvas() {
  return render(<CanvasRoot />)
}

const originalFetch = globalThis.fetch

const postsTable = {
  id: 'posts',
  name: 'Posts',
  slug: 'posts',
  kind: 'postType',
  routeBase: '/posts',
  singularLabel: 'Post',
  pluralLabel: 'Posts',
  primaryFieldId: 'title',
  fields: [
    { type: 'text', id: 'title', label: 'Title', required: true, builtIn: true },
    { type: 'text', id: 'slug', label: 'Slug', required: true, builtIn: true },
    { type: 'richText', id: 'body', label: 'Body', format: 'markdown', builtIn: true },
    { type: 'media', id: 'featuredMedia', label: 'Featured media', mediaKind: 'image', builtIn: true },
    { type: 'text', id: 'seoTitle', label: 'SEO title', builtIn: true },
    { type: 'longText', id: 'seoDescription', label: 'SEO description', builtIn: true },
  ],
  system: true,
  rowCount: 0,
  createdByUserId: null,
  updatedByUserId: null,
  createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z',
}

beforeEach(() => {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeBreakpointId: 'mobile',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === '/admin/api/cms/data/tables') {
      return new Response(JSON.stringify({ tables: [postsTable] }), { status: 200 })
    }

    return new Response('{}', { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe('canvas template preview bindings', () => {
  it('renders template dynamic bindings with synthetic preview data from the table schema', async () => {
    const root = makeNode({ id: 'root', moduleId: 'base.body', children: ['title'] })
    const title = makeNode({
      id: 'title',
      moduleId: 'base.text',
      props: { text: 'Static fallback', tag: 'h1' },
      dynamicBindings: {
        text: { source: 'currentEntry', field: 'title' },
      },
    })
    const template = makePage({
      id: 'page-template',
      title: 'Post Template',
      slug: 'post-template',
      rootNodeId: 'root',
      nodes: { root, title },
      template: {
        enabled: true,
        target: { kind: 'postTypes', tableSlugs: ['posts'] },
        priority: 100,
      },
    })

    useEditorStore.setState({
      site: makeSite({ pages: [template] }),
      activePageId: template.id,
      activeDocument: { kind: 'page', pageId: template.id },
    } as Parameters<typeof useEditorStore.setState>[0])

    renderCanvas()

    // Canvas page tree renders inside per-breakpoint iframes; `screen` only
    // sees the parent document. Pull the iframe document directly.
    await waitFor(() => {
      const text = combinedCanvasText()
      expect(text).toContain('Example Post Title')
    })
    expect(combinedCanvasText()).not.toContain('Static fallback')
  })

  it('renders no image when featured media binding resolves to null in preview', async () => {
    const root = makeNode({ id: 'root', moduleId: 'base.body', children: ['image'] })
    const image = makeNode({
      id: 'image',
      moduleId: 'base.image',
      props: { src: '', loading: 'lazy' },
      dynamicBindings: {
        src: { source: 'currentEntry', field: 'featuredMedia', format: 'media' },
      },
    })
    const template = makePage({
      id: 'page-template',
      title: 'Post Template',
      slug: 'post-template',
      rootNodeId: 'root',
      nodes: { root, image },
      template: {
        enabled: true,
        target: { kind: 'postTypes', tableSlugs: ['posts'] },
        priority: 100,
      },
    })

    useEditorStore.setState({
      site: makeSite({ pages: [template] }),
      activePageId: template.id,
      activeDocument: { kind: 'page', pageId: template.id },
    } as Parameters<typeof useEditorStore.setState>[0])

    renderCanvas()

    await waitFor(() => {
      // No image element with the placeholder alt text should be rendered.
      const altMatch = canvasFrameDocs().some((doc) =>
        doc.querySelector('img[alt="Template image"]') !== null,
      )
      expect(altMatch).toBe(false)
      expect(combinedCanvasText()).toContain('No image selected')
    })
  })
})

function canvasFrameDocs(): Document[] {
  const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe')).filter(
    (i) => i.title.startsWith('Canvas frame for '),
  )
  return iframes.map((i) => i.contentDocument).filter((d): d is Document => d !== null)
}

function combinedCanvasText(): string {
  return canvasFrameDocs().map((doc) => doc.body.textContent ?? '').join(' ')
}
