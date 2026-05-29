# Server

Deep dive on the server-side of Page Builder CMS — the Bun process, the router, the handlers, the auth model, the DB adapter, and how a request becomes a response.

The server is a single `Bun.serve` process that boots the DB, runs migrations, activates installed plugins, then accepts HTTP requests and dispatches them through an ordered route table. There are no other processes, no message queues, no workers. The runtime entrypoint is `server/index.ts`.

---

## TL;DR

- **Entrypoint:** `server/index.ts` (boots DB → migrations → role sync → plugin activation → `Bun.serve`).
- **Router:** `server/router.ts` — ordered route table, first-match wins. Each route is a `tryServeX(req, runtime, url, pathname)` function returning `Response | null`.
- **CMS API:** every `/admin/api/cms/*` request goes through `server/handlers/cms/index.ts`, which runs a CSRF origin check and dispatches to per-resource handler groups.
- **Auth:** session cookie (`SESSION_COOKIE_NAME`) → `findUserBySessionHash` → `requireCapability(req, db, 'site.read')`. Every state-changing handler starts with one of these guards.
- **DB:** one `DbClient` interface (`server/db/client.ts`) — tagged-template callable returning `{ rows, rowCount }`. Two adapters: `postgres.ts` (via `Bun.sql`) and `sqlite.ts` (via `bun:sqlite`). Selected by `DATABASE_URL`.
- **Repositories** (`server/repositories/`) hold all SQL. Handlers never write SQL directly.
- **Plugins:** `server/plugins/runtime.ts` activates installed plugins at boot; per-plugin code runs in QuickJS-WASM sandboxes (`server/plugins/quickjsHost.ts`, `modulePackVm.ts`).
- **Published pages and content rows** are served by `tryServePublicRoute`, which delegates resolution + render to `server/publish/publicRouter.ts` (live render from the JSON snapshot stored in `data_row_versions.snapshot_json`). Uploads + admin SPA assets are served from disk by `tryServeUpload` and `tryServeStaticAsset`.

---

## Boot sequence

```text
server/index.ts
    │
    ├─→ readServerConfig()                   ← env vars: PORT, DATABASE_URL, UPLOADS_DIR, STATIC_DIR
    │
    ├─→ createDbClient(DATABASE_URL)         ← server/db/index.ts
    │     │
    │     ├─ DATABASE_URL=sqlite:... | file:... | *.db  → createSqliteClient
    │     └─ DATABASE_URL=postgres://...  | postgresql://...  → createPostgresClient
    │
    ├─→ runMigrations(db, migrations)        ← server/db/runMigrations.ts
    │     (selects migrations-pg.ts OR migrations-sqlite.ts based on dialect)
    │
    ├─→ syncSystemRoles(db)                  ← force-resets Owner capabilities every boot
    ├─→ backfillDefaultEntryTemplates(db)    ← ensures every postType table has a default entry tpl
    ├─→ mediaStorageRegistry.configureLocalDisk({ uploadsDir })   ← register local-disk media adapter
    ├─→ activateInstalledServerPlugins(db, uploadsDir)            ← run plugin lifecycle: activate
    │
    └─→ Bun.serve({ fetch: req => handleServerRequest(req, runtime) })
```

Boot is sequential and fail-fast. If migrations fail, the process exits. If a plugin's `activate` throws, the host logs `[plugin:<id>]` and continues — one bad plugin doesn't bring the server down.

---

## Routing

`server/router.ts` exposes one function:

```ts
export async function handleServerRequest(req: Request, runtime: ServerRuntime): Promise<Response>
```

It walks an ordered `routes` array of `RouteHandler` functions. Each handler returns `Response` (it owns the request) or `null` (try the next handler). The first non-null wins. Unknown paths fall through to a `404`.

### The route table

```ts
const routes: readonly RouteHandler[] = [
  tryServeHealth,                  // /health
  tryServeAgent,                   // /admin/api/agent
  tryServeAgentToolResult,         // /admin/api/agent/tool-result
  tryServeCmsApi,                  // /admin/api/cms/*  → handlers/cms/index.ts
  tryServeLoopRuntimeAsset,        // loop runtime asset (CMS-owned)
  tryServeLoop,                    // /_pb/loop/*       → handlers/cms/loop.ts
  tryServeRuntimeAsset,            // /_pb/assets/*     → published runtime assets
  tryServeRuntimePackageNamespace, // /_pb/runtime/cache/<hash>/<...> → bun install workspace
  tryServeSiteCssNamespace,        // /_pb/css/* → hashed CSS bundles
  tryServeMediaRedirect,           // /_pb/media/<adapterId>/<path> → 302 to signed read URL
  tryServeStaticAsset,             // /assets/* → dist/ (admin app)
  tryServeUpload,                  // /uploads/* → uploadsDir (with nosniff hardening)
  tryServeAdminApp,                // /admin/* → dist/index.html (SPA fallback)
  tryServePublicRoute,             // /<slug> OR /<route-base>/<row-slug>
                                   //   → server/publish/publicRouter.ts
                                   //   resolves to page snapshot OR data row + template,
                                   //   live-renders, runs publish.html pipeline
  trySetupRedirect,                // first-run redirect → /admin/setup
]
```

Order matters. Two examples:

- `tryServeCmsApi` is matched **after** `tryServeAgent` and `tryServeAgentToolResult` so the agent endpoints (under `/admin/api/agent*` — not `/admin/api/cms/*`) aren't swallowed by the CMS dispatcher.
- `tryServeUpload` is matched **before** `tryServeAdminApp` because `/uploads/...` is a sub-tree the SPA fallback would otherwise consume.

Adding a new endpoint is a one-line edit to `routes` plus a focused `tryServeX` function.

### Exclusive namespaces

Several handlers own an entire prefix and 404 internally rather than falling through:

- `/_pb/runtime/cache/*` — never falls through to the public-slug renderer
- `/_pb/css/*` — never falls through
- `/_pb/media/*` — never falls through

This prevents an unknown path under a known namespace from accidentally matching a later handler.

### Cross-cutting middleware

`Bun.serve.fetch` in `server/index.ts` wraps every request with:

1. **CORS preflight** — `OPTIONS` returns 204 immediately with `corsHeaders(origin)`. ACAO is only set when the request's `Origin` is in `DEV_ORIGIN_ALLOWLIST` (production is same-origin behind Caddy, so no ACAO is needed).
2. **Socket IP stamping** — `stampSocketIp(req, ...)` writes the actual socket peer address onto the request so downstream `clientIp(req)` returns a real value when there's no `X-Forwarded-For`.
3. **Top-level error catch** — any error that escapes `handleServerRequest` is logged with `console.error('[server] Unhandled request error:', err)` and responded to with a generic `500 Internal server error`. The raw error message is **never** echoed to the client (it can leak SQL fragments, absolute paths, etc.).

`idleTimeout: 0` is set explicitly: the agent endpoint streams NDJSON over Claude's thinking gaps, which can easily exceed Bun's 10s default.

---

## CMS handlers

`/admin/api/cms/*` is handled by `server/handlers/cms/index.ts`. The flow:

1. **CSRF defense in depth.** State-changing methods (`POST/PUT/PATCH/DELETE`) must come from an `Origin` matching the request's own origin or a dev allowlist entry. `SameSite=Lax` already covers most CSRF; this catches the same-site-different-subdomain edge.

2. **Group dispatch.** The handler walks an ordered chain of route-group handlers, each owning a resource:

```ts
const response =
  (await handleSetupRoutes(req, db))
  ?? (await handleAuthRoutes(req, db))
  ?? (await handleMeRoutes(req, db, options))
  ?? (await handleUserPreferencesRoutes(req, db))
  ?? (await handleUsersRoutes(req, db))
  ?? (await handleRolesRoutes(req, db))
  ?? (await handleAuditRoutes(req, db))
  ?? (await handleSiteRoutes(req, db))
  ?? (await handlePagesRoutes(req, db))
  ?? (await handleComponentsRoutes(req, db))
  ?? (await handleRuntimeRoutes(req, db))
  ?? (await handleMediaFolderRoutes(req, db))           // before /media/:id
  ?? (await handleMediaStorageAdminRoutes(req, db, …))  // before /media/:id
  ?? (await handleMediaRoutes(req, db, …))
  ?? (await handlePluginsRoutes(req, db, …))
  ?? (await handleDataRoutes(req, db))
  ?? (await handleDashboardRoutes(req, db))
  ?? (await handleFontsRoutes(req, db, …))
  ?? (await handlePublishRoutes(req, db))
  ?? (await handleExportRoute(req, db, options))
  ?? (await handleImportPreviewRoute(req, db))          // before /import (longer path)
  ?? (await handleImportRoute(req, db, options))
```

Each group module owns its URL matching and returns `Response | null`. The first non-null wins. Order matters — handler order comments in `index.ts` document the load-bearing precedence (e.g. media folder/storage routes must run before `/media/:id` because that pattern would otherwise eat them).

### Handler shape

Every handler module in `server/handlers/cms/` follows the same skeleton:

```ts
export async function handlePagesRoutes(req: Request, db: DbClient): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== `${CMS_API_PREFIX}/pages`) return null

  if (req.method === 'GET') {
    const user = await requireCapability(req, db, 'site.read')
    if (user instanceof Response) return user      // 401 / 403 — return early

    const rows = await listDataRows(db, 'pages')
    return jsonResponse({ rows })
  }

  if (req.method === 'PUT') {
    const user = await requireAnyCapability(req, db, SITE_WRITE_CAPABILITIES)
    if (user instanceof Response) return user

    const body = await readJsonObject(req)
    // … validate body, mutate via repository, return jsonResponse(…)
  }

  return methodNotAllowed()
}
```

Conventions:

- **Match path first**, return `null` on miss so the next group in the chain gets a chance.
- **Require capability second**, return early on auth failure.
- **Validate body third** via TypeBox.
- **Talk to repositories fourth.** Handlers don't write SQL.
- **Return `jsonResponse({ … })` or an error envelope last.**

---

## HTTP helpers

`server/http.ts` owns the small set of cross-handler helpers:

| Helper                           | Purpose                                                              |
|----------------------------------|----------------------------------------------------------------------|
| `jsonResponse(body, init?)`      | Returns a `Response` with `content-type: application/json`           |
| `readJsonObject(req)`            | Reads + validates the body is a JSON **object** (not array / primitive). Returns `{}` on parse failure |
| `methodNotAllowed()`             | `405` with `{ error: 'Method not allowed' }`                         |
| `badRequest(message)`            | `400` with `{ error: message }`                                      |
| `setCookieHeader(res, value)`    | Appends a `Set-Cookie` header                                        |

`readJsonObject` is the canonical body parser: it guarantees callers can safely destructure with no runtime crash. Individual handlers narrow further with their own TypeBox schemas.

**Error envelope.** Every CMS handler error returns `{ error: string }` and is validated client-side by `ErrorEnvelopeSchema` in `src/core/persistence/responseSchemas.ts`. Clients extract the message via `responseErrorMessage(res, fallback)`.

---

## Auth and capabilities

`server/auth/` owns the entire authentication surface.

| File              | Owns                                                                       |
|-------------------|----------------------------------------------------------------------------|
| `tokens.ts`       | Session cookie name, token hashing                                         |
| `sessions.ts`     | Session lookup, MFA gate, step-up timer                                    |
| `authz.ts`        | `requireAuthenticatedUser`, `requireCapability`, `requireAnyCapability`    |
| `capabilities.ts` | `CoreCapability` enum and per-capability membership rules                  |
| `lockout.ts`      | Failed-login lockout policy                                                |
| `mfa.ts`          | TOTP enrollment, verification                                              |
| `rateLimit.ts`    | Token-bucket rate limiters                                                 |
| `security.ts`     | `isStateChangingMethod`, `originAllowed`, `DEV_ORIGIN_ALLOWLIST`, IP stamp |
| `deviceLabel.ts`  | Device-fingerprint label for the sessions panel                            |

### The session flow

```text
Cookie: pb_session=<token>
    │
    ▼
hashSessionToken(token)
    │
    ▼
findUserBySessionHash(db, hash)
    │
    ├─→ no row              → 401 Unauthorized
    ├─→ row but MFA needed  → 401 { error: 'mfa_required' }
    └─→ row OK              → AuthUser { id, email, capabilities, ... }
```

### The capability gate

```ts
const user = await requireCapability(req, db, 'site.read')
if (user instanceof Response) return user   // 401 or 403 already encoded
// ... user is now AuthUser
```

`requireCapability` and `requireAnyCapability` are the only auth surfaces a handler should call. Capabilities are strings like `site.read`, `site.write.pages`, `site.write.components`, `media.manage`, `plugins.install`, etc. Owner accounts get all `CORE_CAPABILITIES` automatically.

### Step-up auth

Sensitive actions (delete user, revoke another device, sign out all devices) require the user to have re-entered their password within the last `STEP_UP_WINDOW_MS` (15 minutes). The expiry lives on the session row as `step_up_expires_at` and is refreshed by `POST /admin/api/cms/auth/step-up`.

---

## Repositories

All SQL lives in `server/repositories/`. Each file owns one resource:

| File                       | Owns                                              |
|----------------------------|---------------------------------------------------|
| `audit.ts`                 | Audit log writes and queries                      |
| `data/`                    | `data_tables` + `data_rows` (the universal store) |
| `fonts.ts`                 | Font assets                                       |
| `loginAttempts.ts`         | Failed-login records for lockout                  |
| `media.ts`                 | Media assets                                      |
| `mediaFolders.ts`          | Folder tree for media                             |
| `mediaMigration.ts`        | Migration of media between storage adapters      |
| `mediaStorageAdapters.ts`  | Registered storage backends                       |
| `pluginSchedules.ts`       | Plugin-registered scheduled jobs                  |
| `plugins.ts`               | Installed plugins + lifecycle state               |
| `publish.ts`               | Published-page roster                             |
| `roles.ts`                 | System and custom roles                           |
| `runtimeAsset.ts`          | Published runtime assets (JS, CSS, fonts)         |
| `sessions.ts`              | User sessions                                     |
| `setup.ts`                 | Setup wizard state (`isSetup`, first-run owner)   |
| `site.ts`                  | The single site shell row                         |
| `userPreferences.ts`       | Per-user editor preferences                       |
| `users.ts`                 | Users + auth fields                               |

### Repository rules

1. **Repositories are dialect-naive.** They use ANSI-standard SQL only. The five Postgres-isms (`now()` in DML, `::int`, `::jsonb`, `any($N::...)`, `distinct on`) are banned in any file that imports `DbClient`. Gated by `db-postgres-isms.test.ts`.

2. **JSON columns end in `_json`.** The SQLite adapter auto-parses `*_json` strings on read and auto-stringifies plain objects on write — so repository code does the same `${jsObject}` interpolation regardless of dialect. Gated by `db-json-column-naming.test.ts`. See [docs/reference/database-dialects.md](reference/database-dialects.md).

3. **Repositories return typed rows.** Use `Row` generics on `db<Row>` calls so handlers don't `as Foo` results.

4. **Repositories validate persisted JSON.** Anything read from a `*_json` column passes through a TypeBox schema (e.g. `validateSite` for the site shell). The DB is not a trusted source — a previous migration or external tool may have written garbage.

5. **Transactions.** `db.transaction(async (tx) => { ... })` wraps a callback in a transaction. The callback receives a `DbClient` that scopes its queries to the transaction. Use it whenever a single request mutates multiple rows that must be consistent (e.g. batch upsert of pages).

---

## The `DbClient` interface

`server/db/client.ts`:

```ts
export type Dialect = 'postgres' | 'sqlite'

export interface DbClient {
  <Row = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<DbResult<Row>>
  unsafe<Row>(sql: string, params?: unknown[]): Promise<DbResult<Row>>
  transaction<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>
  readonly dialect: Dialect
}

export interface DbResult<Row> {
  rows: Row[]
  rowCount: number
}
```

`DbClient` is callable as a tagged template:

```ts
const { rows } = await db<{ id: string }>`select id from users where email = ${email}`
```

Interpolations are bound as parameters in both dialects (`$1, $2, …` on PG; `?` on SQLite). The SQLite adapter additionally converts plain objects and arrays to JSON strings at bind time, so:

```ts
await db`insert into site (id, settings_json) values (${id}, ${settings})`
//                                                             ▲
//                                            JS object becomes JSON in SQLite, JSONB in PG
```

Same code, both engines.

### The two adapters

- **`server/db/postgres.ts`** wraps `Bun.sql` (native Bun Postgres client).
- **`server/db/sqlite.ts`** wraps `bun:sqlite`, with three custom behaviors:
  1. `toBindable(value)` converts JS values (objects, dates, booleans, `Uint8Array`) to SQLite-bindable types.
  2. On read, any column ending in `_json` whose value is a non-empty string is auto-`JSON.parse`d.
  3. On boot, PRAGMAs are set: `journal_mode = WAL`, `foreign_keys = ON`, `synchronous = NORMAL`, `busy_timeout = 5000`.

Both adapters return the same `DbResult<Row>` shape, so callers never branch on dialect.

### Migrations

`server/db/migrations-pg.ts` and `server/db/migrations-sqlite.ts` hold the per-dialect migration list. Each migration is `{ id, label, statements: string[] }`. The two lists must have **identical IDs in the same order** — gated by `migration-parity.test.ts`. The PG version uses `jsonb`, `timestamptz`, `bigint`, `boolean`, `distinct on`; the SQLite version uses `text`, `text`, `integer`, `integer`, and window-function rewrites.

`server/db/runMigrations.ts` runs the migrations idempotently at boot, tracking applied IDs in a `_migrations` table.

See [docs/reference/database-dialects.md](reference/database-dialects.md) for the full rules.

---

## Publishing pipeline

Three-layer model: **static-by-default, dynamic-by-auto-detection**.

- **Layer A — static-to-disk.** **Every** page is baked at publish time. A fully-static page (no dynamic modules, no request-dependent bindings/loop sources, no VC refs to dynamic VCs) bakes a complete document; a page with dynamic nodes bakes its static **shell** with `<pb-hole>` placeholders (the dynamic nodes are Layer C holes). HTML is written to `uploads/published/current/<route>.html`, and the CSS bundles (`/_pb/css/…`) and runtime JS (`/_pb/assets/…`) are baked into the same slot. The visitor router reads all of these directly off disk (`readArtefact` / `readStaticAsset`) — **a published page never touches the DB for HTML, CSS, or JS.** TTFB ≤ 1.5 ms.
- **Layer B — in-memory LRU.** Requests that vary by query string (loops with `?page=N`, request-dependent bindings) bypass the disk fast-path and render live, memoised by `(urlPath, queryString, publishVersion)`. Single-flight. Every publish bumps `publishVersion` so the entire cache evicts lazily.
- **Layer C — server islands ("holes").** When `findDynamicNodeIds(...)` classifies a node as dynamic (module flagged `dynamic: true`, or its bindings/loop source declare `requestDependent: true`, or it's a VC ref to a dynamic VC), the publisher emits a `<pb-hole>` placeholder with an optional `staticPlaceholder(props)` skeleton. A ~668 B `IntersectionObserver` runtime fetches `/_pb/hole/<nodeId>?v=<publishVersion>` lazily as the placeholder enters the viewport. **The hole fragment is the only request that reads the DB for an otherwise-static page.** Hole responses are cached via Layer B's LRU.

Authors don't toggle anything. `src/core/publisher/dynamicDetection.ts:findDynamicNodesWithReasons` is the single walker that powers Layer A's shell-vs-complete bake, Layer C's placeholder emission, and the diagnostic `staticReasons` helper. The rules live in exactly one file.

```text
                            on publish
                                ↓
            publishDraftSite / publishDataRow
                                │
              ├── write PublishedPageSnapshot → data_row_versions.snapshot_json
              ├── bake CSS bundles + runtime JS → writeStaticAsset(inactiveSlot)
              ├── for each page (complete doc, or static shell with <pb-hole>):
              │     publishPage + applyPublishedHtmlPipeline
              │     writeArtefact(inactiveSlot, urlPath, html)
              ├── swapSlot — atomic symlink rename of uploads/published/current
              └── bumpPublishVersion() — Layer B cache evicts lazily

                          on visitor request
                                ↓
            server/router.ts → tryServePublicRoute
                                ↓
                  renderPublicResolution(db, url, uploadsDir)
                                │
       ┌────────────────────────┼────────────────────────────┐
       ▼                        ▼                            ▼
  Layer A disk           resolvePublicRoute             (page contains holes)
  readArtefact            page / row / redirect          /_pb/hole/<id>?v=<ver>
  (only if no ?           / not-found                    handled by
  query string)                  │                       server/handlers/cms/hole.ts
       │                  ┌──────┴───────┐                     │
   hit → stream    redirect → 301  page/row → Layer B          ▼
                                          getOrRender         render one node
                                          (LRU + single-      cached in Layer B
                                           flight + version)
```

Server-side publishing helpers live in `server/publish/`:

| File                              | Role                                                                |
|-----------------------------------|---------------------------------------------------------------------|
| `publicRouter.ts`                 | Visitor URL → resolution → Response. Composes Layer A disk-read + Layer B cache. Single entry for every visitor HTML request. |
| `staticArtefact.ts`               | Layer A. Two-slot symlink swap (`current → slot-{a,b}`), atomic per-file `tmp + rename`, slot-aware read/write/purge. |
| `renderCache.ts`                  | Layer B. Bounded LRU keyed by `(urlPath, queryString, publishVersion)`. Single-flight on cache miss. `bumpPublishVersion()` invalidates. |
| `holeRuntime.ts`                  | Layer C client-side runtime (~668 B). Exported as `HOLE_RUNTIME_JS`. |
| `publicRenderer.ts`               | `renderPublishedSnapshot`, `renderPublishedDataRowTemplate` — snapshot-aware wrappers around `publishPage`. |
| `publishedHtmlPipeline.ts`        | Plugin frontend-asset injection + `publish.html` filter chain. Runs at publish time for every baked page (complete doc or hole shell); also runs in the Layer B factory for query-string / live renders (cached). |
| `siteCssBundle.ts`                | Per-site reset / framework / style CSS bundles (hashed filenames).  |
| `republish.ts`                    | Bulk re-publish (after a settings change touches all pages).        |
| `publishScheduler.ts`             | Scheduled publish jobs.                                             |
| `frontendInjections.ts`           | Plugin-contributed frontend scripts injected into published HTML.   |
| `mediaPresentation.ts`            | `<picture>` / `<img srcset>` materialization at publish time.       |
| `mediaPrefetch.ts`, `loopPrefetch.ts` | Pre-warm caches needed by published pages.                      |
| `runtime/packageServer.ts`        | Serve per-site `bun install` workspace under `/_pb/runtime/cache/`. |

Plus the hole endpoint at `server/handlers/cms/hole.ts` — registered in the router BEFORE `tryServePublicRoute` so `/_pb/hole/*` requests never fall through to slug resolution.

Published pages are HTML + a single hashed CSS bundle per page. The ONLY first-party client script is the Layer C hole runtime, and it's injected ONLY on pages that contain at least one `<pb-hole>`. Fully-static pages ship zero JS from us. Plugins can inject frontend assets explicitly via `frontendInjections.ts`.

For the full design spec including invariants, atomic-publish protocol, and the auto-detection rules, see [docs/superpowers/plans/2026-05-25-publishing-architecture.md](superpowers/plans/2026-05-25-publishing-architecture.md).

---

## Plugin runtime

Plugins ship as zip packages with a `plugin.json` manifest. The host:

1. **Installs** the package (unzips into `uploads/plugins/<id>/<version>/`) — `server/plugins/package.ts`.
2. **Validates** the manifest and scans the bundled JS for forbidden sandbox-incompatible patterns — `assertSandboxSafe` in `package.ts` + `parsePluginManifest` in `src/core/plugins/manifest.ts`.
3. **Activates** the plugin at boot or on user action — `server/plugins/runtime.ts`. Activation loads the server entrypoint into a per-plugin QuickJS-WASM VM (`server/plugins/quickjsHost.ts`) and runs its `activate(api)` lifecycle hook.
4. **Routes** plugin-registered HTTP routes through `/admin/api/cms/plugins/<id>/runtime/…` (handled by `handleRuntimeRoutes`).
5. **Brokers** the SDK boundary — `api.cms.routes.*`, `api.cms.storage.*`, `api.cms.hooks.*`, `api.cms.loops.*`, `api.cms.settings.*`, `api.cms.schedule.*`. The SDK shape is defined in `src/core/plugin-sdk/`.

The sandbox has **no host access** — no Node, no Bun, no file system, no env vars, no network unless `network.outbound` permission + `networkAllowedHosts` allowlist is granted.

Sandbox invariants are gated by `src/__tests__/architecture/plugin-sandbox-invariants.test.ts`. Module-pack VMs (canvas-side plugin modules) run in `modulePackVm.ts`.

See [docs/features/plugin-system.md](features/plugin-system.md) for the full feature doc.

---

## Static serving

Three static handlers, in order:

| Handler                | Owns                                                                  |
|------------------------|-----------------------------------------------------------------------|
| `tryServeStaticAsset`  | `/assets/*` from `dist/` (Vite-built admin SPA assets)                |
| `tryServeUpload`       | `/uploads/*` from `uploadsDir` with `hardenUploadResponse` (nosniff, attachment for non-inert MIMEs, CORS for plugin bundles) |
| `tryServeAdminApp`     | `/admin/*` falls back to `dist/index.html` for the SPA                |

`server/static.ts` owns all three. Key behaviors:

- **Range requests** are honored for media (`Range: bytes=...`).
- **Conditional GET** via `If-None-Match` / `If-Modified-Since` is honored.
- **MIME-type allowlist** (`INERT_UPLOAD_MIMES`) — non-allowlisted uploads get `Content-Disposition: attachment` so they can't be top-level navigated and rendered as HTML on the admin origin.
- **Plugin bundles** (`/uploads/plugins/*`) get `Access-Control-Allow-Origin: *` because the editor preview iframe loads them from an opaque origin (`sandbox="allow-scripts"` without `allow-same-origin`).

---

## Adding a new endpoint

1. **Pick the right layer.**
   - CMS resource (e.g. `/admin/api/cms/feature`) → new handler file in `server/handlers/cms/feature.ts`, register in `server/handlers/cms/index.ts`.
   - Top-level (e.g. `/_pb/something`) → new `tryServeX` in `server/router.ts`, add to the `routes` array in the right order.

2. **Write the handler.** Match path → require capability → validate body → call repository → return `jsonResponse`.

3. **If new SQL is needed,** add the function to the matching `server/repositories/<resource>.ts`. Do not write SQL inside the handler.

4. **If new persisted shape is involved,** add the migration to both `migrations-pg.ts` and `migrations-sqlite.ts` with the same ID. JSON columns end in `_json`. Run `bun test src/__tests__/architecture/migration-parity.test.ts` and `db-json-column-naming.test.ts` to confirm.

5. **If client-side calls the endpoint,** add a TypeBox response schema in `src/core/persistence/responseSchemas.ts` and read via `readEnvelope` or `parseJsonResponse`.

---

## Adding a new repository

1. Create `server/repositories/<resource>.ts`. Export typed functions: `listX`, `getX(id)`, `createX(...)`, `updateX(id, patch)`, `deleteX(id)`.
2. Use ANSI-standard SQL only. No Postgres-isms.
3. JSON columns must end in `_json`. Interpolate plain JS objects via `${obj}` — both adapters handle the conversion.
4. Use `db.transaction(async (tx) => ...)` for multi-row writes that must be atomic.
5. Validate any JSON read from disk with a TypeBox schema before returning it.

---

## Error handling

- **Server logs** use the prefix `console.error('[<module>]', err)` — e.g. `'[router] adapter "<id>" getReadUrl failed:'`, `'[server] Unhandled request error:'`.
- **Domain errors** are typed `Error` subclasses with a `path` (or similar) field — e.g. `SiteValidationError`, `VisualComponentNameError`. Add a typed class when callers need to distinguish causes.
- **Generic `throw new Error(...)`** is fine for "this should never happen" invariants.
- **Never echo raw error messages to the client.** The top-level catch in `server/index.ts` returns a generic 500. Handlers return `{ error: <safe message> }`.

See [docs/reference/typebox-patterns.md](reference/typebox-patterns.md) for boundary validation patterns.

---

## Related

- [docs/architecture.md](architecture.md) — system overview
- [docs/editor.md](editor.md) — what the admin / editor frontends do
- [docs/features/plugin-system.md](features/plugin-system.md) — plugin runtime details
- [docs/reference/database-dialects.md](reference/database-dialects.md) — PG vs SQLite rules
- [docs/reference/typebox-patterns.md](reference/typebox-patterns.md) — boundary validation
- Source-of-truth files:
  - `server/index.ts` — entrypoint and boot
  - `server/router.ts` — request dispatch
  - `server/http.ts` — HTTP helpers
  - `server/handlers/cms/index.ts` — CMS dispatcher
  - `server/auth/authz.ts` — `requireCapability` and friends
  - `server/db/client.ts` — `DbClient` interface
  - `server/db/index.ts` — adapter selection
  - `server/db/postgres.ts`, `server/db/sqlite.ts` — adapters
  - `server/db/migrations-pg.ts`, `server/db/migrations-sqlite.ts` — schemas
- Gate tests:
  - `src/__tests__/architecture/db-postgres-isms.test.ts`
  - `src/__tests__/architecture/db-json-column-naming.test.ts`
  - `src/__tests__/architecture/migration-parity.test.ts`
  - `src/__tests__/architecture/agent-endpoint-auth.test.ts`
  - `src/__tests__/architecture/no-anthropic-sdk.test.ts`
  - `src/__tests__/architecture/plugin-sandbox-invariants.test.ts`
