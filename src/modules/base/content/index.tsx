/* eslint-disable react-refresh/only-export-components */
import React from 'react'
import { type ModuleDefinition, type ModuleComponentProps } from '../../../core/module-engine/types'
import { registry } from '../../../core/module-engine/registry'
import { cn } from '../../../ui/cn'
import styles from './content.module.css'

interface ContentProps extends Record<string, unknown> {
  html: string
}

const MODULE_CLASS = 'pb-content'

const ContentEditor: React.FC<ModuleComponentProps<ContentProps>> = ({ props, mcClassName }) => {
  if (!props.html) {
    return <div className={cn(styles.placeholder, mcClassName)}>Content body</div>
  }

  return (
    <article
      className={cn(styles.content, mcClassName)}
      dangerouslySetInnerHTML={{ __html: props.html }}
    />
  )
}

export const ContentModule: ModuleDefinition<ContentProps> = {
  id: 'base.content',
  name: 'Content Body',
  description: 'Renders the current CMS entry body.',
  category: 'CMS',
  version: '1.0.0',
  icon: 'AlignLeft',
  trusted: true,
  canHaveChildren: false,

  schema: {
    html: { type: 'richtext', label: 'HTML' },
  },

  defaults: {
    html: '',
  },

  component: ContentEditor,

  render: (props) => {
    const html = typeof props.html === 'string' ? props.html : ''
    if (!html) return { html: '' }
    return {
      html: `<article class="${MODULE_CLASS}">${html}</article>`,
      css: [
        `.${MODULE_CLASS}{display:block;width:100%;color:inherit;font:inherit}`,
        `.${MODULE_CLASS} > *:first-child{margin-top:0}`,
        `.${MODULE_CLASS} > *:last-child{margin-bottom:0}`,
        `.${MODULE_CLASS} img,.${MODULE_CLASS} video{display:block;max-width:100%;height:auto}`,
      ].join('\n'),
    }
  },
}

registry.register(ContentModule)
