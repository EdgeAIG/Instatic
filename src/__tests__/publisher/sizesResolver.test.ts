/**
 * Publisher — `sizes='auto'` resolver tests.
 *
 * Covers the typical layouts the v1 resolver targets:
 *   - No constraint anywhere → returns `null` (caller falls back to 100vw).
 *   - Single max-width-constrained container wraps the image.
 *   - Constraint pinned directly on the image node itself.
 *   - Multiple ancestors with caps — innermost wins (outer can't loosen).
 *   - Per-breakpoint `contextStyles.maxWidth` shrinks `sizes` at narrower
 *     viewports.
 *   - Non-pixel units (%, vw, auto) ignored.
 *   - Multi-class on one node: latest declaration wins.
 */
import { describe, it, expect } from 'bun:test'
import { resolveAutoSizes } from '@core/publisher/sizesResolver'
import { makePage, makeSite } from './helpers'
import type { StyleRule } from '@core/page-tree'

function makeClass(id: string, partial: Partial<StyleRule> = {}): StyleRule {
  return {
    id,
    name: id,
    styles: {},
    contextStyles: {},
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('resolveAutoSizes — no constraint', () => {
  it('returns null when the image has no constraining ancestor', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite()
    expect(resolveAutoSizes('img', page, site)).toBeNull()
  })

  it('returns null when the only class declares non-pixel widths', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['wrap'] },
      wrap: { moduleId: 'base.container', classIds: ['fluid'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      styleRules: {
        fluid: makeClass('fluid', { styles: { width: '50%', maxWidth: 'auto' } }),
      },
    })
    expect(resolveAutoSizes('img', page, site)).toBeNull()
  })
})

describe('resolveAutoSizes — single max-width container', () => {
  it('emits `(min-width: cap+1) cap, 100vw` for desktop-only sites', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['wrap'] },
      wrap: { moduleId: 'base.container', classIds: ['narrow'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      styleRules: {
        narrow: makeClass('narrow', { styles: { maxWidth: '1200px' } }),
      },
    })
    // Above 1440 → 1200px, below 1440 → still 1200px (no narrower breakpoint
    // override means the cap holds), so the output collapses to a single
    // "1200px" catch-all. Above the widest breakpoint stays separately
    // emitted because the cascade DOESN'T include the desktop override
    // there.
    //
    // Expected sequence given breakpoints=[desktop(1440)]:
    //   tier 1 (viewport > 1440): base only → 1200px
    //   tier 2 (viewport ≤ 1440): base + desktop-override → 1200px (no
    //                              desktop override declared, so cap
    //                              unchanged) → tier collapses with prev.
    expect(resolveAutoSizes('img', page, site)).toBe('1200px')
  })

  it('keeps the cap when the image is the parent of multiple wrappers', () => {
    // root > container.maxWidth=800 > inner-div > img
    const page = makePage({
      root: { moduleId: 'base.body', children: ['outer'] },
      outer: { moduleId: 'base.container', classIds: ['narrow'], children: ['inner'] },
      inner: { moduleId: 'base.container', children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      styleRules: {
        narrow: makeClass('narrow', { styles: { maxWidth: '800px' } }),
      },
    })
    expect(resolveAutoSizes('img', page, site)).toBe('800px')
  })

  it('uses the image\'s OWN class when one is set directly on the <img>', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['img'] },
      img: { moduleId: 'base.image', classIds: ['pinned'] },
    })
    const site = makeSite({
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      styleRules: {
        pinned: makeClass('pinned', { styles: { maxWidth: '600px' } }),
      },
    })
    expect(resolveAutoSizes('img', page, site)).toBe('600px')
  })
})

describe('resolveAutoSizes — innermost wins', () => {
  it('uses the closest ancestor\'s cap, ignoring looser outer ones', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['outer'] },
      outer: { moduleId: 'base.container', classIds: ['wide'], children: ['inner'] },
      inner: { moduleId: 'base.container', classIds: ['narrow'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      styleRules: {
        wide: makeClass('wide', { styles: { maxWidth: '1600px' } }),
        narrow: makeClass('narrow', { styles: { maxWidth: '600px' } }),
      },
    })
    // Inner (narrow=600px) wins, outer wide is ignored.
    expect(resolveAutoSizes('img', page, site)).toBe('600px')
  })
})

describe('resolveAutoSizes — per-breakpoint overrides', () => {
  it('shrinks the cap at the narrower breakpoint', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['wrap'] },
      wrap: { moduleId: 'base.container', classIds: ['shrinks'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [
        { id: 'mobile', label: 'Mobile', width: 375, icon: 'smartphone' },
        { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
      ],
      styleRules: {
        shrinks: makeClass('shrinks', {
          styles: { maxWidth: '1200px' },
          contextStyles: { mobile: { maxWidth: '320px' } },
        }),
      },
    })
    // Expected tiers (widest → narrowest):
    //   viewport > 1440 → 1200px
    //   376 ≤ viewport ≤ 1440 → 1200px (no desktop override, cap unchanged)
    //   viewport ≤ 375 → 320px
    // Adjacent identical tiers collapse, so the output simplifies to:
    //   (min-width: 376px) 1200px, 320px
    expect(resolveAutoSizes('img', page, site)).toBe('(min-width: 376px) 1200px, 320px')
  })

  it('emits all three tiers when each breakpoint defines its own cap', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['wrap'] },
      wrap: { moduleId: 'base.container', classIds: ['tiered'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [
        { id: 'mobile', label: 'Mobile', width: 375, icon: 'smartphone' },
        { id: 'tablet', label: 'Tablet', width: 768, icon: 'tablet' },
        { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' },
      ],
      styleRules: {
        tiered: makeClass('tiered', {
          styles: { maxWidth: '1400px' },
          contextStyles: {
            desktop: { maxWidth: '1200px' },
            tablet: { maxWidth: '700px' },
            mobile: { maxWidth: '320px' },
          },
        }),
      },
    })
    expect(resolveAutoSizes('img', page, site)).toBe(
      '(min-width: 1441px) 1400px, (min-width: 769px) 1200px, (min-width: 376px) 700px, 320px',
    )
  })
})

describe('resolveAutoSizes — multi-class on one node', () => {
  it('later classId wins same-property declarations (CSS source-order)', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['wrap'] },
      wrap: { moduleId: 'base.container', classIds: ['outer', 'inner'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      styleRules: {
        outer: makeClass('outer', { styles: { maxWidth: '1600px' } }),
        inner: makeClass('inner', { styles: { maxWidth: '900px' } }),
      },
    })
    // `inner` is later in classIds → wins.
    expect(resolveAutoSizes('img', page, site)).toBe('900px')
  })
})

describe('resolveAutoSizes — pixel parsing', () => {
  it('accepts bare numbers as px', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['wrap'] },
      wrap: { moduleId: 'base.container', classIds: ['c'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      styleRules: {
        c: makeClass('c', { styles: { maxWidth: 720 } }),
      },
    })
    expect(resolveAutoSizes('img', page, site)).toBe('720px')
  })

  it('ignores %, vw, rem values', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['wrap'] },
      wrap: { moduleId: 'base.container', classIds: ['c'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      styleRules: {
        c: makeClass('c', { styles: { maxWidth: '50vw', width: '100%' } }),
      },
    })
    expect(resolveAutoSizes('img', page, site)).toBeNull()
  })

  it('prefers maxWidth over width when both are pixel values', () => {
    const page = makePage({
      root: { moduleId: 'base.body', children: ['wrap'] },
      wrap: { moduleId: 'base.container', classIds: ['c'], children: ['img'] },
      img: { moduleId: 'base.image' },
    })
    const site = makeSite({
      breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
      styleRules: {
        c: makeClass('c', { styles: { width: '900px', maxWidth: '800px' } }),
      },
    })
    expect(resolveAutoSizes('img', page, site)).toBe('800px')
  })
})
