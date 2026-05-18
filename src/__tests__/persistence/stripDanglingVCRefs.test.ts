/**
 * stripDanglingVCRefs — unit tests.
 *
 * Verifies the self-healing behaviour for sites corrupted by old (pre-fix)
 * deleteVisualComponent that left dangling base.visual-component-ref nodes
 * behind.
 *
 *   - A page with a dangling ref + its subtree is fully cleaned.
 *   - The rest of the page is untouched.
 *   - Multiple dangling refs in the same page are all stripped.
 *   - Refs that DO resolve to a known VC are left alone.
 */

import { describe, it, expect } from 'bun:test'
import { stripDanglingVCRefs } from '@core/persistence/validate'
import { makeSite, makePage, makeNode, makeVC } from '../fixtures'

describe('stripDanglingVCRefs', () => {
  it('strips a dangling ref + its full subtree (slot-instance + user content)', () => {
    const rootId = 'root'
    const refId = 'ref1'
    const slotId = 'slot1'
    const textId = 'text1'

    const page = makePage({
      id: 'p1',
      rootNodeId: rootId,
      nodes: {
        [rootId]: makeNode({ id: rootId, moduleId: 'base.body', children: [refId] }),
        [refId]: makeNode({
          id: refId,
          moduleId: 'base.visual-component-ref',
          props: { componentId: 'vc-gone' },
          children: [slotId],
        }),
        [slotId]: makeNode({ id: slotId, moduleId: 'base.slot-instance', children: [textId] }),
        [textId]: makeNode({ id: textId, moduleId: 'base.text' }),
      },
    })

    // 'vc-gone' is NOT in site.visualComponents
    const site = makeSite({ pages: [page], visualComponents: [] })
    stripDanglingVCRefs(site)

    expect(site.pages[0].nodes[refId]).toBeUndefined()
    expect(site.pages[0].nodes[slotId]).toBeUndefined()
    expect(site.pages[0].nodes[textId]).toBeUndefined()
    // Root still exists but has no children
    expect(site.pages[0].nodes[rootId]).toBeDefined()
    expect(site.pages[0].nodes[rootId].children).toHaveLength(0)
  })

  it('leaves the rest of the page untouched', () => {
    const rootId = 'root'
    const refId = 'ref1'
    const keepId = 'keep-me'

    const page = makePage({
      id: 'p1',
      rootNodeId: rootId,
      nodes: {
        [rootId]: makeNode({ id: rootId, moduleId: 'base.body', children: [refId, keepId] }),
        [refId]: makeNode({
          id: refId,
          moduleId: 'base.visual-component-ref',
          props: { componentId: 'vc-gone' },
        }),
        [keepId]: makeNode({ id: keepId, moduleId: 'base.text' }),
      },
    })

    const site = makeSite({ pages: [page], visualComponents: [] })
    stripDanglingVCRefs(site)

    expect(site.pages[0].nodes[refId]).toBeUndefined()
    expect(site.pages[0].nodes[keepId]).toBeDefined()
    expect(site.pages[0].nodes[rootId].children).toEqual([keepId])
  })

  it('strips multiple dangling refs in the same page', () => {
    const rootId = 'root'
    const ref1Id = 'ref1'
    const ref2Id = 'ref2'

    const page = makePage({
      id: 'p1',
      rootNodeId: rootId,
      nodes: {
        [rootId]: makeNode({ id: rootId, moduleId: 'base.body', children: [ref1Id, ref2Id] }),
        [ref1Id]: makeNode({
          id: ref1Id,
          moduleId: 'base.visual-component-ref',
          props: { componentId: 'vc-gone-1' },
        }),
        [ref2Id]: makeNode({
          id: ref2Id,
          moduleId: 'base.visual-component-ref',
          props: { componentId: 'vc-gone-2' },
        }),
      },
    })

    const site = makeSite({ pages: [page], visualComponents: [] })
    stripDanglingVCRefs(site)

    expect(site.pages[0].nodes[ref1Id]).toBeUndefined()
    expect(site.pages[0].nodes[ref2Id]).toBeUndefined()
    expect(site.pages[0].nodes[rootId].children).toHaveLength(0)
  })

  it('leaves known VC refs untouched', () => {
    const knownVcId = 'vc-known'
    const knownVc = makeVC({ id: knownVcId, name: 'Known' })
    const rootId = 'root'
    const refId = 'ref1'

    const page = makePage({
      id: 'p1',
      rootNodeId: rootId,
      nodes: {
        [rootId]: makeNode({ id: rootId, moduleId: 'base.body', children: [refId] }),
        [refId]: makeNode({
          id: refId,
          moduleId: 'base.visual-component-ref',
          props: { componentId: knownVcId },
        }),
      },
    })

    const site = makeSite({ pages: [page], visualComponents: [knownVc] })
    stripDanglingVCRefs(site)

    // Known ref is preserved
    expect(site.pages[0].nodes[refId]).toBeDefined()
    expect(site.pages[0].nodes[rootId].children).toEqual([refId])
  })
})
