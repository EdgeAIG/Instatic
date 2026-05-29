/**
 * SiteDocument / SiteShell — top-level persisted site shell.
 *
 * The top-level site shell stored in the CMS `site` table.
 *
 * Pages live in `data_rows` where `table_id = 'pages'`.
 * Visual Components live in `data_rows` where `table_id = 'components'`.
 *
 * Neither pages nor VCs are embedded in the shell. The adapter assembles the
 * full `SiteDocument` (shell + pages + visualComponents) on load; the shell is
 * saved independently on each PUT /admin/api/cms/site call.
 *
 * Resilience semantics (via parseSiteDocument):
 *   THROWS (no fallback) if missing / wrong type:
 *     id, name, breakpoints, createdAt, updatedAt
 *
 *   RESILIENT (fallback to default):
 *     settings → DEFAULT_SITE_SETTINGS
 *     packageJson → { dependencies: {}, devDependencies: {} }
 *     runtime → normalizeSiteRuntimeConfig (tolerant: fills scripts/styles/lock)
 *
 *   Per-entry leniency:
 *     classes — entries missing id/name are silently dropped
 *     files — invalid entries are silently dropped
 *
 * Constraint #269: no imports from editor / editor-store here.
 */

import { Type, Value, type Static } from '@core/utils/typeboxHelpers'
import { BreakpointSchema, type Breakpoint, parseBreakpoint } from './breakpoint'
import { CSSClassSchema, parseClassRegistry } from './cssClass'
import { SiteSettingsSchema, parseSiteSettings } from './siteSettings'
import { SiteFileSchema, type SiteFile, type SiteFileType } from '@core/files/schemas'
import { SiteRuntimeConfigSchema, type SiteRuntimeConfig } from '@core/site-runtime/schemas'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime/runtimeConfig'
import { SitePackageJsonSchema, type SitePackageJson } from '@core/site-dependencies/manifest'
import { type VisualComponent } from '@core/visualComponents/schemas'
import type { Page } from './page'

// ---------------------------------------------------------------------------
// SiteDocumentSchema — top-level persisted site shell (pages and VCs stored separately)
//
// NOTE: this declaration is read literally by the architecture gate
// `src/__tests__/architecture/no-vc-in-site-shell.test.ts` (Gate SH-1), which
// scans for the schema declaration below and asserts no visualComponents key
// appears inside its object body. Do not rename the identifier or rewrite the
// declaration in a form that breaks that scanner without updating the gate at
// the same time.
// ---------------------------------------------------------------------------

const SiteDocumentSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  breakpoints: Type.Array(BreakpointSchema),
  settings: SiteSettingsSchema,
  /** Class registry — required object */
  classes: Type.Record(Type.String(), CSSClassSchema),
  /** Site files — required array */
  files: Type.Array(SiteFileSchema),
  packageJson: SitePackageJsonSchema,
  runtime: SiteRuntimeConfigSchema,
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
})

/**
 * The persisted site shell: everything except pages and visual components.
 * Pages live in `data_rows` (table_id = 'pages').
 * Visual Components live in `data_rows` (table_id = 'components').
 * Both are loaded separately and assembled into `SiteDocument`.
 */
export const SiteShellSchema = SiteDocumentSchema
export type SiteShell = Static<typeof SiteShellSchema>

/**
 * In-memory site document: the full shell plus pages and visual components.
 * Assembled by the adapter on load; never stored directly.
 */
export type SiteDocument = SiteShell & { pages: Page[]; visualComponents: VisualComponent[] }

// ---------------------------------------------------------------------------
// Tolerant parsing
// ---------------------------------------------------------------------------

const VALID_SITE_FILE_TYPES: SiteFileType[] = ['component', 'script', 'style', 'asset', 'config', 'doc']

/**
 * Parse a SiteFile. Keeps the file with blob=undefined when the blob is
 * malformed (mimeType or base64 missing/wrong type) — mirrors the
 * "lenient" blob semantics documented on SiteFileSchema.blob.
 *
 * Returns null only for missing required fields (id, path, type).
 */
function parseSiteFile(raw: unknown): SiteFile | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  if (typeof r.path !== 'string') return null
  if (!VALID_SITE_FILE_TYPES.includes(r.type as SiteFileType)) return null

  // Blob: silently becomes undefined when mimeType or base64 is not a string
  let blob: SiteFile['blob'] = undefined
  if (r.blob && typeof r.blob === 'object' && !Array.isArray(r.blob)) {
    const b = r.blob as Record<string, unknown>
    if (typeof b.mimeType === 'string' && typeof b.base64 === 'string') {
      blob = { mimeType: b.mimeType, base64: b.base64 }
    }
    // malformed blob → blob remains undefined; file is still included
  }

  const createdAt = typeof r.createdAt === 'number' ? r.createdAt : Date.now()
  const updatedAt = typeof r.updatedAt === 'number' ? r.updatedAt : Date.now()

  return {
    id: r.id,
    path: r.path,
    type: r.type as SiteFileType,
    ...(typeof r.content === 'string' ? { content: r.content } : {}),
    ...(blob !== undefined ? { blob } : {}),
    ...(typeof r.generated === 'boolean' ? { generated: r.generated } : {}),
    ...(typeof r.ejected === 'boolean' ? { ejected: r.ejected } : {}),
    createdAt,
    updatedAt,
  }
}

const DEFAULT_PACKAGE_JSON: SitePackageJson = { dependencies: {}, devDependencies: {} }

/**
 * Tolerant parser for a site shell loaded from the `site` table.
 *
 * Throws if required fields (id, name, breakpoints, createdAt, updatedAt)
 * are missing or of the wrong type. Silently drops/defaults invalid entries
 * in classes, files, settings, etc.
 *
 * Pages and Visual Components are NOT parsed here — they live in `data_rows`
 * and are loaded separately:
 *   - pages: via `parsePage` + `validatePages` in `@core/persistence/validate`
 *   - VCs: via `visualComponentFromRow` + `validateVisualComponents` in
 *          `@core/persistence/validate`
 *
 * Use this in place of `parseValue(SiteDocumentSchema, raw)` when reading
 * persisted site shells. After this returns, run `runShellPostChecks` in
 * `persistence/validate.ts` for cross-cutting invariants.
 */
export function parseSiteDocument(raw: unknown): SiteShell {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('not an object')
  }
  const r = raw as Record<string, unknown>

  if (typeof r.id !== 'string') throw new Error('id must be a string')
  if (typeof r.name !== 'string') throw new Error('name must be a string')
  if (typeof r.createdAt !== 'number') throw new Error('createdAt must be a number')
  if (typeof r.updatedAt !== 'number') throw new Error('updatedAt must be a number')

  // Breakpoints — required array, per-item has icon fallback
  if (!Array.isArray(r.breakpoints)) throw new Error('breakpoints must be an array')
  const breakpoints: Breakpoint[] = []
  for (let i = 0; i < r.breakpoints.length; i++) {
    const bp = parseBreakpoint(r.breakpoints[i])
    if (!bp) throw new Error(`breakpoints[${i}] is invalid`)
    breakpoints.push(bp)
  }

  // Classes — required object, per-entry leniency
  const classes = parseClassRegistry(r.classes)

  // Files — required array, per-entry leniency (parseSiteFile keeps files with malformed blobs)
  const files: SiteFile[] = Array.isArray(r.files)
    ? r.files.flatMap((item) => {
        const file = parseSiteFile(item)
        return file ? [file] : []
      })
    : []

  // Settings — resilient, falls back to DEFAULT_SITE_SETTINGS
  const settings = parseSiteSettings(r.settings)

  // PackageJson — resilient, falls back to DEFAULT_PACKAGE_JSON
  const packageJson: SitePackageJson = Value.Check(SitePackageJsonSchema, r.packageJson)
    ? (r.packageJson as SitePackageJson)
    : DEFAULT_PACKAGE_JSON

  // Runtime — tolerant normalize: fills missing/partial fields (e.g. a site
  // persisted before `styles` existed) while preserving valid scripts/lock.
  const runtime: SiteRuntimeConfig = normalizeSiteRuntimeConfig(r.runtime)

  return {
    id: r.id,
    name: r.name,
    breakpoints,
    settings,
    classes,
    files,
    packageJson,
    runtime,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}
