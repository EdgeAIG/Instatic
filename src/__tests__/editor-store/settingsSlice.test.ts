/**
 * settingsSlice — unit tests
 *
 * Covers the full public API of the settings Zustand slice:
 *   - Initial state (isSettingsOpen, activeSection)
 *   - openSettings()  — opens modal, optional section jump
 *   - closeSettings() — closes modal, preserves activeSection
 *   - setSettingsSection() — updates section without touching isSettingsOpen
 *   - All valid SettingsSection values are accepted
 *
 * Phase 6 (Task #183) expanded SettingsSection. Typography and colors were later
 * retired from the settings modal while the underlying site settings remain
 * available for existing documents and publishing.
 *
 * @see src/core/editor-store/slices/settingsSlice.ts
 * @see Guideline #193 — Zustand Store Slice Guidelines
 * @see Contribution #457 — Phase 0 Architectural Specification
 * @see Contribution #483 — Phase 0 SiteDocument Scaffold
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import { useEditorStore } from '../../core/editor-store/store'
import type { SettingsSection } from '../../core/editor-store/slices/settingsSlice'

// ---------------------------------------------------------------------------
// Store reset helper
// ---------------------------------------------------------------------------

/**
 * Reset only the settings slice state to its canonical defaults.
 * Using setState is safe here — we reset to known values and do not touch
 * other slice state, keeping tests independent.
 */
function resetSettings() {
  useEditorStore.setState({
    isSettingsOpen: false,
    activeSection: 'general' as SettingsSection,
  })
}

function getSettings() {
  const s = useEditorStore.getState()
  return { isSettingsOpen: s.isSettingsOpen, activeSection: s.activeSection }
}

beforeEach(resetSettings)

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('settingsSlice — initial state', () => {
  it('isSettingsOpen defaults to false', () => {
    expect(getSettings().isSettingsOpen).toBe(false)
  })

  it('activeSection defaults to "general" (first nav item added in Phase 6)', () => {
    expect(getSettings().activeSection).toBe('general')
  })
})

// ---------------------------------------------------------------------------
// openSettings
// ---------------------------------------------------------------------------

describe('openSettings — no argument (default section)', () => {
  it('sets isSettingsOpen to true', () => {
    useEditorStore.getState().openSettings()
    expect(getSettings().isSettingsOpen).toBe(true)
  })

  it('sets activeSection to "general" when called with no argument (Phase 6 default)', () => {
    useEditorStore.getState().openSettings()
    expect(getSettings().activeSection).toBe('general')
  })

  it('calling openSettings() while already open is idempotent — stays open', () => {
    useEditorStore.getState().openSettings()
    useEditorStore.getState().openSettings()
    expect(getSettings().isSettingsOpen).toBe(true)
  })
})

describe('openSettings — with explicit section argument', () => {
  it('opens the modal and jumps to "breakpoints"', () => {
    useEditorStore.getState().openSettings('breakpoints')
    const s = getSettings()
    expect(s.isSettingsOpen).toBe(true)
    expect(s.activeSection).toBe('breakpoints')
  })

  it('opens the modal and jumps to "preferences"', () => {
    useEditorStore.getState().openSettings('preferences')
    const s = getSettings()
    expect(s.isSettingsOpen).toBe(true)
    expect(s.activeSection).toBe('preferences')
  })

  it('opens the modal and jumps to "shortcuts"', () => {
    useEditorStore.getState().openSettings('shortcuts')
    const s = getSettings()
    expect(s.isSettingsOpen).toBe(true)
    expect(s.activeSection).toBe('shortcuts')
  })

  it('opens the modal and jumps to "publishing"', () => {
    useEditorStore.getState().openSettings('publishing')
    const s = getSettings()
    expect(s.isSettingsOpen).toBe(true)
    expect(s.activeSection).toBe('publishing')
  })

  it('opens the modal and jumps to "modules"', () => {
    useEditorStore.getState().openSettings('modules')
    const s = getSettings()
    expect(s.isSettingsOpen).toBe(true)
    expect(s.activeSection).toBe('modules')
  })

  it('switches section when called on an already-open modal', () => {
    useEditorStore.getState().openSettings('pages')
    useEditorStore.getState().openSettings('publishing')
    const s = getSettings()
    expect(s.isSettingsOpen).toBe(true)
    expect(s.activeSection).toBe('publishing')
  })
})

// ---------------------------------------------------------------------------
// closeSettings
// ---------------------------------------------------------------------------

describe('closeSettings', () => {
  it('sets isSettingsOpen to false', () => {
    useEditorStore.getState().openSettings()
    useEditorStore.getState().closeSettings()
    expect(getSettings().isSettingsOpen).toBe(false)
  })

  it('preserves activeSection after closing (does NOT reset to "pages")', () => {
    useEditorStore.getState().openSettings('publishing')
    useEditorStore.getState().closeSettings()
    // The active section should persist so the next open resumes where the
    // user left off (Phase 6 UX behaviour per Guideline #324)
    expect(getSettings().activeSection).toBe('publishing')
  })

  it('preserves "shortcuts" section after closing', () => {
    useEditorStore.getState().openSettings('shortcuts')
    useEditorStore.getState().closeSettings()
    expect(getSettings().activeSection).toBe('shortcuts')
  })

  it('calling closeSettings when already closed is a safe no-op', () => {
    expect(getSettings().isSettingsOpen).toBe(false)
    useEditorStore.getState().closeSettings()
    expect(getSettings().isSettingsOpen).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// setSettingsSection
// ---------------------------------------------------------------------------

describe('setSettingsSection', () => {
  it('updates activeSection without opening the modal', () => {
    useEditorStore.getState().setSettingsSection('modules')
    const s = getSettings()
    expect(s.activeSection).toBe('modules')
    expect(s.isSettingsOpen).toBe(false) // must NOT change isSettingsOpen
  })

  it('updates activeSection while the modal is open', () => {
    useEditorStore.getState().openSettings('pages')
    useEditorStore.getState().setSettingsSection('breakpoints')
    const s = getSettings()
    expect(s.activeSection).toBe('breakpoints')
    expect(s.isSettingsOpen).toBe(true) // modal stays open
  })

  it('does not close the modal when called while open', () => {
    useEditorStore.getState().openSettings()
    useEditorStore.getState().setSettingsSection('preferences')
    expect(getSettings().isSettingsOpen).toBe(true)
  })

  it('accepts all valid SettingsSection values', () => {
    const sections: SettingsSection[] = [
      'general',
      'pages',
      'breakpoints',
      'preferences',
      'shortcuts',
      'publishing',
      'modules',
    ]
    for (const section of sections) {
      useEditorStore.getState().setSettingsSection(section)
      expect(getSettings().activeSection).toBe(section)
    }
  })
})

// ---------------------------------------------------------------------------
// Round-trip: open → navigate → close → re-open
// ---------------------------------------------------------------------------

describe('round-trip usage', () => {
  it('open → navigate → close → re-open defaults to "general" (Phase 6 default)', () => {
    useEditorStore.getState().openSettings('breakpoints')
    expect(getSettings().activeSection).toBe('breakpoints')

    useEditorStore.getState().closeSettings()
    expect(getSettings().isSettingsOpen).toBe(false)

    // Re-open with no explicit section → DEFAULT_SECTION ('general')
    useEditorStore.getState().openSettings()
    const s = getSettings()
    expect(s.isSettingsOpen).toBe(true)
    expect(s.activeSection).toBe('general')
  })

  it('open → navigate → close → re-open to specific section', () => {
    useEditorStore.getState().openSettings('preferences')
    useEditorStore.getState().closeSettings()
    useEditorStore.getState().openSettings('publishing')
    const s = getSettings()
    expect(s.isSettingsOpen).toBe(true)
    expect(s.activeSection).toBe('publishing')
  })
})
