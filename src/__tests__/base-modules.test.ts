/**
 * Base Module Conformance Tests
 *
 * Runs the Module Conformance Suite against every base module.
 * If any base module fails the conformance suite, it cannot be merged (Guidelines #172).
 *
 * How to add a new base module to this suite:
 *   1. Import the module definition
 *   2. Call: runModuleConformanceSuite(MyModule)
 *
 * Additional module-specific tests (unique behaviour, edge cases) go below
 * the conformance suite calls in dedicated describe blocks.
 */

import { describe, it, expect } from 'bun:test'
import { existsSync } from 'fs'
import React from 'react'
import { render as renderReact } from '@testing-library/react'
import './matchers'  // Register toBeCleanHTML

import { runModuleConformanceSuite, renderModule, withBannedGlobals } from './helpers'
import { escapeProps } from '../core/publisher/render'

// ---------------------------------------------------------------------------
// Import base modules (self-register into global registry on import)
// ---------------------------------------------------------------------------

// Note: text, button, image use JSX — their index files must be .tsx (fixed)
import { TextModule } from '../modules/base/text/index.tsx'
import { ButtonModule } from '../modules/base/button/index.tsx'
import { ContainerModule } from '../modules/base/container/index'
import { ImageModule } from '../modules/base/image/index.tsx'
import { VideoModule } from '../modules/base/video/index.tsx'
import { ColumnsModule } from '../modules/base/columns/index.tsx'
import { ListModule } from '../modules/base/list/index.tsx'
import { DividerModule } from '../modules/base/divider/index.tsx'
import { SpacerModule } from '../modules/base/spacer/index.tsx'

// ---------------------------------------------------------------------------
// Run the full conformance suite for every canonical base module (9 total)
// Context #338 — Canonical Base Module List
// ---------------------------------------------------------------------------

runModuleConformanceSuite(TextModule)
runModuleConformanceSuite(ButtonModule)
runModuleConformanceSuite(ContainerModule)
runModuleConformanceSuite(ImageModule)
runModuleConformanceSuite(VideoModule)
runModuleConformanceSuite(ColumnsModule)
runModuleConformanceSuite(ListModule)
runModuleConformanceSuite(DividerModule)
runModuleConformanceSuite(SpacerModule)

describe('base module registration', () => {
  it('only imports available production base modules', async () => {
    const baseIndex = await Bun.file('src/modules/base/index.ts').text()

    expect(baseIndex).not.toContain("import './visualComponentRef'")
    expect(baseIndex).not.toContain("import './demoCard'")
    expect(baseIndex).not.toContain("import './demoScene'")
    expect(baseIndex).not.toContain("import './heading'")
    expect(baseIndex).not.toContain("import './paragraph'")
  })

  it('does not keep retired module directories around', () => {
    for (const retiredPath of [
      'src/modules/base/visualComponentRef',
      'src/modules/base/demoCard',
      'src/modules/base/demoScene',
      'src/modules/base/heading',
      'src/modules/base/paragraph',
    ]) {
      expect(existsSync(retiredPath)).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// base.text — unified text module replacement
// ---------------------------------------------------------------------------

describe('base.text — unified text module', () => {
  it('is the only registered base typography module', async () => {
    const baseIndex = await Bun.file('src/modules/base/index.ts').text()

    expect(baseIndex).toContain("import './text'")
    expect(baseIndex).not.toContain("import './heading'")
    expect(baseIndex).not.toContain("import './paragraph'")
  })

  it('has only content and tag module settings', async () => {
    expect(TextModule.id).toBe('base.text')
    expect(Object.keys(TextModule.schema).sort()).toEqual(['tag', 'text'])
    expect(TextModule.classStyleBindings ?? {}).toEqual({})
  })

  it('renders the selected semantic tag', async () => {
    for (const tag of ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
      const { html } = renderModule(TextModule, { tag, text: 'Test' })
      expect(html).toContain(`<${tag}`)
      expect(html).toContain(`</${tag}>`)
    }
  })

  it('escapes text content through the publisher pipeline', async () => {
    const safeProps = escapeProps({ ...TextModule.defaults, text: '<script>xss()</script>' })
    const { html } = TextModule.render(safeProps, [])

    expect(html).toBeCleanHTML()
    expect(html).toContain('&lt;script&gt;')
  })
})

// ---------------------------------------------------------------------------
// base.button — module-specific tests
// ---------------------------------------------------------------------------

describe('base.button — render() specifics', () => {
  it('renders an <a> element when href is set', () => {
    const { html } = renderModule(ButtonModule, { href: 'https://example.com' })
    expect(html).toMatch(/<a[\s>]/)
    expect(html).toContain('href="https://example.com"')
  })

  it('renders a <button> element when href is empty', () => {
    const { html } = renderModule(ButtonModule, { href: '' })
    expect(html).toMatch(/<button[\s>]/)
  })

  it('XSS: strips javascript: href', () => {
    const { html } = renderModule(ButtonModule, { href: 'javascript:alert(1)' })
    expect(html).toBeCleanHTML()
    expect(html).not.toContain('javascript:')
  })

  it('XSS: escapes label text', () => {
    // Simulate the publisher pipeline (Constraint #211)
    const safeProps = escapeProps({ ...ButtonModule.defaults, label: '<script>alert(1)</script>', href: '' })
    const { html } = ButtonModule.render(safeProps, [])
    expect(html).toBeCleanHTML()
    expect(html).toContain('&lt;script&gt;')
  })

  it('adds rel="noopener noreferrer" for target="_blank" links', () => {
    const { html } = renderModule(ButtonModule, {
      href: 'https://example.com',
      target: '_blank',
    })
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('does not access DOM globals', () => {
    expect(() =>
      withBannedGlobals(() => ButtonModule.render(ButtonModule.defaults, []))
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// base.container — module-specific tests
// ---------------------------------------------------------------------------

describe('base.container — render() specifics', () => {
  it('is a container module (canHaveChildren: true)', () => {
    expect(ContainerModule.canHaveChildren).toBe(true)
  })

  it('has only the HTML tag module setting', () => {
    expect(Object.keys(ContainerModule.schema)).toEqual(['tag'])
    expect(ContainerModule.classStyleBindings ?? {}).toEqual({})
  })

  it('renders children HTML inside the container', () => {
    const child1 = '<h1>Title</h1>'
    const child2 = '<p>Body</p>'
    const { html } = renderModule(ContainerModule, {}, [child1, child2])
    expect(html).toContain(child1)
    expect(html).toContain(child2)
  })

  it('renders an empty container when no children are provided', () => {
    const { html } = renderModule(ContainerModule, {}, [])
    expect(typeof html).toBe('string')
    expect(html.trim().length).toBeGreaterThan(0)
  })

  it('renders safely when persisted props are missing tag', () => {
    const Component = ContainerModule.component

    expect(() => {
      renderReact(React.createElement(Component, {
        props: {},
        nodeId: 'container-with-missing-tag',
        isSelected: false,
      }))
    }).not.toThrow()
  })

  it('falls back to div for invalid published tag values', () => {
    const { html } = ContainerModule.render({ tag: undefined }, ['<p>child</p>'])

    expect(html).toContain('<div class="pb-container">')
    expect(html).toContain('</div>')
    expect(html).not.toContain('<undefined')
  })

  it('does not access DOM globals', () => {
    expect(() =>
      withBannedGlobals(() =>
        ContainerModule.render(ContainerModule.defaults, ['<p>child</p>'])
      )
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// base.image — module-specific tests
// ---------------------------------------------------------------------------

describe('base.image — render() specifics', () => {
  // Image module returns empty HTML when src is absent (Guideline #226 —
  // no editor-only chrome in published output). Tests needing <img> must supply src.

  it('exposes class-backed media sizing styles', () => {
    expect(Object.keys(ImageModule.classStyleBindings ?? {})).toEqual(
      expect.arrayContaining(['width', 'height', 'objectFit', 'objectPosition', 'borderRadius']),
    )
  })

  it('returns empty html when src is empty (Guideline #226)', () => {
    const { html } = renderModule(ImageModule, { src: '' })
    expect(html).toBe('')
    expect(html).not.toMatch(/<div[\s>]/)
    expect(html).not.toMatch(/<img[\s>]/)
  })

  it('renders an <img> element when src is provided', () => {
    const { html } = renderModule(ImageModule, { src: '/images/hero.jpg' })
    expect(html).toMatch(/<img[\s>]/)
    expect(html).toContain('src="/images/hero.jpg"')
  })

  it('XSS: strips javascript: src — safeUrl() returns "#" → renders <img src="#">', () => {
    // javascript: src → safeUrl() returns '#' (truthy) → renders <img src="#">.
    // This is safe: no XSS payload reaches the output. The src="#" case is
    // semantically imperfect but the malicious scheme is fully neutralised.
    const { html } = renderModule(ImageModule, { src: 'javascript:alert(1)' })
    expect(html).toBeCleanHTML()
    expect(html).not.toContain('javascript:')
  })

  it('XSS: escapes alt text in <img>', () => {
    // Simulate the publisher pipeline (Constraint #211)
    const safeProps = escapeProps({ ...ImageModule.defaults, src: '/img.jpg', alt: '"><script>alert(1)</script>' })
    const { html } = ImageModule.render(safeProps, [])
    expect(html).toBeCleanHTML()
    expect(html).not.toContain('<script>')
  })

  it('includes alt attribute for accessibility when src is provided', () => {
    const { html } = renderModule(ImageModule, {
      src: '/img.jpg',
      alt: 'Profile photo',
    })
    expect(html).toContain('alt="Profile photo"')
  })

  it('includes loading="lazy" by default', () => {
    const { html } = renderModule(ImageModule, { src: '/img.jpg' })
    expect(html).toContain('loading="lazy"')
  })

  it('does not access DOM globals', () => {
    expect(() =>
      withBannedGlobals(() => ImageModule.render(ImageModule.defaults, []))
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// base.video — module-specific tests
// ---------------------------------------------------------------------------

describe('base.video — render() specifics', () => {
  it('is NOT a container (canHaveChildren: false)', () => {
    expect(VideoModule.canHaveChildren).toBe(false)
  })

  it('renders a YouTube iframe for source=youtube with a valid ID', () => {
    const { html } = renderModule(VideoModule, { source: 'youtube', youtubeId: 'dQw4w9WgXcQ' })
    expect(html).toContain('youtube.com/embed/dQw4w9WgXcQ')
    expect(html).toMatch(/<iframe/)
  })

  it('renders a <video> element for source=url', () => {
    const { html } = renderModule(VideoModule, { source: 'url', videoUrl: 'https://example.com/vid.mp4' })
    expect(html).toMatch(/<video/)
  })

  it('XSS: strips javascript: in videoUrl (url-validated by publisher)', () => {
    const { html } = renderModule(VideoModule, { source: 'url', videoUrl: 'javascript:alert(1)' })
    expect(html).toBeCleanHTML()
    expect(html).not.toContain('javascript:')
  })

  it('XSS: strips data: URL in videoUrl (data: schemes blocked by safeUrl)', () => {
    // data:text/html URLs open a new browsing context with arbitrary HTML/JS,
    // bypassing the published page's CSP (isSafeUrl blocks all data: schemes).
    const { html } = renderModule(VideoModule, {
      source: 'url',
      videoUrl: 'data:text/html,<script>alert(1)</script>',
    })
    expect(html).not.toContain('data:text/html')
    expect(html).not.toContain('javascript:')
  })

  it('XSS: strips vbscript: in videoUrl', () => {
    const { html } = renderModule(VideoModule, { source: 'url', videoUrl: 'vbscript:MsgBox(1)' })
    expect(html).not.toContain('vbscript:')
  })

  it('XSS: strips tab-normalised javascript: bypass in videoUrl', () => {
    // WHATWG URL parser strips \t before scheme detection — isSafeUrl mirrors this
    const { html } = renderModule(VideoModule, { source: 'url', videoUrl: 'java\tscript:alert(1)' })
    expect(html).not.toContain('alert(1)')
  })

  it('css field is props-independent — no prop interpolation (Constraint #310)', () => {
    const out1 = VideoModule.render(VideoModule.defaults, [])
    const out2 = VideoModule.render({ ...VideoModule.defaults, borderRadius: 99 }, [])
    // css field must be the same regardless of props
    expect(out1.css).toBe(out2.css)
  })

  it('does not access DOM globals', () => {
    expect(() =>
      withBannedGlobals(() => VideoModule.render(VideoModule.defaults, []))
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// base.columns — module-specific tests
// ---------------------------------------------------------------------------

describe('base.columns — render() specifics', () => {
  it('is a container module (canHaveChildren: true)', () => {
    expect(ColumnsModule.canHaveChildren).toBe(true)
  })

  it('renders children inside the grid', () => {
    const child1 = '<div>A</div>'
    const child2 = '<div>B</div>'
    const { html } = renderModule(ColumnsModule, { columns: 2 }, [child1, child2])
    expect(html).toContain(child1)
    expect(html).toContain(child2)
  })

  it('css field is props-independent — no prop interpolation (Constraint #310)', () => {
    const out1 = ColumnsModule.render(ColumnsModule.defaults, [])
    const out2 = ColumnsModule.render({ ...ColumnsModule.defaults, columns: 4, gap: 48 }, [])
    expect(out1.css).toBe(out2.css)
  })

  it('does not access DOM globals', () => {
    expect(() =>
      withBannedGlobals(() => ColumnsModule.render(ColumnsModule.defaults, []))
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// base.list — module-specific tests
// ---------------------------------------------------------------------------

describe('base.list — render() specifics', () => {
  it('renders <ul> element for listType="unordered"', () => {
    const { html } = renderModule(ListModule, { listType: 'unordered' })
    expect(html).toContain('<ul')
    expect(html).toContain('</ul>')
    expect(html).not.toContain('<ol')
  })

  it('renders <ol> element for listType="ordered"', () => {
    const { html } = renderModule(ListModule, { listType: 'ordered' })
    expect(html).toContain('<ol')
    expect(html).toContain('</ol>')
    expect(html).not.toContain('<ul')
  })

  it('renders each newline-separated item as a <li> element', () => {
    const { html } = renderModule(ListModule, { items: 'Alpha\nBeta\nGamma' })
    expect(html).toContain('<li')
    expect(html).toContain('Alpha')
    expect(html).toContain('Beta')
    expect(html).toContain('Gamma')
    const liCount = (html.match(/<li/g) ?? []).length
    expect(liCount).toBe(3)
  })

  it('skips blank lines — blank entries do not produce empty <li>', () => {
    const { html } = renderModule(ListModule, { items: 'Item A\n\n\nItem B' })
    const liCount = (html.match(/<li/g) ?? []).length
    expect(liCount).toBe(2)
  })

  it('renders empty output (no <li>) when items is empty string', () => {
    const { html } = renderModule(ListModule, { items: '' })
    expect(html).not.toContain('<li')
  })

  it('XSS: HTML-escapes items via publisher pipeline (Constraint #211)', () => {
    // Publisher's escapeProps() is the sole escaping layer (Option A fix).
    // Items are pre-escaped before render() is called.
    const safeProps = escapeProps({ ...ListModule.defaults, items: '<script>alert(1)</script>\nSafe item' })
    const { html } = ListModule.render(safeProps, [])
    expect(html).toBeCleanHTML()
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('XSS: escapes & in item text without double-escaping', () => {
    const safeProps = escapeProps({ ...ListModule.defaults, items: 'Cats & Dogs\nBread & Butter' })
    const { html } = ListModule.render(safeProps, [])
    expect(html).toContain('&amp;')
    expect(html).not.toContain('&amp;amp;')
  })

  it('defaults.items is empty string — shows placeholder on canvas (Guideline #226)', () => {
    // New list modules should start with the placeholder ("List item 1" in grey)
    // rather than pre-filled sample content. Empty string triggers the placeholder
    // branch in ListEditor. This matches the in-editor placeholder UX pattern.
    expect(ListModule.defaults.items).toBe('')
  })

  it('is NOT a container module (canHaveChildren: false)', () => {
    expect(ListModule.canHaveChildren).toBe(false)
  })

  it('does not access DOM globals', () => {
    expect(() =>
      withBannedGlobals(() => ListModule.render(ListModule.defaults, []))
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// base.divider — module-specific tests
// ---------------------------------------------------------------------------

describe('base.divider — render() specifics', () => {
  it('renders an <hr> element', () => {
    const { html } = renderModule(DividerModule)
    expect(html).toMatch(/<hr[\s>]/)
  })

  it('includes aria-hidden="true" — divider is decorative (Guideline #226)', () => {
    // An <hr> divider is a visual decoration; hiding it from screen readers
    // matches the same decorative treatment applied to base.spacer.
    const { html } = renderModule(DividerModule)
    expect(html).toContain('aria-hidden="true"')
  })

  it('is NOT a container module (canHaveChildren: false)', () => {
    expect(DividerModule.canHaveChildren).toBe(false)
  })

  it('does not access DOM globals', () => {
    expect(() =>
      withBannedGlobals(() => DividerModule.render(DividerModule.defaults, []))
    ).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// base.spacer — module-specific tests
// ---------------------------------------------------------------------------

describe('base.spacer — render() specifics', () => {
  it('renders a <div> element', () => {
    const { html } = renderModule(SpacerModule, { height: 64 })
    expect(html).toMatch(/<div[\s>]/)
  })

  it('includes aria-hidden="true" (spacer is decorative)', () => {
    const { html } = renderModule(SpacerModule)
    expect(html).toContain('aria-hidden="true"')
  })

  it('is NOT a container module (canHaveChildren: false)', () => {
    expect(SpacerModule.canHaveChildren).toBe(false)
  })

  it('does not access DOM globals', () => {
    expect(() =>
      withBannedGlobals(() => SpacerModule.render(SpacerModule.defaults, []))
    ).not.toThrow()
  })
})
