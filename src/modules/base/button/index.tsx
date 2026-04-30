/* eslint-disable react-refresh/only-export-components */
/**
 * base.button — content/behavior module with class-backed visual styling.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import { safeUrl } from '../utils/escape'
import { jsxStr, jsxUrl } from '../../../core/react-publisher/utils'
import styles from './button.module.css'
import { cn } from '../../../ui/cn'
import { pxBinding, rawBinding } from '../styleBindings'

export interface ButtonProps extends Record<string, unknown> {
  label: string
  href: string
  target: '_blank' | '_self' | '_parent'
  disabled: boolean
}

const MODULE_CLASS = 'pb-button'

const ButtonEditor: React.FC<ModuleComponentProps<ButtonProps>> = ({ props, mcClassName }) => {
  if (props.href) {
    const rel = props.target === '_blank' ? 'noopener noreferrer' : undefined
    return <a href={props.href} target={props.target} rel={rel} className={cn(styles.button, mcClassName)}>{props.label || 'Button'}</a>
  }
  return <button type="button" className={cn(styles.button, mcClassName)} disabled={props.disabled}>{props.label || 'Button'}</button>
}

export const ButtonModule: ModuleDefinition<ButtonProps> = {
  id: 'base.button',
  name: 'Button',
  description: 'A button or call-to-action link. Visual styling is class-backed.',
  category: 'Interactive',
  version: '2.0.0',
  icon: 'MousePointerClick',
  trusted: true,
  canHaveChildren: false,

  schema: {
    label: { type: 'text', label: 'Label', placeholder: 'Button text...' },
    href: { type: 'url', label: 'Link URL' },
    target: {
      type: 'select',
      label: 'Link target',
      condition: { field: 'href', notEq: '' },
      options: [
        { label: 'Same tab', value: '_self' },
        { label: 'New tab', value: '_blank' },
        { label: 'Parent', value: '_parent' },
      ],
    },
    disabled: { type: 'toggle', label: 'Disabled' },
  },

  defaults: {
    label: 'Get Started',
    href: '',
    target: '_self',
    disabled: false,
  },

  classStyleBindings: {
    size: {
      label: 'Size',
      properties: ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontSize'],
      control: {
        type: 'select',
        label: 'Size',
        options: [
          { label: 'Small', value: 'sm' },
          { label: 'Medium', value: 'md' },
          { label: 'Large', value: 'lg' },
        ],
      },
      defaultValue: 'md',
      toCSS: (value) => {
        const size = value === 'sm'
          ? { y: '6px', x: '12px', font: '13px' }
          : value === 'lg'
            ? { y: '14px', x: '28px', font: '17px' }
            : { y: '10px', x: '20px', font: '15px' }
        return {
          paddingTop: size.y,
          paddingRight: size.x,
          paddingBottom: size.y,
          paddingLeft: size.x,
          fontSize: size.font,
        }
      },
      fromCSS: (styles) => {
        const fontSize = String(styles.fontSize ?? '15px')
        if (fontSize === '13px') return 'sm'
        if (fontSize === '17px') return 'lg'
        return 'md'
      },
      isSet: (styles) => Boolean(styles.fontSize || styles.paddingTop || styles.paddingLeft),
    },
    backgroundColor: rawBinding('backgroundColor', { type: 'color', label: 'Background color' }, '#6366f1'),
    color: rawBinding('color', { type: 'color', label: 'Text color' }, '#ffffff'),
    border: rawBinding('border', { type: 'text', label: 'Border', placeholder: '2px solid transparent' }, '2px solid transparent'),
    borderRadius: pxBinding('borderRadius', { type: 'text', label: 'Border radius', placeholder: '8px' }, 8),
    fontWeight: rawBinding(
      'fontWeight',
      {
        type: 'select',
        label: 'Font weight',
        options: [
          { label: 'Regular', value: '400' },
          { label: 'Medium', value: '500' },
          { label: 'Semi bold', value: '600' },
          { label: 'Bold', value: '700' },
        ],
      },
      '600',
    ),
    fullWidth: {
      label: 'Full width',
      properties: ['display', 'width'],
      control: { type: 'toggle', label: 'Full width' },
      defaultValue: false,
      toCSS: (value) => value ? { display: 'block', width: '100%' } : { display: 'inline-block', width: 'auto' },
      fromCSS: (styles) => styles.width === '100%',
      isSet: (styles) => Boolean(styles.width),
    },
  },

  component: ButtonEditor,

  render: (props) => {
    const href = safeUrl(props.href)
    const label = String(props.label ?? '')
    const rel = props.target === '_blank' ? ' rel="noopener noreferrer"' : ''
    if (href && href !== '#') {
      return { html: `<a class="${MODULE_CLASS}" href="${href}" target="${String(props.target)}"${rel}>${label}</a>`, css: buttonCss() }
    }
    const disabledAttr = props.disabled ? ' disabled aria-disabled="true"' : ''
    return { html: `<button class="${MODULE_CLASS}" type="button"${disabledAttr}>${label}</button>`, css: buttonCss() }
  },

  toJsx: (props) => {
    const href = jsxUrl(props.href)
    const label = jsxStr(props.label)
    const rel = props.target === '_blank' ? ` rel="noopener noreferrer"` : ''
    if (props.href && String(props.href) !== '#') {
      return `<a className="${MODULE_CLASS}" href=${href} target="${String(props.target)}"${rel}>${label}</a>`
    }
    const disabledAttr = props.disabled ? ' disabled aria-disabled="true"' : ''
    return `<button className="${MODULE_CLASS}" type="button"${disabledAttr}>${label}</button>`
  },
}

function buttonCss(): string {
  return `.${MODULE_CLASS}{display:inline-block;width:auto;text-align:center;padding:10px 20px;font-size:15px;font-weight:600;border-radius:8px;cursor:pointer;text-decoration:none;transition:opacity .15s;opacity:1;border:2px solid transparent;box-sizing:border-box;background-color:#6366f1;color:#fff}.${MODULE_CLASS}:disabled{cursor:not-allowed;opacity:.5}`
}

registry.register(ButtonModule)
