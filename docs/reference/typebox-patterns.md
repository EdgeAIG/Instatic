# TypeBox Patterns

How the codebase validates every untyped boundary with [TypeBox](https://github.com/sinclairzx81/typebox) — what helper to reach for, what shape a schema takes, and how to migrate from older Zod patterns.

The principle: **validate, then trust.** Every input from outside (HTTP, `JSON.parse`, plugin manifests, persisted JSON on disk) goes through a TypeBox schema. Inside the boundary, the code treats the value as the schema says it is — no `as Foo` casts.

Schemas are the **source of truth**. Domain types come from `Static<typeof Schema>`. There is no parallel `interface Foo` next to `FooSchema`.

---

## TL;DR

- **Helpers live in `src/core/utils/typeboxHelpers.ts`** — `Type`, `Value`, `Static`, `withFallback`, `parseValue`, `safeParseValue`, `filterArray`, `formatValueErrors`.
- **JSON boundary helpers live in `src/core/utils/jsonValidate.ts`** — `safeParseJson`, `parseJsonWithFallback`, `parseJsonResponse`.
- **Canonical client HTTP layer:** `@core/http` — `apiRequest(path, { schema, … })` (the default for browser→server calls), plus `ApiError`, `isAbortError`, `readEnvelope`, `responseErrorMessage`, `ErrorEnvelopeSchema`. All defined in `src/core/http/apiClient.ts`.
- **Schemas are source of truth.** `type Foo = Static<typeof FooSchema>` — never a hand-rolled interface beside the schema.
- **Soft fallbacks** for corrupted local storage / optional config use `withFallback(schema, default)` + `parseJsonWithFallback`.
- **Hard fallbacks** for required documents throw and bubble to an error boundary.
- **`zod` is banned outside `server/handlers/agent/tools.ts`.** That single exemption exists because `@anthropic-ai/claude-agent-sdk`'s `tool()` API requires `AnyZodRawShape`.

---

## The two boundary types

### Hard boundary — validate or fail

Use for inputs where invalid data is genuinely an error: HTTP request bodies, HTTP response envelopes the UI needs, required configuration files.

```ts
import { Type, parseValue } from '@core/utils/typeboxHelpers'

const RequestBodySchema = Type.Object({
  email:    Type.String({ format: 'email' }),
  password: Type.String({ minLength: 1 }),
})

const body = parseValue(RequestBodySchema, await req.json())
// body is now typed and validated; throws on invalid input
```

### Soft boundary — validate or fall back

Use for inputs where corruption shouldn't brick the UI: localStorage reads, optional persisted settings, tolerant array parsing where one bad entry shouldn't invalidate the rest.

```ts
import { parseJsonWithFallback } from '@core/utils/jsonValidate'

const prefs = parseJsonWithFallback(
  localStorage.getItem('editorPrefs') ?? '',
  EditorPreferencesSchema,
  DEFAULT_PREFERENCES,
)
// prefs is always valid; corrupted storage falls back silently
```

---

## Helper reference

### `src/core/utils/typeboxHelpers.ts`

| Helper                            | Purpose                                                              |
|-----------------------------------|----------------------------------------------------------------------|
| `Type`                            | Re-export from `@sinclair/typebox` — build schemas                   |
| `Value`                           | Re-export — run validation (`Value.Check`, `Value.Parse`, `Value.Decode`, `Value.Errors`) |
| `Static<typeof Schema>`           | Type inference — equivalent to `z.infer<typeof S>`                   |
| `parseValue(schema, value)`       | Strict parse; throws on invalid input. Use at hard boundaries.       |
| `safeParseValue(schema, value)`   | Discriminated union `{ ok: true, value } \| { ok: false, errors }`   |
| `withFallback(schema, fallback)`  | Annotate a schema with a default; consulted by `parseWithFallbackAnnotation` and similar |
| `filterArray(itemSchema, values)` | Filter an `unknown[]` keeping only items matching the schema         |
| `formatValueErrors(schema, value)`| Human-readable error message string for failed validation            |

### `src/core/utils/jsonValidate.ts`

| Helper                                          | Purpose                                                          |
|-------------------------------------------------|------------------------------------------------------------------|
| `safeParseJson(raw, schema)`                    | Parse a string as JSON + validate; returns `{ ok, value } \| { ok, error }` |
| `parseJsonWithFallback(raw, schema, default)`   | Best-effort read; returns the default on parse / validate failure|
| `parseJsonResponse(res, schema)`                | Validate `await res.json()` against a schema; throws on mismatch  |

### `src/core/http/apiClient.ts` (canonical client HTTP layer, `@core/http`)

| Helper                                          | Purpose                                                          |
|-------------------------------------------------|------------------------------------------------------------------|
| `apiRequest(path, { method, body, schema, query, signal, … })` | **The default for browser→server calls.** Sets `credentials`, JSON-serializes `body`, validates the success body against `schema` (returns `Static<schema>`; `void` without one), and throws `ApiError` on a non-OK status. |
| `readEnvelope(res, schema, fallbackMessage)`    | For code that already holds a `Response` (the persistence layer, which injects its own `fetch`): check `res.ok` (throw `ApiError` with `responseErrorMessage(res, fallback)` if not), then validate body against `schema` |
| `assertOk(res, fallbackMessage)`                | No-body counterpart to `readEnvelope`: throw `ApiError` if the `Response` is not OK, otherwise return (for void mutations / bodies parsed separately) |
| `responseErrorMessage(res, fallback)`           | Extract a useful error message from a failed `Response` (reads `{ error: string }` envelope if present, then raw text, otherwise the fallback) |
| `ApiError`                                      | The single error type thrown by `apiRequest`/`readEnvelope`; carries `.status` so UI can branch (403, 404, …) |
| `isAbortError(err)`                             | True for an aborted fetch (user cancellation / superseded request) — the uniform replacement for `(err as Error).name === 'AbortError'` |

---

## Cookbook

### Define a schema + derive a type

```ts
import { Type, type Static } from '@core/utils/typeboxHelpers'

export const FooSchema = Type.Object({
  id:        Type.String(),
  count:     Type.Number({ minimum: 0 }),
  optional:  Type.Optional(Type.String()),
  tags:      Type.Array(Type.String()),
})

export type Foo = Static<typeof FooSchema>
//   id: string
//   count: number
//   optional?: string
//   tags: string[]
```

**Never** write `interface Foo` next to `FooSchema`. The schema is the source of truth. If the type drifts from the schema, the schema wins.

### Validate a request body (server handler)

```ts
import { Type, parseValue } from '@core/utils/typeboxHelpers'
import { badRequest, jsonResponse, readJsonObject } from '../http'

const CreatePostSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 200 }),
  body:  Type.String(),
})

const raw = await readJsonObject(req)
let body
try {
  body = parseValue(CreatePostSchema, raw)
} catch (err) {
  return badRequest(getErrorMessage(err, 'Invalid body'))
}
// body is typed; proceed.
```

### Validate an HTTP response (client)

```ts
import { Type } from '@core/utils/typeboxHelpers'
import { apiRequest } from '@core/http'

const PostsResponseSchema = Type.Object({
  rows: Type.Array(PostSchema),
})

// Canonical client call: sets credentials, validates the body, throws ApiError.
const data = await apiRequest('/admin/api/cms/posts', { schema: PostsResponseSchema })
// data.rows is typed

// Code that already holds a Response (e.g. the persistence layer, which injects
// its own fetch) validates with readEnvelope instead:
//   const data = await readEnvelope(res, PostsResponseSchema, 'Failed to load posts')
```

### Validate persisted JSON (localStorage / DB JSON column)

```ts
import { safeParseJson, parseJsonWithFallback } from '@core/utils/jsonValidate'

// Hard: corruption is an error
const result = safeParseJson(localStorage.getItem('mustBeValid') ?? '', Schema)
if (!result.ok) {
  console.error('[prefs] corrupted store:', result.error)
  throw result.error
}
const data = result.value

// Soft: corruption falls back to defaults
const prefs = parseJsonWithFallback(
  localStorage.getItem('editorPrefs') ?? '',
  EditorPreferencesSchema,
  DEFAULT_PREFERENCES,
)
```

### Tolerant array — drop bad entries, keep the rest

```ts
import { Type, filterArray } from '@core/utils/typeboxHelpers'

const FontEntrySchema = Type.Object({ family: Type.String(), url: Type.String() })

// Site document with 5 fonts; one entry has a missing url.
// filterArray keeps the 4 good ones rather than failing the whole document.
const fonts = filterArray(FontEntrySchema, rawSite.fonts)
```

### Default for a missing field — `withFallback`

```ts
import { Type, withFallback } from '@core/utils/typeboxHelpers'

const SiteSettingsSchema = Type.Object({
  theme:       withFallback(Type.String(), 'dark'),
  breakpoints: withFallback(Type.Array(BreakpointSchema), DEFAULT_BREAKPOINTS),
})
```

The annotation is read by parsers like `parseWithFallbackAnnotation` to fill in missing values during a tolerant parse.

### Server error envelope

Every CMS handler error returns `{ error: string }`. `apiRequest` reads it automatically (via `responseErrorMessage`) and throws an `ApiError` carrying the HTTP status — so callers branch on the error type instead of re-checking `res.ok`:

```ts
import { apiRequest, ApiError } from '@core/http'

try {
  const site = await apiRequest('/admin/api/cms/site', {
    schema: SiteEnvelopeSchema,
    fallbackMessage: 'Failed to load site',
  })
} catch (err) {
  if (err instanceof ApiError && err.status === 403) {
    // render "no access" state
  }
  throw err
}
```

`apiRequest` is the default for browser→server calls. `readEnvelope` is the equivalent for code that already holds a `Response`.

### Throwing a typed error

For UI states that need to distinguish causes (e.g. "invalid page slug" vs. "duplicate slug"), use a typed subclass with a `path` field:

```ts
export class SiteValidationError extends Error {
  readonly path: string
  constructor(message: string, path: string) {
    super(`[persistence/validate] ${path}: ${message}`)
    this.name = 'SiteValidationError'
    this.path = path
  }
}
```

`path` is a dot-separated string identifying the field (`'site.pages[0].slug'`). The `[persistence/validate]` prefix is injected in the constructor — callers pass just the path. Already-existing typed errors in the codebase: `SiteValidationError`, `VisualComponentNameError`, `VisualComponentParamNameError`, `VisualComponentRecursionError`. Add one when the UI needs to render a specific error state.

---

## Migrating from Zod

The codebase migrated off Zod. If you encounter a remaining Zod pattern (outside the `server/handlers/agent/tools.ts` exemption), translate it:

| Zod                                                   | TypeBox                                                            |
|-------------------------------------------------------|--------------------------------------------------------------------|
| `z.infer<typeof X>`                                   | `Static<typeof X>`                                                  |
| `X.parse(v)` (strict)                                 | `parseValue(X, v)` or `Value.Parse(X, v)`                          |
| `X.safeParse(v)`                                      | `safeParseValue(X, v)` or `Value.Check(X, v)` for boolean-only      |
| `X.catch(default)` (soft fallback)                    | `withFallback(X, default)`                                          |
| `z.array(z.unknown()).transform(filter)`              | `filterArray(itemSchema, values)`                                   |
| `.transform()` / `.preprocess()` (data migration)     | Sibling parser helper functions (e.g. `parsePageNode`, `parseSitePage`) |
| `.refine()` (cross-field invariants)                  | Named guard functions called after `Value.Check`                    |

The exemption file `server/handlers/agent/tools.ts` exists because `@anthropic-ai/claude-agent-sdk`'s `tool()` API has a type-level `AnyZodRawShape` constraint that TypeBox can't satisfy. **No other Zod usage is allowed.** Gated by an import scan.

---

## Where validators are wired in the codebase

Common boundaries already wrapped — extend the same pattern when you add a new one:

| Boundary                                   | Helper                                              | Lives in                                |
|--------------------------------------------|-----------------------------------------------------|-----------------------------------------|
| HTTP request (client, canonical)           | `apiRequest(path, { schema, … })`                   | `src/core/http/apiClient.ts`            |
| HTTP response from a held `Response`        | `readEnvelope(res, Schema, fallback)`               | `src/core/http/apiClient.ts`            |
| HTTP body-validation primitive (no status semantics; `@core/http` internals, XHR, server-side external APIs) | `parseJsonResponse(res, Schema)` | `src/core/utils/jsonValidate.ts` |
| Request body (server handler)              | `parseValue(Schema, await readJsonObject(req))`     | `server/http.ts` + per-handler          |
| `JSON.parse` of localStorage               | `parseJsonWithFallback(raw, Schema, default)`       | `src/core/utils/jsonValidate.ts`        |
| `JSON.parse` of disk JSON                  | `safeParseJson(raw, Schema)`                        | `src/core/utils/jsonValidate.ts`        |
| Plugin manifest                            | `parsePluginManifest(raw)`                          | `src/core/plugins/manifest.ts`          |
| Site shell loaded from storage             | `validateSite(raw)`                                 | `src/core/persistence/validate.ts`      |
| Page roster loaded from storage            | `validatePages(shell, rawPages, vcs)`               | `src/core/persistence/validate.ts`      |
| VC roster loaded from storage (read path)  | `validateVisualComponents(rawVCs)`                  | `src/core/persistence/validate.ts`      |
| VC roster on write (fail-closed)           | `validateVisualComponentsForWrite(rawVCs)`          | `src/core/persistence/validate.ts`      |
| Page-tree payload from plugin RPC / disk   | `parsePageNodeTree(raw)`                            | `src/core/page-tree/operationSchema.ts` |
| DB JSON columns (after auto-parse)         | Per-repository TypeBox schema                       | `server/repositories/*.ts`              |
| Response schemas (shared)                  | `responseSchemas.ts`                                | `src/core/persistence/responseSchemas.ts`|

---

## Forbidden patterns

| Pattern                                                       | Use instead                                                     |
|---------------------------------------------------------------|-----------------------------------------------------------------|
| `await res.json() as Foo`                                     | `apiRequest(path, { schema })` (client) or `readEnvelope(res, FooSchema, msg)` (held `Response`) — `parseJsonResponse` only for `@core/http` internals / XHR / server-side |
| `JSON.parse(raw) as Foo`                                      | `safeParseJson(raw, FooSchema)` / `parseJsonWithFallback`       |
| Hand-rolled `interface Foo` next to a `FooSchema`             | `type Foo = Static<typeof FooSchema>`                            |
| Importing `zod` in app code                                   | TypeBox — the only legitimate `zod` use is `server/handlers/agent/tools.ts` |
| `try { JSON.parse(raw) } catch (err) { /* swallow */ }`       | `parseJsonWithFallback` for soft, `safeParseJson` for hard       |
| `if (typeof body.email !== 'string') return badRequest(...)` (ad-hoc shape check) | TypeBox schema + `parseValue`                       |
| Re-wrapping `Error` in a way that loses the original cause    | `new Error(message, { cause: err })`                             |
| Silently catching errors (`catch (err) {}`)                   | Name the binding `catch (_err)` and add a one-line comment, or handle the error |

---

## Related

- [docs/architecture.md](../architecture.md) — system overview (TypeBox at every boundary)
- [docs/server.md](../server.md) — server validation patterns
- [docs/editor.md](../editor.md) — editor store + persistence
- Source-of-truth files:
  - `src/core/utils/typeboxHelpers.ts` — helper layer (`parseValue`, `withFallback`, `filterArray`, etc.)
  - `src/core/utils/jsonValidate.ts` — JSON boundary helpers
  - `src/core/http/apiClient.ts` — `apiRequest`, `ApiError`, `isAbortError`, `readEnvelope`, `assertOk`, `responseErrorMessage`, `ErrorEnvelopeSchema`
  - `src/core/persistence/responseSchemas.ts` — shared CMS HTTP response schemas
  - `src/core/persistence/validate.ts` — `validateSite`, `SiteValidationError`
  - `src/core/plugins/manifest.ts` — `parsePluginManifest`
  - `server/http.ts` — `readJsonObject`, `jsonResponse`, `badRequest`
  - `server/handlers/agent/tools.ts` — the one legitimate `zod` exemption
- Gate tests:
  - `src/__tests__/architecture/boundary-validation.test.ts` — enforces the four HTTP / JSON-parse boundary rules (no `res.json() as`, no `JSON.parse as`, no raw `fetch(` in admin, no raw `req.json(` in server handlers)
  - `src/__tests__/architecture/no-anthropic-sdk.test.ts` — bans `@anthropic-ai/sdk` and `zod` outside the one exemption
