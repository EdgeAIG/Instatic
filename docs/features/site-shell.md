# Site Shell

The site shell — the top-level persisted site config. Everything that's "the site" but **not** a page or a Visual Component lives here: name, breakpoints, settings (colors, typography, spacing), class registry, files, dependencies, and runtime config.

The shell is stored in a single `site` row. Pages and VCs live separately in `data_rows`. The adapter assembles a full `SiteDocument` (shell + pages + VCs) on load.

---

## TL;DR

- One row in the `site` table. Loaded as `SiteShell`; assembled at the client into `SiteDocument` (= `SiteShell & { pages, visualComponents }`).
- Source-of-truth schema: `src/core/page-tree/siteDocument.ts` → `SiteShellSchema`.
- Sub-schemas:
  - `Breakpoint[]` — viewport sizes the editor renders
  - `SiteSettings` — color tokens, typography, spacing scale, framework tokens
  - `Record<string, CSSClass>` — the class registry (user-defined CSS classes)
  - `SiteFile[]` — arbitrary text/CSS/JS files attached to the site
  - `SitePackageJson` — `package.json` for the per-site `bun install` workspace
  - `SiteRuntimeConfig` — dependency lock + scripts
- Pages and VCs are **not** embedded. The architecture gate `no-vc-in-site-shell.test.ts` enforces this.
- Tolerant parse: missing identity fields throw; missing settings / files / classes / runtime fall back to defaults.

---

## The shape

`src/core/page-tree/siteDocument.ts`:

```ts
export type SiteShell = {
  id:           string
  name:         string
  breakpoints:  Breakpoint[]
  settings:     SiteSettings
  classes:      Record<string, CSSClass>
  files:        SiteFile[]
  packageJson:  SitePackageJson
  runtime:      SiteRuntimeConfig
  createdAt:    number
  updatedAt:    number
}

export type SiteDocument = SiteShell & {
  pages:             Page[]
  visualComponents:  VisualComponent[]
}
```

`SiteDocument` is the **in-memory** view the editor and publisher work with. The DB persists three things separately:

| Persisted shape    | DB location                                                    |
|--------------------|----------------------------------------------------------------|
| `SiteShell`        | `site` row, `settings_json` column                             |
| `Page[]`           | `data_rows` rows where `table_id = 'pages'`                    |
| `VisualComponent[]`| `data_rows` rows where `table_id = 'components'`               |

The site shell schema **does not** include pages or VCs — gated by `no-vc-in-site-shell.test.ts`.

---

## Sub-shapes

### `Breakpoint`

`src/core/page-tree/breakpoint.ts`:

```ts
type Breakpoint = {
  id:       string     // 'mobile' | 'tablet' | 'desktop' | custom
  label:    string
  minWidth: number     // px
  maxWidth: number | null
}
```

The default set (`DEFAULT_BREAKPOINTS`):

| id        | label   | minWidth | maxWidth |
|-----------|---------|----------|----------|
| `mobile`  | Mobile  | 0        | 767      |
| `tablet`  | Tablet  | 768      | 1023     |
| `desktop` | Desktop | 1024     | null     |

Breakpoints power three things:

- The canvas's per-breakpoint iframes (the user sees their page rendered at each breakpoint width).
- The `breakpointOverrides` on each `PageNode` (per-breakpoint prop overrides).
- The publisher's framework CSS (`@media (min-width: ...)` queries derived from breakpoints).

Breakpoints can be added / removed / reordered through the Settings → Breakpoints panel. Adding a breakpoint creates a new column in the editor's per-breakpoint canvas grid.

### `SiteSettings`

`src/core/page-tree/siteSettings.ts`. The site-level design tokens emitted into published CSS:

```ts
type SiteSettings = {
  colorTokens:        Record<string, string>     // 'primary' → '#ff7700', 'surface' → '#fff', etc.
  typographyTokens:   { fontFamily: ..., baseSize: ..., scale: ..., headingScale: ... }
  spacingScale:       number[]                   // [0, 4, 8, 16, 24, 32, ...]
  framework:          FrameworkConfig            // generated utility classes (spacing utilities)
  containerWidth:     number                     // max-width for the publisher's `--container-width`
  // ... more
}
```

The `--container-width`, color, typography, and spacing values are emitted into the **framework CSS** by `buildSiteFrameworkCss(site)` in `src/core/publisher/frameworkCss.ts`.

Editing the colors / typography / spacing in the Site → Framework / Colors / Typography panels writes back to `settings_json` and republishes the affected pages.

### Class registry — `Record<string, CSSClass>`

User-defined CSS classes the editor manages.

```ts
type CSSClass = {
  id:           string
  name:         string             // user-facing class name applied to elements
  description?: string
  scope?:       { nodeId: string } // optional: a scope-anchored class (one node only)
  styles:       CSSPropertyBag     // per-breakpoint property map
  metadata?:    { ... }
}
```

See [docs/reference/css-class-registry.md](../reference/css-class-registry.md) for the full mechanics. Key points:

- A class compiled to CSS via `classCss.ts` in the publisher.
- A node references a class via its `classIds: string[]`.
- Scoped classes (`scope.nodeId`) generate uniquely-prefixed CSS so they don't affect other nodes.

### Site files — `SiteFile[]`

Arbitrary text files attached to the site: extra CSS stylesheets, JS snippets, JSON config, etc.

```ts
type SiteFile = {
  id:        string
  type:      SiteFileType    // 'css' | 'js' | 'json' | 'text' | …
  name:      string
  content:   string
  metadata?: { ... }
}
```

- `'css'` files are concatenated into the page-scoped `userStyles` bundle via `userStylesheets.ts`, honouring each stylesheet's `SiteRuntimeConfig.styles[id]` (enable / scope / priority).
- `'js'` files are exposed to module render functions through `props._siteScripts`.
- Other types are stored but not auto-emitted; modules can read them via `ctx.siteFiles`.

Files are edited through the Site → Files panel (CodeMirror-backed).

### `SitePackageJson` — the per-site `package.json`

```ts
type SitePackageJson = {
  dependencies:    Record<string, string>
  devDependencies: Record<string, string>
}
```

The CMS supports plugins that ship their own npm deps and runtime imports (e.g. `three`). When a site declares a dependency, `bun install` runs against a per-site workspace under `uploads/sites/<siteId>/runtime/`, producing a hashed cache directory the server serves at `/_pb/runtime/cache/<hash>/...`. See [docs/features/site-runtime.md](#) (TODO).

The Site → Dependencies panel edits this `package.json`. Saving triggers a `bun install` and updates the runtime lock.

### `SiteRuntimeConfig`

```ts
type SiteAssetScope =
  | { type: 'all-pages' }
  | { type: 'pages'; pageIds: string[] }
  | { type: 'templates'; templatePageIds: string[] }

type SiteRuntimeConfig = {
  dependencyLock: {
    version:   1
    packages:  Record<string, { resolved: string; integrity?: string }>
    updatedAt: number
  }
  // Per-script targeting + load behaviour, keyed by SiteFile id.
  scripts: Record<string, {
    enabled: boolean
    runInCanvas: boolean
    placement: 'head' | 'body-end'
    timing: 'immediate' | 'dom-ready' | 'idle'
    scope: SiteAssetScope
    priority: number
  }>
  // Per-stylesheet targeting + cascade, keyed by SiteFile id.
  styles: Record<string, {
    enabled: boolean
    scope: SiteAssetScope
    priority: number
  }>
}
```

`dependencyLock` is the resolved snapshot from the last successful `bun install` — the publisher uses it to build the `<script type="importmap">` entries that map bare specifiers (`three`) to `/_pb/runtime/cache/<hash>/...` URLs.

`scripts` and `styles` share the `SiteAssetScope` shape and the `assetScopeAppliesToPage` helper, so a script and a stylesheet target pages identically. Scripts additionally carry `placement`/`timing`/`runInCanvas` (a `<link>` has no execution model, so stylesheets omit those). Both are edited from the floating code editor's left rail (`ScriptSettingsPane` / `StyleSettingsPane`).

---

## Loading the site

```text
GET /admin/api/cms/site
    │
    ▼
server/handlers/cms/site.ts
    │
    ├─→ loadDraftSite(db)              ← server/repositories/site.ts
    │       (reads the site row, validates settings_json via parseSiteDocument)
    ├─→ listDataRows(db, 'pages')      ← page rows
    ├─→ listDataRows(db, 'components') ← VC rows
    │
    ▼
Client: assembleSiteDocument(shell, pages, vcs) → SiteDocument
    │
    ▼
Editor store: siteSlice initial state
```

The shell's `parseSiteDocument(raw)` is **tolerant in the right places**:

| Field         | Behavior on invalid input                        |
|---------------|--------------------------------------------------|
| `id`          | Throw (required identity)                        |
| `name`        | Throw                                            |
| `breakpoints` | Throw (default would silently destroy customization) |
| `createdAt`, `updatedAt` | Throw                                  |
| `settings`    | Fall back to `DEFAULT_SITE_SETTINGS`             |
| `classes`     | Per-entry: drop entries missing `id` or `name`   |
| `files`       | Per-entry: drop invalid entries                  |
| `packageJson` | Fall back to `{ dependencies: {}, devDependencies: {} }` |
| `runtime`     | Fall back to empty lock + scripts                |

Hard fallbacks let the editor render a partially-corrupt site instead of hard-failing; identity-field throws prevent the editor from rendering against the wrong site.

---

## Saving the site

The shell is saved independently of pages / VCs. Three save paths:

| Endpoint                                    | Saves                                          |
|---------------------------------------------|------------------------------------------------|
| `PUT /admin/api/cms/site`                   | The shell — settings, breakpoints, classes, files |
| `PUT /admin/api/cms/pages`                  | Page roster (batch upsert)                     |
| `PUT /admin/api/cms/components`             | VC roster (batch upsert)                       |

The editor's auto-save scheduler (`usePersistence.ts`) batches dirty changes and fires the matching save endpoint. Granular write gates (`SITE_WRITE_CAPABILITIES`) enforce what each role can actually change inside the diff.

### Atomic diff validation

The shell save handler validates the diff before applying — e.g. a user with only `site.content.edit` can't change a class definition (style-edit) or rename a breakpoint (structure-edit). The diff validator is in `src/core/persistence/validate.ts` → `validateSite`.

---

## In-memory ↔ persisted

The editor's store works with the in-memory `SiteDocument`:

```ts
{
  ...siteShell,             // id, name, breakpoints, settings, classes, files, runtime, packageJson
  pages:             Page[],
  visualComponents:  VisualComponent[],
}
```

When the editor saves, the persistence layer **splits** the in-memory document back into:

- A `SiteShell` (everything except `pages` and `visualComponents`) → `PUT /site`
- A `Page[]` → `PUT /pages`
- A `VisualComponent[]` → `PUT /components`

The split prevents an "all-or-nothing" save: editing the page roster doesn't risk overwriting a concurrent settings change.

---

## Cookbook

### Read site settings from a panel

```ts
import { useEditorStore } from '@site/store/store'

const settings = useEditorStore((s) => s.site.settings)
const colors   = settings.colorTokens
```

### Add a new breakpoint

The editor's Breakpoints panel calls a `siteSlice` action:

```ts
addBreakpoint({ id: 'wide', label: 'Wide', minWidth: 1440, maxWidth: null })
```

The panel rail's per-breakpoint canvas iframe shows up automatically. Existing nodes can target the new breakpoint via `setBreakpointOverride(nodeId, 'wide', propKey, value)`.

### Add a color token

Settings → Colors panel adds an entry to `settings.colorTokens`. Saving updates the framework CSS (`buildSiteFrameworkCss(site)`) and republishes affected pages.

### Add a site file

Settings → Files panel calls `filesSlice.addFile({ type: 'css', name: 'analytics.css', content: '...' })`. CSS files are auto-concatenated into the published bundle; other types are stored and accessible via `ctx.siteFiles` at render time.

### Declare a site dependency

Site → Dependencies panel edits `packageJson.dependencies`:

```jsonc
{
  "dependencies": { "three": "^0.171.0" }
}
```

Save → server runs `bun install` in the per-site workspace → `runtime.dependencyLock` updates → the publisher emits a `<script type="importmap">` mapping `three` to `/_pb/runtime/cache/<hash>/three/build/three.module.js`.

A plugin canvas module can then `import * as THREE from 'three'` and it resolves at runtime.

---

## Forbidden patterns

| Pattern                                                              | Use instead                                                 |
|----------------------------------------------------------------------|-------------------------------------------------------------|
| Adding `pages: ...` or `visualComponents: ...` to `SiteShellSchema`  | They're stored separately. Gated by `no-vc-in-site-shell.test.ts`. |
| Reading `site.settings.colorTokens.primary as string` without fallback | `parseSiteSettings` already applies defaults; the type is `string`. Don't add `as string`. |
| Persisting the in-memory `SiteDocument` directly as JSON              | Split into shell / pages / VCs before save                  |
| Hard-failing the entire editor on a corrupt `settings_json`           | The parser falls back; the editor renders with defaults     |
| Hardcoding the breakpoint list                                       | Read from `site.breakpoints` — users can add custom ones    |
| Writing CSS for a user class manually                                | Add a `CSSClass` to the registry; the publisher compiles it |
| Editing `runtime.dependencyLock` by hand                             | It's the output of `bun install` — let the install handler write it |

---

## Related

- [docs/architecture.md](../architecture.md) — system overview
- [docs/editor.md](../editor.md) — editor store consumes `SiteDocument`
- [docs/features/publisher.md](publisher.md) — framework CSS + class CSS pipelines
- [docs/features/content-storage.md](content-storage.md) — pages and VCs live in `data_rows`
- [docs/reference/css-class-registry.md](../reference/css-class-registry.md) — class registry details
- [docs/reference/design-tokens.md](../reference/design-tokens.md) — editor token catalog
- Source-of-truth files:
  - `src/core/page-tree/siteDocument.ts` — `SiteShellSchema`, `SiteDocument`, `parseSiteDocument`
  - `src/core/page-tree/siteSettings.ts` — `SiteSettingsSchema`, `DEFAULT_SITE_SETTINGS`
  - `src/core/page-tree/breakpoint.ts` — `BreakpointSchema`, `DEFAULT_BREAKPOINTS`
  - `src/core/page-tree/cssClass.ts` — `CSSClassSchema`
  - `src/core/files/schemas.ts` — `SiteFileSchema`, `SiteFileType`
  - `src/core/site-dependencies/manifest.ts` — `SitePackageJsonSchema`
  - `src/core/site-runtime/schemas.ts` — `SiteRuntimeConfigSchema`
  - `src/core/persistence/validate.ts` — `validateSite`
  - `server/repositories/site.ts` — `loadDraftSite`, save handlers
  - `server/handlers/cms/site.ts` — `/admin/api/cms/site` endpoint
- Gate tests:
  - `src/__tests__/architecture/no-vc-in-site-shell.test.ts`
