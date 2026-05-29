# Publishing architecture — three-layer plan (A + B + C)

**Status:** Proposed (not implemented). Pick up across sessions by scanning
the "Status checkboxes" block at the top of each layer section.

**Date:** 2026-05-25 (revised 2026-05-25)

**Author:** evaluation handoff from rendering-unification work (see
`server/publish/publicRouter.ts`).

**Earlier draft included a Layer D (read-only published SQLite "site
bundle"). It was dropped after review:** it added a third database
alongside Postgres + SQLite, required PG → SQLite schema translation at
every publish, duplicated visitor read code outside the dialect-naive
`DbClient` abstraction, and didn't actually solve the dynamic-data problem
— that's what Layer C does. The single shippable-artefact win we got
excited about (PGlite / sql.js-httpvfs in the browser) is a separate
opt-in feature that does not require an always-on server-side Publish DB.
We can revisit it later as an export, never as the primary read path.

This document is the single source of truth for the three-layer
publishing overhaul. Each layer is implementable as a discrete change set
with its own acceptance criteria and tests. The layers are designed to
compose; the canonical implementation order is **A → B → C**.

---

## Why this spec exists

Today every visitor request runs `publishPage()` against a JSON snapshot
in `data_row_versions.snapshot_json` and then runs
`applyPublishedHtmlPipeline` on the result. That works but has three
problems:

1. **No static fast-path.** Even a stand-alone marketing page with no
   loops and no per-request bindings re-renders + re-filters on every
   visitor hit.
2. **`publish.html` filters fire per-request.** The filter is
   conceptually a publish-time mutation; running it on every visitor
   multiplies plugin cost and turns deterministic transforms into
   per-request work.
3. **No seam for per-request fresh data.** If a plugin wants to inject
   live data ("logged-in nav", "current cart count", "latest stock
   price"), today it can only either bake stale data into the snapshot
   or run a per-request `publish.html` filter. Neither is right.

The three layers below close those gaps. The model: **static by default,
dynamic by automatic detection**. The author doesn't toggle anything;
the publisher inspects the page tree and decides per-node what's static
vs. what's an island.

---

## Goals

- **Visitor TTFB** for a stand-alone published page ≤ 5 ms warm, ≤ 30 ms
  cold, served from disk with no DB hit and no render.
- **Visitor TTFB** for a route that must be rendered (loops, pagination,
  request-dependent bindings) ≤ 5 ms warm from the in-memory cache.
- Plugin `publish.html` / `publish.before` / `publish.after` filters run
  at publish time, not per request. Plugins with truly per-request needs
  use Layer C islands instead.
- One single readable place that knows where a route's HTML comes from
  (`server/publish/publicRouter.ts` stays the gate).
- **Atomic, seamless, safe publishing.** A visitor request mid-publish
  sees either the old state or the new state, never a partial / mixed
  state, never a "directory doesn't exist" error.
- **Author UX is invisible.** No per-node toggle, no "is this static or
  dynamic?" decision for the site author. Auto-detection handles it.

## Non-goals

- A separate Publish DB. (Dropped — see top of doc.)
- Shipping the published site to the visitor's browser (PGlite /
  sql.js-httpvfs). Possible future opt-in export; not in this spec.
- Edge / CDN integration. Single-process model is correct for the
  product.
- Personalisation per logged-in visitor at the page level. The product
  is self-hosted public publishing; visitor identity is anonymous.
  Layer C islands CAN do per-visitor content if a plugin author wants to
  build that on top of an authenticated hole endpoint, but it's not a
  first-party feature.

---

## Glossary

- **`PublishedPageSnapshot`** — JSON record currently stored in
  `data_row_versions.snapshot_json` containing the full `SiteDocument`.
  Stays unchanged. Source of truth for what was published.
- **Static artefact** — pre-rendered `<route>/index.html` on disk under
  the active publish slot (Layer A). The fastest path; ≤ 5 ms TTFB.
- **Render cache** — in-memory LRU keyed by `(urlPath, queryString)`
  with a per-process `publishVersion` (Layer B). Used for routes whose
  output varies per request but is publish-time-deterministic given the
  URL (loops with pagination, etc.).
- **Island / hole** — a node whose subtree renders at request time via a
  `/_pb/hole/<…>` endpoint, fetched lazily by a small client runtime as
  the visitor scrolls near it (Layer C). The page around the hole is
  static (Layer A) or cached (Layer B).
- **Dynamic node** — any node the auto-detector classifies as
  request-dependent. Becomes a hole.
- **Active slot / inactive slot** — the two-slot directory layout used
  by Layer A for atomic publish (see "Atomic publish protocol" below).
- **`publishVersion`** — opaque monotonic string identifying the
  published site state. Bumps on every publish. Used as cache invalidator
  for Layer B and as build-tag for Layer A's slot manifest.

---

## Architecture overview

```text
                            visitor request
                                  │
                                  ▼
                  server/publish/publicRouter.ts
                                  │
        ┌─────────────────────────┼─────────────────────────┐
        ▼ (Layer A)               ▼ (Layer B)               ▼ (Layer C, lazily after paint)
   static artefact?          render cache hit?         IntersectionObserver
   uploads/published/        in-memory LRU keyed by    fires near viewport →
   current/<route>/          (urlPath, queryString)    GET /_pb/hole/<nodeId>
   index.html                + publishVersion          renders 1 node, returns HTML
        │                         │                         (with single-flight cache)
        │ hit → stream            │ hit → return string
        │ miss                    │ miss
        ▼                         ▼
   resolvePublicRoute      renderPublicResolution
   (existing DbClient        runs publishPage()
    + snapshot reads,        ── publish.html ALREADY APPLIED
    unchanged)               at publish time, baked into snapshot.html
                             cached in B's LRU
        │                         │
        └────────────┬────────────┘
                     ▼
              HTTP 200 / 301 / 404
```

The Edit DB stays the read-time source of truth for the snapshot.
Layers A and B together mean visitor requests almost never hit the
DbClient at all. Layer C handles the parts that genuinely need live
data per request.

On publish:

```text
admin clicks Publish
        │
        ▼
publishDraftSite / publishDataRow (server/repositories/...)
        │
        ├─→ write snapshot to data_row_versions.snapshot_json (existing)
        │
        ├─→ render each fully-static route through publishPage +
        │     applyPublishedHtmlPipeline (plugin filters fire HERE,
        │     not per request)
        │
        ├─→ write all freshly-rendered HTML into the INACTIVE slot
        │     (uploads/published/slot-{a,b}/, the one NOT currently
        │     pointed to by the symlink)
        │
        ├─→ atomic symlink flip:
        │     ln -sfn slot-NEW uploads/published/current
        │     (rename(2) of a symlink is atomic; no window where
        │      `current` is missing or partial)
        │
        ├─→ bump publishVersion → Layer B render cache invalidates
        │
        └─→ OLD slot stays around (untouched) until next publish.
              In-flight readers holding fds into it finish normally.
              On the NEXT publish, that slot becomes the new inactive
              target and gets wiped + rewritten.
```

---

## Layer A — Static-to-disk for fully-static routes

### Status checkboxes

- [x] Design accepted
- [x] `isFullyStatic(snapshot, page)` predicate implemented + unit tested
- [x] `staticArtefact.ts` IO helpers implemented (slot-aware: read /
      write / purge / atomic swap)
- [x] Two-slot directory layout under `uploads/published/`
- [x] `publishDraftSite` builds all fully-static pages into the inactive
      slot, then flips the `current` symlink atomically
- [x] `publishDataRow` writes the row's artefact into the active slot
      in-place (incremental update; SAFE because per-file `rename(2)` is
      atomic on the same fs)
- [x] `publicRouter.ts` tries the disk path before the resolver
- [x] `applyPublishedHtmlPipeline` is invoked **only** at publish-time
- [x] Disk artefacts include plugin frontend-asset injection (baked at
      publish, not at request)
- [x] Stale disk files for removed routes are absent from the new slot
      (built fresh each full publish)
- [x] Architecture test: `applyPublishedHtmlPipeline` is not called from
      `server/publish/publicRouter.ts` or any file in the request hot
      path
- [x] **Complete static publishing**: `publishDraftSite` bakes the CSS
      bundles (`/_pb/css/<bundle>-<hash>.css`) and runtime JS
      (`/_pb/assets/<versionId>/…`) into the slot via `writeStaticAsset`.
      `serveSiteCss` and `tryServeRuntimeAsset` read disk-first
      (`readStaticAsset`), so a published page never hits the server to
      (re)generate CSS/JS. CSS/JS are written for **every** page, deduped by
      content-hashed filename.
- [x] **Hole shells baked too**: `publishDraftSite` and `publishDataRow` bake
      **every** page's HTML — fully-static pages as a complete document, pages
      with dynamic nodes as a static **shell** with `<pb-hole>` placeholders.
      The shell + CSS + JS serve from disk with zero DB; only the
      `/_pb/hole/<id>` fragment fetch (Layer C) reads the DB. Shells are
      stamped with the *next* publish version (bump runs synchronously right
      after the swap) so their `data-pb-version` is never stale. A page that
      throws while rendering is skipped (per-page try/catch) and falls through
      to the live renderer.

### Goal

Write the final HTML (post `applyPublishedHtmlPipeline`) to disk at publish
time for **every** page. Pages whose output cannot vary by request bake a
complete document; pages with request-dependent nodes bake a static **shell**
in which those nodes are `<pb-hole>` placeholders (Layer C). The visitor router
streams the file with `content-type: text/html`; the only request that varies
per visitor is the `/_pb/hole/` fragment fetch.

### Atomic publish protocol — the two-slot symlink swap

The publisher MUST never serve a partial / inconsistent / missing state
to a visitor mid-publish. The two-slot symlink swap is the standard
Unix pattern (used by nginx config reloads, Capistrano, atomic rsync
deploys):

```text
uploads/published/
  current  -> slot-a/         (symlink; visitor router reads through this)
  slot-a/                     (the active slot's files)
    about/index.html
    posts/hello/index.html
    ...
  slot-b/                     (the inactive slot; empty or stale)
```

Steps on full publish (e.g. `publishDraftSite`):

1. Determine inactive slot by reading the current target of
   `uploads/published/current`. If `current` doesn't exist (first ever
   publish), pick `slot-a` as the build target.
2. `rm -rf` the inactive slot directory (sweeps any stale files from a
   previous-generation publish). This is safe — no visitor reads the
   inactive slot. The `current` symlink still points to the active slot.
3. Build the new state into the (now empty) inactive slot directory.
   Each file is written as `<path>/index.html.tmp` then `rename`d to
   `<path>/index.html`. Per-file atomicity is for paranoia: the whole
   slot doesn't go live until step 4.
4. **Atomic symlink swap**: write a new symlink `uploads/published/
   current.tmp` pointing at the inactive slot, then `rename` it over
   `uploads/published/current`. `rename(2)` of a symlink is a single
   inode swap and is atomic across all POSIX filesystems.
5. The visitor router's next read hits the new slot. In-flight readers
   that already resolved the old symlink hold file descriptors into the
   OLD slot — Unix semantics keep those files alive until they close
   their fds. No corruption, no read failures.
6. The OLD slot is now the inactive slot. It stays untouched until the
   NEXT publish (which sweeps it in step 2). Worst-case disk footprint:
   2× site size.

Incremental publish (`publishDataRow`) writes the single new HTML file
into the CURRENT active slot using `<path>/index.html.tmp` + `rename`.
Per-file atomicity is sufficient because no other file is changing in
this case. If the row's slug changed, the old slug's artefact is also
removed in the same step.

### Files

- **New:** `server/publish/staticArtefact.ts`
  - `getActiveSlot(uploadsDir): Promise<'slot-a' | 'slot-b' | null>` —
    reads the `current` symlink target.
  - `getInactiveSlot(uploadsDir): Promise<'slot-a' | 'slot-b'>` — the
    one `current` doesn't point at; defaults to `slot-a` on first run.
  - `prepareInactiveSlot(uploadsDir): Promise<string>` — `rm -rf`'s and
    re-creates the inactive slot directory, returns its absolute path.
  - `writeArtefact(slotDir, urlPath, html): Promise<void>` — atomic per
    file: tmp + rename. Creates the route's directory tree as needed.
  - `swapSlot(uploadsDir, newActiveSlot): Promise<void>` — writes
    `current.tmp` symlink and atomically renames it over `current`.
  - `readArtefact(uploadsDir, urlPath): Promise<string | null>` — reads
    `<uploadsDir>/published/current/<urlPath>/index.html` if it exists.
    The router calls this on every request before falling through.
  - `updateArtefactInPlace(uploadsDir, urlPath, html): Promise<void>` —
    incremental write into the active slot. Uses tmp + rename.
  - `removeArtefactInPlace(uploadsDir, urlPath): Promise<void>` — used
    when an incremental publish removes a row.
- **New:** `src/core/publisher/staticAnalysis.ts`
  - `isFullyStaticPage(page, site, registry): boolean`
  - Returns false if any node in the tree has:
    - module marked `dynamic: true` (Layer C flag), OR
    - any `dynamicBindings` value whose binding source is
      request-dependent (see Layer C "auto-detection rules"), OR
    - `moduleId === 'base.loop'` whose loop source has
      `requestDependent: true` (most built-in CMS data-table loops are
      publish-time-deterministic and therefore stay static — only
      live-API / per-visitor loop sources mark the loop as dynamic), OR
    - a `base.visual-component-ref` whose definition tree is not itself
      static (recursive check with cycle guard).
  - Plus a `staticReasons(page, ...)` debug variant that returns the
    LIST of reasons (for editor introspection / dev tooling).
  - **Important:** loops with publish-time-deterministic sources stay
    static. A loop showing "all team members" or "latest 10 posts from
    the CMS" bakes inline at publish time. Republish rebuilds the
    artefact. No hole, no per-visitor render.
- **Modified:** `server/repositories/publish.ts:publishDraftSite`
  - After writing each row+snapshot, follow the full atomic-swap
    protocol above. Render every `isFullyStaticPage` page through
    `publishPage` + `applyPublishedHtmlPipeline` ONCE per publish.
- **Modified:** `server/repositories/data/publish.ts:publishDataRow`
  - Render the new row through its entry template if the template is
    fully static, and `updateArtefactInPlace` into the active slot.
  - If the row's slug changed, `removeArtefactInPlace` for the old slug.
- **Modified:** `server/publish/publicRouter.ts`
  - At the very top of `renderPublicResolution`, **and only when the
    request URL has no query string** (`url.search === ''`), call
    `readArtefact(uploadsDir, url.pathname)`. On hit, return the HTML
    as a 200 response with `content-type: text/html; charset=utf-8`.
    Hot path: 1 syscall (`open` + `read`), no DB.
  - **Safety property:** disk artefacts only serve URLs with no query
    string. URLs with `?` always fall through to Layer B (or the live
    renderer). This stops Layer A from serving page-1 HTML for a
    `?page=2` request on a paginated loop. Layer A bakes the canonical
    URL; Layer B handles URL variants.

### Invariants

- The disk artefact is the **final** HTML — post `applyPublishedHtmlPipeline`,
  with plugin frontend injections baked in. Per-request filter runs are
  GONE.
- **Disk artefacts only serve canonical URLs.** A request with any query
  string bypasses the disk path entirely. Layer A bakes one HTML per
  canonical URL; Layer B owns URL variants (`?page=N`, etc.).
- The `current` symlink either points at a complete, valid slot or at
  the previous complete slot. There is no in-between state. This is the
  central safety property of the design.
- Layer A artefacts are derived state. If `uploads/published/` is
  deleted entirely, the next full publish recreates everything.
  `republishAllPages` is the canonical "rebuild from scratch" entry.
- The visitor router never opens an fd into the inactive slot. Only
  publish code touches inactive slots.

### Tests

- `staticArtefact.test.ts` — write/read/purge, atomic-rename semantics,
  symlink swap, path safety (no `..` escapes), slot rotation across
  multiple publishes.
- `staticAnalysis.test.ts` — table-driven over fixture page trees:
  - all-static modules → true
  - tree with a `base.loop` → false
  - tree with a request-dependent binding source → false
  - tree with a dynamic module (Layer C flag) → false
  - VC ref to a static VC → true
  - VC ref to a dynamic VC → false (recursive)
  - cycle in VC refs → terminates, returns false
- `publishStaticArtefact.test.ts` (integration) — `publishDraftSite`
  with mixed static/dynamic fixture site writes the right files into
  the right slot and flips the symlink.
- `publishAtomicityRace.test.ts` — simulate a mid-publish reader: in a
  loop, `readArtefact` repeatedly while another goroutine flips the
  slot; assert no read ever returns null or partial content for a route
  that exists in either generation.
- `publicRouter.test.ts` — given a disk artefact for `/about`, the
  router returns it without consulting the snapshot.

### Performance target

Fully-static route: ≤ 5 ms TTFB warm, ≤ 30 ms cold. Measured with the
existing `bun run bench:http`. Add a `bench/staticArtefactServe.ts` if
not already covered.

---

## Layer B — In-memory render cache with `publishVersion` keys

### Status checkboxes

- [x] Design accepted
- [x] `renderCache.ts` LRU implemented (bounded, configurable)
- [x] Cache key includes `publishVersion`
- [x] `publicRouter.ts` wraps the resolver/renderer call with `getOrRender`
- [x] Single-flight: concurrent calls for the same key share one render
- [x] Layer A's disk path bypasses the cache (already final HTML)
- [x] On publish, `bumpPublishVersion()` invalidates all entries
- [x] Only 200-status responses are cached (301/404 are recomputed)
- [x] Tests gate hit/miss, version bump invalidation, single-flight

### Goal

Routes that **must** render per request (loops with `?page=N`, content
routes with request-dependent template bindings, postType index pages)
get memoised on the first hit. Cache key includes a `publishVersion`
that bumps every publish, so any republish naturally evicts everything.

### Files

- **New:** `server/publish/renderCache.ts`
  - `interface RenderCacheKey { urlPath: string; queryString: string }`
  - LRU with size cap from env `RENDER_CACHE_MAX_ENTRIES` (default `1000`)
  - `getOrRender(key, factory: () => Promise<CachedResponse>): Promise<CachedResponse>`
  - `bumpPublishVersion(): void` — invalidates by mismatch on next read
  - `getStats(): { hits, misses, size }` — for observability
  - Cached value is `{ body: string; headers: Record<string, string>; status: 200 }`
- **Modified:** `server/publish/publicRouter.ts`
  - After Layer A's `readArtefact` miss, wrap the resolve+render call
    in `getOrRender`:
    ```ts
    const cached = await renderCache.getOrRender(
      { urlPath: url.pathname, queryString: url.search },
      async () => {
        const resolution = await resolvePublicRoute(db, url)
        return await renderPublicResolution(resolution, db, url)
      },
    )
    return responseFromCached(cached)
    ```
  - Only `status === 200` responses are pushed into the cache.
    Redirects (301) and not-founds bypass the cache (cheap to recompute,
    avoid poisoning).
- **Modified:** publish handlers (`publishDraftSite`, `publishDataRow`,
  `unpublishDataRow`, etc.) call `renderCache.bumpPublishVersion()` after
  the DB commit lands.

### Invariants

- Cache stores response body string + headers + status. Hits build a
  fresh `Response` object (responses aren't reusable in `Bun.serve`).
- Only 200-status responses cached.
- Querystring is part of the key. `/posts?page=2` and `/posts?page=3`
  are distinct entries.
- `bumpPublishVersion` is lazy invalidation: entries with the old
  version are skipped on read and replaced.

### Tests

- `renderCache.test.ts` — bounded eviction, hit/miss, version bump,
  single-flight (two concurrent `getOrRender` calls for the same key
  trigger the factory once).
- `publicRouterCache.test.ts` — first request renders + caches; second
  returns from cache; publish event evicts.

### Performance target

Warm cache hit on a dynamic route: ≤ 5 ms TTFB. Benched per-route via
`bench/dynamicRouteCache.ts`.

---

## Layer C — Server islands ("holes") with auto-detection + lazy loading

### Status checkboxes

- [x] Design accepted
- [x] `defineModule` accepts `dynamic: true`
- [x] Binding-source registry has a `requestDependent` flag; built-in
      sources are correctly classified
- [x] `isDynamicNode(node, registry)` predicate implemented (the
      auto-detector); Layer A consumes it via `staticAnalysis.ts`
- [x] Publisher emits placeholder + hole metadata for dynamic nodes
- [x] Modules can opt-in to a `staticPlaceholder` render that produces
      the skeleton/fallback HTML baked into the page at publish
- [x] `pb-hole-runtime.js` (~1 KB) included only on pages that contain
      holes; uses `IntersectionObserver` for lazy load
- [x] `/_pb/hole/<nodeId>` endpoint renders a single node subtree
- [x] Hole responses are single-flighted + cached by Layer B with
      version-aware keys
- [x] Auto-detected dynamism cascades: a node containing a dynamic
      descendant is itself dynamic (Layer A side); BUT the hole boundary
      is the deepest natural module boundary, not the whole page
- [x] Tests: a page with auto-detected dynamic binding emits a
      placeholder; the hole endpoint returns the rendered fragment; the
      runtime swaps in lazily when scrolled near

### Goal

When a node's content depends on per-request data — either because the
module declared itself dynamic, OR because the auto-detector found a
request-dependent binding — the publisher does NOT bake that node into
the static HTML. Instead it emits a placeholder, and a tiny client
script fetches the rendered fragment from `/_pb/hole/<nodeId>` when the
visitor scrolls near it.

The author writes no code, sets no flag, picks no toggle. The system
classifies each node automatically. **Static modules stay static, dynamic
nodes become islands, no intermediate UI.**

### Auto-detection rules (the heart of Layer C)

A node is **dynamic** if any of the following holds:

1. **Its module is marked dynamic** in `defineModule({ dynamic: true })`.
   Used by plugin authors for modules that have side effects, hit live
   data, or otherwise can't safely run at publish time.
2. **It has a `dynamicBinding` whose source is request-dependent.** Each
   binding source declares whether it can resolve at publish time. The
   built-in sources classify as:
   - `currentEntry.*` → publish-time (entry is known)
   - `route.path`, `route.slug` → publish-time (URL is fixed per static route)
   - `route.query.*` → REQUEST (varies per visitor URL)
   - `site.*` / `page.*` → publish-time
   - Plugin-registered sources declare their own classification via
     `requestDependent: boolean` on registration.
3. **It's a `base.loop` whose source is request-dependent** (e.g. a
   plugin loop source that hits a live API and declares itself
   request-dependent). Most built-in loops (querying the CMS data
   tables) are publish-time-deterministic — those stay static or get
   handled by Layer B.
4. **It's a `base.visual-component-ref`** whose definition tree contains
   any dynamic node. Inheritance is recursive with a cycle guard.

The publisher computes this once per page tree at publish time and
records the result alongside the snapshot. Layer A reads it to decide
whether to bake the whole page; Layer C reads it to decide which nodes
to placeholder.

### Wire shape

When the publisher hits a dynamic node, it emits:

```html
<pb-hole id="hole-<nodeId>"
         data-pb-hole="<nodeId>"
         data-pb-version="<publishVersion>"
         style="display: contents">
  <!-- optional staticPlaceholder rendered here at publish time -->
  <div class="pb-hole-skeleton">…</div>
</pb-hole>
```

The page's `<head>` gets, once (only on pages with at least one hole):

```html
<script type="module" src="/_pb/hole-runtime.js" defer></script>
```

The runtime fetches each hole **lazily**, using `IntersectionObserver`:

```js
// /_pb/hole-runtime.js — ~1 KB, hand-written, no deps
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    const el = e.target as HTMLElement
    io.unobserve(el)
    const id = el.dataset.pbHole
    const version = el.dataset.pbVersion ?? ''
    fetch(`/_pb/hole/${encodeURIComponent(id)}?v=${encodeURIComponent(version)}`)
      .then(r => r.text())
      .then(html => { el.outerHTML = html })
      .catch(() => { /* leave placeholder showing; author's skeleton is fine */ })
  }
}, { rootMargin: '200px 0px' }) // begin fetching when 200px from viewport

for (const el of document.querySelectorAll('pb-hole[data-pb-hole]')) {
  io.observe(el)
}
```

A hole above the fold starts loading on initial paint (already in
view). Holes below load just before they enter the viewport. No
blocking fetches; the static HTML around them is fully usable
immediately.

### `staticPlaceholder` module API

Modules can provide a `staticPlaceholder(props): string` alongside
`render(props, html, children): string`:

- `render` is the dynamic version, called server-side at request time
  inside the hole endpoint.
- `staticPlaceholder` is optional, called at publish time to produce the
  skeleton / loading state baked into the page. If omitted, the
  placeholder is empty (`<pb-hole>` becomes a zero-content element).

This gives module authors a clean way to ship a non-empty loading state
(blur image, skeleton bars, fallback text like "Loading latest…") that
ALSO works for non-JS visitors as a meaningful default.

### Files

- **Modified:** `src/core/module-engine/defineModule.ts`
  - Accept optional `dynamic?: boolean`
  - Accept optional `staticPlaceholder?: (props) => string`
  - Registry exposes `isDynamic(moduleId): boolean` and
    `getStaticPlaceholder(moduleId): ((props) => string) | null`
- **Modified:** binding-source / loop-source registries
  - Each source declares `requestDependent: boolean` (default false)
  - For built-in sources, set as per the rules above.
- **New:** `src/core/publisher/dynamicDetection.ts`
  - `isDynamicNode(node, registry, contextStack): boolean`
  - `findDynamicNodeIds(page, site, registry): Set<string>` — full pass
    over a page tree, returns the set of node ids that are dynamic.
- **Modified:** `src/core/publisher/renderNode.ts`
  - When rendering a node whose id is in the dynamic set, emit the
    `<pb-hole>` placeholder, optionally containing the
    `staticPlaceholder(props)` output. DO NOT recurse into the subtree
    (its rendering happens server-side per request).
- **Modified:** `src/core/publisher/render.ts`
  - When the page has at least one hole, inject `<script type="module"
    src="/_pb/hole-runtime.js" defer></script>` into the head, once.
- **New:** `server/publish/holeRuntime.ts`
  - Exports the `HOLE_RUNTIME_JS` source string. Served by the router.
- **New:** `server/handlers/cms/hole.ts`
  - `GET /_pb/hole/<nodeId>?v=<publishVersion>` → finds the node in the
    snapshot, renders it through `renderNode` against a minimal
    `RenderContext`, returns HTML.
  - The response goes through Layer B's render cache with key
    `hole:<nodeId>:<queryString>` and `publishVersion`. Single-flight
    + LRU. Most popular holes render once per cache lifetime.
  - If `v` parameter doesn't match current `publishVersion`, return a
    minimal "stale" response and don't cache; the next page load picks
    up the new version.
- **Modified:** `server/router.ts`
  - Register `tryServeHoleRuntime` (serves the JS) and `tryServeHole`
    (the fragment endpoint) before `tryServePublicRoute`.
- **Modified:** `src/core/publisher/staticAnalysis.ts` (Layer A)
  - `isFullyStaticPage` returns false if `findDynamicNodeIds(page, ...).size > 0`.

### `applyPublishedHtmlPipeline` becomes publish-time

Plugin `publish.html` filters run ONCE per publish, against the
freshly-rendered HTML, before the disk artefact is written. They are NOT
called per request. Plugins that need per-request behaviour use Layer C
islands (mark their module dynamic, do the request-time work in
`render`).

**No backwards-compat shim.** The hook signature stays the same; the
firing semantics change. Pre-release: just document the new behaviour
in the plugin SDK docs. Existing plugins that relied on per-request
filter behaviour need to migrate to a dynamic module.

### Invariants

- A node's module `render` either runs at publish time (baked into Layer
  A artefact OR cached in Layer B) OR at request time (inside the hole
  endpoint). Never both for the same request.
- Dynamic detection is automatic and authoritative. Authors do not see
  a toggle.
- A page with at least one hole gets the runtime script; pages without
  do not (no idle JS payload on the public site for fully-static pages).
- The hole endpoint runs the same plugin hooks (`publish.before` /
  `publish.html` for the fragment) the page renderer does, but those
  fire ONCE per cache lifetime (B handles single-flight + cache).
- Placeholder HTML written into `<pb-hole>` is escaped + DOMPurified
  through the existing `src/core/sanitize.ts` boundary — module authors
  can't escape the hole element with malformed HTML.

### Tests

- `dynamicDetection.test.ts` — table-driven: every binding-source
  classification, every dynamic-cascade case, the cycle guard.
- `staticAnalysis.dynamic.test.ts` — `isFullyStaticPage` returns false
  for trees containing dynamic nodes.
- `holePublisher.test.ts` — page tree with a dynamic node renders to a
  placeholder + script tag.
- `holePlaceholder.test.ts` — module's `staticPlaceholder` output is
  injected into the placeholder element, sanitized.
- `holeRouteHandler.test.ts` — `/_pb/hole/<nodeId>?v=...` returns the
  rendered fragment; mismatched `v` returns stale response without
  caching.
- `holeRuntime.smoke.test.ts` — DOM test: fixture HTML with two
  placeholders + a mock fetch; the runtime swaps each in only when its
  `IntersectionObserver` callback fires.

### Out of scope

- No first-party module is `dynamic` yet. This layer is the seam plugins
  use. Plugin SDK docs get updated to surface the flag + the
  `staticPlaceholder` shape, but the built-in module catalogue doesn't
  change.
- No editor UI for marking nodes dynamic. The user explicitly does not
  want this — the system auto-detects.

---

## Cross-layer invariants

These rules must hold across every layer:

1. **One gateway.** Every visitor HTML response is produced by
   `tryServePublicRoute` in `server/router.ts` →
   `server/publish/publicRouter.ts`. The router file order
   (`tryServeMediaRedirect` < `tryServeUpload` < `tryServePublicRoute`)
   stays gated by `media-signed-redirect-serving.test.ts`.
2. **`applyPublishedHtmlPipeline` is publish-time only.** Architecture
   test gates that it is not called from `publicRouter.ts` or any
   request-hot-path file. Pre-release; no backward-compat shim.
3. **No per-request `publish.html`.** Plugins that need per-request work
   migrate to a Layer C dynamic module.
4. **No backward compatibility for the visitor path.** Old code paths
   that ran filters on every request, or that rendered fully-static
   pages from scratch on every request, get deleted entirely. No flag,
   no legacy mode.
5. **Atomic publish.** The two-slot symlink swap (Layer A) means at any
   point in time the `current` symlink targets a complete, valid slot.
   In-flight readers either see the old generation or the new
   generation, never a mix, never a missing file.
6. **publishVersion monotonicity.** Every publish — full or per-row —
   bumps `publishVersion`. Layer B uses it for cache eviction; Layer C
   includes it in hole URLs as a stale-detection mechanism.
7. **Dynamic detection is authoritative.** If `isDynamicNode` says a
   node is dynamic, the publisher MUST emit a placeholder; if it says
   static, the publisher MUST inline-render. There is no third option.
   This is the safety property that lets us claim "static by default,
   dynamic when needed."
8. **No editor-side UI for dynamism.** Auto-detection only. Adding a
   toggle later is a one-line edit if it ever becomes necessary, but
   it's explicitly out of scope here.

---

## Implementation order

**A → B → C, sequential, one job at a time.**

1. **Job 1 — Layer A.** Two-slot symlink swap, `staticAnalysis.ts`,
   `staticArtefact.ts`, integration into `publishDraftSite` and
   `publishDataRow`, router fast-path, `applyPublishedHtmlPipeline`
   move to publish-time. Tests as listed in Layer A's "Tests" block.
2. **Job 2 — Layer B.** `renderCache.ts`, single-flight LRU,
   `publishVersion` bumping. Tests as listed. Wires into the router
   immediately after Layer A's miss path.
3. **Job 3 — Layer C.** Auto-detection + dynamic-module flag +
   `staticPlaceholder` + hole endpoint + lazy runtime + plugin SDK doc
   update. Tests as listed. Updates Layer A's `isFullyStaticPage` to
   consult the dynamic-detection output.

Layer C depends on A (the `isFullyStaticPage` predicate) and benefits
from B (the hole endpoint caches via B). Doing them in order ensures
each subsequent layer slots into a clean foundation.

---

## Testing strategy

- **Per-layer:** unit tests in each new file; integration tests at the
  router level.
- **Architecture tests** added to `src/__tests__/architecture/`:
  - `publish-pipeline-publish-time-only.test.ts` — verifies
    `applyPublishedHtmlPipeline` is not imported from request-path
    files.
  - `static-artefact-served-before-render.test.ts` — verifies
    `readArtefact` is called before resolver/renderer in
    `publicRouter.ts`.
  - `dynamic-detection-single-pass.test.ts` — verifies the dynamic
    detection result is computed at publish time and not in the request
    path.
- **Benchmarks:** existing `bun run bench:http` covers cold + warm.
  Targets:
  - Fully-static route warm: ≤ 5 ms
  - Cached dynamic route warm: ≤ 5 ms
  - Hole fragment fetch: ≤ 10 ms warm (cached), ≤ 50 ms cold
- **Smoke:** `agent-browser` against the local admin to publish, then
  curl the public site and check the disk artefact is served from the
  active slot. Use the seeded `ai@ai.com / qwerty123456` creds (see
  `CLAUDE.md`).

---

## Open questions / future work

1. **Pre-render pagination?** Layer A says postType index pages with
   pagination are NOT fully-static (loop present). Layer B caches them.
   Future: should we pre-render the first N pagination pages to disk
   and only fall back to B on `?page > N`? Not in this spec; revisit
   after A/B/C ship.
2. **Per-loop revalidation TTL.** Layer B currently invalidates only on
   publish. A loop pulling from a live plugin source might want
   "refresh every 60 seconds." Add per-key TTL to renderCache later if
   the use-case shows up.
3. **Pre-warming the cache after publish.** After a `bumpPublishVersion`,
   the next visitors are cold-cache. A future enhancement: a
   background pre-render of the top N most-visited routes immediately
   after publish. Not needed for v1.
4. **Edge / CDN integration.** Layer A's disk artefacts ARE the kind of
   thing you'd rsync to a CDN. Out of scope here; the seam is clean if
   we ever want it.
5. **Ship the Publish artefacts to the browser** (PGlite /
   sql.js-httpvfs / static JSON manifest for client-side search) is a
   genuinely interesting future feature. Builds on Layer A. Explicit
   non-goal of this spec.

---

## References

- `server/publish/publicRouter.ts` — the existing single-entry resolver
  (post-unification).
- `server/repositories/publish.ts:publishDraftSite` — current publish
  entry for pages.
- `server/repositories/data/publish.ts:publishDataRow` — current publish
  entry for rows.
- `server/handlers/cms/loop.ts` — the loop pagination endpoint.
- `src/core/publisher/render.ts` — `publishPage` entry, `RenderContext`.
- `src/core/publisher/renderNode.ts` — per-node rendering walker.
- `src/core/module-engine/defineModule.ts` — the module-definition API.
- Astro Server Islands (`server:defer` + fallback slot) — the pattern
  Layer C follows.
- Next.js Partial Prerendering (cacheComponents) — the static-shell +
  dynamic-holes model A + C compose to mirror.
- Standard two-slot symlink atomic deploy pattern — used by nginx
  reload, Capistrano deploys, atomic rsync.
