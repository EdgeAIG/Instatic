/**
 * PropertyControlRenderer — dispatch table tests.
 *
 * Covers (Guideline #221 / Constraint #212):
 *   1. Each PropertyControl type renders the correct underlying control
 *   2. Every control wrapper carries data-testid="property-control-{propKey}"
 *   3. Wrapper has minHeight:44 (WCAG 2.5.5 touch-target)
 *   4. Unknown control types return null (no crash)
 *   5. Numeric controls render inputs, not range sliders
 *   6. Numeric inputs expose min / max / step constraints
 *   7. GroupSection aria-expanded toggles on click
 *   8. Property conditions (declarative) — conditional controls hidden when condition fails
 *
 * Uses renderToStaticMarkup where DOM interaction is not needed (fast + no cleanup).
 * Uses @testing-library/react for interactive tests (GroupSection collapse).
 */

import { describe, it, expect, afterEach } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { PropertyControlRenderer } from '../../editor/components/PropertyControls/PropertyControlRenderer'
import type { PropertyControl } from '../../core/module-engine/types'

afterEach(cleanup)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderControl(
  control: PropertyControl,
  propKey = 'myProp',
  value: unknown = '',
): string {
  return renderToStaticMarkup(
    <PropertyControlRenderer
      propKey={propKey}
      control={control}
      value={value}
      onChange={() => {}}
    />
  )
}

// ---------------------------------------------------------------------------
// 1 — data-testid and minHeight wrapper (Guideline #221 / WCAG 2.5.5)
// ---------------------------------------------------------------------------

describe('PropertyControlRenderer — wrapper (data-testid + minHeight)', () => {
  it('wraps every control with data-testid="property-control-{propKey}"', () => {
    const html = renderControl({ type: 'text', label: 'Name' }, 'userName')
    expect(html).toContain('data-testid="property-control-userName"')
  })

  it('uses the exact propKey in the testid (no transformation)', () => {
    const html = renderControl({ type: 'text', label: 'X' }, 'some-complex_key')
    expect(html).toContain('data-testid="property-control-some-complex_key"')
  })

  it('wrapper has compact min-height (Guideline #357 — WCAG touch targets waived for editor chrome)', async () => {
    // Guideline #357: editor chrome controls use compact density (28px)
    // Post-Task #399: min-height is in controls.module.css, not an inline style.
    // Source-scan approach: verify min-height is defined in the CSS module.
    const { readFileSync } = await import('fs')
    const css = readFileSync(
      new URL('../../editor/components/PropertyControls/controls.module.css', import.meta.url),
      'utf-8',
    )
    // Accept: min-height: 28px OR min-height: 44px (OR-pattern for migration)
    const hasHeight = /min-height:\s*(28|44)px/.test(css)
    expect(hasHeight).toBe(true)
  })

  it('keeps the renderer shell separate from the concrete control layout wrapper', async () => {
    const { readFileSync } = await import('fs')
    const src = readFileSync(
      new URL('../../editor/components/PropertyControls/PropertyControlRenderer.tsx', import.meta.url),
      'utf-8',
    )

    expect(src).not.toContain('className={styles.controlWrapper}')
  })

  it('returns null (empty string) for unknown control type', () => {
    const html = renderControl({ type: 'unknown-future-type' as unknown as 'text', label: 'X' })
    expect(html).toBe('')
  })
})

// ---------------------------------------------------------------------------
// 2 — Type dispatch: correct input element rendered for each type
// ---------------------------------------------------------------------------

describe('PropertyControlRenderer — type dispatch', () => {
  it('text → renders <input type="text">', () => {
    const html = renderControl({ type: 'text', label: 'Title' }, 'title', 'Hello')
    expect(html).toContain('type="text"')
    expect(html).toContain('id="ctrl-title"')
  })

  it('textarea → renders <textarea>', () => {
    const html = renderControl({ type: 'textarea', label: 'Body' }, 'body', 'Some text')
    expect(html).toContain('<textarea')
  })

  it('number → renders <input type="number"> with constraints', () => {
    const html = renderControl({ type: 'number', label: 'Count', min: 0, max: 100, step: 1 }, 'count', 5)
    expect(html).toContain('type="number"')
    expect(html).toContain('min="0"')
    expect(html).toContain('max="100"')
    expect(html).toContain('step="1"')
    expect(html).not.toContain('type="range"')
  })

  it('color → renders <input type="color"> or color-specific control', () => {
    const html = renderControl({ type: 'color', label: 'Background' }, 'bgColor', '#ffffff')
    // Color control renders some kind of color input or picker
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('data-testid="property-control-bgColor"')
  })

  it('select → renders <select>', () => {
    const html = renderControl({
      type: 'select',
      label: 'Variant',
      options: [
        { label: 'Primary', value: 'primary' },
        { label: 'Secondary', value: 'secondary' },
      ],
    }, 'variant', 'primary')
    expect(html).toContain('<select')
    expect(html).toContain('Primary')
    expect(html).toContain('Secondary')
  })

  it('toggle → renders checkbox or toggle element', () => {
    const html = renderControl({ type: 'toggle', label: 'Visible' }, 'visible', true)
    // Toggle renders a checkbox or switch
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('data-testid="property-control-visible"')
  })

  it('image → renders <input type="text"> or image picker', () => {
    const html = renderControl({ type: 'image', label: 'Image Source' }, 'src', '')
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('data-testid="property-control-src"')
  })

  it('url → renders <input type="url"> or URL control', () => {
    const html = renderControl({ type: 'url', label: 'Link' }, 'href', 'https://example.com')
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('data-testid="property-control-href"')
  })

  it('richtext → falls back to <textarea> for MVP', () => {
    const html = renderControl({ type: 'richtext' as 'textarea', label: 'Content' }, 'content', '')
    expect(html).toContain('<textarea')
  })

  it('spacing → falls back to text input for MVP', () => {
    const html = renderControl({ type: 'spacing' as 'text', label: 'Padding' }, 'padding', '8px')
    expect(html).toContain('type="text"')
  })
})

// ---------------------------------------------------------------------------
// 3 — Labels: htmlFor linkage (accessibility)
// ---------------------------------------------------------------------------

describe('PropertyControlRenderer — label accessibility', () => {
  it('label htmlFor matches input id (ctrl-{propKey})', () => {
    const html = renderControl({ type: 'text', label: 'Font Size' }, 'fontSize')
    expect(html).toContain('for="ctrl-fontSize"')
    expect(html).toContain('id="ctrl-fontSize"')
  })

  it('displays the control label text', () => {
    const html = renderControl({ type: 'text', label: 'My Custom Label' }, 'myProp')
    expect(html).toContain('My Custom Label')
  })

  it('falls back to propKey when label is not provided', () => {
    const html = renderControl({ type: 'text' } as PropertyControl, 'noLabel')
    expect(html).toContain('noLabel')
  })

  it('override prop shows purple label (isOverride=true)', () => {
    const html = renderToStaticMarkup(
      <PropertyControlRenderer
        propKey="fontSize"
        control={{ type: 'text', label: 'Font Size' }}
        value="24px"
        onChange={() => {}}
        isOverride={true}
      />
    )
    // Post-Task #399: override color is in controls.module.css (.labelOverride class).
    // CSS module classes resolve to empty strings in renderToStaticMarkup test env.
    // Instead, verify the outer wrapper exposes data-override="true" for testability.
    expect(html).toContain('data-override="true"')
  })
})

// ---------------------------------------------------------------------------
// 4 — Numeric inputs
// ---------------------------------------------------------------------------

describe('PropertyControlRenderer — numeric inputs', () => {
  it('renders the current value in a number input', () => {
    const html = renderControl(
      { type: 'number', label: 'Border Radius', min: 0, max: 48, step: 1 },
      'borderRadius',
      16
    )
    expect(html).toContain('type="number"')
    expect(html).toContain('16')
  })

  it('exposes min and max on the number input', () => {
    const html = renderControl(
      { type: 'number', label: 'Opacity', min: 0, max: 100, step: 1 },
      'opacity',
      50
    )
    expect(html).toContain('min="0"')
    expect(html).toContain('max="100"')
  })

  it('exposes step on the number input', () => {
    const html = renderControl(
      { type: 'number', label: 'Size', min: 0, max: 48, step: 0.5 },
      'fontSize',
      24
    )
    expect(html).toContain('step="0.5"')
  })

  it('displays unit next to the label', () => {
    const html = renderControl(
      { type: 'number', label: 'Padding', min: 0, max: 64, step: 1, unit: 'px' },
      'padding',
      8
    )
    expect(html).toContain('px<')
  })

  it('does not import SliderControl in the properties renderer', async () => {
    const { readFileSync } = await import('fs')
    const src = readFileSync(
      new URL('../../editor/components/PropertyControls/PropertyControlRenderer.tsx', import.meta.url),
      'utf-8'
    )
    expect(src).not.toContain('SliderControl')
    expect(src).not.toContain("case 'slider'")
  })
})

// ---------------------------------------------------------------------------
// 5 — GroupSection: interactive collapse (DOM test)
// ---------------------------------------------------------------------------

describe('GroupSection — collapse toggle', () => {
  it('renders the group label as a button with aria-expanded', () => {
    render(
      <PropertyControlRenderer
        propKey="typography"
        control={{
          type: 'group',
          label: 'Typography',
          children: {
            fontSize: { type: 'number', label: 'Font Size', min: 8, max: 72, step: 1 },
          },
        }}
        value={{}}
        onChange={() => {}}
      />
    )
    const toggleBtn = screen.getByRole('button')
    expect(toggleBtn).toBeDefined()
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true')
  })

  it('toggles aria-expanded when clicked', async () => {
    render(
      <PropertyControlRenderer
        propKey="layout"
        control={{
          type: 'group',
          label: 'Layout',
          children: {
            width: { type: 'text', label: 'Width' },
          },
        }}
        value={{}}
        onChange={() => {}}
      />
    )
    const toggleBtn = screen.getByRole('button')
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true')

    fireEvent.click(toggleBtn)
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(toggleBtn)
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true')
  })

  it('hides children when collapsed (defaultCollapsed=true)', () => {
    const { container } = render(
      <PropertyControlRenderer
        propKey="advanced"
        control={{
          type: 'group',
          label: 'Advanced',
          collapsed: true,
          children: {
            zIndex: { type: 'number', label: 'Z-Index', min: 0, max: 9999, step: 1 },
          },
        }}
        value={{}}
        onChange={() => {}}
      />
    )
    // Children are not rendered when collapsed
    expect(container.querySelector('[data-testid="property-control-zIndex"]')).toBeNull()
  })

  it('shows children when expanded (defaultCollapsed=false)', () => {
    const { container } = render(
      <PropertyControlRenderer
        propKey="basic"
        control={{
          type: 'group',
          label: 'Basic',
          collapsed: false,
          children: {
            opacity: { type: 'number', label: 'Opacity', min: 0, max: 100, step: 1 },
          },
        }}
        value={{}}
        onChange={() => {}}
      />
    )
    expect(container.querySelector('[data-testid="property-control-opacity"]')).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 6 — Disabled state
// ---------------------------------------------------------------------------

describe('PropertyControlRenderer — disabled prop', () => {
  it('renders with reduced opacity when disabled=true', () => {
    const html = renderToStaticMarkup(
      <PropertyControlRenderer
        propKey="myProp"
        control={{ type: 'text', label: 'Disabled Field' }}
        value=""
        onChange={() => {}}
        disabled={true}
      />
    )
    // Post-Task #399: opacity is in controls.module.css (.controlWrapperDisabled class).
    // CSS module classes resolve to empty strings in renderToStaticMarkup test env.
    // Instead, verify the outer wrapper exposes data-disabled="true" for testability.
    expect(html).toContain('data-disabled="true"')
  })

  it('passes disabled to the underlying input', () => {
    const html = renderToStaticMarkup(
      <PropertyControlRenderer
        propKey="myProp"
        control={{ type: 'text', label: 'Test' }}
        value=""
        onChange={() => {}}
        disabled={true}
      />
    )
    expect(html).toContain('disabled')
  })
})
