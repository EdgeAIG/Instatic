import { describe, expect, it } from 'bun:test'
import type { SiteFile } from '@core/files/schemas'
import type { Page } from '@core/page-tree'
import {
  DEFAULT_SCRIPT_RUNTIME_CONFIG,
  DEFAULT_STYLE_RUNTIME_CONFIG,
  assetScopeAppliesToPage,
  collectAppliedStyles,
  collectRuntimeScripts,
  normalizeSiteRuntimeConfig,
  normalizeStyleRuntimeConfig,
} from '@core/site-runtime'

function scriptFile(id: string, path: string): SiteFile {
  return {
    id,
    path,
    type: 'script',
    content: 'console.log("ok")',
    createdAt: 1,
    updatedAt: 1,
  }
}

function styleFile(id: string, path: string): SiteFile {
  return {
    id,
    path,
    type: 'style',
    content: `.${id} { color: red }`,
    createdAt: 1,
    updatedAt: 1,
  }
}

function page(id: string, template = false): Page {
  return {
    id,
    title: id,
    slug: id,
    rootNodeId: 'root',
    nodes: {
      root: {
        id: 'root',
        moduleId: 'base.body',
        props: {},
        breakpointOverrides: {},
        children: [],
      },
    },
    ...(template ? { template: { enabled: true, context: 'entry', tableSlug: 'posts', priority: 0, conditions: [] } } : {}),
  }
}

describe('site runtime config', () => {
  it('normalizes a missing runtime config to empty lock, script and style maps', () => {
    expect(normalizeSiteRuntimeConfig(undefined)).toEqual({
      dependencyLock: {
        version: 1,
        packages: {},
        updatedAt: 0,
      },
      scripts: {},
      styles: {},
    })
  })

  it('normalizes partial script configs while preserving valid author choices', () => {
    const runtime = normalizeSiteRuntimeConfig({
      dependencyLock: {
        version: 1,
        packages: {
          'canvas-confetti': {
            name: 'canvas-confetti',
            requested: '^1.9.3',
            version: '1.9.3',
            integrity: 'sha512-example',
            resolvedAt: 123,
          },
        },
        updatedAt: 123,
      },
      scripts: {
        'file-1': {
          enabled: false,
          runInCanvas: false,
          placement: 'head',
          timing: 'idle',
          scope: { type: 'pages', pageIds: ['home'] },
          priority: 50,
        },
        'file-2': {
          placement: 'unknown',
          timing: 'later',
          scope: { type: 'pages', pageIds: [1, 'about'] },
          priority: Number.NaN,
        },
      },
    })

    expect(runtime.dependencyLock.packages['canvas-confetti']?.version).toBe('1.9.3')
    expect(runtime.scripts['file-1']).toEqual({
      enabled: false,
      runInCanvas: false,
      placement: 'head',
      timing: 'idle',
      scope: { type: 'pages', pageIds: ['home'] },
      priority: 50,
    })
    expect(runtime.scripts['file-2']).toEqual({
      ...DEFAULT_SCRIPT_RUNTIME_CONFIG,
      scope: { type: 'pages', pageIds: ['about'] },
    })
  })

  it('normalizes partial style configs while preserving valid author choices', () => {
    const runtime = normalizeSiteRuntimeConfig({
      styles: {
        'css-1': {
          enabled: false,
          scope: { type: 'templates', templatePageIds: ['tpl', 7] },
          priority: 20,
        },
        'css-2': {
          scope: 'bogus',
          priority: 'high',
        },
      },
    })

    expect(runtime.styles['css-1']).toEqual({
      enabled: false,
      scope: { type: 'templates', templatePageIds: ['tpl'] },
      priority: 20,
    })
    expect(runtime.styles['css-2']).toEqual({ ...DEFAULT_STYLE_RUNTIME_CONFIG })
  })

  it('defaults a missing style config', () => {
    expect(normalizeStyleRuntimeConfig(undefined)).toEqual(DEFAULT_STYLE_RUNTIME_CONFIG)
    expect(DEFAULT_STYLE_RUNTIME_CONFIG).toEqual({
      enabled: true,
      scope: { type: 'all-pages' },
      priority: 100,
    })
  })

  it('matches asset scopes against pages and templates', () => {
    expect(assetScopeAppliesToPage({ type: 'all-pages' }, page('home'))).toBe(true)
    expect(assetScopeAppliesToPage({ type: 'pages', pageIds: ['home'] }, page('home'))).toBe(true)
    expect(assetScopeAppliesToPage({ type: 'pages', pageIds: ['home'] }, page('about'))).toBe(false)
    expect(assetScopeAppliesToPage({ type: 'templates', templatePageIds: ['template-1'] }, page('template-1', true))).toBe(true)
    // A non-template page never matches a `templates` scope, even by id.
    expect(assetScopeAppliesToPage({ type: 'templates', templatePageIds: ['template-1'] }, page('template-1'))).toBe(false)
  })

  it('collects enabled script files for a target page in deterministic priority order', () => {
    const files = [
      scriptFile('later', 'src/scripts/later.ts'),
      { ...scriptFile('style', 'src/styles/site.css'), type: 'style' as const },
      scriptFile('defaulted', 'src/scripts/defaulted.ts'),
      scriptFile('disabled', 'src/scripts/disabled.ts'),
      scriptFile('first', 'src/scripts/first.ts'),
    ]
    const runtime = normalizeSiteRuntimeConfig({
      scripts: {
        later: { ...DEFAULT_SCRIPT_RUNTIME_CONFIG, priority: 200 },
        disabled: { ...DEFAULT_SCRIPT_RUNTIME_CONFIG, enabled: false },
        first: { ...DEFAULT_SCRIPT_RUNTIME_CONFIG, priority: 10 },
      },
    })

    expect(
      collectRuntimeScripts({
        files,
        runtime,
        page: page('home'),
        target: 'publish',
      }).map((entry) => entry.file.id),
    ).toEqual(['first', 'defaulted', 'later'])
  })

  it('excludes canvas-disabled scripts from canvas targets only', () => {
    const files = [scriptFile('tracking', 'src/scripts/tracking.ts')]
    const runtime = normalizeSiteRuntimeConfig({
      scripts: {
        tracking: { ...DEFAULT_SCRIPT_RUNTIME_CONFIG, runInCanvas: false },
      },
    })

    expect(collectRuntimeScripts({ files, runtime, page: page('home'), target: 'canvas' })).toEqual([])
    expect(collectRuntimeScripts({ files, runtime, page: page('home'), target: 'publish' })).toHaveLength(1)
  })

  it('collects enabled stylesheets for a page in priority then path order, honouring scope', () => {
    const files = [
      styleFile('late', 'src/styles/late.css'),
      styleFile('early', 'src/styles/early.css'),
      styleFile('disabled', 'src/styles/disabled.css'),
      styleFile('aboutOnly', 'src/styles/about-only.css'),
      { ...scriptFile('script', 'src/scripts/x.ts') },
    ]
    const runtime = normalizeSiteRuntimeConfig({
      styles: {
        late: { ...DEFAULT_STYLE_RUNTIME_CONFIG, priority: 200 },
        early: { ...DEFAULT_STYLE_RUNTIME_CONFIG, priority: 10 },
        disabled: { ...DEFAULT_STYLE_RUNTIME_CONFIG, enabled: false },
        aboutOnly: { ...DEFAULT_STYLE_RUNTIME_CONFIG, scope: { type: 'pages', pageIds: ['about'] } },
      },
    })

    expect(
      collectAppliedStyles({ files, runtime, page: page('home') }).map((entry) => entry.file.id),
    ).toEqual(['early', 'late'])

    expect(
      collectAppliedStyles({ files, runtime, page: page('about') }).map((entry) => entry.file.id),
    ).toEqual(['early', 'aboutOnly', 'late'])
  })
})
