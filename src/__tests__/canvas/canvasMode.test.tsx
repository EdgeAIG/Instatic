/**
 * Canvas mode (Design / Live) + Run-scripts tests.
 *
 * Covers:
 * - canvasView default + setCanvasView store action ('design' | 'live')
 * - runScripts default + setRunScripts store action
 * - CanvasModeToggle reflects + drives the store: Design/Live tabs, the
 *   Run-scripts toggle, and the inline breakpoint switcher (live only)
 * - useRuntimeScriptBuild signature contract: it builds only while enabled,
 *   does NOT rebuild on a node-tree edit (scripts don't depend on the tree),
 *   but DOES rebuild on a script-file edit, a packageJson change, or Refresh.
 *   That contract is what lets scripts run alongside live editing without
 *   re-executing on every keystroke.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CanvasModeToggle } from '@site/canvas/CanvasModeToggle'
import { useRuntimeScriptBuild } from '@site/canvas/useRuntimeScriptBuild'
import { useEditorStore } from '@site/store/store'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime'
import type { Page } from '@core/page-tree'
import { makeNode, makePage, makeSite } from '../fixtures'

afterEach(cleanup)

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})

beforeEach(() => {
  useEditorStore.setState({
    canvasView: 'design',
    runScripts: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

afterEach(() => {
  // Belt-and-suspenders: reset after each test so canvas state never leaks
  // into subsequent test files (the Zustand store is a global singleton).
  useEditorStore.setState({
    canvasView: 'design',
    runScripts: false,
  } as Parameters<typeof useEditorStore.setState>[0])
})

// ---------------------------------------------------------------------------
// canvasView / runScripts store state
// ---------------------------------------------------------------------------

describe('canvas view + run-scripts store state', () => {
  it('canvasView defaults to "design"', () => {
    expect(useEditorStore.getState().canvasView).toBe('design')
  })

  it('setCanvasView swaps between "design" and "live"', () => {
    act(() => useEditorStore.getState().setCanvasView('live'))
    expect(useEditorStore.getState().canvasView).toBe('live')

    act(() => useEditorStore.getState().setCanvasView('design'))
    expect(useEditorStore.getState().canvasView).toBe('design')
  })

  it('runScripts defaults to false and setRunScripts toggles it', () => {
    expect(useEditorStore.getState().runScripts).toBe(false)
    act(() => useEditorStore.getState().setRunScripts(true))
    expect(useEditorStore.getState().runScripts).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// CanvasModeToggle
// ---------------------------------------------------------------------------

const NOOP = () => {}

describe('CanvasModeToggle', () => {
  it('renders both view tabs with the design tab pre-selected', () => {
    render(<CanvasModeToggle scriptStatus="idle" onRefreshScripts={NOOP} />)
    const design = screen.getByTestId('canvas-mode-toggle-design')
    const live = screen.getByTestId('canvas-mode-toggle-live')
    expect(design.getAttribute('aria-selected')).toBe('true')
    expect(live.getAttribute('aria-selected')).toBe('false')
  })

  it('clicking Live switches the store to live mode', () => {
    render(<CanvasModeToggle scriptStatus="idle" onRefreshScripts={NOOP} />)
    fireEvent.click(screen.getByTestId('canvas-mode-toggle-live'))
    expect(useEditorStore.getState().canvasView).toBe('live')
  })

  it('clicking Design switches the store back to design mode', () => {
    act(() => useEditorStore.getState().setCanvasView('live'))
    render(<CanvasModeToggle scriptStatus="idle" onRefreshScripts={NOOP} />)
    fireEvent.click(screen.getByTestId('canvas-mode-toggle-design'))
    expect(useEditorStore.getState().canvasView).toBe('design')
  })

  it('the Run-scripts toggle reflects + drives store.runScripts', () => {
    render(<CanvasModeToggle scriptStatus="idle" onRefreshScripts={NOOP} />)
    const toggle = screen.getByTestId('canvas-run-scripts-toggle')
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(toggle)
    expect(useEditorStore.getState().runScripts).toBe(true)
  })

  it('shows the Refresh button only while scripts are running', () => {
    render(<CanvasModeToggle scriptStatus="idle" onRefreshScripts={NOOP} />)
    expect(screen.queryByTestId('canvas-run-scripts-refresh')).toBeNull()
    act(() => useEditorStore.getState().setRunScripts(true))
    expect(screen.getByTestId('canvas-run-scripts-refresh')).toBeDefined()
  })

  it('does not render inline breakpoint buttons in design mode', () => {
    withRuntimeSite()
    render(<CanvasModeToggle scriptStatus="idle" onRefreshScripts={NOOP} />)
    expect(screen.queryByTestId('canvas-live-breakpoints')).toBeNull()
  })

  it('renders an inline breakpoint button per site breakpoint when live is active', () => {
    const { breakpoints } = withRuntimeSite()
    act(() => useEditorStore.getState().setCanvasView('live'))
    render(<CanvasModeToggle scriptStatus="idle" onRefreshScripts={NOOP} />)

    expect(screen.getByTestId('canvas-live-breakpoints')).toBeDefined()
    for (const bp of breakpoints) {
      expect(screen.getByTestId(`canvas-live-breakpoint-${bp.id}`)).toBeDefined()
    }
  })

  it('clicking an inline breakpoint button drives setActiveBreakpoint', () => {
    const { breakpoints } = withRuntimeSite()
    act(() => useEditorStore.getState().setCanvasView('live'))
    render(<CanvasModeToggle scriptStatus="idle" onRefreshScripts={NOOP} />)

    const initial = useEditorStore.getState().activeBreakpointId
    const target = breakpoints.find((bp) => bp.id !== initial) ?? breakpoints[0]
    fireEvent.click(screen.getByTestId(`canvas-live-breakpoint-${target.id}`))
    expect(useEditorStore.getState().activeBreakpointId).toBe(target.id)
  })
})

// ---------------------------------------------------------------------------
// Test-site fixture
// ---------------------------------------------------------------------------

function withRuntimeSite() {
  const runtime = normalizeSiteRuntimeConfig({
    scripts: {
      entry: { enabled: true, runInCanvas: true, placement: 'body-end', timing: 'dom-ready', scope: { type: 'all-pages' }, priority: 100 },
    },
  })
  const page = makePage({
    id: 'page-1',
    nodes: { root: makeNode({ id: 'root', moduleId: 'base.body', children: [] }) },
  })
  const site = makeSite({
    pages: [page],
    files: [{
      id: 'entry',
      path: 'src/scripts/entry.ts',
      type: 'script',
      content: 'console.log("hi")',
      createdAt: 1,
      updatedAt: 1,
    }],
    packageJson: { dependencies: {}, devDependencies: {} },
    runtime,
  })

  useEditorStore.setState({
    site,
    packageJson: site.packageJson,
    siteRuntime: runtime,
    activePageId: 'page-1',
    activeBreakpointId: site.breakpoints[0]?.id ?? 'desktop',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
  } as Parameters<typeof useEditorStore.setState>[0])

  return { page, breakpoints: site.breakpoints, breakpoint: site.breakpoints[0] }
}

// ---------------------------------------------------------------------------
// useRuntimeScriptBuild — bundle signature contract
// ---------------------------------------------------------------------------

/**
 * Minimal host for the hook: renders the build status and a Refresh button so
 * tests can drive the public surface without a full canvas mount.
 */
function ScriptBuildHarness({ page, enabled }: { page: Page; enabled: boolean }) {
  const build = useRuntimeScriptBuild({ page, breakpointId: 'desktop', enabled })
  return (
    <button data-testid="script-status" data-status={build.status} onClick={build.refresh}>
      refresh
    </button>
  )
}

describe('useRuntimeScriptBuild', () => {
  let buildCalls = 0
  beforeEach(() => {
    buildCalls = 0
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString()
      if (url.includes('/admin/api/cms/runtime/preview')) {
        buildCalls += 1
        return new Response(JSON.stringify({
          html: '<!DOCTYPE html><html><body></body></html>',
          assets: [],
          runtimeAssets: { scripts: [] },
          diagnostics: [],
        }), { status: 200 })
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
  })

  async function flushDebounce(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400))
    })
  }

  it('does not build while disabled', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled={false} />)
    await flushDebounce()
    expect(buildCalls).toBe(0)
  })

  it('builds once when enabled', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushDebounce()
    expect(buildCalls).toBe(1)
  })

  it('does NOT rebuild on a node-tree edit (scripts are tree-independent)', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushDebounce()
    expect(buildCalls).toBe(1)

    act(() => {
      const current = useEditorStore.getState().site!
      const nextPages = current.pages.map((p) =>
        p.id !== 'page-1' ? p : {
          ...p,
          nodes: {
            ...p.nodes,
            root: { ...p.nodes.root, props: { ...p.nodes.root.props, padding: '16px' } },
          },
        },
      )
      useEditorStore.setState({
        site: { ...current, pages: nextPages, updatedAt: Date.now() },
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    await flushDebounce()

    expect(buildCalls).toBe(1)
  })

  it('rebuilds when a script file changes', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushDebounce()
    expect(buildCalls).toBe(1)

    act(() => {
      const current = useEditorStore.getState().site!
      const nextFiles = current.files.map((f) =>
        f.id !== 'entry' ? f : { ...f, content: 'console.log("changed")' },
      )
      useEditorStore.setState({
        site: { ...current, files: nextFiles, updatedAt: Date.now() },
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    await flushDebounce()

    expect(buildCalls).toBe(2)
  })

  it('rebuilds when packageJson changes', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushDebounce()
    expect(buildCalls).toBe(1)

    act(() => {
      const current = useEditorStore.getState().site!
      const nextPackageJson = {
        ...current.packageJson!,
        dependencies: { 'canvas-confetti': '*' },
      }
      useEditorStore.setState({
        site: { ...current, packageJson: nextPackageJson, updatedAt: Date.now() },
        packageJson: nextPackageJson,
      } as Parameters<typeof useEditorStore.setState>[0])
    })
    await flushDebounce()

    expect(buildCalls).toBe(2)
  })

  it('rebuilds on Refresh even when nothing else changed', async () => {
    const { page } = withRuntimeSite()
    render(<ScriptBuildHarness page={page} enabled />)
    await flushDebounce()
    expect(buildCalls).toBe(1)

    fireEvent.click(screen.getByTestId('script-status'))
    await flushDebounce()
    expect(buildCalls).toBe(2)
  })
})
