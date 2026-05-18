/**
 * previewVCDeletion — unit tests.
 *
 * Exercises the impact-preview logic:
 *   - No refs anywhere → null (silent commit)
 *   - Refs in one page → correct counts
 *   - Refs in two pages + inside one other VC → correct counts and order
 *   - Ignores refs for a different VC
 *   - Self-references are excluded from the impact list
 */

import { describe, it, expect } from 'bun:test'
import { previewVCDeletion } from '../deletionImpact'
import { makeSite, makePage, makeNode, makeVC, makeVCNode } from '../../../__tests__/fixtures'

const TARGET_VC_ID = 'vc-target'
const OTHER_VC_ID = 'vc-other'

function makeRefNode(nodeId: string, targetVcId: string, label?: string) {
  return makeNode({
    id: nodeId,
    moduleId: 'base.visual-component-ref',
    props: { componentId: targetVcId },
    label,
  })
}

describe('previewVCDeletion', () => {
  it('returns null when the VC has no refs in pages or other VCs', () => {
    const vc = makeVC({ id: TARGET_VC_ID, name: 'Target' })
    const site = makeSite({ visualComponents: [vc] })
    expect(previewVCDeletion(site, TARGET_VC_ID)).toBeNull()
  })

  it('returns null for an unknown vcId', () => {
    const site = makeSite({ visualComponents: [] })
    expect(previewVCDeletion(site, 'nonexistent')).toBeNull()
  })

  it('detects refs in one page — correct pageCount=1, vcCount=0', () => {
    const vc = makeVC({ id: TARGET_VC_ID, name: 'Target' })
    const rootId = 'root'
    const refId = 'ref-1'
    const page = makePage({
      id: 'page-1',
      title: 'Home',
      rootNodeId: rootId,
      nodes: {
        [rootId]: makeNode({ id: rootId, moduleId: 'base.body', children: [refId] }),
        [refId]: makeRefNode(refId, TARGET_VC_ID, 'My Ref'),
      },
    })
    const site = makeSite({ pages: [page], visualComponents: [vc] })

    const impact = previewVCDeletion(site, TARGET_VC_ID)
    expect(impact).not.toBeNull()
    expect(impact!.vc.id).toBe(TARGET_VC_ID)
    expect(impact!.vc.name).toBe('Target')
    expect(impact!.pageCount).toBe(1)
    expect(impact!.vcCount).toBe(0)
    expect(impact!.usages).toHaveLength(1)
    expect(impact!.usages[0].source.kind).toBe('page')
    if (impact!.usages[0].source.kind === 'page') {
      expect(impact!.usages[0].source.pageId).toBe('page-1')
      expect(impact!.usages[0].source.pageTitle).toBe('Home')
      expect(impact!.usages[0].source.nodeLabel).toBe('My Ref')
    }
  })

  it('detects refs in two pages + inside one other VC', () => {
    const targetVc = makeVC({ id: TARGET_VC_ID, name: 'Target' })

    const page1 = makePage({
      id: 'p1',
      title: 'Page 1',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['r1', 'r2'] }),
        r1: makeRefNode('r1', TARGET_VC_ID),
        r2: makeRefNode('r2', TARGET_VC_ID),
      },
    })
    const page2 = makePage({
      id: 'p2',
      title: 'Page 2',
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['r3'] }),
        r3: makeRefNode('r3', TARGET_VC_ID),
      },
    })

    // Other VC that contains a ref to TARGET_VC_ID
    const otherVcRoot = makeVCNode({ id: 'vc-root', moduleId: 'base.body', children: ['r4'] })
    const otherVcRef = makeVCNode({ id: 'r4', moduleId: 'base.visual-component-ref', props: { componentId: TARGET_VC_ID } })
    const otherVc = makeVC({
      id: OTHER_VC_ID,
      name: 'Other',
      tree: { nodes: { 'vc-root': otherVcRoot, r4: otherVcRef }, rootNodeId: 'vc-root' },
    })

    const site = makeSite({
      pages: [page1, page2],
      visualComponents: [targetVc, otherVc],
    })

    const impact = previewVCDeletion(site, TARGET_VC_ID)
    expect(impact).not.toBeNull()
    expect(impact!.pageCount).toBe(2)
    expect(impact!.vcCount).toBe(1)
    expect(impact!.usages).toHaveLength(4)

    const pageUsages = impact!.usages.filter((u) => u.source.kind === 'page')
    const vcUsages = impact!.usages.filter((u) => u.source.kind === 'visualComponent')
    expect(pageUsages).toHaveLength(3)
    expect(vcUsages).toHaveLength(1)
    if (vcUsages[0].source.kind === 'visualComponent') {
      expect(vcUsages[0].source.vcId).toBe(OTHER_VC_ID)
      expect(vcUsages[0].source.vcName).toBe('Other')
    }
  })

  it('ignores refs whose componentId points to a different VC', () => {
    const targetVc = makeVC({ id: TARGET_VC_ID, name: 'Target' })
    const otherVc = makeVC({ id: OTHER_VC_ID, name: 'Other' })

    const page = makePage({
      nodes: {
        root: makeNode({ id: 'root', moduleId: 'base.body', children: ['r1'] }),
        r1: makeRefNode('r1', OTHER_VC_ID), // refs OTHER_VC_ID, not TARGET
      },
    })
    const site = makeSite({ pages: [page], visualComponents: [targetVc, otherVc] })

    expect(previewVCDeletion(site, TARGET_VC_ID)).toBeNull()
  })

  it('excludes self-references (VC containing a ref to itself)', () => {
    // This state shouldn't normally exist (recursion guard), but if it does
    // we must not report it as a usage that blocks deletion.
    const selfRefNode = makeVCNode({
      id: 'self-ref',
      moduleId: 'base.visual-component-ref',
      props: { componentId: TARGET_VC_ID },
    })
    const vcRoot = makeVCNode({ id: 'vc-root', moduleId: 'base.body', children: ['self-ref'] })
    const targetVc = makeVC({
      id: TARGET_VC_ID,
      name: 'Target',
      tree: { nodes: { 'vc-root': vcRoot, 'self-ref': selfRefNode }, rootNodeId: 'vc-root' },
    })
    const site = makeSite({ visualComponents: [targetVc] })

    // Self-refs are skipped — the VC contains its own id but no page refs
    expect(previewVCDeletion(site, TARGET_VC_ID)).toBeNull()
  })
})
