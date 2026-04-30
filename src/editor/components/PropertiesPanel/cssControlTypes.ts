/**
 * cssControlTypes — centralized CSS property → UI control-type mapping.
 *
 * Determines which widget renders each CSS property in the unified
 * property-editing surface (ClassPropertyRow + Module section rows).
 *
 * Phase 3 / Task #464 / Spec #671.
 * Co-locates with PropertiesPanel per §6 of Spec #671 — keeps parseCSSDeclarations
 * a pure serialisation utility (no UI knowledge there).
 */

import type { CSSPropertyBag } from '../../../core/page-tree/types'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CSSControlType = 'color' | 'select' | 'text'

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

export const ENUM_OPTIONS = new Map<keyof CSSPropertyBag, string[]>([
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
 * Section order mirrors parseCSSDeclarations.ts KNOWN_PROPERTIES for visual diff-ability.
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
  padding:       '0px',
  paddingTop:    '0px',
  paddingRight:  '0px',
  paddingBottom: '0px',
  paddingLeft:   '0px',
  margin:        '0px',
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

/**
 * All CSS properties available in add-property search, ordered by category.
 * Derived from CSSPropertyBag — add new properties to both CSSPropertyBag and here.
 */
export const ALL_CSS_PROPERTIES: ReadonlyArray<keyof CSSPropertyBag> = [
  // Layout
  'display', 'flexDirection', 'flexWrap', 'alignItems', 'justifyContent',
  'justifyItems', 'alignSelf', 'justifySelf', 'flex', 'gap', 'rowGap', 'columnGap',
  'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow',
  // Size
  'width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight',
  'aspectRatio', 'boxSizing',
  // Spacing
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  // Position
  'position', 'top', 'right', 'bottom', 'left', 'zIndex',
  // Typography
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight',
  'letterSpacing', 'textAlign', 'textDecoration', 'textTransform',
  'color', 'textShadow',
  // Background / Visual
  'backgroundColor', 'background', 'backgroundImage', 'backgroundSize',
  'backgroundPosition', 'backgroundRepeat', 'objectFit', 'objectPosition',
  'opacity',
  'overflow', 'overflowX', 'overflowY',
  // Border
  'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius',
  'borderBottomLeftRadius', 'borderBottomRightRadius', 'outline', 'outlineOffset',
  // Effects
  'boxShadow', 'filter', 'backdropFilter', 'transform', 'transformOrigin',
  // Interaction
  'cursor', 'pointerEvents', 'userSelect',
  // Motion
  'transition', 'animation',
  // Scroll
  'scrollBehavior',
]

// ---------------------------------------------------------------------------
// Property category mapping — 6 user-facing picker buckets (Task #466 / Spec #673 §3)
//
// Collapses parseCSSDeclarations.ts's 11 KNOWN_PROPERTIES sections into 6 UX buckets:
//   Layout    = Layout
//   Spacing   = Size + Spacing
//   Typography = Typography
//   Position  = Position
//   Effects   = Visual/Background + Border + Effects
//   Transform = Motion + Interaction + Scrollbar
//
// EXHAUSTIVE by design (Record<keyof CSSPropertyBag, CSSPropertyCategory>):
// Adding a new key to CSSPropertyBag without updating this Record errors at compile time
// (same exhaustiveness pattern as ALL_KEYS_RECORD in propertiesPanel-redesign.test.tsx).
// ---------------------------------------------------------------------------

export type CSSPropertyCategory =
  | 'Layout'
  | 'Spacing'
  | 'Typography'
  | 'Position'
  | 'Effects'
  | 'Transform'

/**
 * Maps every CSSPropertyBag key to its user-facing picker category.
 * Exhaustive Record — TypeScript errors here if CSSPropertyBag gains a new key without
 * a corresponding entry in this table.
 */
const PROPERTY_CATEGORIES: Record<keyof CSSPropertyBag, CSSPropertyCategory> = {
  // ── Layout ────────────────────────────────────────────────────────────────
  display: 'Layout', flexDirection: 'Layout', flexWrap: 'Layout', alignItems: 'Layout',
  justifyContent: 'Layout', justifyItems: 'Layout', alignSelf: 'Layout', justifySelf: 'Layout', flex: 'Layout',
  gap: 'Layout', rowGap: 'Layout', columnGap: 'Layout',
  gridTemplateColumns: 'Layout', gridTemplateRows: 'Layout', gridColumn: 'Layout', gridRow: 'Layout',
  // ── Spacing (Size + Spacing from KNOWN_PROPERTIES) ────────────────────────
  width: 'Spacing', height: 'Spacing', minWidth: 'Spacing', maxWidth: 'Spacing',
  minHeight: 'Spacing', maxHeight: 'Spacing', aspectRatio: 'Spacing', boxSizing: 'Spacing',
  padding: 'Spacing', paddingTop: 'Spacing', paddingRight: 'Spacing',
  paddingBottom: 'Spacing', paddingLeft: 'Spacing',
  margin: 'Spacing', marginTop: 'Spacing', marginRight: 'Spacing',
  marginBottom: 'Spacing', marginLeft: 'Spacing',
  // ── Typography ────────────────────────────────────────────────────────────
  fontFamily: 'Typography', fontSize: 'Typography', fontWeight: 'Typography',
  fontStyle: 'Typography', letterSpacing: 'Typography', lineHeight: 'Typography',
  textAlign: 'Typography', textDecoration: 'Typography', textTransform: 'Typography',
  color: 'Typography', textShadow: 'Typography',
  // ── Position ──────────────────────────────────────────────────────────────
  position: 'Position', top: 'Position', right: 'Position', bottom: 'Position',
  left: 'Position', zIndex: 'Position',
  // ── Effects (Visual/Background + Border + Effects from KNOWN_PROPERTIES) ──
  backgroundColor: 'Effects', background: 'Effects', backgroundImage: 'Effects',
  backgroundSize: 'Effects', backgroundPosition: 'Effects', backgroundRepeat: 'Effects',
  objectFit: 'Effects', objectPosition: 'Effects',
  opacity: 'Effects', overflow: 'Effects', overflowX: 'Effects', overflowY: 'Effects',
  border: 'Effects', borderTop: 'Effects', borderRight: 'Effects',
  borderBottom: 'Effects', borderLeft: 'Effects',
  borderRadius: 'Effects', borderTopLeftRadius: 'Effects', borderTopRightRadius: 'Effects',
  borderBottomLeftRadius: 'Effects', borderBottomRightRadius: 'Effects',
  outline: 'Effects', outlineOffset: 'Effects',
  boxShadow: 'Effects', filter: 'Effects', backdropFilter: 'Effects',
  transform: 'Effects', transformOrigin: 'Effects',
  // ── Transform (Motion + Interaction + Scrollbar from KNOWN_PROPERTIES) ────
  transition: 'Transform', animation: 'Transform',
  cursor: 'Transform', pointerEvents: 'Transform', userSelect: 'Transform',
  scrollBehavior: 'Transform',
}

/**
 * Returns the user-facing picker category for a given CSS property.
 * Delegates to the exhaustive PROPERTY_CATEGORIES table above.
 */
export function getCSSPropertyCategory(prop: keyof CSSPropertyBag): CSSPropertyCategory {
  return PROPERTY_CATEGORIES[prop]
}

/**
 * Ordered display sequence for the 6 picker category buckets.
 * Matches UX Spec #673 §3 ordering: Layout → Spacing → Typography → Position → Effects → Transform.
 */
export const PICKER_CATEGORY_ORDER: ReadonlyArray<CSSPropertyCategory> = [
  'Layout',
  'Spacing',
  'Typography',
  'Position',
  'Effects',
  'Transform',
]

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
  icon: string
  defaultOpen?: boolean
  properties: ReadonlyArray<keyof CSSPropertyBag>
}

export const CLASS_STYLE_SECTIONS: ReadonlyArray<ClassStyleSectionDefinition> = [
  {
    id: 'layout-position',
    title: 'Layout & Position',
    icon: 'layout',
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
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'zIndex',
      'overflow',
      'overflowX',
      'overflowY',
    ],
  },
  {
    id: 'size',
    title: 'Size',
    icon: 'proportions',
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
    icon: 'ruler-dimension',
    defaultOpen: true,
    properties: [
      'padding',
      'paddingTop',
      'paddingRight',
      'paddingBottom',
      'paddingLeft',
      'margin',
      'marginTop',
      'marginRight',
      'marginBottom',
      'marginLeft',
    ],
  },
  {
    id: 'typography',
    title: 'Typography',
    icon: 'type',
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
    icon: 'paint-bucket',
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
    icon: 'box',
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
    icon: 'sparkles',
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
    icon: 'pointer',
    properties: [
      'cursor',
      'pointerEvents',
      'userSelect',
      'scrollBehavior',
    ],
  },
]
