/* eslint-disable react-refresh/only-export-components */
/**
 * base.container — semantic wrapper with class-backed layout styling.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import styles from './container.module.css'
import { cn } from '../../../ui/cn'

export interface ContainerProps extends Record<string, unknown> {
  tag: 'div' | 'section' | 'article' | 'main' | 'header' | 'footer'
}

const MODULE_CLASS = 'pb-container'
const VALID_TAGS = new Set<ContainerProps['tag']>(['div', 'section', 'article', 'main', 'header', 'footer'])

export function resolveContainerTag(value: unknown): ContainerProps['tag'] {
  return typeof value === 'string' && VALID_TAGS.has(value as ContainerProps['tag'])
    ? value as ContainerProps['tag']
    : 'div'
}

const ContainerEditor: React.FC<ModuleComponentProps<ContainerProps>> = ({ props, children, mcClassName }) => {
  const Tag = resolveContainerTag(props.tag)
  return React.createElement(Tag, { className: cn(styles.container, mcClassName) }, children)
}

export const ContainerModule: ModuleDefinition<ContainerProps> = {
  id: 'base.container',
  name: 'Container',
  description: 'A semantic container. Layout and visual styling are class-backed.',
  category: 'Layout',
  version: '2.0.0',
  icon: 'Square',
  trusted: true,
  canHaveChildren: true,

  schema: {
    tag: {
      type: 'select',
      label: 'HTML tag',
      options: [
        { label: 'div', value: 'div' },
        { label: 'section', value: 'section' },
        { label: 'article', value: 'article' },
        { label: 'main', value: 'main' },
        { label: 'header', value: 'header' },
        { label: 'footer', value: 'footer' },
      ],
    },
  },

  defaults: {
    tag: 'div',
  },

  component: ContainerEditor,

  render: (props, renderedChildren) => {
    const tag = resolveContainerTag(props.tag)
    return {
      html: `<${tag} class="${MODULE_CLASS}">${renderedChildren.join('')}</${tag}>`,
      css: `.${MODULE_CLASS}{display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;flex-wrap:nowrap;gap:16px;padding:16px;background-color:transparent;max-width:100%;width:100%;min-height:0;border-radius:0;overflow:visible;box-sizing:border-box}`,
    }
  },

  toJsx: (props, renderedChildren) => {
    const tag = resolveContainerTag(props.tag)
    const inner = renderedChildren.join('\n      ')
    return `<${tag} className="${MODULE_CLASS}">\n      ${inner}\n    </${tag}>`
  },
}

registry.register(ContainerModule)
