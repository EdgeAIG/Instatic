import { describe, expect, it } from 'bun:test'
import { generateCanvasClassCSS } from '../../editor/components/Canvas/canvasClassCss'
import type { CSSClass } from '../../core/page-tree/types'

function makeClass(
  id: string,
  styles: CSSClass['styles'],
  breakpointStyles: CSSClass['breakpointStyles'] = {},
): CSSClass {
  return {
    id,
    name: id,
    styles,
    breakpointStyles,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('generateCanvasClassCSS', () => {
  it('scopes breakpoint class styles to their canvas frame instead of viewport media queries', () => {
    const css = generateCanvasClassCSS(
      {
        title: makeClass('title', { fontSize: '64px' }, {
          mobile: { fontSize: '36px' },
        }),
      },
      [{ id: 'mobile', width: 375 }],
    )

    expect(css).toContain('.mc-title')
    expect(css).toContain('font-size: 64px')
    expect(css).toContain('[data-breakpoint-id="mobile"] .mc-title')
    expect(css).toContain('font-size: 36px')
    expect(css).not.toContain('@media')
  })
})
