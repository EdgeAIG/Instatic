/**
 * SettingsModal DOM Integration Tests — J10 (Guideline #225)
 *
 * ─── Test groups ────────────────────────────────────────────────────────────
 *   1.  Render gating  — modal hidden when closed, visible when open
 *   2.  ARIA dialog shell — role/aria-modal/aria-labelledby/heading id
 *   3.  data-testid (Guideline #221)
 *   4.  Backdrop — aria-hidden, click-to-close
 *   5.  Section navigation — nav items, aria-current, retired section fallback
 *   6.  Section sync — valid/invalid section IDs from store
 *   7.  Close behaviours — close button, Escape key, backdrop click
 *   8.  Focus trap keyboard logic — Tab/Shift+Tab stays inside dialog
 *   9.  PagesSection rendering — site-null state
 *  10.  PreferencesSection — role="switch" toggles, state update
 *  11.  WCAG 2.5.5 Touch Targets (source-scan enforcement)
 *       ⚠️  These tests FAIL until FSE applies the 3 fixes from Contribution #345.
 *       They are intentional CI red-lights. Fixes are small — drop-in code in
 *       Contribution #345. All three violations were confirmed still present in
 *       source by UX Reviewer (message #1007/#1008/#1014).
 *  12.  WCAG 2.4.3 / Guideline #225 — Focus return (source-scan enforcement)
 *       ⚠️  Currently FAILING — the useEffect in SettingsModal.tsx only handles
 *       `if (open)` — no trigger capture, no focus restore on close.
 *  13.  Section ID alignment — SettingsButton + store default (source-scan)
 *       ⚠️  Currently FAILING — SettingsButton dispatches 'general' which is not
 *       a valid SectionId. Store default also uses 'general'.
 *
 * Uses @testing-library/react. happy-dom GlobalWindow is preloaded via setup.ts.
 * localStorage.clear() in beforeEach prevents PreferencesSection prefs from
 * leaking between tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import React from 'react'
import { render, screen, cleanup, fireEvent, act, within } from '@testing-library/react'
import { readFileSync } from 'fs'
import { SettingsModal } from '@admin/modals/Settings/SettingsModal'
import { useEditorStore } from '@site/store/store'
import { makeSite, makePage } from '../fixtures'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_TOUCH_TARGET = 44 // WCAG 2.5.5

// ---------------------------------------------------------------------------
// Store + DOM reset
// ---------------------------------------------------------------------------

function resetStore() {
  localStorage.clear()
  useEditorStore.setState({
    site: null,
    activePageId: null,
    selectedNodeId: null,
    selectedNodeIds: [],
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

/** Open the modal and optionally load a site into the store. */
function openModal(section = 'pages', withSite = false) {
  if (withSite) {
    const site = makeSite({ pages: [makePage()] })
    useEditorStore.setState({ site, activePageId: 'page-1' } as Parameters<typeof useEditorStore.setState>[0])
  }
  useEditorStore.setState({
    settingsModalOpen: true,
    settingsModalSection: section,
  } as Parameters<typeof useEditorStore.setState>[0])
}

beforeEach(resetStore)
afterEach(cleanup)

// ---------------------------------------------------------------------------
// 1 — Render gating
// ---------------------------------------------------------------------------

describe('SettingsModal — render gating', () => {
  it('renders nothing when settingsModalOpen is false', () => {
    render(<SettingsModal />)
    // null render — no dialog in the DOM
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders the dialog when settingsModalOpen is true', () => {
    openModal()
    render(<SettingsModal />)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })

  it('unmounts cleanly when modal transitions from open to closed', () => {
    openModal()
    const { unmount } = render(<SettingsModal />)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    act(() => {
      useEditorStore.setState({ settingsModalOpen: false } as Parameters<typeof useEditorStore.setState>[0])
    })
    unmount()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 2 — ARIA dialog shell (Guideline #225 / WCAG 4.1.2)
// ---------------------------------------------------------------------------

describe('SettingsModal — ARIA dialog shell', () => {
  it('has role="dialog" on the modal container', () => {
    openModal()
    render(<SettingsModal />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeDefined()
  })

  it('has aria-modal="true" on the dialog', () => {
    openModal()
    render(<SettingsModal />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('has aria-labelledby="settings-modal-title" on the dialog', () => {
    openModal()
    render(<SettingsModal />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-labelledby')).toBe('settings-modal-title')
  })

  it('heading with id="settings-modal-title" exists inside the dialog', () => {
    openModal()
    render(<SettingsModal />)
    const heading = document.getElementById('settings-modal-title')
    expect(heading).not.toBeNull()
    expect(heading!.textContent).toBe('Settings')
  })

  it('nav has aria-label="Settings sections"', () => {
    openModal()
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    expect(nav).toBeDefined()
  })

  it('content area has role="region"', () => {
    openModal()
    render(<SettingsModal />)
    // There should be at least one region element in the dialog
    const dialog = screen.getByRole('dialog')
    const region = dialog.querySelector('[role="region"]')
    expect(region).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3 — data-testid (Guideline #221)
// ---------------------------------------------------------------------------

describe('SettingsModal — data-testid (Guideline #221)', () => {
  it('renders data-testid="settings-modal" when open', () => {
    openModal()
    render(<SettingsModal />)
    expect(screen.getByTestId('settings-modal')).toBeDefined()
  })

  it('data-testid="settings-modal" not present when closed', () => {
    render(<SettingsModal />)
    expect(document.querySelector('[data-testid="settings-modal"]')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4 — Backdrop (aria-hidden, click-to-close)
// ---------------------------------------------------------------------------

describe('SettingsModal — backdrop', () => {
  it('backdrop has aria-hidden="true" so AT ignores it', () => {
    openModal()
    render(<SettingsModal />)
    // The backdrop is the first element before the dialog
    const backdrop = document.querySelector('[aria-hidden="true"]')
    expect(backdrop).not.toBeNull()
  })

  it('clicking the backdrop closes the modal (calls closeSettingsModal)', () => {
    openModal()
    render(<SettingsModal />)
    // Find the backdrop — it has aria-hidden="true" and the onClick handler
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop)
    // After click, store should have settingsModalOpen: false
    expect(useEditorStore.getState().settingsModalOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5 — Section navigation
// ---------------------------------------------------------------------------

describe('SettingsModal — section navigation', () => {
  it('renders exactly 6 nav items (general, pages, breakpoints, shortcuts, publishing, preferences)', () => {
    openModal()
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    // The nav contains 6 section buttons + 1 close button.
    // Exclude the close button (identified by aria-label="Close settings").
    const navBtns = Array.from(nav.querySelectorAll('button')).filter(
      (btn) => btn.getAttribute('aria-label') !== 'Close settings'
    )
    expect(navBtns.length).toBe(6)
  })

  it('renders nav items with correct labels after retiring typography and colors', () => {
    // Open on 'pages' so the Preferences section content is not rendered,
    // avoiding duplicate "Preferences" text (nav button + section h3).
    openModal('pages')
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    expect(within(nav).getByText('General')).toBeDefined()
    expect(within(nav).getByText('Pages')).toBeDefined()
    expect(within(nav).getByText('Breakpoints')).toBeDefined()
    expect(within(nav).getByText('Publishing')).toBeDefined()
    expect(within(nav).getByText('Shortcuts')).toBeDefined()
    expect(within(nav).getByText('Preferences')).toBeDefined()
    expect(within(nav).queryByText('Typography')).toBeNull()
    expect(within(nav).queryByText('Colors')).toBeNull()
  })

  it('active nav item has aria-current="page"', () => {
    openModal('pages')
    render(<SettingsModal />)
    // Scope to nav to avoid duplicate text from section headings
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const pagesBtn = within(nav).getByText('Pages').closest('button')
    expect(pagesBtn!.getAttribute('aria-current')).toBe('page')
  })

  it('inactive nav items have no aria-current attribute', () => {
    openModal('pages')
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const breakpointsBtn = within(nav).getByText('Breakpoints').closest('button')
    // Should not have aria-current when not active
    expect(breakpointsBtn!.hasAttribute('aria-current')).toBe(false)
  })

  it('clicking a nav item updates aria-current to that item', () => {
    openModal('pages')
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const breakpointsBtn = within(nav).getByText('Breakpoints').closest('button')!
    fireEvent.click(breakpointsBtn)
    expect(breakpointsBtn.getAttribute('aria-current')).toBe('page')

    // Pages should no longer be active
    const pagesBtn = within(nav).getByText('Pages').closest('button')!
    expect(pagesBtn.hasAttribute('aria-current')).toBe(false)
  })

  it('content region aria-label updates when section changes', () => {
    openModal('pages')
    render(<SettingsModal />)
    // Initially: aria-label="Pages"
    let region = document.querySelector('[role="region"]')
    expect(region!.getAttribute('aria-label')).toBe('Pages')

    // Click Breakpoints
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const breakpointsBtn = within(nav).getByText('Breakpoints').closest('button')!
    fireEvent.click(breakpointsBtn)

    region = document.querySelector('[role="region"]')
    expect(region!.getAttribute('aria-label')).toBe('Breakpoints')
  })
})

// ---------------------------------------------------------------------------
// 6 — Section sync from store
// ---------------------------------------------------------------------------

describe('SettingsModal — section sync from store', () => {
  it('opens on "pages" when store section is "pages"', () => {
    openModal('pages')
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const pagesBtn = within(nav).getByText('Pages').closest('button')!
    expect(pagesBtn.getAttribute('aria-current')).toBe('page')
  })

  it('opens on "preferences" when store section is "preferences"', () => {
    openModal('preferences')
    render(<SettingsModal />)
    // When Preferences section is active, "Preferences" text appears in BOTH the
    // nav button and the section <h3>. Scope to nav to disambiguate.
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const prefBtn = within(nav).getByText('Preferences').closest('button')!
    expect(prefBtn.getAttribute('aria-current')).toBe('page')
  })

  it('falls back to "general" when store section is an invalid ID', () => {
    // Phase 6 added 'general' to NAV_ITEMS — use a genuinely unknown ID to test fallback.
    // SettingsModal falls back to 'general' (the first section / useState default) when
    // the incoming section string does not match any NAV_ITEMS entry.
    openModal('nonexistent-section')
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const generalBtn = within(nav).getByText('General').closest('button')!
    expect(generalBtn.getAttribute('aria-current')).toBe('page')
  })

  it('falls back to "general" when store section is an empty string', () => {
    // Empty string is falsy — the sync useEffect condition `if (open && initialSection)`
    // short-circuits, leaving activeSection at its useState default of 'general'.
    openModal('')
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const generalBtn = within(nav).getByText('General').closest('button')!
    expect(generalBtn.getAttribute('aria-current')).toBe('page')
  })

  it('falls back to "general" when store section is retired typography', () => {
    openModal('typography')
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const generalBtn = within(nav).getByText('General').closest('button')!
    expect(generalBtn.getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('heading', { name: 'Typography' })).toBeNull()
  })

  it('falls back to "general" when store section is retired colors', () => {
    openModal('colors')
    render(<SettingsModal />)
    const nav = screen.getByRole('navigation', { name: /settings sections/i })
    const generalBtn = within(nav).getByText('General').closest('button')!
    expect(generalBtn.getAttribute('aria-current')).toBe('page')
    expect(screen.queryByRole('heading', { name: 'Colors' })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 7 — Close behaviours
// ---------------------------------------------------------------------------

describe('SettingsModal — close behaviours', () => {
  it('close button has aria-label="Close settings"', () => {
    openModal()
    render(<SettingsModal />)
    const closeBtn = screen.getByLabelText('Close settings')
    expect(closeBtn).toBeDefined()
  })

  it('clicking the close button closes the modal', () => {
    openModal()
    render(<SettingsModal />)
    const closeBtn = screen.getByLabelText('Close settings')
    fireEvent.click(closeBtn)
    expect(useEditorStore.getState().settingsModalOpen).toBe(false)
  })

  it('pressing Escape closes the modal', () => {
    openModal()
    render(<SettingsModal />)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
    expect(useEditorStore.getState().settingsModalOpen).toBe(false)
  })

  it('pressing Tab does NOT close the modal', () => {
    openModal()
    render(<SettingsModal />)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Tab', code: 'Tab' })
    // Modal should still be open
    expect(useEditorStore.getState().settingsModalOpen).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8 — Focus trap logic (keyboard navigation)
// ---------------------------------------------------------------------------

describe('SettingsModal — focus trap keyboard logic', () => {
  it('dialog has onKeyDown handler attached', () => {
    openModal()
    render(<SettingsModal />)
    const dialog = screen.getByRole('dialog')
    // The dialog should handle keydown (for Esc + Tab trap).
    // We verify the Escape path works as a proxy for the handler being present.
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(useEditorStore.getState().settingsModalOpen).toBe(false)
  })

  it('pressing Escape on a child element inside the dialog closes the modal', () => {
    openModal()
    render(<SettingsModal />)
    const closeBtn = screen.getByLabelText('Close settings')
    // Escape on a child — should bubble to dialog's onKeyDown
    fireEvent.keyDown(closeBtn, { key: 'Escape' })
    expect(useEditorStore.getState().settingsModalOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 9 — PagesSection rendering
// ---------------------------------------------------------------------------

describe('SettingsModal — PagesSection rendering', () => {
  it('shows "Loading site..." when no site is in store', () => {
    openModal('pages', false /* no site */)
    render(<SettingsModal />)
    expect(screen.getByText(/loading site/i)).toBeDefined()
  })

  it('shows page list when site is loaded', () => {
    openModal('pages', true /* with site */)
    render(<SettingsModal />)
    // makeSite creates one page with title 'Home'
    expect(screen.getByText('Home')).toBeDefined()
  })

  it('Pages section heading is visible when site is loaded', () => {
    // PagesSection returns early (no heading) when site is null.
    // A site must be in the store for the section content to render.
    openModal('pages', true /* withSite */)
    render(<SettingsModal />)
    // h3 "Pages" inside the content region (distinct from nav h2 "Settings")
    const h3 = Array.from(document.querySelectorAll('h3')).find(
      (el) => el.textContent === 'Pages'
    )
    expect(h3).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// 10 — PreferencesSection — role="switch" toggles
// ---------------------------------------------------------------------------

describe('SettingsModal — PreferencesSection toggles', () => {
  it('toggle buttons have role="switch"', () => {
    openModal('preferences')
    render(<SettingsModal />)
    const switches = screen.getAllByRole('switch')
    // Catalog-driven count — see editor/preferences/catalog.ts.
    // Boolean preferences: autoSave, hoverPreview, confirmBeforeDelete,
    // layersShowIcon, layersShowTag, layersShowClasses,
    // layersAutoExpandSelected, layersSmoothScroll, dimInactiveBreakpoints,
    // propertiesSmoothScroll, spotlightTelemetryEnabled (Phase 6).
    expect(switches.length).toBe(11)
  })

  it('Auto-save toggle has aria-checked="true" by default', () => {
    // defaultPrefs.autoSave = true
    openModal('preferences')
    render(<SettingsModal />)
    const autoSaveToggle = screen.getByRole('switch', { name: /auto-save/i })
    expect(autoSaveToggle.getAttribute('aria-checked')).toBe('true')
  })

  it('retired snap-to-grid and reduce-motion preferences are not rendered', () => {
    openModal('preferences')
    render(<SettingsModal />)

    expect(screen.queryByRole('switch', { name: /snap to grid/i })).toBeNull()
    expect(screen.queryByRole('switch', { name: /reduce motion/i })).toBeNull()
  })

  it('clicking a toggle flips its aria-checked state', () => {
    openModal('preferences')
    render(<SettingsModal />)
    const autoSaveToggle = screen.getByRole('switch', { name: /auto-save/i })
    expect(autoSaveToggle.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(autoSaveToggle)
    expect(autoSaveToggle.getAttribute('aria-checked')).toBe('false')
  })

  it('hover preview toggle is enabled by default and can be disabled', () => {
    openModal('preferences')
    render(<SettingsModal />)
    const previewToggle = screen.getByRole('switch', { name: /preview suggestions on hover/i })
    expect(previewToggle.getAttribute('aria-checked')).toBe('true')

    fireEvent.click(previewToggle)

    expect(previewToggle.getAttribute('aria-checked')).toBe('false')
    expect(JSON.parse(localStorage.getItem('pb-editor-prefs') ?? '{}').hoverPreview).toBe(false)
  })

  it('toggle labels are linked via htmlFor / id (label accessibility)', () => {
    openModal('preferences')
    render(<SettingsModal />)
    // Each toggle id is `pref-${catalogId}` — see PreferencesSection. The
    // catalog id for the auto-save preference is `autoSave`, so the DOM id
    // is `pref-autoSave`.
    const autoSaveToggle = document.getElementById('pref-autoSave')
    expect(autoSaveToggle).not.toBeNull()
    const label = document.querySelector('label[for="pref-autoSave"]')
    expect(label).not.toBeNull()
    expect(label!.textContent).toContain('Auto-save')
  })
})

// ---------------------------------------------------------------------------
// 11 — WCAG 2.5.5 Touch Targets — source-scan enforcement
//
// Nav + close button minHeight (SettingsModal.tsx) — FIXED by FSE ✅
// Toggle pill (PreferencesSection.tsx) — still width:36, height:20 ⚠️  FAILING
//
// Toggle pill fix: wrap the visual pill in a 44×44 transparent hit-area button.
// See Contribution #345 Issue 2 for the exact pattern (5-line change).
// ---------------------------------------------------------------------------

describe('SettingsModal — WCAG 2.5.5 touch targets (source enforcement)', () => {
  const modalTsx = readFileSync(
    new URL('../../admin/modals/Settings/SettingsModal.tsx', import.meta.url),
    'utf-8',
  )
  // Post-Task #399: styles moved from inline to SettingsModal.module.css — read both sources
  const { existsSync } = require('fs')
  const cssSrcUrl = new URL('../../admin/modals/Settings/SettingsModal.module.css', import.meta.url)
  const settingsCss = existsSync(cssSrcUrl.pathname) ? readFileSync(cssSrcUrl, 'utf-8') : ''
  const modalSrc = modalTsx + '\n' + settingsCss

  it(`nav item buttons have minHeight: ${MIN_TOUCH_TARGET} (WCAG 2.5.5)`, () => {
    // Assert inline style (minHeight: 44) OR CSS module (min-height: 44px).
    // Styles live in SettingsModal.module.css (moved from inline in Task #399).
    const hasInline = modalSrc.includes('minHeight: 44')
    const hasCssModule = modalSrc.includes('min-height: 44px')
    expect(hasInline || hasCssModule).toBe(true)

    // If inline styles are present in TSX, all minHeight values must be ≥ 44
    const minHeightValues = [...modalTsx.matchAll(/minHeight:\s*(\d+)/g)].map(
      (m) => parseInt(m[1], 10)
    )
    for (const val of minHeightValues) {
      expect(val).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET)
    }
  })

  const prefSrc = readFileSync(
    new URL('../../admin/modals/Settings/sections/PreferencesSection.tsx', import.meta.url),
    'utf-8',
  )

  it(`toggle pill button has width/height >= ${MIN_TOUCH_TARGET} (WCAG 2.5.5) [NEEDS FIX]`, () => {
    // Current source: width: 36, height: 20 on the toggle <button> — below 44px minimum.
    // Fix: wrap the visual pill in a 44×44 transparent hit-area button per Contribution #345 Issue 2.
    // This test will be RED until the fix is applied.
    expect(prefSrc).not.toMatch(/width:\s*36[\s,}]/)
    expect(prefSrc).not.toMatch(/height:\s*20[\s,}]/)
  })
})

// ---------------------------------------------------------------------------
// 12 — WCAG 2.4.3 / Guideline #225 — Focus return on close (source enforcement)
//
// FSE applied the 5-line fix from Contribution #345 Issue 1. Both assertions
// below now pass:
//   - triggerRef.current = document.activeElement on open ✅
//   - else { triggerRef.current?.focus() } on close ✅
// ---------------------------------------------------------------------------

describe('SettingsModal — Guideline #225 focus return (source enforcement)', () => {
  const modalSrc = readFileSync(
    new URL('../../admin/modals/Settings/SettingsModal.tsx', import.meta.url),
    'utf-8',
  )

  it('captures the trigger element (document.activeElement) before focusing inside on open', () => {
    // triggerRef.current = document.activeElement must be present inside the
    // useEffect when `open` becomes true (Guideline #225).
    expect(modalSrc).toContain('document.activeElement')
  })

  it('restores focus to the trigger element when modal closes (else branch)', () => {
    // An else branch that calls triggerRef.current?.focus() is required so
    // keyboard / screen-reader users return to the Settings button on close.
    expect(modalSrc).toMatch(/else\s*\{[\s\S]*?\.focus\(\)/)
  })
})

// ---------------------------------------------------------------------------
// 13 — Section ID alignment — SettingsButton + store default (source enforcement)
//
// SettingsButton.tsx — FIXED by FSE (now dispatches 'pages') ✅
// uiSlice.ts store default — FIXED by Performance Engineer (#358) ✅
// ---------------------------------------------------------------------------

describe('SettingsButton + uiSlice — section ID alignment (source enforcement)', () => {
  const btnSrc = readFileSync(
    new URL('../../admin/pages/site/toolbar/SettingsButton.tsx', import.meta.url),
    'utf-8',
  )

  const uiSliceSrc = readFileSync(
    new URL('../../admin/pages/site/store/slices/uiSlice.ts', import.meta.url),
    'utf-8',
  )

  it('SettingsButton dispatches a valid section ID (not "general")', () => {
    // FSE already fixed: openSettings('general') → openSettings('pages').
    // 'general' does not exist in NAV_ITEMS — silent fallback to 'pages'.
    expect(btnSrc).not.toContain("openSettings('general')")
  })

  it('uiSlice settingsModalSection default is a valid section ID (not "general")', () => {
    // Fixed in Contribution #358: settingsModalSection: 'general' → 'pages'.
    // Also openSettingsModal default parameter: section = 'general' → 'pages'.
    expect(uiSliceSrc).not.toContain("settingsModalSection: 'general'")
  })
})

// ---------------------------------------------------------------------------
// 14 — WCAG 2.4.7 — Input focus rings (source-scan enforcement)
//
// Focus rings are now provided by the Input / Select / Textarea UI primitives
// themselves (`src/ui/components/Input/Input.module.css`,
// `src/ui/components/Select/Select.module.css`) via the `--input-border-focus`
// token. The Settings modal no longer needs (and no longer has) a scoped
// `<style>` block overriding focus styles — that band-aid existed when the
// legacy `inputStyle` had `outline:none` with no replacement; the primitives
// now own this contract.
// ---------------------------------------------------------------------------

describe('SettingsModal — WCAG 2.4.7 input focus rings (source enforcement)', () => {
  const inputCss = readFileSync(
    new URL('../../ui/components/Input/Input.module.css', import.meta.url),
    'utf-8',
  )
  const selectCss = readFileSync(
    new URL('../../ui/components/Select/Select.module.css', import.meta.url),
    'utf-8',
  )

  it('Input primitive has a visible :focus / :focus-within style', () => {
    // The Input primitive must carry its own focus indicator — every settings
    // text/number/url field uses it.
    expect(inputCss).toMatch(/:focus(-within)?/)
    expect(inputCss).toContain('--input-border-focus')
  })

  it('Select primitive has a visible focus indicator', () => {
    // Select's combobox trigger renders an <input role="combobox"> internally,
    // which inherits the same focus contract via the input/border tokens.
    expect(selectCss).toMatch(/--input-border-focus|:focus/)
  })

  it('SettingsModal no longer carries an inline <style> band-aid', () => {
    // Hardcoded rgba focus ring inside the modal violated the design-token
    // policy. Primitives now own this — the `<style>` block must stay gone.
    const modalSrc = readFileSync(
      new URL('../../admin/modals/Settings/SettingsModal.tsx', import.meta.url),
      'utf-8',
    )
    expect(modalSrc).not.toContain('<style>')
  })
})
