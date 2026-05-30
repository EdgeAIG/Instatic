# Style Rule Registry (formerly CSS Class Registry)

The site's style rule registry — `Record<string, StyleRule>` stored on the site shell (`site.styleRules`). Every user-defined CSS rule lives here. The publisher compiles entries to CSS at publish time; the editor's canvas injects the same CSS for live preview.

Two kinds of rules:

1. **Author-facing class rules** (`kind: 'class'`) — the user picks a name (`hero-button`, `card-meta`) and the editor applies them via `node.classIds`. Selector is `.<name>`.
2. **Ambient rules** (`kind: 'ambient'`) — attach by CSS selector matching, not by node assignment (e.g. `h1`, `.hero .title`, `a:hover`). The publisher emits the rule but never writes to `class=` attributes.
3. **Scoped classes** — generated class-kind rules owned by a single node (for "set this property only on this element"). The scope object pins the rule to its node.

---

## TL;DR

- Stored on `SiteShell.styleRules: Record<string, StyleRule>`.
- Source-of-truth schema: `StyleRuleSchema` in `src/core/page-tree/styleRule.ts`.
- Compiled to CSS by `classCss.ts` in the publisher; collected via `collectClassCSS(site)`.
- Each node references class-kind rules by id (`node.classIds: string[]`). Later ids in the array win in cascade order.
- Rule **name** is the display label; for class-kind rules the CSS selector is `.<name>`; for ambient rules the `selector` field is a verbatim CSS selector.
- Rule **id** is the stable internal identifier (`<nanoid>`).
- Scoped rules (`scope: { type: 'node', nodeId, role: 'module-style' }`) are pinned to one node.
- Generated rules (framework-emitted spacing utilities, etc.) are flagged on `generated` so the ClassPicker can filter them out by default.

---

## The `StyleRule` shape

```ts
interface StyleRule {
  id:           string                              // nanoid, stable across renames
  name:         string                              // display name / CSS class name for class-kind rules
  kind:         'class' | 'ambient'                // discriminator
  selector:     string                              // CSS selector (e.g. '.hero-button' or 'h1 > span')
  order:        number                              // cascade order; rules sorted ascending by this
  description?: string
  scope?: {
    type:   'node'
    nodeId: string
    role:   'module-style'
  }
  styles:           Record<string, unknown>          // base CSS properties (CSSPropertyBag-shaped at write time)
  contextStyles:     Record<string, Record<string, unknown>>  // per-context overrides, keyed by context id
  generated?:    GeneratedClassMetadata               // framework-generated flags
  createdAt?:   number
  updatedAt?:   number
}
```

`contextStyles` is the **unified editing-context map** (see [docs/plans/2026-05-30-unified-condition-axis.md](../plans/2026-05-30-unified-condition-axis.md)). Each key is a *context id* that is **either**:

- a **width breakpoint id** (from `site.breakpoints`) → the publisher emits `@media (max-width: Npx)`; **or**
- a **custom condition id** (from `site.conditions`, the reusable `@media`/`@container`/`@supports` registry) → the publisher emits that condition's `@`-prelude.

This one map replaces the old split between `breakpointStyles` (width breakpoints) and `conditionalLayers` (everything else) — they were the same axis modelled twice. `parseStyleRule` migrates both legacy fields into `contextStyles`; the site-level `conditions` registry is reconstructed from legacy `conditionalLayers` in `parseSiteDocument`.

`styles` and `contextStyles` are typed `Record<string, unknown>` at the persistence boundary — narrowing happens at the publisher's `bagToCSS` (`classCss.ts`). The WRITE API (class slice, framework generators) uses the typed `CSSPropertyBag` shape from `src/core/page-tree/cssPropertyBag.ts`.

---

## Naming

Class-kind rule **name** is the public CSS identifier. It must be a valid CSS identifier. `assertValidCssClassName(name)` enforces:

- Starts with a letter or `-_`
- Contains only letters, digits, `-`, `_`
- Doesn't collide with reserved names

Rule **id** is internal (a nanoid). Refs from nodes (`classIds`) and from internal data structures use the id, not the name. This means renaming a rule doesn't break anything that references it.

Plugin-shipped rules are namespaced under the plugin id: `acme.template/hero-root`. See [docs/features/plugin-system.md](../features/plugin-system.md) (the pack section).

---

## Assigning class rules to nodes

```ts
interface PageNode {
  // ...
  classIds: string[]    // ordered; later ids win in CSS cascade
}
```

Only `kind: 'class'` rules are assigned via `classIds`. Ambient rules (`kind: 'ambient'`) attach by CSS matching and never appear in `classIds`.

The editor's ClassPicker (right Properties Panel) adds / removes entries from `node.classIds`. Order matters — drag-reorder is supported.

At render time, `classNamesForClassIds(classIds, registry)` returns the rendered class names that go onto the element's `class=` attribute. `injectNodeClassIds(html, node, site)` in the publisher splices them into the root tag.

---

## Compiling rules to CSS

`collectClassCSS(site)` walks the style rule registry and emits CSS for each entry. Rules are sorted by `order` ascending so later, more-specific overrides appear later in source and win on equal specificity.

```text
For each rule in registry (sorted by order):
  selector = rule.selector               // e.g. '.hero-button' or 'h1 > span'
  base CSS  = bagToCSS(rule.styles)
  emit:     '${selector} { ${base CSS} }'

  for each (contextId, bag) in rule.contextStyles:
    if contextId is a custom condition (site.conditions):  // emitted first
      prelude = '@media <query>' | '@container [name] (<query>)' | '@supports (<query>)'
    else if contextId is a width breakpoint (site.breakpoints):  // emitted after, width-sorted
      prelude = '@media (max-width: ${width}px)'
    else:  // orphaned key — skipped
      continue
    emit: '${prelude} { ${selector} { ${bagToCSS(bag)} } }'
```

Cascade order within a rule: base → custom conditions (registry order) → width breakpoints (widest first, narrowest last).

The compiled string is part of the per-page CSS bundle (see [docs/features/publisher.md](../features/publisher.md) → CSS pipeline).

### `bagToCSS`

Translates the property bag (`{ color: '#fff', padding: { top: 16, right: 8 } }`) to CSS strings. Handles:

- Plain values: `color: #fff;`
- Spacing bags: `padding: 16px 8px 0 0;` (decomposed)
- Variable references: `color: var(--site-primary);`
- Multi-value props (transforms, transitions): joined per CSS rules

Invalid entries are silently dropped — the bag is tolerant.

---

## Scoped rules

A scoped rule is **owned by one node**. Its scope object pins it to that node's id and a role:

```ts
{
  id:    'class-abc',
  name:  '__pb_scope_<nodeId>',          // generated, never user-facing
  kind:  'class',
  selector: '.__pb_scope_<nodeId>',
  order: 0,
  scope: { type: 'node', nodeId: 'node-xyz', role: 'module-style' },
  styles: { 'border-radius': '12px' },
}
```

When the publisher emits the selector, it generates a uniquely-prefixed name so it can't be applied accidentally elsewhere:

```css
[data-node-id="node-xyz"].__pb_scope_node-xyz {
  border-radius: 12px;
}
```

Use scoped rules when you want **per-node styling** without polluting the global class palette. The Properties Panel exposes this via "Edit only this element" controls.

### Duplicating nodes with scoped rules

When a node is duplicated, its scoped rules need fresh ids that point at the duplicated nodes (not the originals). `cloneScopedClassesForNodeMap(scopedRules, oldToNewIdMap)` rewrites them in one pass.

Called by `duplicateNode` and `pasteSubtree` in `src/core/page-tree/mutations.ts`.

---

## Generated rules (framework + plugin)

A "generated" rule is one the codebase emits programmatically — typically the spacing scale utilities (`.pad-1`, `.pad-2`, ...) or the typography scale. They have `generated.origin === 'framework'` with family/step tags.

`classUtils.ts`:

```ts
isUserVisibleClass(cls)        // false for generated rules — hides them from the ClassPicker by default
isGeneratedClass(cls)          // true if `generated.origin === 'framework'`
isGeneratedClassLocked(cls)    // true if the rule is locked from manual edit (the framework owns its styles)
generatedClassKindLabel(cls)   // e.g. 'Spacing', 'Typography' — for grouping in the ClassPicker advanced view
```

The framework regenerates these rules whenever the user changes the framework scale (Site → Framework → Scale panel). Users can opt to show them in the ClassPicker via Settings → Editor → Show framework-generated classes.

---

## Tolerant parse

`parseStyleRule(raw)` is tolerant — it never throws. Invalid `scope` shapes drop silently; missing `styles` falls back to `{}`; missing `id` or `name` makes the whole entry skip. `parseStyleRuleRegistry(raw)` walks an entire registry and filters out invalid entries.

This is what makes the editor robust against partially-corrupt persisted data — a single broken rule doesn't break the whole site load.

The tolerant parser also backfills `kind`, `selector`, and `order` on old persisted shells that predate the selectors system.

Hard parsing (throws on shape mismatch) uses `Value.Parse(StyleRuleSchema, raw)` directly. The persistence layer uses the tolerant path so the editor can render even with garbage entries.

---

## Cookbook

### Create a class-kind rule

```ts
import { nanoid } from 'nanoid'
import type { StyleRule } from '@core/page-tree'
import { classKindSelector } from '@core/page-tree'

const name = 'hero-button'
const rule: StyleRule = {
  id:       nanoid(),
  name,
  kind:     'class',
  selector: classKindSelector(name),
  order:    0,
  styles: {
    'background-color': 'var(--site-primary)',
    'padding':          { top: 12, right: 24, bottom: 12, left: 24 },
    'border-radius':    '8px',
  },
}

useEditorStore.getState().createClass(rule)
```

The rule is added to `site.styleRules`. The publisher emits CSS for it on next publish.

### Assign a class rule to a node

```ts
useEditorStore.getState().setNodeClassIds(nodeId, ['hero-button'])
```

The class names appear on the rendered element via `classNamesForClassIds`.

### Per-context styles (breakpoints + custom conditions)

```ts
{
  id:    'card',
  name:  'card',
  kind:  'class',
  selector: '.card',
  order: 0,
  styles:        { padding: 16, 'border-radius': 8 },
  contextStyles: {
    mobile:  { padding: 8 },                       // width breakpoint id
    desktop: { padding: 24 },                      // width breakpoint id
    'media:(orientation: landscape)': { padding: 12 },  // custom condition id (site.conditions)
  },
}
```

The publisher wraps each context block in the matching `@media (max-width: …)` (width breakpoint) or the custom condition's `@media`/`@container`/`@supports` prelude.

### Scoped rule for one node

The Properties Panel's "Custom" tab generates a scoped rule automatically when the user sets a property only on that node. Internally:

```ts
const name = `__pb_scope_${nodeId}`
const scoped: StyleRule = {
  id:       nanoid(),
  name,
  kind:     'class',
  selector: classKindSelector(name),
  order:    0,
  scope: { type: 'node', nodeId, role: 'module-style' },
  styles: { 'border-radius': '12px' },
}
useEditorStore.getState().createClass(scoped)
useEditorStore.getState().setNodeClassIds(nodeId, [...existing, scoped.id])
```

The user never sees `__pb_scope_<nodeId>` — the panel shows it as "Custom styles".

### Rename a class rule

Rule **id** is stable; **name** is editable. The editor mutates `rule.name`. Nodes that reference the rule by id keep working — only the rendered CSS class name changes.

### Delete a rule

`useEditorStore.getState().deleteClass(classId)`:

1. Remove the entry from `site.styleRules`.
2. Walk every node and remove the id from `classIds`.
3. (Optional) If the rule is scoped to a now-deleted node, the rule can be GC'd alongside.

---

## Forbidden patterns

| Pattern                                                              | Use instead                                              |
|----------------------------------------------------------------------|----------------------------------------------------------|
| Storing CSS strings directly on nodes                                | Add a `StyleRule` to the registry; reference via `classIds` |
| Looking up a rule by name                                           | Look up by id — names can be renamed                     |
| Hand-emitting CSS in module `render`                                 | Add a rule to the registry — modules emit shared CSS, not per-instance overrides |
| Forgetting to clone scoped rules on duplicate / paste              | `cloneScopedClassesForNodeMap` — called by mutations     |
| Letting users name a class `__pb_scope_*`                            | The validator rejects names starting with `__pb_`        |
| Mixing user rules and framework rules in the same `classIds` array without intent | The order matters — later wins. Framework rules are usually last (override semantics). |
| Reading `rule.styles` as `CSSPropertyBag` without narrowing         | The persistence boundary stores `Record<string, unknown>` — narrow via `bagToCSS` or `parseStylesBag` |
| Hard-failing the editor on a corrupt rule entry                     | `parseStyleRuleRegistry` is tolerant — invalid entries drop silently |
| Assigning an ambient rule to `node.classIds`                        | Ambient rules attach by selector matching — only `kind: 'class'` rules go in `classIds` |

---

## Related

- [docs/features/publisher.md](../features/publisher.md) — `collectClassCSS` in the CSS pipeline
- [docs/features/site-shell.md](../features/site-shell.md) — `Record<string, StyleRule>` on the shell
- [docs/reference/page-tree.md](page-tree.md) — `node.classIds`
- [docs/design.md](../design.md) — design rules around user classes
- Source-of-truth files:
  - `src/core/page-tree/styleRule.ts` — `StyleRuleSchema`, `parseStyleRule`, `parseStyleRuleRegistry`
  - `src/core/page-tree/classNames.ts` — `styleRuleSelector`, `classNamesForClassIds`, `assertValidCssClassName`
  - `src/core/page-tree/classUtils.ts` — `isUserVisibleClass`, `isGeneratedClass`, ...
  - `src/core/page-tree/cssPropertyBag.ts` — `CSSPropertyBag` type
  - `src/core/page-tree/scopedClassClone.ts` — `cloneScopedClassesForNodeMap`
  - `src/core/publisher/classCss.ts` — `bagToCSS`
  - `src/core/publisher/cssCollector.ts` — `collectClassCSS`
- Gate tests:
  - `src/__tests__/architecture/framework-typography-spacing.test.ts`
  - `src/__tests__/architecture/task427-preview-class-css.test.ts`
