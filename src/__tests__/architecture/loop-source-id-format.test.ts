/**
 * Architecture gate — every registered LoopEntitySource id must be of
 * the form `<namespace>.<name>` so plugin sources can't shadow built-ins.
 *
 * Mirrors `module-id-format.test.ts` for ModuleDefinitions.
 */

import { describe, expect, it } from 'bun:test'
import { loopSourceRegistry } from '@core/loops/registry'
import '@core/loops/sources'

describe('loop source ID format', () => {
  it('every built-in source id is namespaced', () => {
    const sources = loopSourceRegistry.list()
    expect(sources.length).toBeGreaterThan(0)
    for (const source of sources) {
      expect(source.id).toMatch(/^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/)
    }
  })

  it('built-in sources include the documented set', () => {
    expect(loopSourceRegistry.has('data.rows')).toBe(true)
    expect(loopSourceRegistry.has('site.pages')).toBe(true)
    expect(loopSourceRegistry.has('site.media')).toBe(true)
  })
})
