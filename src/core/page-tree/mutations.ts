import { nanoid } from 'nanoid'
import type { Page } from './page'
import type { PageNode } from './pageNode'
import type { SiteDocument } from './siteDocument'
import type { NodeTree } from './treeSchema'
import type { TreeOperation } from './operationSchema'
import { getParent, isAncestor } from './selectors'
import { normalizePageSlug, uniquePageSlug } from './slugs'
import { cloneScopedClassesForNodeMap } from './scopedClassClone'

/**
 * Pure Immer-compatible mutation helpers for the page tree.
 *
 * These are called inside Zustand's Immer middleware — they mutate a draft
 * NodeTree/SiteDocument directly. Every function here is also safe to call as
 * a pure function when given a structuredClone'd object.
 *
 * Naming convention:
 *   - Node-level mutations take a `NodeTree<PageNode>` draft as first arg.
 *   - Site-level mutations take a `SiteDocument` draft.
 *
 * Since `Page` IS a `NodeTree<PageNode>` (it has `nodes` and `rootNodeId` plus
 * metadata fields), callers that pass a `Page` draft continue to work unchanged.
 */

// ---------------------------------------------------------------------------
// Node creation helpers
// ---------------------------------------------------------------------------

export function createNode(
  moduleId: string,
  defaults: Record<string, unknown> = {}
): PageNode {
  return {
    id: nanoid(),
    moduleId,
    props: { ...defaults },
    breakpointOverrides: {},
    children: [],
    classIds: [],
  }
}

// ---------------------------------------------------------------------------
// Node insertion
// ---------------------------------------------------------------------------

/**
 * Insert a new node as a child of parentId at the given index.
 * If index is omitted, appends to the end.
 */
export function insertNode(
  tree: NodeTree<PageNode>,
  node: PageNode,
  parentId: string,
  index?: number
): void {
  if (tree.nodes[node.id]) {
    throw new Error(`[PageTree] Node "${node.id}" already exists in the tree`)
  }
  const parent = tree.nodes[parentId]
  if (!parent) {
    throw new Error(`[PageTree] Parent node "${parentId}" not found`)
  }
  tree.nodes[node.id] = node
  if (index === undefined || index >= parent.children.length) {
    parent.children.push(node.id)
  } else {
    parent.children.splice(Math.max(0, index), 0, node.id)
  }
}

// ---------------------------------------------------------------------------
// Node deletion
// ---------------------------------------------------------------------------

/**
 * Remove a node and ALL its descendants from the tree.
 * Also removes the node's ID from its parent's children array.
 */
export function deleteNode(tree: NodeTree<PageNode>, nodeId: string): void {
  if (nodeId === tree.rootNodeId) {
    throw new Error(`[PageTree] Cannot delete the root node.`)
  }
  // Collect all descendant IDs to delete
  const toDelete = new Set<string>()
  const stack = [nodeId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = tree.nodes[id]
    if (!node) continue
    toDelete.add(id)
    stack.push(...node.children)
  }
  // Remove from parent's children array
  const parent = getParent(tree, nodeId)
  if (parent) {
    parent.children = parent.children.filter((id) => id !== nodeId)
  }
  // Remove all collected nodes
  for (const id of toDelete) {
    delete tree.nodes[id]
  }
}

// ---------------------------------------------------------------------------
// Node props update
// ---------------------------------------------------------------------------

/** Update one or more props on a node (shallow merge). */
export function updateNodeProps(
  tree: NodeTree<PageNode>,
  nodeId: string,
  patch: Partial<Record<string, unknown>>
): void {
  const node = tree.nodes[nodeId]
  if (!node) throw new Error(`[PageTree] Node "${nodeId}" not found`)
  Object.assign(node.props, patch)
}

/** Set a breakpoint override for one or more props. */
export function setBreakpointOverride(
  tree: NodeTree<PageNode>,
  nodeId: string,
  breakpointId: string,
  patch: Partial<Record<string, unknown>>
): void {
  const node = tree.nodes[nodeId]
  if (!node) throw new Error(`[PageTree] Node "${nodeId}" not found`)
  if (!node.breakpointOverrides[breakpointId]) {
    node.breakpointOverrides[breakpointId] = {}
  }
  Object.assign(node.breakpointOverrides[breakpointId], patch)
}

/** Clear all breakpoint overrides for a specific breakpoint on a node. */
export function clearBreakpointOverride(
  tree: NodeTree<PageNode>,
  nodeId: string,
  breakpointId: string
): void {
  const node = tree.nodes[nodeId]
  if (!node) return
  delete node.breakpointOverrides[breakpointId]
}

// ---------------------------------------------------------------------------
// Node metadata
// ---------------------------------------------------------------------------

export function renameNode(tree: NodeTree<PageNode>, nodeId: string, label: string): void {
  const node = tree.nodes[nodeId]
  if (!node) throw new Error(`[PageTree] Node "${nodeId}" not found`)
  node.label = label.trim() || undefined
}

export function toggleNodeLocked(tree: NodeTree<PageNode>, nodeId: string): void {
  const node = tree.nodes[nodeId]
  if (!node) throw new Error(`[PageTree] Node "${nodeId}" not found`)
  node.locked = !node.locked
}

export function toggleNodeHidden(tree: NodeTree<PageNode>, nodeId: string): void {
  const node = tree.nodes[nodeId]
  if (!node) throw new Error(`[PageTree] Node "${nodeId}" not found`)
  node.hidden = !node.hidden
}

// ---------------------------------------------------------------------------
// Node reorder / move
// ---------------------------------------------------------------------------

/**
 * Move a node to a new position within its current parent, or to a new parent.
 *
 * @param newParentId  - Target parent node ID
 * @param newIndex     - Insertion index within the new parent's children
 */
export function moveNode(
  tree: NodeTree<PageNode>,
  nodeId: string,
  newParentId: string,
  newIndex: number
): void {
  if (nodeId === tree.rootNodeId) {
    throw new Error(`[PageTree] Cannot move the root node.`)
  }
  if (isAncestor(tree, nodeId, newParentId)) {
    throw new Error(
      `[PageTree] Cannot move node "${nodeId}" into its own descendant "${newParentId}".`
    )
  }
  const newParent = tree.nodes[newParentId]
  if (!newParent) throw new Error(`[PageTree] New parent "${newParentId}" not found`)

  // Remove from old parent
  const oldParent = getParent(tree, nodeId)
  if (oldParent) {
    oldParent.children = oldParent.children.filter((id) => id !== nodeId)
  }

  // Insert at new location
  const clampedIndex = Math.max(0, Math.min(newIndex, newParent.children.length))
  newParent.children.splice(clampedIndex, 0, nodeId)
}

// ---------------------------------------------------------------------------
// Node duplication
// ---------------------------------------------------------------------------

/**
 * Deep-clone a node subtree, assigning new IDs to all cloned nodes.
 * Inserts the clone immediately after the source node in the same parent.
 * Returns the ID of the new root clone node.
 *
 * `options.nodeIdMap` accepts a precomputed oldId → newId map; if omitted, one
 * is built locally via DFS from `nodeId`. Callers that need to clone scoped
 * classes alongside the node duplication MUST precompute the map (so they can
 * call `cloneScopedClassesForNodeMap` against it) and pass it in.
 *
 * `options.classIdRemap` lets the caller remap classIds at clone time — needed
 * when scoped classes were cloned alongside the nodes (each old node-scoped
 * classId maps to a fresh clone with the new node's `scope.nodeId`). Class ids
 * NOT in the map pass through unchanged.
 */
export function duplicateNode(
  tree: NodeTree<PageNode>,
  nodeId: string,
  options: {
    nodeIdMap?: Map<string, string>
    classIdRemap?: Map<string, string>
  } = {},
): string {
  const idMap = options.nodeIdMap ?? new Map<string, string>()
  const { classIdRemap } = options

  // Build id mapping for entire subtree if the caller didn't provide one.
  // If the caller passed a precomputed map, trust it as-is — the caller
  // already walked the subtree (typically to build a class-id remap against
  // the same set of node ids).
  if (idMap.size === 0) {
    const stack = [nodeId]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (idMap.has(id)) continue
      const node = tree.nodes[id]
      if (!node) continue
      idMap.set(id, nanoid())
      stack.push(...node.children)
    }
  }

  // Clone all nodes with remapped IDs, children, and (optionally) classIds.
  for (const [oldId, newId] of idMap) {
    const original = tree.nodes[oldId]
    if (!original) continue
    tree.nodes[newId] = {
      ...original,
      id: newId,
      props: { ...original.props },
      breakpointOverrides: Object.fromEntries(
        Object.entries(original.breakpointOverrides).map(([k, v]) => [k, { ...v }])
      ),
      children: original.children.map((childId) => idMap.get(childId) ?? childId),
      classIds: classIdRemap
        ? original.classIds.map((cid) => classIdRemap.get(cid) ?? cid)
        : [...original.classIds],
    }
  }

  // Insert the new root clone after the original in its parent
  const newRootId = idMap.get(nodeId)!
  const parent = getParent(tree, nodeId)
  if (parent) {
    const idx = parent.children.indexOf(nodeId)
    parent.children.splice(idx + 1, 0, newRootId)
  }

  return newRootId
}

// ---------------------------------------------------------------------------
// Paste — insert a foreign subtree from a clipboard payload
// ---------------------------------------------------------------------------

/**
 * Build a map of fresh node IDs for every node reachable from `rootNodeId`
 * inside `nodes`. Each entry maps the source-side ID to a freshly minted
 * `nanoid()` ID, suitable for inserting the subtree into the target tree
 * without collisions.
 *
 * Exposed separately from `pasteSubtree` because the clipboard slice needs
 * the map up front: scoped classes carry a `scope.nodeId` that must be
 * remapped to the new node ID before the class is added to the target site.
 */
export function buildSubtreeNodeIdMap(
  rootNodeId: string,
  nodes: Record<string, PageNode>,
): Map<string, string> {
  const idMap = new Map<string, string>()
  const stack = [rootNodeId]
  while (stack.length > 0) {
    const id = stack.pop()!
    const node = nodes[id]
    if (!node) continue
    if (idMap.has(id)) continue
    idMap.set(id, nanoid())
    stack.push(...node.children)
  }
  return idMap
}

/**
 * Insert a foreign subtree (root node + descendants) under a target parent.
 *
 * The payload comes from the clipboard slice and may originate from any page.
 * All node IDs are regenerated on insert so collisions with the target tree
 * are impossible.
 *
 * `options.nodeIdMap` accepts a precomputed map (typically built via
 * `buildSubtreeNodeIdMap`); if omitted, one is built locally. Callers that
 * need to remap class scope.nodeId in tandem with node IDs MUST precompute
 * the map and pass it in.
 *
 * `options.classIdRemap` lets the caller filter / remap classIds at insertion
 * time — needed when the payload references classes that don't exist in the
 * active document or framework classes that were regenerated with different
 * IDs. Return `null` from the mapper to drop a classId, or a string to remap
 * it.
 *
 * Returns the new root node ID inside the target tree.
 */
export function pasteSubtree(
  tree: NodeTree<PageNode>,
  payload: { rootNodeId: string; nodes: Record<string, PageNode> },
  parentId: string,
  index?: number,
  options: {
    nodeIdMap?: Map<string, string>
    classIdRemap?: (classId: string) => string | null
  } = {}
): string {
  const parent = tree.nodes[parentId]
  if (!parent) {
    throw new Error(`[PageTree] Parent node "${parentId}" not found`)
  }

  const idMap = options.nodeIdMap ?? buildSubtreeNodeIdMap(payload.rootNodeId, payload.nodes)
  const { classIdRemap } = options

  // Clone every node with remapped ID, props, breakpointOverrides, children,
  // and (optionally) filtered classIds.
  for (const [oldId, newId] of idMap) {
    const original = payload.nodes[oldId]
    if (!original) continue

    const remappedClassIds = classIdRemap
      ? original.classIds.flatMap((cid) => {
          const next = classIdRemap(cid)
          return next === null ? [] : [next]
        })
      : [...original.classIds]

    tree.nodes[newId] = {
      ...original,
      id: newId,
      props: { ...original.props },
      breakpointOverrides: Object.fromEntries(
        Object.entries(original.breakpointOverrides).map(([k, v]) => [k, { ...v }])
      ),
      children: original.children
        .map((childId) => idMap.get(childId))
        .filter((cid): cid is string => typeof cid === 'string'),
      classIds: remappedClassIds,
    }
  }

  // Insert the new root under its target parent.
  const newRootId = idMap.get(payload.rootNodeId)
  if (!newRootId) {
    throw new Error('[PageTree] Clipboard payload root not found in payload.nodes')
  }
  if (index === undefined || index >= parent.children.length) {
    parent.children.push(newRootId)
  } else {
    parent.children.splice(Math.max(0, index), 0, newRootId)
  }

  return newRootId
}

// ---------------------------------------------------------------------------
// Wrap / unwrap
// ---------------------------------------------------------------------------

/**
 * Wrap a node (and its position in the parent) inside a new container module.
 * The new container takes the node's position; the node becomes the container's first child.
 */
export function wrapNode(
  tree: NodeTree<PageNode>,
  nodeId: string,
  containerModuleId: string,
  containerDefaults: Record<string, unknown> = {}
): string {
  if (nodeId === tree.rootNodeId) {
    throw new Error(`[PageTree] Cannot wrap the root node.`)
  }
  const parent = getParent(tree, nodeId)
  if (!parent) throw new Error(`[PageTree] Node "${nodeId}" has no parent and cannot be wrapped.`)

  const wrapper = createNode(containerModuleId, containerDefaults)
  const idx = parent.children.indexOf(nodeId)

  // Insert wrapper at the node's position
  tree.nodes[wrapper.id] = wrapper
  parent.children[idx] = wrapper.id

  // Make the original node the wrapper's first child
  wrapper.children.push(nodeId)

  return wrapper.id
}

/**
 * Wrap a multi-selection of nodes inside a single new container.
 *
 * Algorithm — "closest common ancestor" semantics (matches Figma):
 *   1. Reduce `nodeIds` to its TOP-LEVEL set (drop nodes whose ancestor is also
 *      in the set — they'd be moved with their ancestor anyway).
 *   2. Find the closest common ancestor of every top-level id.
 *   3. For each top-level id, walk up to its child-of-CCA — that's the
 *      "branch" the id contributes to the CCA. The branches are the new
 *      wrapper's children (deduped, in CCA-children order).
 *   4. Insert the wrapper at the index of the FIRST branch within the CCA's
 *      children, then move all branches into the wrapper preserving order.
 *
 * The wrapper takes the position of the first contributing branch; subsequent
 * branches are spliced out of the CCA and into the wrapper. This handles all
 * three cases uniformly:
 *   - same parent contiguous → behaves like sequential `wrapNode` calls
 *   - same parent non-contiguous → wraps every selected sibling, preserving order
 *   - different parents → wraps the CCA-level branches that CONTAIN the selection
 *
 * Returns the new wrapper's id.
 *
 * Throws if any id is the root, missing, or if the selection set is empty.
 */
export function wrapNodes(
  tree: NodeTree<PageNode>,
  nodeIds: string[],
  containerModuleId: string,
  containerDefaults: Record<string, unknown> = {},
): string {
  if (nodeIds.length === 0) {
    throw new Error(`[PageTree] wrapNodes requires at least one node id.`)
  }
  if (nodeIds.length === 1) {
    return wrapNode(tree, nodeIds[0], containerModuleId, containerDefaults)
  }

  // Validate ids exist and are not root.
  for (const id of nodeIds) {
    if (id === tree.rootNodeId) {
      throw new Error(`[PageTree] Cannot wrap the root node.`)
    }
    if (!tree.nodes[id]) {
      throw new Error(`[PageTree] Node "${id}" not found in tree.`)
    }
  }

  // ── Step 1: Reduce to top-level ids ────────────────────────────────────────
  // A node is "top level" within the selection if none of its ancestors are
  // also in the selection. Otherwise, wrapping it would move it twice.
  const idSet = new Set(nodeIds)
  const topLevel: string[] = []
  for (const id of nodeIds) {
    let ancestor = getParent(tree, id)
    let dominated = false
    while (ancestor) {
      if (idSet.has(ancestor.id)) {
        dominated = true
        break
      }
      ancestor = getParent(tree, ancestor.id)
    }
    if (!dominated) topLevel.push(id)
  }

  // ── Step 2: Closest common ancestor ────────────────────────────────────────
  const cca = findClosestCommonAncestor(tree, topLevel)
  if (!cca) {
    throw new Error(`[PageTree] No common ancestor for selection — cannot wrap.`)
  }

  // ── Step 3: Compute branches (each id's child-of-CCA ancestor) ─────────────
  // Order them by their position in cca.children so the wrapper preserves the
  // visual order of the original tree.
  const branchSet = new Set<string>()
  for (const id of topLevel) {
    const branch = ancestorChildOf(tree, id, cca.id)
    if (!branch) {
      throw new Error(
        `[PageTree] Could not resolve branch for "${id}" under "${cca.id}".`,
      )
    }
    branchSet.add(branch)
  }

  const branchesInOrder = cca.children.filter((childId) => branchSet.has(childId))
  if (branchesInOrder.length === 0) {
    throw new Error(`[PageTree] Computed empty branch set — cannot wrap.`)
  }

  // ── Step 4: Insert wrapper at first-branch index, move branches in ─────────
  const wrapper = createNode(containerModuleId, containerDefaults)
  tree.nodes[wrapper.id] = wrapper

  const firstBranchIdx = cca.children.indexOf(branchesInOrder[0])
  // Remove every branch from cca.children, then splice the wrapper in at the
  // first-branch slot. Wrapper's children become the removed branches in order.
  cca.children = cca.children.filter((childId) => !branchSet.has(childId))
  cca.children.splice(firstBranchIdx, 0, wrapper.id)
  wrapper.children = branchesInOrder

  return wrapper.id
}

/**
 * Move a multi-selection of nodes into a new parent at a target index.
 *
 * Same "top-level reduction" as `wrapNodes`: nodes whose ancestor is also in
 * the move set are dropped (they move with the ancestor automatically).
 *
 * Cycle guard: every top-level id must NOT be an ancestor of `newParentId`.
 *
 * Final placement: the moved branches end up consecutively starting at
 * `newIndex` in `newParent.children`, preserving their selection order.
 */
export function moveNodes(
  tree: NodeTree<PageNode>,
  nodeIds: string[],
  newParentId: string,
  newIndex: number,
): void {
  if (nodeIds.length === 0) return
  if (nodeIds.length === 1) {
    moveNode(tree, nodeIds[0], newParentId, newIndex)
    return
  }
  const newParent = tree.nodes[newParentId]
  if (!newParent) throw new Error(`[PageTree] New parent "${newParentId}" not found`)

  // Reduce to top-level set.
  const idSet = new Set(nodeIds)
  const topLevel: string[] = []
  for (const id of nodeIds) {
    if (id === tree.rootNodeId) {
      throw new Error(`[PageTree] Cannot move the root node.`)
    }
    let ancestor = getParent(tree, id)
    let dominated = false
    while (ancestor) {
      if (idSet.has(ancestor.id)) {
        dominated = true
        break
      }
      ancestor = getParent(tree, ancestor.id)
    }
    if (!dominated) topLevel.push(id)
  }

  // Cycle guard.
  for (const id of topLevel) {
    if (isAncestor(tree, id, newParentId)) {
      throw new Error(
        `[PageTree] Cannot move node "${id}" into its own descendant "${newParentId}".`,
      )
    }
  }

  // Detach each moved id from its current parent (top-down). Some moved ids
  // may share the same parent — filtering once per parent is correct.
  for (const id of topLevel) {
    const oldParent = getParent(tree, id)
    if (oldParent) {
      oldParent.children = oldParent.children.filter((childId) => childId !== id)
    }
  }

  // Insert into newParent at newIndex, preserving topLevel order.
  const clamped = Math.max(0, Math.min(newIndex, newParent.children.length))
  newParent.children.splice(clamped, 0, ...topLevel)
}

/**
 * Find the closest common ancestor of a set of node ids.
 *
 * Algorithm: collect each id's ancestor chain (root → id), then intersect.
 * The deepest id present in every chain is the CCA.
 *
 * Returns `null` if the ids have no common ancestor (cannot happen in a
 * well-formed tree where root is the universal ancestor — but we guard
 * against orphan nodes anyway).
 */
function findClosestCommonAncestor(
  tree: NodeTree<PageNode>,
  nodeIds: string[],
): PageNode | null {
  if (nodeIds.length === 0) return null

  // Build chain for the first id, including itself.
  const firstChain = ancestorChainInclusive(tree, nodeIds[0])
  if (firstChain.length === 0) return null

  // Intersect with each subsequent id's chain (set membership).
  let candidate = firstChain
  for (let i = 1; i < nodeIds.length; i++) {
    const chain = new Set(ancestorChainInclusive(tree, nodeIds[i]).map((n) => n.id))
    candidate = candidate.filter((n) => chain.has(n.id))
    if (candidate.length === 0) return null
  }

  // The CCA is the DEEPEST node in the intersection — i.e. the LAST entry,
  // since `ancestorChainInclusive` returns root → id order. But the CCA must
  // not be one of the input ids itself (a node is not its own wrapper-parent).
  // Walk up from the deepest survivor until we find one not in the input set.
  const inputSet = new Set(nodeIds)
  for (let i = candidate.length - 1; i >= 0; i--) {
    if (!inputSet.has(candidate[i].id)) return candidate[i]
  }
  return null
}

/** Return [root, ..., nodeId] — inclusive ancestor chain. */
function ancestorChainInclusive(
  tree: NodeTree<PageNode>,
  nodeId: string,
): PageNode[] {
  const chain: PageNode[] = []
  let current: PageNode | undefined = tree.nodes[nodeId]
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    chain.unshift(current)
    if (current.id === tree.rootNodeId) break
    current = getParent(tree, current.id)
  }
  return chain
}

/**
 * Walk up from `nodeId` until reaching a node whose parent is `ancestorId`.
 * Returns that "branch" node — i.e. the descendant of `ancestorId` that
 * contains `nodeId` in its subtree. Returns null if `ancestorId` is not an
 * ancestor of `nodeId`.
 */
function ancestorChildOf(
  tree: NodeTree<PageNode>,
  nodeId: string,
  ancestorId: string,
): string | null {
  let current = nodeId
  const visited = new Set<string>()
  while (!visited.has(current)) {
    visited.add(current)
    const parent = getParent(tree, current)
    if (!parent) return null
    if (parent.id === ancestorId) return current
    current = parent.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Tree operation dispatcher — single entry point shared by editor + plugins
// ---------------------------------------------------------------------------
//
// `applyTreeOperation` is a thin pure dispatcher over the 11 named node-level
// mutations above. The visual editor reaches them via Zustand store actions
// (which wrap each call in `mutateActiveTree`); plugins reach them via this
// dispatcher so a single tagged-union shape carries op intent across the
// VM boundary (`api.cms.content.tree(...).mutate([...])`).
//
// Discriminated by `op.kind`; one branch per named mutation. Returns the
// (possibly cloned) tree alongside the ids whose subtree may have been
// affected — used by callers that need to invalidate caches per-node.
//
// The dispatcher does NOT clone the tree on its own — it mutates the input.
// Callers that need a pure read-only path must clone (`structuredClone`) the
// tree before passing it in.

interface ApplyTreeOperationResult {
  tree: NodeTree<PageNode>
  affectedNodeIds: string[]
}

export function applyTreeOperation(
  tree: NodeTree<PageNode>,
  op: TreeOperation,
): ApplyTreeOperationResult {
  switch (op.kind) {
    case 'insertNode': {
      insertNode(tree, op.node, op.parentId, op.index)
      return { tree, affectedNodeIds: [op.parentId, op.node.id] }
    }
    case 'updateNodeProps': {
      updateNodeProps(tree, op.nodeId, op.props)
      return { tree, affectedNodeIds: [op.nodeId] }
    }
    case 'setBreakpointOverride': {
      setBreakpointOverride(tree, op.nodeId, op.breakpoint, op.props)
      return { tree, affectedNodeIds: [op.nodeId] }
    }
    case 'clearBreakpointOverride': {
      clearBreakpointOverride(tree, op.nodeId, op.breakpoint)
      return { tree, affectedNodeIds: [op.nodeId] }
    }
    case 'renameNode': {
      renameNode(tree, op.nodeId, op.name)
      return { tree, affectedNodeIds: [op.nodeId] }
    }
    case 'toggleNodeLocked': {
      toggleNodeLocked(tree, op.nodeId)
      return { tree, affectedNodeIds: [op.nodeId] }
    }
    case 'toggleNodeHidden': {
      toggleNodeHidden(tree, op.nodeId)
      return { tree, affectedNodeIds: [op.nodeId] }
    }
    case 'moveNode': {
      const oldParent = getParent(tree, op.nodeId)
      moveNode(tree, op.nodeId, op.parentId, op.index)
      return {
        tree,
        affectedNodeIds: oldParent
          ? [op.nodeId, op.parentId, oldParent.id]
          : [op.nodeId, op.parentId],
      }
    }
    case 'duplicateNode': {
      const newId = duplicateNode(tree, op.nodeId)
      return { tree, affectedNodeIds: [op.nodeId, newId] }
    }
    case 'wrapNode': {
      const wrapperId = wrapNode(tree, op.nodeId, op.wrapper.moduleId, op.wrapper.defaults)
      return { tree, affectedNodeIds: [op.nodeId, wrapperId] }
    }
    case 'deleteNode': {
      const parent = getParent(tree, op.nodeId)
      deleteNode(tree, op.nodeId)
      return { tree, affectedNodeIds: parent ? [parent.id] : [] }
    }
  }
}

// ---------------------------------------------------------------------------
// Page-level mutations (called on SiteDocument draft)
// ---------------------------------------------------------------------------

export function addPage(site: SiteDocument, title: string, slug: string): Page {
  const rootNode = createNode('base.body')
  const page: Page = {
    id: nanoid(),
    title,
    // Auto-unique so a repeated create (same title/slug) never collides — a
    // duplicate slug fails validateSite and bricks every save.
    slug: uniquePageSlug(slug, site.pages),
    rootNodeId: rootNode.id,
    nodes: { [rootNode.id]: rootNode },
  }
  site.pages.push(page)
  return page
}

export function deletePage(site: SiteDocument, pageId: string): void {
  if (site.pages.length <= 1) {
    throw new Error(`[PageTree] Cannot delete the last page in a site.`)
  }
  site.pages = site.pages.filter((p) => p.id !== pageId)
}

export function renamePage(site: SiteDocument, pageId: string, title: string, slug?: string): void {
  const page = site.pages.find((p) => p.id === pageId)
  if (!page) throw new Error(`[PageTree] Page "${pageId}" not found`)
  page.title = title
  if (slug !== undefined) {
    const normalized = normalizePageSlug(slug)
    // 'index' is the homepage intent — set it verbatim (homepage swap is a
    // separate concern). Any other slug is made unique against sibling pages
    // (excluding this one) so a rename can't introduce a duplicate slug.
    page.slug = normalized === 'index'
      ? 'index'
      : uniquePageSlug(slug, site.pages, pageId)
  }
}

export function reorderPages(site: SiteDocument, fromIndex: number, toIndex: number): void {
  const pages = site.pages
  const [moved] = pages.splice(fromIndex, 1)
  pages.splice(toIndex, 0, moved)
}

/**
 * Deep-clone a page (every node + its children, props, classIds,
 * breakpointOverrides) under a new title and slug. The cloned nodes get
 * fresh nanoid IDs so they don't collide with the source page. Returns
 * the new Page; caller is responsible for activating it if desired.
 *
 * Per-node "module-style" CSS classes (those with `scope.type === 'node'`)
 * are also cloned with fresh class ids and rewritten `scope.nodeId`s — the
 * publisher emits one CSS rule per class, so without this clone the new page
 * would silently share style entries with the source page (editing one would
 * restyle both). The newly cloned classes are written to `site.styleRules`.
 */
export function duplicatePage(
  site: SiteDocument,
  sourcePageId: string,
  title: string,
  slug?: string,
): Page {
  const source = site.pages.find((p) => p.id === sourcePageId)
  if (!source) throw new Error(`[PageTree] Page "${sourcePageId}" not found`)

  // Build a fresh-id map for every node in the source page.
  const idMap = new Map<string, string>()
  for (const oldId of Object.keys(source.nodes)) {
    idMap.set(oldId, nanoid())
  }

  // Clone every node-scoped class for nodes in the source page so the new
  // page gets its own scoped classes (with `scope.nodeId` pointing at the
  // duplicate's node ids). Non-scoped classes are shared and not cloned.
  const { added: clonedClasses, classIdRemap } = cloneScopedClassesForNodeMap(
    idMap,
    site.styleRules,
  )
  for (const cls of clonedClasses) {
    site.styleRules[cls.id] = cls
  }

  // Clone each node with remapped IDs, remapped child references, and
  // remapped scoped-class ids.
  const newNodes: Record<string, PageNode> = {}
  for (const [oldId, oldNode] of Object.entries(source.nodes)) {
    const newId = idMap.get(oldId)!
    newNodes[newId] = {
      ...oldNode,
      id: newId,
      props: { ...oldNode.props },
      breakpointOverrides: Object.fromEntries(
        Object.entries(oldNode.breakpointOverrides).map(([k, v]) => [k, { ...v }]),
      ),
      children: oldNode.children
        .map((childId) => idMap.get(childId))
        .filter((cid): cid is string => typeof cid === 'string'),
      classIds: oldNode.classIds.map((cid) => classIdRemap.get(cid) ?? cid),
    }
  }

  const newRootId = idMap.get(source.rootNodeId)
  if (!newRootId) {
    throw new Error('[PageTree] Source page root node missing from page.nodes')
  }

  const newPage: Page = {
    id: nanoid(),
    title,
    // Auto-unique — a duplicate ("Copy") must not collide with the source slug.
    slug: uniquePageSlug(slug ?? title, site.pages),
    rootNodeId: newRootId,
    nodes: newNodes,
  }
  site.pages.push(newPage)
  return newPage
}
