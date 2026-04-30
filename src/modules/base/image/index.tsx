/* eslint-disable react-refresh/only-export-components */
/**
 * base.image — image content with class-backed display styling.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import { safeUrl } from '../utils/escape'
import { jsxAttr, jsxUrl } from '../../../core/react-publisher/utils'
import styles from './image.module.css'
import { cn } from '../../../ui/cn'
import { pxBinding, rawBinding } from '../styleBindings'

export interface ImageProps extends Record<string, unknown> {
  src: string
  alt: string
  loading: 'lazy' | 'eager'
}

const MODULE_CLASS = 'pb-image'

const ImageEditor: React.FC<ModuleComponentProps<ImageProps>> = ({ props, mcClassName }) => {
  if (props.src) {
    return <img src={props.src} alt={props.alt || ''} className={cn(styles.image, mcClassName)} loading={props.loading} />
  }
  return <div className={cn(styles.placeholder, mcClassName)}>No image selected</div>
}

export const ImageModule: ModuleDefinition<ImageProps> = {
  id: 'base.image',
  name: 'Image',
  description: 'A responsive image. Display styling is class-backed.',
  category: 'Media',
  version: '2.0.0',
  icon: 'Image',
  trusted: true,
  canHaveChildren: false,

  schema: {
    src: { type: 'image', label: 'Image' },
    alt: { type: 'text', label: 'Alt text', placeholder: 'Describe the image...' },
    loading: {
      type: 'select',
      label: 'Loading',
      options: [
        { label: 'Lazy', value: 'lazy' },
        { label: 'Eager', value: 'eager' },
      ],
    },
  },

  defaults: {
    src: '',
    alt: '',
    loading: 'lazy',
  },

  classStyleBindings: {
    display: rawBinding(
      'display',
      {
        type: 'select',
        label: 'Display',
        options: [
          { label: 'Block', value: 'block' },
          { label: 'Inline block', value: 'inline-block' },
          { label: 'Inline', value: 'inline' },
        ],
      },
      'block',
    ),
    width: rawBinding('width', { type: 'text', label: 'Width', placeholder: '100%' }, '100%'),
    height: rawBinding('height', { type: 'text', label: 'Height', placeholder: 'auto' }, 'auto'),
    maxWidth: rawBinding('maxWidth', { type: 'text', label: 'Max width', placeholder: '100%' }, '100%'),
    objectFit: rawBinding(
      'objectFit',
      {
        type: 'select',
        label: 'Object fit',
        options: [
          { label: 'Cover', value: 'cover' },
          { label: 'Contain', value: 'contain' },
          { label: 'Fill', value: 'fill' },
          { label: 'None', value: 'none' },
          { label: 'Scale down', value: 'scale-down' },
        ],
      },
      'cover',
    ),
    objectPosition: rawBinding('objectPosition', { type: 'text', label: 'Object position', placeholder: 'center center' }, 'center center'),
    borderRadius: pxBinding('borderRadius', { type: 'text', label: 'Border radius', placeholder: '0px' }, 0),
  },

  component: ImageEditor,

  toJsx: (props) => {
    const src = jsxUrl(props.src)
    if (!props.src) return '<></>'
    const altAttr = jsxAttr('alt', props.alt)
    const loading = props.loading === 'eager' ? 'eager' : 'lazy'
    return `<img className="${MODULE_CLASS}" src=${src}${altAttr} loading="${loading}" />`
  },

  render: (props) => {
    const src = safeUrl(props.src)
    const alt = String(props.alt ?? '')
    const loading = props.loading === 'eager' ? 'eager' : 'lazy'
    if (!src) return { html: '' }
    return {
      html: `<img class="${MODULE_CLASS}" src="${src}" alt="${alt}" loading="${loading}">`,
      css: `.${MODULE_CLASS}{display:block;width:100%;height:auto;max-width:100%;border-radius:0}`,
    }
  },
}

registry.register(ImageModule)
