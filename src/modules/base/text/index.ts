/**
 * base.text — unified semantic text module.
 *
 * Content and semantic tag are module settings; visual typography belongs to
 * class styles. Emits a bare semantic element with no default class or CSS.
 */
import type { ModuleDefinition } from '@core/module-engine/types'
import { registry } from '@core/module-engine/registry'
import { TextStartTIcon } from 'pixel-art-icons/icons/text-start-t'
import { TextEditor } from './TextEditor'

type TextTag =
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

interface TextProps extends Record<string, unknown> {
  text: string
  tag: TextTag
}

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

export const TextModule: ModuleDefinition<TextProps> = {
  id: 'base.text',
  name: 'Text',
  description: 'A semantic text element.',
  category: 'Typography',
  version: '2.0.0',
  icon: TextStartTIcon,
  trusted: true,
  canHaveChildren: false,
  inlineEditable: true,

  schema: {
    text: { type: 'textarea', label: 'Text', rows: 4, placeholder: 'Enter text...' },
    // `tag` is a `select`, which defaults to category: 'layout' by the
    // type-based heuristic. Override to 'content' — a copy editor changing
    // a heading from h2 to h3 is editorial, not structural.
    tag: {
      type: 'select',
      label: 'Tag',
      category: 'content',
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

  component: TextEditor,

  htmlTag: (props) => normalizeTag(props.tag),

  render: (props) => {
    const tag = normalizeTag(props.tag)
    return {
      html: `<${tag}>${String(props.text)}</${tag}>`,
    }
  },
}

registry.registerOrReplace(TextModule)
