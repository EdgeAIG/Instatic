/**
 * PositionSection — visual editor for the `position` CSS section.
 *
 * Replaces the long stack of generic ClassPropertyRow widgets for
 * position / top / right / bottom / left / zIndex with task-shaped
 * controls:
 *
 *   • PositionSwitcher  — connected `[Relative | Absolute | ▼]` segmented
 *                         control with a dropdown trail. `fixed | sticky |
 *                         static` (and any custom value) fall through to a
 *                         full-width chip + close-button layout, mirroring
 *                         DisplaySwitcher's three-state shape.
 *   • DirectionInput    — compact icon-as-label cell for one offset
 *                         (top/right/bottom/left). Four cells render in
 *                         a 2-column TRBL grid that's only revealed when
 *                         the position value actually honors offsets
 *                         (relative / absolute / fixed / sticky — i.e. not
 *                         static, not unset).
 *   • zIndex row        — always rendered as a generic ClassPropertyRow at
 *                         the bottom of the section. Stays visible even
 *                         when position is unset/static so users can
 *                         still poke at stacking context the rare cases
 *                         it matters outside positioning.
 *
 * Reuses chip / track styles from LayoutSection.module.css so the visual
 * vocabulary stays in one place — `displayRow`, `displayChipGroup`, etc.
 */

import { useRef, useState } from 'react'
import type { IconComponent } from 'pixel-art-icons/types'
import type { CSSPropertyBag } from '@core/page-tree/schemas'
import { Button } from '@ui/components/Button'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { SegmentedControl } from '@ui/components/SegmentedControl'
import { ChevronDownIcon } from 'pixel-art-icons/icons/chevron-down'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { ArrowBarUpIcon } from 'pixel-art-icons/icons/arrow-bar-up'
import { ArrowBarRightIcon } from 'pixel-art-icons/icons/arrow-bar-right'
import { ArrowBarDownIcon } from 'pixel-art-icons/icons/arrow-bar-down'
import { ArrowBarLeftIcon } from 'pixel-art-icons/icons/arrow-bar-left'
import { ClassPropertyRow } from './ClassPropertyRow'
import { TokenAwareInput } from '../PropertyControls/TokenAwareInput'
import { useSpacingTokens, type Token } from '../PropertyControls/tokenUtils'
import { getCSSPropertyDefaultValue } from './cssControlTypes'
import styles from './LayoutSection.module.css'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

interface PositionSectionProps {
  currentStyles: Record<string, unknown>
  storedStyles: Record<string, unknown>
  /** Active breakpoint tab id — used to key sub-controls so they re-mount on tab change. */
  activeTab: string
  onChange: (property: keyof CSSPropertyBag, value: string | number | undefined) => void
  onRemove: (property: keyof CSSPropertyBag) => void
  /** Fully clear a property — see ClassComposer.handleClearProperty. */
  onClearProperty: (property: keyof CSSPropertyBag) => void
}

/** Position values that honor top/right/bottom/left and reveal the
 *  directions block. `static` is intentionally excluded because static
 *  elements ignore those offsets. */
const POSITIONED_VALUES = new Set(['relative', 'absolute', 'fixed', 'sticky'])

// ---------------------------------------------------------------------------
// PositionSection
// ---------------------------------------------------------------------------

export function PositionSection({
  currentStyles,
  storedStyles,
  activeTab,
  onChange,
  onRemove,
  onClearProperty,
}: PositionSectionProps) {
  const position = readString(currentStyles, 'position')
  const positionIsActive = position != null && POSITIONED_VALUES.has(position)

  const zIndexStored = storedStyles.zIndex
  const zIndexIsSet = hasStyleValue(zIndexStored)
  const zIndexCurrent = currentStyles.zIndex
  const zIndexFallback = hasStyleValue(zIndexCurrent)
    ? zIndexCurrent
    : getCSSPropertyDefaultValue('zIndex')

  // Spacing tokens drive the autocomplete dropdown on each offset input —
  // same vocabulary the SpacingBoxControl side inputs use, surfaced via
  // the shared TokenAwareInput primitive.
  const spacingTokens = useSpacingTokens()

  return (
    <>
      <PositionSwitcher
        value={position}
        onChange={(v) => onChange('position', v)}
        onClear={() => onClearProperty('position')}
      />
      {positionIsActive && (
        <div className={styles.positionDirectionsGrid}>
          <DirectionInput
            property="top"
            icon={ArrowBarUpIcon}
            ariaLabel="Top offset"
            storedValue={storedStyles.top}
            currentValue={currentStyles.top}
            tokens={spacingTokens}
            onChange={onChange}
            onClear={onClearProperty}
          />
          <DirectionInput
            property="right"
            icon={ArrowBarRightIcon}
            ariaLabel="Right offset"
            storedValue={storedStyles.right}
            currentValue={currentStyles.right}
            tokens={spacingTokens}
            onChange={onChange}
            onClear={onClearProperty}
          />
          <DirectionInput
            property="bottom"
            icon={ArrowBarDownIcon}
            ariaLabel="Bottom offset"
            storedValue={storedStyles.bottom}
            currentValue={currentStyles.bottom}
            tokens={spacingTokens}
            onChange={onChange}
            onClear={onClearProperty}
          />
          <DirectionInput
            property="left"
            icon={ArrowBarLeftIcon}
            ariaLabel="Left offset"
            storedValue={storedStyles.left}
            currentValue={currentStyles.left}
            tokens={spacingTokens}
            onChange={onChange}
            onClear={onClearProperty}
          />
        </div>
      )}
      {/* z-index row — always visible inside the section. Stacking context
          can matter even on otherwise non-positioned elements (e.g. flex
          items, grid items) so the row stays available regardless of the
          current position keyword. */}
      <ClassPropertyRow
        key={`${activeTab}-zIndex`}
        property="zIndex"
        value={zIndexIsSet ? (zIndexStored as string | number) : undefined}
        placeholder={!zIndexIsSet ? zIndexFallback : undefined}
        isSet={zIndexIsSet}
        onChange={onChange}
        onRemove={onRemove}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// PositionSwitcher — Relative | Absolute | ▼ all values
// ---------------------------------------------------------------------------

interface PositionSwitcherProps {
  value: string | undefined
  onChange: (value: string) => void
  onClear: () => void
}

const POSITION_OPTIONS = ['static', 'relative', 'absolute', 'fixed', 'sticky'] as const

/**
 * Mirrors DisplaySwitcher's three-state shape:
 *
 *   1. unset — `[ Relative | Absolute | ▼ ]`, nothing pressed.
 *   2. relative / absolute — segmented row, matching segment pressed +
 *      hover-X clears the property.
 *   3. other value (fixed / sticky / static) — full-width chip showing
 *      the current value with a square close button. Clicking the chip
 *      body reopens the dropdown so users can switch values.
 */
function PositionSwitcher({ value, onChange, onClear }: PositionSwitcherProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const isPrimary = value === 'relative' || value === 'absolute'
  const isOtherValue = value != null && value !== '' && !isPrimary

  const menu = menuOpen ? (
    <ContextMenu
      anchorRef={triggerRef}
      triggerRef={triggerRef}
      align="end"
      side="bottom"
      offset={6}
      ariaLabel="Position values"
      onClose={() => setMenuOpen(false)}
    >
      {POSITION_OPTIONS.map((opt) => (
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

  // ── Other-value state — chip + close ─────────────────────────────────────
  if (isOtherValue) {
    return (
      <div
        className={styles.displayRow}
        data-testid="css-position-switcher"
        data-position-value={value ?? ''}
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
            aria-label={`Position: ${value}`}
            tooltip="Change position value"
            className={styles.displayChip}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className={styles.displayChipKicker}>position</span>
            <span className={styles.displayChipValue}>{value}</span>
          </Button>
          <Button
            variant="secondary"
            size="sm"
            iconOnly
            aria-label={`Clear position (${value})`}
            tooltip="Clear position"
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

  // ── Unset / relative / absolute — segmented control ──────────────────────
  return (
    <div
      className={styles.displayRow}
      data-testid="css-position-switcher"
      data-position-value={value ?? ''}
    >
      <SegmentedControl
        fullWidth
        aria-label="Position"
        value={isPrimary ? value : undefined}
        onChange={onChange}
        onClear={onClear}
        options={[
          {
            value: 'relative',
            label: 'Relative',
            ariaLabel: 'Position relative',
            tooltip: 'position: relative',
          },
          {
            value: 'absolute',
            label: 'Absolute',
            ariaLabel: 'Position absolute',
            tooltip: 'position: absolute',
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
            aria-label="More position values"
            tooltip="More position values"
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
// DirectionInput — icon-as-label numeric/text input for top/right/bottom/left
// ---------------------------------------------------------------------------

interface DirectionInputProps {
  property: keyof CSSPropertyBag
  icon: IconComponent
  ariaLabel: string
  storedValue: unknown
  currentValue: unknown
  /** Spacing tokens to suggest in the autocomplete dropdown. */
  tokens: ReadonlyArray<Token>
  onChange: (property: keyof CSSPropertyBag, value: string | number | undefined) => void
  onClear: (property: keyof CSSPropertyBag) => void
}

function DirectionInput({
  property,
  icon: Icon,
  ariaLabel,
  storedValue,
  currentValue,
  tokens,
  onChange,
  onClear,
}: DirectionInputProps) {
  const isSet = hasStyleValue(storedValue)
  const placeholder = !isSet
    ? hasStyleValue(currentValue)
      ? String(currentValue)
      : 'auto'
    : undefined

  return (
    <div
      className={styles.directionCell}
      data-state={isSet ? 'set' : 'unset'}
      data-testid={`css-direction-input-${String(property)}`}
    >
      <span className={styles.directionIcon} aria-hidden="true">
        <Icon size={14} />
      </span>
      <TokenAwareInput
        aria-label={ariaLabel}
        value={isSet ? String(storedValue) : undefined}
        placeholder={placeholder}
        tokens={tokens}
        onCommit={(resolved) => onChange(property, resolved)}
        className={styles.directionInput}
      />
      {isSet && (
        <Button
          variant="ghost"
          size="micro"
          iconOnly
          aria-label={`Clear ${ariaLabel}`}
          tooltip={`Clear ${ariaLabel.toLowerCase()}`}
          onClick={() => onClear(property)}
          className={styles.directionClearBtn}
        >
          <CloseIcon size={12} color="currentColor" />
        </Button>
      )}
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
