/* eslint-disable react-refresh/only-export-components */
/**
 * base.text — unified semantic text module.
 *
 * Replaces base.heading and base.paragraph. Content and semantic tag are module
 * settings; visual typography belongs to class styles.
 */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import { jsxStr } from '../../../core/react-publisher/utils'
import styles from './text.module.css'
import { cn } from '../../../ui/cn'

export type TextTag =
  | 'p'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'span'
  | 'div'
  | 'small'
  | 'strong'
  | 'em'

export interface TextProps extends Record<string, unknown> {
  text: string
  tag: TextTag
}

const MODULE_CLASS = 'pb-text'

const TEXT_TAGS = new Set<TextTag>([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'span',
  'div',
  'small',
  'strong',
  'em',
])

function normalizeTag(tag: unknown): TextTag {
  const value = String(tag || 'p').toLowerCase() as TextTag
  return TEXT_TAGS.has(value) ? value : 'p'
}

const TextEditor: React.FC<ModuleComponentProps<TextProps>> = ({ props, mcClassName }) => {
  const Tag = normalizeTag(props.tag) as React.ElementType
  return React.createElement(Tag, { className: cn(styles.text, mcClassName) }, props.text || 'Text')
}

export const TextModule: ModuleDefinition<TextProps> = {
  id: 'base.text',
  name: 'Text',
  description: 'A semantic text element. Typography and spacing are class-backed.',
  category: 'Typography',
  version: '2.0.0',
  icon: 'type',
  trusted: true,
  canHaveChildren: false,

  schema: {
    text: { type: 'textarea', label: 'Text', rows: 4, placeholder: 'Enter text...' },
    tag: {
      type: 'select',
      label: 'Tag',
      options: [
        { label: 'Paragraph', value: 'p' },
        { label: 'Heading 1', value: 'h1' },
        { label: 'Heading 2', value: 'h2' },
        { label: 'Heading 3', value: 'h3' },
        { label: 'Heading 4', value: 'h4' },
        { label: 'Heading 5', value: 'h5' },
        { label: 'Heading 6', value: 'h6' },
        { label: 'Span', value: 'span' },
        { label: 'Div', value: 'div' },
        { label: 'Small', value: 'small' },
        { label: 'Strong', value: 'strong' },
        { label: 'Emphasis', value: 'em' },
      ],
    },
  },

  defaults: {
    text: 'Add your text here.',
    tag: 'p',
  },

  classStyleBindings: {},

  component: TextEditor,

  render: (props) => {
    const tag = normalizeTag(props.tag)
    return {
      html: `<${tag} class="${MODULE_CLASS}">${String(props.text)}</${tag}>`,
      css: `.${MODULE_CLASS}{margin:0;color:inherit;font:inherit}`,
    }
  },

  toJsx: (props) => {
    const tag = normalizeTag(props.tag)
    return `<${tag} className="${MODULE_CLASS}">${jsxStr(props.text)}</${tag}>`
  },
}

registry.register(TextModule)
