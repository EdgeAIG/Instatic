/**
 * cssControlTypes — centralized CSS property → UI control-type mapping.
 *
 * Determines which widget renders each CSS property in the unified
 * property-editing surface (ClassPropertyRow + Module section rows).
 *
 * Phase 3 / Task #464 / Spec #671.
 * Co-locates with PropertiesPanel per §6 of Spec #671.
 */

import type { CSSPropertyBag } from '@core/page-tree/schemas'
import type { IconComponent } from 'pixel-art-icons/types'
import { LayoutIcon } from 'pixel-art-icons/icons/layout'
import { MoveIcon } from 'pixel-art-icons/icons/move'
import { ProportionsIcon } from 'pixel-art-icons/icons/proportions'
import { RulerDimensionIcon } from 'pixel-art-icons/icons/ruler-dimension'
import { TextStartTIcon } from 'pixel-art-icons/icons/text-start-t'
import { PaintBucketIcon } from 'pixel-art-icons/icons/paint-bucket'
import { BoxIcon } from 'pixel-art-icons/icons/box'
import { SparklesIcon } from 'pixel-art-icons/icons/sparkles'
import { PointerIcon } from 'pixel-art-icons/icons/pointer'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

type CSSControlType = 'color' | 'select' | 'text'

/**
 * Which framework variable scale (if any) backs autocomplete suggestions
 * for a CSS property. The string identifies the Token catalog the
 * `TokenAwareInput` should pull from. Returning undefined means the
 * property uses a plain text/select/color control with no token suggestions.
 *
 * The mapping is intentionally narrow — a property only earns a token source
 * when the framework's vocabulary is genuinely the right answer for that
 * value type. Lengths in container-only / item-only contexts that already
 * have dedicated visual blocks (gap inside flex/grid blocks, top/right/
 * bottom/left inside the position block, padding/margin inside
 * SpacingBoxControl) are not in this map because their visual blocks
 * already wire token suggestions in directly.
 */
export type CSSPropertyTokenSource = 'spacing' | 'typography'

// ---------------------------------------------------------------------------
// CSSPropertyBag keys whose store type is `number`, not `string`.
// ClassPropertyRow still renders these as text inputs, then coerces valid values to numbers.
// ---------------------------------------------------------------------------

export const NUMBER_TYPED_PROPS = new Set<keyof CSSPropertyBag>(['zIndex', 'opacity'])

// ---------------------------------------------------------------------------
// Color properties
// ---------------------------------------------------------------------------

const COLOR_PROPERTIES = new Set<keyof CSSPropertyBag>([
  'color',
  'backgroundColor',
])

// ---------------------------------------------------------------------------
// Enum (select) properties → option lists (first option is the default)
// ---------------------------------------------------------------------------

const ENUM_OPTIONS = new Map<keyof CSSPropertyBag, string[]>([
  ['display',          ['block', 'inline', 'inline-block', 'flex', 'grid', 'none']],
  ['flexDirection',    ['row', 'column', 'row-reverse', 'column-reverse']],
  ['flexWrap',         ['nowrap', 'wrap', 'wrap-reverse']],
  ['alignItems',       ['flex-start', 'flex-end', 'center', 'stretch', 'baseline']],
  ['justifyContent',   ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly']],
  ['justifyItems',     ['stretch', 'start', 'center', 'end']],
  ['alignSelf',        ['auto', 'flex-start', 'flex-end', 'center', 'stretch']],
  ['justifySelf',      ['auto', 'flex-start', 'flex-end', 'center', 'stretch']],
  ['fontStyle',        ['normal', 'italic']],
  ['fontWeight',       ['300', '400', '500', '600', '700', 'bold', 'normal']],
  ['textAlign',        ['left', 'center', 'right', 'justify']],
  ['textTransform',    ['none', 'uppercase', 'lowercase', 'capitalize']],
  ['textDecoration',   ['none', 'underline', 'line-through', 'overline']],
  ['boxSizing',        ['border-box', 'content-box']],
  ['position',         ['static', 'relative', 'absolute', 'fixed', 'sticky']],
  ['overflow',         ['visible', 'hidden', 'scroll', 'auto']],
  ['overflowX',        ['visible', 'hidden', 'scroll', 'auto']],
  ['overflowY',        ['visible', 'hidden', 'scroll', 'auto']],
  ['backgroundRepeat', ['no-repeat', 'repeat', 'repeat-x', 'repeat-y']],
  ['objectFit',        ['cover', 'contain', 'fill', 'none', 'scale-down']],
  ['pointerEvents',    ['auto', 'none']],
  ['scrollBehavior',   ['auto', 'smooth']],
  ['cursor',           ['auto', 'pointer', 'default', 'move', 'not-allowed', 'crosshair', 'text']],
])

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the UI control type for a given CSS property key.
 * Dispatch order: color → select → text (fallback).
 */
export function getCSSPropertyControlType(prop: keyof CSSPropertyBag): CSSControlType {
  if (COLOR_PROPERTIES.has(prop)) return 'color'
  if (ENUM_OPTIONS.has(prop))     return 'select'
  return 'text'
}

/** Returns the enum option list for a select property, or undefined if not an enum. */
export function getEnumOptions(prop: keyof CSSPropertyBag): string[] | undefined {
  return ENUM_OPTIONS.get(prop)
}

/**
 * Per-property mapping to the framework variable scale that backs its
 * autocomplete dropdown. Properties absent from this map render with
 * plain text inputs (no token suggestions).
 *
 * Currently surfaces typography variables for `fontSize`. Other typography
 * properties (lineHeight, letterSpacing) deliberately keep plain text
 * inputs because they accept unitless / em / px values that don't map to
 * a single fluid scale.
 */
const PROPERTY_TOKEN_SOURCES = new Map<keyof CSSPropertyBag, CSSPropertyTokenSource>([
  ['fontSize', 'typography'],
])

/** Returns the framework token source for a property, or undefined when none applies. */
export function getCSSPropertyTokenSource(
  prop: keyof CSSPropertyBag,
): CSSPropertyTokenSource | undefined {
  return PROPERTY_TOKEN_SOURCES.get(prop)
}

/**
 * Per-property default values for the add-property search.
 *
 * Implements the per-property lookup table from UX Reviewer Contribution #677 (accepted,
 * Architect msg #2080). Control-type dispatch was NOT used because many CSS properties
 * have non-trivial defaults that the broad bucket approach gets wrong:
 *   - opacity: should be 1 (fully visible), not 0 (invisible)
 *   - zIndex:  should be 0 (neutral), not -10
 *   - width:   should be 'auto' (layout-safe), not '0px'
 *   - maxWidth: should be 'none' (unconstrained), not '0px'
 *   - borderWidth: see border shorthands below — shorthand left empty for manual entry
 *
 * Section order mirrors ALL_CSS_PROPERTIES for visual diff-ability.
 *
 * Note on NUMBER_TYPED_PROPS (zIndex, opacity): CSSPropertyBag types these as `number`,
 * so their defaults must be numbers, not strings ('auto' / '1' would fail TS types).
 */
const DEFAULT_CSS_VALUES: Partial<Record<keyof CSSPropertyBag, string | number>> = {
  // ── Typography ───────────────────────────────────────────────────────────
  fontFamily:     'inherit',  // inheriting keeps text legible; '#000' would override cascade
  fontSize:       '14px',
  fontWeight:     '400',
  fontStyle:      'normal',
  letterSpacing:  '0px',
  lineHeight:     '1.5',      // unitless — NOT '1.5px'; couples to fontSize correctly
  textAlign:      'left',
  textDecoration: 'none',
  textTransform:  'none',
  color:          'inherit',  // NOT '#000000' — inheriting keeps text legible by default
  textShadow:     'none',
  // ── Layout ───────────────────────────────────────────────────────────────
  display:             'block',
  flexDirection:       'row',
  flexWrap:            'nowrap',
  alignItems:          'stretch',
  justifyContent:      'flex-start',
  justifyItems:        'stretch',
  alignSelf:           'auto',
  justifySelf:         'auto',
  flex:                '0 1 auto', // matches browser default (flex-grow:0; flex-shrink:1; basis:auto)
  gap:                 '0px',
  rowGap:              '0px',
  columnGap:           '0px',
  gridTemplateColumns: 'none',
  gridTemplateRows:    'none',
  gridColumn:          'auto',
  gridRow:             'auto',
  // ── Size ─────────────────────────────────────────────────────────────────
  width:     'auto',   // NOT '100px' — auto avoids surprising layout shifts on add
  height:    'auto',
  minWidth:  '0px',
  maxWidth:  'none',   // 'none' = unconstrained; NOT a px value that incorrectly constrains
  minHeight: '0px',
  maxHeight: 'none',
  aspectRatio: '',     // free-form text (e.g. "16/9"); no sensible universal default
  boxSizing:   'border-box',
  // ── Spacing ───────────────────────────────────────────────────────────────
  // Per-side only — see CSSPropertyBagSchema for the rationale (publisher
  // collapses 4 sides into the CSS shorthand at emission time).
  paddingTop:    '0px',
  paddingRight:  '0px',
  paddingBottom: '0px',
  paddingLeft:   '0px',
  marginTop:     '0px',
  marginRight:   '0px',
  marginBottom:  '0px',
  marginLeft:    '0px',
  // ── Position ──────────────────────────────────────────────────────────────
  position: 'static',
  top:      'auto',    // NOT '0px' — 0px would immediately reposition positioned elements
  right:    'auto',
  bottom:   'auto',
  left:     'auto',
  zIndex:   0,         // number (CSSPropertyBag.zIndex?: number); 0 is neutral stacking
  // ── Visual ────────────────────────────────────────────────────────────────
  backgroundColor:   'transparent', // NOT '#000000' — transparent is a safe no-op
  background:        '',             // shorthand — left empty for manual entry
  backgroundImage:   'none',
  backgroundSize:    'auto',
  backgroundPosition:'0% 0%',
  backgroundRepeat:  'repeat',
  objectFit:         'cover',
  objectPosition:    'center center',
  opacity:           1,              // number (CSSPropertyBag.opacity?: number); 1 = fully opaque
  overflow:          'visible',
  overflowX:         'visible',
  overflowY:         'visible',
  // ── Border ────────────────────────────────────────────────────────────────
  border:       '',    // shorthands left empty — user specifies manually (e.g. "1px solid red")
  borderTop:    '',
  borderRight:  '',
  borderBottom: '',
  borderLeft:   '',
  borderRadius:            '0px',
  borderTopLeftRadius:     '0px',
  borderTopRightRadius:    '0px',
  borderBottomLeftRadius:  '0px',
  borderBottomRightRadius: '0px',
  outline:       'none',
  outlineOffset: '0px',
  // ── Effects ───────────────────────────────────────────────────────────────
  boxShadow:      'none',
  filter:         'none',
  backdropFilter: 'none',
  transform:      'none',
  transformOrigin:'50% 50%',  // centre origin — corner '0 0' surprises users rotating/scaling
  // ── Motion ────────────────────────────────────────────────────────────────
  transition: 'none',
  animation:  'none',
  // ── Interaction ───────────────────────────────────────────────────────────
  cursor:        'default',
  pointerEvents: 'auto',
  userSelect:    'auto',
  // ── Scrollbar ─────────────────────────────────────────────────────────────
  scrollBehavior: 'auto',
}

/**
 * Returns the initial value to use when adding a CSS property via search.
 *
 * Uses the per-property lookup table (DEFAULT_CSS_VALUES) from Contribution #677.
 * Falls back to control-type dispatch for any future CSSPropertyBag additions not yet
 * in the table — keeps add-property search functional even before the table is updated.
 */
export function getCSSPropertyDefaultValue(prop: keyof CSSPropertyBag): string | number {
  const tableVal = DEFAULT_CSS_VALUES[prop]
  if (tableVal !== undefined) return tableVal

  // Fallback: control-type dispatch for future properties not yet in DEFAULT_CSS_VALUES.
  // Add new CSSPropertyBag keys to the table above before shipping to avoid this path.
  const type = getCSSPropertyControlType(prop)
  if (type === 'select') return ENUM_OPTIONS.get(prop)?.[0] ?? ''
  return ''
}

/**
 * Convert a camelCase CSS property key to a human-readable label.
 * e.g. 'paddingTop' → 'Padding top', 'backgroundColor' → 'Background color'
 */
export function cssPropertyLabel(prop: string): string {
  const spaced = prop.replace(/([A-Z])/g, ' $1').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase()
}

// ---------------------------------------------------------------------------
// Class style inspector sections
//
// These sections drive the professional class editor in the Properties Panel.
// They intentionally cover every CSSPropertyBag key so class styling is an
// inspector with real controls, not a property search list.
// ---------------------------------------------------------------------------

export interface ClassStyleSectionDefinition {
  id: string
  title: string
  icon: IconComponent
  defaultOpen?: boolean
  properties: ReadonlyArray<keyof CSSPropertyBag>
}

export const CLASS_STYLE_SECTIONS: ReadonlyArray<ClassStyleSectionDefinition> = [
  {
    id: 'layout',
    title: 'Layout',
    icon: LayoutIcon,
    defaultOpen: true,
    properties: [
      'display',
      'flexDirection',
      'flexWrap',
      'alignItems',
      'justifyContent',
      'justifyItems',
      'alignSelf',
      'justifySelf',
      'flex',
      'gap',
      'rowGap',
      'columnGap',
      'gridTemplateColumns',
      'gridTemplateRows',
      'gridColumn',
      'gridRow',
      'overflow',
      'overflowX',
      'overflowY',
    ],
  },
  {
    id: 'position',
    title: 'Position',
    icon: MoveIcon,
    properties: [
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'zIndex',
    ],
  },
  {
    id: 'size',
    title: 'Size',
    icon: ProportionsIcon,
    defaultOpen: true,
    properties: [
      'width',
      'height',
      'minWidth',
      'maxWidth',
      'minHeight',
      'maxHeight',
      'aspectRatio',
      'boxSizing',
    ],
  },
  {
    id: 'spacing',
    title: 'Spacing',
    icon: RulerDimensionIcon,
    defaultOpen: true,
    properties: [
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
    ],
  },
  {
    id: 'typography',
    title: 'Typography',
    icon: TextStartTIcon,
    properties: [
      'fontFamily',
      'fontSize',
      'fontWeight',
      'fontStyle',
      'lineHeight',
      'letterSpacing',
      'textAlign',
      'textDecoration',
      'textTransform',
      'color',
      'textShadow',
    ],
  },
  {
    id: 'background',
    title: 'Background',
    icon: PaintBucketIcon,
    properties: [
      'backgroundColor',
      'background',
      'backgroundImage',
      'backgroundSize',
      'backgroundPosition',
      'backgroundRepeat',
      'objectFit',
      'objectPosition',
    ],
  },
  {
    id: 'border',
    title: 'Border',
    icon: BoxIcon,
    properties: [
      'border',
      'borderTop',
      'borderRight',
      'borderBottom',
      'borderLeft',
      'borderRadius',
      'borderTopLeftRadius',
      'borderTopRightRadius',
      'borderBottomLeftRadius',
      'borderBottomRightRadius',
      'outline',
      'outlineOffset',
    ],
  },
  {
    id: 'effects',
    title: 'Effects',
    icon: SparklesIcon,
    properties: [
      'opacity',
      'boxShadow',
      'filter',
      'backdropFilter',
      'transform',
      'transformOrigin',
      'transition',
      'animation',
    ],
  },
  {
    id: 'interaction',
    title: 'Interaction',
    icon: PointerIcon,
    properties: [
      'cursor',
      'pointerEvents',
      'userSelect',
      'scrollBehavior',
    ],
  },
]

// ---------------------------------------------------------------------------
// Style tab utilities
//
// Shared by ClassComposer, StyleSurface, and PropertiesPanel. Kept here (not
// in ClassComposer) so ClassComposer stays a components-only file — satisfying
// the react-refresh/only-export-components lint rule.
// ---------------------------------------------------------------------------

/**
 * Returns a map from section id → number of properties with stored values.
 * Used to render the set-style dot badges on the StyleCategoryRail.
 */
export function getClassStyleSectionSetCounts(
  storedStyles: Record<string, unknown>,
): ReadonlyMap<string, number> {
  return new Map(
    CLASS_STYLE_SECTIONS.map((section) => [
      section.id,
      section.properties.filter((prop) => hasStyleValue(storedStyles[prop])).length,
    ]),
  )
}

/**
 * Returns the active breakpoint tab id for class style reads/writes.
 * 'base' when desktop (or no breakpoint); otherwise the breakpoint id.
 */
export function getActiveStyleTab(activeBreakpointId: string | undefined): string {
  return activeBreakpointId && activeBreakpointId !== 'desktop' ? activeBreakpointId : 'base'
}

// Private helper (also used in getClassStyleSectionSetCounts above)
function hasStyleValue(value: unknown): value is string | number {
  return value !== undefined && value !== null && value !== ''
}
