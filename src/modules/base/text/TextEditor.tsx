/**
 * base.text editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration. Per Constraint #309, this file MUST NOT
 * export non-component values — `normalizeTag` is duplicated in `index.ts`
 * for the publisher render path.
 *
 * Inline-edit mode (Client / copy-editor role): when `isInlineEditing` is
 * true, the rendered element becomes `contentEditable` and any keystroke
 * lands as a prop diff via `onCommitInlineEdit({ text })`. Enter commits and
 * exits; Escape reverts and exits; blur commits.
 */
import React, { useCallback, useEffect, useRef } from 'react'
import type { ModuleComponentProps } from '@core/module-engine/types'

type TextTag =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'span'
  | 'div'
  | 'small'
  | 'strong'
  | 'em'

interface TextProps extends Record<string, unknown> {
  text: string
  tag: TextTag
}

const TEXT_TAGS = new Set<TextTag>([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'span',
  'div',
  'small',
  'strong',
  'em',
])

function normalizeTag(tag: unknown): TextTag {
  const value = String(tag || 'p').toLowerCase() as TextTag
  return TEXT_TAGS.has(value) ? value : 'p'
}

export const TextEditor: React.FC<ModuleComponentProps<TextProps>> = ({
  props,
  mcClassName,
  isInlineEditing,
  onCommitInlineEdit,
  onCancelInlineEdit,
}) => {
  const Tag = normalizeTag(props.tag) as React.ElementType
  const elementRef = useRef<HTMLElement | null>(null)
  // Keep the original value around so Escape can restore it.
  const originalRef = useRef<string>(props.text)

  // Focus + select-all when entering edit mode, and snapshot the value for
  // Escape-to-cancel. Cleared once the node leaves edit mode.
  useEffect(() => {
    if (!isInlineEditing) return
    originalRef.current = props.text
    const el = elementRef.current
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // We intentionally only react to the edit-mode flip; on each subsequent
    // render the user's keystrokes are the source of truth, not the prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInlineEditing])

  const commit = useCallback(() => {
    const next = elementRef.current?.innerText ?? ''
    if (next !== originalRef.current) {
      onCommitInlineEdit?.({ text: next })
    } else {
      onCancelInlineEdit?.()
    }
  }, [onCommitInlineEdit, onCancelInlineEdit])

  const cancel = useCallback(() => {
    if (elementRef.current) elementRef.current.innerText = originalRef.current
    onCancelInlineEdit?.()
  }, [onCancelInlineEdit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
      // Stop bubbling so the canvas keyboard shortcuts (Delete, Ctrl+D, …)
      // don't fire while the user is typing inside the inline editor.
      e.stopPropagation()
    },
    [commit, cancel],
  )

  if (isInlineEditing) {
    return React.createElement(Tag, {
      ref: elementRef,
      className: mcClassName,
      contentEditable: 'plaintext-only',
      suppressContentEditableWarning: true,
      onBlur: commit,
      onKeyDown: handleKeyDown,
      // Don't let canvas double-click re-trigger while editing.
      onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
      // Don't let canvas single-click deselect / re-select.
      onClick: (e: React.MouseEvent) => e.stopPropagation(),
      'data-inline-editing': 'true',
      // Render the initial value once; subsequent keystrokes are owned by the
      // DOM (contentEditable) until commit / cancel. Using dangerouslySet… is
      // safe here because `text` is a plain string prop — DOMPurify is only
      // required for the `richtext` control type, which `base.text` is not.
      dangerouslySetInnerHTML: { __html: escapeHtml(props.text) },
    })
  }

  return React.createElement(Tag, { className: mcClassName }, props.text || 'Text')
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
