/**
 * PropertyControlRenderer — dispatches a PropertyControl schema entry to the
 * correct React control component.
 *
 * Adds a structural shell for data-testid/state attributes while the concrete
 * control component owns its own row layout via controls.module.css.
 */
import { useState } from 'react'
import type { PropertyControl, PropertySchema } from '../../../core/module-engine/types'
import { sanitizeRichtext } from '../../../core/sanitize'
import { Icon } from '../../../ui/icons/Icon'
import { TextControl } from './TextControl'
import { TextareaControl } from './TextareaControl'
import { NumberControl } from './NumberControl'
import { ColorControl } from './ColorControl'
import { SelectControl } from './SelectControl'
import { ToggleControl } from './ToggleControl'
import { ImageControl } from './ImageControl'
import { UrlControl } from './UrlControl'
import { cn } from '@ui/cn'
import styles from './controls.module.css'

interface RenderControlOptions {
  propKey: string
  control: PropertyControl
  value: unknown
  onChange: (key: string, val: unknown) => void
  isOverride?: boolean
  disabled?: boolean
}

/**
 * Render a single property control wrapped in the test/accessibility shell.
 * Returns null for unknown or unimplemented control types.
 */
export function PropertyControlRenderer({
  propKey,
  control,
  value,
  onChange,
  isOverride = false,
  disabled = false,
}: RenderControlOptions) {
  const shared = {
    propKey,
    value,
    onChange,
    label: control.label,
    isOverride,
    disabled,
  }

  let inner: React.ReactNode

  switch (control.type) {
    case 'text':
      inner = (
        <TextControl
          {...shared}
          value={String(value ?? '')}
          placeholder={control.placeholder}
        />
      )
      break

    case 'textarea':
      inner = (
        <TextareaControl
          {...shared}
          value={String(value ?? '')}
          rows={control.rows}
          placeholder={control.placeholder}
        />
      )
      break

    case 'number':
      inner = (
        <NumberControl
          {...shared}
          value={Number(value ?? 0)}
          min={control.min}
          max={control.max}
          step={control.step}
          unit={control.unit}
        />
      )
      break

    case 'color':
      inner = <ColorControl {...shared} value={String(value ?? '')} format={control.format} />
      break

    case 'select':
      inner = <SelectControl {...shared} options={control.options} />
      break

    case 'toggle':
      inner = <ToggleControl {...shared} value={Boolean(value)} />
      break

    case 'image':
      inner = <ImageControl {...shared} value={String(value ?? '')} />
      break

    case 'url':
      inner = <UrlControl {...shared} value={String(value ?? '')} />
      break

    case 'richtext':
      // Richtext editor is a future-sprint deliverable. For now, fall back to textarea.
      // DOMPurify sanitization is applied on every onChange to enforce the richtext
      // trust boundary (Task #261 / Security Auditor Contribution #368):
      // the publisher's escapeProps() passes richtext props through unescaped, relying
      // on this sanitization happening at input time.
      inner = (
        <TextareaControl
          {...shared}
          value={String(value ?? '')}
          onChange={(key, rawVal) => onChange(key, sanitizeRichtext(rawVal))}
          rows={4}
          placeholder="Rich text (formatting toolbar coming soon…)"
        />
      )
      break

    case 'spacing':
      // Spacing control (top/right/bottom/left) is a future-sprint deliverable.
      // Fall back to text for MVP.
      inner = <TextControl {...shared} value={String(value ?? '')} placeholder="e.g. 8px 16px" />
      break

    case 'group':
      inner = (
        <GroupSection
          label={control.label}
          schema={control.children}
          props={{ [propKey]: value } as Record<string, unknown>}
          onChange={onChange}
          isOverride={isOverride}
          disabled={disabled}
          defaultCollapsed={control.collapsed}
        />
      )
      break

    default:
      return null
  }

  if (control.type === 'group') {
    return (
      <div data-testid={`property-control-${propKey}`}>
        {inner}
      </div>
    )
  }

  return (
    <div
      data-testid={`property-control-${propKey}`}
      data-disabled={disabled ? 'true' : undefined}
      data-override={isOverride ? 'true' : undefined}
    >
      {inner}
    </div>
  )
}

// ---------------------------------------------------------------------------
// GroupSection — visual grouping with collapsible header
// ---------------------------------------------------------------------------

interface GroupSectionProps {
  label: string
  schema: PropertySchema
  props: Record<string, unknown>
  onChange: (key: string, val: unknown) => void
  isOverride?: boolean
  disabled?: boolean
  defaultCollapsed?: boolean
}

function GroupSection({
  label,
  schema,
  props,
  onChange,
  isOverride,
  disabled,
  defaultCollapsed = false,
}: GroupSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  return (
    <div className={styles.groupWrapper}>
      {/* Group header */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
        className={styles.groupHeader}
      >
        <span className={cn(styles.groupChevron, !collapsed && styles.groupChevronExpanded)}>
          <Icon name="chevron-right" size={10} />
        </span>
        {label}
      </button>

      {/* Group children */}
      {!collapsed && (
        <div className={styles.groupChildren}>
          {Object.entries(schema).map(([key, ctrl]) => (
            <PropertyControlRenderer
              key={key}
              propKey={key}
              control={ctrl}
              value={props[key]}
              onChange={onChange}
              isOverride={isOverride}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </div>
  )
}
