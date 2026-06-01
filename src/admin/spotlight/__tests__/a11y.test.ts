/**
 * Spotlight a11y smoke tests.
 *
 * Keep this focused: row id behavior is real logic; source scanning is limited
 * to one coarse markup smoke because detailed per-attribute source tests mostly
 * duplicate the component source one string at a time.
 */

import { describe, it, expect } from 'bun:test'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { rowId, computeHighlightedRowId } from '../spotlightSearch'

// ─── Paths ────────────────────────────────────────────────────────────────────

const spotlightDir = resolve(import.meta.dir, '..')

function readSrc(filename: string): string {
  return readFileSync(resolve(spotlightDir, filename), 'utf-8')
}

// ─── rowId() format ───────────────────────────────────────────────────────────

describe('Spotlight row ids', () => {
  it('creates stable id-safe row ids for dotted command ids', () => {
    expect(rowId('editor.save')).toBe('spotlight-row-editor-save')
    expect(rowId('editor.pages.add')).toBe('spotlight-row-editor-pages-add')
    expect(rowId('navigation.goToSite')).toMatch(/^spotlight-row-/)
    expect(rowId('some.deeply.nested.command')).not.toContain('.')
  })
})

// ─── computeHighlightedRowId() ────────────────────────────────────────────────

describe('computeHighlightedRowId()', () => {
  it('returns null for no match or out-of-range highlight', () => {
    const result = computeHighlightedRowId(
      'xyzzy-no-match-zznm-999',
      null,
      0,
      'root',
      {},
    )
    expect(result).toBeNull()
    expect(computeHighlightedRowId('save', null, 9999, 'root', {})).toBeNull()
  })

  it('returns an id-safe row id for a matching highlighted command', () => {
    const result = computeHighlightedRowId('save', null, 0, 'root', {})
    expect(result).toMatch(/^spotlight-row-/)
    expect(result).not.toContain('.')
  })
})

describe('Spotlight markup source smoke', () => {
  it('keeps the core dialog/listbox/option ARIA wiring present', () => {
    expect(readSrc('Spotlight.tsx')).toEqual(expect.stringContaining('role="dialog"'))
    expect(readSrc('Spotlight.tsx')).toEqual(expect.stringContaining('aria-controls={listboxId}'))
    expect(readSrc('SpotlightResults.tsx')).toEqual(expect.stringContaining('role="listbox"'))
    expect(readSrc('SpotlightRow.tsx')).toEqual(expect.stringContaining('role="option"'))
    expect(readSrc('SpotlightRow.tsx')).toEqual(expect.stringContaining('aria-selected={isHighlighted}'))
  })
})
