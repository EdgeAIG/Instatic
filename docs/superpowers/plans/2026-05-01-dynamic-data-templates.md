# Dynamic Data Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add page-based CMS templates with prop-level dynamic bindings so published content entries can render through page-builder layouts.

**Architecture:** A template is a normal `Page` with `page.template` metadata. Dynamic data is stored on `PageNode.dynamicBindings[propKey]` and resolved over static props at editor preview/public render time. Collections own `routeBase`; matching templates are selected by context, collection, conditions, priority, and page order.

**Tech Stack:** Bun tests, React, Zustand, TypeScript, Postgres migrations, existing CMS server handlers, existing page publisher/module registry.

---

## File Structure

- Modify `src/core/page-tree/types.ts`: add `PageTemplateConfig`, `TemplateCondition`, `DynamicPropBinding`, `PageNode.dynamicBindings`, `Page.template`.
- Modify `src/core/persistence/validate.ts`: validate and preserve `template` and `dynamicBindings`.
- Modify `src/core/editor-store/slices/siteSlice.ts`: add template conversion and binding mutations.
- Modify `src/editor/components/SiteExplorerPanel/SiteExplorerPanel.tsx`: split static pages/templates and expose conversion/settings actions.
- Create `src/editor/components/TemplateSettingsDialog/TemplateSettingsDialog.tsx`: edit template name, collection, priority, preview entry.
- Create `src/core/templates/`: matching, binding resolution, sample data helpers.
- Modify `src/core/publisher/render.ts`: accept optional template data context and resolve dynamic props before escaping.
- Modify `server/cms/contentRepository.ts`, `server/cms/migrations.ts`, `src/content/types.ts`, `src/core/persistence/cmsContent.ts`: add `routeBase`.
- Modify `server/cms/publicRenderer.ts`, `server/cms/handlers.ts`: route `/routeBase/:slug` through matching template.
- Create content/body module under `src/modules/base/content/`: render sanitized CMS body HTML.
- Modify property controls around `src/editor/components/PropertyControls/`: binding dropdown and bound field display for compatible controls.

## Task 1: Model, Validation, and Store Mutations

**Files:**
- Modify: `src/core/page-tree/types.ts`
- Modify: `src/core/persistence/validate.ts`
- Modify: `src/core/editor-store/slices/siteSlice.ts`
- Test: `src/__tests__/templates/templateModel.test.ts`

- [x] **Step 1: Write failing tests**

Create `src/__tests__/templates/templateModel.test.ts` with tests that:

```ts
import { describe, expect, it } from 'bun:test'
import { makeSite } from '../fixtures'
import { validateSite } from '../../core/persistence/validate'
import { useEditorStore } from '../../core/editor-store/store'

describe('dynamic template model', () => {
  it('validates and preserves page template metadata and node dynamic bindings', () => {
    const site = makeSite()
    const page = site.pages[0]
    const root = page.nodes[page.rootNodeId]
    page.template = {
      enabled: true,
      context: 'entry',
      collectionId: 'posts',
      priority: 100,
      conditions: [],
    }
    root.dynamicBindings = {
      text: { source: 'currentEntry', field: 'title', format: 'plain', fallback: 'static' },
    }

    const validated = validateSite(site)

    expect(validated.pages[0].template).toEqual(page.template)
    expect(validated.pages[0].nodes[page.rootNodeId].dynamicBindings?.text).toEqual({
      source: 'currentEntry',
      field: 'title',
      format: 'plain',
      fallback: 'static',
    })
  })

  it('converts a template back to a page by removing template metadata and all bindings', () => {
    const site = makeSite()
    const page = site.pages[0]
    const root = page.nodes[page.rootNodeId]
    page.template = { enabled: true, context: 'entry', collectionId: 'posts', priority: 100, conditions: [] }
    root.dynamicBindings = {
      text: { source: 'currentEntry', field: 'title' },
    }

    useEditorStore.setState({ site, activePageId: page.id, hasUnsavedChanges: false })
    useEditorStore.getState().convertTemplateToPage(page.id)

    const nextPage = useEditorStore.getState().site?.pages[0]
    expect(nextPage?.template).toBeUndefined()
    expect(nextPage?.nodes[page.rootNodeId].dynamicBindings).toBeUndefined()
    expect(useEditorStore.getState().hasUnsavedChanges).toBe(true)
  })

  it('sets and removes a node dynamic binding without changing the static prop fallback', () => {
    const site = makeSite()
    const page = site.pages[0]
    const root = page.nodes[page.rootNodeId]
    root.props = { text: 'Static fallback' }

    useEditorStore.setState({ site, activePageId: page.id, hasUnsavedChanges: false })
    useEditorStore.getState().setNodeDynamicBinding(root.id, 'text', {
      source: 'currentEntry',
      field: 'title',
    })
    expect(useEditorStore.getState().site?.pages[0].nodes[root.id].props.text).toBe('Static fallback')
    expect(useEditorStore.getState().site?.pages[0].nodes[root.id].dynamicBindings?.text?.field).toBe('title')

    useEditorStore.getState().clearNodeDynamicBinding(root.id, 'text')
    expect(useEditorStore.getState().site?.pages[0].nodes[root.id].props.text).toBe('Static fallback')
    expect(useEditorStore.getState().site?.pages[0].nodes[root.id].dynamicBindings).toBeUndefined()
  })
})
```

- [x] **Step 2: Run red test**

Run:

```bash
bun test src/__tests__/templates/templateModel.test.ts
```

Expected: fail because `Page.template`, `PageNode.dynamicBindings`, and store methods are missing.

- [x] **Step 3: Implement types, validator, and store methods**

Add the model types, preserve validated structures, and add store methods:

```ts
convertPageToTemplate(pageId, config)
convertTemplateToPage(pageId)
setNodeDynamicBinding(nodeId, propKey, binding)
clearNodeDynamicBinding(nodeId, propKey)
```

`convertTemplateToPage` must recursively remove `dynamicBindings` from all page nodes.

- [x] **Step 4: Verify green**

Run:

```bash
bun test src/__tests__/templates/templateModel.test.ts
```

Expected: pass.

## Task 2: Collection Route Base and Template Matching

**Files:**
- Modify: `server/cms/migrations.ts`
- Modify: `server/cms/contentRepository.ts`
- Modify: `src/content/types.ts`
- Modify: `src/core/persistence/cmsContent.ts`
- Create: `src/core/templates/templateMatching.ts`
- Test: `src/__tests__/templates/templateMatching.test.ts`
- Test: `src/__tests__/persistence/cmsContentClient.test.ts`

- [x] **Step 1: Write failing tests**

Add tests proving:

```ts
expect(normalizeRouteBase('posts')).toBe('/posts')
expect(normalizeRouteBase('/blog/')).toBe('/blog')
expect(selectEntryTemplate(site, 'posts')?.id).toBe('high-priority-page')
```

Also update CMS content client tests to expect `routeBase` on collections and a `PATCH /content/collections/:id` route settings call.

- [x] **Step 2: Run red tests**

Run:

```bash
bun test src/__tests__/templates/templateMatching.test.ts src/__tests__/persistence/cmsContentClient.test.ts
```

Expected: fail because helpers and routeBase API are missing.

- [x] **Step 3: Implement matching and route base persistence**

Create helpers:

```ts
export function normalizeRouteBase(value: string): string
export function selectEntryTemplate(site: SiteDocument, collectionId: string): Page | null
```

Add `route_base text not null default ''` migration, map empty DB values to `/${slug}`, and expose `updateCmsContentCollection`.

- [x] **Step 4: Verify green**

Run:

```bash
bun test src/__tests__/templates/templateMatching.test.ts src/__tests__/persistence/cmsContentClient.test.ts
```

Expected: pass.

## Task 3: Dynamic Prop Resolution and Body Module

**Files:**
- Create: `src/core/templates/dynamicBindings.ts`
- Modify: `src/core/publisher/render.ts`
- Create: `src/modules/base/content/index.tsx`
- Modify: `src/modules/base/index.ts`
- Test: `src/__tests__/templates/dynamicRender.test.ts`

- [x] **Step 1: Write failing tests**

Test that `resolveDynamicProps` overlays `currentEntry.title` on a static `Text.text` prop, leaves fallback when missing, resolves featured media URLs, and that `publishPage(..., context)` renders dynamic values while static pages still render unchanged.

- [x] **Step 2: Run red tests**

Run:

```bash
bun test src/__tests__/templates/dynamicRender.test.ts
```

Expected: fail because dynamic render context does not exist.

- [x] **Step 3: Implement resolver and content module**

Add a pure resolver that runs before `escapeProps`. Add `base.content` with a rich HTML prop that receives sanitized content body HTML.

- [x] **Step 4: Verify green**

Run:

```bash
bun test src/__tests__/templates/dynamicRender.test.ts
```

Expected: pass.

## Task 4: Public Template Routes

**Files:**
- Modify: `server/cms/publicRenderer.ts`
- Modify: `server/cms/handlers.ts`
- Modify: `server/cms/contentRepository.ts`
- Test: `src/__tests__/server/cmsTemplateRoutes.test.ts`

- [x] **Step 1: Write failing server tests**

Test that a request for `/posts/my-post` loads collection by `routeBase`, loads published entry by slug, selects the highest-priority page template, and renders dynamic `currentEntry.title`.

- [x] **Step 2: Run red tests**

Run:

```bash
bun test src/__tests__/server/cmsTemplateRoutes.test.ts
```

Expected: fail because public template routing is absent.

- [x] **Step 3: Implement route rendering**

Add a public render function that builds `TemplateRenderDataContext`, calls `publishPage(template, site, registry, undefined, context)`, and returns 404 when collection, entry, or template is missing.

- [x] **Step 4: Verify green**

Run:

```bash
bun test src/__tests__/server/cmsTemplateRoutes.test.ts
```

Expected: pass.

## Task 5: Template Explorer and Settings UI

**Files:**
- Modify: `src/editor/components/SiteExplorerPanel/SiteExplorerPanel.tsx`
- Create: `src/editor/components/TemplateSettingsDialog/TemplateSettingsDialog.tsx`
- Create: `src/editor/components/TemplateSettingsDialog/TemplateSettingsDialog.module.css`
- Test: `src/__tests__/site-explorer/siteExplorerTemplates.test.tsx`

- [x] **Step 1: Write failing UI tests**

Test that static pages and templates appear in separate sections, converting a page creates `page.template`, and converting back removes bindings after confirmation.

- [x] **Step 2: Run red tests**

Run:

```bash
bun test src/__tests__/site-explorer/siteExplorerTemplates.test.tsx
```

Expected: fail because the Templates section and conversion actions are missing.

- [x] **Step 3: Implement template section and settings dialog**

Reuse existing explorer row/dialog patterns. Keep template settings minimal: name, collection, priority, preview entry.

- [x] **Step 4: Verify green**

Run:

```bash
bun test src/__tests__/site-explorer/siteExplorerTemplates.test.tsx
```

Expected: pass.

## Task 6: Binding Picker in Properties

**Files:**
- Create: `src/editor/components/PropertyControls/DynamicBindingControl.tsx`
- Modify: `src/editor/components/PropertyControls/PropertyControlRenderer.tsx`
- Modify: `src/editor/components/PropertiesPanel/PropertiesPanel.tsx`
- Modify: `src/editor/components/PropertyControls/controls.module.css`
- Test: `src/__tests__/property-controls/dynamicBindingControl.test.tsx`

- [x] **Step 1: Write failing UI tests**

Test that compatible fields in template context open a searchable `Current post` binding dropdown, selecting `Title` writes `dynamicBindings.text`, and the bound state shows a striped read-only control with an `x` remove action.

- [x] **Step 2: Run red tests**

Run:

```bash
bun test src/__tests__/property-controls/dynamicBindingControl.test.tsx
```

Expected: fail because binding controls do not exist.

- [x] **Step 3: Implement binding-aware property wrapper**

Pass binding context from `PropertiesPanel` into `PropertyControlRenderer`. Wrap compatible controls only when the active page has `template.context === 'entry'`.

- [x] **Step 4: Verify green**

Run:

```bash
bun test src/__tests__/property-controls/dynamicBindingControl.test.tsx
```

Expected: pass.

## Final Verification

- [x] Run focused template tests:

```bash
bun test src/__tests__/templates src/__tests__/site-explorer/siteExplorerTemplates.test.tsx src/__tests__/property-controls/dynamicBindingControl.test.tsx
```

- [x] Run existing related tests:

```bash
bun test src/__tests__/content src/__tests__/persistence/cmsContentClient.test.ts src/__tests__/publisher/render.test.ts
```

- [x] Run lint and build:

```bash
bun run lint
bun run build
```

- [x] Run full suite and report any unrelated pre-existing blocker:

```bash
bun test
```
