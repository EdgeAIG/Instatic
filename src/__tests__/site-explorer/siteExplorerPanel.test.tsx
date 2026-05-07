import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import React from 'react'
import { DndContext } from '@dnd-kit/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'fs'
import { SiteExplorerPanel } from '../../editor/components/SiteExplorerPanel'
import { MediaExplorerPanel } from '../../editor/components/MediaExplorerPanel'
import { CodeEditorPanel } from '../../editor/components/CodeEditor'
import { useEditorStore } from '@core/editor-store/store'
import { makeNode, makePage, makeSite } from '../fixtures'
import type { VisualComponent } from '@core/visualComponents/schemas'
import '../../modules/base/index'

afterEach(cleanup)

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
    hoveredNodeId: null,
    activeDocument: null,
    siteExplorerPanelOpen: false,
    mediaExplorerPanelOpen: false,
    codeEditorPanelOpen: false,
    activeEditorFileId: null,
    activeMediaAssetPreview: null,
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])
}

function makeVisualComponent(name: string): VisualComponent {
  const rootId = `root-${name}`
  return {
    id: `vc-${name}`,
    name,
    tree: {
      rootNodeId: rootId,
      nodes: {
        [rootId]: {
          id: rootId,
          moduleId: 'base.body',
          props: {},
          children: [],
          breakpointOverrides: {},
          classIds: [],
        },
      },
    },
    params: [],
    breakpoints: [],
    classIds: [],
    createdAt: 1_700_000_000_000,
  }
}

function loadSite() {
  const home = makePage({
    id: 'page-home',
    title: 'Home',
    slug: 'index',
    rootNodeId: 'root-home',
    nodes: {
      'root-home': makeNode({ id: 'root-home', moduleId: 'base.body' }),
    },
  })
  const pricing = makePage({
    id: 'page-pricing',
    title: 'Pricing',
    slug: 'pricing',
    rootNodeId: 'root-pricing',
    nodes: {
      'root-pricing': makeNode({ id: 'root-pricing', moduleId: 'base.body' }),
    },
  })

  useEditorStore.setState({
    site: makeSite({
      pages: [home, pricing],
      visualComponents: [makeVisualComponent('HeroCard')],
      files: [
        {
          id: 'style-1',
          path: 'src/styles/theme.css',
          type: 'style',
          content: ':root { color-scheme: light; }',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'script-1',
          path: 'src/scripts/analytics.ts',
          type: 'script',
          content: 'export {}',
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'asset-1',
          path: 'public/logo.svg',
          type: 'asset',
          blob: { mimeType: 'image/svg+xml', base64: 'PHN2Zy8+' },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'asset-video-1',
          path: 'public/intro.mp4',
          type: 'asset',
          blob: { mimeType: 'video/mp4', base64: 'AAAA' },
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'asset-other-1',
          path: 'public/catalog.pdf',
          type: 'asset',
          blob: { mimeType: 'application/pdf', base64: 'AAAA' },
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }),
    activePageId: 'page-home',
    siteExplorerPanelOpen: true,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)

describe('SiteExplorerPanel', () => {
  it('uses the shared site creation dialog instead of native prompts', () => {
    const source = readFileSync(
      new URL('../../editor/components/SiteExplorerPanel/SiteExplorerPanel.tsx', import.meta.url),
      'utf-8',
    )

    expect(source).not.toContain('window.prompt')
    expect(source).toContain('SiteCreateDialog')
  })

  it('shows site concepts without media assets', () => {
    loadSite()
    render(<SiteExplorerPanel variant="docked" />)

    const panel = screen.getByTestId('site-explorer-panel')
    expect(within(panel).getByRole('heading', { name: 'Pages' })).toBeDefined()
    expect(within(panel).getByRole('heading', { name: 'Components' })).toBeDefined()
    expect(within(panel).getByRole('heading', { name: 'Styles' })).toBeDefined()
    expect(within(panel).getByRole('heading', { name: 'Scripts' })).toBeDefined()
    expect(within(panel).queryByRole('heading', { name: 'Assets' })).toBeNull()

    expect(within(panel).getByRole('button', { name: /open page home/i })).toBeDefined()
    expect(within(panel).getByRole('button', { name: /open component herocard/i })).toBeDefined()
    expect(within(panel).getByText('theme.css')).toBeDefined()
    expect(within(panel).getByText('analytics.ts')).toBeDefined()
    expect(within(panel).queryByText('logo.svg')).toBeNull()

    expect(within(panel).queryByText('src/pages/Index.tsx')).toBeNull()
    expect(within(panel).queryByText('src/components/HeroCard.tsx')).toBeNull()
  })

  it('Media Explorer uses CMS media instead of base64 site files', () => {
    const source = readFileSync(
      new URL('../../editor/components/MediaExplorerPanel/MediaExplorerPanel.tsx', import.meta.url),
      'utf-8',
    )

    expect(source).not.toContain('mediaMode')
    expect(source).not.toContain('ProjectMediaRows')
    expect(source).toContain('listCmsMediaAssets')
    expect(source).toContain('uploadCmsMediaAsset')
  })

  it('groups CMS media assets by image video and other categories', async () => {
    loadSite()
    useEditorStore.setState({
      siteExplorerPanelOpen: false,
      mediaExplorerPanelOpen: true,
    } as Parameters<typeof useEditorStore.setState>[0])
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        assets: [
          { id: 'media-image', filename: 'logo.svg', mimeType: 'image/svg+xml', sizeBytes: 12, publicPath: '/uploads/logo.svg', createdAt: '2026-01-03T00:00:00.000Z' },
          { id: 'media-video', filename: 'intro.mp4', mimeType: 'video/mp4', sizeBytes: 24, publicPath: '/uploads/intro.mp4', createdAt: '2026-01-03T00:00:00.000Z' },
          { id: 'media-other', filename: 'catalog.pdf', mimeType: 'application/pdf', sizeBytes: 36, publicPath: '/uploads/catalog.pdf', createdAt: '2026-01-03T00:00:00.000Z' },
        ],
      }), { status: 200 })) as typeof fetch

    try {
      render(<MediaExplorerPanel variant="docked" />)

      const panel = screen.getByTestId('media-explorer-panel')
      expect(within(panel).getByRole('heading', { name: 'Images' })).toBeDefined()
      expect(within(panel).getByRole('heading', { name: 'Videos' })).toBeDefined()
      expect(within(panel).getByRole('heading', { name: 'Other' })).toBeDefined()
      expect(await within(panel).findByRole('button', { name: /open media logo\.svg/i })).toBeDefined()
      expect(await within(panel).findByRole('button', { name: /open media intro\.mp4/i })).toBeDefined()
      expect(await within(panel).findByRole('button', { name: /open media catalog\.pdf/i })).toBeDefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('filters media by search text and switches between list and grid previews', async () => {
    loadSite()
    useEditorStore.setState({
      siteExplorerPanelOpen: false,
      mediaExplorerPanelOpen: true,
    } as Parameters<typeof useEditorStore.setState>[0])
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        assets: [
          { id: 'media-image', filename: 'logo.svg', mimeType: 'image/svg+xml', sizeBytes: 12, publicPath: '/uploads/logo.svg', createdAt: '2026-01-03T00:00:00.000Z' },
          { id: 'media-video', filename: 'intro.mp4', mimeType: 'video/mp4', sizeBytes: 24, publicPath: '/uploads/intro.mp4', createdAt: '2026-01-03T00:00:00.000Z' },
          { id: 'media-other', filename: 'catalog.pdf', mimeType: 'application/pdf', sizeBytes: 36, publicPath: '/uploads/catalog.pdf', createdAt: '2026-01-03T00:00:00.000Z' },
        ],
      }), { status: 200 })) as typeof fetch

    try {
      render(<MediaExplorerPanel variant="docked" />)

      const panel = screen.getByTestId('media-explorer-panel')
      await within(panel).findByRole('button', { name: /open media intro\.mp4/i })
      fireEvent.change(within(panel).getByRole('searchbox', { name: /search media/i }), {
        target: { value: 'intro' },
      })

      expect(within(panel).queryByRole('button', { name: /open media logo\.svg/i })).toBeNull()
      expect(within(panel).getByRole('button', { name: /open media intro\.mp4/i })).toBeDefined()
      expect(within(panel).queryByRole('button', { name: /open media catalog\.pdf/i })).toBeNull()

      fireEvent.change(within(panel).getByRole('searchbox', { name: /search media/i }), {
        target: { value: '' },
      })
      fireEvent.click(within(panel).getByRole('button', { name: /grid view/i }))

      expect(within(panel).getByRole('button', { name: /grid view/i }).getAttribute('aria-pressed')).toBe('true')
      expect(within(panel).getByTestId('media-grid-images')).toBeDefined()
      expect(within(panel).getByTestId('media-grid-videos')).toBeDefined()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('copies asset URLs from the media context menu', async () => {
    loadSite()
    useEditorStore.setState({
      siteExplorerPanelOpen: false,
      mediaExplorerPanelOpen: true,
    } as Parameters<typeof useEditorStore.setState>[0])
    const originalFetch = globalThis.fetch
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    let copied = ''
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          copied = text
        },
      },
    })
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        assets: [{
          id: 'media-1',
          filename: 'hero.png',
          mimeType: 'image/png',
          sizeBytes: 12,
          publicPath: '/uploads/hero.png',
          createdAt: '2026-01-03T00:00:00.000Z',
        }],
      }), { status: 200 })) as typeof fetch

    try {
      render(<MediaExplorerPanel variant="docked" />)

      const mediaRow = await screen.findByRole('button', { name: /open media hero\.png/i })
      fireEvent.contextMenu(mediaRow, { clientX: 120, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: /copy url/i }))

      await waitFor(() => {
        expect(copied).toBe('/uploads/hero.png')
      })
    } finally {
      globalThis.fetch = originalFetch
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard)
      } else {
        delete (navigator as typeof navigator & { clipboard?: Clipboard }).clipboard
      }
    }
  })

  it('applies image and video assets to the selected media modules', async () => {
    loadSite()
    const state = useEditorStore.getState()
    const site = structuredClone(state.site)
    if (!site) throw new Error('Expected site fixture')
    const home = site.pages.find((page) => page.id === 'page-home')
    if (!home) throw new Error('Expected home page fixture')
    home.nodes['image-node'] = makeNode({
      id: 'image-node',
      moduleId: 'base.image',
      props: { src: '', alt: '', loading: 'lazy' },
    })
    home.nodes['video-node'] = makeNode({
      id: 'video-node',
      moduleId: 'base.video',
      props: {
        source: 'youtube',
        youtubeId: '',
        videoUrl: '',
        autoplay: false,
        loop: false,
        muted: false,
        controls: true,
      },
    })
    home.nodes['root-home'] = {
      ...home.nodes['root-home'],
      children: ['image-node', 'video-node'],
    }
    useEditorStore.setState({
      site,
      selectedNodeId: 'image-node',
      siteExplorerPanelOpen: false,
      mediaExplorerPanelOpen: true,
    } as Parameters<typeof useEditorStore.setState>[0])

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        assets: [
          {
            id: 'media-image',
            filename: 'hero.png',
            mimeType: 'image/png',
            sizeBytes: 12,
            publicPath: '/uploads/hero.png',
            createdAt: '2026-01-03T00:00:00.000Z',
          },
          {
            id: 'media-video',
            filename: 'intro.mp4',
            mimeType: 'video/mp4',
            sizeBytes: 24,
            publicPath: '/uploads/intro.mp4',
            createdAt: '2026-01-03T00:00:00.000Z',
          },
        ],
      }), { status: 200 })) as typeof fetch

    try {
      render(<MediaExplorerPanel variant="docked" />)

      const imageRow = await screen.findByRole('button', { name: /open media hero\.png/i })
      fireEvent.contextMenu(imageRow, { clientX: 120, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: /use in selected image/i }))

      expect(useEditorStore.getState().site?.pages[0]?.nodes['image-node']?.props.src).toBe('/uploads/hero.png')

      act(() => {
        useEditorStore.setState({ selectedNodeId: 'video-node' } as Parameters<typeof useEditorStore.setState>[0])
      })
      const videoRow = await screen.findByRole('button', { name: /open media intro\.mp4/i })
      fireEvent.contextMenu(videoRow, { clientX: 120, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: /use in selected video/i }))

      const videoProps = useEditorStore.getState().site?.pages[0]?.nodes['video-node']?.props
      expect(videoProps?.source).toBe('media')
      expect(videoProps?.videoUrl).toBe('/uploads/intro.mp4')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('opens CMS media assets in the editor preview instead of navigating away', async () => {
    loadSite()
    useEditorStore.setState({
      siteExplorerPanelOpen: false,
      mediaExplorerPanelOpen: true,
    } as Parameters<typeof useEditorStore.setState>[0])
    const originalFetch = globalThis.fetch
    const originalOpen = window.open
    const openCalls: unknown[] = []
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        assets: [{
          id: 'media-1',
          filename: 'hero.png',
          mimeType: 'image/png',
          sizeBytes: 12,
          publicPath: '/uploads/hero.png',
          createdAt: '2026-01-03T00:00:00.000Z',
        }],
      }), { status: 200 })) as typeof fetch
    window.open = ((...args: unknown[]) => {
      openCalls.push(args)
      return null
    }) as typeof window.open

    try {
      render(
        <>
          <MediaExplorerPanel variant="docked" />
          <CodeEditorPanel />
        </>,
      )

      const mediaRow = await screen.findByRole('button', { name: /open media hero\.png/i })
      fireEvent.click(mediaRow)

      await waitFor(() => {
        const state = useEditorStore.getState() as ReturnType<typeof useEditorStore.getState> & {
          activeMediaAssetPreview?: { publicPath: string } | null
        }
        expect(state.codeEditorPanelOpen).toBe(true)
        expect(state.activeEditorFileId).toBeNull()
        expect(state.activeMediaAssetPreview?.publicPath).toBe('/uploads/hero.png')
      })
      expect(openCalls).toHaveLength(0)
      expect(screen.getByLabelText('Image preview: hero.png')).toBeDefined()
    } finally {
      globalThis.fetch = originalFetch
      window.open = originalOpen
    }
  })

  it('mounts editor previews as viewport overlays above sidebars', () => {
    const editorLayoutSource = readFileSync(
      new URL('../../admin/AdminLayout.tsx', import.meta.url),
      'utf-8',
    )
    const codeEditorMountIndex = editorLayoutSource.indexOf('<CodeEditorPanel />')
    const rightSidebarMountIndex = editorLayoutSource.indexOf('<RightSidebar />')
    expect(codeEditorMountIndex).toBeGreaterThan(rightSidebarMountIndex)

    const editorPanelCss = readFileSync(
      new URL('../../editor/components/CodeEditor/CodeEditorPanel.module.css', import.meta.url),
      'utf-8',
    )
    const leftSidebarCss = readFileSync(
      new URL('../../editor/components/LeftSidebar/LeftSidebar.module.css', import.meta.url),
      'utf-8',
    )
    const rightSidebarCss = readFileSync(
      new URL('../../editor/components/RightSidebar/RightSidebar.module.css', import.meta.url),
      'utf-8',
    )

    const panelRule = editorPanelCss.match(/\.panel\s*\{[\s\S]*?\}/)?.[0] ?? ''
    const panelZIndex = Number(panelRule.match(/z-index:\s*(\d+)/)?.[1])
    const sidebarZIndexes = [leftSidebarCss, rightSidebarCss]
      .flatMap((css) => [...css.matchAll(/z-index:\s*(\d+)/g)].map((match) => Number(match[1])))

    expect(panelRule).toContain('position: fixed;')
    expect(panelZIndex).toBeGreaterThan(Math.max(...sidebarZIndexes))
  })

  it('opens pages and components on the canvas from concept rows', () => {
    loadSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.click(screen.getByRole('button', { name: /open page pricing/i }))
    expect(useEditorStore.getState().activePageId).toBe('page-pricing')
    expect(useEditorStore.getState().activeDocument).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /open component herocard/i }))
    expect(useEditorStore.getState().activeDocument).toEqual({
      kind: 'visualComponent',
      vcId: 'vc-HeroCard',
    })
  })

  it('opens page routes in a new browser tab from the page context menu', () => {
    loadSite()
    const originalOpen = window.open
    const openCalls: unknown[] = []
    window.open = ((...args: unknown[]) => {
      openCalls.push(args)
      return null
    }) as typeof window.open

    try {
      render(<SiteExplorerPanel variant="docked" />)

      fireEvent.contextMenu(screen.getByRole('button', { name: /open page pricing/i }), {
        clientX: 120,
        clientY: 140,
      })
      fireEvent.click(screen.getByRole('menuitem', { name: /open in new tab/i }))

      expect(openCalls).toEqual([['/pricing', '_blank', 'noopener,noreferrer']])
    } finally {
      window.open = originalOpen
    }
  })

  it('creates pages with an editable slug through the site dialog', () => {
    loadSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.click(screen.getByRole('button', { name: 'New page' }))

    const dialog = screen.getByRole('dialog', { name: 'New page' })
    expect(within(dialog).queryByText(/src\/pages/i)).toBeNull()
    expect(within(dialog).queryByText(/home\.tsx/i)).toBeNull()

    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'About Us' },
    })
    expect((within(dialog).getByLabelText('Slug') as HTMLInputElement).value).toBe('about-us')

    fireEvent.change(within(dialog).getByLabelText('Slug'), {
      target: { value: 'company' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    const state = useEditorStore.getState()
    const created = state.site?.pages.find((page) => page.title === 'About Us')
    expect(created?.slug).toBe('company')
    expect(state.activePageId).toBe(created?.id)
    expect(state.activeDocument).toBeNull()
    expect(screen.queryByRole('dialog', { name: 'New page' })).toBeNull()
  })

  it('creates components through the simple site dialog', () => {
    loadSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.click(screen.getByRole('button', { name: 'New component' }))

    const dialog = screen.getByRole('dialog', { name: 'New component' })
    expect(within(dialog).queryByText(/src\/components/i)).toBeNull()

    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'feature row' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    const state = useEditorStore.getState()
    // Component names are stored verbatim (free-form, no PascalCase coercion).
    const created = state.site?.visualComponents.find((component) => component.name === 'feature row')
    expect(created).toBeDefined()
    expect(state.activeDocument).toEqual({
      kind: 'visualComponent',
      vcId: created?.id,
    })
  })

  it('creates styles and scripts through the simple site dialog', () => {
    loadSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.click(screen.getByRole('button', { name: 'New stylesheet' }))
    let dialog = screen.getByRole('dialog', { name: 'New stylesheet' })
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'landing' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    let state = useEditorStore.getState()
    const styleFile = state.site?.files.find((file) => file.path === 'src/styles/landing.css')
    expect(styleFile?.type).toBe('style')
    expect(state.activeEditorFileId).toBe(styleFile?.id)

    fireEvent.click(screen.getByRole('button', { name: 'New script' }))
    dialog = screen.getByRole('dialog', { name: 'New script' })
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'tracking' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    state = useEditorStore.getState()
    const scriptFile = state.site?.files.find((file) => file.path === 'src/scripts/tracking.ts')
    expect(scriptFile?.type).toBe('script')
    expect(state.activeEditorFileId).toBe(scriptFile?.id)
  })

  it('renames and deletes pages from the site row context menu', () => {
    loadSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /open page pricing/i }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))

    const dialog = screen.getByRole('dialog', { name: 'Rename page' })
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Plans' },
    })
    fireEvent.change(within(dialog).getByLabelText('Slug'), {
      target: { value: 'plans' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    let renamed = useEditorStore.getState().site?.pages.find((page) => page.id === 'page-pricing')
    expect(renamed?.title).toBe('Plans')
    expect(renamed?.slug).toBe('plans')

    fireEvent.contextMenu(screen.getByRole('button', { name: /open page plans/i }), {
      clientX: 120,
      clientY: 140,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))

    renamed = useEditorStore.getState().site?.pages.find((page) => page.id === 'page-pricing')
    expect(renamed).toBeUndefined()
  })

  it('renames and deletes components from the site row context menu', () => {
    loadSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /open component herocard/i }), {
      clientX: 120,
      clientY: 180,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))

    const dialog = screen.getByRole('dialog', { name: 'Rename component' })
    fireEvent.change(within(dialog).getByLabelText('Name'), {
      target: { value: 'Promo card' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    let component = useEditorStore.getState().site?.visualComponents.find((item) => item.id === 'vc-HeroCard')
    // Component names are stored verbatim (free-form, no PascalCase coercion).
    expect(component?.name).toBe('Promo card')

    fireEvent.contextMenu(screen.getByRole('button', { name: /open component promo card/i }), {
      clientX: 120,
      clientY: 180,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))

    component = useEditorStore.getState().site?.visualComponents.find((item) => item.id === 'vc-HeroCard')
    expect(component).toBeUndefined()
  })

  it('renames and deletes code files from the site row context menu', () => {
    loadSite()
    render(<SiteExplorerPanel variant="docked" />)

    fireEvent.contextMenu(screen.getByRole('button', { name: /open theme\.css/i }), {
      clientX: 120,
      clientY: 220,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))

    const dialog = screen.getByRole('dialog', { name: 'Rename file' })
    fireEvent.change(within(dialog).getByLabelText('Path'), {
      target: { value: 'src/styles/site.css' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    const styleFile = useEditorStore.getState().site?.files.find((file) => file.id === 'style-1')
    expect(styleFile?.path).toBe('src/styles/site.css')

    fireEvent.contextMenu(screen.getByRole('button', { name: /open analytics\.ts/i }), {
      clientX: 120,
      clientY: 260,
    })
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))

    const scriptFile = useEditorStore.getState().site?.files.find((file) => file.id === 'script-1')
    expect(scriptFile).toBeUndefined()
  })

  it('renders a drag handle on each Component row', () => {
    loadSite()
    render(
      <DndContext>
        <SiteExplorerPanel variant="docked" />
      </DndContext>,
    )

    const panel = screen.getByTestId('site-explorer-panel')
    const handles = within(panel).getAllByTestId('site-explorer-component-drag-handle')
    // One component in the fixture (HeroCard)
    expect(handles).toHaveLength(1)
  })

  it('clicking a Component row still navigates to VC edit', () => {
    loadSite()
    render(
      <DndContext>
        <SiteExplorerPanel variant="docked" />
      </DndContext>,
    )

    fireEvent.click(screen.getByRole('button', { name: /open component herocard/i }))
    expect(useEditorStore.getState().activeDocument).toEqual({
      kind: 'visualComponent',
      vcId: 'vc-HeroCard',
    })
  })

  it('renames and deletes CMS media assets from the media row context menu', async () => {
    loadSite()
    useEditorStore.setState({
      siteExplorerPanelOpen: false,
      mediaExplorerPanelOpen: true,
    } as Parameters<typeof useEditorStore.setState>[0])
    const originalFetch = globalThis.fetch
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    globalThis.fetch = (async (input, init) => {
      calls.push({ input, init })
      if (init?.method === 'PATCH') {
        return new Response(JSON.stringify({
          asset: {
            id: 'media-1',
            filename: 'Hero renamed.png',
            mimeType: 'image/png',
            sizeBytes: 12,
            publicPath: '/uploads/hero.png',
            createdAt: '2026-01-03T00:00:00.000Z',
          },
        }), { status: 200 })
      }
      if (init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }
      return new Response(JSON.stringify({
        assets: [{
          id: 'media-1',
          filename: 'hero.png',
          mimeType: 'image/png',
          sizeBytes: 12,
          publicPath: '/uploads/hero.png',
          createdAt: '2026-01-03T00:00:00.000Z',
        }],
      }), { status: 200 })
    }) as typeof fetch

    try {
      render(<MediaExplorerPanel variant="docked" />)

      const mediaRow = await screen.findByRole('button', { name: /open media hero\.png/i })
      fireEvent.contextMenu(mediaRow, { clientX: 120, clientY: 140 })
      fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))

      const dialog = screen.getByRole('dialog', { name: 'Rename media' })
      fireEvent.change(within(dialog).getByLabelText('Name'), {
        target: { value: 'Hero renamed.png' },
      })
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

      expect(await screen.findByRole('button', { name: /open media hero renamed\.png/i })).toBeDefined()
      expect(calls.some((call) => call.input === '/api/cms/media/media-1' && call.init?.method === 'PATCH')).toBe(true)

      fireEvent.contextMenu(screen.getByRole('button', { name: /open media hero renamed\.png/i }), {
        clientX: 120,
        clientY: 140,
      })
      fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /open media hero renamed\.png/i })).toBeNull()
      })
      expect(calls.some((call) => call.input === '/api/cms/media/media-1' && call.init?.method === 'DELETE')).toBe(true)
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
