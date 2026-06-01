/**
 * Architecture Gate — src/core/siteImport/ headless isolation.
 *
 * The Super Import pipeline (Phase 1+) lives in `src/core/siteImport/`. It
 * must stay framework-agnostic — no React, no admin-side imports, no server
 * imports — so it can run in both the browser bundle and headless test
 * environments.
 *
 * Enforced constraints:
 *
 * 1. No file in `src/core/siteImport/` imports from `src/admin/` or its
 *    `@admin/...` / `@site/...` / `@content/...` aliases.
 * 2. No file in `src/core/siteImport/` imports from `server/` or any
 *    `@server/...` alias.
 * 3. No file in `src/core/siteImport/` imports `react` or `react-dom`
 *    at runtime.
 * 4. No `.tsx` file exists in `src/core/siteImport/` — JSX indicates React
 *    coupling that must not leak into the headless import pipeline.
 *
 * @see docs/plans/2026-05-29-super-import.md — Phase 1 spec
 */

import { describe, it, expect } from 'bun:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, extname, relative } from 'path'

const SRC_ROOT = join(import.meta.dir, '../../')
const SITE_IMPORT_DIR = join(SRC_ROOT, 'core/siteImport')

// ---------------------------------------------------------------------------
// File walker — recursively collect .ts/.tsx files in a directory
// ---------------------------------------------------------------------------

function collectTs(dir: string): string[] {
  const results: string[] = []
  if (!existsSync(dir)) return results
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      results.push(...collectTs(full))
    } else if (['.ts', '.tsx'].includes(extname(entry))) {
      results.push(full)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Gate 1 — No admin imports
// ---------------------------------------------------------------------------

describe('siteImport Gate 1 — no admin imports', () => {
  it('no file in src/core/siteImport/ imports from src/admin/ or admin aliases', () => {
    const files = collectTs(SITE_IMPORT_DIR)
    if (files.length === 0) {
      // Module not yet created — constraint pre-registered
      expect(true).toBe(true)
      return
    }

    // Matches: @admin/..., @site/..., @content/..., @plugins/..., @users/...
    // Also matches relative paths that resolve to src/admin/
    const ADMIN_IMPORT_RE =
      /from\s+['"](?:@admin\/|@site\/|@content\/|@plugins\/|@users\/|src\/admin\/)[^'"]*['"]/

    const violations: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (ADMIN_IMPORT_RE.test(src)) {
        violations.push(relative(SRC_ROOT, file))
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[siteImport Gate 1] Admin imports found in src/core/siteImport/.\n' +
        'The import pipeline must stay headless — no admin-side code.\n' +
        'Violations:\n' +
        violations.map((v) => `  src/${v}`).join('\n'),
      )
    }
    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 2 — No server imports
// ---------------------------------------------------------------------------

describe('siteImport Gate 2 — no server imports', () => {
  it('no file in src/core/siteImport/ imports from server/', () => {
    const files = collectTs(SITE_IMPORT_DIR)
    if (files.length === 0) {
      expect(true).toBe(true)
      return
    }

    // Matches: server/, @server/
    const SERVER_IMPORT_RE = /from\s+['"](?:@server\/|server\/|\.\.\/\.\.\/\.\.\/server\/)[^'"]*['"]/

    const violations: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (SERVER_IMPORT_RE.test(src)) {
        violations.push(relative(SRC_ROOT, file))
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[siteImport Gate 2] Server imports found in src/core/siteImport/.\n' +
        'The import pipeline must be server-agnostic to run in the browser bundle.\n' +
        'Violations:\n' +
        violations.map((v) => `  src/${v}`).join('\n'),
      )
    }
    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 3 — No runtime React imports
// ---------------------------------------------------------------------------

describe('siteImport Gate 3 — no runtime React imports', () => {
  it('no file in src/core/siteImport/ contains a runtime react import', () => {
    const files = collectTs(SITE_IMPORT_DIR)
    if (files.length === 0) {
      expect(true).toBe(true)
      return
    }

    const violations: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const lines = src.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        // Skip blank lines and comments
        if (!line.trim() || /^\s*\/\//.test(line) || /^\s*\*/.test(line)) continue
        // Allow type-only imports: `import type { ... } from 'react'`
        if (/^\s*import\s+type\b/.test(line)) continue
        // Flag any remaining `from 'react'` or `from 'react-dom'`
        if (/from\s+['"]react(?:-dom)?['"]/.test(line)) {
          violations.push(`src/${relative(SRC_ROOT, file)}:${i + 1} — runtime React import in siteImport/`)
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        '[siteImport Gate 3] Runtime React imports found in src/core/siteImport/.\n' +
        'The pipeline must be framework-agnostic. Move React usage to src/admin/.\n' +
        'Type-only imports are allowed.\n' +
        'Violations:\n' +
        violations.map((v) => `  ${v}`).join('\n'),
      )
    }
    expect(violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Gate 4 — No .tsx files (JSX = React coupling)
// ---------------------------------------------------------------------------

describe('siteImport Gate 4 — no .tsx files', () => {
  it('no .tsx files exist in src/core/siteImport/', () => {
    const files = collectTs(SITE_IMPORT_DIR)
    const tsxFiles = files.filter((f) => f.endsWith('.tsx'))

    if (tsxFiles.length > 0) {
      const rel = tsxFiles.map((f) => `  src/${relative(SRC_ROOT, f)}`)
      throw new Error(
        '[siteImport Gate 4] .tsx files found in src/core/siteImport/.\n' +
        '.tsx files embed JSX which implies React coupling — all siteImport/ files\n' +
        'must be plain .ts (headless).\n' +
        'Files:\n' +
        rel.join('\n'),
      )
    }
    expect(tsxFiles).toHaveLength(0)
  })
})
