/**
 * LayoutSection — visual editor for the `layout-position` CSS section.
 *
 * Replaces the long stack of generic ClassPropertyRow widgets for display /
 * flex / grid / alignment with task-shaped controls:
 *
 *   • DisplaySwitcher       — connected segmented control [Flex | Grid | ▼ more]
 *                             with no label and no default selection. Choosing a
 *                             segment reveals only the fields relevant to that
 *                             display value.
 *   • FlexDirectionControl  — 4 connected icon buttons (row, column, reverses)
 *   • FlexWrapControl       — 3 segments (Nowrap / Wrap / Wrap-rev)
 *   • AlignmentControl      — connected icon buttons for align-items + justify-
 *                             content; the icon set rotates with flex-direction
 *                             so cross-axis vs main-axis stays visually obvious.
 *
 * Properties not visualised here (gap, gridTemplate*, position, top/right/
 * bottom/left, zIndex, overflow*) keep using ClassPropertyRow — rendered below
 * the visual switchers so the section still covers every property in
 * `CLASS_STYLE_SECTIONS.layout-position`.
 *
 * Design intent (Job #1342):
 *   - "Nothing chosen by default" — when display is unset, no segment looks
 *     pressed and no flex/grid fields appear. As soon as the user picks
 *     flex (or grid via the dropdown), the dependent rows fade in.
 */

import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { CSSPropertyBag } from '@core/page-tree/schemas'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { Input } from '@ui/components/Input'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import { LayoutIcon } from 'pixel-art-icons/icons/layout'
import { Grid2x22Icon } from 'pixel-art-icons/icons/grid-2x2-2'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { ArrowRightIcon } from 'pixel-art-icons/icons/arrow-right'
import { ArrowLeftIcon } from 'pixel-art-icons/icons/arrow-left'
import { ArrowDownIcon } from 'pixel-art-icons/icons/arrow-down'
import { ArrowUpIcon } from 'pixel-art-icons/icons/arrow-up'
import { ArrowsHorizontalIcon } from 'pixel-art-icons/icons/arrows-horizontal'
import { ArrowsVerticalIcon } from 'pixel-art-icons/icons/arrows-vertical'
import { TextWrapIcon } from 'pixel-art-icons/icons/text-wrap'
import { AlignStartHorizontalIcon } from 'pixel-art-icons/icons/align-start-horizontal'
import { AlignCenterHorizontalIcon } from 'pixel-art-icons/icons/align-center-horizontal'
import { AlignEndHorizontalIcon } from 'pixel-art-icons/icons/align-end-horizontal'
import { AlignStartVerticalIcon } from 'pixel-art-icons/icons/align-start-vertical'
import { AlignCenterVerticalIcon } from 'pixel-art-icons/icons/align-center-vertical'
import { AlignEndVerticalIcon } from 'pixel-art-icons/icons/align-end-vertical'
import { AlignHorizontalSpaceBetweenIcon } from 'pixel-art-icons/icons/align-horizontal-space-between'
import { AlignHorizontalSpaceAroundIcon } from 'pixel-art-icons/icons/align-horizontal-space-around'
import { AlignVerticalSpaceBetweenIcon } from 'pixel-art-icons/icons/align-vertical-space-between'
import { AlignVerticalSpaceAroundIcon } from 'pixel-art-icons/icons/align-vertical-space-around'
import { UnderlineIcon } from 'pixel-art-icons/icons/underline'
import { ClassPropertyRow } from './ClassPropertyRow'
import { TokenAwareInput } from '../PropertyControls/TokenAwareInput'
import { useSpacingTokens } from '../PropertyControls/tokenUtils'
import { getEnumOptions, getCSSPropertyDefaultValue } from './cssControlTypes'
import styles from './LayoutSection.module.css'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface LayoutSectionProps {
  currentStyles: Record<string, unknown>
  storedStyles: Record<string, unknown>
  /** Active breakpoint tab id — used to key sub-controls so they re-mount on tab change. */
  activeTab: string
  onChange: (property: keyof CSSPropertyBag, value: string | number | undefined) => void
  onRemove: (property: keyof CSSPropertyBag) => void
  /**
   * Fully clear a property — removes it from base styles AND from every
   * breakpoint override. Used by the X / clear affordances on the visual
   * switchers so "clear" is unconditional regardless of which breakpoint
   * tab the user is on. Without this, clearing a breakpoint-only override
   * would let the inherited base value bleed back through and the switcher
   * segment would stay pressed.
   */
  onClearProperty: (property: keyof CSSPropertyBag) => void
}

// ---------------------------------------------------------------------------
// LayoutSection
// ---------------------------------------------------------------------------

/**
 * Properties left over after the visual switchers — rendered as generic rows
 * below the switchers. Order follows the original Layout section list, minus
 * the properties owned by the flex block (flexDirection, flexWrap, alignItems,
 * justifyContent, gap — always absent) and the properties owned by the grid
 * block (gridTemplateColumns, gridTemplateRows, justifyItems, gap — likewise
 * never duplicated as fallback rows). The two-axis variants `rowGap` and
 * `columnGap` stay in the fallback for advanced layouts where the user
 * actually needs different row vs column spacing — the visual blocks only
 * surface the unified `gap` shorthand for the common case.
 */
const FALLBACK_PROPS: ReadonlyArray<keyof CSSPropertyBag> = [
  'alignSelf',
  'justifySelf',
  'flex',
  'rowGap',
  'columnGap',
  'gridColumn',
  'gridRow',
  'overflow',
  'overflowX',
  'overflowY',
]

/**
 * Properties that only have any effect when *this* element is a flex or
 * grid container. Hidden from the fallback rows when display is anything
 * else (block, inline, none, unset, …) so users aren't tempted to fiddle
 * with knobs that do nothing.
 *
 * `gap` itself is owned by the visual flex / grid blocks (via GapInput),
 * so it never reaches the fallback list — it's not in FALLBACK_PROPS at all.
 *
 * Item-level properties like `alignSelf`, `justifySelf`, `flex`,
 * `gridColumn`, `gridRow` are NOT in this set because they depend on the
 * *parent's* display, which we can't observe from a class-style editor.
 * Showing them unconditionally lets users style children of flex/grid
 * parents without flipping this element's display first.
 */
const CONTAINER_ONLY_PROPS = new Set<keyof CSSPropertyBag>([
  'rowGap',
  'columnGap',
])


export function LayoutSection({
  currentStyles,
  storedStyles,
  activeTab,
  onChange,
  onRemove,
  onClearProperty,
}: LayoutSectionProps) {
  const display = readString(currentStyles, 'display')
  const flexDirection = readString(currentStyles, 'flexDirection') ?? 'row'
  const flexWrap = readString(currentStyles, 'flexWrap')
  const alignItems = readString(currentStyles, 'alignItems')
  const justifyContent = readString(currentStyles, 'justifyContent')

  return (
    <div className={styles.layoutSection}>
      {/* Display switcher — unlabeled, full width */}
      <DisplaySwitcher
        value={display}
        onChange={(v) => onChange('display', v)}
        onClear={() => onClearProperty('display')}
      />

      {/* Flex-only fields, revealed when display === 'flex' */}
      {display === 'flex' && (
        <div className={styles.flexBlock}>
          <FlexDirectionControl
            value={flexDirection}
            isSet={hasStyleValue(storedStyles.flexDirection)}
            onChange={(v) => onChange('flexDirection', v)}
            onClear={() => onClearProperty('flexDirection')}
          />
          <FlexWrapControl
            value={flexWrap}
            isSet={hasStyleValue(storedStyles.flexWrap)}
            onChange={(v) => onChange('flexWrap', v)}
            onClear={() => onClearProperty('flexWrap')}
          />
          <AlignmentControl
            axis="cross"
            flexDirection={flexDirection}
            value={alignItems}
            isSet={hasStyleValue(storedStyles.alignItems)}
            onChange={(v) => onChange('alignItems', v)}
            onClear={() => onClearProperty('alignItems')}
            label="Align"
          />
          <AlignmentControl
            axis="main"
            flexDirection={flexDirection}
            value={justifyContent}
            isSet={hasStyleValue(storedStyles.justifyContent)}
            onChange={(v) => onChange('justifyContent', v)}
            onClear={() => onClearProperty('justifyContent')}
            label="Justify"
          />
          <GapInput
            value={readString(currentStyles, 'gap')}
            isSet={hasStyleValue(storedStyles.gap)}
            onChange={(v) => onChange('gap', v)}
          />
        </div>
      )}

      {/* Grid-only fields, revealed when display === 'grid' */}
      {display === 'grid' && (
        <div className={styles.flexBlock}>
          <GridTrackControl
            label="Columns"
            ariaLabel="Grid template columns"
            value={readString(currentStyles, 'gridTemplateColumns')}
            isSet={hasStyleValue(storedStyles.gridTemplateColumns)}
            onChange={(v) => onChange('gridTemplateColumns', v)}
            onClear={() => onClearProperty('gridTemplateColumns')}
          />
          <GridTrackControl
            label="Rows"
            ariaLabel="Grid template rows"
            value={readString(currentStyles, 'gridTemplateRows')}
            isSet={hasStyleValue(storedStyles.gridTemplateRows)}
            onChange={(v) => onChange('gridTemplateRows', v)}
            onClear={() => onClearProperty('gridTemplateRows')}
          />
          <GridAxisControl
            label="Align"
            axis="block"
            value={alignItems}
            isSet={hasStyleValue(storedStyles.alignItems)}
            onChange={(v) => onChange('alignItems', v)}
            onClear={() => onClearProperty('alignItems')}
          />
          <GridAxisControl
            label="Justify"
            axis="inline"
            value={readString(currentStyles, 'justifyItems')}
            isSet={hasStyleValue(storedStyles.justifyItems)}
            onChange={(v) => onChange('justifyItems', v)}
            onClear={() => onClearProperty('justifyItems')}
          />
          <GapInput
            value={readString(currentStyles, 'gap')}
            isSet={hasStyleValue(storedStyles.gap)}
            onChange={(v) => onChange('gap', v)}
          />
        </div>
      )}

      {/* Fallback rows — every property in the layout section that isn't
          already handled by a visual block. The grid block owns
          gridTemplateColumns / gridTemplateRows / justifyItems (so those
          never appear as fallback rows) and the flex block owns
          flexDirection / flexWrap / alignItems / justifyContent (likewise
          absent from FALLBACK_PROPS). Container-only properties (gap,
          rowGap, columnGap) are skipped when this element isn't a flex
          or grid container — they have no effect on `display: block` etc. */}
      {FALLBACK_PROPS.map((prop) => {
        if (
          CONTAINER_ONLY_PROPS.has(prop) &&
          display !== 'flex' &&
          display !== 'grid'
        ) {
          return null
        }
        const storedValue = storedStyles[prop]
        const isSet = hasStyleValue(storedValue)
        const currentValue = currentStyles[prop]
        const fallbackValue = hasStyleValue(currentValue)
          ? currentValue
          : getCSSPropertyDefaultValue(prop)

        return (
          <ClassPropertyRow
            key={`${activeTab}-${String(prop)}`}
            property={prop}
            value={isSet ? (storedValue as string | number) : undefined}
            placeholder={!isSet ? fallbackValue : undefined}
            isSet={isSet}
            onChange={onChange}
            onRemove={onRemove}
          />
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// DisplaySwitcher — Flex | Grid | ▼ all values
// ---------------------------------------------------------------------------

interface DisplaySwitcherProps {
  value: string | undefined
  onChange: (value: string) => void
  onClear: () => void
}

/**
 * Three visual states keyed off the current `display` value:
 *
 *   1. unset — `[ Flex | Grid | ▼ ]` segmented row, no segment pressed.
 *   2. flex / grid — same row, the matching segment pressed. Hovering the
 *      pressed segment reveals a close-icon overlay; clicking it clears
 *      the property (`onClear()`).
 *   3. other value (block, inline-block, none, …) — the segmented row is
 *      replaced by a full-width chip showing the current value alongside
 *      a square close button that clears it. Clicking the chip itself
 *      reopens the dropdown so users can pick a different value.
 *
 * The chevron-down trailing button always opens a ContextMenu listing every
 * `display` value from cssControlTypes.ts so power users can reach values
 * not promoted to the primary segments.
 */
function DisplaySwitcher({ value, onChange, onClear }: DisplaySwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const allOptions = useMemo(() => getEnumOptions('display') ?? ['block'], [])
  const isOtherValue = value != null && value !== '' && value !== 'flex' && value !== 'grid'

  const menu = menuOpen ? (
    <ContextMenu
      anchorRef={triggerRef}
      triggerRef={triggerRef}
      align="end"
      side="bottom"
      offset={6}
      ariaLabel="Display values"
      onClose={() => setMenuOpen(false)}
    >
      {allOptions.map((opt) => (
        <ContextMenuItem
          key={opt}
          role="menuitemradio"
          aria-checked={value === opt}
          active={value === opt}
          onClick={() => {
            onChange(opt)
            setMenuOpen(false)
          }}
        >
          {opt}
        </ContextMenuItem>
      ))}
    </ContextMenu>
  ) : null

  // ── Other-value state — full-width chip + close button ───────────────────
  if (isOtherValue) {
    return (
      <div
        className={styles.displayRow}
        data-testid="css-display-switcher"
        data-display-value={value ?? ''}
      >
        <div className={styles.displayChipGroup}>
          <Button
            ref={triggerRef}
            variant="secondary"
            size="sm"
            fullWidth
            align="start"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`Display: ${value}`}
            tooltip="Change display value"
            className={styles.displayChip}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className={styles.displayChipKicker}>display</span>
            <span className={styles.displayChipValue}>{value}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            aria-label={`Clear display (${value})`}
            tooltip="Clear display"
            className={styles.displayChipClear}
            onClick={onClear}
          >
            <CloseIcon size={14} color="currentColor" />
          </Button>
        </div>
        {menu}
      </div>
    )
  }

  // ── Unset / flex / grid state — segmented control ────────────────────────
  return (
    <div
      className={styles.displayRow}
      data-testid="css-display-switcher"
      data-display-value={value ?? ''}
    >
      <SegmentedControl
        fullWidth
        aria-label="Display"
        value={value === 'flex' || value === 'grid' ? value : undefined}
        onChange={onChange}
        onClear={onClear}
        options={[
          {
            value: 'flex',
            label: 'Flex',
            icon: <LayoutIcon size={14} />,
            ariaLabel: 'Flex layout',
            tooltip: 'display: flex',
          },
          {
            value: 'grid',
            label: 'Grid',
            icon: <Grid2x22Icon size={14} />,
            ariaLabel: 'Grid layout',
            tooltip: 'display: grid',
          },
        ]}
        trailing={({ trailingClassName }) => (
          <Button
            ref={triggerRef}
            variant="secondary"
            size="sm"
            iconOnly
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="More display values"
            tooltip="More display values"
            className={trailingClassName}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <ChevronDownIcon size={14} color="currentColor" />
          </Button>
        )}
      />
      {menu}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FlexDirectionControl
// ---------------------------------------------------------------------------

interface FlexDirectionControlProps {
  value: string | undefined
  isSet: boolean
  onChange: (value: string) => void
  onClear: () => void
}

function FlexDirectionControl({ value, isSet, onChange, onClear }: FlexDirectionControlProps) {
  return (
    <LabeledControl label="Direction" isSet={isSet}>
      <SegmentedControl
        fullWidth
        aria-label="Flex direction"
        value={value}
        onChange={onChange}
        onClear={onClear}
        options={[
          {
            value: 'row',
            icon: <ArrowRightIcon size={14} />,
            ariaLabel: 'Row',
            tooltip: 'row',
          },
          {
            value: 'column',
            icon: <ArrowDownIcon size={14} />,
            ariaLabel: 'Column',
            tooltip: 'column',
          },
          {
            value: 'row-reverse',
            icon: <ArrowLeftIcon size={14} />,
            ariaLabel: 'Row reverse',
            tooltip: 'row-reverse',
          },
          {
            value: 'column-reverse',
            icon: <ArrowUpIcon size={14} />,
            ariaLabel: 'Column reverse',
            tooltip: 'column-reverse',
          },
        ]}
      />
    </LabeledControl>
  )
}

// ---------------------------------------------------------------------------
// FlexWrapControl
// ---------------------------------------------------------------------------

interface FlexWrapControlProps {
  value: string | undefined
  isSet: boolean
  onChange: (value: string) => void
  onClear: () => void
}

function FlexWrapControl({ value, isSet, onChange, onClear }: FlexWrapControlProps) {
  return (
    <LabeledControl label="Wrap" isSet={isSet}>
      <SegmentedControl
        fullWidth
        aria-label="Flex wrap"
        value={value}
        onChange={onChange}
        onClear={onClear}
        options={[
          {
            value: 'nowrap',
            label: 'No',
            ariaLabel: 'No wrap',
            tooltip: 'nowrap',
          },
          {
            value: 'wrap',
            icon: <TextWrapIcon size={14} />,
            ariaLabel: 'Wrap',
            tooltip: 'wrap',
          },
          {
            value: 'wrap-reverse',
            label: 'Rev',
            ariaLabel: 'Wrap reverse',
            tooltip: 'wrap-reverse',
          },
        ]}
      />
    </LabeledControl>
  )
}

// ---------------------------------------------------------------------------
// AlignmentControl — align-items (cross axis) and justify-content (main axis)
// ---------------------------------------------------------------------------

type AlignAxis = 'cross' | 'main'

interface AlignmentControlProps {
  axis: AlignAxis
  flexDirection: string
  value: string | undefined
  isSet: boolean
  onChange: (value: string) => void
  onClear: () => void
  label: string
}

function AlignmentControl({
  axis,
  flexDirection,
  value,
  isSet,
  onChange,
  onClear,
  label,
}: AlignmentControlProps) {
  // The icon set is keyed off the *main-axis* orientation:
  //   - direction: row | row-reverse        → main is horizontal, cross is vertical
  //   - direction: column | column-reverse  → main is vertical,   cross is horizontal
  // Both MAIN and CROSS arrays are named after the direction items flow
  // (i.e. the main axis), so we just pick the matching pair.
  const isMainHorizontal =
    flexDirection === 'row' || flexDirection === 'row-reverse'

  const options = isMainHorizontal
    ? axis === 'main'
      ? MAIN_HORIZONTAL_OPTIONS
      : CROSS_HORIZONTAL_OPTIONS
    : axis === 'main'
      ? MAIN_VERTICAL_OPTIONS
      : CROSS_VERTICAL_OPTIONS

  return (
    <LabeledControl label={label} isSet={isSet}>
      <SegmentedControl
        fullWidth
        aria-label={axis === 'main' ? 'Justify content' : 'Align items'}
        value={value}
        onChange={onChange}
        onClear={onClear}
        options={options}
      />
    </LabeledControl>
  )
}

// ---------------------------------------------------------------------------
// GapInput — token-aware text input for `gap` (writes the unified shorthand)
// ---------------------------------------------------------------------------

interface GapInputProps {
  value: string | undefined
  isSet: boolean
  onChange: (value: string | undefined) => void
}

/**
 * Promotes the `gap` row out of the fallback list and into the flex / grid
 * blocks where it belongs (right below Justify). Backed by `TokenAwareInput`
 * so users get framework spacing variable autocomplete as they type — same
 * vocabulary as the SpacingBoxControl side inputs.
 */
function GapInput({ value, isSet, onChange }: GapInputProps) {
  const tokens = useSpacingTokens()
  return (
    <LabeledControl label="Gap" isSet={isSet}>
      <TokenAwareInput
        aria-label="Gap"
        value={value}
        placeholder="0px"
        tokens={tokens}
        onCommit={onChange}
      />
    </LabeledControl>
  )
}

/**
 * Cross-axis (alignItems) icon set when items flow horizontally — items align
 * along the vertical (cross) axis. The horizontal-row icon family expresses
 * "horizontal items aligned to start/center/end of their vertical track."
 */
const CROSS_HORIZONTAL_OPTIONS = [
  {
    value: 'flex-start',
    icon: <AlignStartHorizontalIcon size={14} />,
    ariaLabel: 'Align start',
    tooltip: 'align-items: flex-start',
  },
  {
    value: 'center',
    icon: <AlignCenterHorizontalIcon size={14} />,
    ariaLabel: 'Align center',
    tooltip: 'align-items: center',
  },
  {
    value: 'flex-end',
    icon: <AlignEndHorizontalIcon size={14} />,
    ariaLabel: 'Align end',
    tooltip: 'align-items: flex-end',
  },
  {
    value: 'stretch',
    icon: <ArrowsVerticalIcon size={14} />,
    ariaLabel: 'Align stretch',
    tooltip: 'align-items: stretch',
  },
  {
    value: 'baseline',
    icon: <UnderlineIcon size={14} />,
    ariaLabel: 'Align baseline',
    tooltip: 'align-items: baseline',
  },
] as const

/** Cross-axis when items flow vertically — items align along the horizontal axis. */
const CROSS_VERTICAL_OPTIONS = [
  {
    value: 'flex-start',
    icon: <AlignStartVerticalIcon size={14} />,
    ariaLabel: 'Align start',
    tooltip: 'align-items: flex-start',
  },
  {
    value: 'center',
    icon: <AlignCenterVerticalIcon size={14} />,
    ariaLabel: 'Align center',
    tooltip: 'align-items: center',
  },
  {
    value: 'flex-end',
    icon: <AlignEndVerticalIcon size={14} />,
    ariaLabel: 'Align end',
    tooltip: 'align-items: flex-end',
  },
  {
    value: 'stretch',
    icon: <ArrowsHorizontalIcon size={14} />,
    ariaLabel: 'Align stretch',
    tooltip: 'align-items: stretch',
  },
  {
    value: 'baseline',
    icon: <UnderlineIcon size={14} />,
    ariaLabel: 'Align baseline',
    tooltip: 'align-items: baseline',
  },
] as const

/**
 * Main-axis (justifyContent) icon set when items flow horizontally — they
 * justify along the horizontal axis.
 *
 * The first three values (flex-start / center / flex-end) reuse the same
 * alignment-line icons that Grid's Justify control uses for its
 * `justify-items` segments, so the visual language stays consistent across
 * Flex and Grid for the values both layouts share. The flex-only
 * `space-between` / `space-around` keep the distribution-style icons since
 * Grid's `justify-items` has no equivalent.
 */
const MAIN_HORIZONTAL_OPTIONS = [
  {
    value: 'flex-start',
    icon: <AlignStartVerticalIcon size={14} />,
    ariaLabel: 'Justify start',
    tooltip: 'justify-content: flex-start',
  },
  {
    value: 'center',
    icon: <AlignCenterVerticalIcon size={14} />,
    ariaLabel: 'Justify center',
    tooltip: 'justify-content: center',
  },
  {
    value: 'flex-end',
    icon: <AlignEndVerticalIcon size={14} />,
    ariaLabel: 'Justify end',
    tooltip: 'justify-content: flex-end',
  },
  {
    value: 'space-between',
    icon: <AlignHorizontalSpaceBetweenIcon size={14} />,
    ariaLabel: 'Space between',
    tooltip: 'justify-content: space-between',
  },
  {
    value: 'space-around',
    icon: <AlignHorizontalSpaceAroundIcon size={14} />,
    ariaLabel: 'Space around',
    tooltip: 'justify-content: space-around',
  },
] as const

/** Main-axis when items flow vertically — they justify along the vertical axis. */
const MAIN_VERTICAL_OPTIONS = [
  {
    value: 'flex-start',
    icon: <AlignStartHorizontalIcon size={14} />,
    ariaLabel: 'Justify start',
    tooltip: 'justify-content: flex-start',
  },
  {
    value: 'center',
    icon: <AlignCenterHorizontalIcon size={14} />,
    ariaLabel: 'Justify center',
    tooltip: 'justify-content: center',
  },
  {
    value: 'flex-end',
    icon: <AlignEndHorizontalIcon size={14} />,
    ariaLabel: 'Justify end',
    tooltip: 'justify-content: flex-end',
  },
  {
    value: 'space-between',
    icon: <AlignVerticalSpaceBetweenIcon size={14} />,
    ariaLabel: 'Space between',
    tooltip: 'justify-content: space-between',
  },
  {
    value: 'space-around',
    icon: <AlignVerticalSpaceAroundIcon size={14} />,
    ariaLabel: 'Space around',
    tooltip: 'justify-content: space-around',
  },
] as const

// ---------------------------------------------------------------------------
// GridTrackControl — quick column / row count picker for `grid-template-*`
// ---------------------------------------------------------------------------

/**
 * Common track counts surfaced as primary segments. Picking N writes
 * `repeat(N, 1fr)` to the property — covering 95% of real-world layouts
 * without touching the underlying CSS shorthand. 1 is intentionally
 * omitted because a single full-width track is just the default block
 * flow and doesn't need a dedicated grid control. Custom track templates
 * (named tracks, mixed sizing, subgrid, single tracks, …) fall back to
 * the inline text input revealed via the trailing chevron.
 */
const GRID_PRESETS = [2, 3, 4, 5, 6] as const

interface GridTrackControlProps {
  label: string
  ariaLabel: string
  value: string | undefined
  isSet: boolean
  onChange: (value: string) => void
  onClear: () => void
}

/**
 * Three visual states — same shape as DisplaySwitcher so the language is
 * consistent across the section:
 *
 *   1. unset / preset-count — segmented `[1 | 2 | 3 | 4 | 5 | 6 | ⋯]` with
 *      the matching count pressed (or none). Hovering a pressed segment
 *      shows the X overlay; clicking it clears the property entirely.
 *   2. custom value — full-width chip showing the raw template (e.g.
 *      `200px 1fr 200px`) with a square close button. Clicking the chip
 *      enters edit mode.
 *   3. edit mode — text input replacing the row. Enter / blur applies,
 *      Escape cancels. Toggleable via the trailing chevron in state #1
 *      or by clicking the chip body in state #2.
 */
function GridTrackControl({
  label,
  ariaLabel,
  value,
  isSet,
  onChange,
  onClear,
}: GridTrackControlProps) {
  const presetN = parseGridRepeat(value)
  const isPreset =
    presetN != null && (GRID_PRESETS as ReadonlyArray<number>).includes(presetN)
  const isCustomValue = value != null && value !== '' && !isPreset

  // Local state for the inline text-input edit mode.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  // Whenever the canonical value changes externally (e.g. a different node
  // selected, undo, or a sibling control), drop any stale draft so the next
  // entry into edit mode starts from the current value.
  if (!editing && draft !== (value ?? '')) {
    setDraft(value ?? '')
  }

  function enterEditMode() {
    setDraft(value ?? '')
    setEditing(true)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function commitDraft() {
    const trimmed = draft.trim()
    setEditing(false)
    if (trimmed === '') {
      if (value != null && value !== '') onClear()
      return
    }
    if (trimmed === value) return
    onChange(trimmed)
  }

  function cancelDraft() {
    setEditing(false)
    setDraft(value ?? '')
  }

  // ── Edit mode — inline text input ─────────────────────────────────────────
  if (editing) {
    return (
      <LabeledControl label={label} isSet={isSet}>
        <div className={styles.gridEditRow}>
          <Input
            ref={inputRef}
            fieldSize="sm"
            aria-label={`${ariaLabel} (custom)`}
            placeholder="repeat(3, 1fr) · 200px 1fr · …"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitDraft()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                cancelDraft()
              }
            }}
          />
        </div>
      </LabeledControl>
    )
  }

  // ── Custom-value state — chip + close ─────────────────────────────────────
  if (isCustomValue) {
    return (
      <LabeledControl label={label} isSet={isSet}>
        <div className={styles.displayChipGroup}>
          <Button
            variant="secondary"
            size="sm"
            fullWidth
            align="start"
            aria-label={`${ariaLabel}: ${value}`}
            tooltip="Edit track template"
            className={styles.displayChip}
            onClick={enterEditMode}
          >
            <span className={styles.displayChipValue}>{value}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            aria-label={`Clear ${ariaLabel}`}
            tooltip={`Clear ${label.toLowerCase()}`}
            className={styles.displayChipClear}
            onClick={onClear}
          >
            <CloseIcon size={14} color="currentColor" />
          </Button>
        </div>
      </LabeledControl>
    )
  }

  // ── Preset-count state — segmented [2 | 3 | 4 | 5 | 6 | ⋯] ─────────────
  return (
    <LabeledControl label={label} isSet={isSet}>
      <SegmentedControl
        fullWidth
        aria-label={ariaLabel}
        value={isPreset ? String(presetN) : undefined}
        onChange={(s) => onChange(`repeat(${s}, 1fr)`)}
        onClear={onClear}
        options={GRID_PRESETS.map((n) => ({
          value: String(n),
          label: String(n),
          ariaLabel: `${n} tracks`,
          tooltip: `repeat(${n}, 1fr)`,
        }))}
        trailing={({ trailingClassName }) => (
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            aria-label="Custom track template"
            tooltip="Custom track template"
            className={trailingClassName}
            onClick={enterEditMode}
          >
            <ChevronDownIcon size={14} color="currentColor" />
          </Button>
        )}
      />
    </LabeledControl>
  )
}

// ---------------------------------------------------------------------------
// GridAxisControl — alignItems / justifyItems for grid containers
// ---------------------------------------------------------------------------

interface GridAxisControlProps {
  label: string
  /** 'block' = alignItems (vertical), 'inline' = justifyItems (horizontal). */
  axis: 'block' | 'inline'
  value: string | undefined
  isSet: boolean
  onChange: (value: string) => void
  onClear: () => void
}

/**
 * Reuses the flex CROSS_HORIZONTAL_OPTIONS / CROSS_VERTICAL_OPTIONS icon
 * sets — same `flex-start | center | flex-end | stretch | baseline` value
 * keywords work in both flex and grid containers per CSS Box Alignment
 * Module 3 (self-position keywords). The single source of truth keeps
 * the visual language consistent when users toggle display modes on a
 * class that already has alignItems set.
 */
function GridAxisControl({ label, axis, value, isSet, onChange, onClear }: GridAxisControlProps) {
  // alignItems (block axis) → items are stacked vertically inside their cell;
  // visualised via horizontal-row icons (start = top, end = bottom).
  // justifyItems (inline axis) → items spread horizontally; visualised via
  // vertical-column icons (start = left, end = right).
  const options = axis === 'block' ? CROSS_HORIZONTAL_OPTIONS : CROSS_VERTICAL_OPTIONS
  return (
    <LabeledControl label={label} isSet={isSet}>
      <SegmentedControl
        fullWidth
        aria-label={axis === 'block' ? 'Align items' : 'Justify items'}
        value={value}
        onChange={onChange}
        onClear={onClear}
        options={options}
      />
    </LabeledControl>
  )
}

// ---------------------------------------------------------------------------
// LabeledControl — small label + control row used by the flex / grid sub-fields
// ---------------------------------------------------------------------------

interface LabeledControlProps {
  label: string
  /**
   * Whether the underlying CSS property has a value set. Toggles the label
   * between brighter (set) and muted (unset) — same set/unset language as
   * ClassPropertyRow so visual switchers and generic property rows share a
   * single visual cue for "this property is/isn't set".
   */
  isSet?: boolean
  children: ReactNode
}

function LabeledControl({ label, isSet, children }: LabeledControlProps) {
  return (
    <div className={styles.labeledRow} data-state={isSet ? 'set' : 'unset'}>
      <span className={styles.labeledLabel}>{label}</span>
      <div className={styles.labeledControl}>{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readString(styles: Record<string, unknown>, key: string): string | undefined {
  const v = styles[key]
  if (typeof v === 'string' && v !== '') return v
  return undefined
}

function hasStyleValue(value: unknown): value is string | number {
  return value !== undefined && value !== null && value !== ''
}

/**
 * Parse a `repeat(N, 1fr)` template into its track count `N`. Returns null
 * for any other shape (custom templates, named tracks, mixed sizing,
 * subgrid, etc.) so GridTrackControl can fall back to its custom-value
 * states. Whitespace tolerant — `repeat( 3 , 1fr )` still parses.
 */
function parseGridRepeat(value: string | undefined): number | null {
  if (!value) return null
  const m = value.trim().match(/^repeat\(\s*(\d+)\s*,\s*1fr\s*\)$/)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 && n <= 99 ? n : null
}
