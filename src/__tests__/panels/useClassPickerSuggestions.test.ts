/**
 * Unit tests for `useClassPickerSuggestions`.
 *
 * The hook is a pure-derivation function with no React-specific surface
 * (no `useState`, no `useEffect`), so we exercise it as plain code rather
 * than rendering it. The `readUsage` injection lets each test stand up its
 * own usage history without touching localStorage.
 *
 * Coverage: empty/typed query branching, recent/frequent surfacing,
 * "All classes" section threshold, exact-match vs create-new vs already-
 * assigned dispatch, Arrow-Up/Down highlight clamping, and the submit-
 * tooltip priority order.
 */
import { describe, expect, it } from 'bun:test'
import { useClassPickerSuggestions } from '@site/panels/PropertiesPanel/useClassPickerSuggestions'
import type { StyleRule } from '@core/page-tree'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeClass(name: string, id = `cls-${name}`): StyleRule {
  return {
    id,
    name,
    styles: {},
    contextStyles: {},
    createdAt: 0,
    updatedAt: 0,
  }
}

const NO_USAGE = () => ({})

// ---------------------------------------------------------------------------
// Empty-query branch
// ---------------------------------------------------------------------------

describe('useClassPickerSuggestions — empty query', () => {
  it('returns the candidates list (allClasses minus assigned) when query is empty', () => {
    const allClasses = [makeClass('foo'), makeClass('bar'), makeClass('baz')]
    const result = useClassPickerSuggestions({
      allClasses,
      assignedIds: ['cls-bar'],
      query: '',
      highlightedIndex: -1,
      readUsage: NO_USAGE,
    })

    expect(result.isEmptyQuery).toBe(true)
    expect(result.candidates.map((c) => c.name)).toEqual(['foo', 'baz'])
    expect(result.filteredSuggestions.map((c) => c.name)).toEqual(['foo', 'baz'])
  })

  it('shows the "All classes" section when usage history is empty', () => {
    const allClasses = [makeClass('foo'), makeClass('bar')]
    const result = useClassPickerSuggestions({
      allClasses,
      assignedIds: [],
      query: '',
      highlightedIndex: -1,
      readUsage: NO_USAGE,
    })

    expect(result.recentIds).toEqual([])
    expect(result.frequentIds).toEqual([])
    expect(result.surfacedCount).toBe(0)
    expect(result.shouldShowAllSection).toBe(true)
    expect(result.remainingCandidates.map((c) => c.name)).toEqual(['foo', 'bar'])
    // flatNavIds is just the candidates when there's no usage history.
    expect(result.flatNavIds).toEqual(['cls-foo', 'cls-bar'])
  })

  it('hides the "All classes" section once the recent/frequent surface is large enough', () => {
    // Build 10 classes so recent + frequent can surface ≥ CLASS_USAGE_RECENT_LIMIT (8).
    const allClasses = Array.from({ length: 10 }, (_, i) => makeClass(`u-${i}`))
    // Mock usage so 8 IDs land in recent.
    const recentIds = allClasses.slice(0, 8).map((c) => c.id)
    const usage = Object.fromEntries(
      recentIds.map((id, i) => [id, { lastUsedAt: 1000 + i, count: 1 }]),
    )

    const result = useClassPickerSuggestions({
      allClasses,
      assignedIds: [],
      query: '',
      highlightedIndex: -1,
      readUsage: () => usage,
    })

    expect(result.recentIds.length).toBeGreaterThanOrEqual(8)
    expect(result.shouldShowAllSection).toBe(false)
    // flatNavIds covers only recent + frequent (no remaining slot).
    expect(result.flatNavIds).toEqual([...result.recentIds, ...result.frequentIds])
  })

})

// ---------------------------------------------------------------------------
// Typed-query branch
// ---------------------------------------------------------------------------

describe('useClassPickerSuggestions — typed query', () => {
  it('ranks an exact match above prefix matches', () => {
    const allClasses = [makeClass('text-bg-body-5'), makeClass('text'), makeClass('text-xl')]
    const result = useClassPickerSuggestions({
      allClasses,
      assignedIds: [],
      query: 'text',
      highlightedIndex: -1,
      readUsage: NO_USAGE,
    })

    expect(result.isEmptyQuery).toBe(false)
    // Exact match wins, then prefix (shorter wins within tier).
    expect(result.filteredSuggestions[0].name).toBe('text')
    expect(result.flatNavIds[0]).toBe('cls-text')
  })

  it('detects an exact-name match independent of ranking', () => {
    const allClasses = [makeClass('header')]
    const result = useClassPickerSuggestions({
      allClasses,
      assignedIds: [],
      query: 'header',
      highlightedIndex: -1,
      readUsage: NO_USAGE,
    })

    expect(result.exactMatchedClass?.name).toBe('header')
    expect(result.exactMatchAlreadyAssigned).toBe(false)
    expect(result.canCreateNew).toBe(false)
    expect(result.hasSubmittableQuery).toBe(true)
    expect(result.submitTooltip).toBe('Add class “header”')
  })

  it('flags an exact match that is already assigned as non-submittable', () => {
    const cls = makeClass('header')
    const result = useClassPickerSuggestions({
      allClasses: [cls],
      assignedIds: [cls.id],
      query: 'header',
      highlightedIndex: -1,
      readUsage: NO_USAGE,
    })

    expect(result.exactMatchedClass?.id).toBe(cls.id)
    expect(result.exactMatchAlreadyAssigned).toBe(true)
    expect(result.hasSubmittableQuery).toBe(false)
    expect(result.submitTooltip).toBe('“header” is already on this element')
  })

  it('reports canCreateNew when the typed query matches no existing class', () => {
    const result = useClassPickerSuggestions({
      allClasses: [makeClass('foo')],
      assignedIds: [],
      query: 'brand-new',
      highlightedIndex: -1,
      readUsage: NO_USAGE,
    })

    expect(result.canCreateNew).toBe(true)
    expect(result.hasSubmittableQuery).toBe(true)
    expect(result.submitTooltip).toBe('Create class “brand-new”')
  })

  it('returns an empty suggestion list when no class matches the query', () => {
    const result = useClassPickerSuggestions({
      allClasses: [makeClass('foo'), makeClass('bar')],
      assignedIds: [],
      query: 'zzz',
      highlightedIndex: -1,
      readUsage: NO_USAGE,
    })

    expect(result.filteredSuggestions).toEqual([])
    expect(result.canCreateNew).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Highlight clamping & arrow navigation
// ---------------------------------------------------------------------------

describe('useClassPickerSuggestions — highlightedIndex clamping', () => {
  it('snaps an out-of-range highlightedIndex to "no selection"', () => {
    const result = useClassPickerSuggestions({
      allClasses: [makeClass('foo'), makeClass('bar')],
      assignedIds: [],
      query: '',
      highlightedIndex: 99,
      readUsage: NO_USAGE,
    })

    expect(result.effectiveHighlightedIndex).toBe(-1)
    expect(result.hasArrowSelection).toBe(false)
    expect(result.highlightedClassId).toBeNull()
    expect(result.highlightedName).toBeNull()
  })

  it('exposes a primitive highlightedClassId when the index is in range', () => {
    const result = useClassPickerSuggestions({
      allClasses: [makeClass('foo'), makeClass('bar')],
      assignedIds: [],
      query: '',
      highlightedIndex: 1,
      readUsage: NO_USAGE,
    })

    expect(result.effectiveHighlightedIndex).toBe(1)
    expect(result.hasArrowSelection).toBe(true)
    // flatNavIds order matches candidates order when there's no usage history.
    expect(result.highlightedClassId).toBe(result.flatNavIds[1])
    expect(result.highlightedName).toBe('bar')
  })

  it('arrow highlight wins over the typed query in the submit tooltip', () => {
    // Typed query matches `foo` and `foo-bar` but the user has explicitly
    // arrow-selected the second result. Tooltip should describe the arrow
    // pick, not the (non-)create-new intent.
    const result = useClassPickerSuggestions({
      allClasses: [makeClass('foo'), makeClass('foo-bar')],
      assignedIds: [],
      query: 'foo',
      highlightedIndex: 1,
      readUsage: NO_USAGE,
    })

    expect(result.hasArrowSelection).toBe(true)
    expect(result.submitTooltip).toBe('Add class “foo-bar”')
  })
})

// ---------------------------------------------------------------------------
// Submit tooltip priority
// ---------------------------------------------------------------------------

describe('useClassPickerSuggestions — submit tooltip', () => {
  it('returns the static instructional copy for an empty query', () => {
    const result = useClassPickerSuggestions({
      allClasses: [],
      assignedIds: [],
      query: '',
      highlightedIndex: -1,
      readUsage: NO_USAGE,
    })

    expect(result.submitTooltip).toBe('Type a class name to add or create')
    expect(result.hasSubmittableQuery).toBe(false)
  })
})
