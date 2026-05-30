import { describe, expect, it } from 'bun:test'
import { generateCanvasClassCSS } from '@site/canvas/canvasClassCss'
import { generateFrameworkColorUtilityClasses } from '@core/framework/colors'
import type { StyleRule } from '@core/page-tree'

function makeClass(
  id: string,
  styles: StyleRule['styles'],
  contextStyles: StyleRule['contextStyles'] = {},
): StyleRule {
  return {
    id,
    name: id,
    styles,
    contextStyles,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('generateCanvasClassCSS', () => {
  it('prepends the unscoped publisher reset so the iframe cascade matches the published page', () => {
    const css = generateCanvasClassCSS({}, [])

    // Each canvas breakpoint frame is its own iframe — the reset lives inside
    // the iframe document and never touches editor chrome. We emit the
    // SAME unscoped reset the publisher ships, so the cascade is identical
    // between canvas preview and live site.
    expect(css).toContain(':where(*, *::before, *::after) { box-sizing: border-box; }')
    expect(css).toContain(':where(*) { margin: 0; padding: 0; }')
    expect(css).toContain('font-family: system-ui')
    // No `[data-breakpoint-id]` prefix on the reset itself — it's unscoped.
    expect(css).not.toMatch(/\[data-breakpoint-id\][^{]*\{[^}]*box-sizing/)
  })

  it('uses :where()-style low-specificity body baseline so user CSS wins', () => {
    // The published `<body>` rule is `:where(body) { line-height; font-family }`
    // — specificity 0,0,0 so any user rule like `body { color: red }` wins.
    // The canvas now mirrors that exactly (was previously a concrete
    // `[data-breakpoint-id] { color: #000 }` rule which beat user CSS at
    // specificity 0,1,0; not needed anymore because the iframe has its own
    // body and the editor's globals.css can't cascade in).
    const css = generateCanvasClassCSS({}, [])
    expect(css).toContain(':where(body)')
    // Body color isn't pinned — UA default applies until user CSS overrides.
    expect(css).not.toMatch(/\[data-breakpoint-id\][^{]*\{[^}]*color:\s*#000/)
  })

  it('scopes breakpoint class styles to their canvas frame instead of viewport media queries', () => {
    const css = generateCanvasClassCSS(
      {
        title: makeClass('title', { fontSize: '64px' }, {
          mobile: { fontSize: '36px' },
        }),
      },
      [{ id: 'mobile', width: 375 }],
    )

    expect(css).toContain('.title')
    expect(css).toContain('font-size: 64px')
    expect(css).toContain('[data-breakpoint-id="mobile"] .title')
    expect(css).toContain('font-size: 36px')
    expect(css).not.toContain('@media')
  })

  it('includes framework color variables for editor preview', () => {
    const colors = {
      tokens: [
        {
          id: 'primary-token',
          category: '',
          slug: 'primary',
          lightValue: 'hsla(238, 100%, 62%, 1)',
          darkValue: 'hsla(238, 100%, 42%, 1)',
          darkModeEnabled: true,
          generateUtilities: {
            text: true,
            background: false,
            border: false,
            fill: false,
          },
          generateTransparent: false,
          generateShades: { enabled: false, count: 0 },
          generateTints: { enabled: false, count: 0 },
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }

    const css = generateCanvasClassCSS(
      generateFrameworkColorUtilityClasses(colors),
      [],
      [],
      colors,
    )

    expect(css).toContain(':root.theme-alt')
    expect(css).not.toContain('theme-dark')
    expect(css).toContain('--primary: hsla(238, 100%, 62%, 1);')
    expect(css).toContain('.text-primary')
    expect(css).toContain('color: var(--primary);')
  })
})
