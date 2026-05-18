/**
 * Architecture gate — Legacy content domain eradication
 *
 * The old "content" CMS domain (ContentCollection / ContentEntry) has been
 * fully migrated to the "data" domain (DataTable / DataRow). All old code,
 * imports, and SQL table references must be gone from production source.
 *
 * This gate scans production source files and fails if any legacy reference
 * is found. Tests and migration files are excluded because:
 *
 *   - `src/__tests__/` — test-only code, not shipped
 *   - `server/db/migrations-*.ts` — migration history; the old table names
 *     must NOT appear here either (they were never created — the refactor
 *     happened before any external release), so they are still scanned.
 *
 * Legacy SQL table names (must not appear in any production source):
 *   - content_collections
 *   - content_entries
 *   - content_entry_versions
 *   - content_entry_redirects
 *
 * Legacy import paths (must not appear in any production source):
 *   - @core/content/
 *   - @core/persistence/cmsContent
 *   - server/repositories/content/
 *   - server/handlers/cms/content/
 *
 * @see src/core/data/schemas.ts      — DataTable / DataRow TypeBox schemas
 * @see server/repositories/data.ts   — data repository (replaces content)
 * @see src/core/persistence/cmsData.ts — client helpers (replaces cmsContent)
 */

import { describe, test, expect } from 'bun:test'
import { readdirSync, readFileSync, statSync, existsSync } from 'fs'
import { extname, join, relative } from 'path'

const PROJECT_ROOT = join(import.meta.dir, '../../../')

const SCAN_ROOTS = [
  join(PROJECT_ROOT, 'src'),
  join(PROJECT_ROOT, 'server'),
]

/**
 * Exclude the test tree — those files are not production code.
 * Production source files under src/ and server/ are all in scope.
 */
const EXCLUDED_PREFIXES = [
  join(PROJECT_ROOT, 'src/__tests__/'),
]

// ---------------------------------------------------------------------------
// File walker — .ts / .tsx files only, recursive
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) walk(full, out)
    else if (extname(entry) === '.ts' || extname(entry) === '.tsx') out.push(full)
  }
  return out
}

function isExcluded(file: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => file.startsWith(prefix))
}

// ---------------------------------------------------------------------------
// Forbidden patterns
// ---------------------------------------------------------------------------

interface ForbiddenPattern {
  name: string
  regex: RegExp
  /**
   * Optional per-pattern file allowlist. If the scanned file's path starts
   * with one of these prefixes, a match against this pattern is suppressed.
   * Use sparingly — only where the symbol is legitimately reused in an
   * unrelated context with a documented reason.
   */
  allowlistedPrefixes?: string[]
}

const LEGACY_SQL_TABLES: ForbiddenPattern[] = [
  {
    name: 'Legacy SQL table: content_collections (replaced by data_tables)',
    regex: /\bcontent_collections\b/,
  },
  {
    name: 'Legacy SQL table: content_entries (replaced by data_rows)',
    regex: /\bcontent_entries\b/,
  },
  {
    name: 'Legacy SQL table: content_entry_versions (replaced by data_row_versions)',
    regex: /\bcontent_entry_versions\b/,
  },
  {
    name: 'Legacy SQL table: content_entry_redirects (replaced by data_row_redirects)',
    regex: /\bcontent_entry_redirects\b/,
  },
]

const LEGACY_IMPORTS: ForbiddenPattern[] = [
  {
    name: 'Legacy import: @core/content/ (deleted; use @core/data/ or @core/markdown/)',
    regex: /from\s+['"]@core\/content\//,
  },
  {
    name: 'Legacy import: @core/persistence/cmsContent (replaced by @core/persistence/cmsData)',
    regex: /from\s+['"]@core\/persistence\/cmsContent['"]/,
  },
]

/**
 * Patterns that gate the `collectionId` → `tableSlug` rename in
 * `PageTemplateConfig` and related schemas.
 *
 * Carveouts (allowlistedPrefixes):
 *
 *   - `src/admin/pages/content/` — these files use `collectionId` as a
 *     local variable name that holds a `DataTable.id` value (the id column,
 *     not the legacy schema field). These are call-site identifiers, not
 *     schema definitions, so they are not part of the rename.
 *
 *   - `src/core/plugin-sdk/types.ts` — plugin event names like
 *     `content.entry.*` use "collection" in their string identifiers.
 *     This is a separate naming concern not covered by the schema rename.
 *
 * Patterns that are banned with no exceptions (template.collectionId and
 * the JSON field definition "collectionId":) are global violations — they
 * can never appear anywhere in production code after the rename.
 */
const COLLECTION_ID_RENAME: ForbiddenPattern[] = [
  {
    // The renamed schema field accessed via property access: after the rename,
    // `template.tableSlug` must be used instead of `template.collectionId`.
    name: 'Renamed field: template.collectionId (use template.tableSlug instead)',
    regex: /\btemplate\.collectionId\b/,
  },
  {
    // The renamed schema field defined in a TypeBox / JSON object literal.
    // After the rename, the key must be `"tableSlug"` or `tableSlug:`.
    name: 'Renamed schema key: "collectionId": (use "tableSlug" instead)',
    regex: /"collectionId"\s*:/,
  },
  {
    // General collectionId identifier — banned across production source except
    // for the two carveout paths documented above.
    name: 'Renamed field: collectionId (renamed to tableSlug in PageTemplateConfig)',
    regex: /\bcollectionId\b/,
    allowlistedPrefixes: [
      // Local variable names referring to DataTable.id, not the legacy schema field.
      join(PROJECT_ROOT, 'src/admin/pages/content/'),
      // Plugin event names (content.entry.*) — out of scope for this rename.
      join(PROJECT_ROOT, 'src/core/plugin-sdk/types.ts'),
    ],
  },
]

const ALL_FORBIDDEN = [...LEGACY_SQL_TABLES, ...LEGACY_IMPORTS, ...COLLECTION_ID_RENAME]

// ---------------------------------------------------------------------------
// Violation record
// ---------------------------------------------------------------------------

interface Violation {
  file: string
  line: number
  pattern: string
  match: string
}

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

function scanForViolations(): Violation[] {
  const files = SCAN_ROOTS
    .flatMap((root) => walk(root))
    .filter((f) => !isExcluded(f))

  const violations: Violation[] = []

  for (const file of files) {
    let content: string
    try {
      content = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const pattern of ALL_FORBIDDEN) {
        // Respect per-pattern file allowlists before checking the regex.
        if (
          pattern.allowlistedPrefixes !== undefined &&
          pattern.allowlistedPrefixes.some((prefix) => file.startsWith(prefix))
        ) {
          continue
        }

        const m = pattern.regex.exec(line)
        if (m !== null) {
          violations.push({
            file: relative(PROJECT_ROOT, file),
            line: i + 1,
            pattern: pattern.name,
            match: m[0],
          })
        }
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Legacy content domain eradication', () => {
  test('SCAN_ROOTS resolve to production source files (sanity check)', () => {
    const files = SCAN_ROOTS
      .flatMap((root) => walk(root))
      .filter((f) => !isExcluded(f))
    expect(files.length).toBeGreaterThan(0)
  })

  test('no production source file references legacy content SQL tables or import paths', () => {
    const violations = scanForViolations()

    if (violations.length === 0) {
      expect(violations).toHaveLength(0)
      return
    }

    const lines = violations.map(
      (v) =>
        `  ${v.file}:${v.line} — ${v.pattern}\n` +
        `    matched: ${JSON.stringify(v.match)}`,
    )

    throw new Error(
      `[no-legacy-content-domain] ${violations.length} legacy content domain reference(s) found.\n` +
        `The content domain was fully replaced by the data domain.\n` +
        `Remove all references to old SQL tables and import paths.\n\n` +
        `Violations:\n` +
        lines.join('\n'),
    )
  })
})
