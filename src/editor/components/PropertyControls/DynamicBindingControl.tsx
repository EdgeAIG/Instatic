import { useMemo, useState, type ReactNode } from 'react'
import type { PropertyControl } from '../../../core/module-engine/types'
import type { DynamicPropBinding } from '../../../core/page-tree'
import { Button } from '@ui/components/Button'
import { CloseIcon } from '@ui/icons/icons/close'
import styles from './controls.module.css'

interface BindingOption {
  label: string
  binding: DynamicPropBinding
}

interface DynamicBindingControlProps {
  propKey: string
  label: string
  control: PropertyControl
  binding?: DynamicPropBinding
  onSet: (binding: DynamicPropBinding) => void
  onClear: () => void
  children: ReactNode
}

function bindingOptionsForControl(control: PropertyControl): BindingOption[] {
  if (control.type === 'image' || (control.type === 'media' && control.mediaKind === 'image')) {
    return [
      {
        label: 'Current post featured media',
        binding: { source: 'currentEntry', field: 'featuredMedia', format: 'media' },
      },
      {
        label: 'Current post first image',
        binding: { source: 'currentEntry', field: 'firstImage', format: 'media' },
      },
    ]
  }

  if (control.type === 'richtext') {
    return [
      {
        label: 'Current post body',
        binding: { source: 'currentEntry', field: 'body', format: 'html' },
      },
    ]
  }

  if (control.type === 'text' || control.type === 'textarea' || control.type === 'url') {
    return [
      { label: 'Current post title', binding: { source: 'currentEntry', field: 'title' } },
      { label: 'Current post slug', binding: { source: 'currentEntry', field: 'slug' } },
      { label: 'Current post SEO title', binding: { source: 'currentEntry', field: 'seoTitle' } },
      { label: 'Current post SEO description', binding: { source: 'currentEntry', field: 'seoDescription' } },
    ]
  }

  return []
}

function bindingLabel(binding: DynamicPropBinding): string {
  switch (binding.field) {
    case 'title':
      return 'Current post title'
    case 'slug':
      return 'Current post slug'
    case 'body':
    case 'bodyMarkdown':
      return 'Current post body'
    case 'featuredMedia':
    case 'featuredMediaPath':
    case 'featuredMediaUrl':
      return 'Current post featured media'
    case 'firstImage':
    case 'firstImagePath':
    case 'firstImageUrl':
      return 'Current post first image'
    case 'seoTitle':
      return 'Current post SEO title'
    case 'seoDescription':
      return 'Current post SEO description'
    default:
      return `Current post ${binding.field}`
  }
}

export function DynamicBindingControl({
  propKey,
  label,
  control,
  binding,
  onSet,
  onClear,
  children,
}: DynamicBindingControlProps) {
  const [open, setOpen] = useState(false)
  const options = useMemo(() => bindingOptionsForControl(control), [control])
  if (options.length === 0) return <>{children}</>

  if (binding) {
    return (
      <div className={styles.boundControlWrapper} data-bound="true">
        <div className={styles.labelRow}>
          <label>{label}</label>
        </div>
        <div className={styles.boundValueRow}>
          <Button variant="ghost" size="md" className={styles.boundValueButton} aria-label={bindingLabel(binding)}>
            {bindingLabel(binding)}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            iconOnly
            aria-label={`Remove binding for ${label}`}
            title={`Remove binding for ${label}`}
            onClick={onClear}
          >
            <CloseIcon size={11} />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={styles.bindingWrapper}
      onFocusCapture={() => setOpen(true)}
      onMouseDownCapture={() => setOpen(true)}
      onKeyDown={(event) => {
        if (event.key === 'Escape') setOpen(false)
      }}
    >
      {children}
      {open && (
        <div className={styles.bindingMenu} role="menu" aria-label={`${label} dynamic bindings`}>
          {options.map((option) => (
            <Button
              key={`${propKey}-${option.binding.field}-${option.binding.format ?? 'plain'}`}
              variant="ghost"
              size="sm"
              align="start"
              menuItem
              role="menuitem"
              className={styles.bindingMenuItem}
              onClick={() => {
                onSet(option.binding)
                setOpen(false)
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
