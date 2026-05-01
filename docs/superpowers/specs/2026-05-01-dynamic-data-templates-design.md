# Dynamic Data Templates Design

## Goal

Add CMS templates to the existing page builder so content entries can render through page-built layouts. The first target is entry detail routes such as `/posts/my-post`, with the same editor experience used for pages and visual components.

The core rule is: a template is a page document with template metadata and prop-level dynamic bindings. It is not a separate editor or a separate tree format.

## Current Context

The app already has:

- `SiteDocument.pages[]` with `Page.nodes` and `PageNode.props`.
- `SiteDocument.visualComponents[]` for reusable canvas trees.
- CMS content collections and Markdown-backed entries.
- Public rendering through module `render()` functions and the page publisher.
- Property controls driven by module schemas.

Templates reuse these systems instead of creating a parallel rendering stack.

## Core Model

Extend `Page` with optional template metadata:

```ts
interface PageTemplateConfig {
  enabled: true
  context: 'entry'
  collectionId: string
  priority: number
  conditions: TemplateCondition[]
}

interface Page {
  id: string
  slug: string
  title: string
  nodes: Record<string, PageNode>
  rootNodeId: string
  template?: PageTemplateConfig
}
```

In the UI, templates appear in a separate `Templates` section. Internally, they remain pages. A page can be converted to a template by adding `page.template`, and a template can be converted back to a page by removing `page.template`.

Converting a template back to a page must remove all dynamic bindings in that page. Static `props` are kept as-is. The UI must confirm this because dynamic behavior is being removed.

## Template Routing

Collections own route bases. Templates do not own route patterns directly.

```ts
interface ContentCollection {
  routeBase: string // example: '/posts'
}
```

Route resolution for `/posts/my-post`:

1. Match `/posts` to the `Posts` collection.
2. Load published entry by slug `my-post`.
3. Find templates where:
   - `template.enabled === true`
   - `template.context === 'entry'`
   - `template.collectionId === collection.id`
   - all template conditions match the entry.
4. Sort by priority descending.
5. If priorities tie, use the page order in `SiteDocument.pages[]` as the deterministic tie-breaker.
6. Render the first matching template.

The MVP stores `conditions: []` and exposes priority in the template settings. Condition editing can be added later without changing the selection model.

Future contexts can include:

```ts
context: 'collection' // archive/list route such as /posts
context: 'taxonomy'   // category/tag routes
```

## Dynamic Bindings

Extend `PageNode` with prop-level dynamic bindings:

```ts
interface DynamicPropBinding {
  source: 'currentEntry'
  field: string
  format?: 'plain' | 'html' | 'url' | 'media'
  fallback?: 'static' | 'empty'
}

interface PageNode {
  props: Record<string, unknown>
  dynamicBindings?: Record<string, DynamicPropBinding>
}
```

Bindings do not replace static props. Static props remain as fallback values and are preserved when bindings are removed.

Initial binding source:

```ts
source: 'currentEntry'
```

Initial supported fields:

- `title`
- `slug`
- `url`
- `bodyMarkdown`
- `seoTitle`
- `seoDescription`
- `featuredMedia.url`
- `featuredMedia.alt`
- `featuredMedia.mimeType`

Initial compatible property control types:

- text
- textarea / rich text
- URL
- image
- media

Incompatible controls do not show binding UI in the first implementation.

## Binding UX

The binding picker appears directly in compatible property fields when editing a template with an entry context.

Static state:

- Field behaves like a normal input.
- A binding affordance is available on click/focus or as a small field action.
- Opening the picker uses the same dropdown/autocomplete pattern as the class picker.

Picker state:

- Searchable list grouped under `Current post`.
- Options show readable labels such as `Title`, `Body`, `Featured media URL`.
- Selecting an option writes `node.dynamicBindings[propKey]`.

Bound state:

- The normal input is replaced by a read-only binding control.
- The control has bold diagonal stripe background treatment.
- The visible value is the binding label, for example `Current post · Title`.
- An `x` button removes the binding and restores the normal static input.

This makes binding state visible exactly where it matters and avoids a separate abstract data-mapping screen.

## Template Editor UI

Site explorer sections:

- Pages
- Templates
- Components
- Styles
- Scripts

Page row context menu:

- `Convert to template`

Template row context menu:

- `Edit template settings`
- `Convert to page`

Template settings dialog:

- Name
- Collection
- Context, initially fixed to `Entry`
- Priority
- Preview entry
- Conditions area reserved for later and read-only in MVP

Template editing uses the same canvas, module picker, classes, breakpoints, DOM tree, and properties panel as pages. The toolbar shows template context, for example `Template · Posts`, and makes the preview entry easy to change.

When there is a real entry, editor preview uses that entry. If no entry exists yet, the editor uses clearly marked sample data so the template is still editable. Public rendering never uses sample data.

## Rendering Flow

Static page rendering remains unchanged.

Template rendering adds a data context:

```ts
interface TemplateRenderDataContext {
  currentEntry: {
    title: string
    slug: string
    url: string
    bodyMarkdown: string
    seoTitle: string
    seoDescription: string
    featuredMedia: null | {
      url: string
      alt: string
      mimeType: string
    }
  }
}
```

Node rendering order:

1. Resolve static props and breakpoint overrides.
2. Resolve `dynamicBindings` against the data context.
3. Apply dynamic values over static props.
4. Escape/sanitize through the existing publisher safety boundary.
5. Call the pure module `render()` function.

Module render functions must remain unaware of the database and CMS route resolution.

## Body Content

The first implementation uses a dedicated content/rich-text module for entry body output. The template controls surrounding layout; the content editor owns the article body.

`currentEntry.bodyMarkdown` renders through a shared safe Markdown/content renderer. The resolved module prop is treated as sanitized rich HTML, not as arbitrary unsanitized user HTML.

Exploding content body blocks into individual canvas modules is a later feature. The data model does not depend on that first.

## Persistence and API

Site persistence must validate and preserve:

- `page.template`
- `node.dynamicBindings`

Content collection persistence must add:

- `route_base`, defaulting to `/${collection.slug}`

API work:

- Add/update collection route settings.
- Include `routeBase` in collection responses.
- Add server helpers to resolve collection routes, entries, and matching templates.
- Update public routing so `/routeBase/:slug` can render through a selected template.

## Implementation Phases

### Phase 1: Data Model and Persistence

- Add `page.template`.
- Add `node.dynamicBindings`.
- Add `content_collections.route_base`.
- Validate through `validateSite`.
- Persist through CMS site save/load and content collection APIs.
- Add route/template matching helpers.

### Phase 2: Template Management UI

- Add `Templates` section in the Site explorer.
- Add template settings dialog.
- Add page-to-template conversion.
- Add template-to-page conversion that drops all bindings after confirmation.
- Add template toolbar context and preview entry selection.

### Phase 3: Binding Picker

- Add binding-aware wrappers for compatible property controls.
- Add searchable `Current post` binding dropdown.
- Store/remove bindings on `PageNode.dynamicBindings`.
- Show bound fields with striped read-only control and remove action.

### Phase 4: Template Rendering

- Resolve `/posts/:slug` through collection route base.
- Select highest-priority matching template.
- Resolve dynamic props at render time.
- Add content/rich-text body module.
- Use preview entry or sample data in editor preview.

## Testing

Data and persistence tests:

- Template metadata survives save/load.
- Dynamic bindings survive validation and persistence.
- Route base defaults from collection slug.
- Template selection sorts by priority and uses page order as tie-breaker.

Editor tests:

- Converting a page to a template moves it to the Templates section.
- Converting a template back to a page removes template metadata and all node bindings.
- Template settings can set collection, priority, and preview entry.
- Binding picker appears on compatible fields only.
- Selecting `Current post · Title` binds `Text.text`.
- Removing a binding restores the editable static field.

Rendering tests:

- `/posts/my-post` renders through the matching template.
- Dynamic title/body/media values override static props.
- Static page rendering remains unchanged.
- Unsafe dynamic values are escaped or sanitized.
- Missing published entry or missing matching template returns the existing public 404 behavior.

## Out of Scope for MVP

- Archive/list templates.
- Taxonomy templates.
- Condition editor UI.
- Related entries, author sources, global settings sources.
- Auto-binding suggestions.
- Materializing bindings into static values when converting template to page.
- Exploding body Markdown blocks into individual canvas modules.
