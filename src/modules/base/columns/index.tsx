/* eslint-disable react-refresh/only-export-components */
/**
 * base.columns — CSS-grid layout container.
 *
 * Content structure is fixed; visual configuration is exposed through
 * classStyleBindings so columns, gaps, padding, and alignment are reusable
 * class styles with breakpoint overrides.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import styles from './columns.module.css'
import { cn } from '../../../ui/cn'
import { pxBinding, rawBinding } from '../styleBindings'

export type ColumnsProps = Record<string, unknown>

const MODULE_CLASS = 'pb-columns'

const ColumnsEditor: React.FC<ModuleComponentProps<ColumnsProps>> = ({ children, mcClassName }) => {
  const hasChildren = React.Children.count(children) > 0
  return (
    <div className={cn(styles.columns, mcClassName)}>
      {hasChildren ? (
        children
      ) : (
        Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className={styles.columnPlaceholder}>
            Column {i + 1}
          </div>
        ))
      )}
    </div>
  )
}

export const ColumnsModule: ModuleDefinition<ColumnsProps> = {
  id: 'base.columns',
  name: 'Columns',
  description: 'A reusable CSS-grid layout container.',
  category: 'Layout',
  version: '2.0.0',
  icon: 'Columns',
  trusted: true,
  canHaveChildren: true,

  schema: {},
  defaults: {},

  classStyleBindings: {
    columns: {
      label: 'Columns',
      properties: ['display', 'gridTemplateColumns'],
      control: { type: 'text', label: 'Columns', placeholder: '2' },
      defaultValue: 2,
      toCSS: (value) => {
        const columns = Math.max(1, Math.min(12, Math.round(Number(value) || 1)))
        return {
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        }
      },
      fromCSS: (styles) => {
        const template = String(styles.gridTemplateColumns ?? '')
        const match = template.match(/repeat\((\d+)/)
        return match ? Number(match[1]) : 2
      },
      isSet: (styles) => Boolean(styles.gridTemplateColumns),
    },
    columnGap: pxBinding('columnGap', { type: 'text', label: 'Column gap', placeholder: '24px' }, 24),
    rowGap: pxBinding('rowGap', { type: 'text', label: 'Row gap', placeholder: '24px' }, 24),
    alignItems: rawBinding(
      'alignItems',
      {
        type: 'select',
        label: 'Align items',
        options: [
          { label: 'Stretch', value: 'stretch' },
          { label: 'Start', value: 'start' },
          { label: 'Center', value: 'center' },
          { label: 'End', value: 'end' },
        ],
      },
      'stretch',
    ),
    justifyItems: rawBinding(
      'justifyItems',
      {
        type: 'select',
        label: 'Justify items',
        options: [
          { label: 'Stretch', value: 'stretch' },
          { label: 'Start', value: 'start' },
          { label: 'Center', value: 'center' },
          { label: 'End', value: 'end' },
        ],
      },
      'stretch',
    ),
    paddingTop: pxBinding('paddingTop', { type: 'text', label: 'Padding top', placeholder: '0px' }, 0),
    paddingBottom: pxBinding('paddingBottom', { type: 'text', label: 'Padding bottom', placeholder: '0px' }, 0),
    maxWidth: rawBinding('maxWidth', { type: 'text', label: 'Max width', placeholder: '100%' }, '100%'),
    backgroundColor: rawBinding('backgroundColor', { type: 'color', label: 'Background' }, 'transparent'),
  },

  component: ColumnsEditor,

  render: (_props, renderedChildren) => ({
    html: `<div class="${MODULE_CLASS}">${renderedChildren.join('')}</div>`,
    css: `.${MODULE_CLASS}{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));column-gap:24px;row-gap:24px;align-items:stretch;justify-items:stretch;padding-top:0;padding-bottom:0;max-width:100%;width:100%;background-color:transparent;box-sizing:border-box}`,
  }),

  toJsx: (_props, renderedChildren) => {
    const inner = renderedChildren.join('\n      ')
    return `<div className="${MODULE_CLASS}">\n      ${inner}\n    </div>`
  },
}

registry.register(ColumnsModule)
