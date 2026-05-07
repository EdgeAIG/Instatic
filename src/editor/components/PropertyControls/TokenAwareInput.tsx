/**
 * TokenAwareInput — a single text input + autocomplete dropdown that
 * suggests framework variables (spacing scale, typography scale, …).
 *
 * Visual / behavioural model is identical to the SpacingBoxControl side
 * input, just decoupled from the box-model UI:
 *
 *   - User types `m` → menu shows tokens whose step starts with `m`.
 *   - Picking `m` (Enter / click) commits `var(--space-m)` (or whichever
 *     `valueExpr` the matching token carries).
 *   - Typing a direct CSS value (`12px`, `auto`, `calc(...)`) hides the
 *     menu so the value can be committed without the dropdown stealing
 *     outside-clicks.
 *   - As-you-type live preview through `onPreview` / `onClearPreview`.
 *   - Stored `var(--space-m)` round-trips back to the short `m` display.
 *
 * The component is presentation-only — token sourcing (spacing vs
 * typography vs sizing scale) is the caller's choice via the `tokens`
 * prop, populated by hooks from `tokenUtils.ts`.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { Input } from '@ui/components/Input'
import { ContextMenu, ContextMenuItem } from '@ui/components/ContextMenu'
import { useEditorPreference } from '@editor/preferences/editorPreferences'
import { cn } from '@ui/cn'
import {
  type Token,
  resolveTokenValue,
  displayTokenValue,
  looksLikeDirectValue,
  isLivePreviewable,
} from './tokenUtils'
import styles from './TokenAwareInput.module.css'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TokenAwareInputHandle {
  /** Focus the underlying input. */
  focus(): void
}

interface TokenAwareInputProps {
  /** Current resolved CSS value (e.g. `var(--space-md)`, `12px`, `auto`). */
  value: string | undefined
  /** Placeholder shown when no value is set. Token-display is applied. */
  placeholder?: string
  /** Token catalog to suggest. Empty array → plain text input behaviour. */
  tokens: ReadonlyArray<Token>
  /** Commit handler — receives the resolved CSS expression or undefined. */
  onCommit: (resolved: string | undefined) => void
  /**
   * Optional live-preview handler. When provided, the component fires
   * `onPreview` on every keystroke and on token-row hover with the
   * resolved value, then `onClearPreview` on blur / menu-close.
   */
  onPreview?: (resolved: string | undefined) => void
  onClearPreview?: () => void
  fieldSize?: 'xs' | 'sm' | 'md'
  /** Aria label for the input — required when there's no visible label. */
  'aria-label': string
  className?: string
  inputClassName?: string
  style?: CSSProperties
  /**
   * Optional dropdown menu label override. When omitted, falls back to
   * the input's aria-label.
   */
  menuAriaLabel?: string
  spellCheck?: boolean
  autoComplete?: string
  disabled?: boolean
  'data-testid'?: string
}

// ---------------------------------------------------------------------------
// TokenAwareInput
// ---------------------------------------------------------------------------

export const TokenAwareInput = forwardRef<TokenAwareInputHandle, TokenAwareInputProps>(
  function TokenAwareInput(
    {
      value,
      placeholder,
      tokens,
      onCommit,
      onPreview,
      onClearPreview,
      fieldSize = 'sm',
      'aria-label': ariaLabel,
      className,
      inputClassName,
      style,
      menuAriaLabel,
      spellCheck = false,
      autoComplete = 'off',
      disabled,
      'data-testid': dataTestId,
    },
    ref,
  ) {
    const display = displayTokenValue(value, tokens)
    const placeholderDisplay = displayTokenValue(placeholder, tokens)

    // The shared "preview suggestions on hover" preference. When off,
    // hovering a token row in the dropdown doesn't fire onPreview — but
    // typing still does (live as-you-type preview is its own UX feature).
    const hoverPreviewEnabled = useEditorPreference('hoverPreview')

    // Local draft so we don't fire onCommit on every keystroke (which would
    // round-trip through Immer + re-validate every press).
    const [draft, setDraft] = useState(display)
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }))

    // Sync external value → draft when not actively editing. React 19 idiom:
    // adjust state during render by tracking the previous external value.
    const [lastExternalDisplay, setLastExternalDisplay] = useState(display)
    if (!isEditing && display !== lastExternalDisplay) {
      setLastExternalDisplay(display)
      setDraft(display)
    }

    // Filter tokens by typed prefix for the autocomplete dropdown.
    // When there's no query, the "Suggested" section is hidden entirely —
    // returning [] here lets the "Tokens" section render the full scale.
    const suggestions = useMemo(() => {
      const q = draft.trim().toLowerCase()
      if (!q) return []
      return tokens
        .filter(
          (t) =>
            t.step.toLowerCase().startsWith(q) ||
            t.step.toLowerCase().includes(q),
        )
        .slice(0, 8)
    }, [draft, tokens])

    const commit = useCallback(
      (raw: string) => {
        const resolved = resolveTokenValue(raw, tokens)
        onClearPreview?.()
        onCommit(resolved)
        setIsEditing(false)
      },
      [tokens, onCommit, onClearPreview],
    )

    // Preview a hovered token's value on the canvas. Gated by the
    // hoverPreview editor preference so users who don't want flicker can
    // opt out. Note: the as-you-type preview below is intentionally always
    // on, since it reflects an explicit edit the user is making.
    const previewToken = useCallback(
      (rawValue: string) => {
        if (!hoverPreviewEnabled || !onPreview) return
        const resolved = resolveTokenValue(rawValue, tokens)
        onPreview(resolved)
      },
      [hoverPreviewEnabled, tokens, onPreview],
    )

    // Defensive: if the preference is toggled off while a hover preview is
    // active (e.g. user flips it in another tab), clear the canvas preview
    // so nothing sticks around.
    useEffect(() => {
      if (!hoverPreviewEnabled) onClearPreview?.()
    }, [hoverPreviewEnabled, onClearPreview])

    // Live-preview a typed draft. Updates the canvas on every keystroke so
    // users see their values applied without having to press Enter / Tab /
    // blur — matches the behaviour of every modern visual builder. When the
    // current draft is provably incomplete (e.g. `var(--spa`), we skip the
    // update and keep the last valid preview on screen instead of writing
    // garbage to the engine.
    const previewDraft = useCallback(
      (rawValue: string) => {
        if (!onPreview) return
        if (!isLivePreviewable(rawValue)) return
        const resolved = resolveTokenValue(rawValue, tokens)
        onPreview(resolved)
      },
      [tokens, onPreview],
    )

    // Hide the dropdown when the user is typing a direct CSS value
    // (numbers, units, `auto`, `calc(...)`, etc.) — non-token typing should
    // commit on Enter/Tab/Blur without the menu intercepting outside-clicks.
    const isDirectValue = looksLikeDirectValue(draft)
    const showMenu = isEditing && !isDirectValue && tokens.length > 0

    // Split tokens into "Suggested" (matching the typed query) and "All"
    // (everything else) so users always see the full scale even when they
    // haven't started typing.
    const queryTrim = draft.trim().toLowerCase()
    const suggestedSet = new Set(suggestions.map((t) => t.varName))
    const allOthers = tokens.filter((t) => !suggestedSet.has(t.varName))
    const showSuggestedHeader = queryTrim.length > 0 && suggestions.length > 0
    const showAllHeader = allOthers.length > 0

    return (
      <div className={cn(styles.wrapper, className)} style={style}>
        <Input
          ref={inputRef}
          type="text"
          fieldSize={fieldSize}
          value={draft}
          placeholder={placeholderDisplay}
          spellCheck={spellCheck}
          autoComplete={autoComplete}
          aria-label={ariaLabel}
          disabled={disabled}
          data-testid={dataTestId}
          className={cn(styles.input, inputClassName)}
          onFocus={() => setIsEditing(true)}
          onChange={(e) => {
            const next = e.target.value
            setDraft(next)
            previewDraft(next)
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(display)
              setIsEditing(false)
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Tab') {
              // Allow default tab behaviour but commit the current value.
              commit((e.target as HTMLInputElement).value)
            }
          }}
        />

        {showMenu &&
          createPortal(
            <ContextMenu
              anchorRef={inputRef}
              side="auto"
              align="start"
              offset={4}
              matchAnchorWidth
              minWidth={132}
              ariaLabel={menuAriaLabel ?? `${ariaLabel} variables`}
              triggerRef={inputRef}
              onClose={() => onClearPreview?.()}
              onMouseLeave={() => onClearPreview?.()}
            >
              {showSuggestedHeader && (
                <div className={styles.menuHeader} aria-hidden="true">
                  Suggested
                </div>
              )}
              {showSuggestedHeader &&
                suggestions.map((t) => (
                  <ContextMenuItem
                    key={`suggested-${t.varName}`}
                    onMouseDown={(e) => {
                      // mousedown beats blur — commits the token before
                      // the input loses focus.
                      e.preventDefault()
                      commit(t.step)
                    }}
                    onMouseEnter={() => previewToken(t.step)}
                    className={styles.menuItem}
                  >
                    <span className={styles.menuToken}>{t.step}</span>
                    <span className={styles.menuVar} title={t.valueExpr}>
                      {t.varName}
                    </span>
                  </ContextMenuItem>
                ))}
              {showAllHeader && (
                <div className={styles.menuHeader} aria-hidden="true">
                  {showSuggestedHeader ? 'All tokens' : 'Tokens'}
                </div>
              )}
              {(showAllHeader ? allOthers : tokens).map((t) => (
                <ContextMenuItem
                  key={`all-${t.varName}`}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(t.step)
                  }}
                  onMouseEnter={() => previewToken(t.step)}
                  className={styles.menuItem}
                >
                  <span className={styles.menuToken}>{t.step}</span>
                  <span className={styles.menuVar} title={t.valueExpr}>
                    {t.varName}
                  </span>
                </ContextMenuItem>
              ))}
            </ContextMenu>,
            document.body,
          )}
      </div>
    )
  },
)

