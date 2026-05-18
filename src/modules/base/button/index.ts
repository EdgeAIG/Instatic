/**
 * base.button — content/behavior module.
 *
 * Emits a bare semantic `<button>` (or `<a>` when `href` is set) with no
 * default class or default CSS. Visual styling is opt-in via user classes
 * (mcClassName / multi-class system).
 */
import type { ModuleDefinition } from '@core/module-engine/types'
import { registry } from '@core/module-engine/registry'
import { CursorClickSolidIcon } from 'pixel-art-icons/icons/cursor-click-solid'
import { safeUrl } from '@modules/base/utils/escape'
import { ButtonEditor } from './ButtonEditor'

interface ButtonProps extends Record<string, unknown> {
  label: string
  href: string
  target: '_blank' | '_self' | '_parent'
  disabled: boolean
}

export const ButtonModule: ModuleDefinition<ButtonProps> = {
  id: 'base.button',
  name: 'Button',
  description: 'A button or call-to-action link.',
  category: 'Interactive',
  version: '2.0.0',
  icon: CursorClickSolidIcon,
  trusted: true,
  canHaveChildren: false,
  inlineEditable: true,

  schema: {
    label: { type: 'text', label: 'Label', placeholder: 'Button text...' },
    href: { type: 'url', label: 'Link URL' },
    target: {
      type: 'select',
      label: 'Link target',
      // Choosing how a button opens its link is a content decision, not a
      // structural one — exposed to the Client role.
      category: 'content',
      condition: { field: 'href', notEq: '' },
      options: [
        { label: 'Same tab', value: '_self' },
        { label: 'New tab', value: '_blank' },
        { label: 'Parent', value: '_parent' },
      ],
    },
    disabled: { type: 'toggle', label: 'Disabled' },
  },

  defaults: {
    label: 'Get Started',
    href: '',
    target: '_self',
    disabled: false,
  },

  component: ButtonEditor,

  htmlTag: (props) => {
    const href = safeUrl(props.href)
    return href && href !== '#' ? 'a' : 'button'
  },

  render: (props) => {
    const href = safeUrl(props.href)
    const label = String(props.label ?? '')
    const rel = props.target === '_blank' ? ' rel="noopener noreferrer"' : ''
    if (href && href !== '#') {
      return { html: `<a href="${href}" target="${String(props.target)}"${rel}>${label}</a>` }
    }
    const disabledAttr = props.disabled ? ' disabled aria-disabled="true"' : ''
    return { html: `<button type="button"${disabledAttr}>${label}</button>` }
  },
}

registry.registerOrReplace(ButtonModule)
