import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ContentAdmin } from '../../content/ContentAdmin'
import { useEditorStore } from '../../core/editor-store/store'
import { makeSite } from '../fixtures'
import { Toolbar } from '../../editor/components/Toolbar'
import { AdminSectionNavigation } from '../../app/EditorLayout'

const originalFetch = globalThis.fetch

const imageAsset = {
  id: 'asset_image_1',
  filename: 'hero.png',
  publicPath: '/uploads/hero.png',
  mimeType: 'image/png',
  sizeBytes: 2048,
  width: 1200,
  height: 800,
  durationSeconds: null,
  createdAt: '2026-05-01T10:00:00.000Z',
}

const videoAsset = {
  id: 'asset_video_1',
  filename: 'intro.mp4',
  publicPath: '/uploads/intro.mp4',
  mimeType: 'video/mp4',
  sizeBytes: 4096,
  width: 1920,
  height: 1080,
  durationSeconds: 12,
  createdAt: '2026-05-01T10:05:00.000Z',
}

interface FetchCall {
  input: RequestInfo | URL
  init?: RequestInit
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="current route">{location.pathname}</output>
}

beforeEach(() => {
  const site = makeSite({ name: 'Content Shell Site' })
  localStorage.clear()
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
    selectedNodeId: null,
    hoveredNodeId: null,
    activeBreakpointId: 'desktop',
    domTreePanel: { collapsed: false, x: 0, y: 0, width: 280 },
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 360 },
    propertiesPanelMode: 'docked',
    leftSidebarWidth: 320,
    focusedPanel: 'canvas',
    siteExplorerPanelOpen: false,
    mediaExplorerPanelOpen: false,
    codeEditorPanelOpen: false,
    activeEditorFileId: null,
    activeMediaAssetPreview: null,
    dependenciesPanelOpen: false,
    isAgentOpen: false,
    isAgentStreaming: false,
    agentMessages: [],
    agentError: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])

  const calls: FetchCall[] = []
  ;(globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls = calls
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ input, init })
    const url = String(input)

    if (url === '/api/cms/content/collections') {
      return json({
        collections: [{
          id: 'posts',
          name: 'Posts',
          slug: 'posts',
          routeBase: '/posts',
          singularLabel: 'Post',
          pluralLabel: 'Posts',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
        }],
      })
    }

    if (url === '/api/cms/content/collections/posts/entries' && init?.method === 'GET') {
      return json({ entries: [] })
    }

    if (url === '/api/cms/content/collections/posts/entries' && init?.method === 'POST') {
      return json({
        entry: {
          id: 'entry_1',
          collectionId: 'posts',
          title: 'Untitled',
          slug: 'untitled',
          status: 'draft',
          bodyMarkdown: '',
          featuredMediaId: null,
          seoTitle: '',
          seoDescription: '',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:00:00.000Z',
          publishedAt: null,
          deletedAt: null,
        },
      }, 201)
    }

    if (url === '/api/cms/content/entries/entry_1' && init?.method === 'PUT') {
      const draft = JSON.parse(String(init.body))
      return json({
        entry: {
          id: 'entry_1',
          collectionId: 'posts',
          status: 'draft',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:01:00.000Z',
          publishedAt: null,
          deletedAt: null,
          ...draft,
        },
      })
    }

    if (url === '/api/cms/content/entries/entry_1/publish' && init?.method === 'POST') {
      return json({
        entry: {
          id: 'entry_1',
          collectionId: 'posts',
          title: 'My first post',
          slug: 'untitled',
          status: 'published',
          bodyMarkdown: '## Intro',
          featuredMediaId: null,
          seoTitle: '',
          seoDescription: '',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:02:00.000Z',
          publishedAt: '2026-05-01T10:02:00.000Z',
          deletedAt: null,
        },
      })
    }

    if (url === '/api/cms/content/entries/entry_1/status' && init?.method === 'PATCH') {
      const body = JSON.parse(String(init.body))
      return json({
        entry: {
          id: 'entry_1',
          collectionId: 'posts',
          title: 'My first post',
          slug: 'updated-slug',
          status: body.status,
          bodyMarkdown: '## Intro',
          featuredMediaId: imageAsset.id,
          seoTitle: '',
          seoDescription: '',
          createdAt: '2026-05-01T10:00:00.000Z',
          updatedAt: '2026-05-01T10:03:00.000Z',
          publishedAt: null,
          deletedAt: null,
        },
      })
    }

    if (url === '/api/cms/media') {
      return json({ assets: [imageAsset, videoAsset] })
    }

    return json({ error: `Unhandled ${url}` }, 500)
  }
})

afterEach(() => {
  globalThis.fetch = originalFetch
  cleanup()
})

describe('ContentAdmin', () => {
  it('uses SPA navigation with active Site and Content labels in the shared toolbar', () => {
    render(
      <MemoryRouter initialEntries={['/admin/site']}>
        <Routes>
          <Route
            path="/admin/site"
            element={(
              <>
                <Toolbar
                  section="site"
                  adminNavigationSlot={<AdminSectionNavigation section="site" />}
                  rightSlot={<span>right</span>}
                />
                <LocationProbe />
              </>
            )}
          />
          <Route
            path="/admin/content"
            element={(
              <>
                <Toolbar
                  section="content"
                  adminNavigationSlot={<AdminSectionNavigation section="content" />}
                  rightSlot={<span>right</span>}
                />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Site')).toBeDefined()
    fireEvent.click(screen.getByRole('link', { name: 'Content' }))
    expect(screen.getByLabelText('current route').textContent).toBe('/admin/content')
    expect(screen.getByText('Content')).toBeDefined()
    expect(screen.getByRole('link', { name: 'Site' })).toBeDefined()
  })

  it('does not delay admin navigation or use route changes to collapse workspace panels', async () => {
    const transitionStarts: string[] = []

    render(
      <MemoryRouter initialEntries={['/admin/site']}>
        <Routes>
          <Route
            path="/admin/site"
            element={(
              <>
                <Toolbar
                  section="site"
                  adminNavigationSlot={(
                    <AdminSectionNavigation
                      section="site"
                      onWorkspaceNavigateStart={() => {
                        transitionStarts.push('content')
                        return 180
                      }}
                    />
                  )}
                  rightSlot={<span>site controls</span>}
                />
                <LocationProbe />
              </>
            )}
          />
          <Route
            path="/admin/content"
            element={(
              <>
                <Toolbar
                  section="content"
                  adminNavigationSlot={<AdminSectionNavigation section="content" />}
                  rightSlot={<span>content controls</span>}
                />
                <LocationProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('link', { name: 'Content' }))

    expect(transitionStarts).toEqual(['content'])
    expect(screen.getByLabelText('current route').textContent).toBe('/admin/content')
    expect(screen.getByText('content controls')).toBeDefined()

    const layoutSource = readFileSync(join(process.cwd(), 'src/app/EditorLayout.tsx'), 'utf8')
    expect(layoutSource).not.toContain('setLeftSidebarPanel(null)')
    expect(layoutSource).not.toContain('setPropertiesPanel({ collapsed: true })')
    expect(layoutSource).not.toContain('onBeforeWorkspaceExit')
  })

  it('does not fade or view-transition the central canvas surface during admin navigation', () => {
    const layoutCss = readFileSync(join(process.cwd(), 'src/app/EditorLayout.module.css'), 'utf8')

    expect(layoutCss).not.toContain('admin-canvas-content')
    expect(layoutCss).not.toMatch(/\.canvasContent\s*\{[^}]*animation:/s)
  })

  it('keeps loading skeletons visible until content entries finish loading', async () => {
    let resolveEntries: ((response: Response) => void) | null = null
    const entriesResponse = new Promise<Response>((resolve) => {
      resolveEntries = resolve
    })

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)

      if (url === '/api/cms/content/collections') {
        return json({
          collections: [{
            id: 'posts',
            name: 'Posts',
            slug: 'posts',
            routeBase: '/posts',
            singularLabel: 'Post',
            pluralLabel: 'Posts',
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T10:00:00.000Z',
          }],
        })
      }

      if (url === '/api/cms/content/collections/posts/entries' && init?.method === 'GET') {
        return entriesResponse
      }

      return json({ error: `Unhandled ${url}` }, 500)
    }

    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Posts')).toBeDefined()
    expect(screen.getByTestId('content-entries-loading')).toBeDefined()
    expect(screen.getByTestId('content-canvas-loading')).toBeDefined()
    expect(screen.getByTestId('content-settings-loading')).toBeDefined()
    expect(screen.queryByText('No entries yet.')).toBeNull()
    expect(screen.queryByText(/Create the first post/i)).toBeNull()

    resolveEntries?.(json({ entries: [] }))

    expect(await screen.findByText('No entries yet.')).toBeDefined()
    expect(await screen.findByText(/Create the first post/i)).toBeDefined()
  })

  it('mounts content inside the existing editor shell chrome', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('toolbar')).toBeDefined()
    expect(screen.getByTestId('left-sidebar')).toBeDefined()
    expect(screen.getByTestId('right-sidebar')).toBeDefined()
    expect(screen.getByTestId('content-explorer-panel')).toBeDefined()
    expect(screen.getByTestId('content-canvas-root')).toBeDefined()
    expect(screen.getByTestId('content-settings-panel')).toBeDefined()
    expect(screen.getByTestId('canvas-notch')).toBeDefined()
    expect(screen.getByText('Content Shell Site')).toBeDefined()
  })

  it('uses content-specific rail panels instead of editor-only panels', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByTestId('content-explorer-panel')

    expect(screen.getByTestId('panel-rail-content').getAttribute('aria-label')).toBe('Close Content panel')
    expect(screen.getByTestId('panel-rail-media').getAttribute('aria-label')).toBe('Open Media panel')
    expect(screen.queryByLabelText('Open Layers panel')).toBeNull()
    expect(screen.queryByLabelText('Open AI assistant panel')).toBeNull()
    expect(screen.queryByLabelText('Open Dependencies panel')).toBeNull()
  })

  it('reuses the shared media explorer panel in the content rail', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByTestId('content-explorer-panel')

    fireEvent.click(screen.getByTestId('panel-rail-media'))

    expect(await screen.findByTestId('media-explorer-panel')).toBeDefined()
    expect(screen.getByLabelText('Search media')).toBeDefined()
    expect(screen.getByRole('button', { name: 'List view' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Grid view' })).toBeDefined()
    expect(screen.queryByTestId('content-media-panel')).toBeNull()
  })

  it('creates, edits, saves, and publishes a rich Markdown-backed post', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Posts')).toBeDefined()
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Entries' }))
        .getByRole('button', { name: /new post/i }),
    )

    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'My first post' } })

    const firstBlock = await screen.findByTestId('content-block-0')
    firstBlock.textContent = '## Intro'
    fireEvent.input(firstBlock)

    expect(screen.getByRole('heading', { name: 'Intro' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    await screen.findByText('Draft saved')

    fireEvent.click(screen.getByRole('button', { name: /publish/i }))
    await screen.findByText('Published')

    const calls = (globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls ?? []
    const saveCall = calls.find((call) => String(call.input) === '/api/cms/content/entries/entry_1' && call.init?.method === 'PUT')
    expect(saveCall?.init?.body).toBe(JSON.stringify({
      title: 'My first post',
      slug: 'untitled',
      bodyMarkdown: '## Intro',
      featuredMediaId: null,
      seoTitle: '',
      seoDescription: '',
    }))
    expect(calls.some((call) =>
      String(call.input) === '/api/cms/content/entries/entry_1/publish' &&
      call.init?.method === 'POST'
    )).toBe(true)
  })

  it('opens the selected post in a new browser tab from the content toolbar', async () => {
    const originalOpen = window.open
    const openCalls: unknown[] = []
    window.open = ((...args: unknown[]) => {
      openCalls.push(args)
      return null
    }) as typeof window.open

    try {
      render(
        <MemoryRouter>
          <ContentAdmin />
        </MemoryRouter>,
      )

      await screen.findByText('Posts')
      fireEvent.click(
        within(screen.getByRole('region', { name: 'Entries' }))
          .getByRole('button', { name: /new post/i }),
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /open post in new tab/i }).hasAttribute('disabled')).toBe(false)
      })
      fireEvent.click(screen.getByRole('button', { name: /open post in new tab/i }))

      expect(openCalls).toEqual([['/posts/untitled', '_blank', 'noopener,noreferrer']])
    } finally {
      window.open = originalOpen
    }
  })

  it('opens semantic paragraph, heading level, and media choices from the block chrome', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByText('Posts')
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Entries' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    firstBlock.textContent = 'First block'
    fireEvent.input(firstBlock)

    fireEvent.click(screen.getByRole('button', { name: /change block 1 type/i }))

    expect(screen.getByRole('menuitem', { name: /paragraph/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /heading 2/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /heading 3/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /heading 4/i })).toBeDefined()
    expect(screen.getByRole('menuitem', { name: /media/i })).toBeDefined()
    expect(screen.queryByRole('menuitem', { name: /^heading$/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /image/i })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /video/i })).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: /heading 3/i }))
    expect(screen.getByRole('heading', { level: 3, name: 'First block' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    await screen.findByText('Draft saved')

    const calls = (globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls ?? []
    const saveCalls = calls.filter((call) => String(call.input) === '/api/cms/content/entries/entry_1' && call.init?.method === 'PUT')
    expect(saveCalls.at(-1)?.init?.body).toBe(JSON.stringify({
      title: 'Untitled',
      slug: 'untitled',
      bodyMarkdown: '### First block',
      featuredMediaId: null,
      seoTitle: '',
      seoDescription: '',
    }))
  })

  it('uses one media block type that can select image and video assets', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByText('Posts')
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Entries' }))
        .getByRole('button', { name: /new post/i }),
    )

    await screen.findByTestId('content-block-0')
    fireEvent.click(screen.getByRole('button', { name: /change block 1 type/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /media/i }))

    fireEvent.click(screen.getByRole('button', { name: /choose media/i }))
    fireEvent.click(await screen.findByRole('button', { name: /hero\.png/i }))

    expect(screen.getAllByTestId(/content-block-frame-/)).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'hero.png' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /replace media/i }))
    fireEvent.click(await screen.findByRole('button', { name: /intro\.mp4/i }))

    expect(screen.getAllByTestId(/content-block-frame-/)).toHaveLength(1)
    expect(screen.getByText('/uploads/intro.mp4')).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    await screen.findByText('Draft saved')

    const calls = (globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls ?? []
    const saveCalls = calls.filter((call) => String(call.input) === '/api/cms/content/entries/entry_1' && call.init?.method === 'PUT')
    expect(saveCalls.at(-1)?.init?.body).toBe(JSON.stringify({
      title: 'Untitled',
      slug: 'untitled',
      bodyMarkdown: '@[video](/uploads/intro.mp4)',
      featuredMediaId: null,
      seoTitle: '',
      seoDescription: '',
    }))
  })

  it('reorders blocks by vertically dragging the block handle', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByText('Posts')
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Entries' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    firstBlock.textContent = 'First block'
    fireEvent.input(firstBlock)

    fireEvent.click(screen.getByRole('button', { name: /add text/i }))
    const secondBlock = await screen.findByTestId('content-block-1')
    secondBlock.textContent = 'Second block'
    fireEvent.input(secondBlock)

    expect(screen.getByLabelText('Drag block 1')).toBeDefined()

    const firstFrame = screen.getByTestId('content-block-frame-0')
    const secondFrame = screen.getByTestId('content-block-frame-1')
    Object.defineProperty(firstFrame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 100,
        bottom: 150,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(secondFrame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 170,
        bottom: 220,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
        x: 0,
        y: 170,
        toJSON: () => ({}),
      }),
    })

    const firstHandle = screen.getByLabelText('Drag block 1')
    fireEvent.pointerDown(firstHandle, {
      pointerId: 1,
      button: 0,
      clientX: 30,
      clientY: 125,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 300,
      clientY: 205,
    })
    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: 300,
      clientY: 205,
    })

    const frames = screen.getAllByTestId(/content-block-frame-/)
    expect(frames[0].textContent).toContain('Second block')
    expect(frames[1].textContent).toContain('First block')
  })

  it('keeps the dragged block visually anchored on drop before settling into place', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByText('Posts')
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Entries' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    firstBlock.textContent = 'First block'
    fireEvent.input(firstBlock)

    fireEvent.click(screen.getByRole('button', { name: /add text/i }))
    const secondBlock = await screen.findByTestId('content-block-1')
    secondBlock.textContent = 'Second block'
    fireEvent.input(secondBlock)

    const firstFrame = screen.getByTestId('content-block-frame-0')
    const secondFrame = screen.getByTestId('content-block-frame-1')
    Object.defineProperty(firstFrame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 100,
        bottom: 150,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => ({}),
      }),
    })
    Object.defineProperty(secondFrame, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        top: 170,
        bottom: 220,
        left: 0,
        right: 400,
        width: 400,
        height: 50,
        x: 0,
        y: 170,
        toJSON: () => ({}),
      }),
    })

    const firstHandle = screen.getByLabelText('Drag block 1')
    fireEvent.pointerDown(firstHandle, {
      pointerId: 1,
      button: 0,
      clientX: 30,
      clientY: 125,
    })
    fireEvent.pointerMove(window, {
      pointerId: 1,
      clientX: 300,
      clientY: 205,
    })
    fireEvent.pointerUp(window, {
      pointerId: 1,
      clientX: 300,
      clientY: 205,
    })

    const droppedFrame = screen.getAllByTestId(/content-block-frame-/)[1]
    expect(droppedFrame.textContent).toContain('First block')
    expect(droppedFrame.getAttribute('data-drop-phase')).toBe('position')
    expect(droppedFrame.style.getPropertyValue('--content-block-translate-y')).toBe('10px')
  })

  it('edits slug, status, and featured media from the settings sidebar', async () => {
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByText('Posts')
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Entries' }))
        .getByRole('button', { name: /new post/i }),
    )
    const title = await screen.findByLabelText('Title')
    fireEvent.change(title, { target: { value: 'My first post' } })
    fireEvent.click(screen.getByRole('button', { name: /publish/i }))
    await screen.findByText('Published')

    const slugInput = screen.getByLabelText('Slug') as HTMLInputElement
    expect(slugInput.disabled).toBe(false)
    fireEvent.change(slugInput, { target: { value: 'updated slug' } })

    fireEvent.click(screen.getByRole('button', { name: /choose featured media/i }))
    fireEvent.click(await screen.findByRole('button', { name: /hero\.png/i }))

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    await screen.findByText('Draft saved')

    fireEvent.change(screen.getByLabelText('Status'), {
      target: { value: 'unpublished' },
    })
    await screen.findByText('Unpublished')

    const calls = (globalThis as typeof globalThis & { __contentFetchCalls?: FetchCall[] }).__contentFetchCalls ?? []
    const saveCalls = calls.filter((call) => String(call.input) === '/api/cms/content/entries/entry_1' && call.init?.method === 'PUT')
    expect(saveCalls.at(-1)?.init?.body).toBe(JSON.stringify({
      title: 'My first post',
      slug: 'updated-slug',
      bodyMarkdown: '',
      featuredMediaId: imageAsset.id,
      seoTitle: '',
      seoDescription: '',
    }))
    expect(calls.some((call) =>
      String(call.input) === '/api/cms/content/entries/entry_1/status' &&
      call.init?.method === 'PATCH' &&
      call.init?.body === JSON.stringify({ status: 'unpublished' })
    )).toBe(true)
  })

  it('hydrates saved featured media metadata when reopening the content page', async () => {
    const baseFetch = globalThis.fetch
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/cms/content/collections/posts/entries' && init?.method === 'GET') {
        return json({
          entries: [{
            id: 'entry_1',
            collectionId: 'posts',
            title: 'First post',
            slug: 'first-post',
            status: 'published',
            bodyMarkdown: '',
            featuredMediaId: imageAsset.id,
            seoTitle: '',
            seoDescription: '',
            createdAt: '2026-05-01T10:00:00.000Z',
            updatedAt: '2026-05-01T10:01:00.000Z',
            publishedAt: '2026-05-01T10:01:00.000Z',
            deletedAt: null,
          }],
        })
      }

      return baseFetch(input, init)
    }

    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    expect(await screen.findByText(imageAsset.filename)).toBeDefined()
    expect(screen.getByText(imageAsset.publicPath)).toBeDefined()
    expect(screen.queryByText(imageAsset.id)).toBeNull()
  })

  it('keeps typed paragraph text in left-to-right order while editing', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByText('Posts')
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Entries' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    await user.click(firstBlock)
    await user.keyboard('hello there')

    expect(firstBlock.textContent).toBe('hello there')
  })

  it('moves typing into the new paragraph after pressing Enter', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <ContentAdmin />
      </MemoryRouter>,
    )

    await screen.findByText('Posts')
    fireEvent.click(
      within(screen.getByRole('region', { name: 'Entries' }))
        .getByRole('button', { name: /new post/i }),
    )

    const firstBlock = await screen.findByTestId('content-block-0')
    await user.click(firstBlock)
    await user.keyboard('hello')
    await user.keyboard('{Enter}')

    const secondBlock = await screen.findByTestId('content-block-1')
    expect(document.activeElement).toBe(secondBlock)

    await user.keyboard('world')

    expect(firstBlock.textContent).toBe('hello')
    expect(secondBlock.textContent).toBe('world')
  })

  it('keeps contenteditable text blocks uncontrolled so rerenders do not reset the caret', () => {
    const src = readFileSync(join(process.cwd(), 'src/content/RichMarkdownEditor.tsx'), 'utf8')

    expect(src).toContain('EditableTextBlock')
    expect(src).not.toContain('{block.text}')
  })
})
