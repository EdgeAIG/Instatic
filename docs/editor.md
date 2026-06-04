# Editor

Deep dive on the admin app and the visual editor — how the SPA boots, how routing works, how the editor store mutates pages, how the canvas renders.

The frontend is a single React 19 + Vite SPA mounted at `/admin`. Inside it, two concerns coexist: the **admin shell** (auth, navigation, workspaces, plugin host UI) and the **visual editor** (`src/admin/pages/site/`). They share auth, routing, theming, and the spotlight palette; they differ in everything else — the editor owns a heavy Zustand store and a custom rendering pipeline.

---

## TL;DR

- **Entry:** `src/admin/main.tsx` mounts `<Router><AdminRoutes /></Router><AdminContextMenuGuard />` with React 19 root-level error callbacks. `flushSync` forces the initial render synchronous to cut LCP.
- **Router:** `src/admin/lib/routing/` — in-house router replacing `react-router-dom`. 10 routes, all wrapped in a per-route `<ErrorBoundary>` and `<Suspense>`.
- **Cold path:** entry chunk is tiny. `AuthenticatedAdmin` is `React.lazy` and only loads post-login. Each workspace page is wrapped in `prewarmedLazy(...)`: the active page fires its import at module evaluation; the remaining pages pre-warm via `requestIdleCallback` after first paint so subsequent nav is synchronous (no Suspense flicker).
- **Workspaces:** `dashboard`, `site` (the editor), `content`, `data`, `media`, `plugins`, `users`, `ai`, `account`, `pluginPage`. Capability-gated by `canAccessWorkspace`.
- **Editor store** lives at `src/admin/pages/site/store/`. Zustand + Mutative (`zustand-mutative`) + `subscribeWithSelector`. 11 slices, one source of truth for the page tree. Undo/redo uses patch-based history (O(change) per step, not O(site)).
- **Active tree routing:** `mutateActiveTree(fn)` in `siteSlice` is the **only** place that branches on page-mode vs. VC-mode. The 11 named mutation actions are one-liners that delegate to it.
- **Canvas:** `src/admin/pages/site/canvas/` renders the page tree into per-breakpoint `IframeFrameSurface` iframes. Two views: **design** (multiple breakpoints side-by-side with pan/zoom) and **live** (single real-size editable frame with normal scrolling). Design mode paints iframe shells with detailed skeletons first, mounts the active breakpoint's node tree after the first paint, then fills inactive breakpoint frames on idle time. Three canvas ring tokens: `--canvas-selection-ring` (neon green, selected node), `--canvas-hover-ring` (neon pink, hovered node), `--canvas-selector-ring` (neon orange, selector-panel match sweep).
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
    │                     │  Module evaluation: fires preload() for the active
    │                     │  page only (the one matching window.location.pathname).
    │                     │
    │                     └─→ <AdminSessionProvider>
    │                            └─→ <StepUpProvider>
    │                                   └─→ <SpotlightRoot>
    │                                          └─→ <Suspense fallback=<AppLoadingScreen>>
    │                                                 └─→ <SitePage>
    │                                                       └─→ <AdminCanvasLayout>  ← real Site shell
    │                                                             └─→ <AdminCanvasEditorBody> (post-paint lazy)
    │
    ▼
SitePage mounts the real Site toolbar/chrome first. In production,
AdminCanvasLayout starts the editor body import after the shell has painted;
the body chunk contains DnD, the canvas, panels, first-party module
registration, loop sources, and code-editor overlays.
```

Why the split:

- **`main.tsx`** is the only module pre-login can compile. Keep it minimal.
- **`AdminEntry`** is eager-imported but small (~10 KB gz). Owns the boot probe and gate.
- **`AuthenticatedAdmin`** is `React.lazy` so the login screen doesn't pay for SpotlightRoot, the editor store, or any workspace page chunk.
- **Workspace pages** are wrapped in `prewarmedLazy(...)` — the active page pre-warms at module evaluation (alone, so no 8 sibling imports stealing CPU); after first paint a `requestIdleCallback` pre-warms the remaining pages. `/admin/site` delays sibling preloads slightly so `AdminCanvasEditorBody` claims the first post-paint slot. The result: subsequent workspace navigation renders synchronously with no Suspense fallback.
- **Plugin runtime** (`globalThis.__instatic`) is installed lazily by `ensurePluginRuntime()` in `pluginRuntimeBootstrap.ts`. It's triggered on first admin-layout mount via `useInstalledEditorPlugins`, so plugin code never runs before login and the runtime download stays off the dashboard critical path.

---

## Routing

`src/admin/lib/routing/` contains the in-house router (`Router`, `Routes`, `Route`, `Navigate`, `Link`, `useLocation`, `useNavigate`, `useParams`). Replaces `react-router-dom` for the 10-route admin app.

Use the in-house router for every internal admin navigation, including links rendered by the site editor. `react-router-dom` and raw `<a href="/admin...">` hard navigations are banned in admin UI by `admin-router-usage.test.ts`. `src/core/` and `src/modules/` stay router-free because they are shared engine / published-page code, not admin UI.

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
| `/admin/ai`                             | `<AdminEntry section="ai" />` (AI credentials, models, defaults) |
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

Workspace selections still need bookmarkable query strings without replaying route navigation. `urlState` solves this by operating on `window.history.replaceState` directly — no `instatic:locationchange` event, no route re-match, just a query-string update that keeps the pathname stable.

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

### The three layouts

Every admin page picks one of three root layouts from `src/admin/layouts/`. Import directly from the per-layout path (not the barrel `src/admin/layouts/index.ts`) so rolldown can split them into separate chunks.

| Layout | Used by | Bundle contract |
|---|---|---|
| `AdminCanvasLayout` | Site editor (`SitePage`) | Site shell — toolbar/chrome, persistence, editor store, and a post-paint lazy boundary for the heavy body. |
| `AdminWorkspaceCanvasLayout` | Content, Data, Media | Canvas chrome (toolbar, sidebar, full-height canvas) WITHOUT site-only modules (no PropertiesPanel, no DnD, no CodeMirror). |
| `AdminPageLayout` | Plugins, Users, Account, plugin admin pages | Lightweight — toolbar + centered scrollable page body. **Must not import the editor store.** Site name and favicon come from `useSiteSummary` + the `adminUi` Zustand store. |

`AdminCanvasLayout` keeps the real editor shell mounted while `usePersistence()` loads the draft site document. In production it renders the toolbar/chrome first and lazy-loads `AdminCanvasEditorBody` after paint. The body owns the permanent rail, sidebars, canvas, DnD context, `ConfirmDeleteProvider`, `CodeEditorPanel`, first-party module registration, and loop-source registration. Rare modal surfaces such as `ImportHtmlModal` stay behind their own open-state lazy boundary inside the body. Loading states use the same local skeleton vocabulary: the editor-body lazy fallback and the canvas no-site fallback both render `CanvasFrameSkeletonFrame`, sidebars use compact skeleton rows or blocks, and loaded breakpoint frames keep `CanvasFrameSkeleton` visible while their iframe trees progressively mount.

The `adminUi` store (`src/admin/state/adminUi.ts`) is the small cross-shell state store: settings-modal open flag, site-import modal open flag, site name/favicon for the toolbar, and the active live-page path. It lives outside `@site/` so `AdminPageLayout` can subscribe without pulling in the 165 KB editor graph. The editor's `settingsSlice` mirrors its state into `adminUi` via a registered bridge so both are always in sync.

`AdminWorkspaceCanvasLayout` and `AdminPageLayout` both call `useSiteSummary()` — a lightweight hook that fires a single `cmsAdapter.loadSite()` per session and writes the name + favicon into `adminUi`. The Site editor's `usePersistence` writes the same fields when it hydrates the full site, so after navigating to `/admin/site` the toolbar updates without a second fetch.

When a Content or Data workspace has a right-side panel available but the user closes it, `AdminWorkspaceCanvasLayout` renders a compact top-right canvas notch to reopen that panel without changing the selected row or entry.

```text
src/admin/
├── main.tsx                    ← React root mount
├── AdminEntry.tsx              ← boot probe + auth gate
├── AuthenticatedAdmin.tsx      ← post-login chunk (prewarmedLazy scheduler)
├── AppLoadingScreen.tsx        ← shared loading screen
├── router.tsx                  ← admin route table
├── access.ts                   ← workspace gating
├── workspace.ts                ← AdminWorkspace union
├── session.tsx, sessionContext.ts ← AdminSession context
├── pluginRuntimeBootstrap.ts   ← installs globalThis.__instatic (lazy)
│
├── layouts/
│   ├── AdminCanvasLayout/      ← Site shell + lazy editor body
│   ├── AdminWorkspaceCanvasLayout/ ← canvas shell for Content/Data/Media
│   └── AdminPageLayout/        ← lightweight page shell (no editor store)
│
├── state/
│   └── adminUi.ts              ← cross-shell Zustand store (settings, site import, site name)
│
├── lib/
│   ├── routing/                ← in-house router
│   ├── urlState/               ← workspace-agnostic URL query-string sync
│   ├── prewarmedLazy.ts        ← React.lazy alternative with explicit preload + sync fast-path
│   ├── useAsyncResource.ts     ← canonical single-resource async load hook
│   └── useAdminNavigate.ts
│
├── preauth/                    ← login / setup flows
├── shared/                     ← StepUp, dialogs, AdminSectionNavigation, AdminContextMenuGuard, ...
├── modals/                     ← workspace-level modals
├── plugin-host-hooks/          ← React hooks plugins call via the SDK
├── plugin-host-ui/             ← Host UI primitives plugins call via the SDK
├── spotlight/                  ← Cmd+K palette
│
└── pages/                      ← workspace implementations
    ├── dashboard/              ← stats, activity, publish lineup
    ├── site/                   ← THE VISUAL EDITOR (see below)
    ├── content/                ← post / page list and editor
    ├── data/                   ← data_tables management (see docs/features/data-workspace.md)
    ├── media/                  ← media manager
    ├── plugins/                ← plugin install / configure
    ├── users/                  ← user management
    ├── ai/                     ← AI credentials, defaults, usage audit
    ├── account/                ← own-account settings
    └── ...
```

### Cross-page primitives

- **`SpotlightRoot`** — Cmd+K command palette. Owns its own command registry (`spotlight/commands/`), provider runner (`providers/`), scopes, keybindings, recents, telemetry. Available from every workspace.
- **`AdminSectionNavigation`** — top-of-screen workspace switcher.
- **`AccountMenuButton`** — top-right avatar / account menu.
- **`Panel`, `PanelHeader`, `SidebarResizeHandle`** — generic floating-panel chrome reused across the editor, content, and data workspaces.
- **`StepUp`** — re-auth dialog gating sensitive actions.
- **`AdminContextMenuGuard`** (`src/admin/shared/AdminContextMenuGuard/`) — mounted at root level in `main.tsx` alongside the router. Intercepts every native `contextmenu` event on the document. If the event was already `preventDefault`-ed by an app context menu (or fired inside a `[role="menu"]` element), the guard is silent. Otherwise it prevents the native browser menu and shows a small animated danger flash at the cursor to signal "no context menu here." App context menus (e.g. `DataRowContextMenu`, `DataTableContextMenu`) call `preventDefault()` at their source, so the guard only fires for truly unhandled right-clicks.
- **`useAsyncResource`** (`src/admin/lib/useAsyncResource.ts`) — canonical hook for single-resource async loads. Runs `loader` on mount and whenever `deps` change, tracks `{ data, loading, error }`, discards superseded responses, and exposes a stable `refresh()`. The loader receives an `AbortSignal` for in-flight cancellation. Reach for this first when a screen loads one resource; see the hook's JSDoc for the cases that intentionally don't use it (multi-fetch orchestrators, module-level cached loads, event-driven effects).

---

## The visual editor (`src/admin/pages/site/`)

The editor is a self-contained app inside the admin shell. It owns:

- A canvas that renders the page tree into per-breakpoint iframes.
- A heavy Zustand store with 11 slices.
- Left and right sidebars with collapsible panels.
- A toolbar with publish / save / zoom / the module inserter.
- Property controls bound to selected nodes.

### Folder structure

```text
src/admin/pages/site/
├── SitePage.tsx                ← Site route; renders AdminCanvasLayout
├── EditorPermissionsProvider.tsx, editorPermissionsContext.ts
│
├── store/                      ← Zustand + Mutative store (see below)
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
├── module-picker/              ← module inserter modal + compact context-menu picker
├── code-editor/                ← CodeMirror-backed code panel
├── toolbar/                    ← top toolbar
├── preview/                    ← preview iframe runtime
├── explorer-actions/           ← DOM / Site explorer context menus
├── agent/                      ← AI agent panel
├── hooks/                      ← cross-cutting editor hooks
├── layout/                     ← shell layout
└── ui/                         ← editor-local UI primitives (Tree*, etc.)
```

The heavy body for that route lives beside the layout at
`src/admin/layouts/AdminCanvasLayout/AdminCanvasEditorBody.tsx`. It is not in
`src/admin/pages/site/` because the body is part of the Site shell split: the
route chunk stays small, while the editor runtime graph remains one lazy
boundary deeper.

### Site Explorer

`SiteExplorerPanel` (`src/admin/pages/site/panels/SiteExplorerPanel/`) is the editor's concept browser for pages, templates, Visual Components, stylesheets, and scripts. Every section renders through `SiteExplorerTreeSection`, which uses the shared `Tree*` primitives from `src/admin/pages/site/ui/Tree/` for depth indent, chevrons, selection chrome, and DnD row affordances.

Organization is persisted in `site.explorer` on the site shell. Folders are decorative and flat: they group editor rows only, and never change page slugs, public URLs, component identity, or file paths. The homepage is the page whose slug is `index`; it is always pinned as the first Pages row and does not receive organization drag handlers.

**Store actions** on `siteSlice` for explorer management:

| Action | Effect |
|---|---|
| `createExplorerFolder(sectionId, name)` | Creates a folder in the given section, returns the new folder id |
| `renameExplorerFolder(sectionId, folderId, name)` | Renames a folder |
| `deleteExplorerFolder(sectionId, folderId)` | Deletes a folder; items that were inside it move to the section root |
| `moveExplorerFolder(sectionId, folderId, nextIndex)` | Reorders a folder within the root level |
| `moveExplorerItem(sectionId, itemId, parentFolderId, nextIndex)` | Moves an item to a folder or the root; the homepage cannot be moved |
| `setPageAsHomepage(pageId)` | Promotes a page to `slug='index'`, demotes the previous homepage to a generated slug, pins the new homepage at the section root |

**DnD architecture:** Organization drag-and-drop (`useSiteExplorerDnd`) uses `useDndMonitor` to hook into the outer `DndContext` that lives in `AdminCanvasEditorBody`. The explorer DnD hook only reacts to `siteExplorerItem` / `siteExplorerFolder` drags, which keeps Site Explorer focused on opening and organizing site artifacts rather than inserting components onto the canvas.

**Section model:** `buildSiteExplorerTreeSection` in `siteExplorerModel.ts` converts the flat placement arrays from `site.explorer` into a typed tree model (`SiteExplorerTreeSectionModel`) that `SiteExplorerTreeSection` renders — pinned items come first, then root entries (folders and items) sorted by `order`, with each folder's items sorted within it.

**Reconciliation:** `reconcileSiteExplorerInPlace(site)` is called on load, on item-lifecycle mutations (page/template conversions, file creates/deletes, VC creates/deletes), and before any move operation. It drops stale placements, appends newly-created items, filters out non-ejected generated files, and re-pins the homepage.

### Editor store

`src/admin/pages/site/store/` is the central state for the editor. Zustand with the `mutative` middleware from `zustand-mutative` (mutations are written as direct draft-mutation; Mutative produces structural sharing) and `subscribeWithSelector` (granular subscriptions without React context re-renders). `enableAutoFreeze: true` mirrors Immer's dev guard against accidental external mutation.

**Undo/redo** uses patch-based history: every undoable mutation captures Mutative `[next, forward, inverse]` patch pairs scoped to the `SiteDocument`. Undo applies `entry.inverse`, redo applies `entry.forward` — O(change) in both time and memory, not O(site). A 50-deep history holds kilobytes of patches instead of hundreds of megabytes of full-site clones. See [`docs/reference/editor-history.md`](../reference/editor-history.md).

The store is composed of **11 slices**, each created by a factory in `store/slices/`:

| Slice                  | Owns                                                                       |
|------------------------|----------------------------------------------------------------------------|
| `siteSlice`            | `SiteDocument` (pages, nodes, breakpoints, settings, classes, files). The page tree itself. |
| `selectionSlice`       | `selectedNodeId`, `hoveredNodeId`                                          |
| `canvasSlice`          | Zoom, pan, `activeBreakpointId`, `canvasMode` ('select'|'pan'|'insert'), `canvasView` ('design'|'live'), `runScripts` |
| `uiSlice`              | Panel visibility, unsaved-changes flag, insert picker, `componentizeEditorRequest` |
| `classSlice`           | Style-rule CRUD, node ↔ class assignment, ambient selector creation         |
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

### 1. Design mode and live mode

`CanvasRoot` switches between two rendering surfaces based on `canvasView`:

- **Design mode** (`canvasView === 'design'`): `CanvasRoot` → `CanvasTransformLayer` → `BreakpointFrame` → `IframeFrameSurface` → `NodeRenderer`. Each breakpoint gets its own iframe rendered side-by-side inside the pan/zoom transform layer. The author sees all breakpoints at once and can zoom in/out.
- **Live mode** (`canvasView === 'live'`): `CanvasRoot` → `CanvasLiveSurface` → `IframeFrameSurface` → `NodeRenderer`. A single real-size frame at 100% width (optionally clamped to a selected breakpoint's width) scrolls normally. Resizable with side handles.

Both modes use the same `IframeFrameSurface` and the same `NodeRenderer` — they are fully editable (click-to-select, properties panel, structural edits all work). The only difference is the layout wrapper.

Design mode uses `useProgressiveCanvasFrameLoading` so large pages do not mount every breakpoint copy of the node tree in the same commit. `BreakpointFrame` always mounts the lightweight iframe shell and shared `CanvasFrameSkeleton`; the active breakpoint's `NodeRenderer` tree is revealed first, and inactive breakpoint trees are revealed one at a time after idle pauses. Direct `BreakpointFrame` usage still renders immediately unless its `renderTree` prop is explicitly disabled.

Each `IframeFrameSurface` boots with an empty `srcDoc` skeleton and portals the React node tree into the iframe's `<body>` via `createPortal`. Why iframes:

- **Style isolation.** Page CSS (`body { background: black }`, `>`, `+`, `:nth-child()`) works exactly as on the published page — no wrapping divs, no selector rewriting.
- **Plugin module isolation.** Plugin canvas modules (`ModuleSandboxFrame.tsx`) run inside nested iframes with `sandbox="allow-scripts"` for security; the `IframeFrameSurface` outer frame is same-origin.
- **Per-breakpoint viewport.** Each frame is sized to the breakpoint width, so `vw`/`vh` units, media queries, and scroll behaviour all match the published page.

### 2. Selection, hover, and inspect ladder overlays

Selection rings and hover rings are absolutely-positioned overlay divs portaled into the canvas root—outside the iframe and the transform layer. Their 1px border is a `box-shadow` using `--canvas-selection-ring` (neon green) for selection and `--canvas-hover-ring` (neon pink) for hover. Because the rings live in the canvas root's coordinate space rather than inside the scaled transform layer, that 1px border stays exactly 1px at every zoom level. The two ring colors are the only chromatic UI on the canvas; they're bright enough to be visible against any user content.

`BreakpointSelectionOverlay` owns these rings and all other canvas-local action chrome that must escape iframe overflow: the selected-layer toolbar and the Alt/Option inspect ladder. The selected-layer toolbar carries four actions, left to right: drag-to-reorder, **insert module** (`CanvasInsertModuleButton` — opens the full `ModuleInserterDialog`, the same modal command surface as the main toolbar's "+ Add" button, rather than an anchored dropdown that would mis-position against the zoom/transform-scaled canvas and its breakpoint iframes), duplicate, and delete. Both inserter entry points share the `useInsertInserterItem` hook, so the picked node routes through `resolveInsertLocation` against the current selection — nesting as a last child of a container target or landing as a sibling-after of a leaf target, identical to every other insert flow. Holding Alt/Option while hovering a canvas element opens a momentary tree-shaped target picker in the parent canvas root, anchored above or below the hovered element and clamped to the visible canvas. The picker is built from the active `NodeTree`, not raw DOM parents: ancestors appear above the hovered node, the hovered node is the current row, and the first visible child appears below it. ArrowUp/ArrowDown move the highlighted target, Enter commits selection, clicking a row commits immediately, and releasing Alt/Option or pressing Escape dismisses the ladder. Committing through the ladder changes the selected node without taking focus from the current side panel, so the Properties panel stays open while users retarget parent or child layers.

Ring and toolbar positions are computed on each animation frame via a RAF loop (simpler than wiring ResizeObserver/MutationObserver/IntersectionObserver to every mutation source — scroll, layout shift, zoom, content animation). The loop only starts when `hasOverlayWork` is true — at least one selection ring, hover ring, selector-affinity highlight, or toolbar is visible. When there is no overlay work the effect returns early so idle breakpoint frames incur no RAF cost. **When adding a new visible overlay type to `BreakpointSelectionOverlay`, update `hasOverlayWork`** so the loop arms correctly.

### CSS injection into the iframe

Each iframe `<head>` receives three `<style>` elements, in this order:

| Element | Injector | Cascade layer | Contents |
|---|---|---|---|
| `<style id="instatic-editor-chrome">` | `EditorChromeInjector` | **unlayered** | Editor-only chrome: placeholder, slot-instance, list placeholder, unknown-module fallback |
| `<style id="mc-classes">` | `ClassStyleInjector` | `@layer user-authored` | Publisher reset + framework CSS + class registry CSS |
| `<style id="mc-user-styles">` | `UserStylesheetInjector` | `@layer user-authored` | User-uploaded stylesheets (verbatim, unscoped) |

The **unlayered-vs-layered** split is the cascade isolation mechanism: CSS rules outside any `@layer` always beat rules inside `@layer`-d blocks, regardless of specificity. Author CSS (both the class registry and user stylesheets) goes into `@layer user-authored`, so it can never override the editor chrome even with a high-specificity selector.

`EditorChromeInjector` targets chrome elements via **stable data-attribute selectors** (`data-canvas-module-placeholder`, `data-instatic-slot-instance`, `data-instatic-unknown-module`, etc.) rather than hashed CSS-Module class names, which only exist in the parent document. At mount, it copies the required design tokens (`--editor-text-muted`, `--canvas-placeholder-bg`, `--editor-radius`, etc.) from the parent document's `:root` onto the iframe's `:root` so `var(--editor-*)` resolves correctly inside the iframe.

Full details: [`docs/features/canvas-iframe-per-frame.md`](../features/canvas-iframe-per-frame.md).

### 3. Canvas stacking context isolation

`CanvasRoot` (`src/admin/pages/site/canvas/CanvasRoot.module.css`) sets `position: relative; z-index: 0`. This establishes an **isolating stacking context** for the entire canvas subtree. Every canvas-internal z-index value is confined inside that context and cannot compete with sibling layout elements.

Why this matters: selection rings and the floating selection toolbar are portaled into the canvas root and painted at z-index 51 (above the `PluginCanvasOverlayLayer` at 50). Without the `z-index: 0` stacking context on the canvas, those z-index 51 values escape into the shared layout context and paint over the floating `PropertiesPanel` (also z-index 50), which is a sibling of the canvas. With the isolation in place, the canvas as a whole occupies z-index 0 in the shared layout context — well below the panel's 50.

**Editor layout z-index table** (shared context, outside the canvas):

| Element                               | z-index | File |
|---------------------------------------|---------|------|
| Canvas (CanvasRoot, isolation root)   | 0       | `canvas/CanvasRoot.module.css` |
| Toolbar (main bar)                    | 30      | `toolbar/Toolbar.module.css` |
| PropertiesPanel (floating)            | 50      | `panels/PropertiesPanel/PropertiesPanel.module.css` |
| AgentPanel (floating)                 | 50      | `panels/AgentPanel/AgentPanel.module.css` |
| DomPanel (floating)                   | 50      | `panels/DomPanel/DomPanel.module.css` |
| LeftSidebar, RightSidebar, PanelRail  | 55      | `sidebars/*/` |
| CodeEditorPanel                       | 80      | `code-editor/CodeEditorPanel.module.css` |
| Toolbar popovers / dropdowns          | 201     | `toolbar/Toolbar.module.css` |
| PreviewOverlay                        | 400–401 | `preview/PreviewOverlay.module.css` |

**Canvas-internal z-index table** (all confined inside the `z-index: 0` canvas context):

| Element                               | z-index           |
|---------------------------------------|-------------------|
| PluginCanvasOverlayLayer              | 50                |
| Selection ring, hover ring, selection toolbar | 51        |
| Alt/Option inspect ladder             | 52                |
| CanvasNotch                           | 53                |
| CanvasModeToggle                      | 53                |
| CanvasContextSelector                 | 60                |
| VisualComponentModeControl            | 200               |
| Drop-indicator inside iframe          | 2147483647 (max)  |

Canvas-internal values are not CSS tokens — they are raw integers intentionally scoped to the canvas stacking context and isolated from the layout stacking context by the `z-index: 0` on `CanvasRoot`.

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
| `canvasOverlayGeometry.ts`      | Cross-iframe element rect → canvas-root coords; CSS attribute value escaping |
| `canvasSelectionUtils.ts`       | Selection helpers                                               |
| `BreakpointSelectionOverlay.tsx`| Selection / hover rings, selection toolbar, inspect ladder integration |
| `CanvasInsertModuleButton.tsx`  | "Insert module" button in the canvas selection toolbar — opens `ModuleInserterDialog` |
| `canvasTreeLadder.ts`           | Alt/Option inspect ladder tree model                            |
| `CanvasTreeLadderOverlay.tsx`   | `useCanvasTreeLadderOverlay` — wires the ladder model to canvas events and portal |
| `CanvasTreeLadderRowButton.tsx` | Single row button in the Alt/Option inspect ladder              |
| `useCanvasKeyboardShortcuts.ts` | Editor keyboard shortcuts (delete, duplicate, wrap, …)          |
| `useRuntimeScriptBuild.ts`      | Builds the bundled runtime scripts for the Run-scripts toggle    |
| `useIframeCursorBridge.ts`      | Bridges iframe-native cursor movement to parent-doc callbacks (used by breakpoint activation tooltip) |

---

## Sidebars and panels

### Panel rail

42px-wide vertical strip on the far left. Primary navigation panels sit in the top group; global workspace actions such as the AI assistant are pinned to the bottom group. Each button gets an automatic rail tint from its full panel identity, with repeats avoided inside the visible rail group, and opens a panel in the left sidebar. Implementation: `src/admin/pages/site/sidebars/PanelRail/PanelRail.module.css`.

### Left sidebar

Opens the rail-selected panel:

- `DomPanel` — layer tree of the current page
- `SiteExplorerPanel` — pages and components roster
- `MediaExplorerPanel` — quick media insert
- `ColorsPanel`, `TypographyPanel`, `SpacingPanel` — site-level design tokens
- `DependenciesPanel` — site package.json / `bun install`
- `SelectorsPanel` — CSS class library
- `PluginEditorPanel` — plugin-provided editor panels
- `AgentPanel` — AI assistant

### Right sidebar (`RightSidebar`)

`src/admin/pages/site/sidebars/RightSidebar/RightSidebar.tsx`. Accepts a `mode` prop (`'site' | 'hidden'`):

- `'site'` — expands when a node or class is selected AND the panel is docked AND not collapsed. Determined by `selectRightSidebarExpanded` (`src/admin/pages/site/store/store.ts`).
- `'hidden'` — always collapsed (site viewer; no `pages.draft.save` capability).

`isExpanded` is derived from synchronous editor store state only — never from async prop availability. This means the sidebar lands at its final width on the very first render with no transition.

Property controls are driven by the selected node's module schema (`src/core/module-engine/`).

At the top of the Properties Panel, the selector picker is the single entry point for CSS rules that affect the selected element. Assigned class rules render as removable `TagPill` chips and are stored on `node.classIds`; matching ambient rules render as non-removable `TagPill` chips because they apply by selector matching, not assignment. The dropdown searches both class rules and ambient selectors. Ambient rows that do not match the selected canvas element stay visible but disabled with the mismatch reason, and selector-shaped input such as `.hero .title`, `h1`, or `a:hover` creates an ambient rule instead of a class.

The Typography panel stores Google/custom font assets and editable font tokens together under `site.settings.fonts`. Installed font assets own the self-hosted `@font-face` files; font tokens own the builder-facing variables such as `--font-primary`, the assigned font asset, and the fallback stack. The property-panel `font-family` control is a rich picker: token rows write `var(--font-primary)` so the selected node or class keeps following future token swaps, direct font rows write a concrete family stack as an escape hatch, and the text input still accepts manual values.

When the user clicks a rule in the Selectors Panel, the Properties Panel switches to **selector-editing mode** — the body shows style controls for that rule directly, and the header renders `SelectorHeader` with the rule's CSS selector, an inline rename input, and a delete button. The delete and rename actions are only shown for non-generated rules and require `site.style.edit`.

When an eligible node is selected on a page canvas (not root, not already a ref, not inside VC mode), a **Componentize** button (`ConvertToComponentButton`) appears next to the class picker. Clicking it, or triggering `openComponentizeEditor(nodeId)` from the layer context menu, opens an inline name-input strip and, on confirmation, calls `convertNodeToComponent(nodeId, name)` to extract the subtree into a new Visual Component. Full details: [`docs/features/visual-components.md`](features/visual-components.md) → "Componentizing existing page content".

### Sidebar motion model

Both sidebars animate open/close with `transition: flex-basis 180ms ease, width 180ms ease` (disabled under `prefers-reduced-motion: reduce`). The implementation uses a **two-variable pattern** to prevent content reflow during animation:

| CSS variable | Value when closed | Value when open | Used for |
|---|---|---|---|
| `--left-sidebar-panel-width` | `0px` | saved panel width | Sidebar `flex-basis` / `width` (drives the animation) |
| `--left-sidebar-panel-layout-width` | saved panel width | saved panel width | Panel slot `width` (stays constant; prevents reflow) |
| `--right-sidebar-panel-width` | `0px` | saved panel width | Sidebar `flex-basis` / `width` |
| `--right-sidebar-panel-layout-width` | saved panel width | saved panel width | Panel slot `width` |

The sidebar shell expands/collapses by animating `--*-panel-width`. The panel slot always stays at `--*-panel-layout-width` so text and controls inside it do not reflow during the animation.

**No transition fires on cold load.** `restoreStoredEditorLayout` is called at module-evaluation time in `store.ts` — before the first React render — so the store already has the persisted sidebar widths when the component tree mounts. Because there is no state delta to animate, the CSS transition is silent on cold loads and only fires when the user explicitly opens or closes a panel.

`SidebarResizeHandle` (`src/admin/shared/SidebarResizeHandle/SidebarResizeHandle.tsx`) is the drag-and-keyboard handle shared by every sidebar instance. It sets `cssVariable` directly on the target element during drag (for smooth live feedback) and only calls `onResize` on pointer-up to commit the change to the store and to `localStorage` via `writeWorkspaceLayout`.

---

## Toolbar

`src/admin/pages/site/toolbar/`:

- `PublishButton`, `PublishActionGroup` — publish current site / page
- `SettingsButton` — opens the Settings modal (see below)
- `ZoomControls` — canvas zoom
- `ModulePickerDropdown` — opens the module inserter modal

### Settings modal

`src/admin/modals/Settings/SettingsModal.tsx`. Shares the visual language of the Spotlight palette and Module Inserter: a `--panel-*`-token shell, `--editor-surface-2` rail with categorical rail-tint icon chips, accent-bar section header, card-group rows (`--editor-surface-2` fills, `--panel-radius` corners, 1px gaps showing the darker panel surface through) for section content, and an Esc keycap affordance. Backdrop click and Esc both close — there is no dedicated close button.

**Sections** (rail nav, four entries):

| Section       | What it contains                                                             |
|---------------|------------------------------------------------------------------------------|
| General       | Site name, meta title, meta description, language, favicon                   |
| Shortcuts     | Auto-rendered keyboard shortcut reference from the keybindings registry       |
| Publishing    | Self-hosted runtime info + framework CSS tree-shaking toggle                 |
| Preferences   | Catalog-driven editor preferences (auto-rendered from `PREFERENCE_CATALOG`)  |

Site-specific controls that were previously sections of this modal (Pages roster, Breakpoints/Viewports, Conditions) now live in their dedicated surfaces: the Site Explorer panel and `CanvasContextSelector` (unified condition axis).

**State bridge**: settings modal open/close state is mirrored between two stores. `adminUi` (`src/admin/state/adminUi.ts`) is the source the modal reads — this lets `SettingsButton` work on non-editor admin pages without pulling in the editor store. `settingsSlice` in the editor store mirrors that state via `bindSettingsBridgeStoreApi` so editor-side consumers (spotlight commands, tests) can open/navigate settings without knowing about `adminUi`. A re-entrance guard (`bridgeReentrancyGuard`) prevents the two-way sync from looping.

`CanvasNotch` (`src/admin/pages/site/canvas/CanvasNotch.tsx`) owns the canvas-local insertion chrome. Its quick insert buttons are resolved from each admin's server-side `module-inserter` user preference; the default favorites are Container, Text, and Image. The full module inserter is the management surface for those favorites, so any insertable module, layout preset, or Visual Component can be pinned into the notch without adding a separate settings panel. In Visual Component mode, `CanvasRoot` mounts `VisualComponentModeControl` below the notch so the current component name, rename action, and page-return action stay attached to the canvas rather than the global toolbar.

### Module Inserter

`src/admin/pages/site/module-picker/` has two insertion surfaces:

- `ModuleInserterDialog` — the full modal (category rail, search, grid/list view, wireframe previews, recents, drag-to-canvas insertion). Two entry points open it: the toolbar `+` button (`ModulePickerDropdown`) and the canvas selection toolbar's "Insert module" button (`CanvasInsertModuleButton`). Both share `useInsertInserterItem` (`src/admin/pages/site/hooks/useInsertInserterItem.ts`), so target resolution and dispatch are identical for both flows.
- DOM-panel context menus keep the compact `ModulePicker` inside `ContextMenuSubmenu`; those flows need a small anchored submenu rather than the full modal.

Data sources:

- **Modules:** `registry.list()` filtered by the same editor insertion rules as the compact picker (`base.body`, `base.visual-component-ref`, and `base.slot-instance` hidden; `base.slot-outlet` only in Visual Component mode).
- **Layouts:** seeded `LAYOUT_PRESETS`, built from the same serialized subtree shape as `FORM_PRESETS`.
- **Components:** `site.visualComponents`.
- **Community:** reserved for a future plugin catalog backend; no mocked catalog is shown in the real editor.
- **Recent:** per-browser local state in `instatic-module-inserter-v1`, validated with TypeBox before use.
- **Favorites:** per-user server state in `user_preferences` key `module-inserter`, validated with TypeBox by `src/core/persistence/userPreferences.ts` and used by `CanvasNotch`.

The modal uses the tile-card pattern from `docs/design.md`: `--editor-surface` parent, 1px grid gap, `--editor-surface-2` tiles, `--card-radius`, rail-tint accents via `data-accent`, and an achromatic `--editor-focus-ring` selection state. Wireframe image regions reuse `--canvas-placeholder-bg`.

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

- **`src/admin/plugin-host-hooks/`** — React hooks exposed to plugins via `globalThis.__instatic` (set up by `installPluginRuntime()` in `AuthenticatedAdmin`).
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
4. Add a `prewarmedLazy(...)` import in `src/admin/AuthenticatedAdmin.tsx` and append the new page to the `ALL_WORKSPACE_PAGES` array so the idle-callback scheduler pre-warms it after first paint.
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
  - `src/admin/AuthenticatedAdmin.tsx` — post-login shell + prewarmedLazy scheduler
  - `src/admin/lib/prewarmedLazy.ts` — React.lazy alternative with explicit preload + sync fast-path
  - `src/admin/state/adminUi.ts` — cross-shell Zustand store (settings modal, site-import modal, site name/favicon)
  - `src/admin/modals/Settings/SettingsModal.tsx` — settings modal (4 sections: General, Shortcuts, Publishing, Preferences)
  - `src/admin/pages/site/store/slices/settingsSlice.ts` — settings modal state + adminUi bridge
  - `src/admin/state/useSiteSummary.ts` — lightweight site name/favicon fetch for non-editor layouts
  - `src/admin/layouts/AdminPageLayout/AdminPageLayout.tsx` — lightweight non-editor shell
  - `src/admin/layouts/AdminWorkspaceCanvasLayout/AdminWorkspaceCanvasLayout.tsx` — canvas shell for Content/Data/Media
  - `src/admin/router.tsx` — route table
  - `src/admin/lib/routing/` — in-house router
  - `src/admin/pages/site/SitePage.tsx` — Site route mount
  - `src/admin/layouts/AdminCanvasLayout/AdminCanvasEditorBody.tsx` — post-paint editor body
  - `src/admin/pages/site/store/store.ts` — editor store assembly
  - `src/admin/pages/site/store/slices/site/nodeActions.ts` — `mutateActiveTree`
  - `src/admin/pages/site/canvas/CanvasRoot.tsx` — canvas mount
  - `src/admin/spotlight/SpotlightRoot.tsx` — Cmd+K palette
  - `src/admin/pages/site/panels/PropertiesPanel/ClassPicker.tsx` — unified selector picker UI (entry point: pill strip, input, creation flow)
  - `src/admin/pages/site/panels/PropertiesPanel/classPickerUiState.ts` — reducer + action types for the picker's local UI state (`query`, `showSuggestions`, `contextMenu`, `renameTarget`, `highlightedIndex`)
  - `src/admin/pages/site/panels/PropertiesPanel/useClassPickerDerivedState.ts` — hook that derives selector model, suggestions, and keyboard-nav indices from store state; exports `cssAttrSelectorValue`
  - `src/admin/pages/site/panels/PropertiesPanel/ClassPillContextMenu.tsx` — context menu portal for class pill right-click / keyboard-menu actions
  - `src/admin/pages/site/panels/PropertiesPanel/ClassRenameDialog.tsx` — rename dialog for class selectors
  - `src/admin/pages/site/panels/PropertiesPanel/selectorPickerModel.ts` — selector picker derivation model (`deriveSelectorPickerModel`)
  - `src/core/page-tree/styleRule.ts` — selector creation classifier (`classifySelectorCreateInput`) shared by the Properties picker and Selectors panel
  - `src/admin/pages/site/panels/SiteExplorerPanel/SiteExplorerPanel.tsx` — site explorer panel mount
  - `src/admin/pages/site/panels/SiteExplorerPanel/SiteExplorerTreeSection.tsx` — generic tree section renderer used by all explorer categories
  - `src/admin/pages/site/panels/SiteExplorerPanel/siteExplorerModel.ts` — `buildSiteExplorerTreeSection` (placement arrays → typed tree model)
  - `src/admin/pages/site/panels/SiteExplorerPanel/useSiteExplorerDnd.ts` — DnD monitor for explorer organization drag-and-drop
  - `src/admin/pages/site/store/slices/site/explorerActions.ts` — 6 explorer store actions wired to `mutateSite`
  - `src/admin/pages/site/hooks/useInsertInserterItem.ts` — shared `onInsertItem` handler for `ModuleInserterDialog` (toolbar `+` and canvas selection toolbar both use it)
- Gate tests:
  - `src/__tests__/architecture/admin-router-usage.test.ts`
  - `src/__tests__/architecture/admin-startup-imports.test.ts` — pre-auth code must not import the full `@core/persistence` barrel
  - `src/__tests__/architecture/bundle-size-budgets.test.ts` — per-chunk byte budgets (AdminPageLayout, AdminWorkspaceCanvasLayout, SitePage, AdminCanvasEditorBody, ContentPage, …)
  - `src/__tests__/architecture/site-editor-shell-lazy-body.test.ts` — keeps the real Site shell separate from the heavy editor body
  - `src/__tests__/architecture/no-vc-mode-branches-in-mutations.test.ts`
  - `src/__tests__/architecture/centralized-site-mutation-history.test.ts`
  - `src/__tests__/architecture/canvasFastRefreshBoundaries.test.ts`
  - `src/__tests__/architecture/canvas-aware-selectors.test.ts`
  - `src/__tests__/architecture/spotlight-no-direct-store-mutation.test.ts`
  - `src/__tests__/architecture/keybindings-registry-single-source.test.ts`
