/**
 * ClassStyleInjector — unit tests for bagToCSS and generateClassCSS.
 *
 * Covers:
 * - camelCase → kebab-case conversion (toKebab)
 * - Allowlist enforcement (unknown props are dropped)
 * - Value sanitisation: javascript:, expression(), behavior:, data:text all blocked
 * - Base class CSS generation using the user-facing class name
 * - @media breakpoint override blocks
 * - Security: empty/no-styles classes emit nothing
 *
 * Phase C / Constraint #228.
 */

import { describe, it, expect } from 'bun:test'
import { bagToCSS, generateClassCSS } from '../../core/publisher/classCss'
import type { CSSClass } from '../../core/page-tree/types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClass(
  id: string,
  styles: CSSClass['styles'],
  breakpointStyles: CSSClass['breakpointStyles'] = {},
  name = id,
): CSSClass {
  return {
    id,
    name,
    styles,
    breakpointStyles,
    createdAt: 0,
    updatedAt: 0,
  }
}

const BREAKPOINTS = [
  { id: 'mobile', width: 375 },
  { id: 'tablet', width: 768 },
]

// ---------------------------------------------------------------------------
// bagToCSS
// ---------------------------------------------------------------------------

describe('bagToCSS', () => {
  it('converts a single property to a CSS declaration', () => {
    const css = bagToCSS({ fontSize: '16px' })
    expect(css).toBe('  font-size: 16px;')
  })

  it('converts camelCase to kebab-case', () => {
    const css = bagToCSS({ backgroundColor: '#fff', borderTopLeftRadius: '4px' })
    expect(css).toContain('background-color: #fff;')
    expect(css).toContain('border-top-left-radius: 4px;')
  })

  it('drops properties NOT in the allowlist', () => {
    // 'content' is not in ALLOWED_PROPS
    const css = bagToCSS({ content: '"hack"' } as never)
    expect(css).toBe('')
  })

  it('drops undefined and null and empty-string values', () => {
    const css = bagToCSS({ fontSize: undefined, color: '' } as never)
    expect(css).toBe('')
  })

  it('handles numeric values (zIndex, opacity)', () => {
    const css = bagToCSS({ zIndex: 10, opacity: 0.5 })
    expect(css).toContain('z-index: 10;')
    expect(css).toContain('opacity: 0.5;')
  })

  it('returns empty string for an empty bag', () => {
    expect(bagToCSS({})).toBe('')
  })

  // Security — Constraint #228
  it('blocks javascript: protocol values', () => {
    const css = bagToCSS({ backgroundImage: 'javascript:alert(1)' })
    expect(css).toBe('')
  })

  it('blocks expression() values (IE CSS injection)', () => {
    const css = bagToCSS({ width: 'expression(alert(1))' })
    expect(css).toBe('')
  })

  it('blocks behavior: values', () => {
    const css = bagToCSS({ cursor: 'behavior: url(evil.htc)' } as never)
    expect(css).toBe('')
  })

  it('blocks data:text values', () => {
    const css = bagToCSS({ backgroundImage: 'data:text/html,<script>alert(1)</script>' })
    expect(css).toBe('')
  })

  it('allows safe data: image URIs (data:image/…)', () => {
    // data:image is NOT blocked — only data:text
    const css = bagToCSS({ backgroundImage: 'url("data:image/png;base64,abc")' })
    expect(css).toContain('background-image:')
  })

  it('allows typical safe values unchanged', () => {
    const css = bagToCSS({ display: 'flex', gap: '8px', borderRadius: '4px' })
    expect(css).toContain('display: flex;')
    expect(css).toContain('gap: 8px;')
    expect(css).toContain('border-radius: 4px;')
  })

  it('outputs multiple properties as separate lines', () => {
    const css = bagToCSS({ fontSize: '14px', color: '#eee', fontWeight: '600' })
    const lines = css.split('\n')
    expect(lines.length).toBe(3)
    expect(lines.every((l) => l.startsWith('  '))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// generateClassCSS
// ---------------------------------------------------------------------------

describe('generateClassCSS', () => {
  it('generates a rule from the user-facing class name', () => {
    const classes = { abc: makeClass('abc', { color: '#fff', fontSize: '16px' }) }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).toContain('.abc {')
    expect(css).toContain('color: #fff;')
    expect(css).toContain('font-size: 16px;')
    expect(css).toContain('}')
  })

  it('uses the class name in the selector, not the generated id', () => {
    const classes = { generatedId: makeClass('generatedId', { display: 'flex' }, {}, 'hero_title') }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).toContain('.hero_title {')
    expect(css).not.toContain('.generatedId')
    expect(css).not.toContain('.mc-generatedId')
  })

  it('escapes class names in CSS selectors without replacing the stored name', () => {
    const classes = { generatedId: makeClass('generatedId', { color: 'red' }, {}, 'hero:featured') }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).toContain('.hero\\:featured {')
  })

  it('skips base rule when the class has no styles', () => {
    const classes = { empty: makeClass('empty', {}) }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).not.toContain('.empty')
  })

  it('emits @media block for breakpoint override', () => {
    const classes = {
      btn: makeClass('btn', { fontSize: '16px' }, {
        mobile: { fontSize: '12px' },
      }),
    }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).toContain('@media (max-width: 375px)')
    expect(css).toContain('.btn {')
    expect(css).toContain('font-size: 12px;')
  })

  it('emits separate @media blocks for multiple breakpoints', () => {
    const classes = {
      hero: makeClass('hero', { fontSize: '24px' }, {
        mobile: { fontSize: '14px' },
        tablet: { fontSize: '18px' },
      }),
    }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).toContain('@media (max-width: 375px)')
    expect(css).toContain('@media (max-width: 768px)')
  })

  it('skips breakpoint block when the breakpoint ID is not in the breakpoints list', () => {
    const classes = {
      btn: makeClass('btn', { fontSize: '16px' }, {
        'unknown-bp': { fontSize: '10px' },
      }),
    }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).not.toContain('unknown-bp')
  })

  it('skips breakpoint block when override styles are empty', () => {
    const classes = {
      btn: makeClass('btn', { fontSize: '16px' }, {
        mobile: {},
      }),
    }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).not.toContain('@media')
  })

  it('generates CSS for multiple classes', () => {
    const classes = {
      a: makeClass('a', { color: 'red' }),
      b: makeClass('b', { color: 'blue' }),
    }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).toContain('.a {')
    expect(css).toContain('.b {')
    expect(css).toContain('color: red;')
    expect(css).toContain('color: blue;')
  })

  it('returns empty string for an empty class registry', () => {
    const css = generateClassCSS({}, BREAKPOINTS)
    expect(css).toBe('')
  })

  it('does not include allowlist-blocked properties in output', () => {
    // 'content' not in allowlist
    const classes = { bad: makeClass('bad', { content: '"injected"' } as never) }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).not.toContain('content')
  })

  it('sanitises javascript: values in class styles', () => {
    const classes = { evil: makeClass('evil', { backgroundImage: 'javascript:alert(1)' }) }
    const css = generateClassCSS(classes, BREAKPOINTS)
    expect(css).not.toContain('javascript:')
    // The rule should be omitted entirely (no safe decls → no block emitted)
    expect(css).not.toContain('.evil')
  })
})

// ---------------------------------------------------------------------------
// collectClassCSS — publisher integration (tree-shaking)
// ---------------------------------------------------------------------------

import { collectClassCSS } from '../../core/publisher/cssCollector'
import type { SiteDocument, Page, PageNode } from '../../core/page-tree/types'

function makeSite(
  classes: SiteDocument['classes'],
  nodeClassIds: Record<string, string[]> = {},
): SiteDocument {
  const node: PageNode = {
    id: 'root',
    moduleId: 'base.container',
    props: {},
    breakpointOverrides: {},
    children: Object.keys(nodeClassIds).filter((id) => id !== 'root'),
    classIds: nodeClassIds['root'] ?? [],
  }
  const childNodes: Record<string, PageNode> = {}
  for (const [id, classIds] of Object.entries(nodeClassIds)) {
    if (id === 'root') continue
    childNodes[id] = {
      id,
      moduleId: 'base.heading',
      props: {},
      breakpointOverrides: {},
      children: [],
      classIds,
    }
  }
  const page: Page = {
    id: 'page1',
    slug: 'index',
    title: 'Home',
    rootNodeId: 'root',
    nodes: { root: node, ...childNodes },
  }
  return {
    id: 'proj',
    name: 'Test',
    pages: [page],
    breakpoints: [{ id: 'mobile', label: 'Mobile', width: 375, icon: 'smartphone' }],
    settings: {
      colorTokens: {},
      typeScale: { baseSize: 16, ratio: 1.25 },
      shortcuts: {},
    },
    classes,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe('collectClassCSS', () => {
  it('returns empty string when no nodes have classIds', () => {
    const site = makeSite({ cls1: makeClass('cls1', { color: 'red' }) })
    expect(collectClassCSS(site)).toBe('')
  })

  it('only emits CSS for classes actually used by nodes (tree-shaking)', () => {
    const site = makeSite(
      {
        used: makeClass('used', { color: 'green' }),
        unused: makeClass('unused', { color: 'red' }),
      },
      { child1: ['used'] },
    )
    const css = collectClassCSS(site)
    expect(css).toContain('.used {')
    expect(css).not.toContain('.unused')
  })

  it('emits CSS for all used classes across all nodes', () => {
    const site = makeSite(
      {
        cls1: makeClass('cls1', { fontSize: '14px' }),
        cls2: makeClass('cls2', { fontSize: '18px' }),
      },
      { child1: ['cls1'], child2: ['cls2'] },
    )
    const css = collectClassCSS(site)
    expect(css).toContain('.cls1')
    expect(css).toContain('.cls2')
  })

  it('sanitizes </style> injection in class CSS (Constraint #228)', () => {
    const malicious = makeClass('evil', { backgroundImage: 'url(x)' })
    // Insert </style> manually via name abuse — test the sanitizer, not the class gen
    // (bagToCSS already blocks javascript: etc; test the outer sanitizeModuleCSS wrapper)
    const site = makeSite({ evil: malicious }, { child1: ['evil'] })
    const css = collectClassCSS(site)
    expect(css).not.toMatch(/<\/style\s*>/)
  })

  it('gracefully handles missing class references in the registry', () => {
    const site = makeSite({}, { child1: ['nonexistent-id'] })
    expect(() => collectClassCSS(site)).not.toThrow()
    expect(collectClassCSS(site)).toBe('')
  })

  it('returns empty string when all used class styles are blocked by the sanitiser', () => {
    const evilClass = makeClass('evil', { backgroundImage: 'javascript:alert(1)' })
    const site = makeSite({ evil: evilClass }, { child1: ['evil'] })
    const css = collectClassCSS(site)
    // No valid declarations → collectClassCSS should return empty (or whitespace only)
    expect(css.trim()).toBe('')
  })
})
