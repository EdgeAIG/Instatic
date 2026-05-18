import { describe, expect, it } from 'bun:test'
import type { SiteFile } from '@core/files/schemas'
import type { Page } from '@core/page-tree/schemas'
import {
  DEFAULT_SCRIPT_RUNTIME_CONFIG,
  collectRuntimeScripts,
  normalizeSiteRuntimeConfig,
  scriptAppliesToPage,
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

describe('site runtime script config', () => {
  it('normalizes a missing runtime config to an empty lock and script map', () => {
    expect(normalizeSiteRuntimeConfig(undefined)).toEqual({
      dependencyLock: {
        version: 1,
        packages: {},
        updatedAt: 0,
      },
      scripts: {},
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

  it('matches script scopes against pages and templates', () => {
    expect(scriptAppliesToPage(DEFAULT_SCRIPT_RUNTIME_CONFIG, page('home'))).toBe(true)
    expect(scriptAppliesToPage({
      ...DEFAULT_SCRIPT_RUNTIME_CONFIG,
      scope: { type: 'pages', pageIds: ['home'] },
    }, page('home'))).toBe(true)
    expect(scriptAppliesToPage({
      ...DEFAULT_SCRIPT_RUNTIME_CONFIG,
      scope: { type: 'pages', pageIds: ['home'] },
    }, page('about'))).toBe(false)
    expect(scriptAppliesToPage({
      ...DEFAULT_SCRIPT_RUNTIME_CONFIG,
      scope: { type: 'templates', templatePageIds: ['template-1'] },
    }, page('template-1', true))).toBe(true)
    expect(scriptAppliesToPage({
      ...DEFAULT_SCRIPT_RUNTIME_CONFIG,
      scope: { type: 'templates', templatePageIds: ['template-1'] },
    }, page('template-1'))).toBe(false)
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
})
