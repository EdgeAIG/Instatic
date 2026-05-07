import { describe, expect, it } from 'bun:test'
import type { Page, PageNode } from '@core/page-tree/schemas'
import {
  getDomDropZone,
  resolveDomDropTarget,
  type DomDropRowMeta,
} from '../../editor/components/DomPanel/domPanelDnd'

function node(id: string, moduleId: string, children: string[] = [], locked = false): PageNode {
  return {
    id,
    moduleId,
    props: {},
    breakpointOverrides: {},
    children,
    locked,
  }
}

function page(nodes: Record<string, PageNode>, rootNodeId = 'root'): Page {
  return {
    id: 'page',
    slug: 'index',
    title: 'Home',
    rootNodeId,
    nodes,
  }
}

const canHaveChildren = (moduleId: string) =>
  moduleId === 'base.body' || moduleId === 'base.container'

const meta = (nodeId: string, top = 100, height = 30): DomDropRowMeta => ({
  nodeId,
  rect: { top, bottom: top + height, height },
})

describe('DOMPanel DnD target resolution', () => {
  it('maps row coordinates to before, inside, and after zones', () => {
    const row = meta('a', 100, 30)

    expect(getDomDropZone(row.rect, 102)).toBe('before')
    expect(getDomDropZone(row.rect, 115)).toBe('inside')
    expect(getDomDropZone(row.rect, 128)).toBe('after')
  })

  it('resolves before and after sibling drops', () => {
    const p = page({
      root: node('root', 'base.body', ['a', 'b', 'c']),
      a: node('a', 'base.text'),
      b: node('b', 'base.text'),
      c: node('c', 'base.text'),
    })

    expect(resolveDomDropTarget({
      page: p,
      draggedId: 'c',
      overId: 'b',
      zone: 'before',
      canHaveChildren,
    })).toEqual({
      draggedId: 'c',
      // Multi-drag: single-drag callers default to `[draggedId]`.
      draggedIds: ['c'],
      parentId: 'root',
      index: 1,
      position: 'before',
      slot: 'default',
      overId: 'b',
    })

    expect(resolveDomDropTarget({
      page: p,
      draggedId: 'a',
      overId: 'b',
      zone: 'after',
      canHaveChildren,
    })).toEqual({
      draggedId: 'a',
      draggedIds: ['a'],
      parentId: 'root',
      index: 1,
      position: 'after',
      slot: 'default',
      overId: 'b',
    })
  })

  it('resolves inside append into containers', () => {
    const p = page({
      root: node('root', 'base.body', ['container', 'leaf']),
      container: node('container', 'base.container', []),
      leaf: node('leaf', 'base.text'),
    })

    expect(resolveDomDropTarget({
      page: p,
      draggedId: 'leaf',
      overId: 'container',
      zone: 'inside',
      canHaveChildren,
    })).toEqual({
      draggedId: 'leaf',
      draggedIds: ['leaf'],
      parentId: 'container',
      index: 0,
      position: 'inside',
      slot: 'default',
      overId: 'container',
    })

  })

  it('normalizes same-parent insertion indices after source removal', () => {
    const p = page({
      root: node('root', 'base.body', ['a', 'b', 'c', 'd']),
      a: node('a', 'base.text'),
      b: node('b', 'base.text'),
      c: node('c', 'base.text'),
      d: node('d', 'base.text'),
    })

    expect(resolveDomDropTarget({
      page: p,
      draggedId: 'a',
      overId: 'd',
      zone: 'after',
      canHaveChildren,
    })?.index).toBe(3)

    expect(resolveDomDropTarget({
      page: p,
      draggedId: 'd',
      overId: 'a',
      zone: 'before',
      canHaveChildren,
    })?.index).toBe(0)
  })

  it('rejects root moves, leaf inside drops, self/descendant drops, locked moves, and no-ops', () => {
    const p = page({
      root: node('root', 'base.body', ['a', 'b', 'locked']),
      a: node('a', 'base.container', ['child']),
      child: node('child', 'base.text'),
      b: node('b', 'base.text'),
      locked: node('locked', 'base.text', [], true),
    })

    expect(resolveDomDropTarget({ page: p, draggedId: 'root', overId: 'b', zone: 'after', canHaveChildren })).toBeNull()
    expect(resolveDomDropTarget({ page: p, draggedId: 'b', overId: 'child', zone: 'inside', canHaveChildren })).toBeNull()
    expect(resolveDomDropTarget({ page: p, draggedId: 'a', overId: 'child', zone: 'inside', canHaveChildren })).toBeNull()
    expect(resolveDomDropTarget({ page: p, draggedId: 'locked', overId: 'b', zone: 'before', canHaveChildren })).toBeNull()
    expect(resolveDomDropTarget({ page: p, draggedId: 'b', overId: 'b', zone: 'inside', canHaveChildren })).toBeNull()
    expect(resolveDomDropTarget({ page: p, draggedId: 'b', overId: 'b', zone: 'before', canHaveChildren })).toBeNull()
  })
})
