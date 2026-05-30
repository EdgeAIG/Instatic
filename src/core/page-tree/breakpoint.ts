/**
 * Breakpoint — viewport definition stored on the site document.
 *
 * Each Breakpoint has an id, display label, viewport width in pixels, and a
 * pixel-art-icons name shown in the editor toolbar. `DEFAULT_BREAKPOINTS`
 * seeds fresh sites with the canonical mobile/tablet/desktop set.
 *
 * Constraint #269: no imports from editor / editor-store here.
 */

import { Type, type Static } from '@core/utils/typeboxHelpers'

// ---------------------------------------------------------------------------
// BreakpointSchema
// ---------------------------------------------------------------------------

export const BreakpointSchema = Type.Object({
  id: Type.String(),
  /** Display label e.g. "Mobile", "Tablet", "Desktop" */
  label: Type.String(),
  /** Viewport width in pixels */
  width: Type.Number(),
  /**
   * pixel-art-icons kebab-case icon name — e.g. "smartphone", "tablet", "monitor".
   * Falls back to "monitor" if missing or non-string — handled in parseBreakpoint.
   */
  icon: Type.String(),
  /**
   * Whether this breakpoint renders a live preview iframe on the editor canvas.
   * EDITOR-ONLY — it has no effect on published CSS (a breakpoint always emits
   * its `@media (max-width: N)` block regardless). `undefined` is treated as
   * `true` (framed) for back-compat; width media queries added via the
   * editing-context switcher default to `false` so not every responsive size
   * spawns an iframe. Toggle it in Settings → Breakpoints.
   */
  previewFrame: Type.Optional(Type.Boolean()),
})

export type Breakpoint = Static<typeof BreakpointSchema>

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_BREAKPOINTS: Breakpoint[] = [
  { id: 'mobile',  label: 'Mobile',  width: 375,  icon: 'smartphone' },
  { id: 'tablet',  label: 'Tablet',  width: 768,  icon: 'tablet'     },
  { id: 'desktop', label: 'Desktop', width: 1440, icon: 'monitor'    },
]

// ---------------------------------------------------------------------------
// Tolerant parsing
// ---------------------------------------------------------------------------

/** Parse a Breakpoint, providing a 'monitor' fallback for missing/invalid icon. */
export function parseBreakpoint(raw: unknown): Breakpoint | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.label !== 'string') return null
  if (typeof r.width !== 'number') return null
  return {
    id: r.id,
    label: r.label,
    width: r.width,
    icon: typeof r.icon === 'string' ? r.icon : 'monitor',
    ...(typeof r.previewFrame === 'boolean' ? { previewFrame: r.previewFrame } : {}),
  }
}
