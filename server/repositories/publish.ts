/**
 * Publish pipeline repository.
 *
 * Pages are stored in `data_rows` (table_id = 'pages'). Each published
 * version is a row in `data_row_versions` that carries `snapshot_json`
 * containing the full `PublishedPageSnapshot` (site document + runtime
 * assets). This replaces the old `page_versions` table.
 *
 * Public API:
 *   publishDraftSite          — build + store snapshots for all draft pages
 *   getPublishedPageBySlug    — look up a published page snapshot by slug
 *   getLatestPublishedSiteSnapshot — first published page snapshot (for 404s etc.)
 *   getDraftPublishStatus     — compare draft vs published state for the UI
 */
import { nanoid } from 'nanoid'
import type { SiteDocument } from '@core/page-tree'
import type { PublishedPageRuntimeAssets } from '@core/site-runtime'
import type { PublishedRuntimePackageImportmap } from '@core/publisher/render'
import type { PluginPageSummary } from '@core/plugin-sdk'
import { normalizeSiteRuntimeConfig } from '@core/site-runtime'
import { registry } from '@core/module-engine/registry'
import type { DbClient } from '../db/client'
import { loadDraftSite } from './site'
import { listDataRows } from './data'
import { pageFromRow } from '../../src/core/data/pageFromRow'
import { visualComponentFromRow } from '../../src/core/data/componentFromRow'
import { validateVisualComponents } from '../../src/core/persistence/validate'
import { buildSiteRuntimeScripts } from '../publish/runtime/bundleScripts'
import { ensureRuntimeDependencyCache } from '../publish/runtime/dependencyCache'
import {
  buildRuntimePackageImportmap,
  serializeImportmapForCsp,
} from '../publish/runtime/packageImportmap'
import { savePublishedRuntimeAssets } from './runtimeAsset'
import { renderPublishedSnapshot } from '../publish/publicRenderer'
import { applyPublishedHtmlPipeline } from '../publish/publishedHtmlPipeline'
import { prepareInactiveSlot, writeArtefact, writeStaticAsset, swapSlot } from '../publish/staticArtefact'
import { buildSiteCssBundle } from '../publish/siteCssBundle'
import { bumpPublishVersion, getPublishVersion } from '../publish/renderCache'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishedPageSnapshot {
  cmsSnapshotVersion: 1
  /** id of the `data_rows` row for this page (was `pageId` in the old schema). */
  pageRowId: string
  site: SiteDocument
  runtimeAssets?: PublishedPageRuntimeAssets
  /**
   * Pre-serialised importmap mapping bare specifiers like `three` to URLs
   * served from the host's runtime dependency cache. Stored verbatim in the
   * snapshot so re-renders use the same bytes the CSP hash was computed
   * over. Omitted when the site has no locked runtime dependencies.
   */
  runtimePackageImportmap?: PublishedRuntimePackageImportmap
}

interface PublishResult {
  publishedPages: number
}

interface DraftPublishStatus {
  hasPublishedVersion: boolean
  draftMatchesPublished: boolean
  draftPages: number
  publishedPages: number
  lastPublishedAt?: string
}

interface ActivePublishedRow {
  row_id: string
  snapshot_json: PublishedPageSnapshot
  published_at: string | Date
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function createSnapshot(
  site: SiteDocument,
  pageRowId: string,
  runtimeAssets?: PublishedPageRuntimeAssets,
  runtimePackageImportmap?: PublishedRuntimePackageImportmap,
): PublishedPageSnapshot {
  return {
    cmsSnapshotVersion: 1,
    pageRowId,
    site: structuredClone(site),
    ...(runtimeAssets && runtimeAssets.scripts.length > 0 ? { runtimeAssets } : {}),
    ...(runtimePackageImportmap ? { runtimePackageImportmap } : {}),
  }
}

async function nextVersionNumber(db: DbClient, rowId: string): Promise<number> {
  const { rows } = await db<{ next_version: number }>`
    select coalesce(max(version_number), 0) + 1 as next_version
    from data_row_versions
    where row_id = ${rowId}
  `
  return Number(rows[0]?.next_version ?? 1)
}

// ---------------------------------------------------------------------------
// Public functions
// ---------------------------------------------------------------------------

export async function getDraftPublishStatus(db: DbClient): Promise<DraftPublishStatus> {
  const shell = await loadDraftSite(db)
  if (!shell) {
    return {
      hasPublishedVersion: false,
      draftMatchesPublished: false,
      draftPages: 0,
      publishedPages: 0,
    }
  }

  const [pageRows, vcRows] = await Promise.all([
    listDataRows(db, 'pages'),
    listDataRows(db, 'components'),
  ])
  const visualComponents = validateVisualComponents(
    vcRows.flatMap((r) => { const vc = visualComponentFromRow(r); return vc ? [vc] : [] })
  )
  const draftSite: SiteDocument = {
    ...shell,
    pages: pageRows.map(pageFromRow),
    visualComponents,
  }

  const { rows: publishedRows } = await db<ActivePublishedRow>`
    select data_rows.id as row_id,
           data_row_versions.snapshot_json,
           data_row_versions.published_at
    from data_rows
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    where data_rows.table_id = 'pages'
      and data_rows.status = 'published'
      and data_rows.deleted_at is null
    order by data_rows.created_at asc
  `

  const draftSiteJson = canonicalJson(draftSite)
  const draftPageIds = new Set(draftSite.pages.map((page) => page.id))
  const draftMatchesPublished =
    publishedRows.length === draftSite.pages.length &&
    publishedRows.every((row) =>
      draftPageIds.has(row.row_id) &&
      canonicalJson(row.snapshot_json.site) === draftSiteJson
    )
  const lastPublishedAt = publishedRows
    .map((row) => new Date(row.published_at).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0]

  return {
    hasPublishedVersion: publishedRows.length > 0,
    draftMatchesPublished,
    draftPages: draftSite.pages.length,
    publishedPages: publishedRows.length,
    ...(lastPublishedAt ? { lastPublishedAt: new Date(lastPublishedAt).toISOString() } : {}),
  }
}

export async function publishDraftSite(
  db: DbClient,
  adminUserId: string,
  uploadsDir?: string,
): Promise<PublishResult> {
  const { publishedPages, snapshots, runtimeAssetFiles } = await db.transaction(async (tx) => {
    const shell = await loadDraftSite(tx)
    if (!shell) throw new Error('draft site not found')

    const [pageRows, vcRows] = await Promise.all([
      listDataRows(tx, 'pages'),
      listDataRows(tx, 'components'),
    ])
    const pages = pageRows.map(pageFromRow)
    const visualComponents = validateVisualComponents(
      vcRows.flatMap((r) => { const vc = visualComponentFromRow(r); return vc ? [vc] : [] })
    )
    const site: SiteDocument = { ...shell, pages, visualComponents }

    const runtime = normalizeSiteRuntimeConfig(site.runtime)
    const dependencyCache = Object.keys(runtime.dependencyLock.packages).length > 0
      ? await ensureRuntimeDependencyCache(runtime.dependencyLock)
      : undefined
    // Build the package importmap once per publish — the JSON is identical
    // for every page sharing the same lock, so its SHA-256 stays stable
    // across snapshots. Module plugins use bare imports (`import "three"`)
    // and the browser resolves them through this map at page load.
    const packageImportmap = dependencyCache
      ? await buildRuntimePackageImportmap(runtime.dependencyLock, dependencyCache)
      : null
    const serializedImportmap = packageImportmap
      ? await serializeImportmapForCsp(packageImportmap.importmap)
      : null
    const runtimePackageImportmap: PublishedRuntimePackageImportmap | undefined = serializedImportmap
      ? { body: serializedImportmap.body, sha256: serializedImportmap.sha256 }
      : undefined

    const publishedSite: SiteDocument = {
      ...site,
      pages: site.pages.map((page) => ({
        ...page,
        updatedByUserId: adminUserId,
      })),
    }

    const snapshots: PublishedPageSnapshot[] = []
    // Runtime JS bytes for every page, collected for the Layer A disk write so
    // published pages serve their scripts straight off disk (not the DB).
    const runtimeAssetFiles: Array<{ publicPath: string; bytes: Uint8Array }> = []
    for (const page of publishedSite.pages) {
      const version = await nextVersionNumber(tx, page.id)
      const versionId = nanoid()
      const runtimeBuild = await buildSiteRuntimeScripts({
        site: publishedSite,
        page,
        target: 'publish',
        assetBasePath: `/_pb/assets/${versionId}/`,
        dependencyCache,
      })
      const runtimeErrors = runtimeBuild.diagnostics.filter((d) => d.severity === 'error')
      if (runtimeErrors.length > 0) {
        throw new Error(`runtime build failed: ${runtimeErrors.map((d) => d.message).join('; ')}`)
      }

      const snapshot = createSnapshot(
        publishedSite,
        page.id,
        runtimeBuild.runtimeAssets,
        runtimePackageImportmap,
      )
      snapshots.push(snapshot)

      await tx`
        insert into data_row_versions
          (id, row_id, version_number, cells_json, slug, snapshot_json, published_by_user_id)
        values (
          ${versionId},
          ${page.id},
          ${version},
          ${{ title: page.title, slug: page.slug }},
          ${page.slug},
          ${snapshot},
          ${adminUserId}
        )
      `
      await savePublishedRuntimeAssets(tx, versionId, runtimeBuild.files)
      for (const file of runtimeBuild.files) {
        runtimeAssetFiles.push({ publicPath: file.publicPath, bytes: file.bytes })
      }
      await tx`
        update data_rows
        set active_version_id = ${versionId},
            status = 'published',
            published_by_user_id = ${adminUserId},
            published_at = current_timestamp,
            updated_by_user_id = ${adminUserId},
            updated_at = current_timestamp
        where id = ${page.id}
          and deleted_at is null
      `
    }

    return { publishedPages: publishedSite.pages.length, snapshots, runtimeAssetFiles }
  })

  // Layer A: write static artefacts outside the transaction. Disk artefacts
  // are derived state — a write failure is logged but does not roll back the
  // DB publish. Visitors fall through to the live renderer until the next
  // full publish rebuilds the slot.
  //
  // Complete static publishing: alongside each page's HTML we bake the CSS
  // bundles and runtime JS into the same slot under their public paths
  // (`/_pb/css/...`, `/_pb/assets/...`). The visitor router serves these off
  // disk, so a published page never hits the server to (re)generate its CSS
  // or JS — the slot is a self-contained static export.
  //
  // EVERY page is baked: fully-static pages bake to a complete document; pages
  // with dynamic nodes bake their static SHELL with `<pb-hole>` placeholders
  // (the hole runtime lazy-fetches each fragment from `/_pb/hole/`). Either way
  // the HTML + CSS + JS are served from disk — only the hole fragment touches
  // the server. The shells are stamped with `nextPublishVersion` (the version
  // that becomes current the instant `bumpPublishVersion()` runs after the
  // swap) so their `<pb-hole data-pb-version>` matches what the hole endpoint
  // expects; otherwise every baked hole would be rejected as stale.
  const nextPublishVersion = getPublishVersion() + 1
  if (uploadsDir) {
    try {
      const { slot, slotDir } = await prepareInactiveSlot(uploadsDir)

      // Every distinct static asset referenced by ANY published page.
      // Content-hashed filenames dedupe identical bytes across pages to a
      // single write.
      const assetsByPath = new Map<string, Uint8Array>()
      const encoder = new TextEncoder()
      for (const snapshot of snapshots) {
        const page = snapshot.site.pages.find((p) => p.id === snapshot.pageRowId)
        if (!page) continue
        const cssBundle = buildSiteCssBundle(snapshot.site, registry, page)
        for (const file of [cssBundle.reset, cssBundle.framework, cssBundle.style, cssBundle.userStyles]) {
          if (file.content.length === 0) continue
          const publicPath = `/_pb/css/${file.filename}`
          if (!assetsByPath.has(publicPath)) assetsByPath.set(publicPath, encoder.encode(file.content))
        }
      }
      for (const asset of runtimeAssetFiles) {
        if (!assetsByPath.has(asset.publicPath)) assetsByPath.set(asset.publicPath, asset.bytes)
      }
      for (const [publicPath, bytes] of assetsByPath) {
        await writeStaticAsset(slotDir, publicPath, bytes)
      }

      // HTML artefacts (or hole shells) for every page. A page that fails to
      // render (e.g. a VC ref cycle) is skipped and falls through to the live
      // renderer at request time — one bad page never aborts the whole bake.
      for (const snapshot of snapshots) {
        const page = snapshot.site.pages.find((p) => p.id === snapshot.pageRowId)
        if (!page) continue
        const urlPath = page.slug === 'index' ? '/' : `/${page.slug}`
        try {
          const syntheticUrl = new URL(`http://localhost${urlPath}`)
          const rendered = await renderPublishedSnapshot(snapshot, {
            db,
            url: syntheticUrl,
            publishVersion: nextPublishVersion,
          })
          const html = await applyPublishedHtmlPipeline(rendered, db)
          await writeArtefact(slotDir, urlPath, html)
        } catch (err) {
          console.error('[publish:site] failed to bake artefact for', urlPath, '(falls through to live renderer):', err)
        }
      }
      await swapSlot(uploadsDir, slot)
    } catch (err) {
      console.error('[publish:site] static artefact write failed (live renderer remains active):', err)
    }
  }

  // Layer B: invalidate the in-memory render cache so the next visitor request
  // re-renders against the freshly committed snapshot. This is the SYNCHRONOUS
  // statement right after the swap — no `await` between them — so there is no
  // window where the freshly-swapped shells (stamped nextPublishVersion) are
  // live while the version counter still reads the old value.
  bumpPublishVersion()

  return { publishedPages }
}

export async function getPublishedPageBySlug(
  db: DbClient,
  slug: string,
): Promise<PublishedPageSnapshot | null> {
  const { rows } = await db<{ snapshot_json: PublishedPageSnapshot }>`
    select data_row_versions.snapshot_json
    from data_rows
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    where data_rows.table_id = 'pages'
      and data_rows.slug = ${slug}
      and data_rows.status = 'published'
      and data_rows.deleted_at is null
    limit 1
  `
  return rows[0]?.snapshot_json ?? null
}

export async function getLatestPublishedSiteSnapshot(
  db: DbClient,
): Promise<PublishedPageSnapshot | null> {
  const { rows } = await db<{ snapshot_json: PublishedPageSnapshot }>`
    select data_row_versions.snapshot_json
    from data_rows
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    where data_rows.table_id = 'pages'
      and data_rows.status = 'published'
      and data_rows.deleted_at is null
    order by data_rows.created_at asc
    limit 1
  `
  return rows[0]?.snapshot_json ?? null
}

/**
 * Return a lightweight summary of every currently-published page.
 * Used by the plugin API surface `api.cms.pages.list()`.
 *
 * `cells_json` carries `{ title, slug }` as written by `publishDraftSite`.
 * `published_at` on the version row records when that snapshot was created.
 */
export async function listPluginPageSummaries(db: DbClient): Promise<PluginPageSummary[]> {
  const { rows } = await db<{
    row_id: string
    cells_json: { title?: string; slug?: string }
    slug: string
    published_at: string
  }>`
    select data_rows.id as row_id,
           data_row_versions.cells_json,
           data_row_versions.slug,
           data_row_versions.published_at
    from data_rows
    join data_row_versions on data_row_versions.id = data_rows.active_version_id
    where data_rows.table_id = 'pages'
      and data_rows.status = 'published'
      and data_rows.deleted_at is null
    order by data_rows.created_at asc
  `
  return rows.map((row) => ({
    id: row.row_id,
    slug: row.slug,
    title: typeof row.cells_json?.title === 'string' ? row.cells_json.title : row.slug,
    lastPublishedAt: typeof row.published_at === 'string'
      ? row.published_at
      : new Date(row.published_at).toISOString(),
  }))
}
