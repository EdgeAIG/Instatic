/**
 * Regression suite for the page-tree subtree-walker / deletion / clone
 * consolidation (CTO audit finding).
 *
 * Proves:
 *   1. The single cycle-safe walker stops deletion + duplication from hanging
 *      on a corrupt tree containing a `children` cycle.
 *   2. `cloneNodeWithRemap` produces a deep-independent clone — mutating the
 *      clone never bleeds into the source.
 *   3. Every deletion path unlinks the root from its parent's children array
 *      via the O(1) `parentId` cache, never an O(N) whole-map scan.
 */

import { describe, it, expect } from 'bun:test'
import type { Page, PageNode } from '@core/page-tree'
import {
  createNode,
  insertNode,
  deleteNode,
  duplicateNode,
  removeNodeSubtrees,
  deleteSubtree,
  cloneNodeWithRemap,
  collectSubtreeIds,
} from '@core/page-tree'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function node(id: string, overrides: Partial<PageNode> = {}): PageNode {
  return {
    id,
    moduleId: 'base.div',
    props: {},
    breakpointOverrides: {},
    children: [],
    classIds: [],
    parentId: null,
    ...overrides,
  }
}

/**
 * Build a deliberately CORRUPT tree containing a `children` cycle:
 *
 *   root → a → b → a → …  (b.children points back at a)
 *
 * `parentId` is set as a tree mutation would maintain it (first parent wins).
 */
function makeCyclicTree(): Page {
  const nodes: Record<string, PageNode> = {
    root: node('root', { moduleId: 'base.body', children: ['a'] }),
    a: node('a', { parentId: 'root', children: ['b'] }),
    b: node('b', { parentId: 'a', children: ['a'] }), // cycle: b → a
  }
  return { id: 'p', slug: 'index', title: 'Home', rootNodeId: 'root', nodes }
}

// ---------------------------------------------------------------------------
// 1. Cycle safety — deletion + duplication must terminate
// ---------------------------------------------------------------------------

describe('cycle-safe walker', () => {
  it('collectSubtreeIds terminates and dedupes on a cyclic tree', () => {
    const tree = makeCyclicTree()
    const ids = collectSubtreeIds(tree.nodes, 'a')
    expect([...ids].sort()).toEqual(['a', 'b'])
  })

  it('deleteNode does NOT hang on a cyclic tree and removes the whole cycle', () => {
    const tree = makeCyclicTree()
    deleteNode(tree, 'a')
    expect(tree.nodes.a).toBeUndefined()
    expect(tree.nodes.b).toBeUndefined()
    expect(tree.nodes.root.children).not.toContain('a')
  })

  it('duplicateNode does NOT hang on a cyclic tree and yields a fresh clone', () => {
    const tree = makeCyclicTree()
    const newRootId = duplicateNode(tree, 'a')
    expect(typeof newRootId).toBe('string')
    // Original cycle members survive; a fresh clone of `a` was inserted under root.
    expect(tree.nodes.a).toBeDefined()
    expect(tree.nodes[newRootId]).toBeDefined()
    expect(tree.nodes.root.children).toContain('a')
    expect(tree.nodes.root.children).toContain(newRootId)
  })
})

// ---------------------------------------------------------------------------
// 2. cloneNodeWithRemap — deep independence
// ---------------------------------------------------------------------------

describe('cloneNodeWithRemap', () => {
  function richNode(): PageNode {
    return node('src', {
      props: { text: 'hi', nested: { deep: 1 } },
      breakpointOverrides: { mobile: { fontSize: 12 } },
      classIds: ['c1'],
      children: ['child'],
      inlineStyles: { color: 'red' },
      propBindings: { text: { paramId: 'p1' } },
      dynamicBindings: { text: { source: 'page', field: 'title' } },
    })
  }

  it('remaps id, children, and copies classIds (no shared array)', () => {
    const src = richNode()
    const idMap = new Map([['child', 'child-new']])
    const clone = cloneNodeWithRemap(src, { newId: 'dst', idMap })

    expect(clone.id).toBe('dst')
    expect(clone.children).toEqual(['child-new'])
    expect(clone.classIds).toEqual(['c1'])
    expect(clone.classIds).not.toBe(src.classIds)
  })

  it('deep-copies breakpointOverrides — mutating the clone leaves the source intact', () => {
    const src = richNode()
    const clone = cloneNodeWithRemap(src, { newId: 'dst', idMap: new Map() })

    clone.breakpointOverrides.mobile.fontSize = 999
    expect(src.breakpointOverrides.mobile.fontSize).toBe(12)
    expect(clone.breakpointOverrides).not.toBe(src.breakpointOverrides)
    expect(clone.breakpointOverrides.mobile).not.toBe(src.breakpointOverrides.mobile)
  })

  it('shallow-copies props so top-level edits do not bleed back', () => {
    const src = richNode()
    const clone = cloneNodeWithRemap(src, { newId: 'dst', idMap: new Map() })

    clone.props.text = 'changed'
    expect(src.props.text).toBe('hi')
    expect(clone.props).not.toBe(src.props)
  })

  it('copies inlineStyles / propBindings / dynamicBindings independently', () => {
    const src = richNode()
    const clone = cloneNodeWithRemap(src, { newId: 'dst', idMap: new Map() })

    clone.inlineStyles!.color = 'blue'
    clone.propBindings!.text.paramId = 'p2'
    clone.dynamicBindings!.text.field = 'slug'

    expect(src.inlineStyles!.color).toBe('red')
    expect(src.propBindings!.text.paramId).toBe('p1')
    expect(src.dynamicBindings!.text.field).toBe('title')
    expect(clone.inlineStyles).not.toBe(src.inlineStyles)
    expect(clone.propBindings).not.toBe(src.propBindings)
    expect(clone.dynamicBindings).not.toBe(src.dynamicBindings)
  })

  it('classIdRemap drops on null, keeps on identity, remaps otherwise', () => {
    const src = node('src', { classIds: ['keep', 'drop', 'remap'] })
    const clone = cloneNodeWithRemap(src, {
      newId: 'dst',
      idMap: new Map(),
      classIdRemap: (cid) => (cid === 'drop' ? null : cid === 'remap' ? 'remapped' : cid),
    })
    expect(clone.classIds).toEqual(['keep', 'remapped'])
  })
})

// ---------------------------------------------------------------------------
// 3. Deletion paths unlink from the parent's children array
// ---------------------------------------------------------------------------

describe('deletion paths unlink the parent child reference', () => {
  function makeLinearTree(): Page {
    const root = createNode('base.body')
    const a = createNode('base.div')
    const page: Page = { id: 'p', slug: 'index', title: 'Home', rootNodeId: root.id, nodes: { [root.id]: root } }
    insertNode(page, a, root.id)
    const grandchild = createNode('base.text')
    insertNode(page, grandchild, a.id)
    return page
  }

  it('deleteNode removes the node from its parent and deletes the whole subtree', () => {
    const page = makeLinearTree()
    const rootId = page.rootNodeId
    const aId = page.nodes[rootId].children[0]
    const grandId = page.nodes[aId].children[0]

    deleteNode(page, aId)

    expect(page.nodes[rootId].children).not.toContain(aId)
    expect(page.nodes[aId]).toBeUndefined()
    expect(page.nodes[grandId]).toBeUndefined()
  })

  it('removeNodeSubtrees unlinks via parentId — not a whole-map scan', () => {
    // Discriminator: a DECOY node also lists `x` in its children, inserted
    // BEFORE the real parent in iteration order. A whole-map scan would unlink
    // from the decoy (first match); resolving via `parentId` unlinks from the
    // real parent only and leaves the decoy untouched.
    const nodes: Record<string, PageNode> = {
      root: node('root', { moduleId: 'base.body', children: ['decoy', 'realParent'] }),
      decoy: node('decoy', { parentId: 'root', children: ['x'] }), // stale/corrupt ref
      realParent: node('realParent', { parentId: 'root', children: ['x'] }),
      x: node('x', { parentId: 'realParent' }),
    }

    removeNodeSubtrees(nodes, ['x'])

    expect(nodes.x).toBeUndefined()
    expect(nodes.realParent.children).toEqual([]) // unlinked via parentId
    expect(nodes.decoy.children).toEqual(['x']) // proof: the scan never touched it
  })

  it('deleteSubtree with unlinkParent:false leaves the parent reference for the caller to fix', () => {
    const nodes: Record<string, PageNode> = {
      root: node('root', { moduleId: 'base.body', children: ['x'] }),
      x: node('x', { parentId: 'root', children: ['y'] }),
      y: node('y', { parentId: 'x' }),
    }

    deleteSubtree(nodes, 'x', { unlinkParent: false })

    expect(nodes.x).toBeUndefined()
    expect(nodes.y).toBeUndefined()
    // Parent child ref is intentionally NOT removed (slot-sync overwrites it).
    expect(nodes.root.children).toEqual(['x'])
  })
})
