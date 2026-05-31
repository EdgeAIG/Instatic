# Editor

Deep dive on the admin app and the visual page builder — how the SPA boots, how routing works, how the editor store mutates pages, how the canvas renders.

The frontend is a single React 19 + Vite SPA mounted at `/admin`. Inside it, two concerns coexist: the **admin shell** (auth, navigation, workspaces, plugin host UI) and the **visual editor** (`src/admin/pages/site/`). They share auth, routing, theming, and the spotlight palette; they differ in everything else — the editor owns a heavy Zustand store and a custom rendering pipeline.

---

## TL;DR

- **Entry:** `src/admin/main.tsx` mounts `<Router><AdminRoutes /></Router>` with React 19 root-level error callbacks. `flushSync` forces the initial render synchronous to cut LCP.
- **Router:** `src/admin/lib/routing/` — in-house router replacing `react-router-dom`. 9 routes, all wrapped in a per-route `<ErrorBoundary>` and `<Suspense>`.
- **Cold path:** entry chunk is tiny (~96 KB gz). `AuthenticatedAdmin` is `React.lazy` and only loads post-login; it pre-warms all 9 workspace chunks at module evaluation.
- **Workspaces:** `dashboard`, `site` (the editor), `content`, `data`, `media`, `plugins`, `users`, `account`, `pluginPage`. Capability-gated by `canAccessWorkspace`.
- **Editor store** lives at `src/admin/pages/site/store/`. Zustand + Immer + `subscribeWithSelector`. 11 slices, one source of truth for the page tree.
- **Active tree routing:** `mutateActiveTree(fn)` in `siteSlice` is the **only** place that branches on page-mode vs. VC-mode. The 11 named mutation actions are one-liners that delegate to it.
- **Canvas:** `src/admin/pages/site/canvas/` renders the page tree into per-breakpoint iframes (`ModuleSandboxFrame`). Selection / hover ring colors come from `--canvas-selection-ring` / `--canvas-hover-ring`.
- **Spotlight:** Cmd+K palette at `src/admin/spotlight/`. Always available across workspaces. Owns its own command registry, providers, and scopes.

---

## Process — what loads when

```text
GET /admin/site
    │
    ▼
dist/index.html  (one HTML file for the whole SPA)
    │
    ▼  loads ~96 KB gz of entry chunk
    │
src/admin/main.tsx
    │
    ├─→ <Router>            ← in-house router (src/admin/lib/routing/)
    │
    ├─→ <AdminRoutes>       ← src/admin/router.tsx
    │     │
    │     └─→ <AdminEntry section="site"> (eager-imported)
    │             │
    │             │  AdminEntry calls useAdminBoot() — probes the session.
    │             │  Phase = 'login' → renders <LoginPage>.
    │             │  Phase = 'editor' → React.lazy-loads <AuthenticatedAdmin>.
    │             │
    │             └─→ <AuthenticatedAdmin>  (post-login chunk, ~heavy)
    │                     │
    │                     ├─→ installPluginRuntime()       ← populate globalThis.__pagebuilder
    │                     ├─→ pre-warm imports for all 9 workspace pages
    │                     │
    │                     └─→ <AdminSessionProvider>
    │                            └─→ <StepUpProvider>
    │                                   └─→ <SpotlightRoot>
    │                                          └─→ <Suspense fallback=<AppLoadingScreen>>
    │                                                 └─→ <SitePage>  ← the visual editor
    │
    ▼
SitePage mounts and the editor is ready.
```

Why the split:

- **`main.tsx`** is the only module pre-login can compile. Keep it minimal.
- **`AdminEntry`** is eager-imported but small (~10 KB gz). Owns the boot probe and gate.
- **`AuthenticatedAdmin`** is `React.lazy` so the login screen doesn't pay for SpotlightRoot, the editor store, or any workspace page chunk.
- **Workspace pages** are individually `React.lazy` — pre-warmed in parallel once `AuthenticatedAdmin` loads, so navigation between workspaces never flashes a Suspense fallback.

`installPluginRuntime()` lives inside `AuthenticatedAdmin`'s chunk so plugin code never runs before login.

---

## Routing

`src/admin/lib/routing/` contains the in-house router (`Router`, `Routes`, `Route`, `Navigate`, `Link`, `useLocation`, `useNavigate`, `useParams`). Replaces `react-router-dom` for the 9-route admin app.

**Admin-only.** Banned in `src/admin/pages/site/`, `src/core/`, and `src/modules/` — gated by `no-router-in-site-page.test.ts`. The editor doesn't have its own router; everything inside the editor is workspace-local.

The route table (`src/admin/router.tsx`):

| Path                                    | Component shorthand               |
|-----------------------------------------|-----------------------------------|
| `/` → redirect to `/admin/dashboard`    | `<Navigate />`                    |
| `/admin` → redirect to `/admin/dashboard` | `<Navigate />`                  |
| `/admin/dashboard`                      | `<AdminEntry section="dashboard" />` |
| `/admin/site`                           | `<AdminEntry section="site" />` (the editor) |
| `/admin/content`                        | `<AdminEntry section="content" />` |
| `/admin/data`                           | `<AdminEntry section="data" />`  |
| `/admin/media`                          | `<AdminEntry section="media" />` |
| `/admin/plugins`                        | `<AdminEntry section="plugins" />` |
| `/admin/users`                          | `<AdminEntry section="users" />` |
| `/admin/account`                        | `<AdminEntry section="account" />` |
| `/admin/plugins/:pluginId/:pageId`      | `<AdminEntry section="pluginPage" />` |

Every route is wrapped with `withRouteBoundary(...)` → `<ErrorBoundary location="admin-route" resetKeys={[pathname]}>` and `<Suspense fallback={<AppLoadingScreen />}>`. The error boundary resets when the pathname changes so a broken route never strands the user.

---

## URL state and workspace deep links

`src/admin/lib/urlState/` provides two hooks that make workspace selections directly bookmarkable and shareable via the query string, without touching the router:

```ts
import { useInitialQueryParams, useUrlQuerySync } from '@admin/lib/urlState'
```

### Why a separate module

The visual editor (`src/admin/pages/site/`) is forbidden from importing the admin router (gated by `no-router-in-site-page.test.ts`). Yet the editor still needs the address bar to reflect the open page so bookmarks and shared links work. `urlState` solves this by operating on `window.history.replaceState` directly — no `pb:locationchange` event, no route re-match, just a query-string update that keeps the pathname stable.

### `useInitialQueryParams()`

Captures the `URLSearchParams` present at first mount using a `useState` lazy initializer (runs exactly once). Subsequent `useUrlQuerySync` writes never change what the one-shot deep-link read observes.

```ts
const initialParams = useInitialQueryParams()
const pageSlug = initialParams.get('page')  // read once on load
```

### `useUrlQuerySync(params, options?)`

Mirrors a key→value map into the URL via `replaceState` on every render where the values change.

- A non-empty string value sets the param (`?key=value`).
- `null` or empty removes the param.
- Keys NOT in `params` are left untouched — workspaces own only their own params.
- `replaceState` (never `pushState`) so navigating between rows/pages doesn't flood the browser back stack.
- The `enabled` option (default `true`) lets callers gate the sync on a load-complete flag so an in-progress deep link isn't overwritten before the selection settles.

```ts
useUrlQuerySync(
  { table: selectedTable?.slug ?? null, row: selectedRowId },
  { enabled: !loadingTables },
)
```

### URL contract per workspace

| Workspace | URL form | Notes |
|-----------|----------|-------|
| **Site editor** | `/admin/site` | Home page (slug `index`); bare URL is canonical — no `?page=` written |
| **Site editor** | `/admin/site?page=<slug>` | Opens the page with that slug |
| **Site editor** | `/admin/site?table=pages&row=<rowId>` | Cross-workspace deep link from Data workspace; normalized to `?page=<slug>` after consume |
| **Site editor** | `/admin/site?table=components&row=<rowId>` | Opens the Visual Component with that id; normalized after consume |
| **Content** | `/admin/content?table=<collectionSlug>&row=<rowId>` | Opens the collection and entry |
| **Data** | `/admin/data?table=<tableSlug>&row=<rowId>` | Opens the table and row |

### Site editor URL sync — `useSiteEditorUrlSync`

`src/admin/pages/site/hooks/useSiteEditorUrlSync.ts` implements a bidirectional sync for the site editor:

1. **READ (once, after load):** consumes `?page=<slug>` or `?table=…&row=…` from the initial URL and applies the selection to the editor store. Guarded by a ref so it fires at most once per mount.
2. **WRITE (ongoing):** mirrors the active page's slug back into the URL so the address bar stays current. The home page (`slug === 'index'`) is always represented as the bare `/admin/site` — the `?page=` param is omitted.

---

## Auth and access

After login, every route renders `<AuthenticatedAdmin section={...}>`. Before rendering the workspace, it calls `canAccessWorkspace(currentUser, section)`. If the user's capabilities don't include the workspace, it `<Navigate>`s to `firstAccessibleWorkspace(currentUser)` (e.g. a contributor with only `media.manage` lands on `/admin/media`).

`src/admin/access.ts` owns the capability-to-workspace mapping. `src/admin/workspace.ts` owns the `AdminWorkspace` union and the workspace paths.

Sensitive actions (delete user, revoke another device, sign out all devices) require step-up auth — wrapped in `<StepUpProvider>` so the step-up dialog is available from anywhere in the shell.

---

## Admin shell layout

```text
src/admin/
├── main.tsx                    ← React root mount
├── AdminEntry.tsx              ← boot probe + auth gate
├── AuthenticatedAdmin.tsx      ← post-login chunk
├── AppLoadingScreen.tsx        ← shared loading screen
├── router.tsx                  ← admin route table
├── access.ts                   ← workspace gating
├── workspace.ts                ← AdminWorkspace union
├── session.tsx, sessionContext.ts ← AdminSession context
├── pluginRuntimeBootstrap.ts   ← installs globalThis.__pagebuilder
│
├── lib/
│   ├── routing/                ← in-house router
│   ├── urlState/               ← workspace-agnostic URL query-string sync
│   └── useAdminNavigate.ts
│
├── preauth/                    ← login / setup flows
├── shared/                     ← StepUp, dialogs, AdminSectionNavigation, ...
├── state/                      ← cross-page small contexts (adminUi)
├── modals/                     ← workspace-level modals
├── plugin-host-hooks/          ← React hooks plugins call via the SDK
├── plugin-host-ui/             ← Host UI primitives plugins call via the SDK
├── spotlight/                  ← Cmd+K palette
│
└── pages/                      ← workspace implementations
    ├── dashboard/              ← stats, activity, publish lineup
    ├── site/                   ← THE VISUAL EDITOR (see below)
    ├── content/                ← post / page list and editor
    ├── data/                   ← data_tables management
    ├── media/                  ← media manager
    ├── plugins/                ← plugin install / configure
    ├── users/                  ← user management
    ├── account/                ← own-account settings
    └── ...
```

### Cross-page primitives

- **`SpotlightRoot`** — Cmd+K command palette. Owns its own command registry (`spotlight/commands/`), provider runner (`providers/`), scopes, keybindings, recents, telemetry. Available from every workspace.
- **`AdminSectionNavigation`** — top-of-screen workspace switcher.
- **`AccountMenuButton`** — top-right avatar / account menu.
- **`Panel`, `PanelHeader`, `SidebarResizeHandle`** — generic floating-panel chrome reused across the editor, content, and data workspaces.
- **`StepUp`** — re-auth dialog gating sensitive actions.

---

## The visual editor (`src/admin/pages/site/`)

The editor is a self-contained app inside the admin shell. It owns:

- A canvas that renders the page tree into per-breakpoint iframes.
- A heavy Zustand store with 11 slices.
- Left and right sidebars with collapsible panels.
- A toolbar with publish / save / zoom / module picker.
- Property controls bound to selected nodes.

### Folder structure

```text
src/admin/pages/site/
├── SitePage.tsx                ← editor mount point
├── EditorPermissionsProvider.tsx, editorPermissionsContext.ts
│
├── store/                      ← Zustand + Immer store (see below)
│   ├── store.ts                ← root store assembly
│   ├── types.ts                ← EditorStore type union
│   ├── slices/                 ← one file per slice
│   ├── insertLocation.ts       ← drop-target geometry
│   └── clipboard/              ← copy/cut/paste serializers
│
├── canvas/                     ← canvas rendering (see below)
├── sidebars/                   ← LeftSidebar, RightSidebar, PanelRail
├── panels/                     ← per-panel implementations (DomPanel, PropertiesPanel, ...)
├── property-controls/          ← right-panel form controls
├── module-picker/              ← module insert UI
├── code-editor/                ← CodeMirror-backed code panel
├── toolbar/                    ← top toolbar
├── preview/                    ← preview iframe runtime
├── explorer-actions/           ← DOM / Site explorer context menus
├── agent/                      ← AI agent panel
├── hooks/                      ← cross-cutting editor hooks
├── layout/                     ← shell layout
└── ui/                         ← editor-local UI primitives (Tree*, etc.)
```

### Editor store

`src/admin/pages/site/store/` is the central state for the editor. Zustand with the `immer` middleware (mutations are written as direct mutation; Immer produces structural sharing) and `subscribeWithSelector` (granular subscriptions without React context re-renders).

The store is composed of **11 slices**, each created by a factory in `store/slices/`:

| Slice                  | Owns                                                                       |
|------------------------|----------------------------------------------------------------------------|
| `siteSlice`            | `SiteDocument` (pages, nodes, breakpoints, settings, classes, files). The page tree itself. |
| `selectionSlice`       | `selectedNodeId`, `hoveredNodeId`                                          |
| `canvasSlice`          | Zoom, pan, `activeBreakpointId`, `canvasMode`                              |
| `uiSlice`              | Panel visibility, unsaved-changes flag, insert picker                      |
| `classSlice`           | CSS class CRUD + node ↔ class assignment                                   |
| `filesSlice`           | `SiteFile` CRUD                                                            |
| `visualComponentsSlice`| Visual Component CRUD                                                      |
| `settingsSlice`        | Settings modal open/close + active section                                 |
| `agentSlice`           | AI Agent Panel state + streaming                                           |
| `sitePanelSlice`       | Dependency manifest + site runtime settings                                |
| `clipboardSlice`       | Copy / cut / paste of layer subtrees, persisted editor-wide                |

The combined `EditorStore` type lives at `store/types.ts` so each slice can import it without going through `store.ts` (this eliminates the historical store ↔ slice cycles).

**Constraint #182:** The page tree is the single source of truth. No panel may maintain a local copy of node data — they read from the store via selectors.

### `mutateActiveTree` — the only mode-aware function

The store routes mutations to the **active tree** (page in page-mode, VC in VC-mode) through one function in `slices/site/`:

```ts
function mutateActiveTree(fn: (tree: NodeTree<PageNode>) => void): void {
  if (mode === 'page')   fn(activePage)            // Page IS NodeTree<PageNode>
  else                   fn(vc.tree as NodeTree<PageNode>)  // structurally identical cast
}
```

The 11 named tree-mutation actions on the store (`insertNode`, `deleteNode`, `updateNodeProps`, `setBreakpointOverride`, `clearBreakpointOverride`, `renameNode`, `toggleNodeLocked`, `toggleNodeHidden`, `moveNode`, `duplicateNode`, `wrapNode`) are **one-liners that call `mutateActiveTree`**. They MUST NOT contain their own `kind === 'visualComponent'` branch — gated by `no-vc-mode-branches-in-mutations.test.ts`.

Why this matters: page trees and VC trees both have shape `NodeTree<TNode>`. The tree-agnostic mutations in `src/core/page-tree/mutations.ts` work on any `NodeTree`. The store doesn't need to know which kind of tree it's mutating — that's the sole job of `mutateActiveTree`.

See [docs/reference/page-tree.md](reference/page-tree.md) for the `NodeTree` type and the mutation cookbook.

### Selectors and subscriptions

Components subscribe to the store via `useEditorStore(selector)`. `subscribeWithSelector` keeps re-renders narrow:

```tsx
import { useEditorStore } from '@site/store/store'

function NodeName({ nodeId }: { nodeId: string }) {
  const name = useEditorStore((s) => s.site.activePage.nodes[nodeId]?.name)
  return <span>{name}</span>
}
```

Selectors are pure reads. Mutations go through actions (`useEditorStore.getState().insertNode(...)`).

---

## The canvas

`src/admin/pages/site/canvas/` is the rendering pipeline. Two key ideas:

### 1. Per-breakpoint iframes

Each visible breakpoint renders the page in its own `<iframe sandbox>` (`ModuleSandboxFrame.tsx`). The iframe loads a generated HTML document (`moduleSandboxSrcDoc.ts`) and bridges with the editor via `postMessage`. Why iframes:

- **Style isolation.** Page CSS can't leak into the editor chrome (and vice versa).
- **Plugin sandboxing.** Plugin canvas modules can be safely run inside the iframe with `sandbox="allow-scripts"` (no `allow-same-origin`).
- **Per-breakpoint rendering.** Each breakpoint frame is the actual viewport width the user would see in the browser.

The `CanvasRoot` → `BreakpointFrame` → `ModuleSandboxFrame` → `NodeRenderer` chain walks the active page tree and renders each node.

### 2. Selection / hover are CSS rings on the iframe content

Selection isn't a React overlay — it's a `box-shadow: var(--canvas-selection-ring)` applied to the selected node inside the iframe. Same for hover (`--canvas-hover-ring`). The two ring colors (neon green and neon pink) are the only chromatic UI on the canvas; they're bright enough to be visible against any user content.

### CSS injection into the iframe

Each iframe `<head>` receives three `<style>` elements, in this order:

| Element | Injector | Cascade layer | Contents |
|---|---|---|---|
| `<style id="pb-editor-chrome">` | `EditorChromeInjector` | **unlayered** | Editor-only chrome: placeholder, slot-instance, list placeholder, unknown-module fallback |
| `<style id="mc-classes">` | `ClassStyleInjector` | `@layer user-authored` | Publisher reset + framework CSS + class registry CSS |
| `<style id="mc-user-styles">` | `UserStylesheetInjector` | `@layer user-authored` | User-uploaded stylesheets (verbatim, unscoped) |

The **unlayered-vs-layered** split is the cascade isolation mechanism: CSS rules outside any `@layer` always beat rules inside `@layer`-d blocks, regardless of specificity. Author CSS (both the class registry and user stylesheets) goes into `@layer user-authored`, so it can never override the editor chrome even with a high-specificity selector.

`EditorChromeInjector` targets chrome elements via **stable data-attribute selectors** (`data-canvas-module-placeholder`, `data-pb-slot-instance`, `data-pb-unknown-module`, etc.) rather than hashed CSS-Module class names, which only exist in the parent document. At mount, it copies the required design tokens (`--editor-text-muted`, `--canvas-placeholder-bg`, `--editor-radius`, etc.) from the parent document's `:root` onto the iframe's `:root` so `var(--editor-*)` resolves correctly inside the iframe.

Full details: [`docs/features/canvas-iframe-per-frame.md`](../features/canvas-iframe-per-frame.md).

### Key canvas files

| File                            | Owns                                                            |
|---------------------------------|-----------------------------------------------------------------|
| `CanvasRoot.tsx`                | Top-level canvas mount                                          |
| `BreakpointFrame.tsx`           | One iframe per active breakpoint                                |
| `IframeFrameSurface.tsx`        | The iframe element + portal + style injectors                   |
| `EditorChromeInjector.tsx`      | Unlayered editor-chrome CSS into each iframe head               |
| `ClassStyleInjector.tsx`        | Class registry + publisher reset CSS into each iframe head      |
| `UserStylesheetInjector.tsx`    | User-uploaded CSS into each iframe head                         |
| `NodeRenderer.tsx`              | Renders a single node and its children inside the iframe        |
| `CanvasTransformLayer.tsx`      | Zoom + pan transform (design view)                              |
| `CanvasLiveSurface.tsx`         | "Live" view — single real-size editable frame, normal scroll    |
| `RuntimeScriptInjector.tsx`     | Injects bundled runtime scripts into an editable iframe         |
| `CanvasModeToggle.tsx`          | Design/Live view toggle + Run-scripts toggle + breakpoint switch |
| `CanvasContextSelector.tsx`     | Editing-context switcher: viewports + custom conditions (@media/@container/@supports) |
| `CanvasLayerContextMenu.tsx`    | Right-click on a layer                                          |
| `canvasDnd.ts`                  | Drag-and-drop (insert / move / wrap)                            |
| `canvasDomGeometry.ts`          | Cross-iframe DOM measurement                                    |
| `canvasSelectionUtils.ts`       | Selection helpers                                               |
| `useCanvasKeyboardShortcuts.ts` | Editor keyboard shortcuts (delete, duplicate, wrap, …)          |
| `useRuntimeScriptBuild.ts`      | Builds the bundled runtime scripts for the Run-scripts toggle    |

---

## Sidebars and panels

### Panel rail

42px-wide vertical strip on the far left. Each button is a rail tint (mint / lilac / sky / peach) and opens a panel in the left sidebar. Implementation: `src/admin/pages/site/sidebars/PanelRail/PanelRail.module.css`.

### Left sidebar

Opens the rail-selected panel:

- `DomPanel` — layer tree of the current page
- `SiteExplorerPanel` — pages and components roster
- `MediaExplorerPanel` — quick media insert
- `ColorsPanel`, `TypographyPanel`, `SpacingPanel` — site-level design tokens
- `FrameworkScalePanel` — scale / spacing system
- `DependenciesPanel` — site package.json / `bun install`
- `SelectorsPanel` — CSS class library
- `PluginEditorPanel` — plugin-provided editor panels
- `AgentPanel` — AI assistant

### Right sidebar

Property controls bound to the selected node. Contents driven by the node's module schema (`src/core/module-engine/`).

---

## Toolbar

`src/admin/pages/site/toolbar/`:

- `PublishButton`, `PublishActionGroup` — publish current site / page
- `SaveIndicator` — save state (clean / dirty / saving / error)
- `SettingsButton` — open settings modal
- `ZoomControls` — canvas zoom
- `ModulePickerDropdown` — insert a module
- `VCBreadcrumb` — current Visual Component breadcrumb (only in VC-mode)

---

## Spotlight (Cmd+K palette)

`src/admin/spotlight/` is the command palette. Mounted by `<SpotlightRoot>` in `AuthenticatedAdmin`, so it's available from every workspace.

Architecture:

- **`commandRegistry`** — central registry of built-in commands (`builtinCommands.ts`) plus plugin-registered commands.
- **`providers/`** — async providers that produce search hits (pages, components, media, etc.).
- **`scopes/`** — UI affordance for narrowing the palette to a single domain.
- **`matcher.ts`** — fuzzy-match scoring.
- **`recentStore.ts`** — recently-used hits.
- **`keybindings.ts`** — declarative keybinding registry.
- **`state.ts`, `stateHandlers.ts`** — palette state machine.

The palette is wired so that **plugin-registered commands work the same as built-in ones**. Spotlight is the editor's keyboard surface.

---

## Plugin host

Two folders carry the plugin frontend:

- **`src/admin/plugin-host-hooks/`** — React hooks exposed to plugins via `globalThis.__pagebuilder` (set up by `installPluginRuntime()` in `AuthenticatedAdmin`).
- **`src/admin/plugin-host-ui/`** — UI primitives plugins call to render dashboard / panel / page surfaces.

Plugin canvas modules render inside the canvas iframe like any other module. Plugin admin pages mount at `/admin/plugins/:pluginId/:pageId` via the `pluginPage` workspace.

See [docs/features/plugin-system.md](features/plugin-system.md) for the plugin SDK surface and lifecycle.

---

## Styling

- **CSS Modules only.** `Component.module.css` next to `Component.tsx`. Gated by `noTailwindUtilities.test.ts`.
- **Tokens from `src/styles/globals.css`** — no hardcoded hex / rgb / hsl in admin or ui CSS modules. Gated by `css-token-policy.test.ts`.
- **UI primitives from `src/ui/components/`** — see [docs/design.md](design.md) for the full catalog.
- **In-house `cn`** from `@ui/cn` — no `clsx`, `tailwind-merge`, `cva`, `@radix-ui/*`. Gated by `no-tailwind-deps.test.ts`.

---

## Adding a new workspace

1. Add the section name to the `AdminWorkspace` union in `src/admin/workspace.ts`.
2. Add `canAccessWorkspace` and `workspacePath` arms in `src/admin/access.ts`.
3. Add a `<Route>` in `src/admin/router.tsx` and a `<AdminEntry section="X">`.
4. Add a `lazy(...)` import + pre-warm `void import(...)` in `src/admin/AuthenticatedAdmin.tsx`.
5. Create `src/admin/pages/<workspace>/<Workspace>Page.tsx` with a named export.
6. Add the workspace to `AdminSectionNavigation`.

## Adding a new editor mutation

1. Add the function to `src/core/page-tree/mutations.ts` — must take a `NodeTree<TNode>` and operate generically.
2. Add a one-liner store action in `src/admin/pages/site/store/slices/site/nodeActions.ts` that calls `mutateActiveTree(tree => yourMutation(tree, ...))`.
3. Do **not** branch on `kind === 'visualComponent'` in the store action. Gated.

## Adding a new property control

1. Create the control component in `src/admin/pages/site/property-controls/<Control>.tsx`.
2. Bind it to a node prop via the module's schema (`src/core/module-engine/`).
3. Use existing UI primitives (`Input`, `Select`, `Switch`, `ColorInput`, etc.).

## Adding a new spotlight command

1. Built-in command → append to `src/admin/spotlight/builtinCommands.ts`.
2. Plugin command → register via the SDK at plugin activation.
3. If the command needs async data, write a provider in `spotlight/providers/`.

---

## Related

- [docs/architecture.md](architecture.md) — system overview
- [docs/server.md](server.md) — what the server does
- [docs/design.md](design.md) — visual design system
- [docs/features/plugin-system.md](features/plugin-system.md) — plugin SDK and lifecycle
- [docs/reference/page-tree.md](reference/page-tree.md) — the `NodeTree` primitive
- [docs/reference/ui-primitives.md](reference/ui-primitives.md) — UI primitive usage
- Source-of-truth files:
  - `src/admin/main.tsx` — React root mount
  - `src/admin/AuthenticatedAdmin.tsx` — post-login shell
  - `src/admin/router.tsx` — route table
  - `src/admin/lib/routing/` — in-house router
  - `src/admin/pages/site/SitePage.tsx` — visual editor mount
  - `src/admin/pages/site/store/store.ts` — editor store assembly
  - `src/admin/pages/site/store/slices/site/nodeActions.ts` — `mutateActiveTree`
  - `src/admin/pages/site/canvas/CanvasRoot.tsx` — canvas mount
  - `src/admin/spotlight/SpotlightRoot.tsx` — Cmd+K palette
- Gate tests:
  - `src/__tests__/architecture/no-router-in-site-page.test.ts`
  - `src/__tests__/architecture/no-vc-mode-branches-in-mutations.test.ts`
  - `src/__tests__/architecture/admin-feature-folders.test.ts`
  - `src/__tests__/architecture/centralized-site-mutation-history.test.ts`
  - `src/__tests__/architecture/canvasFastRefreshBoundaries.test.ts`
  - `src/__tests__/architecture/canvas-aware-selectors.test.ts`
  - `src/__tests__/architecture/spotlight-no-direct-store-mutation.test.ts`
  - `src/__tests__/architecture/spotlight-allowed-router-import.test.ts`
  - `src/__tests__/architecture/keybindings-registry-single-source.test.ts`
