/**
 * base.outlet — the single content outlet for templates.
 *
 * Polymorphic: the composer either splices matched content (a page tree or a
 * nested template) in place of this node, OR — for the innermost outlet on an
 * entry route — leaves it here to render the current entry's body. The
 * `data-instatic-content-region` marker is what the Content workspace's Live
 * mode mounts Tiptap against, so it is emitted unconditionally.
 *
 * The outlet renders as an author-chosen semantic element (default `<main>`),
 * sharing the tag-selection helpers with `base.container` / `base.loop`. The
 * `html` prop is NOT author-editable — it is the binding target the publisher
 * fills with the current entry's body (`{currentEntry.body}`), so it carries
 * no panel control.
 */
import type { ModuleDefinition } from '@core/module-engine'
import { registry } from '@core/module-engine'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { TargetSolidIcon } from 'pixel-art-icons/icons/target-solid'
import {
  customHtmlTagControl,
  htmlTagControl,
  resolveHtmlTag,
} from '@modules/base/utils/htmlTag'
import { OutletEditor } from './OutletEditor'

const OutletPropsSchema = Type.Object({
  tag: Type.String({ default: 'main' }),
  customTag: Type.String({ default: '' }),
  /**
   * Binding target only — the publisher fills this with the current entry's
   * body HTML. Never hand-edited, so it carries no `schema` control.
   */
  html: Type.String({ default: '' }),
})

type OutletProps = Static<typeof OutletPropsSchema>

export const OutletModule: ModuleDefinition<OutletProps> = {
  id: 'base.outlet',
  name: 'Content Outlet',
  description: 'Where matched content (a page or the current entry body) flows in.',
  category: 'CMS',
  version: '1.0.0',
  icon: TargetSolidIcon,
  trusted: true,
  canHaveChildren: false,

  schema: {
    tag: htmlTagControl(),
    customTag: customHtmlTagControl(),
  },

  propsSchema: OutletPropsSchema,
  defaults: Value.Create(OutletPropsSchema) as OutletProps,

  component: OutletEditor,

  htmlTag: (props) => resolveHtmlTag(props.tag, props.customTag),

  render: (props) => {
    const tag = resolveHtmlTag(props.tag, props.customTag)
    const html = typeof props.html === 'string' ? props.html : ''
    return { html: `<${tag} data-instatic-content-region>${html}</${tag}>` }
  },
}

registry.registerOrReplace(OutletModule)
