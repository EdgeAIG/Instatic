/* eslint-disable react-refresh/only-export-components */
/**
 * base.spacer — empty spacer with class-backed dimensions.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import styles from './spacer.module.css'
import { cn } from '../../../ui/cn'
import { pxBinding } from '../styleBindings'

export type SpacerProps = Record<string, unknown>

const MODULE_CLASS = 'pb-spacer'

const SpacerEditor: React.FC<ModuleComponentProps<SpacerProps>> = ({ isSelected, mcClassName }) => (
  <div className={cn(styles.spacer, isSelected && styles.spacerSelected, mcClassName)} aria-hidden="true">
    {isSelected && <span className={styles.label}>Spacer</span>}
  </div>
)

export const SpacerModule: ModuleDefinition<SpacerProps> = {
  id: 'base.spacer',
  name: 'Spacer',
  description: 'An empty spacer. Dimensions are class-backed.',
  category: 'Layout',
  version: '2.0.0',
  icon: 'ArrowUpDown',
  trusted: true,
  canHaveChildren: false,

  schema: {},
  defaults: {},

  classStyleBindings: {
    height: pxBinding('height', { type: 'text', label: 'Height', placeholder: '48px' }, 48),
  },

  component: SpacerEditor,

  render: () => ({
    html: `<div class="${MODULE_CLASS}" aria-hidden="true"></div>`,
    css: `.${MODULE_CLASS}{display:block;height:48px;width:100%}`,
  }),

  toJsx: () => `<div className="${MODULE_CLASS}" aria-hidden="true" />`,
}

registry.register(SpacerModule)
