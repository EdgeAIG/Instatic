import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { useEditorStore } from '../../core/editor-store/store'
import { CanvasRoot } from '../../editor/components/Canvas/CanvasRoot'
import { makeNode, makePage, makeSite } from '../fixtures'
import '../../modules/base'

const originalFetch = globalThis.fetch

beforeEach(() => {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    activeDocument: null,
    selectedNodeId: null,
    hoveredNodeId: null,
    activeBreakpointId: 'mobile',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input) === '/api/cms/content/collections/posts/entries') {
      return new Response(JSON.stringify({
        entries: [
          {
            id: 'entry-old',
            collectionId: 'posts',
            title: 'Old Post',
            slug: 'old-post',
            status: 'draft',
            bodyMarkdown: '',
            featuredMediaId: null,
            seoTitle: '',
            seoDescription: '',
            createdAt: '2026-05-01T08:00:00.000Z',
            updatedAt: '2026-05-01T08:00:00.000Z',
            publishedAt: null,
            deletedAt: null,
          },
          {
            id: 'entry-latest',
            collectionId: 'posts',
            title: 'Latest Post',
            slug: 'latest-post',
            status: 'draft',
            bodyMarkdown: '',
            featuredMediaId: 'media-cover',
            seoTitle: '',
            seoDescription: '',
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T10:00:00.000Z',
            publishedAt: null,
            deletedAt: null,
          },
        ],
      }), { status: 200 })
    }

    if (String(input) === '/api/cms/media') {
      return new Response(JSON.stringify({
        assets: [
          {
            id: 'media-cover',
            filename: 'cover.png',
            mimeType: 'image/png',
            sizeBytes: 1024,
            publicPath: '/uploads/template-cover.png',
            createdAt: '2026-05-01T09:00:00.000Z',
          },
        ],
      }), { status: 200 })
    }

    return new Response('{}', { status: 404 })
  }) as typeof fetch
})

afterEach(() => {
  cleanup()
  globalThis.fetch = originalFetch
})

describe('canvas template preview bindings', () => {
  it('renders template dynamic bindings with the latest entry from the template collection', async () => {
    const root = makeNode({ id: 'root', moduleId: 'base.root', children: ['title'] })
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
        context: 'entry',
        collectionId: 'posts',
        priority: 100,
        conditions: [],
      },
    })

    useEditorStore.setState({
      site: makeSite({ pages: [template] }),
      activePageId: template.id,
      activeDocument: { kind: 'page', pageId: template.id },
    } as Parameters<typeof useEditorStore.setState>[0])

    render(<CanvasRoot />)

    await waitFor(() => {
      expect(screen.getAllByText('Latest Post').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Static fallback')).toBeNull()
  })

  it('renders featured media bindings with the latest entry media asset', async () => {
    const root = makeNode({ id: 'root', moduleId: 'base.root', children: ['image'] })
    const image = makeNode({
      id: 'image',
      moduleId: 'base.image',
      props: { src: '', alt: 'Template image', loading: 'lazy' },
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
        context: 'entry',
        collectionId: 'posts',
        priority: 100,
        conditions: [],
      },
    })

    useEditorStore.setState({
      site: makeSite({ pages: [template] }),
      activePageId: template.id,
      activeDocument: { kind: 'page', pageId: template.id },
    } as Parameters<typeof useEditorStore.setState>[0])

    render(<CanvasRoot />)

    await waitFor(() => {
      expect(screen.getAllByAltText('Template image')[0].getAttribute('src')).toBe('/uploads/template-cover.png')
    })
    expect(screen.queryByText('No image selected')).toBeNull()
  })
})
