import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'

const CANVAS_ROOT = new URL('../../admin/pages/site/canvas/CanvasRoot.tsx', import.meta.url)
const CANVAS_NOTCH = new URL('../../admin/pages/site/canvas/CanvasNotch.tsx', import.meta.url)
const CANVAS_NOTCH_CSS = new URL('../../admin/pages/site/canvas/CanvasNotch.module.css', import.meta.url)
const TOOLBAR = new URL('../../admin/pages/site/toolbar/Toolbar.tsx', import.meta.url)
const MODULE_PICKER = new URL('../../admin/pages/site/toolbar/ModulePickerDropdown.tsx', import.meta.url)

describe('CanvasNotch', () => {
  it('is rendered by CanvasRoot as fixed canvas chrome', () => {
    const src = readFileSync(CANVAS_ROOT, 'utf-8')

    expect(src).toContain('CanvasNotch')
    expect(src).toContain('<CanvasNotch')
    expect(src).toContain('floatingControl=')
  })

  it('resolves quick insert actions from module inserter favorites', () => {
    const src = readFileSync(CANVAS_NOTCH, 'utf-8')

    // Icons come from each module's own declaration via the shared ModuleIcon
    // resolver — the notch must not duplicate the icon mapping locally.
    expect(src).toContain('ModuleIcon')
    expect(src).not.toContain('pixel-art-icons/icons/checkbox-sharp')
    expect(src).not.toContain('pixel-art-icons/icons/text-start-t')
    expect(src).not.toContain('pixel-art-icons/icons/image-solid')

    expect(src).not.toContain('QUICK_ACTION_MODULE_IDS')
    expect(src).toContain('useModuleInserterPreference')
    expect(src).toContain('DEFAULT_MODULE_INSERTER_FAVORITES')
    expect(src).toContain('resolveInserterRefs')

    expect(src).toContain('canvas-notch-add-btn')
  })

  it('does not draw real side borders through the inverted-corner seam', () => {
    const css = readFileSync(CANVAS_NOTCH_CSS, 'utf-8')

    expect(css).toContain('border: 0')
    expect(css).not.toContain('border: 1px solid')
    expect(css).not.toContain('border-top: 0')
    expect(css).toContain('left: calc(2px - var(--notch-corner))')
    expect(css).toContain('right: calc(2px - var(--notch-corner))')
  })

  it('moves the Add picker out of the top toolbar', () => {
    const src = readFileSync(TOOLBAR, 'utf-8')

    expect(src).not.toContain('ModulePickerDropdown')
    expect(src).not.toContain('toolbar-add-module-btn')
  })

  it('hosts the Undo/Redo controls so they only appear on the visual editor canvas', () => {
    const src = readFileSync(CANVAS_NOTCH, 'utf-8')
    const toolbar = readFileSync(TOOLBAR, 'utf-8')

    // Undo/Redo lives next to the quick-insert icons, separated by a divider.
    expect(src).toContain('UndoRedoButtons')
    expect(src).toContain('styles.divider')
    expect(src).toContain('showHistoryControls')

    // The shared admin toolbar must NOT render undo/redo — those controls
    // make no sense on Content / Plugins admin pages where there is no
    // editor page tree to mutate.
    expect(toolbar).not.toContain('UndoRedoButtons')
  })

  it('moves the Add picker trigger to an icon-only chip (no "Add" label text)', () => {
    const picker = readFileSync(MODULE_PICKER, 'utf-8')

    // The trigger is icon-only — only the AppGridPlusGlyphIcon is rendered
    // (the same icon used by the "Insert module here" right-click submenu, so
    // the two affordances read as the same action).
    expect(picker).toContain('iconOnly')
    expect(picker).toContain('<AppGridPlusGlyphIcon size={13} />')
    // The literal "Add" text inside the trigger button is gone. The aria-label
    // and tooltip describe the dialog action for screen readers.
    expect(picker).toContain('aria-label="Add to canvas"')
    expect(picker).not.toMatch(/<AppGridPlusGlyphIcon[^>]*\/>\s*Add\s*<\/Button>/)
  })
})
