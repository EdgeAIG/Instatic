/**
 * parseStyleRule — unified contextStyles + legacy migration.
 *
 * The unified editing-context model folds the old `breakpointStyles` (width
 * breakpoints) and `conditionalLayers` (custom @media/@container/@supports)
 * into one `contextStyles` map keyed by context id. parseStyleRule migrates
 * both legacy fields; the site-level condition registry is reconstructed in
 * parseSiteDocument (covered separately).
 */

import { describe, it, expect } from 'bun:test'
import { parseStyleRule } from '@core/page-tree/styleRule'
import { conditionId } from '@core/page-tree'

function baseRaw(extra: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    name: 'foo',
    kind: 'class',
    selector: '.foo',
    order: 0,
    styles: { color: 'red' },
    createdAt: 0,
    updatedAt: 0,
    ...extra,
  }
}

describe('parseStyleRule — contextStyles', () => {
  it('legacy rule without any context field → contextStyles is {}', () => {
    const rule = parseStyleRule(baseRaw())
    expect(rule).not.toBeNull()
    expect(rule!.contextStyles).toEqual({})
  })

  it('round-trips the current contextStyles shape', () => {
    const rule = parseStyleRule(
      baseRaw({ contextStyles: { tablet: { color: 'blue' }, 'media:(orientation: landscape)': { gap: '8px' } } }),
    )
    expect(rule!.contextStyles).toEqual({
      tablet: { color: 'blue' },
      'media:(orientation: landscape)': { gap: '8px' },
    })
  })

  it('migrates legacy breakpointStyles into contextStyles by breakpoint id', () => {
    const rule = parseStyleRule(baseRaw({ breakpointStyles: { tablet: { fontSize: '14px' } } }))
    expect(rule!.contextStyles.tablet).toEqual({ fontSize: '14px' })
  })

  it('migrates legacy conditionalLayers (media/container/supports) into contextStyles by condition id', () => {
    const rule = parseStyleRule(
      baseRaw({
        conditionalLayers: [
          { id: 'm1', condition: { kind: 'media', query: '(orientation: landscape)' }, styles: { color: 'blue' }, order: 0 },
          { id: 'c1', condition: { kind: 'container', name: 'sidebar', query: 'min-width: 400px' }, styles: { display: 'grid' }, order: 1 },
          { id: 's1', condition: { kind: 'supports', query: '(display: grid)' }, styles: { gap: '8px' }, order: 2 },
        ],
      }),
    )
    expect(rule!.contextStyles[conditionId({ kind: 'media', query: '(orientation: landscape)' })]).toEqual({ color: 'blue' })
    expect(rule!.contextStyles[conditionId({ kind: 'container', name: 'sidebar', query: 'min-width: 400px' })]).toEqual({ display: 'grid' })
    expect(rule!.contextStyles[conditionId({ kind: 'supports', query: '(display: grid)' })]).toEqual({ gap: '8px' })
  })

  it('drops legacy layers with an unknown condition kind, keeps valid ones', () => {
    const rule = parseStyleRule(
      baseRaw({
        conditionalLayers: [
          { id: 'bad', condition: { kind: 'totally-made-up', query: '(x)' }, styles: { color: 'x' } },
          { id: 'ok', condition: { kind: 'media', query: '(min-width: 1px)' }, styles: { color: 'red' } },
        ],
      }),
    )
    expect(Object.keys(rule!.contextStyles)).toEqual([conditionId({ kind: 'media', query: '(min-width: 1px)' })])
  })

  it('a legacy breakpoint-kind layer migrates to contextStyles[breakpointId]', () => {
    const rule = parseStyleRule(
      baseRaw({
        conditionalLayers: [
          { id: 'b1', condition: { kind: 'breakpoint', breakpointId: 'tablet' }, styles: { color: 'red' }, order: 0 },
        ],
      }),
    )
    expect(rule!.contextStyles.tablet).toEqual({ color: 'red' })
  })
})
