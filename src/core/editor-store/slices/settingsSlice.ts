/**
 * settingsSlice — Phase 0 canonical slice for settings modal state.
 *
 * Owns the settings modal open/close state and the active section navigation.
 * This is UI-only state that must NOT trigger site autosave — it lives here,
 * not in siteSlice.
 *
 * Canonical Phase 0 fields (Contribution #457 / Guideline #193):
 *   - isSettingsOpen   — whether the settings modal is currently open
 *   - activeSection    — which nav section is displayed ('pages', 'breakpoints', etc.)
 *
 * Phase 6 (Task #183) will expand this slice with per-section state, keyboard
 * shortcut registry integration (Guideline #298), and any persisted preferences.
 *
 * @see Contribution #457 — Phase 0 Architectural Specification
 * @see Guideline #193    — Zustand Store Slice Guidelines
 * @see Guideline #323    — Phase 6 Settings Modal: Performance Patterns
 * @see Guideline #324    — Phase 6 Settings Modal: Implementation Architecture
 */

import type { StateCreator } from 'zustand'
import type { EditorStore } from '../store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SettingsSection =
  | 'general'
  | 'pages'
  | 'breakpoints'
  | 'preferences'
  | 'shortcuts'
  | 'publishing'
  | 'modules'

export interface SettingsSlice {
  /** Whether the settings modal is currently open */
  isSettingsOpen: boolean

  /** The active settings nav section */
  activeSection: SettingsSection

  /** Open the settings modal, optionally jumping to a section */
  openSettings: (section?: SettingsSection) => void

  /** Close the settings modal */
  closeSettings: () => void

  /** Navigate to a different section within the open modal */
  setSettingsSection: (section: SettingsSection) => void
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

const DEFAULT_SECTION: SettingsSection = 'general'

// ---------------------------------------------------------------------------
// Slice factory
// ---------------------------------------------------------------------------

export const createSettingsSlice: StateCreator<EditorStore, [], [], SettingsSlice> = (set) => ({
  isSettingsOpen: false,
  activeSection: DEFAULT_SECTION,

  openSettings: (section = DEFAULT_SECTION) =>
    set({ isSettingsOpen: true, activeSection: section }),

  closeSettings: () =>
    set({ isSettingsOpen: false }),

  setSettingsSection: (section) =>
    set({ activeSection: section }),
})
