/**
 * Binding compatibility map — defines which DataFieldTypes each
 * PropertyControlKind can accept as a binding source.
 *
 * Single source of truth for the picker's field-row disabled state.
 * Pure module, no side effects.
 */

import type { PropertyControl } from '@core/module-engine/types'
import type { DataFieldType, DataMetaField } from '@core/data/schemas'

/**
 * The discriminated `type` field from the `PropertyControl` union.
 * Derived from the schema so it stays exhaustive automatically.
 */
export type PropertyControlKind = PropertyControl['type']

/**
 * Maps every PropertyControlKind to the DataFieldTypes it can accept as a
 * binding source.
 *
 * Notes:
 * - `image`   also gated by mediaKind ∈ {'image', 'any'} inside `isFieldBindable`.
 * - `media`   accepts any mediaKind.
 * - `spacing` and `group` have no meaningful scalar binding target.
 */
export const BINDING_COMPATIBILITY: Record<PropertyControlKind, readonly DataFieldType[]> = {
  // text accepts every scalar type that can be meaningfully rendered as a string.
  // multiSelect binds as a comma-joined list of selected option labels.
  // relation binds as the related row's primary-field display label.
  text:     ['text', 'longText', 'richText', 'url', 'email', 'select', 'multiSelect', 'relation', 'number', 'boolean', 'date', 'dateTime'],
  textarea: ['text', 'longText', 'richText'],
  richtext: ['richText', 'longText', 'text'],
  number:   ['number', 'boolean'],
  url:      ['url', 'text', 'email'],
  color:    ['select'],
  toggle:   ['boolean'],
  select:   ['select'],
  image:    ['media'],
  media:    ['media'],
  spacing:  [],
  group:    [],
}

/**
 * Returns true if the given DataMetaField is bindable to the given
 * PropertyControlKind. Respects the `BINDING_COMPATIBILITY` map and applies
 * the additional `mediaKind` gate for image/media controls.
 */
export function isFieldBindable(controlKind: PropertyControlKind, field: DataMetaField): boolean {
  const allowedTypes = BINDING_COMPATIBILITY[controlKind]
  if (!allowedTypes.includes(field.type)) return false
  if (field.type === 'media') {
    const kind = field.mediaKind ?? 'any'
    if (controlKind === 'image') return kind === 'image' || kind === 'any'
    // 'media' control accepts all media kinds
    if (controlKind === 'media') return true
  }
  return true
}
