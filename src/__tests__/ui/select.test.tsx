import { describe, it, expect, afterEach } from 'bun:test'
import React, { useRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Select } from '@ui/components/Select'

afterEach(cleanup)

const OPTIONS = [
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
]

describe('Select', () => {
  it('opens the option list when the chevron icon area is clicked', () => {
    render(
      <Select
        id="status"
        aria-label="Status"
        value="draft"
        options={OPTIONS}
        onChange={() => {}}
      />,
    )

    const combobox = screen.getByRole('combobox', { name: /status/i })
    const chevron = combobox.nextElementSibling as HTMLElement

    fireEvent.click(chevron)

    expect(screen.getByRole('listbox', { name: /status/i })).toBeDefined()
    expect(combobox.getAttribute('aria-expanded')).toBe('true')
  })

  it('exposes listbox semantics and commits keyboard selection', () => {
    let selected = 'draft'
    render(
      <Select
        id="workflow-status"
        aria-label="Workflow status"
        value={selected}
        options={OPTIONS}
        onChange={(event) => {
          selected = event.target.value
        }}
      />,
    )

    const combobox = screen.getByRole('combobox', { name: /workflow status/i })
    combobox.focus()

    fireEvent.keyDown(combobox, { key: 'ArrowDown' })
    fireEvent.keyDown(combobox, { key: 'ArrowDown' })

    const listbox = screen.getByRole('listbox', { name: /workflow status/i })
    const publishedOption = screen.getByRole('option', { name: 'Published' })

    expect(listbox).toBeDefined()
    expect(combobox.getAttribute('aria-haspopup')).toBe('listbox')
    expect(combobox.getAttribute('aria-activedescendant')).toBe(publishedOption.id)

    fireEvent.keyDown(combobox, { key: 'Enter' })

    expect(selected).toBe('published')
    expect(screen.queryByRole('listbox', { name: /workflow status/i })).toBeNull()
    expect(combobox.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes when a mouse selection is confirmed', () => {
    let selected = 'draft'
    render(
      <Select
        id="mouse-status"
        aria-label="Mouse status"
        value={selected}
        options={OPTIONS}
        onChange={(event) => {
          selected = event.target.value
        }}
      />,
    )

    const combobox = screen.getByRole('combobox', { name: /mouse status/i })

    fireEvent.click(combobox.nextElementSibling as HTMLElement)
    fireEvent.click(screen.getByRole('option', { name: 'Published' }))

    expect(selected).toBe('published')
    expect(screen.queryByRole('listbox', { name: /mouse status/i })).toBeNull()
    expect(combobox.getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles closed when the trigger is clicked while the menu is open', () => {
    render(
      <Select
        id="toggle-status"
        aria-label="Toggle status"
        value="draft"
        options={OPTIONS}
        onChange={() => {}}
      />,
    )

    const combobox = screen.getByRole('combobox', { name: /toggle status/i })
    const chevron = combobox.nextElementSibling as HTMLElement

    // First click opens.
    fireEvent.click(chevron)
    expect(combobox.getAttribute('aria-expanded')).toBe('true')

    // Second click on the trigger should close (toggle), not leave the menu
    // hanging open. The mousedown listener inside the menu doesn't fire
    // dismiss because the trigger is the menu's anchor — the click handler
    // on the Select wrapper is what closes it.
    fireEvent.click(chevron)
    expect(combobox.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox', { name: /toggle status/i })).toBeNull()
  })

  it('closes the open dropdown and opens the new one when another Select is clicked', () => {
    // Two selects living inside the SAME wider parent (`menuAnchorRef` shared
    // across both). The dismiss anchor must be each Select's own wrapper,
    // not the shared parent — otherwise clicking the second trigger wouldn't
    // close the first menu, breaking the "switch dropdowns seamlessly" UX.
    function Pair() {
      const sharedAnchorRef = useRef<HTMLDivElement>(null)
      return (
        <div ref={sharedAnchorRef} data-testid="shared-anchor">
          <Select
            id="paired-first"
            aria-label="Paired first"
            value="draft"
            menuAnchorRef={sharedAnchorRef}
            options={OPTIONS}
            onChange={() => {}}
          />
          <Select
            id="paired-second"
            aria-label="Paired second"
            value="draft"
            menuAnchorRef={sharedAnchorRef}
            options={OPTIONS}
            onChange={() => {}}
          />
        </div>
      )
    }

    render(<Pair />)

    const first = screen.getByRole('combobox', { name: /paired first/i })
    const second = screen.getByRole('combobox', { name: /paired second/i })

    // Open the first dropdown.
    fireEvent.click(first.nextElementSibling as HTMLElement)
    expect(first.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('listbox', { name: /paired first/i })).not.toBeNull()

    // Mouse down on the second dropdown's trigger fires the document-level
    // dismiss listener inside the first menu (because `second` is outside
    // `first`'s selectRef anchor). Then the click event opens the second menu.
    fireEvent.mouseDown(second.nextElementSibling as HTMLElement)
    fireEvent.click(second.nextElementSibling as HTMLElement)

    expect(first.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox', { name: /paired first/i })).toBeNull()
    expect(second.getAttribute('aria-expanded')).toBe('true')
    expect(screen.queryByRole('listbox', { name: /paired second/i })).not.toBeNull()
  })

  it('closes when clicking elsewhere inside the wider menuAnchorRef parent', () => {
    // Reproduces the user-reported regression: when `menuAnchorRef` points
    // at a wider parent (for label-friendly dropdown width), clicking ANY
    // sibling inside that parent must still dismiss the menu — not just
    // clicks fully outside the parent.
    function WiderAnchor() {
      const sharedAnchorRef = useRef<HTMLDivElement>(null)
      return (
        <div ref={sharedAnchorRef} data-testid="shared-anchor">
          <Select
            id="wider-status"
            aria-label="Wider status"
            value="draft"
            menuAnchorRef={sharedAnchorRef}
            options={OPTIONS}
            onChange={() => {}}
          />
          <button type="button" data-testid="sibling">Sibling</button>
        </div>
      )
    }

    render(<WiderAnchor />)

    const combobox = screen.getByRole('combobox', { name: /wider status/i })
    fireEvent.click(combobox.nextElementSibling as HTMLElement)
    expect(combobox.getAttribute('aria-expanded')).toBe('true')

    // The sibling button lives inside the wider anchor — clicking it must
    // still dismiss the open menu.
    fireEvent.mouseDown(screen.getByTestId('sibling'))
    expect(combobox.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('listbox', { name: /wider status/i })).toBeNull()
  })

  it('closes when a click occurs outside the trigger and menu', () => {
    render(
      <Select
        id="outside-status"
        aria-label="Outside status"
        value="draft"
        options={OPTIONS}
        onChange={() => {}}
      />,
    )

    const combobox = screen.getByRole('combobox', { name: /outside status/i })

    fireEvent.click(combobox.nextElementSibling as HTMLElement)
    expect(screen.getByRole('listbox', { name: /outside status/i })).toBeDefined()

    // The menu is non-modal (anchored to the trigger via auto-flip
    // positioning) — dismissal goes through a document-level mousedown
    // listener that fires on any click outside the trigger and menu.
    fireEvent.mouseDown(document.body)

    expect(screen.queryByRole('listbox', { name: /outside status/i })).toBeNull()
    expect(combobox.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows placeholder text instead of a selected value for an empty value', () => {
    render(
      <Select
        id="placeholder-status"
        aria-label="Placeholder status"
        value=""
        placeholder="Browser default"
        options={[{ value: '', label: '—' }, ...OPTIONS]}
        onChange={() => {}}
      />,
    )

    const combobox = screen.getByRole('combobox', { name: /placeholder status/i }) as HTMLInputElement

    expect(combobox.value).toBe('')
    expect(combobox.placeholder).toBe('Browser default')
  })

  it('marks the empty placeholder option distinctly from real options', () => {
    render(
      <Select
        id="table-target"
        aria-label="Target table"
        value="contact-submissions"
        placeholder="Choose table"
        options={[
          { value: '', label: 'Choose table' },
          { value: 'contact-submissions', label: 'Contact submissions' },
        ]}
        onChange={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: /target table/i }))

    expect(screen.getByRole('option', { name: 'Choose table' }).dataset.placeholderOption)
      .toBe('true')
    expect(screen.getByRole('option', { name: 'Contact submissions' }).dataset.placeholderOption)
      .toBeUndefined()
  })

  it('can open a wider menu than the closed trigger', () => {
    render(
      <Select
        id="compact-status"
        aria-label="Compact status"
        value="draft"
        menuMinWidth={192}
        options={OPTIONS}
        onChange={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('combobox', { name: /compact status/i }))

    expect(screen.getByRole('listbox', { name: /compact status/i }).getAttribute('style'))
      .toContain('--context-menu-min-width: 192px')
  })

  it('anchors the menu width to a parent element when menuAnchorRef is provided', () => {
    // Trigger lives in a narrow grid cell; the parent grid (anchor) is wider
    // — the menu should stretch to the anchor's left edge + width while the
    // vertical position keeps tracking the trigger so the menu opens directly
    // below it.
    const TRIGGER_RECT = {
      x: 200,
      y: 50,
      left: 200,
      top: 50,
      right: 260,
      bottom: 80,
      width: 60,
      height: 30,
      toJSON: () => ({}),
    } as DOMRect
    const ANCHOR_RECT = {
      x: 100,
      y: 50,
      left: 100,
      top: 50,
      right: 320,
      bottom: 80,
      width: 220,
      height: 30,
      toJSON: () => ({}),
    } as DOMRect

    const originalRect = HTMLElement.prototype.getBoundingClientRect

    function AnchorScenario() {
      const anchorRef = useRef<HTMLDivElement>(null)
      return (
        <div ref={anchorRef} data-testid="anchor">
          <Select
            id="anchored-status"
            aria-label="Anchored status"
            value="draft"
            menuAnchorRef={anchorRef}
            options={OPTIONS}
            onChange={() => {}}
          />
        </div>
      )
    }

    HTMLElement.prototype.getBoundingClientRect = function getRect(this: HTMLElement) {
      if (this.dataset.testid === 'anchor') return ANCHOR_RECT
      return TRIGGER_RECT
    }

    try {
      render(<AnchorScenario />)
      fireEvent.click(screen.getByRole('combobox', { name: /anchored status/i }))

      const menuStyle = screen
        .getByRole('listbox', { name: /anchored status/i })
        .getAttribute('style')
      expect(menuStyle).toContain('--context-menu-x: 100px')
      expect(menuStyle).toContain('--context-menu-y: 86px')
      expect(menuStyle).toContain('--context-menu-width: 220px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })

  it('can place the menu to the left of the trigger', () => {
    const originalRect = HTMLElement.prototype.getBoundingClientRect
    HTMLElement.prototype.getBoundingClientRect = () => ({
      x: 260,
      y: 50,
      left: 260,
      top: 50,
      right: 290,
      bottom: 80,
      width: 30,
      height: 30,
      toJSON: () => ({}),
    } as DOMRect)

    try {
      render(
        <Select
          id="left-status"
          aria-label="Left status"
          value="draft"
          menuMinWidth={192}
          menuPlacement="left-start"
          options={OPTIONS}
          onChange={() => {}}
        />,
      )

      fireEvent.click(screen.getByRole('combobox', { name: /left status/i }))

      const menuStyle = screen.getByRole('listbox', { name: /left status/i }).getAttribute('style')
      expect(menuStyle).toContain('--context-menu-x: 62px')
      expect(menuStyle).toContain('--context-menu-y: 50px')
      expect(menuStyle).toContain('--context-menu-width: 192px')
    } finally {
      HTMLElement.prototype.getBoundingClientRect = originalRect
    }
  })
})
