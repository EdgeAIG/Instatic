/* eslint-disable react-refresh/only-export-components */
/**
 * base.divider — horizontal rule with class-backed line styles.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import styles from './divider.module.css'
import { cn } from '../../../ui/cn'
import { pxBinding, rawBinding } from '../styleBindings'

export type DividerProps = Record<string, unknown>

const MODULE_CLASS = 'pb-divider'

const DividerEditor: React.FC<ModuleComponentProps<DividerProps>> = ({ mcClassName }) => (
  <hr aria-hidden="true" className={cn(styles.divider, mcClassName)} />
)

export const DividerModule: ModuleDefinition<DividerProps> = {
  id: 'base.divider',
  name: 'Divider',
  description: 'A horizontal divider. Line styles are class-backed.',
  category: 'Layout',
  version: '2.0.0',
  icon: 'Minus',
  trusted: true,
  canHaveChildren: false,

  schema: {},
  defaults: {},

  classStyleBindings: {
    line: rawBinding('borderTop', { type: 'text', label: 'Line', placeholder: '1px solid #e2e8f0' }, '1px solid #e2e8f0'),
    width: rawBinding('width', { type: 'text', label: 'Width', placeholder: '100%' }, '100%'),
    marginTop: pxBinding('marginTop', { type: 'text', label: 'Margin top', placeholder: '16px' }, 16),
    marginBottom: pxBinding('marginBottom', { type: 'text', label: 'Margin bottom', placeholder: '16px' }, 16),
  },

  component: DividerEditor,

  render: () => ({
    html: `<hr class="${MODULE_CLASS}" aria-hidden="true">`,
    css: `.${MODULE_CLASS}{border:0;border-top:1px solid #e2e8f0;margin:16px 0;width:100%}`,
  }),

  toJsx: () => `<hr className="${MODULE_CLASS}" aria-hidden="true" />`,
}

registry.register(DividerModule)
