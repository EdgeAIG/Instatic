import { describe, expect, it } from 'bun:test'
import {
  DEFAULT_MODULE_INSERTER_PREFERENCE,
  USER_PREFERENCE_KEYS,
  USER_PREFERENCE_SCHEMAS,
} from '@core/persistence/userPreferences'
import { parseValue, safeParseValue } from '@core/utils/typeboxHelpers'

describe('user preference schemas', () => {
  it('whitelists the module inserter preference key', () => {
    expect(USER_PREFERENCE_KEYS).toContain('module-inserter')
  })

  it('validates module inserter favorites as ordered inserter refs', () => {
    const parsed = parseValue(USER_PREFERENCE_SCHEMAS['module-inserter'], {
      favorites: [
        { kind: 'module', id: 'base.text' },
        { kind: 'layout', id: 'layout.contact' },
        { kind: 'component', id: 'vc.hero' },
      ],
    })

    expect(parsed).toEqual({
      favorites: [
        { kind: 'module', id: 'base.text' },
        { kind: 'layout', id: 'layout.contact' },
        { kind: 'component', id: 'vc.hero' },
      ],
    })
  })

  it('rejects malformed module inserter favorite refs', () => {
    expect(
      safeParseValue(USER_PREFERENCE_SCHEMAS['module-inserter'], {
        favorites: [{ kind: 'module', id: 123 }],
      }).ok,
    ).toBe(false)
  })

  it('defaults notch favorites to Container, Text, and Image', () => {
    expect(DEFAULT_MODULE_INSERTER_PREFERENCE).toEqual({
      favorites: [
        { kind: 'module', id: 'base.container' },
        { kind: 'module', id: 'base.text' },
        { kind: 'module', id: 'base.image' },
      ],
    })
  })
})
