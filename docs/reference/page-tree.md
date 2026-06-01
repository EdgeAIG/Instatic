# Page Tree

The `NodeTree<TNode>` primitive — the single tree-of-nodes shape used everywhere in this codebase: page trees, Visual Component trees, and slot fills.

This doc shows the type, the mutation API, and how to correctly route mutations to the active tree from the editor store.

---

## TL;DR

- Every tree of nodes in the CMS uses the shape `NodeTree<TNode> = { nodes: Record<string, TNode>, rootNodeId: string }`. **There is no other tree primitive.**
- The TypeBox schema and the generic type live in **one file**: `src/core/page-tree/treeSchema.ts`.
- A `Page` **is** a `NodeTree<PageNode>` (it adds metadata fields on top).
- A `VisualComponent` **has** a `NodeTree` exposed as `vc.tree`.
- A slot fill is the children subtree of a `base.slot-instance` node — it lives directly in the consumer page tree, no separate prop.
- All mutations live in `src/core/page-tree/mutations.ts` and operate **generically** on any `NodeTree<TNode>`. They know nothing about page vs. VC.
- The editor store's `mutateActiveTree(fn)` is the **only** place that decides which tree to mutate. Store actions are one-liners that call it.

---

## The shape

`src/core/page-tree/treeSchema.ts`:

```ts
export interface NodeTree<TNode extends BaseNode = BaseNode> {
  nodes: Record<string, TNode>     // flat map for O(1) lookup
  rootNodeId: string                // entry point for traversal
}

export const NodeTreeSchema = Type.Object({
  nodes:      Type.Record(Type.String(), BaseNodeSchema),
  rootNodeId: Type.String(),
})
```

Why a flat map plus a root id:

- **O(1) lookup** by id — no recursive search to find a node.
- **Cheap structural sharing** in Immer — mutating one node only invalidates that key.
- **Stable references in props** — any prop that points at a node uses its id (`children: string[]`), so reordering / moving nodes doesn't break references.

### `BaseNode` — the shared structural base

`src/core/page-tree/baseNode.ts`:

```ts
export const BaseNodeSchema = Type.Object({
  id:                  Type.String(),
  moduleId:            Type.String(),         // 'base.container', 'base.text', etc.
  props:               withFallback(Type.Record(Type.String(), Type.Unknown()), {}),
  breakpointOverrides: withFallback(Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())), {}),
  children:            Type.Array(Type.String()),   // ordered child node IDs
  label:               Type.Optional(Type.String()),
  locked:              Type.Optional(Type.Boolean()),
  hidden:              Type.Optional(Type.Boolean()),
  classIds:            withFallback(Type.Array(Type.String()), []),
  inlineStyles:        Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  // ... propBindings, etc.
})
```

`inlineStyles` is the per-node **inline-style layer**: a camelCase CSS bag (same shape as a `StyleRule`'s `styles`) that the publisher emits as a literal `style="…"` attribute on the node's root element (or on `<body>` for the root `base.body` node). It is independent of `classIds` (a node can have both) and is **base-only** — like a real HTML `style=""` attribute it cannot be breakpoint- or condition-scoped. Values are sanitised at the publish boundary by `bagToInlineStyle` → `sanitiseCssValue`. Edited via the Properties panel's "Style inline" mode (store actions `setNodeInlineStyles` / `removeNodeInlineStyleProperty`); the HTML importer also writes it when it harvests an element's inline background image.

`PageNode` (in `src/core/page-tree/pageNode.ts`) extends `BaseNode` with an optional `dynamicBindings` field for template data-binding. `VCNode` (in `src/core/visualComponents/schemas.ts`) is a direct re-export — `VCNode === BaseNode`.

### Where each kind of tree lives

| Tree kind                | Type                  | Stored where                            |
|--------------------------|-----------------------|-----------------------------------------|
| `Page` (a page's tree)   | `NodeTree<PageNode>`  | `data_rows` row, table `pages`, cell `body` |
| `VisualComponent.tree`   | `NodeTree<BaseNode>`  | `data_rows` row, table `components`, cell `tree` |
| Slot fill                | Children of `base.slot-instance` | Same page tree as its consumer  |

There is no separate `pages` table, no `page_versions` table. Everything content-shaped is in `data_tables` + `data_rows`.

---

## Runtime Validation

The canonical TypeBox schemas for tree mutation RPCs live with the tree engine:

- `TreeOperationSchema` validates the 11 `applyTreeOperation` variants. Insert operations require a complete `PageNode`.
- `TreeMutateResultSchema` validates the `{ tree, affectedNodeIds }` response shape.
- `parsePageNodeTree(value)` validates a `NodeTree` payload and then checks tree invariants that JSON Schema cannot express: `rootNodeId` must exist, node-map keys must match each node's `id`, child IDs must resolve, and the reachable tree must be acyclic.

Page and Visual Component persistence runs the same invariant check before accepting trees. Plugin `cms.content.tree.mutate` and `cms.content.tree.replace` use these schemas before storing page-tree cells, so cross-VM payloads ride the same tree contract as the editor.

---

## The mutation API

All mutations live in `src/core/page-tree/mutations.ts`. They take a `NodeTree<PageNode>` (or sometimes a `SiteDocument` for cross-page operations) and mutate it in place — they're written for use inside Immer drafts.

### Node mutations (operate on a single `NodeTree`)

| Function                                                          | What it does                                                |
|-------------------------------------------------------------------|-------------------------------------------------------------|
| `createNode(moduleId, defaults?) → PageNode`                      | Build a new node with a generated id (not yet inserted)     |
| `insertNode(tree, node, parentId, index?)`                        | Insert under `parentId` at `index` (append if omitted)      |
| `deleteNode(tree, nodeId)`                                        | Remove a node and its entire subtree                        |
| `updateNodeProps(tree, nodeId, patch)`                            | Shallow merge `patch` into the node's `props`               |
| `setBreakpointOverride(tree, nodeId, breakpointId, propKey, value)` | Set a per-breakpoint prop override                        |
| `clearBreakpointOverride(tree, nodeId, breakpointId, propKey)`    | Remove a per-breakpoint override                            |
| `renameNode(tree, nodeId, label)`                                 | Set the user-facing `label`                                 |
| `toggleNodeLocked(tree, nodeId)`                                  | Flip `locked`                                               |
| `toggleNodeHidden(tree, nodeId)`                                  | Flip `hidden`                                               |
| `moveNode(tree, nodeId, newParentId, newIndex)`                   | Re-parent + re-order                                        |
| `moveNodes(tree, nodeIds, newParentId, newIndex)`                 | Same, multi-select                                          |
| `duplicateNode(tree, nodeId, ...)`                                | Deep-clone with fresh ids, place after the original         |
| `wrapNode(tree, nodeId, wrapperModuleId)`                         | Wrap a node in a new container                              |
| `wrapNodes(tree, nodeIds, wrapperModuleId)`                       | Same, multi-select                                          |
| `pasteSubtree(tree, subtree, parentId, index?)`                   | Insert a previously-copied subtree with new ids             |

### Site-level mutations (operate on a `SiteDocument`)

| Function                                       | What it does                                  |
|------------------------------------------------|-----------------------------------------------|
| `addPage(site, title, slug) → Page`            | Append a new page to `site.pages`             |
| `deletePage(site, pageId)`                     | Remove a page                                 |
| `renamePage(site, pageId, title, slug?)`       | Update title (and slug)                       |
| `reorderPages(site, fromIndex, toIndex)`       | Reorder the page list                         |
| `duplicatePage(site, pageId, ...)`             | Clone a page with a fresh id and slug         |

### Helpers and selectors

`src/core/page-tree/selectors.ts`:

- `getParent(tree, nodeId)` — returns `{ parentId, index }` or `null`.
- `isAncestor(tree, ancestorId, descendantId)` — true if `ancestor` is on the path to `descendant`.

`src/core/page-tree/scopedClassClone.ts`:

- `cloneScopedClassesForNodeMap(...)` — rewrites class ids that scope to specific nodes when those nodes are duplicated.

`src/core/page-tree/slugs.ts` (exported via `@core/page-tree`):

- `pagePublicPath(slug)` — maps a slug to its public URL path: `'index'` → `'/'`, everything else → `'/<slug>'`.
- `isHomePage(page)` — returns `true` when `page.slug === 'index'`. The home page is the one published at the site root.
- `findHomePage(pages)` — returns the `Page` with `slug === 'index'`, or `undefined`. Used by `lifecycleActions` to default the editor to the home page on load and by `SiteExplorerPanel` to pin it to the top of the list.
- `normalizePageSlug(value)` — lowercases, strips invalid characters, and collapses hyphens.
- `pageSlugError(slug)` — returns a validation error message or `null` if the slug is valid.
- `pageSlugDuplicateError(slug, pages, currentPageId?)` — checks for slug collisions across the page list.
- `createUniquePageSlug(title, pages)` — generates a collision-free slug from a page title.

---

## Routing mutations from the editor store

The editor store at `src/admin/pages/site/store/` has 11 named tree-mutation actions:

```text
insertNode, deleteNode, updateNodeProps,
setBreakpointOverride, clearBreakpointOverride,
renameNode, toggleNodeLocked, toggleNodeHidden,
moveNode, duplicateNode, wrapNode
```

Every one of them is a **one-liner** that delegates to `mutateActiveTree(fn)` — the sole place that branches on page-mode vs. VC-mode:

```ts
// src/admin/pages/site/store/slices/site/ (canonical pattern)
function mutateActiveTree(fn: (tree: NodeTree<PageNode>) => void): void {
  if (mode === 'page') {
    fn(activePage)                              // Page IS NodeTree<PageNode>
  } else {
    fn(vc.tree as NodeTree<PageNode>)           // VCNode === BaseNode structurally
  }
}

// All 11 actions follow this shape:
insertNode: (node, parentId, index) =>
  set((s) => mutateActiveTree((tree) => insertNode(tree, node, parentId, index))),
```

Gated by `src/__tests__/architecture/no-vc-mode-branches-in-mutations.test.ts`: any of the 11 store actions that introduces a `kind === 'visualComponent'` branch fails the build.

### Why this is correct

`PageNode` adds `dynamicBindings` to `BaseNode`. `VCNode === BaseNode`. The 11 mutations only touch fields that exist on the base — they never read `dynamicBindings`, so the cast in VC-mode is safe.

---

## Cookbook

### Walk every node in a tree

```ts
import type { NodeTree, PageNode } from '@core/page-tree'

function eachNode(tree: NodeTree<PageNode>, visit: (node: PageNode) => void): void {
  const stack = [tree.rootNodeId]
  while (stack.length) {
    const id = stack.pop()!
    const node = tree.nodes[id]
    if (!node) continue
    visit(node)
    stack.push(...node.children)
  }
}
```

The flat map plus children-as-ids makes traversal trivial in either direction.

### Find a node's parent

```ts
import { getParent } from '@core/page-tree'

const parent = getParent(tree, nodeId)
if (parent) {
  console.log('node', nodeId, 'lives under', parent.parentId, 'at index', parent.index)
}
```

`getParent` returns `null` for the root.

### Insert a freshly-created node

```ts
import { createNode, insertNode } from '@core/page-tree'

const heading = createNode('base.heading', { level: 2, text: 'Hello' })
insertNode(tree, heading, parentId)   // appended
// or
insertNode(tree, heading, parentId, 0) // first child
```

### Add a new store mutation

1. **Write the tree function** in `src/core/page-tree/mutations.ts`. Generic in `TNode`, takes the tree first.
2. **Wire the store action** in `src/admin/pages/site/store/slices/site/nodeActions.ts`:

   ```ts
   yourMutation: (...args) =>
     set((s) => mutateActiveTree((tree) => yourMutation(tree, ...args))),
   ```
3. **Don't branch on VC mode.** The gate will fail your build if you do.

### Validate a tree loaded from disk

```ts
import { parsePageNodeTree } from '@core/page-tree'

const tree = parsePageNodeTree(raw)
// Returns a typed NodeTree<PageNode>; throws on schema mismatch, missing root,
// node-map key/id mismatch, unresolved child IDs, or reachable cycles.
```

`parsePageNodeTree` checks both the TypeBox schema (`NodeTreeSchema`) and the post-schema invariants that JSON Schema cannot express (root presence, key parity, child resolution, acyclicity). The persistence layer (`src/core/persistence/validate.ts`) and the plugin content handlers use this for every tree payload.

---

## Forbidden patterns

| Pattern                                                         | Use instead                                                |
|-----------------------------------------------------------------|------------------------------------------------------------|
| Maintaining a parallel local copy of node data inside a panel   | Read from the store via a selector (Constraint #182)       |
| Branching on `kind === 'visualComponent'` inside a store mutation | Let `mutateActiveTree` route — keep the mutation generic |
| Treating slot fills as a separate "slotContent" prop            | Slot fills are children of a `base.slot-instance` node in the same tree |
| Adding a parallel `interface NodeTree` type                     | `NodeTreeSchema` and `NodeTree<TNode>` in `treeSchema.ts` are the source of truth |
| Using a non-flat tree representation (nested `children: PageNode[]`) | Flat map + `children: string[]` — gated by `task455-tree-primitive.test.ts` |
| Writing a mutation that takes a `Page` specifically             | Take `NodeTree<TNode>` — pages and VCs both pass            |
| Deep-importing a concrete file: `import X from '@core/page-tree/mutations'` | Import through the barrel: `import { X } from '@core/page-tree'` — gated by `no-core-barrel-deep-imports.test.ts` |

---

## Related

- [docs/architecture.md](../architecture.md) — system overview
- [docs/editor.md](../editor.md) — editor store and `mutateActiveTree`
- [docs/features/plugin-system.md](../features/plugin-system.md) — plugins ship VCs via `pack/site.json`
- Source-of-truth files:
  - `src/core/page-tree/treeSchema.ts` — `NodeTreeSchema` + `NodeTree<TNode>`
  - `src/core/page-tree/baseNode.ts` — `BaseNodeSchema` + `BaseNode`
  - `src/core/page-tree/pageNode.ts` — `PageNode` (extends `BaseNode`)
  - `src/core/page-tree/page.ts` — `Page` (is `NodeTree<PageNode>` + metadata)
  - `src/core/page-tree/mutations.ts` — all node + site mutations
  - `src/core/page-tree/selectors.ts` — `getParent`, `isAncestor`, etc.
  - `src/core/visualComponents/schemas.ts` — `VCNode` (= `BaseNode`)
  - `src/admin/pages/site/store/slices/site/nodeActions.ts` — store actions calling `mutateActiveTree`
- Gate tests:
  - `src/__tests__/architecture/task455-tree-primitive.test.ts`
  - `src/__tests__/architecture/no-vc-mode-branches-in-mutations.test.ts`
  - `src/__tests__/architecture/centralized-site-mutation-history.test.ts`
  - `src/__tests__/architecture/visual-components-mutation-contract.test.ts`
  - `src/__tests__/architecture/no-core-barrel-deep-imports.test.ts` — external code imports from `@core/page-tree`, never from `@core/page-tree/<file>`
