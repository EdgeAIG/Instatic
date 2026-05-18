/**
 * Tests for the LoopSourceRegistry — namespacing, register/registerOrReplace,
 * lookup, and built-in registration.
 */

import { describe, expect, it, beforeEach } from 'bun:test'
import { loopSourceRegistry } from '@core/loops/registry'
import type { LoopEntitySource } from '@core/loops/types'

function makeStubSource(id: string): LoopEntitySource {
  return {
    id,
    label: id,
    filterSchema: {},
    orderByOptions: [],
    fields: [],
    fetch: async () => ({ items: [], totalItems: 0 }),
    preview: () => [],
  }
}

describe('LoopSourceRegistry', () => {
  beforeEach(() => {
    // Clean slate between tests — the registry persists across the
    // module load, so we have to remove any test-only registrations.
    for (const source of loopSourceRegistry.list()) {
      if (source.id.startsWith('test.')) loopSourceRegistry.unregister(source.id)
    }
  })

  it('rejects non-namespaced ids', () => {
    expect(() => loopSourceRegistry.register(makeStubSource('bare'))).toThrow(/namespaced/i)
  })

  it('rejects double-registration without registerOrReplace', () => {
    loopSourceRegistry.register(makeStubSource('test.alpha'))
    expect(() => loopSourceRegistry.register(makeStubSource('test.alpha'))).toThrow(/already registered/i)
    loopSourceRegistry.unregister('test.alpha')
  })

  it('registerOrReplace overwrites without throwing', () => {
    loopSourceRegistry.register(makeStubSource('test.beta'))
    const replacement = makeStubSource('test.beta')
    replacement.label = 'Beta replaced'
    loopSourceRegistry.registerOrReplace(replacement)
    expect(loopSourceRegistry.get('test.beta')?.label).toBe('Beta replaced')
    loopSourceRegistry.unregister('test.beta')
  })

  it('getOrThrow throws when missing', () => {
    expect(() => loopSourceRegistry.getOrThrow('test.missing')).toThrow(/is not registered/i)
  })

  it('built-in sources self-register on import', async () => {
    await import('@core/loops/sources')
    expect(loopSourceRegistry.has('data.rows')).toBe(true)
    expect(loopSourceRegistry.has('site.pages')).toBe(true)
    expect(loopSourceRegistry.has('site.media')).toBe(true)
  })
})
