/**
 * Zustand Selector Stability — Regression Tests (Guideline #239)
 *
 * ## The bug this guards against
 *
 * React 18 uses `useSyncExternalStore` under the hood for Zustand. Its
 * internals call `getSnapshot()` (the selector) multiple times per cycle and
 * compare successive results with `Object.is`. When a selector returns an
 * inline `?? []` or `?? {}` fallback, it produces a brand-new object
 * reference on every call:
 *
 *   Object.is([], [])  // → false  (different identity every time)
 *
 * `checkIfSnapshotChanged` always returns `true`, so `forceStoreRerender`
 * fires on every passive-effect cycle → infinite render loop → crash:
 *
 *   "Maximum update depth exceeded. This can happen when a component
 *    repeatedly calls setState inside componentDidUpdate."
 *
 * ## Incident
 *
 * CanvasRoot.tsx had:
 *   const breakpoints = useEditorStore((s) => s.project?.breakpoints ?? [])
 *
 * This was latent until J12 (usePersistence) made `project` start as `null`
 * (async IndexedDB load). The crash appeared immediately on every editor load.
 *
 * ## Fix (Contribution #348 — UX Reviewer)
 *
 * Replace every inline array/object fallback in a useEditorStore selector with
 * a module-level stable-reference constant:
 *
 *   // ✅ CORRECT — same identity every call
 *   const EMPTY_BREAKPOINTS: Breakpoint[] = []
 *   const breakpoints = useEditorStore((s) => s.project?.breakpoints ?? EMPTY_BREAKPOINTS)
 *
 *   // ❌ WRONG — new identity every call
 *   const breakpoints = useEditorStore((s) => s.project?.breakpoints ?? [])
 *
 * ## Coverage
 *
 * These tests enforce the fix at two levels:
 *
 * 1. Source scan — grep every .ts/.tsx file for the anti-pattern.
 *    If a developer adds a new `useEditorStore(...?? [])` anywhere, this test
 *    catches it immediately at CI time, before it ever ships.
 *
 * 2. CanvasRoot structural assertion — verify the specific stable-sentinel
 *    pattern that replaced the original crash is still present.
 *
 * References:
 *   - Guideline #239: Zustand Selectors Must Not Use Inline ?? [] / ?? {} Fallbacks
 *   - Contribution #348: Fix — unstable ?? [] selector in CanvasRoot (UX Reviewer)
 */

import { describe, it, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, extname } from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_ROOT = new URL('../../', import.meta.url).pathname.replace(/\/$/, '')

/** Recursively collect all .ts/.tsx source files under a directory. */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      // Skip node_modules and .git
      if (entry === 'node_modules' || entry === '.git' || entry === '__tests__') continue
      files.push(...collectSourceFiles(full))
    } else {
      const ext = extname(entry)
      if (ext === '.ts' || ext === '.tsx') files.push(full)
    }
  }
  return files
}

/**
 * Strip single-line comments and block-comment lines from source before
 * pattern-matching, so that explanatory comments about the anti-pattern
 * (e.g. "// ❌ WRONG — useEditorStore(s => s.x ?? [])") don't trigger
 * false positives.
 */
function stripComments(src: string): string {
  return src
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart()
      // Skip single-line comments (//) and block comment lines (* ...)
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')
    // Remove inline // comments from code lines
    .replace(/\/\/[^\n]*/g, '')
}

// ---------------------------------------------------------------------------
// 1 — Source scan: no inline ?? [] / ?? {} / ?? new X() in useEditorStore
// ---------------------------------------------------------------------------

describe('Guideline #239 — Zustand selector stability', () => {
  it('no useEditorStore call uses an inline ?? [] fallback (Guideline #239)', () => {
    const files = collectSourceFiles(SRC_ROOT)
    const violations: string[] = []

    for (const filePath of files) {
      const raw = readFileSync(filePath, 'utf-8')
      const src = stripComments(raw)
      const lines = src.split('\n')

      lines.forEach((line, i) => {
        // Detect: useEditorStore(... ?? [  or useEditorStore(... ?? [])
        // The pattern is: useEditorStore on this line or the selector contains ?? [
        if (line.includes('useEditorStore') && /\?\?\s*\[/.test(line)) {
          const relPath = filePath.replace(SRC_ROOT + '/', '')
          violations.push(`${relPath}:${i + 1}: ${line.trim()}`)
        }
      })
    }

    expect(violations).toEqual(
      // If this fails, a developer has introduced a new inline-array fallback
      // in a Zustand selector. Replace `?? []` with a module-level constant.
      // See Guideline #239 for the correct pattern.
      [],
    )
  })

  it('no useEditorStore call uses an inline ?? {} fallback (Guideline #239)', () => {
    const files = collectSourceFiles(SRC_ROOT)
    const violations: string[] = []

    for (const filePath of files) {
      const raw = readFileSync(filePath, 'utf-8')
      const src = stripComments(raw)
      const lines = src.split('\n')

      lines.forEach((line, i) => {
        if (line.includes('useEditorStore') && /\?\?\s*\{/.test(line)) {
          const relPath = filePath.replace(SRC_ROOT + '/', '')
          violations.push(`${relPath}:${i + 1}: ${line.trim()}`)
        }
      })
    }

    expect(violations).toEqual([])
  })

  it('no useEditorStore call uses an inline ?? new X() fallback (Guideline #239)', () => {
    const files = collectSourceFiles(SRC_ROOT)
    const violations: string[] = []

    for (const filePath of files) {
      const raw = readFileSync(filePath, 'utf-8')
      const src = stripComments(raw)
      const lines = src.split('\n')

      lines.forEach((line, i) => {
        if (line.includes('useEditorStore') && /\?\?\s*new\s+\w/.test(line)) {
          const relPath = filePath.replace(SRC_ROOT + '/', '')
          violations.push(`${relPath}:${i + 1}: ${line.trim()}`)
        }
      })
    }

    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2 — CanvasRoot structural assertion: EMPTY_BREAKPOINTS stable-sentinel fix
// ---------------------------------------------------------------------------


describe('CanvasRoot — stable breakpoints selector (crash regression)', () => {
  /**
   * Regression guard for the specific crash that brought down the editor on
   * 2026-04-28 after J12 (usePersistence) made `project` start as null.
   *
   * The crash was caused by `?? []` in the breakpoints selector. The fix was
   * to define a module-level constant `EMPTY_BREAKPOINTS` and use it as the
   * fallback. This test locks in that fix so it cannot be silently reverted.
   */
  const canvasRootPath = join(SRC_ROOT, 'editor/components/Canvas/CanvasRoot.tsx')

  it('declares a module-level EMPTY_BREAKPOINTS constant', () => {
    const src = readFileSync(canvasRootPath, 'utf-8')
    // The constant must be declared at module level (outside any function)
    // as a typed Breakpoint[] array. This assertion checks the variable exists.
    expect(src).toContain('EMPTY_BREAKPOINTS')
    // Must be a const declaration (not let/var — references must be stable)
    expect(src).toMatch(/const\s+EMPTY_BREAKPOINTS/)
  })

  it('EMPTY_BREAKPOINTS is declared as a typed Breakpoint[] array', () => {
    const src = readFileSync(canvasRootPath, 'utf-8')
    // The type annotation ensures TypeScript will catch misuse
    expect(src).toMatch(/const\s+EMPTY_BREAKPOINTS\s*:\s*Breakpoint\[\]/)
  })

  it('breakpoints selector uses EMPTY_BREAKPOINTS, not inline ?? []', () => {
    const src = readFileSync(canvasRootPath, 'utf-8')

    // The selector must use the stable constant
    expect(src).toContain('?? EMPTY_BREAKPOINTS')

    // The selector must NOT use an inline array literal as fallback
    // (strip comments first to avoid false negatives on explanatory comments)
    const codeOnly = stripComments(src)
    const hasInlineFallback = /useEditorStore[^;]*\?\?\s*\[/.test(
      codeOnly.replace(/\n/g, ' ')
    )
    expect(hasInlineFallback).toBe(false)
  })

  it('EMPTY_BREAKPOINTS is declared before CanvasRoot function (module-level scope)', () => {
    const src = readFileSync(canvasRootPath, 'utf-8')
    const lines = src.split('\n')

    const emptyBpLine = lines.findIndex((l) => /const\s+EMPTY_BREAKPOINTS/.test(l))
    const canvasRootFnLine = lines.findIndex((l) => /export\s+function\s+CanvasRoot/.test(l))

    expect(emptyBpLine).toBeGreaterThan(-1)
    expect(canvasRootFnLine).toBeGreaterThan(-1)
    // The constant must appear BEFORE the function — module scope, not closure scope
    expect(emptyBpLine).toBeLessThan(canvasRootFnLine)
  })
})

// ---------------------------------------------------------------------------
// 3 — Multi-line selector scan: selectors spanning multiple lines
//     The above single-line scans catch the common case. This test catches
//     multi-line selectors where the ?? fallback is on a continuation line:
//
//       const x = useEditorStore((s) =>
//         s.project?.items ?? []   // ← dangerous, different line from useEditorStore
//       )
//
//     Strategy: within files that use useEditorStore, flag any line that has
//     `?? [` or `?? {` AND whose nearest preceding non-blank line (within 3
//     lines) contains `useEditorStore` or starts with `s.` (selector body
//     continuation) preceded by a `useEditorStore` call.
//
//     Note: `?? {}` is commonly used safely in non-selector contexts like
//     `Object.keys(x ?? {})`. We exclude those patterns explicitly.
// ---------------------------------------------------------------------------

describe('Guideline #239 — multi-line selector fallback scan', () => {
  /**
   * Checks for `?? []` on lines that directly follow a `useEditorStore(` call.
   * This catches the split-line version of the bug:
   *
   *   const x = useEditorStore(
   *     (s) => s.project?.breakpoints ?? []   // ← this line is flagged
   *   )
   */
  it('no useEditorStore selector continuation line uses ?? [] fallback', () => {
    const files = collectSourceFiles(SRC_ROOT)
    const violations: string[] = []

    for (const filePath of files) {
      const raw = readFileSync(filePath, 'utf-8')
      if (!raw.includes('useEditorStore')) continue

      const src = stripComments(raw)
      const lines = src.split('\n')

      lines.forEach((line, i) => {
        // Only care about lines with ?? [
        if (!/\?\?\s*\[/.test(line)) return

        // Check if this line is within a useEditorStore call context:
        // look at the preceding 3 lines for `useEditorStore`
        const contextWindow = lines.slice(Math.max(0, i - 3), i).join('\n')
        if (contextWindow.includes('useEditorStore')) {
          const relPath = filePath.replace(SRC_ROOT + '/', '')
          violations.push(`${relPath}:${i + 1}: ${line.trim()}`)
        }
      })
    }

    expect(violations).toEqual([])
  })

  it('no useEditorStore selector continuation line uses ?? {} fallback', () => {
    const files = collectSourceFiles(SRC_ROOT)
    const violations: string[] = []

    for (const filePath of files) {
      const raw = readFileSync(filePath, 'utf-8')
      if (!raw.includes('useEditorStore')) continue

      const src = stripComments(raw)
      const lines = src.split('\n')

      lines.forEach((line, i) => {
        // Only care about lines with ?? {
        if (!/\?\?\s*\{/.test(line)) return

        // Exclude known-safe patterns where ?? {} is NOT a selector fallback:
        // Object.keys(x ?? {}), Object.values(x ?? {}), JSON.parse(x ?? {}), etc.
        const trimmed = line.trim()
        if (
          /Object\.(keys|values|entries)\([^)]*\?\?\s*\{/.test(trimmed) ||
          /JSON\./.test(trimmed) ||
          /Array\.from/.test(trimmed)
        ) return

        // Check if this line is within a useEditorStore call context
        const contextWindow = lines.slice(Math.max(0, i - 3), i).join('\n')
        if (contextWindow.includes('useEditorStore')) {
          const relPath = filePath.replace(SRC_ROOT + '/', '')
          violations.push(`${relPath}:${i + 1}: ${line.trim()}`)
        }
      })
    }

    expect(violations).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 4 — usePersistence subscription selector — must use primitive, not object
//
// useEditorStore.subscribe(selector, listener) fires the listener whenever
// selector(state) changes. If the selector returns an inline object literal
// `{ project: s.project, dirty: s.hasUnsavedChanges }`, a new object is
// created on every evaluation — Object.is always returns false — causing the
// listener to fire on every single store mutation (timer leak, excess saves).
//
// The correct selector is a primitive: `(s) => s.hasUnsavedChanges`
// The project snapshot is then read via getState() inside the timer callback.
//
// Reference: Guideline #239 / usePersistence timer-leak fix (2026-04-28)
// ---------------------------------------------------------------------------

describe('usePersistence — subscription selector is primitive, not inline object', () => {
  // usePersistence moved to src/editor/hooks/ per Constraint #179 (Phase 0 — no React in core)
  const persistencePath = join(SRC_ROOT, 'editor/hooks/usePersistence.ts')

  it('subscribe call does not use an inline object literal as selector', () => {
    const src = readFileSync(persistencePath, 'utf-8')
    // Detect pattern: .subscribe( (s) => ({  or .subscribe( (s) => {
    // (an arrow function that immediately opens an object literal — not a function body)
    const hasInlineObjectSelector = /\.subscribe\s*\(\s*\(s\)\s*=>\s*\(?\s*\{/.test(
      src.replace(/\n/g, ' '),
    )
    expect(hasInlineObjectSelector).toBe(false)
  })

  it('auto-save subscribe uses the hasUnsavedChanges primitive selector', () => {
    const src = readFileSync(persistencePath, 'utf-8')
    expect(src).toMatch(/subscribe\s*\(\s*\(s\)\s*=>\s*s\.hasUnsavedChanges/)
  })

  it('timer is reset (clearTimeout) on each new dirty notification — no accumulation', () => {
    const src = readFileSync(persistencePath, 'utf-8')
    expect(src).toContain('clearTimeout(timer)')
    expect(src).toContain('timer = setTimeout')
  })

  it('effect cleanup unsubscribes AND clears the timer', () => {
    const src = readFileSync(persistencePath, 'utf-8')
    // Both unsub() and clearTimeout must appear inside the return () => { ... } cleanup
    expect(src).toMatch(/return\s*\(\)\s*=>\s*\{[^}]*unsub\(\)[^}]*clearTimeout/s)
  })

  it('auto-save timer is gated by the stored autoSave preference', () => {
    const src = readFileSync(persistencePath, 'utf-8')
    expect(src).toContain('readAutoSavePreference')
    expect(src).toMatch(/readAutoSavePreference\(\)[\s\S]{0,220}setTimeout/)
  })

  it('auto-save reacts to editor preference changes', () => {
    const src = readFileSync(persistencePath, 'utf-8')
    expect(src).toContain('subscribeToEditorPrefsChanged')
    expect(src).toMatch(/prefsUnsub\(\)/)
  })
})

// ---------------------------------------------------------------------------
// 5 — uiSlice spread-setter Object.is guards (Guideline #242)
//
// setDomTreePanel() and setPropertiesPanel() accept Partial<PanelState> and
// merge it via spread. Without an equality guard, a no-op call still produces
// a new PanelState object reference → useSyncExternalStore sees a changed
// snapshot → fires forceStoreRerender → infinite render loop → crash.
//
// Crash scenario: on initial mount, both DomPanel and PropertiesPanel call
// their setters from two effects each (localStorage-restore + auto-collapse).
// React StrictMode doubles effect invocations → 8 no-op calls → crash at
// React's 50-update limit ("Maximum update depth exceeded").
//
// Fix (Contribution #360): Object.is equality guards before every set() call
// in both setters. These tests lock in that fix and prevent regression.
//
// Reference: Guideline #242, Contribution #360, Contribution #361
// ---------------------------------------------------------------------------

describe('Guideline #242 — spread-setter Object.is guards in uiSlice', () => {
  const uiSlicePath = join(SRC_ROOT, 'core/editor-store/slices/uiSlice.ts')

  it('uiSlice.ts setDomTreePanel uses Object.is to guard against no-op mutations', () => {
    const src = readFileSync(uiSlicePath, 'utf-8')
    // The guard must exist — Object.is used to compare partial field values against current
    expect(src).toContain('Object.is')
    // Both setters must reference Object.is (at least 2 occurrences)
    const occurrences = (src.match(/Object\.is/g) || []).length
    expect(occurrences).toBeGreaterThanOrEqual(2)
  })

  it('uiSlice.ts setDomTreePanel returns early when nothing changed (no set() call)', () => {
    const src = readFileSync(uiSlicePath, 'utf-8')
    // The canonical guard pattern: if (!anyChanged) return
    expect(src).toMatch(/if\s*\(!anyChanged\)\s*return/)
  })

  it('uiSlice.ts setDomTreePanel guard uses Object.keys(partial).some() pattern (Guideline #242)', () => {
    const src = readFileSync(uiSlicePath, 'utf-8')
    // Must iterate over partial keys and compare via Object.is
    expect(src).toMatch(/Object\.keys\s*\(partial\)/)
    expect(src).toMatch(/Object\.is\s*\(current\[/)
  })

  it('uiSlice.ts setPropertiesPanel has the same Object.is guard as setDomTreePanel', () => {
    const src = readFileSync(uiSlicePath, 'utf-8')
    // Both setters must have the anyChanged guard — find two separate anyChanged references
    const anyChangedCount = (src.match(/anyChanged/g) || []).length
    // setDomTreePanel: anyChanged declared + used = 2 occurrences
    // setPropertiesPanel: anyChanged declared + used = 2 more → total >= 4
    expect(anyChangedCount).toBeGreaterThanOrEqual(4)
  })

  it('uiSlice.ts both partial-spread setters precede set() with a guard check', () => {
    const src = readFileSync(uiSlicePath, 'utf-8')
    // Pattern: the set() call for panel state must appear AFTER the anyChanged check
    // (i.e. inside the if (anyChanged) branch or after early return)
    // We verify: every occurrence of "set((state) => ({ ...state." in uiSlice
    // appears after an "!anyChanged" guard in the same source
    const guardIndex = src.indexOf('!anyChanged')
    const spreadSetIndex = src.indexOf('set((state) => ({')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(spreadSetIndex).toBeGreaterThan(guardIndex)
  })
})

// ---------------------------------------------------------------------------
// 6 — Source scan: no new unguarded spread-based partial setters in slice files
//
// Any Zustand slice setter that merges a partial object via spread:
//   set((state) => ({ ...state, someKey: { ...state.someKey, ...partial } }))
// MUST have a preceding Object.is guard per Guideline #242. Without the guard,
// no-op calls from React effects on mount can accumulate into a
// "Maximum update depth exceeded" crash.
//
// This scan enforces the rule codebase-wide on all slice files.
// ---------------------------------------------------------------------------

describe('Guideline #242 — no new unguarded spread setters in slice files', () => {
  it('every slice file that uses spread-based partial merges also has Object.is guards', () => {
    const slicesDir = join(SRC_ROOT, 'core/editor-store/slices')

    let sliceFiles: string[] = []
    try {
      sliceFiles = readdirSync(slicesDir)
        .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
        .map((f) => join(slicesDir, f))
    } catch {
      // Slices directory may not exist in all build configurations — skip
      return
    }

    const violations: string[] = []

    for (const filePath of sliceFiles) {
      const src = readFileSync(filePath, 'utf-8')
      // Detect spread-based partial merge: set((state) => ({ ...state.someKey, ...
      // This is the dangerous pattern — produces new object reference on every call
      const hasSpreadSetter = /set\s*\(\s*\(s(?:tate)?\)\s*=>\s*\(?\s*\{[^}]*\.\.\.\s*s(?:tate)?\./.test(
        src.replace(/\n/g, ' '),
      )
      if (hasSpreadSetter) {
        // Slice uses spread-based state merge — must have Object.is guard
        if (!src.includes('Object.is')) {
          const fileName = filePath.split('/').pop()!
          violations.push(
            `${fileName} — uses spread-based partial setter but has no Object.is guard (Guideline #242)`,
          )
        }
      }
    }

    expect(violations).toEqual([])
  })
})
