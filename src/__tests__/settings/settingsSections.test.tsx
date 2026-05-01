/**
 * Settings Sections — Accessibility & Interaction Tests
 *
 * ─── Test groups ──────────────────────────────────────────────────────────────
 *  1.  PagesSection — aria-disabled on Delete button (Guideline #224 / Task #245)
 *  2.  PagesSection — inline confirm/cancel delete flow (Task #244)
 *  3.  BreakpointsSection — aria-disabled on Activate button (Guideline #224 / Task #245)
 *  4.  BreakpointsSection — inline confirm/cancel remove flow (Task #244)
 *  5.  Source-scan enforcement — aria-disabled pattern in source (regression guard)
 *  6.  Source-scan enforcement — no window.confirm() in Settings sections (Task #244)
 *
 * Guideline #224 (Toolbar UX Patterns / WCAG SC 4.1.2):
 * Action buttons that are conditionally unavailable must use aria-disabled="true"
 * (NOT the `disabled` attribute) so keyboard users can still tab to them and
 * access the tooltip explaining why the action is unavailable.
 *
 * Uses @testing-library/react + happy-dom (GlobalWindow preloaded via setup.ts).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'fs'
import { PagesSection } from '../../editor/components/Settings/sections/PagesSection'
import { BreakpointsSection } from '../../editor/components/Settings/sections/BreakpointsSection'
import { PreferencesSection } from '../../editor/components/Settings/sections/PreferencesSection'
import { useEditorStore } from '../../core/editor-store/store'
import { makeSite, makePage } from '../fixtures'

// ---------------------------------------------------------------------------
// Store reset helpers
// ---------------------------------------------------------------------------

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    selectedNodeId: null,
    hoveredNodeId: null,
    settingsModalOpen: false,
    settingsModalSection: 'pages',
    domTreePanel: { collapsed: false, x: 0, y: 0, width: 280 },
    propertiesPanel: { collapsed: false, x: 0, y: 0, width: 280 },
    focusedPanel: 'canvas',
    _historyPast: [],
    _historyFuture: [],
    canUndo: false,
    canRedo: false,
    hasUnsavedChanges: false,
    activeBreakpointId: 'desktop',
  } as Parameters<typeof useEditorStore.setState>[0])
}

/** Load a site with exactly N pages into the store. */
function loadSiteWithPages(pageCount: number) {
  const pages = Array.from({ length: pageCount }, (_, i) =>
    makePage({ id: `page-${i + 1}`, title: `Page ${i + 1}`, slug: `page-${i + 1}` })
  )
  const site = makeSite({ pages })
  useEditorStore.setState({
    site,
    activePageId: pages[0].id,
  } as Parameters<typeof useEditorStore.setState>[0])
}

/** Load a site with the default breakpoints into the store. */
function loadSiteWithBreakpoints(activeBreakpointId = 'desktop') {
  const site = makeSite()
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
    activeBreakpointId,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)
afterEach(cleanup)

// ---------------------------------------------------------------------------
// 1 — PagesSection — aria-disabled on Delete button (Guideline #224 / Task #245)
// ---------------------------------------------------------------------------

describe('PagesSection — Delete button aria-disabled pattern', () => {
  it('Delete button has aria-disabled="true" when only one page exists', () => {
    loadSiteWithPages(1)
    render(<PagesSection />)
    const deleteBtn = screen.getByRole('button', { name: /delete page/i })
    expect(deleteBtn.getAttribute('aria-disabled')).toBe('true')
  })

  it('Delete button does NOT have aria-disabled when multiple pages exist', () => {
    loadSiteWithPages(2)
    render(<PagesSection />)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete page/i })
    expect(deleteBtns.length).toBe(2)
    for (const btn of deleteBtns) {
      expect(btn.getAttribute('aria-disabled')).toBeNull()
    }
  })

  it('Delete button is NOT disabled attribute (remains keyboard-focusable) when aria-disabled', () => {
    // The key difference from `disabled`: keyboard users can still tab to the button
    // and read the tooltip explaining why deletion is blocked (Guideline #224).
    loadSiteWithPages(1)
    render(<PagesSection />)
    const deleteBtn = screen.getByRole('button', { name: /delete page/i })
    expect(deleteBtn.hasAttribute('disabled')).toBe(false)
    expect(deleteBtn.getAttribute('tabindex')).not.toBe('-1')
  })

  it('Delete button has a title tooltip explaining the restriction when aria-disabled', () => {
    loadSiteWithPages(1)
    render(<PagesSection />)
    const deleteBtn = screen.getByRole('button', { name: /delete page/i })
    const title = deleteBtn.getAttribute('title')
    expect(title).not.toBeNull()
    expect(title!.toLowerCase()).toContain('last page')
  })

  it('clicking the aria-disabled Delete button does NOT open the confirm UI', () => {
    loadSiteWithPages(1)
    render(<PagesSection />)
    const deleteBtn = screen.getByRole('button', { name: /delete page/i })
    fireEvent.click(deleteBtn)
    // No confirm button should appear — onClick is undefined when aria-disabled
    expect(screen.queryByRole('button', { name: /confirm delete/i })).toBeNull()
    expect(useEditorStore.getState().site!.pages.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 2 — PagesSection — inline confirm/cancel delete flow (Task #244)
// ---------------------------------------------------------------------------

describe('PagesSection — inline delete confirmation flow', () => {
  it('clicking Delete on a multi-page site shows Confirm and Cancel buttons', () => {
    loadSiteWithPages(2)
    render(<PagesSection />)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete page/i })
    fireEvent.click(deleteBtns[0])
    expect(screen.getByRole('button', { name: /confirm delete/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /cancel delete/i })).toBeDefined()
  })

  it('clicking Confirm deletes the page', () => {
    loadSiteWithPages(2)
    render(<PagesSection />)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete page/i })
    fireEvent.click(deleteBtns[0])
    fireEvent.click(screen.getByRole('button', { name: /confirm delete/i }))
    expect(useEditorStore.getState().site!.pages.length).toBe(1)
  })

  it('clicking Cancel dismisses confirm UI without deleting', () => {
    loadSiteWithPages(2)
    render(<PagesSection />)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete page/i })
    fireEvent.click(deleteBtns[0])
    fireEvent.click(screen.getByRole('button', { name: /cancel delete/i }))
    // Page count unchanged; confirm UI gone
    expect(useEditorStore.getState().site!.pages.length).toBe(2)
    expect(screen.queryByRole('button', { name: /confirm delete/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3 — BreakpointsSection — aria-disabled on Activate button (Guideline #224 / Task #245)
// ---------------------------------------------------------------------------

describe('BreakpointsSection — Activate button aria-disabled pattern', () => {
  it('Activate button has aria-disabled="true" for the currently active breakpoint', () => {
    loadSiteWithBreakpoints('desktop')
    render(<BreakpointsSection />)
    const activateBtn = screen.getByRole('button', { name: /set desktop as active/i })
    expect(activateBtn.getAttribute('aria-disabled')).toBe('true')
  })

  it('Activate button does NOT have aria-disabled for inactive breakpoints', () => {
    loadSiteWithBreakpoints('desktop')
    render(<BreakpointsSection />)
    const allActivateBtns = screen.getAllByRole('button', { name: /set .* as active/i })
    const inactiveBtns = allActivateBtns.filter(
      (btn) => btn.getAttribute('aria-disabled') !== 'true'
    )
    expect(inactiveBtns.length).toBeGreaterThan(0)
    for (const btn of inactiveBtns) {
      expect(btn.getAttribute('aria-disabled')).toBeNull()
    }
  })

  it('Activate button is NOT disabled attribute (remains keyboard-focusable) for active breakpoint', () => {
    loadSiteWithBreakpoints('desktop')
    render(<BreakpointsSection />)
    const activateBtn = screen.getByRole('button', { name: /set desktop as active/i })
    expect(activateBtn.hasAttribute('disabled')).toBe(false)
    expect(activateBtn.getAttribute('tabindex')).not.toBe('-1')
  })

  it('Activate button has a title tooltip for the already-active breakpoint', () => {
    loadSiteWithBreakpoints('desktop')
    render(<BreakpointsSection />)
    const activateBtn = screen.getByRole('button', { name: /set desktop as active/i })
    const title = activateBtn.getAttribute('title')
    expect(title).not.toBeNull()
    expect(title!.length).toBeGreaterThan(0)
  })

  it('clicking the aria-disabled Activate button does NOT change the active breakpoint', () => {
    loadSiteWithBreakpoints('desktop')
    render(<BreakpointsSection />)
    const activeIdBefore = useEditorStore.getState().activeBreakpointId
    const activateBtn = screen.getByRole('button', { name: /set desktop as active/i })
    fireEvent.click(activateBtn)
    expect(useEditorStore.getState().activeBreakpointId).toBe(activeIdBefore)
  })

  it('clicking an inactive breakpoints Activate button DOES update the active breakpoint', () => {
    loadSiteWithBreakpoints('desktop')
    render(<BreakpointsSection />)
    const allActivateBtns = screen.getAllByRole('button', { name: /set .* as active/i })
    const inactiveBtn = allActivateBtns.find(
      (btn) => btn.getAttribute('aria-disabled') !== 'true'
    )
    expect(inactiveBtn).toBeDefined()
    fireEvent.click(inactiveBtn!)
    expect(useEditorStore.getState().activeBreakpointId).not.toBe('desktop')
  })
})

// ---------------------------------------------------------------------------
// 4 — BreakpointsSection — inline confirm/cancel remove flow (Task #244)
// ---------------------------------------------------------------------------

describe('BreakpointsSection — inline remove confirmation flow', () => {
  it('clicking Remove shows Confirm and Cancel buttons', () => {
    loadSiteWithBreakpoints()
    render(<BreakpointsSection />)
    const removeBtns = screen.getAllByRole('button', { name: /remove .* breakpoint/i })
    fireEvent.click(removeBtns[0])
    expect(screen.getByRole('button', { name: /confirm remove/i })).toBeDefined()
    expect(screen.getByRole('button', { name: /cancel remove/i })).toBeDefined()
  })

  it('clicking Confirm removes the breakpoint', () => {
    loadSiteWithBreakpoints()
    render(<BreakpointsSection />)
    const bpCountBefore = useEditorStore.getState().site!.breakpoints.length
    const removeBtns = screen.getAllByRole('button', { name: /remove .* breakpoint/i })
    fireEvent.click(removeBtns[0])
    fireEvent.click(screen.getByRole('button', { name: /confirm remove/i }))
    expect(useEditorStore.getState().site!.breakpoints.length).toBe(bpCountBefore - 1)
  })

  it('clicking Cancel dismisses confirm UI without removing the breakpoint', () => {
    loadSiteWithBreakpoints()
    render(<BreakpointsSection />)
    const bpCountBefore = useEditorStore.getState().site!.breakpoints.length
    const removeBtns = screen.getAllByRole('button', { name: /remove .* breakpoint/i })
    fireEvent.click(removeBtns[0])
    fireEvent.click(screen.getByRole('button', { name: /cancel remove/i }))
    expect(useEditorStore.getState().site!.breakpoints.length).toBe(bpCountBefore)
    expect(screen.queryByRole('button', { name: /confirm remove/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5 — Source-scan enforcement — aria-disabled pattern regression guard
// ---------------------------------------------------------------------------

describe('Settings Sections — aria-disabled source enforcement (Guideline #224)', () => {
  const pagesSrc = readFileSync(
    new URL('../../editor/components/Settings/sections/PagesSection.tsx', import.meta.url),
    'utf-8',
  )
  const breakpointsSrc = readFileSync(
    new URL('../../editor/components/Settings/sections/BreakpointsSection.tsx', import.meta.url),
    'utf-8',
  )

  it('PagesSection Delete button uses aria-disabled (not the disabled attribute)', () => {
    expect(pagesSrc).toContain('aria-disabled')
    // Must not fall back to the `disabled` attribute on the delete button
    expect(pagesSrc).not.toMatch(/disabled=\{site\.pages\.length <= 1\}/)
  })

  it('BreakpointsSection Activate button uses aria-disabled (not the disabled attribute)', () => {
    expect(breakpointsSrc).toContain('aria-disabled')
    expect(breakpointsSrc).not.toMatch(/disabled=\{bp\.id === activeBreakpointId\}/)
  })

  it('PagesSection aria-disabled is conditional on page count', () => {
    expect(pagesSrc).toMatch(/aria-disabled=\{site\.pages\.length <= 1[^}]*\}/)
  })

  it('BreakpointsSection aria-disabled is conditional on active breakpoint ID', () => {
    expect(breakpointsSrc).toMatch(/aria-disabled=\{bp\.id === activeBreakpointId[^}]*\}/)
  })

  it('PagesSection Delete onClick is undefined when aria-disabled (true no-op)', () => {
    expect(pagesSrc).toMatch(/onClick=\{site\.pages\.length <= 1 \? undefined/)
  })

  it('BreakpointsSection Activate onClick is undefined when aria-disabled (true no-op)', () => {
    expect(breakpointsSrc).toMatch(/onClick=\{bp\.id === activeBreakpointId \? undefined/)
  })
})

// ---------------------------------------------------------------------------
// 6 — Source-scan enforcement — no window.confirm() in Settings sections (Task #244)
// ---------------------------------------------------------------------------

describe('Settings Sections — no window.confirm() (Task #244)', () => {
  const pagesSrc = readFileSync(
    new URL('../../editor/components/Settings/sections/PagesSection.tsx', import.meta.url),
    'utf-8',
  )
  const breakpointsSrc = readFileSync(
    new URL('../../editor/components/Settings/sections/BreakpointsSection.tsx', import.meta.url),
    'utf-8',
  )

  it('PagesSection does not use window.confirm() / confirm()', () => {
    // window.confirm() is blocked in sandboxed contexts, visually inconsistent
    // with the app's dark theme, and untestable. Replaced with inline confirm UI.
    expect(pagesSrc).not.toMatch(/\bconfirm\s*\(/)
  })

  it('BreakpointsSection does not use window.confirm() / confirm()', () => {
    expect(breakpointsSrc).not.toMatch(/\bconfirm\s*\(/)
  })

  it('PagesSection has an inline confirmation state (confirmDeleteId)', () => {
    // Evidence that the confirm UI is properly implemented as React state
    expect(pagesSrc).toContain('confirmDeleteId')
  })

  it('BreakpointsSection has an inline confirmation state (confirmRemoveId)', () => {
    expect(breakpointsSrc).toContain('confirmRemoveId')
  })
})

// ---------------------------------------------------------------------------
// 7 — BreakpointsSection — minimum breakpoint guard (Task #241 item 3)
//
// Removing the last breakpoint leaves site.breakpoints = [], causing
// CanvasRoot to render nothing. The Remove button must be aria-disabled
// when only 1 breakpoint remains.
// ---------------------------------------------------------------------------

/** Load a site with exactly 1 breakpoint. */
function loadSiteWithOneBreakpoint() {
  const site = makeSite({
    breakpoints: [{ id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor' }],
  })
  useEditorStore.setState({
    site,
    activePageId: site.pages[0].id,
    activeBreakpointId: 'desktop',
  } as Parameters<typeof useEditorStore.setState>[0])
}

describe('BreakpointsSection — minimum breakpoint guard (Task #241)', () => {
  it('Remove button has aria-disabled="true" when only 1 breakpoint exists', () => {
    loadSiteWithOneBreakpoint()
    render(<BreakpointsSection />)
    const removeBtn = screen.getByRole('button', { name: /remove desktop breakpoint/i })
    expect(removeBtn.getAttribute('aria-disabled')).toBe('true')
  })

  it('Remove button is NOT the disabled attribute (stays keyboard-focusable)', () => {
    loadSiteWithOneBreakpoint()
    render(<BreakpointsSection />)
    const removeBtn = screen.getByRole('button', { name: /remove desktop breakpoint/i })
    expect(removeBtn.hasAttribute('disabled')).toBe(false)
  })

  it('Remove button has a title tooltip when only 1 breakpoint remains', () => {
    loadSiteWithOneBreakpoint()
    render(<BreakpointsSection />)
    const removeBtn = screen.getByRole('button', { name: /remove desktop breakpoint/i })
    const title = removeBtn.getAttribute('title')
    expect(title).not.toBeNull()
    expect(title!.toLowerCase()).toContain('last breakpoint')
  })

  it('clicking the aria-disabled Remove button does NOT open the confirm UI', () => {
    loadSiteWithOneBreakpoint()
    render(<BreakpointsSection />)
    const removeBtn = screen.getByRole('button', { name: /remove desktop breakpoint/i })
    fireEvent.click(removeBtn)
    expect(screen.queryByRole('button', { name: /confirm remove/i })).toBeNull()
    expect(useEditorStore.getState().site!.breakpoints.length).toBe(1)
  })

  it('Remove button does NOT have aria-disabled when multiple breakpoints exist', () => {
    loadSiteWithBreakpoints() // loads default 2+ breakpoints
    render(<BreakpointsSection />)
    const removeBtns = screen.getAllByRole('button', { name: /remove .* breakpoint/i })
    expect(removeBtns.length).toBeGreaterThan(0)
    for (const btn of removeBtns) {
      expect(btn.getAttribute('aria-disabled')).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// 8 — PreferencesSection — retired preferences
// ---------------------------------------------------------------------------

describe('PreferencesSection — retired preferences', () => {
  it('renders only active preference switches', () => {
    render(<PreferencesSection />)

    expect(screen.getAllByRole('switch')).toHaveLength(2)
    expect(screen.getByRole('switch', { name: /auto-save/i })).toBeDefined()
    expect(screen.getByRole('switch', { name: /preview classes on hover/i })).toBeDefined()
    expect(screen.queryByRole('switch', { name: /snap to grid/i })).toBeNull()
    expect(screen.queryByRole('switch', { name: /reduce motion/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 9 — PagesSection — inline confirm focus management (Task #256 / Guideline #258)
//
// When Delete is clicked and the inline confirmation UI appears, keyboard focus
// must move to the Confirm button so keyboard-only users know the UI changed.
// Escape must dismiss the confirmation without executing the action.
// (UX Reviewer review of Contribution #370 / Task #256)
// ---------------------------------------------------------------------------

describe('PagesSection — inline confirm focus management (Task #256)', () => {
  it('Confirm button receives focus when confirmation state appears', () => {
    loadSiteWithPages(2)
    render(<PagesSection />)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete page/i })
    fireEvent.click(deleteBtns[0])
    const confirmBtn = screen.getByRole('button', { name: /confirm delete/i })
    // useEffect fires after render, calling confirmBtnRef.current?.focus()
    expect(document.activeElement).toBe(confirmBtn)
  })

  it('Escape key on Confirm button dismisses the confirmation state', () => {
    loadSiteWithPages(2)
    render(<PagesSection />)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete page/i })
    fireEvent.click(deleteBtns[0])
    const confirmBtn = screen.getByRole('button', { name: /confirm delete/i })
    // keyDown on the button bubbles up to the outer button-row onKeyDown handler
    fireEvent.keyDown(confirmBtn, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /confirm delete/i })).toBeNull()
    // Page must not have been deleted
    expect(useEditorStore.getState().site!.pages.length).toBe(2)
  })

  it('Escape key on Cancel button also dismisses the confirmation state', () => {
    loadSiteWithPages(2)
    render(<PagesSection />)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete page/i })
    fireEvent.click(deleteBtns[0])
    const cancelBtn = screen.getByRole('button', { name: /cancel delete/i })
    fireEvent.keyDown(cancelBtn, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /confirm delete/i })).toBeNull()
  })

  it('Confirm button accessible name includes the page name (not just "Confirm")', () => {
    loadSiteWithPages(2) // creates Page 1 and Page 2
    render(<PagesSection />)
    const deleteBtns = screen.getAllByRole('button', { name: /^delete page/i })
    fireEvent.click(deleteBtns[0])
    const confirmBtn = screen.getByRole('button', { name: /confirm delete/i })
    const accessibleName = confirmBtn.getAttribute('aria-label') ?? confirmBtn.textContent ?? ''
    // Must mention the specific page — not just say "Confirm"
    expect(accessibleName.toLowerCase()).toMatch(/page \d+|page 1/)
  })
})

// ---------------------------------------------------------------------------
// 10 — BreakpointsSection — inline confirm focus management (Task #256 / Guideline #258)
// ---------------------------------------------------------------------------

describe('BreakpointsSection — inline confirm focus management (Task #256)', () => {
  it('Confirm button receives focus when confirmation state appears', () => {
    loadSiteWithBreakpoints()
    render(<BreakpointsSection />)
    const removeBtns = screen.getAllByRole('button', { name: /remove .* breakpoint/i })
    fireEvent.click(removeBtns[0])
    const confirmBtn = screen.getByRole('button', { name: /confirm remove/i })
    expect(document.activeElement).toBe(confirmBtn)
  })

  it('Escape key on Confirm button dismisses the confirmation state', () => {
    loadSiteWithBreakpoints()
    render(<BreakpointsSection />)
    const bpCountBefore = useEditorStore.getState().site!.breakpoints.length
    const removeBtns = screen.getAllByRole('button', { name: /remove .* breakpoint/i })
    fireEvent.click(removeBtns[0])
    const confirmBtn = screen.getByRole('button', { name: /confirm remove/i })
    fireEvent.keyDown(confirmBtn, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /confirm remove/i })).toBeNull()
    // Breakpoint must not have been removed
    expect(useEditorStore.getState().site!.breakpoints.length).toBe(bpCountBefore)
  })

  it('Escape key on Cancel button also dismisses the confirmation state', () => {
    loadSiteWithBreakpoints()
    render(<BreakpointsSection />)
    const removeBtns = screen.getAllByRole('button', { name: /remove .* breakpoint/i })
    fireEvent.click(removeBtns[0])
    const cancelBtn = screen.getByRole('button', { name: /cancel remove/i })
    fireEvent.keyDown(cancelBtn, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: /confirm remove/i })).toBeNull()
  })

  it('Confirm button accessible name includes the breakpoint label (not just "Confirm")', () => {
    loadSiteWithBreakpoints()
    render(<BreakpointsSection />)
    const removeBtns = screen.getAllByRole('button', { name: /remove .* breakpoint/i })
    fireEvent.click(removeBtns[0])
    const confirmBtn = screen.getByRole('button', { name: /confirm remove/i })
    const accessibleName = confirmBtn.getAttribute('aria-label') ?? confirmBtn.textContent ?? ''
    // Must mention "breakpoint" — not just "Confirm" — for full screen reader context
    expect(accessibleName.toLowerCase()).toContain('breakpoint')
  })
})

// ---------------------------------------------------------------------------
// 11 — Source-scan enforcement — focus management + Esc key (Task #256)
//
// Ensures the accessibility patterns from Task #256 cannot be silently reverted
// during Phase B (ShadCN migration) or future refactors.
// ---------------------------------------------------------------------------

describe('Settings Sections — focus management source enforcement (Task #256 / Guideline #258)', () => {
  const pagesSrc = readFileSync(
    new URL('../../editor/components/Settings/sections/PagesSection.tsx', import.meta.url),
    'utf-8',
  )
  const breakpointsSrc = readFileSync(
    new URL('../../editor/components/Settings/sections/BreakpointsSection.tsx', import.meta.url),
    'utf-8',
  )

  it('PagesSection imports useRef and useEffect for focus management', () => {
    expect(pagesSrc).toContain('useRef')
    expect(pagesSrc).toContain('useEffect')
  })

  it('PagesSection declares a confirmBtnRef as HTMLButtonElement ref', () => {
    expect(pagesSrc).toContain('confirmBtnRef')
    expect(pagesSrc).toMatch(/useRef<HTMLButtonElement>/)
  })

  it('PagesSection useEffect focuses confirm button when confirmDeleteId is set', () => {
    expect(pagesSrc).toContain('confirmBtnRef.current?.focus()')
    expect(pagesSrc).toContain('confirmDeleteId')
  })

  it('PagesSection has an Esc key handler that clears confirmDeleteId', () => {
    expect(pagesSrc).toMatch(/['"]Escape['"]/)
    expect(pagesSrc).toContain('setConfirmDeleteId(null)')
  })

  it('BreakpointsSection imports useRef and useEffect for focus management', () => {
    expect(breakpointsSrc).toContain('useRef')
    expect(breakpointsSrc).toContain('useEffect')
  })

  it('BreakpointsSection declares a confirmBtnRef as HTMLButtonElement ref', () => {
    expect(breakpointsSrc).toContain('confirmBtnRef')
    expect(breakpointsSrc).toMatch(/useRef<HTMLButtonElement>/)
  })

  it('BreakpointsSection useEffect focuses confirm button when confirmRemoveId is set', () => {
    expect(breakpointsSrc).toContain('confirmBtnRef.current?.focus()')
    expect(breakpointsSrc).toContain('confirmRemoveId')
  })

  it('BreakpointsSection has an Esc key handler that clears confirmRemoveId', () => {
    expect(breakpointsSrc).toMatch(/['"]Escape['"]/)
    expect(breakpointsSrc).toContain('setConfirmRemoveId(null)')
  })
})
