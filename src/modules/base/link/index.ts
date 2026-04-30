/**
 * base.link — anchor element with class-backed typography/display styling.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import { safeUrl } from '../utils/escape'
import { pxBinding, rawBinding } from '../styleBindings'
import styles from './link.module.css'
import { cn } from '../../../ui/cn'

export interface LinkProps extends Record<string, unknown> {
  href: string
  text: string
  target: '_blank' | '_self' | '_parent'
}

const MODULE_CLASS = 'pb-link'

const LinkEditor: React.FC<ModuleComponentProps<LinkProps>> = ({ props, children, mcClassName }) =>
  React.createElement(
    'a',
    {
      href: props.href || '#',
      target: props.target,
      className: cn(styles.link, mcClassName),
    },
    children ?? props.text ?? 'Link text',
  )

export const LinkModule: ModuleDefinition<LinkProps> = {
  id: 'base.link',
  name: 'Link',
  description: 'An anchor element. Styling is class-backed.',
  category: 'Interactive',
  version: '2.0.0',
  icon: 'Link',
  trusted: true,
  canHaveChildren: true,

  schema: {
    href: { type: 'url', label: 'URL' },
    text: { type: 'text', label: 'Link text', placeholder: 'Displayed when no children' },
    target: {
      type: 'select',
      label: 'Target',
      options: [
        { label: 'Same tab', value: '_self' },
        { label: 'New tab', value: '_blank' },
        { label: 'Parent', value: '_parent' },
      ],
    },
  },

  defaults: {
    href: '#',
    text: 'Click here',
    target: '_self',
  },

  classStyleBindings: {
    color: rawBinding('color', { type: 'color', label: 'Color' }, '#6366f1'),
    textDecoration: rawBinding(
      'textDecoration',
      {
        type: 'select',
        label: 'Text decoration',
        options: [
          { label: 'None', value: 'none' },
          { label: 'Underline', value: 'underline' },
          { label: 'Line through', value: 'line-through' },
        ],
      },
      'none',
    ),
    display: rawBinding(
      'display',
      {
        type: 'select',
        label: 'Display',
        options: [
          { label: 'Inline', value: 'inline' },
          { label: 'Inline block', value: 'inline-block' },
          { label: 'Block', value: 'block' },
          { label: 'Flex', value: 'flex' },
          { label: 'Inline flex', value: 'inline-flex' },
        ],
      },
      'inline',
    ),
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
      '400',
    ),
    fontSize: pxBinding('fontSize', { type: 'text', label: 'Font size', placeholder: '16px' }, 16),
  },

  component: LinkEditor,

  render: (props, renderedChildren) => {
    const href = safeUrl(props.href)
    const rel = props.target === '_blank' ? ' rel="noopener noreferrer"' : ''
    const targetAttr = ` target="${String(props.target)}"`
    const content = renderedChildren.length > 0 ? renderedChildren.join('') : String(props.text ?? '')
    return {
      html: `<a class="${MODULE_CLASS}" href="${href}"${targetAttr}${rel}>${content}</a>`,
      css: `.${MODULE_CLASS}{color:#6366f1;text-decoration:none;display:inline;font-weight:400;font-size:16px}`,
    }
  },
}

registry.register(LinkModule)
