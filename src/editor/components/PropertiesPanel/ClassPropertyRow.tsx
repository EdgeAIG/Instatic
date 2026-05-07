/**
 * ClassPropertyRow — unified CSS property editing row.
 *
 * Renders a single CSSPropertyBag entry as a typed control row.
 * Uses the SAME property-control components as the Module section
 * (TextControl / ColorControl / SelectControl),
 * producing byte-identical DOM + className tokens (PP-18 acceptance criterion).
 *
 * A remove button is overlaid on each row via position:absolute so the
 * control itself is visually unchanged from a module property row.
 *
 * Phase 3 / Task #464 / Spec #671.
 */

import { useCallback } from 'react'
import type { CSSPropertyBag } from '@core/page-tree/schemas'
import { TextControl } from '../PropertyControls/TextControl'
import { ColorControl } from '../PropertyControls/ColorControl'
import { SelectControl } from '../PropertyControls/SelectControl'
import { ControlRow } from '../PropertyControls/ControlRow'
import { TokenAwareInput } from '../PropertyControls/TokenAwareInput'
import {
  useSpacingTokens,
  useTypographyTokens,
  type Token,
} from '../PropertyControls/tokenUtils'
import { Button } from '@ui/components/Button'
import { CloseIcon } from 'pixel-art-icons/icons/close'
import { cn } from '@ui/cn'
import {
  getCSSPropertyControlType,
  getCSSPropertyTokenSource,
  getEnumOptions,
  cssPropertyLabel,
  NUMBER_TYPED_PROPS,
} from './cssControlTypes'
import styles from './ClassPropertyRow.module.css'

// ---------------------------------------------------------------------------
// ClassPropertyRow
// ---------------------------------------------------------------------------

interface ClassPropertyRowProps {
  property: keyof CSSPropertyBag
  value: string | number | undefined
  placeholder?: string | number
  isSet?: boolean
  onChange: (property: keyof CSSPropertyBag, value: string | number | undefined) => void
  onRemove: (property: keyof CSSPropertyBag) => void
}

export function ClassPropertyRow({
  property,
  value,
  placeholder,
  isSet = true,
  onChange,
  onRemove,
}: ClassPropertyRowProps) {
  const type = getCSSPropertyControlType(property)
  const tokenSource = getCSSPropertyTokenSource(property)
  const label = cssPropertyLabel(String(property))
  const placeholderText = placeholder !== undefined ? String(placeholder) : undefined

  // Always read both token catalogs — hooks must run unconditionally on
  // every render. The selected catalog is forwarded to TokenAwareInput
  // when the property has a `tokenSource`, otherwise it's unused (no cost).
  const spacingTokens = useSpacingTokens()
  const typographyTokens = useTypographyTokens()
  const tokens: ReadonlyArray<Token> =
    tokenSource === 'typography'
      ? typographyTokens
      : tokenSource === 'spacing'
        ? spacingTokens
        : []

  // Translate a control's (propKey, val) onChange signature into a typed
  // CSSPropertyBag value, coercing to number when the property expects one.
  const handleControlChange = useCallback(
    (_key: string, val: unknown) => {
      const nextValue = String(val ?? '')
      if (NUMBER_TYPED_PROPS.has(property)) {
        const parsed = Number(nextValue)
        onChange(property, Number.isFinite(parsed) && nextValue.trim() !== '' ? parsed : undefined)
        return
      }
      onChange(property, nextValue)
    },
    [property, onChange],
  )

  // Token-aware properties commit on blur via TokenAwareInput's `onCommit`.
  // It already returns undefined for empty input (clears the value), so
  // the only translation we do here is the number-typed coercion.
  const handleTokenCommit = useCallback(
    (resolved: string | undefined) => {
      if (NUMBER_TYPED_PROPS.has(property)) {
        if (resolved == null || resolved === '') {
          onChange(property, undefined)
          return
        }
        const parsed = Number(resolved)
        onChange(property, Number.isFinite(parsed) ? parsed : resolved)
        return
      }
      onChange(property, resolved)
    },
    [property, onChange],
  )

  // ── Dispatch to the correct control ─────────────────────────────────────
  // Each control renders with its own .controlWrapper so the row is
  // visually identical to a module property row (PP-18). When the property
  // has a framework variable scale (`tokenSource`), the token-aware input
  // takes precedence over the generic text/select dispatch below.
  let control: React.ReactNode

  if (tokenSource) {
    control = (
      <ControlRow propKey={String(property)} label={label}>
        <TokenAwareInput
          aria-label={label}
          value={value !== undefined ? String(value) : undefined}
          placeholder={placeholderText}
          tokens={tokens}
          onCommit={handleTokenCommit}
        />
      </ControlRow>
    )
  } else switch (type) {
    case 'color':
      control = (
        <ColorControl
          key={`${String(property)}-${String(value ?? '')}`}
          propKey={String(property)}
          value={String(value ?? '')}
          placeholder={placeholderText}
          onChange={handleControlChange}
          label={label}
        />
      )
      break

    case 'select': {
      const opts = getEnumOptions(property) ?? []
      control = (
        <SelectControl
          propKey={String(property)}
          value={String(value ?? '')}
          placeholder={placeholderText}
          onChange={handleControlChange}
          label={label}
          options={[
            { label: '—', value: '' },
            ...opts.map((o) => ({ label: o, value: o })),
          ]}
        />
      )
      break
    }

    case 'text':
    default:
      control = (
        <TextControl
          propKey={String(property)}
          value={String(value ?? '')}
          placeholder={placeholderText}
          onChange={handleControlChange}
          label={label}
        />
      )
      break
  }

  return (
    <div
      className={cn(styles.propertyRowWrap, !isSet && styles.propertyRowUnset)}
      data-state={isSet ? 'set' : 'unset'}
      data-testid={`css-property-row-${String(property)}`}
    >
      {/* Control renders with its own .controlWrapper — identical to module rows (PP-18) */}
      {control}

      {/* Remove button: overlaid on the label column; revealed on hover/focus-within */}
      {isSet && (
        <Button
          variant="ghost"
          size="micro"
          iconOnly
          onClick={() => onRemove(property)}
          aria-label={`Remove ${label} property`}
          tooltip={`Remove ${label}`}
          className={styles.removeBtn}
        >
          <CloseIcon size={16} color="currentColor" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}
