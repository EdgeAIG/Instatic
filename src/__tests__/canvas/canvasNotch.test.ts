import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'

const CANVAS_ROOT = new URL('../../editor/components/Canvas/CanvasRoot.tsx', import.meta.url)
const CANVAS_NOTCH = new URL('../../editor/components/Canvas/CanvasNotch.tsx', import.meta.url)
const CANVAS_NOTCH_CSS = new URL('../../editor/components/Canvas/CanvasNotch.module.css', import.meta.url)
const TOOLBAR = new URL('../../editor/components/Toolbar/Toolbar.tsx', import.meta.url)
const SELECTION_OVERLAY = new URL('../../editor/components/Canvas/SelectionOverlay.tsx', import.meta.url)

describe('CanvasNotch', () => {
  it('is rendered by CanvasRoot as fixed canvas chrome', () => {
    const src = readFileSync(CANVAS_ROOT, 'utf-8')

    expect(src).toContain('CanvasNotch')
    expect(src).toContain('<CanvasNotch />')
  })

  it('exposes the approved quick insert actions', () => {
    const src = readFileSync(CANVAS_NOTCH, 'utf-8')

    expect(src).toContain("moduleId: 'base.container'")
    expect(src).toContain("icon: 'checkbox-sharp'")
    expect(src).toContain("moduleId: 'base.text'")
    expect(src).toContain("moduleId: 'base.image'")
    expect(src).toContain("icon: 'image'")
    expect(src).toContain("moduleId: 'base.button'")
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

  it('removes the floating Duplicate/Delete selection toolbar', () => {
    const src = readFileSync(SELECTION_OVERLAY, 'utf-8')

    expect(src).not.toContain('Duplicate selected element')
    expect(src).not.toContain('Delete selected element')
    expect(src).not.toContain('role="toolbar"')
  })
})
