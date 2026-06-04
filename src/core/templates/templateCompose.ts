import type { Page, PageNode } from '@core/page-tree'
import { assertSingleOutlet } from './templateValidation'

export type TerminalContent =
  | { kind: 'page'; page: Page }
  | { kind: 'entry' }

type Nodes = Record<string, PageNode>

/** The single base.outlet id, or throw TemplateOutletError on zero/two. */
function requireOutletId(nodes: Nodes): string {
  const ids: string[] = []
  for (const id in nodes) if (nodes[id].moduleId === 'base.outlet') ids.push(id)
  assertSingleOutlet(ids) // throws TemplateOutletError unless exactly one
  return ids[0]
}

function hasMeaningfulBodyProps(node: PageNode): boolean {
  return Object.keys(node.props ?? {}).length > 0
    || Object.keys(node.breakpointOverrides ?? {}).length > 0
}

/** Clone a tree's nodes with every id prefixed, returning the remapped root id. */
function rekey(nodes: Nodes, rootId: string, prefix: string): { nodes: Nodes; rootId: string } {
  const map = new Map<string, string>()
  for (const id in nodes) map.set(id, `${prefix}${id}`)
  const out: Nodes = {}
  for (const id in nodes) {
    const n = nodes[id]
    out[map.get(id)!] = { ...n, id: map.get(id)!, children: n.children.map((c) => map.get(c) ?? c) }
  }
  return { nodes: out, rootId: map.get(rootId)! }
}

/** Find the parent id + index of `childId` within `nodes`. */
function locate(nodes: Nodes, childId: string): { parentId: string; index: number } | null {
  for (const id in nodes) {
    const i = nodes[id].children.indexOf(childId)
    if (i !== -1) return { parentId: id, index: i }
  }
  return null
}

/**
 * Resolve the spliced content of an inner tree, mutating `nodes` if a wrapper
 * must be created:
 *  - inner root is base.body with NO meaningful props → splice its children
 *    directly (avoid a nested <body>, no needless wrapper);
 *  - inner root is base.body WITH props/breakpointOverrides → migrate those onto
 *    a fresh base.container wrapping its children, so body styling survives;
 *  - otherwise → the root itself.
 * Returns the ids to insert at the outlet position. The dropped base.body
 * wrapper is removed from `nodes` by the caller.
 */
function contentRootIds(nodes: Nodes, rootId: string, prefix: string): string[] {
  const root = nodes[rootId]
  if (root?.moduleId !== 'base.body') return [rootId]
  if (!hasMeaningfulBodyProps(root)) return [...root.children]
  // Migrate body-level styling onto a container so nothing is silently lost.
  const containerId = `${prefix}bodyprops`
  nodes[containerId] = {
    id: containerId,
    moduleId: 'base.container',
    props: { ...root.props },
    breakpointOverrides: { ...root.breakpointOverrides },
    children: [...root.children],
  } as PageNode
  return [containerId]
}

/** Replace the single base.outlet in `host` with `inner`'s content nodes. */
function spliceIntoOutlet(host: Nodes, hostRoot: string, inner: Nodes, innerRoot: string, prefix: string): { nodes: Nodes; rootId: string } {
  const outletId = requireOutletId(host) // throws on zero/two outlets
  const at = locate(host, outletId)
  const rekeyed = rekey(inner, innerRoot, prefix)
  const merged: Nodes = { ...host, ...rekeyed.nodes }
  const contentIds = contentRootIds(merged, rekeyed.rootId, prefix)
  delete merged[outletId]
  // If the inner root was base.body, that wrapper node is now orphaned — drop it.
  if (rekeyed.nodes[rekeyed.rootId]?.moduleId === 'base.body') delete merged[rekeyed.rootId]
  if (at) {
    const parent = merged[at.parentId]
    merged[at.parentId] = {
      ...parent,
      children: [...parent.children.slice(0, at.index), ...contentIds, ...parent.children.slice(at.index + 1)],
    }
  }
  return { nodes: merged, rootId: hostRoot }
}

/**
 * Merge an ordered (outer→inner) template chain + terminal into one Page.
 * See plan Phase 3 for the splice contract.
 */
export function composeTemplateChain(chain: Page[], terminal: TerminalContent): Page {
  if (chain.length === 0) {
    if (terminal.kind === 'page') return terminal.page
    throw new Error('composeTemplateChain: entry terminal requires at least one template')
  }

  // Build the merged tree from the INNERMOST template outward.
  const innermost = chain[chain.length - 1]
  let acc: { nodes: Nodes; rootId: string } = { nodes: { ...innermost.nodes }, rootId: innermost.rootNodeId }

  // Innermost terminal handling.
  if (terminal.kind === 'page') {
    acc = spliceIntoOutlet(acc.nodes, acc.rootId, terminal.page.nodes, terminal.page.rootNodeId, 'c0_')
  }
  // entry terminal: leave the innermost outlet in place (renders currentEntry.body).

  // Wrap with each outer template, inner-most-but-one first.
  for (let i = chain.length - 2; i >= 0; i--) {
    const outer = chain[i]
    acc = spliceIntoOutlet({ ...outer.nodes }, outer.rootNodeId, acc.nodes, acc.rootId, `t${i}_`)
  }

  return {
    id: innermost.id, // identifies "what was rendered" for the publish.html filter
    slug: innermost.slug,
    title: innermost.title,
    rootNodeId: acc.rootId,
    nodes: acc.nodes,
  }
}
