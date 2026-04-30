/* eslint-disable react-refresh/only-export-components */
/**
 * base.list — ordered or unordered list with class-backed root typography.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import { jsxStr } from '../../../core/react-publisher/utils'
import styles from './list.module.css'
import { cn } from '../../../ui/cn'
import { pxBinding, rawBinding, unitlessStringBinding } from '../styleBindings'

export interface ListProps extends Record<string, unknown> {
  items: string
  listType: 'unordered' | 'ordered'
}

const MODULE_CLASS = 'pb-list'

function parseItems(raw: string): string[] {
  return raw
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

const ListEditor: React.FC<ModuleComponentProps<ListProps>> = ({ props, mcClassName }) => {
  const items = parseItems(props.items || '')
  const Tag = props.listType === 'ordered' ? 'ol' : 'ul'
  return React.createElement(
    Tag,
    { className: cn(styles.list, mcClassName) },
    items.length > 0
      ? items.map((item, i) => React.createElement('li', { key: i }, item))
      : React.createElement('li', { className: styles.placeholder }, 'List item 1'),
  )
}

export const ListModule: ModuleDefinition<ListProps> = {
  id: 'base.list',
  name: 'List',
  description: 'An ordered or unordered list. Root typography is class-backed.',
  category: 'Typography',
  version: '2.0.0',
  icon: 'List',
  trusted: true,
  canHaveChildren: false,

  schema: {
    items: {
      type: 'textarea',
      label: 'Items',
      rows: 5,
      placeholder: 'Item 1\nItem 2\nItem 3',
    },
    listType: {
      type: 'select',
      label: 'List type',
      options: [
        { label: 'Bullet', value: 'unordered' },
        { label: 'Numbered', value: 'ordered' },
      ],
    },
  },

  defaults: {
    items: '',
    listType: 'unordered',
  },

  classStyleBindings: {
    color: rawBinding('color', { type: 'color', label: 'Text color' }, '#374151'),
    fontSize: pxBinding('fontSize', { type: 'text', label: 'Font size', placeholder: '16px' }, 16),
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
    lineHeight: unitlessStringBinding('lineHeight', { type: 'text', label: 'Line height', placeholder: '1.6' }, 1.6),
    paddingLeft: pxBinding('paddingLeft', { type: 'text', label: 'Left indent', placeholder: '24px' }, 24),
    marginBottom: pxBinding('marginBottom', { type: 'text', label: 'Margin bottom', placeholder: '16px' }, 16),
  },

  component: ListEditor,

  render: (props) => {
    const tag = props.listType === 'ordered' ? 'ol' : 'ul'
    const items = parseItems(String(props.items || ''))
    const liItems = items.map((item) => `<li>${item}</li>`).join('')
    return {
      html: `<${tag} class="${MODULE_CLASS}">${liItems}</${tag}>`,
      css: `.${MODULE_CLASS}{color:#374151;font-size:16px;font-weight:400;line-height:1.6;padding-left:24px;margin:0 0 16px 0}.${MODULE_CLASS} li{margin-bottom:6px}`,
    }
  },

  toJsx: (props) => {
    const tag = props.listType === 'ordered' ? 'ol' : 'ul'
    const items = parseItems(String(props.items || ''))
    const liJsx = items.map((item) => `<li>${jsxStr(item)}</li>`).join('\n        ')
    return `<${tag} className="${MODULE_CLASS}">\n        ${liJsx}\n      </${tag}>`
  },
}

registry.register(ListModule)
