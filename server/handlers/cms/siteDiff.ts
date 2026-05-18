/**
 * Site-write diff validator — enforces granular capabilities on PUT /admin/api/cms/site.
 *
 * The save endpoint accepts the full `SiteDocument` and replaces the draft.
 * To support a "Client" role with `site.content.edit` only, we walk the diff
 * between the previously stored draft and the incoming one, and reject any
 * change whose category isn't covered by the caller's capabilities.
 *
 * Change categories
 *   structure — adding / removing / reordering / renaming pages or nodes,
 *               toggling lock/hidden, mutating classIds, toggling visibility,
 *               changing moduleId, adding/removing visual components, files,
 *               or breakpoints.
 *   content   — props whose schema control is category: 'content' (text,
 *               textarea, richtext, url, image, media, plus per-control
 *               overrides). The "client / copy editor" surface.
 *   style     — classes registry contents, settings.framework, settings.fonts,
 *               style breakpointOverrides (overrides on non-content props),
 *               file contents.
 *
 * Capability ↔ category mapping
 *   site.structure.edit → structure
 *   site.content.edit   → content
 *   site.style.edit     → style
 *
 * A caller may hold any subset. A change is allowed iff every category it
 * touches is covered by the caller's capability set. Anything not classified
 * above (language, packageJson, runtime, etc.) requires
 * `site.structure.edit` — those are deployment concerns, not "copy".
 * Site-wide SEO copy (`settings.metaTitle`, `settings.metaDescription`)
 * is classified as `content` because it's authored text that the
 * client / copy-editor persona owns; favicon and language remain
 * structural because they're install identity.
 *
 * First-save semantics: when there is no previous draft (`previous === null`),
 * the incoming document is treated as a structural change in its entirety —
 * a content-only caller cannot bootstrap a site from nothing.
 */
import '../../../src/modules/base'
import { registry } from '@core/module-engine/registry'
import { resolvePropertyControlCategory } from '@core/module-engine/propertySchema'
import type { CoreCapability } from '../../auth/capabilities'
import type {
  CSSClass,
  Page,
  PageNode,
  SiteDocument,
} from '@core/page-tree/schemas'

export type SiteChangeKind = 'structure' | 'content' | 'style'

export class ForbiddenSiteChangeError extends Error {
  // The TS `erasableSyntaxOnly` lint forbids constructor-parameter properties,
  // so the public fields are declared on the class body instead.
  readonly kind: SiteChangeKind
  readonly path: string
  readonly detail: string

  constructor(kind: SiteChangeKind, path: string, detail: string) {
    super(`forbidden ${kind} change at ${path}: ${detail}`)
    this.name = 'ForbiddenSiteChangeError'
    this.kind = kind
    this.path = path
    this.detail = detail
  }
}

const CAP_FOR_KIND: Record<SiteChangeKind, CoreCapability> = {
  structure: 'site.structure.edit',
  content: 'site.content.edit',
  style: 'site.style.edit',
}

interface DiffContext {
  capabilities: readonly CoreCapability[]
}

function allowed(ctx: DiffContext, kind: SiteChangeKind): boolean {
  return ctx.capabilities.includes(CAP_FOR_KIND[kind])
}

function fail(kind: SiteChangeKind, path: string, detail: string): never {
  throw new ForbiddenSiteChangeError(kind, path, detail)
}

function requireChange(ctx: DiffContext, kind: SiteChangeKind, path: string, detail: string): void {
  if (!allowed(ctx, kind)) fail(kind, path, detail)
}

/**
 * Validate the diff between `previous` and `next` against the caller's
 * capabilities. Throws `ForbiddenSiteChangeError` on the first disallowed
 * change. No-ops when the caller holds all three site-write capabilities.
 */
export function validateSiteWriteDiff(
  previous: SiteDocument | null,
  next: SiteDocument,
  capabilities: readonly CoreCapability[],
): void {
  // Fast path: a caller with the full set never needs the diff — they can
  // make any change. Saves cycles on the common case.
  if (
    capabilities.includes('site.structure.edit') &&
    capabilities.includes('site.content.edit') &&
    capabilities.includes('site.style.edit')
  ) {
    return
  }

  const ctx: DiffContext = { capabilities }

  // First save: a content-only caller cannot create the site from nothing.
  // Treat the whole document as a structural change.
  if (!previous) {
    requireChange(ctx, 'structure', '', 'no previous draft — full site create requires site.structure.edit')
    return
  }

  // Top-level meta — id and name changes are structural.
  if (previous.id !== next.id) {
    requireChange(ctx, 'structure', 'id', `${previous.id} → ${next.id}`)
  }
  if (previous.name !== next.name) {
    requireChange(ctx, 'structure', 'name', `"${previous.name}" → "${next.name}"`)
  }

  // Settings — split into chromatic-style fields (framework/fonts) and
  // structural fields (metaTitle/metaDescription/favicon/language/shortcuts).
  diffSettings(ctx, previous.settings, next.settings)

  // breakpoints — adding / removing / reordering is style infra.
  if (!deepEqual(previous.breakpoints, next.breakpoints)) {
    requireChange(ctx, 'style', 'breakpoints', 'breakpoint list changed')
  }

  // packageJson + runtime — deployment-level, structural.
  if (!deepEqual(previous.packageJson, next.packageJson)) {
    requireChange(ctx, 'structure', 'packageJson', 'package manifest changed')
  }
  if (!deepEqual(previous.runtime, next.runtime)) {
    requireChange(ctx, 'structure', 'runtime', 'runtime config changed')
  }

  // classes registry — every change is style. Add/remove/rename always counts
  // as style; mutation of an entry's styles bag is style. (A rename of a
  // class also requires nodes that reference the old id to be updated —
  // that surfaces as a structural classIds change below.)
  diffClassesMap(ctx, previous.classes, next.classes)

  // files — added/removed/renamed entries are structural; in-place content
  // edits to a `css`/`script` file are style; everything else is structural.
  diffFiles(ctx, previous.files, next.files)

  // visualComponents — every change is structural (definition trees own
  // structure; their styles inside VC tree count via the same nodes diff).
  if (!deepEqual(previous.visualComponents, next.visualComponents)) {
    requireChange(ctx, 'structure', 'visualComponents', 'visual component definitions changed')
  }

  // pages — the core diff. Walk by id; any add/remove is structural. For each
  // matched page, diff metadata then walk nodes.
  diffPages(ctx, previous.pages, next.pages)
}

// ---------------------------------------------------------------------------
// settings diff
// ---------------------------------------------------------------------------

function diffSettings(
  ctx: DiffContext,
  prev: SiteDocument['settings'],
  next: SiteDocument['settings'],
): void {
  // Style-side fields.
  if (!deepEqual(prev.framework, next.framework)) {
    requireChange(ctx, 'style', 'settings.framework', 'framework tokens changed')
  }
  if (!deepEqual(prev.fonts, next.fonts)) {
    requireChange(ctx, 'style', 'settings.fonts', 'fonts library changed')
  }

  // Content fields — site-wide SEO copy that the copy-editor persona owns.
  // metaTitle and metaDescription are authored strings rendered into <head>
  // exactly like a page title; treating them as structural would block the
  // most common task a Client role is hired to perform.
  const contentKeys: Array<keyof SiteDocument['settings']> = [
    'metaTitle',
    'metaDescription',
  ]
  for (const key of contentKeys) {
    if (!deepEqual(prev[key], next[key])) {
      requireChange(ctx, 'content', `settings.${String(key)}`, `${String(key)} changed`)
    }
  }

  // Structural fields — install identity / runtime config / editor prefs.
  // Favicon and language are install-level brand/identity decisions; the
  // shortcuts bag is editor preferences; fontImportUrl points at an
  // external typography stylesheet but lives in install config because
  // toggling it changes which assets ship with every published page.
  const structuralKeys: Array<keyof SiteDocument['settings']> = [
    'faviconUrl',
    'fontImportUrl',
    'language',
    'shortcuts',
  ]
  for (const key of structuralKeys) {
    if (!deepEqual(prev[key], next[key])) {
      requireChange(ctx, 'structure', `settings.${String(key)}`, `${String(key)} changed`)
    }
  }
}

// ---------------------------------------------------------------------------
// classes diff
// ---------------------------------------------------------------------------

function diffClassesMap(
  ctx: DiffContext,
  prev: Record<string, CSSClass>,
  next: Record<string, CSSClass>,
): void {
  const allIds = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const id of allIds) {
    const a = prev[id]
    const b = next[id]
    if (!a || !b) {
      // add or remove
      requireChange(ctx, 'style', `classes.${id}`, a ? 'removed' : 'added')
      continue
    }
    if (!deepEqual(a, b)) {
      requireChange(ctx, 'style', `classes.${id}`, 'class changed')
    }
  }
}

// ---------------------------------------------------------------------------
// files diff
// ---------------------------------------------------------------------------

function diffFiles(
  ctx: DiffContext,
  prev: SiteDocument['files'],
  next: SiteDocument['files'],
): void {
  const prevById = new Map(prev.map((f) => [f.id, f]))
  const nextById = new Map(next.map((f) => [f.id, f]))
  for (const id of new Set([...prevById.keys(), ...nextById.keys()])) {
    const a = prevById.get(id)
    const b = nextById.get(id)
    if (!a || !b) {
      requireChange(ctx, 'structure', `files.${id}`, a ? 'removed' : 'added')
      continue
    }
    if (a.path !== b.path || a.type !== b.type) {
      requireChange(ctx, 'structure', `files.${id}`, 'renamed or retyped')
    }
    if (a.content !== b.content) {
      // CSS / JS body edit is a style change; everything else is structural.
      const kind: SiteChangeKind = a.type === 'style' || a.type === 'script' ? 'style' : 'structure'
      requireChange(ctx, kind, `files.${id}.content`, 'file contents changed')
    }
  }
}

// ---------------------------------------------------------------------------
// pages diff
// ---------------------------------------------------------------------------

function diffPages(ctx: DiffContext, prev: Page[], next: Page[]): void {
  const prevById = new Map(prev.map((p) => [p.id, p]))
  const nextById = new Map(next.map((p) => [p.id, p]))

  // Add / remove / reorder of the page roster is structural.
  if (prev.length !== next.length) {
    requireChange(ctx, 'structure', 'pages', 'page count changed')
  } else {
    for (let i = 0; i < prev.length; i++) {
      if (prev[i].id !== next[i].id) {
        requireChange(ctx, 'structure', `pages[${i}]`, 'page order changed')
      }
    }
  }
  for (const id of new Set([...prevById.keys(), ...nextById.keys()])) {
    const a = prevById.get(id)
    const b = nextById.get(id)
    if (!a || !b) {
      requireChange(ctx, 'structure', `pages.${id}`, a ? 'removed' : 'added')
      continue
    }
    diffPage(ctx, a, b)
  }
}

function diffPage(ctx: DiffContext, prev: Page, next: Page): void {
  const path = `pages.${prev.id}`

  // Page metadata — title is content (page name shown to readers); slug,
  // template, ownership, rootNodeId are structural.
  if (prev.title !== next.title) {
    requireChange(ctx, 'content', `${path}.title`, 'page title changed')
  }
  if (prev.slug !== next.slug) {
    requireChange(ctx, 'structure', `${path}.slug`, 'page slug changed')
  }
  if (prev.rootNodeId !== next.rootNodeId) {
    requireChange(ctx, 'structure', `${path}.rootNodeId`, 'page root changed')
  }
  if (!deepEqual(prev.template ?? null, next.template ?? null)) {
    requireChange(ctx, 'structure', `${path}.template`, 'page template config changed')
  }
  if (prev.ownerUserId !== next.ownerUserId) {
    requireChange(ctx, 'structure', `${path}.ownerUserId`, 'page ownership changed')
  }

  // Node tree diff — walk by id.
  diffNodes(ctx, prev.nodes, next.nodes, `${path}.nodes`)
}

function diffNodes(
  ctx: DiffContext,
  prev: Record<string, PageNode>,
  next: Record<string, PageNode>,
  basePath: string,
): void {
  const allIds = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const id of allIds) {
    const a = prev[id]
    const b = next[id]
    if (!a || !b) {
      requireChange(ctx, 'structure', `${basePath}.${id}`, a ? 'node removed' : 'node added')
      continue
    }
    diffNode(ctx, a, b, `${basePath}.${id}`)
  }
}

function diffNode(ctx: DiffContext, prev: PageNode, next: PageNode, path: string): void {
  // moduleId: a node swapping to a different module is structural.
  if (prev.moduleId !== next.moduleId) {
    requireChange(ctx, 'structure', `${path}.moduleId`, `${prev.moduleId} → ${next.moduleId}`)
  }

  // Structural metadata.
  if (!arrayEqual(prev.children, next.children)) {
    requireChange(ctx, 'structure', `${path}.children`, 'children reordered or changed')
  }
  if ((prev.label ?? '') !== (next.label ?? '')) {
    requireChange(ctx, 'structure', `${path}.label`, 'node label changed')
  }
  if (Boolean(prev.locked) !== Boolean(next.locked)) {
    requireChange(ctx, 'structure', `${path}.locked`, 'locked flag changed')
  }
  if (Boolean(prev.hidden) !== Boolean(next.hidden)) {
    requireChange(ctx, 'structure', `${path}.hidden`, 'hidden flag changed')
  }
  if (!arrayEqual(prev.classIds, next.classIds)) {
    requireChange(ctx, 'structure', `${path}.classIds`, 'classIds changed')
  }
  if (!deepEqual(prev.propBindings ?? null, next.propBindings ?? null)) {
    requireChange(ctx, 'structure', `${path}.propBindings`, 'prop bindings changed')
  }
  if (!deepEqual(prev.dynamicBindings ?? null, next.dynamicBindings ?? null)) {
    requireChange(ctx, 'structure', `${path}.dynamicBindings`, 'dynamic bindings changed')
  }

  // Props — diff per-key against the module schema. Unknown moduleId or
  // missing schema entries are treated as structural (we can't classify
  // them safely without metadata).
  const definition = registry.get(prev.moduleId)
  const schema = definition?.schema ?? {}
  diffProps(ctx, prev.props, next.props, schema, `${path}.props`)

  // breakpointOverrides — same per-key classification, but scoped per bp.
  diffBreakpointOverrides(
    ctx,
    prev.breakpointOverrides,
    next.breakpointOverrides,
    schema,
    `${path}.breakpointOverrides`,
  )
}

function diffProps(
  ctx: DiffContext,
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  schema: Record<string, unknown>,
  basePath: string,
): void {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const key of keys) {
    if (deepEqual(prev[key], next[key])) continue
    const kind = classifyPropChange(schema, key)
    requireChange(ctx, kind, `${basePath}.${key}`, `prop ${key} changed`)
  }
}

function diffBreakpointOverrides(
  ctx: DiffContext,
  prev: Record<string, Record<string, unknown>>,
  next: Record<string, Record<string, unknown>>,
  schema: Record<string, unknown>,
  basePath: string,
): void {
  const bpIds = new Set([...Object.keys(prev), ...Object.keys(next)])
  for (const bp of bpIds) {
    const a = prev[bp] ?? {}
    const b = next[bp] ?? {}
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const key of keys) {
      if (deepEqual(a[key], b[key])) continue
      const kind = classifyPropChange(schema, key)
      requireChange(ctx, kind, `${basePath}.${bp}.${key}`, `override ${key} changed`)
    }
  }
}

/**
 * Resolve the change category for a single prop key against a module schema.
 *
 *  - Schema entry present → use its declared `category` (or the type-based
 *    default applied by `resolvePropertyControlCategory`).
 *  - Schema entry absent → 'structure' (we can't classify safely).
 */
function classifyPropChange(
  schema: Record<string, unknown>,
  key: string,
): SiteChangeKind {
  const entry = schema[key]
  if (!entry || typeof entry !== 'object') return 'structure'
  // The schema is typed `Record<string, PropertyControl>` at the source.
  // PropertyControl is a runtime-validated union; the registry stores it as
  // an unknown record so it can be safely consumed by either side. Cast at
  // the boundary — the value is already trusted because it came from a
  // registered module.
  const category = resolvePropertyControlCategory(
    entry as Parameters<typeof resolvePropertyControlCategory>[0],
  )
  return category === 'content' ? 'content' : 'structure'
}

// ---------------------------------------------------------------------------
// Small deep-equal helpers — tuned for the shapes we walk above (plain
// JSON-ish objects, no Maps / Sets / class instances).
// ---------------------------------------------------------------------------

function arrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  if (Array.isArray(b)) return false
  const aKeys = Object.keys(a as Record<string, unknown>)
  const bKeys = Object.keys(b as Record<string, unknown>)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false
    if (!deepEqual(
      (a as Record<string, unknown>)[k],
      (b as Record<string, unknown>)[k],
    )) return false
  }
  return true
}
