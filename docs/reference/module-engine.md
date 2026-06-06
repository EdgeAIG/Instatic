# Module Engine

Cookbook for adding a new first-party module — the building block used on the visual canvas. For the broader concept of what a module is and how the registry works, see [docs/features/modules.md](../features/modules.md). This page answers "how do I implement one?"

---

## TL;DR

- Define as a `ModuleDefinition<TProps>` from `@core/module-engine/types`.
- Register via `registry.registerOrReplace(YourModule)` in `src/modules/base/index.ts`.
- `id` is namespaced kebab-case (`base.heading`, `acme.product-card`).
- `render(props, renderedChildren)` is **pure** — string → string. No DOM, no React, no side effects.
- String props are HTML-escaped by the publisher before `render` is called.
- CSS from `render()` is deduped by `moduleId` — emit the same CSS per instance, it ships once.
- Editor components **must** spread `nodeWrapperProps` and apply `mcClassName` on the root element.

---

## Minimal module

```ts
// src/modules/base/heading/index.ts
import type { ModuleDefinition } from '@core/module-engine'
import { registry } from '@core/module-engine'
import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { HeadingIcon } from 'pixel-art-icons/icons/heading'
import { HeadingEditor } from './HeadingEditor'

const HeadingPropsSchema = Type.Object({
  level: Type.Number({ default: 2 }),
  text:  Type.String({ default: 'Heading' }),
  align: Type.Union([Type.Literal('left'), Type.Literal('center'), Type.Literal('right')], { default: 'left' }),
})

type HeadingProps = Static<typeof HeadingPropsSchema>

export const HeadingModule: ModuleDefinition<HeadingProps> = {
  id: 'base.heading',
  name: 'Heading',
  description: 'A heading element (h1–h6).',
  category: 'Typography',
  version: '1.0.0',
  icon: HeadingIcon,
  trusted: true,
  canHaveChildren: false,
  propsSchema: HeadingPropsSchema,
  defaults: Value.Create(HeadingPropsSchema),
  htmlTag: 'h2',
  schema: {
    level: {
      type: 'select',
      label: 'Level',
      options: [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `h${n}` })),
    },
    text:  { type: 'text', label: 'Text' },
    align: {
      type: 'select',
      label: 'Align',
      layout: 'inline',
      options: [
        { value: 'left',   label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right',  label: 'Right' },
      ],
    },
  },
  component: HeadingEditor,
  render: (props) => {
    const tag = `h${Math.max(1, Math.min(6, Number(props.level) || 2))}`
    return {
      html: `<${tag} class="heading" data-align="${props.align}">${props.text}</${tag}>`,
      css:  `.heading[data-align="center"] { text-align: center; }
             .heading[data-align="right"]  { text-align: right;  }`,
    }
  },
}

registry.registerOrReplace(HeadingModule)
```

Register via `src/modules/base/index.ts` (import the file — the `registerOrReplace` call at the bottom runs at import time).

That's the whole feature loop: module picker, Properties Panel, publisher, CSS dedup.

---

## Render contract

```ts
render: (props: TProps, renderedChildren: string[]) => RenderOutput
// RenderOutput = { html: string; css?: string }
```

### `props` is trusted (after escaping)

By the time `render` is called:

- String props have been HTML-escaped.
- Dynamic bindings (`{currentEntry.title}`) have been resolved.
- Per-breakpoint overrides have been merged in.

So `${props.title}` inside the HTML string is safe to interpolate as-is for most uses. For URL attributes (`href`, `src`, `action`) always run `safeUrl(value)` from `@modules/base/utils/escape` first.

### `renderedChildren` is trusted

It's an array of already-rendered HTML strings from the publisher walker. Join them:

```ts
render: (props, renderedChildren) => ({
  html: `<div class="container">${renderedChildren.join('')}</div>`,
})
```

Leaf modules (`canHaveChildren: false`) receive an empty array — they can ignore the parameter.

### Returning CSS

```ts
return {
  html: `<div class="my-mod">${renderedChildren.join('')}</div>`,
  css:  `.my-mod { padding: 16px; }`,
}
```

- CSS is deduped per `moduleId` — emit the same CSS for every instance; it appears once in the page.
- Use module-scoped selectors (`.my-mod`, `.my-mod__inner`). Avoid global or id-based selectors.
- `src/modules/` is exempt from `css-token-policy.test.ts` — hex literals are fine here. Editor tokens aren't available in published pages.

---

## Property schema patterns

The `schema` field maps prop keys to `PropertyControl` descriptors. Full union in `src/core/module-engine/propertySchema.ts`.

### Control types

| `type`      | Renders as                                        | Value shape              |
|-------------|---------------------------------------------------|--------------------------|
| `text`      | `<Input>`                                         | `string`                 |
| `textarea`  | `<Textarea>`                                      | `string`                 |
| `richtext`  | Rich text editor (DOMPurify output)               | HTML string              |
| `number`    | `<Input type="number">`                           | `number`                 |
| `toggle`    | `<Switch>`                                        | `boolean`                |
| `select`    | `<Select>` or `<ContextMenu>` for long lists      | option value string      |
| `color`     | `<ColorInput>`                                    | hex string               |
| `url`       | URL text input                                    | `string`                 |
| `dataTable` | Data table picker                                 | table id string          |
| `image`     | Media picker (images)                             | media id or URL string   |
| `media`     | Media picker (image or video)                     | media id string          |
| `svg`       | Inline SVG editor                                 | SVG markup string        |
| `group`     | Collapsible section (visual grouping, no data)    | — (children record)      |

### Conditional controls

```ts
schema: {
  hasIcon: { type: 'toggle', label: 'Show icon' },
  iconName: {
    type:      'select',
    label:     'Icon',
    options:   ICON_OPTIONS,
    condition: { field: 'hasIcon', eq: true },
  },
}
```

Condition operators: `eq`, `notEq`, `in`, `notIn`. Compose with `and` / `or`.

### Edit-permission category

The optional `category` field on a control marks who can edit it:

```ts
text:  { type: 'text',   label: 'Text',  category: 'content' }  // content editors can change
align: { type: 'select', label: 'Align', category: 'layout'  }  // structural — restricted
```

Only `'content'` and `'layout'` are valid. Defaults: `text / textarea / richtext / svg / url / image / media → 'content'`; everything else → `'layout'`.

### Layout

`layout: 'inline'` puts the control on the same row as its label. `layout: 'stacked'` (default) puts it below.

### Hidden controls

`hidden: true` declares a control's `type` for the engine while rendering **no** editor surface. The publisher's `escapeProps` dispatches its escaper on the control `type`, so a publisher-injected binding target the author never hand-edits must still declare its type — otherwise it falls to the `escapeHtml` default.

```ts
// base.outlet — `html` is filled by the publisher with the current entry's
// richtext body; declared hidden+richtext so escapeProps sanitises it
// (DOMPurify) instead of HTML-escaping the rendered body.
html: { type: 'richtext', label: 'Content', hidden: true }
```

### How `escapeProps` uses `type`

`escapeProps(props, schema)` chooses each string prop's escaper from its declared control `type` — **never** from the prop's key name:

| control `type`            | escaper at the publisher boundary                          |
|---------------------------|------------------------------------------------------------|
| `url` / `image` / `media` | `isSafeUrl` (blocks `javascript:` etc.; passed raw for the module's `safeUrl`) |
| `richtext`                | `sanitizeRichtext` (DOMPurify)                             |
| `svg`                     | `sanitizeSvg` (DOMPurify SVG profile)                      |
| everything else, or a prop absent from `schema` | `escapeHtml` (safe default)          |

A prop that needs URL/richtext/SVG handling **must** declare the matching `type` (use `hidden` if it should not appear in the panel). There is no key-name fallback.

---

## Editor canvas component

Provide a React `component` when the module needs DOM interaction at edit time (e.g. a live preview that differs from static HTML, or DOM measurements).

```tsx
// src/modules/base/heading/HeadingEditor.tsx
import React from 'react'
import type { ModuleComponentProps } from '@core/module-engine'

interface HeadingProps extends Record<string, unknown> {
  level: number
  text:  string
  align: string
}

export const HeadingEditor: React.FC<ModuleComponentProps<HeadingProps>> = ({
  props,
  mcClassName,
  nodeWrapperProps,
}) => {
  const tag = `h${Math.max(1, Math.min(6, Number(props.level) || 2))}`
  return React.createElement(tag, {
    ...nodeWrapperProps,   // REQUIRED — wires selection, hover, keyboard to this node
    className: mcClassName, // REQUIRED — applies node.classIds CSS
    'data-align': props.align,
  }, props.text)
}
```

**Rules:**
- Spread `nodeWrapperProps` onto the root element. Without it the node is invisible to the editor's interaction layer (no selection, no hover, no keyboard).
- Apply `mcClassName` as the root element's class. Without it the author's CSS class rules don't apply in the canvas.
- Produce the same DOM structure as `render()` — canvas selection geometry, drop-target detection, and dimension measurement assume parity.
- `nodeWrapperProps` is `undefined` outside the editor (publisher, plugin preview). Components that check for its presence can render a plain published element when it's absent.
- **`*Editor.tsx` must only export React components.** Exporting utilities, types, or constants from the editor file breaks React Fast Refresh HMR — Vite can only hot-patch a component file when every export is a component.

### Sharing logic between `index.ts` and `*Editor.tsx`

When both `render()` (in `index.ts`) and the canvas component need the same helper or type, put the shared code in a **sibling module file** — not exported from the editor file, and not duplicated.

```
src/modules/base/mymod/
├── index.ts          — registration + render() — imports from ./shared
├── MyModEditor.tsx   — component-only file — imports from ./shared
└── shared.ts         — shared helpers + types
```

```ts
// shared.ts
export type MyTag = 'p' | 'h1' | 'h2'
const VALID = new Set<MyTag>(['p', 'h1', 'h2'])
export function normalizeMyTag(tag: unknown): MyTag {
  const v = String(tag || 'p').toLowerCase() as MyTag
  return VALID.has(v) ? v : 'p'
}

// MyModEditor.tsx — component-only
import { normalizeMyTag } from './shared'
// ...

// index.ts — registration + render
import { normalizeMyTag } from './shared'
import { MyModEditor } from './MyModEditor'
// ...
```

The canonical example is `src/modules/base/text/`: `tags.ts` holds `normalizeTag` + `TextTag`, imported by both `TextEditor.tsx` and `index.ts`.

---

## Media in `render`

For `image` and `media` props the publisher's `attachResolvedMediaByKey` puts a resolved object on `props._resolvedMediaByKey?.<propKey>`:

```ts
render: (props) => {
  const resolved = (props._resolvedMediaByKey as Record<string, unknown> | undefined)?.src
  if (!resolved) {
    return { html: `<img src="${props.src}" alt="${props.alt ?? ''}">` }
  }
  // Use resolved.sources, resolved.fallback, resolved.width, resolved.height
  return { html: `<img src="${(resolved as { fallback: string }).fallback}" alt="${props.alt ?? ''}">` }
}
```

See `src/core/publisher/mediaPresentation.ts` for the resolved shape.

---

## `htmlTag` — semantic tag hint

`htmlTag` is a display-only metadata field that tells the editor which HTML tag a module emits as its root element. It is shown as a `<tag>` badge in the DOM / Layers panel next to each row so authors can see the underlying semantics at a glance.

Two forms:

```ts
// Static — tag is always the same regardless of props
htmlTag: 'article',

// Function — tag depends on props (e.g. author-chosen semantic element)
htmlTag: (props) => resolveHtmlTag(props.tag, props.customTag),
// or return null when there is no single deterministic root tag
htmlTag: () => null,
```

Return `null` for modules that don't emit a single deterministic root tag (`base.visual-component-ref`, `base.slot-outlet`, `base.loop`, etc.). The badge is hidden when `null` is returned or when `htmlTag` is omitted.

`htmlTag` is **not consumed by the publisher** — `render()` remains the source of truth for the emitted HTML. This is pure metadata for editor display.

---

## Module dependencies (npm imports)

If the module needs a runtime npm package (e.g. `three.js` in a 3D scene):

```ts
dependencies: {
  three: '^0.171.0',
} as ModuleDependencies
```

The publisher emits a `<script type="importmap">` entry. `getMissingModuleDependencies(...)` surfaces dependencies the site doesn't yet declare in the Dependencies panel.

---

## Forbidden patterns

| Pattern                                                              | Use instead                                              |
|----------------------------------------------------------------------|----------------------------------------------------------|
| `document.querySelector` inside `render`                             | Render is pure. No DOM.                                  |
| `await fetch(...)` inside `render`                                   | Render is sync. Pre-fetch via prefetch helpers.          |
| Mutating `props` inside `render`                                     | Treat props as immutable.                                |
| Emitting `<script>` tags from `render`                              | The publisher sanitizer strips them. Use plugin frontend assets. |
| Hardcoded id selectors in CSS (`.my-mod-${nodeId}`)                 | CSS is deduped per `moduleId`. Use `[data-*]` attribute selectors. |
| Importing from `@admin/...` inside a module                          | Modules are publisher-side. Stay inside `@core/...` and `@ui/...` (icons only). |
| Omitting `nodeWrapperProps` spread in editor component              | Node becomes unselectable and invisible to the editor.  |
| Non-component exports from `*Editor.tsx` (utilities, types, constants) | Put shared logic in a sibling module (e.g. `tags.ts`, `shared.ts`). Editor files must stay component-only for React Fast Refresh HMR to work. |
| Parallel `interface Foo` next to a `FooPropsSchema`                 | Use `type Foo = Static<typeof FooPropsSchema>`.          |

---

## Related

- [docs/features/modules.md](../features/modules.md) — broader module concept, registry, boot-time registration
- [docs/features/publisher.md](../features/publisher.md) — how `render()` fits in the publisher walker
- [docs/features/visual-components.md](../features/visual-components.md) — `base.visual-component-ref`, slots
- [docs/reference/page-tree.md](page-tree.md) — nodes reference modules by `moduleId`
- Source-of-truth files:
  - `src/core/module-engine/types.ts` — `ModuleDefinition`, `RenderOutput`, `ModuleComponentProps`, `NodeWrapperProps`
  - `src/core/module-engine/propertySchema.ts` — `PropertyControl` discriminated union
  - `src/core/module-engine/registry.ts` — `IModuleRegistry`, `registry` singleton
  - `src/modules/base/*` — first-party modules (read these for real examples)
  - `src/modules/base/container/ContainerEditor.tsx` — canonical editor component pattern
