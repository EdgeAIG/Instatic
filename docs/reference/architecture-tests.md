# Architecture Tests

Catalog of every test in `src/__tests__/architecture/`. These are structural gates — they run as part of `bun test` and fail the build when a rule is broken. When *your* change drifts a structural rule, fix the matching test in the **same** change.

---

## TL;DR

- 83 tests across structural domains: SQL, JSON columns, migrations, CSS, icons, primitives, page tree, sandbox, agent, router, content storage, boundary validation, module size, etc.
- Naming convention: `<topic>.test.ts` (kebab-case) or `<group>-<topic>.test.ts`. A few legacy `task<N>-*` ids still exist when they guard live invariants; new gates should use topic names.
- Run them all: `bun test src/__tests__/architecture/`.
- Most are **import / source scans** — they parse the files in scope and assert / reject patterns. Some are unit-style (a small in-test database, a synthesized page tree).

---

## Catalog by domain

### Barrel imports

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `no-core-barrel-deep-imports.test.ts`         | External callers import through the barrel (`@core/page-tree`, `@core/module-engine`, `@core/visualComponents`, `@core/publisher`), never through a concrete internal path (`@core/<module>/<file>`). Files inside a module are exempt — they use relative paths. |

See [CLAUDE.md → Barrel imports](../../CLAUDE.md) and [docs/reference/page-tree.md](page-tree.md).

### Database — schema and dialect

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `db-postgres-isms.test.ts`                    | Files that import `DbClient` use only ANSI SQL. Blocks `now()` in DML, `::int`, `::jsonb`, `any($N::...)`, `distinct on`. |
| `db-json-column-naming.test.ts`               | Every `jsonb` PG column has a name ending in `_json`. Same column appears in SQLite migrations as `text`. |
| `migration-parity.test.ts`                    | `migrations-pg.ts` and `migrations-sqlite.ts` have identical migration IDs in the same order. |
| `json-extract-egress.test.ts`                 | `JSON.parse` of stored data goes through a TypeBox boundary helper.              |

See [docs/reference/database-dialects.md](database-dialects.md).

### Content storage

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `data-tables-system-flag.test.ts`             | System tables (`posts`, `pages`, `components`) are seeded with `system: true`.    |
| `no-legacy-content-domain.test.ts`            | The `content_*` tables / handlers don't return. Everything lives in `data_*`.    |
| `no-legacy-pages-table.test.ts`               | No `pages` or `page_versions` tables in migrations.                              |

### Page tree

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `task455-tree-primitive.test.ts`              | The `Tree*` primitive lives at `src/admin/pages/site/ui/Tree/` and exports `TreeContainer`, `TreeRow`, `TreeChevron`, `TreeIconSlot`, `TreeLabel`. DOM panel and Site Explorer both import from `@site/ui/Tree` and render `<TreeContainer>` / `<TreeRow>`. Site Explorer renders via `SiteExplorerTreeSection` and stays concept-oriented (no `src/pages/` paths, no `window.prompt`). |
| `no-vc-mode-branches-in-mutations.test.ts`    | The 11 store actions don't branch on `kind === 'visualComponent'`. Routing happens in `mutateActiveTree`. |
| `visual-components-mutation-contract.test.ts` | VC tree mutations preserve the slot-instance / slot-outlet invariants.           |
| `centralized-site-mutation-history.test.ts`   | Every mutation flows through one entry-point so undo / redo stays consistent.    |
| `no-vc-in-site-shell.test.ts`                 | `SiteShellSchema` does not declare `visualComponents` / `pages`. They live in `data_rows`. |
| `multiWrapDefaults.test.ts`                   | `wrapNodes` applies defaults uniformly across the wrapped set.                  |

See [docs/reference/page-tree.md](page-tree.md), [docs/features/visual-components.md](../features/visual-components.md).

### Validation / TypeBox

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `boundary-validation.test.ts`                 | Four HTTP / JSON-parse boundary rules: (1) no `res.json() as` in persistence or admin — use `apiRequest` or `readEnvelope`; (2) no `JSON.parse(...) as` in `src/core/persistence/`; (3) no raw `fetch(` in `src/admin/` outside the allowlist (streaming NDJSON, SVG bytes, and FormData multipart uploads are listed with `§3.x` justifications); (4) no `req.json(` in server handlers outside `server/http.ts`. |
| `no-anthropic-sdk.test.ts`                    | No imports of `@anthropic-ai/sdk`. Use `@anthropic-ai/claude-agent-sdk`. Also: no `zod` imports outside `server/handlers/agent/tools.ts`. |
| `storage-list-envelope.test.ts`               | Storage list endpoints return the typed envelope shape.                         |
| `binding-compatibility-coverage.test.ts`      | All endpoint bindings have client-side schemas defined.                          |

See [docs/reference/typebox-patterns.md](typebox-patterns.md).

### CSS / design system

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `css-token-policy.test.ts`                    | CSS Modules under `src/admin/`, `src/admin/pages/site/`, `src/ui/` use only token vars — no raw hex / rgb / hsl. |
| `no-css-var-fallbacks.test.ts`                | `var(--x, fallback)` is banned — every token must exist; fallbacks hide drift.   |
| `noTailwindUtilities.test.ts`                 | No Tailwind utility class strings in `className=` in `src/admin/`, `src/modules/`, `src/ui/`. |
| `no-tailwind-deps.test.ts`                    | No imports of `clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/*`, `tailwindcss`. No `@tailwind` / `@apply` directives. |
| `scrollbar-chrome.test.ts`                    | Scrollbar tokens declared in `globals.css`; both Firefox (`scrollbar-color`) and WebKit/Blink (`::-webkit-scrollbar`) styled with those tokens; `StyleSurface.module.css` uses `scrollbar-gutter: stable` to keep the properties rail clear of overlaying scrollbars. |

See [docs/design.md](../design.md), [docs/reference/design-tokens.md](design-tokens.md).

### UI primitives

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `button-primitive-usage.test.ts`              | Bare `<button>` in `src/admin/` goes through the allowlist (with §8 justifications). |
| `ui-primitives-location.test.ts`              | Primitives live in `src/ui/components/<Name>/`. Don't scatter them.              |
| `no-native-browser-dialogs.test.ts`           | No `alert()`, `confirm()`, `prompt()`. Use `Dialog` / Toast.                     |
| `no-native-title-tooltips.test.ts`            | No `title=` for hover hints. Use `<Tooltip>`.                                    |
| `no-third-party-icons.test.ts`                | No `lucide-react`, `heroicons`, etc. Only `pixel-art-icons`.                     |
| `direct-icon-imports.test.ts`                 | Icons imported deep (`pixel-art-icons/icons/<name>`), not from the package root. |
| `vendor-icons-fresh.test.ts`                  | The vendored icon set is up-to-date (run `bun run icons:sync`).                  |
| `icon-catalog-integrity.test.ts`              | Every icon import resolves; the vendored package's index is consistent.          |
| `close-icon-correctness.test.ts`              | Close affordances use the standard close icon glyph.                             |

See [docs/reference/ui-primitives.md](ui-primitives.md).

### Editor / canvas

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `admin-feature-folders.test.ts`               | `src/admin/pages/<workspace>/` workspaces own their own panels / hooks / utils.  |
| `canvasFastRefreshBoundaries.test.ts`         | `.tsx` files don't mix component + non-component exports (breaks HMR).           |
| `canvas-aware-selectors.test.ts`              | Canvas-related store selectors are subscribed correctly to canvas-state slices.  |
| `admin-router-usage.test.ts`                  | Internal admin navigation uses `@admin/lib/routing`; raw `/admin` anchors and `react-router-dom` are banned. |
| `framework-typography-spacing.test.ts`        | The site framework's typography / spacing tokens compile correctly.              |
| `task414-wrap-to-container.test.ts`           | Wrap-to-container action creates defaulted wrappers and preserves tree structure. |
| `task427-preview-class-css.test.ts`           | Preview-class CSS injection matches publisher output.                            |
| `error-boundary-coverage.test.ts`             | Every workspace page / major surface is wrapped in an `ErrorBoundary` with a unique `location` tag. |

See [docs/editor.md](../editor.md).

### Spotlight

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `spotlight-no-direct-store-mutation.test.ts`  | Providers / scopes don't mutate the editor store. Mutations live in commands.    |
| `keybindings-registry-single-source.test.ts`  | Every global keyboard shortcut goes through the keybinding registry.             |

See [docs/features/spotlight.md](../features/spotlight.md).

### Plugin system

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `plugin-sandbox-invariants.test.ts`           | No `node:`, `bun:`, `require(`, `process.binding` in plugin bundles. Sandbox-safe assertions.|
| `plugin-boot-resilience.test.ts`              | One bad plugin doesn't bring the server down. Crashes are isolated.              |
| `plugin-cms-pages-surface.test.ts`            | `cms.pages.{read,publish}` is wired across all 4 sync-points (permissions, capabilities, builders, docs). |
| `plugin-host-ui-runtime-parity.test.ts`       | Plugin host UI surfaces match the SDK's declared shape.                          |
| `plugin-schedule-invariants.test.ts`          | Scheduled job cadence + overlap policy validate at registration.                 |
| `sandbox-crypto-bridge.test.ts`               | Plugin sandbox's crypto surface is bridged correctly (`subtle.digest`, etc.).    |
| `no-plugin-tab-shells.test.ts`                | Plugin-mounted admin pages render in the canvas-style admin layout, not separate tabs. |

See [docs/features/plugin-system.md](../features/plugin-system.md).

### Agent

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `agent-endpoint-auth.test.ts`                 | `/admin/api/agent*` endpoints carry `DbClient` and run the auth checks inline.   |
| `agent-sdk-integration.test.ts`               | The Claude Agent SDK is imported correctly; no leakage of internal types.        |
| `task381-agent-panel-tab.test.ts`             | Agent Panel mounts at the right rail position with the right tint.               |
| `task390-agent-config.test.ts`                | Agent config (model, system prompt) stays under user control.                    |

See [docs/features/agent.md](../features/agent.md).

### Media

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `media-migration-invariants.test.ts`          | Migrating an asset between adapters preserves all variants and references.       |
| `media-presentation-pipeline.test.ts`         | Publisher's `<picture>` / `srcset` materialization is correct.                   |
| `media-signed-redirect-serving.test.ts`       | `/_pb/media/<adapterId>/<storagePath>` redirects with a fresh signed URL.        |
| `media-storage-no-bytes-in-sandbox.test.ts`   | Plugin sandboxes can't read raw media bytes; only host adapters can.             |
| `media-storage-panel.test.ts`                 | Media storage panel UI matches the registered adapter set.                       |

See [docs/features/media.md](../features/media.md).

### Publisher

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `dispatcher-html-pipeline.test.ts`            | The publisher's HTML pipeline (sanitize → plugin filters → injections) runs in order. |
| `publish-html-filter-context.test.ts`         | Plugin `publish.html` filters receive the right context shape.                   |
| `static-artefact-served-before-render.test.ts`| `publicRouter.ts` calls `readArtefact` BEFORE `resolvePublicRoute` so the Layer A disk fast-path always wins for canonical URLs (no query string). |
| `publish-bumps-cache-version.test.ts`         | Every publish / unpublish entry point (`publishDraftSite`, `publishDataRow`, `updateDataRowStatus`) calls `bumpPublishVersion()` from `renderCache.ts` so Layer B evicts on every state change visitors can see. |
| `hole-runtime-asset-route.test.ts`            | The router registers `tryServeHoleRuntimeAsset` and `tryServeHole` BEFORE `tryServePublicRoute`. The `/_pb/hole/*` namespace can never fall through to slug resolution. |

See [docs/features/publisher.md](../features/publisher.md) and [docs/superpowers/plans/2026-05-25-publishing-architecture.md](../superpowers/plans/2026-05-25-publishing-architecture.md).

### Site transfer (export / import)

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `cmsTransferExport.test.ts`                   | Export produces a valid `SiteBundle`.                                            |
| `cmsTransferPreview.test.ts`                  | Preview matches what apply would do (no drift).                                  |
| `cmsTransferImport.test.ts`                   | Importing a bundle yields a site equivalent to the source.                       |
| `import-export-roundtrip.test.ts`             | Full round-trip parity: export → import → re-export = original.                  |
| `selfHostedCmsExportRemoval.test.ts`          | Self-hosted-CMS-removal artifacts don't leak into bundles.                       |

See [docs/features/site-transfer.md](../features/site-transfer.md).

### Loop sources

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `loop-source-id-format.test.ts`               | Loop source ids are namespaced lowercase (`base.x`, `acme.y`).                  |
| `loop-source-sql-safety.test.ts`              | Built-in loop sources don't issue dialect-specific or unsanitized SQL.           |

### Bundle / performance

| Test                                          | What it enforces                                                                 |
|-----------------------------------------------|----------------------------------------------------------------------------------|
| `admin-startup-imports.test.ts`               | Pre-auth code (`src/admin/preauth/`) does not import `@core/persistence` barrel — only narrow auth/boot entrypoints. Keeps the login-screen chunk free of data/media/plugin clients. |
| `bundle-size-budgets.test.ts`                 | Per-chunk byte budgets after `bun run build`. Enforces that key chunks (AdminPageLayout, AdminWorkspaceCanvasLayout, SitePage, ContentPage, CodeMirrorEditor, …) stay within their measured caps. |
| `module-size-budgets.test.ts`                 | Per-module line-count cap. No new source module over 700 lines; a grandfathered ledger of existing god-files is frozen and ratchets down only. Source-side sibling of `bundle-size-budgets`. |
| `codemirror-lazy-only.test.ts`                | CodeMirror is loaded only via `lazy()` — it's heavy and shouldn't be in the entry bundle. |
| `singleInstallManagedHosting.test.ts`         | Single-install assumptions hold across the codebase (no multi-tenant leakage).   |

## Anatomy of an architecture test

Most tests follow one of three shapes.

### Source-scan

Walks files under a root, applies a regex, asserts no matches (or specific matches):

```ts
import { readFileSync } from 'fs'
import { describe, it, expect } from 'bun:test'

describe('No `as Foo` at JSON boundaries', () => {
  it('every JSON.parse goes through a TypeBox schema', () => {
    const offenders: string[] = []
    for (const file of walk('src/')) {
      const src = readFileSync(file, 'utf8')
      if (/JSON\.parse\([^)]*\)\s+as\s+/.test(src)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })
})
```

### Schema check

Reads a typed manifest (e.g. `pgMigrations`) and asserts shape:

```ts
import { pgMigrations } from '../../../server/db/migrations-pg'
import { sqliteMigrations } from '../../../server/db/migrations-sqlite'

it('migration IDs match across dialects', () => {
  const pgIds     = pgMigrations.map((m) => m.id)
  const sqliteIds = sqliteMigrations.map((m) => m.id)
  expect(sqliteIds).toEqual(pgIds)
})
```

### Integration-style

Spins up a small in-memory SQLite, runs migrations, exercises a code path, asserts:

```ts
const db = createSqliteClient(':memory:')
await runMigrations(db, sqliteMigrations)
await createDataRow(db, ...)
const rows = await listDataRows(db, 'posts')
expect(rows).toHaveLength(1)
```

---

## When to add a new gate

Add an architecture test when:

- A structural invariant is easy to violate accidentally (e.g. "all icons come from `pixel-art-icons`").
- A naming convention is load-bearing (e.g. JSON columns end in `_json` because the SQLite adapter auto-parses them).
- A directory boundary needs enforcement (e.g. "no `react-router-dom` in admin code").
- A new permission / capability / event kind needs all sync-points wired (e.g. `cms.pages.read` exists in 4 places).

Don't add a gate for:

- One-off correctness checks — those are unit tests under `src/__tests__/<topic>/`.
- Style preferences without a load-bearing reason — code review catches those.
- "Future-proofing" without a current risk — gates have a maintenance cost.

### Naming the new gate

- Use kebab-case, topic first: `<topic>.test.ts` or `<group>-<topic>.test.ts`.
- Avoid `task<N>` / `phase<N>` / `guideline<N>` unless you genuinely tracking a multi-PR refactor mid-flight (and rename when the refactor lands).
- Keep file names short — agents grep these. `db-postgres-isms.test.ts` is good. `database-dialect-mismatch-detector-no-postgresisms.test.ts` is bad.

---

## When you break a gate

The build fails with a specific message and a list of offending files / lines. Two cases:

1. **The gate is right, your change is wrong.** Fix your change.
2. **Your change is the new architecture; the gate is the old one.** Update the gate. Per CLAUDE.md: "when *your* change drifts a structural rule, fix the rule's gate test in the same change." Don't commit a gate-broken state.

---

## Related

- `CLAUDE.md` — the rule book (mentions architecture gates as first-class)
- [docs/architecture.md](../architecture.md) — system-level invariants
- [docs/CONVENTIONS.md](../CONVENTIONS.md) — when a doc claim should link a gate
- Source root: `src/__tests__/architecture/`
