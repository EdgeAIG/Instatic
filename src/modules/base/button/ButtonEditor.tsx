/**
 * base.button editor preview component.
 *
 * Component-only file so React Fast Refresh can hot-patch edits without
 * re-running module registration.
 *
 * Inline-edit mode: when `isInlineEditing` is true the label becomes an
 * editable span via `contentEditable="plaintext-only"`. Enter commits, blur
 * commits, Escape cancels. The button's link behaviour is suppressed during
 * edit so the user can put the caret inside without navigating.
 */
import React, { useCallback, useEffect, useRef } from 'react'
import type { ModuleComponentProps } from '@core/module-engine/types'

interface ButtonProps extends Record<string, unknown> {
  label: string
  href: string
  target: '_blank' | '_self' | '_parent'
  disabled: boolean
}

export const ButtonEditor: React.FC<ModuleComponentProps<ButtonProps>> = ({
  props,
  mcClassName,
  isInlineEditing,
  onCommitInlineEdit,
  onCancelInlineEdit,
}) => {
  const labelRef = useRef<HTMLSpanElement | null>(null)
  const originalRef = useRef<string>(props.label)

  useEffect(() => {
    if (!isInlineEditing) return
    originalRef.current = props.label
    const el = labelRef.current
    if (!el) return
    el.focus()
    const range = document.createRange()
    range.selectNodeContents(el)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isInlineEditing])

  const commit = useCallback(() => {
    const next = labelRef.current?.innerText ?? ''
    if (next !== originalRef.current) {
      onCommitInlineEdit?.({ label: next })
    } else {
      onCancelInlineEdit?.()
    }
  }, [onCommitInlineEdit, onCancelInlineEdit])

  const cancel = useCallback(() => {
    if (labelRef.current) labelRef.current.innerText = originalRef.current
    onCancelInlineEdit?.()
  }, [onCancelInlineEdit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        commit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        cancel()
      }
      e.stopPropagation()
    },
    [commit, cancel],
  )

  const labelNode = isInlineEditing ? (
    <span
      ref={labelRef}
      contentEditable="plaintext-only"
      suppressContentEditableWarning
      onBlur={commit}
      onKeyDown={handleKeyDown}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      data-inline-editing="true"
      dangerouslySetInnerHTML={{ __html: escapeHtml(props.label) }}
    />
  ) : (
    props.label || 'Button'
  )

  if (props.href) {
    const rel = props.target === '_blank' ? 'noopener noreferrer' : undefined
    // Suppress navigation while in inline edit so the user can click into the
    // label without launching the link.
    const safeHref = isInlineEditing ? undefined : props.href
    return (
      <a
        href={safeHref}
        target={props.target}
        rel={rel}
        className={mcClassName}
        onClick={isInlineEditing ? (e) => e.preventDefault() : undefined}
      >
        {labelNode}
      </a>
    )
  }
  return (
    <button type="button" className={mcClassName} disabled={props.disabled}>
      {labelNode}
    </button>
  )
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
