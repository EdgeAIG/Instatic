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
import { useEffect, useRef } from 'react'
import { useEditorStore } from '@site/store/store'
import { useAdminUi } from '@admin/state/adminUi'
import { Button } from '@ui/components/Button'
import { Separator } from '@ui/components/Separator'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { SettingsCogSolidIcon } from 'pixel-art-icons/icons/settings-cog-solid'
import { FileTextSolidIcon } from 'pixel-art-icons/icons/file-text-solid'
import { SmartphoneSolidIcon } from 'pixel-art-icons/icons/smartphone-solid'
import { CommandIcon } from 'pixel-art-icons/icons/command'
import { UploadIcon } from 'pixel-art-icons/icons/upload'
import { SlidersHorizontalIcon } from 'pixel-art-icons/icons/sliders-horizontal'
import { LayoutSolidIcon } from 'pixel-art-icons/icons/layout-solid'
import { GeneralSection } from './sections/GeneralSection'
import { BreakpointsSection } from './sections/BreakpointsSection'
import { ConditionsSection } from './sections/ConditionsSection'
import { PagesSection } from './sections/PagesSection'
import { PublishingSection } from './sections/PublishingSection'
import { ShortcutsSection } from './sections/ShortcutsSection'
import { PreferencesSection } from './sections/PreferencesSection'
import s from './SettingsModal.module.css'

// ─── Nav items ────────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: 'general',     label: 'General',     icon: SettingsCogSolidIcon       },
  { id: 'pages',       label: 'Pages',       icon: FileTextSolidIcon          },
  { id: 'breakpoints', label: 'Breakpoints', icon: SmartphoneSolidIcon        },
  { id: 'conditions',  label: 'Conditions',  icon: LayoutSolidIcon            },
  { id: 'shortcuts',   label: 'Shortcuts',   icon: CommandIcon           },
  { id: 'publishing',  label: 'Publishing',  icon: UploadIcon            },
  { id: 'preferences', label: 'Preferences', icon: SlidersHorizontalIcon },
] as const

type SectionId = typeof NAV_ITEMS[number]['id']

// ─── SettingsModal ────────────────────────────────────────────────────────────

export function SettingsModal() {
  // Visibility + active section both come from the tiny `adminUi` store.
  // Whichever surface opened the modal (editor SettingsButton via adminUi,
  // spotlight `editor.openSettings` via editor store) ends up writing
  // here — see `settingsSlice.ts`'s bridge for the editor → adminUi
  // mirror and `store.ts`'s `bindSettingsBridgeStoreApi` for the reverse.
  const open = useAdminUi((state) => state.settingsOpen)
  const adminUiSection = useAdminUi((state) => state.settingsSection)
  const closeAdminUi = useAdminUi((state) => state.closeSettings)

  // Section navigation also updates the editor store's `activeSection`
  // for downstream consumers (spotlight, future editor panels). The
  // modal is lazy-loaded — this editor-store import only fires when the
  // user actually opens settings, never on first paint.
  const setSectionStore = useEditorStore((state) => state.setSettingsSection)

  const activeSection = normalizeSection(adminUiSection)
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

  // Close routes through adminUi — the editor store's `isSettingsOpen`
  // gets cleared by the bridge in `settingsSlice.ts`.
  const handleClose = () => {
    closeAdminUi()
  }

  // Update section in BOTH stores. adminUi for the modal's own selection,
  // editor's settingsSlice for downstream readers (spotlight commands).
  const openAdminUi = useAdminUi((state) => state.openSettings)
  const handleSetSection = (id: SectionId) => {
    setSectionStore(id as Parameters<typeof setSectionStore>[0])
    openAdminUi(id)
  }

  // Focus trap + Esc handler
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
  }

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
            {activeSection === 'conditions'  && <ConditionsSection />}
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
