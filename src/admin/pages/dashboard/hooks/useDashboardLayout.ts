/**
 * useDashboardLayout — persisted state for the dashboard grid + onboarding
 * panel.
 *
 * The dashboard is a per-user preference, not a per-site setting — every
 * admin gets to arrange and resize their own widgets. We persist to
 * localStorage so the layout sticks across sessions without round-tripping
 * the server. (When the team-level "shared dashboard preset" feature lands
 * later, it would layer on top by writing into a CMS-side prefs row.)
 *
 * Schema is validated via TypeBox with `parseJsonWithFallback` so any
 * corrupted blob falls back to the default layout rather than bricking
 * the page.
 */
import { useCallback, useEffect, useState } from 'react'
import { Type, type Static } from '@core/utils/typeboxHelpers'
import { parseJsonWithFallback } from '@core/utils/jsonValidate'

// Bumped to v2 when row-span support was added — older v1 entries lacked
// the `rows` field and would render with the minimum row span across the
// board. Bumping the key resets every user to the curated defaults the
// new model ships with rather than forcing them through normalization
// from a missing field. Older `pb-admin-dashboard-layout-v1` keys are
// orphaned (no migration helper) since this is per-user UI state, not
// content.
const STORAGE_KEY = 'pb-admin-dashboard-layout-v2'

// `rows` is optional ON THE WIRE only — older persisted layouts predate
// vertical resize and a corruption-tolerant load needs to accept their
// shape. The exported `DashboardItem` type below is the normalized
// runtime shape (rows required); `normalizeLayout` below fills in
// defaults right after the schema parse.
const PersistedDashboardItemSchema = Type.Object({
  id: Type.String(),
  size: Type.Number(),
  rows: Type.Optional(Type.Number()),
})

// `onboardingCollapsed` is kept on the persisted schema as optional so
// older localStorage entries from before the "hide steps" toggle was
// removed still parse — `normalizeLayout` drops it. New writes won't
// include it.
const PersistedDashboardLayoutSchema = Type.Object({
  items: Type.Array(PersistedDashboardItemSchema),
  onboardingDismissed: Type.Boolean(),
  onboardingCollapsed: Type.Optional(Type.Boolean()),
})

type PersistedDashboardLayout = Static<typeof PersistedDashboardLayoutSchema>

export interface DashboardItem {
  id: string
  /** Grid column span (1 .. 12). */
  size: number
  /** Grid row span (1 .. 8) — each row is GRID_ROW_HEIGHT px tall. */
  rows: number
}

export interface DashboardLayout {
  items: DashboardItem[]
  onboardingDismissed: boolean
}

/**
 * Pixel height of one grid row. The grid stylesheet's `grid-auto-rows`
 * MUST stay in sync — moving the value to a single TS constant means the
 * resize handler can compute row deltas from the pointer distance without
 * a magic number duplicated across files. Exported so the grid CSS module
 * can read it as a CSS custom property at the grid root.
 */
export const GRID_ROW_HEIGHT = 70
/**
 * 1px between cells. The grid sits on a darker surface (`--editor-surface`)
 * than the cards themselves (`--editor-surface-2`); the 1px gap reads as
 * a hairline of the parent surface peeking through, giving the
 * borderless tile look without an explicit divider.
 */
export const GRID_GAP = 1
export const MIN_ROWS = 2
export const MAX_ROWS = 8
export const MIN_COLS = 3
export const MAX_COLS = 12

const DEFAULT_LAYOUT: DashboardLayout = {
  items: [
    { id: 'visitors', size: 6, rows: 4 },
    { id: 'storage', size: 6, rows: 4 },
    { id: 'pages', size: 3, rows: 3 },
    { id: 'posts', size: 3, rows: 3 },
    { id: 'media', size: 3, rows: 3 },
    { id: 'status', size: 3, rows: 3 },
    { id: 'topPages', size: 4, rows: 5 },
    { id: 'activity', size: 4, rows: 5 },
    { id: 'publish', size: 4, rows: 5 },
    { id: 'plugins', size: 4, rows: 5 },
    { id: 'domain', size: 4, rows: 3 },
  ],
  onboardingDismissed: false,
}

function normalizeItem(item: { id: string; size: number; rows?: number }): DashboardItem {
  return {
    id: item.id,
    size: item.size,
    rows: typeof item.rows === 'number' && item.rows >= MIN_ROWS ? item.rows : MIN_ROWS,
  }
}

function normalizeLayout(layout: PersistedDashboardLayout): DashboardLayout {
  return {
    items: layout.items.map(normalizeItem),
    onboardingDismissed: layout.onboardingDismissed,
  }
}

function readFromStorage(): DashboardLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const parsed = parseJsonWithFallback(raw, PersistedDashboardLayoutSchema, DEFAULT_LAYOUT)
    // Backfill `rows` for older persisted layouts written before vertical
    // resize was supported. The schema marks it optional precisely so
    // those entries still parse — without normalization they'd render
    // with NaN row spans.
    return normalizeLayout(parsed)
  } catch (err) {
    console.error('[dashboard] failed to read layout from localStorage:', err)
    return DEFAULT_LAYOUT
  }
}

function writeToStorage(layout: DashboardLayout): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout))
  } catch (err) {
    console.error('[dashboard] failed to persist layout to localStorage:', err)
  }
}

export interface DashboardLayoutApi {
  layout: DashboardLayout
  /** Append a widget if it's not already on the grid. */
  addWidget: (id: string, size: number, rows?: number) => void
  /** Drop a widget from the grid. */
  removeWidget: (id: string) => void
  /** Reorder by replacing the items array (DnD layer hands us the next order). */
  reorder: (next: readonly DashboardItem[]) => void
  /** Update a widget's column span. */
  resize: (id: string, size: number) => void
  /** Update a widget's row span (vertical height). */
  resizeRows: (id: string, rows: number) => void
  /** Permanently dismiss the onboarding panel for this user. */
  dismissOnboarding: () => void
  /** Bring the onboarding panel back after dismissal (for QA / new pages). */
  restoreOnboarding: () => void
}

export function useDashboardLayout(): DashboardLayoutApi {
  const [layout, setLayout] = useState<DashboardLayout>(() => readFromStorage())

  useEffect(() => {
    writeToStorage(layout)
  }, [layout])

  const addWidget = useCallback((id: string, size: number, rows: number = 3) => {
    setLayout((curr) =>
      curr.items.some((i) => i.id === id)
        ? curr
        : { ...curr, items: [...curr.items, { id, size, rows }] },
    )
  }, [])

  const removeWidget = useCallback((id: string) => {
    setLayout((curr) => ({ ...curr, items: curr.items.filter((i) => i.id !== id) }))
  }, [])

  const reorder = useCallback((next: readonly DashboardItem[]) => {
    setLayout((curr) => ({ ...curr, items: [...next] }))
  }, [])

  const resize = useCallback((id: string, size: number) => {
    setLayout((curr) => ({
      ...curr,
      items: curr.items.map((i) => (i.id === id ? { ...i, size } : i)),
    }))
  }, [])

  const resizeRows = useCallback((id: string, rows: number) => {
    setLayout((curr) => ({
      ...curr,
      items: curr.items.map((i) => (i.id === id ? { ...i, rows } : i)),
    }))
  }, [])

  const dismissOnboarding = useCallback(() => {
    setLayout((curr) => ({ ...curr, onboardingDismissed: true }))
  }, [])

  const restoreOnboarding = useCallback(() => {
    setLayout((curr) => ({ ...curr, onboardingDismissed: false }))
  }, [])

  return {
    layout,
    addWidget,
    removeWidget,
    reorder,
    resize,
    resizeRows,
    dismissOnboarding,
    restoreOnboarding,
  }
}
