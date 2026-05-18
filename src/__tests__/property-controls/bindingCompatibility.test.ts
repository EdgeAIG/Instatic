import { describe, expect, it } from 'bun:test'
import {
  BINDING_COMPATIBILITY,
  isFieldBindable,
  type PropertyControlKind,
} from '@site/property-controls/bindingCompatibility'
import type { DataMetaField } from '@core/data/schemas'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function metaField(
  id: string,
  type: DataMetaField['type'],
  extras: Partial<DataMetaField> = {},
): DataMetaField {
  return { id, label: id, type, ...extras }
}

// ---------------------------------------------------------------------------
// Exhaustiveness — every PropertyControlKind must have an entry
// ---------------------------------------------------------------------------

describe('BINDING_COMPATIBILITY', () => {
  // All the known control kinds from propertySchema.ts
  const ALL_CONTROL_KINDS: PropertyControlKind[] = [
    'text', 'textarea', 'number', 'color', 'select', 'toggle',
    'image', 'media', 'url', 'richtext', 'spacing', 'group',
  ]

  it('has an entry for every PropertyControlKind', () => {
    for (const kind of ALL_CONTROL_KINDS) {
      expect(BINDING_COMPATIBILITY).toHaveProperty(kind)
    }
  })
})

// ---------------------------------------------------------------------------
// isFieldBindable — per-kind correctness
// ---------------------------------------------------------------------------

describe('isFieldBindable', () => {
  it('image + media(image) → true', () => {
    expect(isFieldBindable('image', metaField('f', 'media', { mediaKind: 'image' }))).toBe(true)
  })

  it('image + media(video) → false', () => {
    expect(isFieldBindable('image', metaField('f', 'media', { mediaKind: 'video' }))).toBe(false)
  })

  it('image + media (no mediaKind) → true (treated as any)', () => {
    expect(isFieldBindable('image', metaField('f', 'media'))).toBe(true)
  })

  it('media + media(video) → true', () => {
    expect(isFieldBindable('media', metaField('f', 'media', { mediaKind: 'video' }))).toBe(true)
  })

  it('media + media(image) → true', () => {
    expect(isFieldBindable('media', metaField('f', 'media', { mediaKind: 'image' }))).toBe(true)
  })

  it('text + number → true', () => {
    expect(isFieldBindable('text', metaField('f', 'number'))).toBe(true)
  })

  it('toggle + text → false', () => {
    expect(isFieldBindable('toggle', metaField('f', 'text'))).toBe(false)
  })

  it('toggle + boolean → true', () => {
    expect(isFieldBindable('toggle', metaField('f', 'boolean'))).toBe(true)
  })

  it('color + select → true', () => {
    expect(isFieldBindable('color', metaField('f', 'select'))).toBe(true)
  })

  it('color + text → false', () => {
    expect(isFieldBindable('color', metaField('f', 'text'))).toBe(false)
  })

  it('richtext + richText → true', () => {
    expect(isFieldBindable('richtext', metaField('f', 'richText'))).toBe(true)
  })

  it('richtext + longText → true', () => {
    expect(isFieldBindable('richtext', metaField('f', 'longText'))).toBe(true)
  })

  it('number + boolean → true', () => {
    expect(isFieldBindable('number', metaField('f', 'boolean'))).toBe(true)
  })

  it('url + email → true', () => {
    expect(isFieldBindable('url', metaField('f', 'email'))).toBe(true)
  })

  it('url + boolean → false', () => {
    expect(isFieldBindable('url', metaField('f', 'boolean'))).toBe(false)
  })

  it('spacing + text → false (spacing has no bindings)', () => {
    expect(isFieldBindable('spacing', metaField('f', 'text'))).toBe(false)
  })

  it('group + text → false (group has no bindings)', () => {
    expect(isFieldBindable('group', metaField('f', 'text'))).toBe(false)
  })
})
