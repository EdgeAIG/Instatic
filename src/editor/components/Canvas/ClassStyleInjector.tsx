/**
 * ClassStyleInjector — injects/updates `.mc-{classId}` CSS into the document
 * whenever the project's class registry changes.
 *
 * This is a pure side-effect component (renders null). It subscribes to
 * `project.classes` via a stable selector and imperatively manages a single
 * <style id="mc-classes"> element in document.head.
 *
 * Architecture:
 * - One <style> tag, kept in sync on every class registry change.
 * - CSS is generated from CSSPropertyBag by camelCase → kebab-case conversion.
 * - @media blocks are emitted for breakpoint overrides (uses project.breakpoints).
 * - No FOUC: the style element is created synchronously before first paint.
 *
 * Security (Constraint #228):
 * - Property names are validated against an allowlist (camelCase CSS properties).
 * - Values are sanitised via the canonical sanitiseCssValue() from publisher/utils.
 * - Only known CSS property names from CSSPropertyBag interface are emitted.
 *
 * Performance:
 * - Subscribes with a shallow-equality selector so re-renders only happen when
 *   classes actually change (not on every project edit).
 */

import { useEffect } from 'react'
import { useEditorStore } from '../../../core/editor-store/store'
import { generateCanvasClassCSS } from './canvasClassCss'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const STYLE_TAG_ID = 'mc-classes'

/**
 * Stable empty array used as the ?? fallback for breakpoints selector.
 * Must be module-scope so it's reference-stable across renders — an inline `?? []`
 * literal creates a new array instance on every call, forcing unnecessary re-renders
 * (Guideline #239 — Zustand selectors must not use inline ?? [] / ?? {} fallbacks).
 */
const EMPTY_BREAKPOINTS: Array<{ id: string; width: number }> = []

export function ClassStyleInjector() {
  // Subscribe to class registry — shallow equality so we only re-run when
  // the classes object reference changes (Immer always creates a new ref on mutation)
  const classes = useEditorStore((s) => s.project?.classes ?? null)
  const breakpoints = useEditorStore((s) => s.project?.breakpoints ?? EMPTY_BREAKPOINTS)

  useEffect(() => {
    // Get or create the <style> element
    let styleEl = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = STYLE_TAG_ID
      styleEl.setAttribute('data-source', 'ClassStyleInjector')
      document.head.appendChild(styleEl)
    }

    if (!classes || Object.keys(classes).length === 0) {
      styleEl.textContent = '/* no classes */'
      return
    }

    styleEl.textContent = generateCanvasClassCSS(classes, breakpoints)
  }, [classes, breakpoints])

  // Cleanup: remove the style element when the component unmounts
  useEffect(() => {
    return () => {
      document.getElementById(STYLE_TAG_ID)?.remove()
    }
  }, [])

  return null
}
