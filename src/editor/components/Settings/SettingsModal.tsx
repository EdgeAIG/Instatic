/**
 * SettingsModal — global settings modal with left-sidebar navigation.
 *
 * Guideline #225 (Modal Shell Requirements, WCAG 2.1 AA):
 * - role="dialog" + aria-modal="true" + aria-labelledby
 * - Focus trapped inside modal while open (Tab / Shift+Tab cycle within)
 * - First interactive element receives focus on open
 * - Esc closes the modal and returns focus to the trigger element
 * - Backdrop click closes the modal
 *
 * data-testid="settings-modal" for Playwright (Guideline #221)
 */
import { useEffect, useRef, useCallback } from 'react'
import { useEditorStore } from '../../../core/editor-store/store'
import { Button } from '@ui/components/Button'
import { Separator } from '@ui/components/Separator'
import { CloseIcon } from '@ui/icons/icons/close'
import { SettingsCogIcon } from '@ui/icons/icons/settings-cog'
import { FileTextIcon } from '@ui/icons/icons/file-text'
import { SmartphoneIcon } from '@ui/icons/icons/smartphone'
import { CommandIcon } from '@ui/icons/icons/command'
import { UploadIcon } from '@ui/icons/icons/upload'
import { SlidersHorizontalIcon } from '@ui/icons/icons/sliders-horizontal'
import { GeneralSection } from './sections/GeneralSection'
import { BreakpointsSection } from './sections/BreakpointsSection'
import { PagesSection } from './sections/PagesSection'
import { PublishingSection } from './sections/PublishingSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { PreferencesSection } from './sections/PreferencesSection'
import s from './Settings.module.css'

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'general',     label: 'General',     icon: SettingsCogIcon       },
  { id: 'pages',       label: 'Pages',       icon: FileTextIcon          },
  { id: 'breakpoints', label: 'Breakpoints', icon: SmartphoneIcon        },
  { id: 'shortcuts',   label: 'Shortcuts',   icon: CommandIcon           },
  { id: 'publishing',  label: 'Publishing',  icon: UploadIcon            },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontalIcon },
] as const

type SectionId = typeof NAV_ITEMS[number]['id']

// ─── SettingsModal ────────────────────────────────────────────────────────────

export function SettingsModal() {
  // ── Primary state from settingsSlice (Phase 6) ──────────────────────────
  const isOpen    = useEditorStore((state) => state.isSettingsOpen)
  const section   = useEditorStore((state) => state.activeSection)
  const closeSettings    = useEditorStore((state) => state.closeSettings)
  const setSectionStore  = useEditorStore((state) => state.setSettingsSection)

  // ── uiSlice bridge ──────────────────────────────────────────────────────
  const uiOpen           = useEditorStore((state) => state.settingsModalOpen)
  const uiSection        = useEditorStore((state) => state.settingsModalSection)
  const openUiModal      = useEditorStore((state) => state.openSettingsModal)
  const closeUiModal     = useEditorStore((state) => state.closeSettingsModal)

  // Either slice can open the modal
  const open = isOpen || uiOpen

  // Active section: prefer settingsSlice; fall back to uiSlice section
  const activeSection = normalizeSection(isOpen ? section : uiSection)
  const dialogRef  = useRef<HTMLDivElement>(null)
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const triggerRef = useRef<HTMLElement | null>(null)

  // Focus management: capture trigger on open, restore on close (Guideline #225)
  useEffect(() => {
    if (open) {
      if (document.activeElement instanceof HTMLElement) {
        triggerRef.current = document.activeElement
      }
      requestAnimationFrame(() => {
        closeBtnRef.current?.focus()
      })
    } else {
      triggerRef.current?.focus()
      triggerRef.current = null
    }
  }, [open])

  // Close both slices
  const handleClose = useCallback(() => {
    closeSettings()
    closeUiModal()
  }, [closeSettings, closeUiModal])

  // Update section in settingsSlice
  const handleSetSection = useCallback(
    (id: SectionId) => {
      setSectionStore(id as Parameters<typeof setSectionStore>[0])
      if (uiOpen) openUiModal(id)
    },
    [openUiModal, setSectionStore, uiOpen],
  )

  // Focus trap + Esc handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        handleClose()
        return
      }

      if (e.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null)

      if (focusable.length === 0) return

      const first = focusable[0]
      const last  = focusable[focusable.length - 1]

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    },
    [handleClose],
  )

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={handleClose}
        className={s.backdrop}
      />

      {/* Dialog centering wrapper */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        aria-describedby="settings-modal-desc"
        data-testid="settings-modal"
        onKeyDown={handleKeyDown}
        className={s.dialogWrapper}
      >
        <div className={s.dialog}>
          {/* Screen-reader description */}
          <p id="settings-modal-desc" className={s.srOnly}>
            Site-level configuration. Press Escape to close.
          </p>
          {/* WCAG 2.4.7 — visible focus ring on inputs inside the modal */}
          <style>{`
            [data-testid="settings-modal"] input:focus-visible,
            [data-testid="settings-modal"] select:focus-visible,
            [data-testid="settings-modal"] textarea:focus-visible {
              outline: none;
              box-shadow: inset 0 0 0 2px rgba(255,255,255,0.3);
              border-color: rgba(255,255,255,0.2);
            }
          `}</style>

          {/* ── Left sidebar ──────────────────────────────────────────────── */}
          <div className={s.sidebar}>
            <nav
              aria-label="Settings sections"
              className={s.sidebarNav}
            >
              <h2
                id="settings-modal-title"
                className={s.sidebarTitle}
              >
                Settings
              </h2>

              {NAV_ITEMS.map((item) => (
                <SettingsNavButton
                  key={item.id}
                  item={item}
                  active={activeSection === item.id}
                  onClick={() => handleSetSection(item.id)}
                />
              ))}
            </nav>

            {/* Close button lives OUTSIDE <nav> */}
            <Separator spacing="none" />
            <Button
              ref={closeBtnRef}
              variant="ghost"
              size="lg"
              fullWidth
              type="button"
              onClick={handleClose}
              aria-label="Close settings"
            >
              <CloseIcon size={12} color="currentColor" aria-hidden="true" />
              Close
            </Button>
          </div>

          {/* ── Right content area ──────────────────────────────────────── */}
          <div
            role="region"
            aria-label={NAV_ITEMS.find((n) => n.id === activeSection)?.label}
            className={s.content}
          >
            {activeSection === 'general'     && <GeneralSection />}
            {activeSection === 'pages'       && <PagesSection />}
            {activeSection === 'breakpoints' && <BreakpointsSection />}
            {activeSection === 'shortcuts'   && <ShortcutsSection />}
            {activeSection === 'publishing'  && <PublishingSection />}
            {activeSection === 'preferences' && <PreferencesSection />}
          </div>
        </div>
      </div>
    </>
  )
}

function normalizeSection(section: string | null | undefined): SectionId {
  return NAV_ITEMS.some((item) => item.id === section) ? (section as SectionId) : 'general'
}

function SettingsNavButton({
  item,
  active,
  onClick,
}: {
  item: (typeof NAV_ITEMS)[number]
  active: boolean
  onClick: () => void
}) {
  const NavIcon = item.icon
  return (
    <Button
      variant="ghost"
      size="lg"
      navItem
      active={active}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={s.navItem}
    >
      <NavIcon size={14} aria-hidden="true" />
      {item.label}
    </Button>
  )
}
