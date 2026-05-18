# Page Builder CMS

## What this project is

A self-hosted, open-source CMS with a built-in visual page builder and a first-class plugin system. It is designed to compete directly with WordPress: easier to use, dramatically faster, and shipping clean HTML/CSS rather than bloated runtime markup.

The product is **self-hosted only**: anyone can clone the repo, run it on their own server, and own their data. There is no managed/hosted offering and the codebase should not carry assumptions about multi-tenant SaaS operation. (If a managed offering ever happens in the future, it will run the same self-hosted stack behind the scenes — the architecture does not branch on deployment mode.)

The whole stack runs from a single Bun server backed by either Postgres or SQLite (selected by `DATABASE_URL`). One process serves the public website, the admin editor, the CMS API, published pages, and uploaded media. The output of the page builder is intentionally plain, semantic HTML with hand-clean CSS — no framework runtimes injected into published pages, no client-side hydration of layout, no garbage.

### Stack at a glance

- **Runtime:** Bun (server + tooling). We use Bun, not Node.
- **Language:** TypeScript everywhere.
- **Frontend:** React 19 + Vite, Zustand + Immer for state, CodeMirror for code-editing UI, `@dnd-kit/core` for drag-and-drop.
- **Server:** `Bun.serve` with a custom router (`server/router.ts`) and CMS modules split across `server/{repositories,handlers/cms,auth,plugins,publish}/`.
- **Database:** Postgres (via `Bun.sql` — the native Bun client) OR SQLite (`bun:sqlite`), selected by `DATABASE_URL`. Adapters at `server/db/postgres.ts` and `server/db/sqlite.ts`, sharing the `DbClient` interface in `server/db/client.ts`. Migrations in `server/db/migrations-pg.ts` and `server/db/migrations-sqlite.ts` (identical IDs, dialect-translated DDL).
- **Validation:** [TypeBox](https://github.com/sinclairzx81/typebox) (`@sinclair/typebox`) at every untyped boundary (HTTP responses, request bodies, `JSON.parse` of persisted data, plugin manifests, settings). Helpers in `src/core/utils/typeboxHelpers.ts` (`Type`, `Value`, `Static`, `withFallback`, `parseValue`, `parseValueOrFallback`, `safeParseValue`, `parseWithFallbackAnnotation`, `filterArray`, `formatValueErrors`). Boundary helpers `src/core/utils/jsonValidate.ts` (`safeParseJson`, `parseJsonWithFallback`, `parseJsonResponse`) and `src/core/persistence/httpJson.ts` (`readEnvelope`). Response schemas in `src/core/persistence/responseSchemas.ts`. **Schemas are the source of truth — types are `Static<typeof Schema>`.** **`zod` is banned from app/core code; the only legitimate zod use is `server/agentTools.ts`** because `@anthropic-ai/claude-agent-sdk`'s `tool()` API has a type-level `AnyZodRawShape` constraint.
- **Sanitization:** DOMPurify at the publisher boundary for rich-text and HTML strings (`src/core/sanitize.ts`).
- **Plugins:** Zip packages with a `plugin.json` manifest, lifecycle hooks (`install`, `activate`, `deactivate`, `uninstall`). SDK at `src/core/plugin-sdk/`, runtime at `src/core/plugins/`. **Server entrypoints and canvas module packs run inside a QuickJS-WASM sandbox** (`server/plugins/quickjsHost.ts` for `entrypoints.server`, `server/plugins/modulePackVm.ts` for `entrypoints.modules`) — no Node/Bun ambient access, network is gated behind `network.outbound` permission + `networkAllowedHosts` allowlist. The SDK build (`bun pb-plugin build`) emits IIFE bundles that assign to `globalThis.__plugin_exports` / `globalThis.__module_pack` and scans for forbidden literals (`'node:'`, `'bun:'`, `require(`, `process.binding`); the install handler scans again as defense-in-depth (`server/plugins/package.ts` → `assertSandboxSafe`). Sandbox invariants are locked in by `src/__tests__/architecture/plugin-sandbox-invariants.test.ts`. Plugin author docs at `docs/plugins/sandbox.md`.
- **Routing:** Tiny in-house router at `src/admin/lib/router.tsx` (components: `Router`, `MemoryRouter`, `Routes`, `Route`, `Navigate`, `Link`) and `src/admin/lib/routerHooks.ts` (hooks: `useLocation`, `useNavigate`, `useParams`, `useInRouterContext`). Replaces `react-router-dom` for the 4-route admin app — the dep is removed from `package.json`. Admin-only — banned in `src/editor/`, `src/core/`, `src/modules/` and gated by `no-router-in-editor.test.ts`. The `.tsx`/`.ts` split is required for React Fast Refresh (mixing component and non-component exports breaks HMR).
- **Icons:** `pixel-art-icons` is a private, premium upstream catalog (~4,053 icons) developed as a sibling project (`../pixel-art-icons`). The CMS does **not** depend on the private repo at install time. Instead, only the icons actually imported by the CMS are vendored as a self-contained npm-shaped package at `vendor/pixel-art-icons/`, wired in via `"pixel-art-icons": "file:./vendor/pixel-art-icons"`. Imports use `pixel-art-icons/icons/<name>` (one TSX component per icon, tree-shakeable). No `lucide-react`, no inline SVG strings — gated by `no-third-party-icons.test.ts` and `direct-icon-imports.test.ts`. The vendored set is regenerated by `bun run icons:sync` (which copies sources from the sibling checkout and rebuilds `vendor/pixel-art-icons/dist/`) and gated for freshness by `vendor-icons-fresh.test.ts`. Adding a new icon: import it normally, then run `bun run icons:sync` (requires the sibling `../pixel-art-icons` checkout, or set `PIXEL_ART_ICONS_SRC`).
- **Agent:** `@anthropic-ai/claude-agent-sdk`. The plain `@anthropic-ai/sdk` is banned and gated by `no-anthropic-sdk.test.ts`.
- **Tree primitive:** Every tree-of-nodes in the CMS — page trees and Visual Component trees alike — uses one shape: `NodeTree<TNode> = { nodes: Record<string, TNode>, rootNodeId: string }`. The type lives in `src/core/page-tree/treeSchema.ts` (single source of truth). Mutations operate on any `NodeTree` generically via `src/core/page-tree/mutations.ts`; routing to the active tree is the sole job of `mutateActiveTree(fn)` in `siteSlice.ts`.
- **Slots (Visual Components):** When a `base.visual-component-ref` is dropped, it auto-spawns one **`base.slot-instance`** child per slot param via `syncSlotInstances` (`src/core/visualComponents/slotSync.ts`). User content lives as ordinary children of the slot-instance, in the same page tree as everything else. The publisher pairs each `base.slot-instance` (consumer side) with the matching `base.slot-outlet` (in the VC's definition tree) by `slotName`. There is no `slotContent` prop — all slot fills are materialized, locked nodes in the page tree.
- **Publishing:** Page tree → renderer (`src/core/publisher`) → static HTML/CSS.
- **Tests:** `bun test`. Lint with `eslint`. Architectural rules enforced by `src/__tests__/architecture/*` — those tests run as part of `bun test` and any structural rule change must update the matching gate.

### Repo layout (high-level)

```
server/         Bun server, router, CMS handlers, plugin runtime
server/db/      DB adapter (Postgres + SQLite), migrations, runner
src/admin/      Admin app (React) — editor shell, plugin pages, site/content admin
src/editor/     Visual page builder UI
src/core/       Engine, page tree, publisher, plugin SDK + runtime, persistence, validation
src/modules/    First-party block modules (button, container, text, image, etc.)
src/ui/         Shared UI primitives (Button, Input, Tree, icons, cn helper)
src/styles/     Global tokens (globals.css)
docs/           Architecture, plugin authoring, deployment docs
examples/       Plugin templates, type declarations
```

`src/core/page-tree/treeSchema.ts` — single source of truth for `NodeTreeSchema` and the generic `NodeTree<TNode>` type. Page trees, Visual Component trees, and slot fills all conform to this shape.

---

## Development status — READ THIS FIRST

**This project is in PRE-RELEASE. There are no external users. There is no production traffic. There is no installed base. Nothing is shipped.**

That has direct consequences for how Claude must approach changes in this repo.

### No backward compatibility. Ever.

There is nothing to be backward compatible with. There are no users whose data, plugins, integrations, or workflows can break, because there are none yet.

This means:

- **Do not preserve old function signatures, schemas, types, or APIs out of compatibility concern.** If a cleaner shape exists, change it everywhere and delete the old one.
- **Do not add deprecation shims.** Don't keep a `legacyFoo()` that forwards to `foo()`. Just rename it and update callers.
- **Do not add migration paths from old behavior to new behavior** unless it is genuinely required for *currently developed code in this repo* to keep functioning. We are not migrating real installs.
- **Do not gate new behavior behind feature flags or version checks "to be safe."** If the new behavior is correct, that is the only behavior.
- **Do not leave both an old and new implementation side-by-side** "for now." Pick the right one and delete the other.

### No band-aids. No "we'll clean it up later."

If a piece of code is in the wrong place, has the wrong shape, has confusing naming, or carries leftover assumptions from an earlier design — **fix it at the source, even if it means refactoring multiple files**.

You are explicitly authorized — and expected — to:

- Rename modules, files, types, and functions across the whole codebase to match the cleaner architecture.
- Move responsibilities between layers (e.g. push logic out of a handler into a repository, or out of a component into the engine) when that is correct.
- Delete dead code, unused exports, half-finished abstractions, and "just in case" parameters.
- Restructure folders if the current layout no longer reflects the architecture.
- Break and fix many call sites in a single change set when that is what the cleaner design requires.

What you must not do:

- Wrap new logic around old logic to "avoid touching it."
- Add a second way of doing something because the first way is awkward — fix the first way.
- Leave TODO/FIXME notes about cleanup instead of doing the cleanup.
- Hide the wrong abstraction behind a thin adapter so callers "don't notice."
- Justify a workaround with "to keep this PR small" or "to avoid breaking other things." Other things can break in this PR. We will fix them in this PR.

### Database, schema, and stored data

There is no production data to protect. Treat the schema like code:

- If a column, table, or migration is wrong, change the migration and the schema. Do not write a "compatibility migration" on top of a bad migration.
- If stored shapes (page trees, plugin manifests, settings) need to change, change them and update everything that reads/writes them.
- Local dev databases are disposable. It is acceptable for a change to require dropping the local DB and re-running migrations from scratch.

### Plugin SDK and public-looking surfaces

The plugin SDK in `src/core/plugin-sdk/`, the runtime in `src/core/plugins/`, and the manifest format in `plugin.json` *look* like a public contract, but they are also pre-release. Nothing external depends on them yet.

- If the SDK shape is wrong, change it. Update the example plugin in `examples/plugins/template` and the docs in `docs/plugins/*` in the same change.
- The `apiVersion` field is not yet a stability promise. Don't invent legacy adapters for older `apiVersion` values.

### Default disposition on every change

When you have a choice between:

- (A) the cleaner architecture, requiring edits across several files, and
- (B) a smaller diff that leaves the architecture slightly worse,

**always choose (A).** That is not a tradeoff in this repo. The whole point of being pre-release is that this is the cheapest moment in the project's life to do (A). Spending that budget is the job.

If you are unsure whether a refactor is in scope, default to *yes, do it*, and explain in the summary what you cleaned up and why. Do not ask permission to delete dead code, rename a poorly-named symbol, or fix a bad abstraction — just do it.

---

## Design tokens and UI primitives

### Where the tokens live

All design tokens are CSS custom properties declared in `src/styles/globals.css`. They are grouped by surface:

- `--editor-*`         — editor chrome surfaces, borders, text, semantic state
- `--panel-*`          — floating overlay panels (background, border, blur, shadows)
- `--input-*`          — form controls (background, border, focus glow, radius)
- `--canvas-*`         — selection / hover rings on the live canvas
- `--editor-syntax-*`  — code editor syntax colors
- `--font-sans`        — primary font

### Token rules

- **No hardcoded hex / rgb / hsl in CSS modules.** Every color comes from a `var(--*)` token. If a needed token doesn't exist, **add it to `globals.css`** — don't inline.
- **Achromatic editor chrome.** The editor and admin shells stay achromatic (white-on-black neutrals). The only chromatic accents are the semantic state tokens (`--editor-danger`, `--editor-warning`, `--editor-success-*`) and the canvas rings (`--canvas-selection-ring`, `--canvas-hover-ring`). Tinted Tailwind classes (`zinc-*`, `slate-*`, `blue-*`, `indigo-*`, `violet-*`) are gated by `achromatic-color-policy.test.ts`.
- **Border radius:** `--editor-radius` (6px), `--editor-radius-sm` (3px), `--input-radius` (12px), `--panel-radius` (12px). Don't introduce ad-hoc radius values.

### UI primitive rules

The shared component library lives in `src/ui/components/`. Every interactive control in `src/admin/` and `src/editor/` MUST use these primitives:

- **`Button`** (`@ui/components/Button`) — every action button. Bare `<button>` is gated by `button-primitive-usage.test.ts`; the only exceptions are listed in that file's `ALLOWLIST` with §8 justifications. New exceptions need an §8 entry.
- **`Input`, `Switch`, `Select`, `SearchBar`, `ColorInput`, `FileUpload`, `Separator`, `ContextMenu`, `FilterBar`** — for the corresponding control type.
- **`Tree*`** (`src/editor/ui/Tree/`) — for tree rows in DOM/site panels.
- **Icons:** `pixel-art-icons/icons/<name>`. Each icon is its own TSX file in the `pixel-art-icons` package; deep-import for tree-shaking, never barrel-import. No `lucide-react`, no inline SVG strings — gated by `no-third-party-icons.test.ts`.
- **Class composition:** `cn` from `@ui/cn` — an in-house 3-line helper. **Do not** add `clsx`, `tailwind-merge`, `class-variance-authority`, or `@radix-ui/*` to dependencies. This codebase uses CSS Modules, not Tailwind. Gated by `no-tailwind-deps.test.ts`.

### CSS rules

- **CSS Modules only** in `src/admin/` and `src/editor/`. No Tailwind utility classes — gated by `noTailwindUtilities.test.ts`.
- **No inline `style={{ ... }}`** *except* for dynamic CSS custom properties (e.g. `style={{ '--module-min-height': '${px}px' } as CSSProperties}`). The static CSS module reads them back via `var(--*)`.
- **No `!important`** in component CSS modules. The only legitimate exceptions are `globals.css` (`prefers-reduced-motion`) and `Button.module.css` (specificity reset for variant overrides).
- **File naming:** `Component.module.css` next to `Component.tsx`. Class names use `camelCase`.

---

## Error handling

### Boundaries — validate, then trust

Every untyped boundary uses TypeBox (`@sinclair/typebox`). Inside the boundary, code trusts the parsed value.

- **HTTP responses (client):** `parseJsonResponse(res, Schema)` from `src/core/utils/jsonValidate.ts`. For the persistence layer use `readEnvelope(res, Schema, fallbackMessage)` from `src/core/persistence/httpJson.ts`, which combines `responseErrorMessage` + TypeBox validation in one call.
- **`JSON.parse` of persisted data (localStorage, JSONB columns, file contents):** `safeParseJson(raw, Schema)` returns a discriminated union; `parseJsonWithFallback(raw, Schema, default)` for best-effort reads where corruption shouldn't brick the UI.
- **Request bodies on the server:** validate with a TypeBox schema before handing to handlers. Helpers in `server/http.ts`.
- **Plugin manifests:** `parsePluginManifest` in `src/core/plugins/manifest.ts`.
- **Site documents loaded from storage:** `validateSite` in `src/core/persistence/validate.ts` (Constraint #230).
- **Migrating Zod patterns to TypeBox:** `z.infer<typeof X>` → `Static<typeof X>`; `Schema.parse(v)` → `parseValue(Schema, v)` (or `Value.Parse(Schema, v)` directly); `Schema.safeParse(v)` → `safeParseValue(Schema, v)` (or `Value.Check(Schema, v)` for boolean-only); `.catch(value)` → `withFallback(schema, value)`; `z.array(z.unknown()).transform(filter)` → `filterArray(itemSchema, values)`; `.transform()` / `.preprocess()` for data migration → sibling parser helper functions (e.g. `parsePageNode`, `parseSitePage`); `.refine()` → named guard functions called after `Value.Check`.

### Error classes

- Domain validation errors are typed `Error` subclasses with a `path` (or similar) field for diagnostics. Examples already in the codebase: `SiteValidationError`, `VisualComponentNameError`, `VisualComponentParamNameError`, `VisualComponentRecursionError`. **Add a typed class when callers need to distinguish causes** — UI states, retry decisions, etc.
- Generic `throw new Error(...)` is fine for "this should never happen" invariants and library-internal panics. It is not fine when the UI needs to render a specific error state.

### Server error envelope

- Server endpoints return `{ error: string }` on failure (validated by `ErrorEnvelopeSchema`).
- Clients read it via `responseErrorMessage(res, fallback)`.
- Server logs use the prefix `console.error('[<module>]', err)` — example: `'[plugin:acme.workflow]'`.

### UI error handling

- Async UI handlers always wrap in `try/catch`. Logged errors use the prefix `console.error('[<component>] <description>:', err)` — example: `'[toolbar] Manual save failed:'`.
- User-visible errors go through component state + `role="alert"` (or `role="status"` for non-blocking). Never `alert()` / `confirm()` / `prompt()`.
- Error message extraction: `err instanceof Error ? err.message : 'Unknown <thing> error'`.
- Soft fallbacks (corrupted localStorage, missing optional config): use `parseJsonWithFallback` and continue with defaults. Do not throw.
- Hard fallbacks (corrupted required document, broken HTTP envelope): let the error bubble to the nearest error boundary. Do not silently mask it.

### Forbidden patterns

- `catch (err) {}` — silently swallowing. If the error is genuinely safe to ignore, name it (`catch (_err)`) and add a one-line comment explaining why.
- `console.log` in production code. Use `console.error` / `console.warn` with a `[<module>]` prefix, or remove the log.
- Re-throwing a wrapped `Error` that loses the original stack. Use `new Error(message, { cause: err })` if you must wrap.
- `as Foo` at a JSON / HTTP / `JSON.parse` boundary. Use a TypeBox schema instead.
- Importing `zod` anywhere outside `server/handlers/agent/tools.ts`. The codebase migrated to TypeBox; the lone `server/handlers/agent/tools.ts` exemption exists only because `@anthropic-ai/claude-agent-sdk`'s `tool()` API has a type-level `AnyZodRawShape` constraint TypeBox can't satisfy.

---

## Database dialect rules

The CMS supports two database engines: **Postgres** and **SQLite**. The same repository code runs on both. Three rules make this work:

1. **Repositories are dialect-naive.** They use only ANSI-standard SQL that works on both engines. The 5 specific Postgres-isms (`now()` in DML, `::int`, `::jsonb`, `any($N::...)`, `distinct on`) are banned in any `DbClient`-importing file under `server/` (covers `server/repositories/*`, `server/handlers/cms/*`, `server/auth/*`, `server/plugins/*`, `server/publish/*`) and gated by `db-postgres-isms.test.ts`.

2. **JSON columns end in `_json`.** This is a hard convention — gated by `db-json-column-naming.test.ts`. The SQLite adapter exploits it: on read, any column ending in `_json` whose value is a string is automatically `JSON.parse`d. On write, any plain object/array passed via tagged template is automatically `JSON.stringify`d. Result: repositories use `${jsObject}` and read `row.settings_json` as `Record<string, unknown>` against both engines with zero dialect-aware code.

3. **Migrations are split per dialect.** `server/db/migrations-pg.ts` keeps `jsonb`, `timestamptz`, `bytea`, `bigint`, `boolean`, and `distinct on` (PG dialect). `server/db/migrations-sqlite.ts` uses `text`, `text`, `blob`, `integer`, `integer`, and a window-function rewrite. Migration IDs and order MUST match across both files (gated by `migration-parity.test.ts`).

**Adding a new migration:** add it to BOTH `migrations-pg.ts` and `migrations-sqlite.ts` with the same ID and the same semantic effect. The parity test will catch you if you forget.

**Adding a JSON column:** name it `*_json`. The architecture test enforces this.

---

## Mutation API

Every mutation in `src/core/page-tree/mutations.ts` takes a `NodeTree<PageNode>` (or generic `NodeTree<TNode>`) and is **tree-agnostic** — it knows nothing about pages vs. Visual Components. The only place that knows which tree is currently active is `mutateActiveTree(fn)` in `src/core/editor-store/slices/siteSlice.ts`:

- **Page mode** → `fn(activePage)` — `Page IS NodeTree<PageNode>`, so no conversion.
- **VC mode** → `fn(vc.tree as NodeTree<PageNode>)` — `VCNode` is structurally identical to `BaseNode` and all mutations operate on base fields, so the cast is safe.

The 11 named tree-mutation store actions (`insertNode`, `deleteNode`, `updateNodeProps`, `setBreakpointOverride`, `clearBreakpointOverride`, `renameNode`, `toggleNodeLocked`, `toggleNodeHidden`, `moveNode`, `duplicateNode`, `wrapNode`) are one-liners that call `mutateActiveTree` — they must NOT contain their own `kind === 'visualComponent'` routing branch. This invariant is gated by `src/__tests__/architecture/no-vc-mode-branches-in-mutations.test.ts`.

---

## Code quality bar

- **Clear logic over clever logic.** Straight-line code beats a generic abstraction with two callers.
- **Names must be honest.** A function called `renderPage` renders a page. Not "kind of, depending on flags."
- **One reason per module.** Files in `server/{repositories,handlers/cms,auth,plugins,publish}/*` and `src/core/*` are organized by responsibility — keep them that way.
- **No dead code.** Unused exports, parameters, types, files: delete them. `fallow` (`npx fallow dead-code`) is the canonical tool; `knip`, `madge`, and `jscpd` remain available for second-opinion checks.
- **Health checks with coverage.** `bun run fallow:health` runs `bun test --coverage` (LCOV via `bun:test`), converts the result to Istanbul JSON via `scripts/lcov-to-istanbul.ts`, and feeds it to `fallow health --coverage`. Without coverage data fallow over-reports CRAP scores as "critical" purely from complexity; with it the scores are accurate. Run before deciding whether a hotspot needs more tests vs. more refactoring.
- **No `any` to escape a type problem.** Fix the type.
- **No commented-out code.** Git remembers.
- **Validate at the boundary, trust inside.** Every external input (HTTP, `JSON.parse`, plugin manifests, persisted data) goes through a TypeBox schema. Don't `as Foo` your way past it.
- **Schemas are source of truth.** Domain types come from `Static<typeof Schema>` (re-exported from `@core/utils/typeboxHelpers`) — don't keep a parallel `interface Foo` next to `FooSchema`.
- **Architecture tests are first-class.** When you change a structural rule (folder layout, allowed imports, banned APIs, design tokens), update the matching test in `src/__tests__/architecture/`.
- **At the end of the task, your own changes must pass `bun test`, `bun run build`, and `bun run lint`.** Verification is an end-of-task gate, not a per-edit ritual. Run the checks once when you believe the work is complete, fix what your changes broke, and you're done. See the "Verification" section below for how to handle pre-existing failures from parallel sessions.

## Tooling rules

- Always use `bun` (not `npm`/`pnpm`/`yarn`) for installs, scripts, and tests.
- Lockfile is `bun.lock`. Do not introduce `package-lock.json` or `yarn.lock`.
- Server scripts run with `bun --watch server/index.ts`. Frontend dev runs with `vite`.
- Run the full stack locally with `bun run dev` (defaults to SQLite at `.tmp/dev.db` — no external dependencies) or `docker compose up --build` (everything in containers with Postgres). Set `DATABASE_URL=postgres://...` before `bun run dev` to use Postgres instead.
- **Lint, build, and tests are end-of-task gates, not per-edit rituals.** Architectural tests in `src/__tests__/architecture/` are part of `bun test` and will fail loudly if structural rules drift — when *your* change drifts a structural rule, fix it.
- **`bun run build` runs `tsc -b && vite build`** — both type-checking and bundling. A change that runs in dev but fails `tsc` for code you wrote is not done.

## Verification

```sh
bun install
bun run build         # tsc -b && vite build
bun test
bun run lint
```

### When to run

Run verification **once, at the end of the task**, before declaring work complete. You do not need to run `bun test` / `bun run build` / `bun run lint` after every edit — that wastes time. Make your changes, then verify.

Use `bun run build` and `bun test` for any non-trivial change. Add `bun run lint` if you touched `.ts`/`.tsx` files.

### Parallel sessions and pre-existing failures

**Multiple Claude sessions may be working on this repo at the same time.** That means when you run verification, the working tree may already contain failing tests, type errors, or lint errors from work-in-progress in another session. **That is not your problem to fix.**

Rules:

- Confirm that **the code you wrote / files you touched** typecheck, lint, and pass their tests.
- A pre-existing failure in an area you did not touch is not a blocker for your task. Note it in your summary so the user knows, then move on.
- **Do not try to "fix" failures unrelated to your work** — you'll collide with whoever is editing those files. Don't add band-aids, don't comment out failing tests, don't revert someone else's half-finished change.
- **Do not skip verification entirely** because "tests are probably broken anyway." Always run the checks, then triage: yours vs. not-yours.
- If a failure is ambiguous (could be yours, could be pre-existing), `git status` / `git diff` will show what you actually changed. Anything outside that diff is not yours.

The bar is: **your work is clean.** The repo's overall green/red state is the user's coordination problem across sessions, not yours.

---

## TL;DR for Claude

1. We are pre-release. There are no users to protect.
2. Never preserve backward compatibility, never leave band-aids, never duplicate "old vs new" code paths.
3. If the architecture would be cleaner with a multi-file refactor — do the refactor, in this change.
4. Every untyped boundary goes through TypeBox (`@sinclair/typebox`). `as Foo` at a JSON boundary is a bug. The only legitimate `zod` usage in the entire repo is `server/handlers/agent/tools.ts` (Anthropic SDK boundary).
5. UI uses shared primitives from `src/ui/`, design tokens from `src/styles/globals.css`, CSS Modules only.
6. Output of this project must stay clean: clean HTML, clean CSS, clean TypeScript, clean modules. No exceptions.
7. Verify once at the end of the task. Pre-existing failures from parallel sessions are not yours to fix — make sure *your* code is green and move on.
