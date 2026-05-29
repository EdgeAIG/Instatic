import '../../src/modules/base'
import '@core/loops/sources'
import { registry } from '@core/module-engine/registry'
import { publishPage } from '@core/publisher/render'
import { buildRouteFrame } from '@core/templates/contextFrames'
import { buildSiteCssBundle } from './siteCssBundle'
import { selectEntryTemplate } from '@core/templates/templateMatching'
import { prefetchLoopData, publishedDataRowToLoopItem } from './loopPrefetch'
import { prefetchMediaAssets } from './mediaPrefetch'
import { getPublishVersion } from './renderCache'
import type { PublishedDataRow } from '@core/data/schemas'
import type { DbClient } from '../db/client'
import type { PublishedPageSnapshot } from '../repositories/publish'

/**
 * URL prefix where the Bun server exposes the per-site CSS bundle. Mirrors
 * `/_pb/assets/` for runtime scripts. The matching route is registered in
 * `server/router.ts` and serves files with `Cache-Control: immutable`.
 */
const CSS_ASSET_BASE_URL = '/_pb/css/'

/** URL prefix for the loop data endpoint serving infinite-load fragments. */
const LOOP_ENDPOINT_BASE_URL = '/_pb/loop/'

/**
 * Renderer output — raw HTML body without plugin asset injection or the
 * `publish.html` filter applied. Post-processing runs ONCE at the
 * dispatcher (see `applyPublishedHtmlPipeline` in `server/router.ts`) so
 * every HTML-emitting path — pages, post templates, and the fallback
 * standalone data-row document — goes through the same pipeline. Adding
 * a new HTML-emitting code path means wiring it into the dispatcher
 * pipeline, not duplicating injection logic.
 */
export interface RendererOutput {
  html: string
  /** Identifies what was rendered, for the publish.html filter context. */
  pageId: string
  slug: string
  siteId: string
}

export interface RenderPublishedSnapshotContext {
  db: DbClient
  /** Optional request URL — when present, drives per-loop pagination. */
  url?: URL
  /**
   * Publish version to stamp into `<pb-hole data-pb-version>` placeholders.
   * Defaults to the live `getPublishVersion()`. The full/incremental publish
   * bakes shells BEFORE bumping the version, so it passes the next version
   * (`getPublishVersion() + 1`) here — otherwise every baked hole would carry
   * a stale version and the hole endpoint would refuse to hydrate it.
   */
  publishVersion?: number
}

export async function renderPublishedSnapshot(
  snapshot: PublishedPageSnapshot,
  ctx: RenderPublishedSnapshotContext,
): Promise<RendererOutput> {
  const page = snapshot.site.pages.find((candidate) => candidate.id === snapshot.pageRowId)
  if (!page) throw new Error(`Published page "${snapshot.pageRowId}" not found in snapshot`)
  const cssBundle = buildSiteCssBundle(snapshot.site, registry, page)
  const [loopData, mediaAssets] = await Promise.all([
    prefetchLoopData(page, snapshot.site, ctx.db, ctx.url),
    prefetchMediaAssets(page, registry, ctx.db),
  ])
  const html = publishPage(page, snapshot.site, registry, {
    runtimeAssets: snapshot.runtimeAssets,
    runtimePackageImportmap: snapshot.runtimePackageImportmap,
    cssEmission: 'external',
    cssBundle,
    cssAssetBaseUrl: CSS_ASSET_BASE_URL,
    loopData,
    mediaAssets,
    loopEndpointBaseUrl: LOOP_ENDPOINT_BASE_URL,
    publishVersion: ctx.publishVersion ?? getPublishVersion(),
    // Seed route frame from the actual request URL (when available) so
    // `{route.slug}` / `{route.path}` bindings resolve to live values.
    // publishPage falls back to the page permalink if no templateContext
    // is provided.
    templateContext: ctx.url
      ? { entryStack: [], route: buildRouteFrame(ctx.url.toString()) }
      : undefined,
  }).html
  return { html, pageId: snapshot.pageRowId, slug: page.slug, siteId: snapshot.site.id }
}

export async function renderPublishedDataRowTemplate(
  snapshot: PublishedPageSnapshot,
  row: PublishedDataRow,
  ctx: RenderPublishedSnapshotContext,
): Promise<RendererOutput | null> {
  const template = selectEntryTemplate(snapshot.site, row.tableSlug)
  if (!template) return null

  const cssBundle = buildSiteCssBundle(snapshot.site, registry, template)
  const [loopData, mediaAssets] = await Promise.all([
    prefetchLoopData(template, snapshot.site, ctx.db, ctx.url),
    prefetchMediaAssets(template, registry, ctx.db),
  ])
  const html = publishPage(template, snapshot.site, registry, {
    // Seed the entry stack with the published row + route frame from
    // the request URL. Loop interceptors push/pop iteration items on
    // top of this stack; nodes outside any loop resolve their
    // `currentEntry` bindings against this seed. page/site/viewer
    // frames are filled by `publishPage` from the document.
    templateContext: {
      entryStack: [publishedDataRowToLoopItem(row)],
      ...(ctx.url ? { route: buildRouteFrame(ctx.url.toString()) } : {}),
    },
    runtimeAssets: snapshot.runtimeAssets,
    runtimePackageImportmap: snapshot.runtimePackageImportmap,
    cssEmission: 'external',
    cssBundle,
    cssAssetBaseUrl: CSS_ASSET_BASE_URL,
    loopData,
    mediaAssets,
    loopEndpointBaseUrl: LOOP_ENDPOINT_BASE_URL,
    publishVersion: ctx.publishVersion ?? getPublishVersion(),
  }).html
  return { html, pageId: template.id, slug: template.slug, siteId: snapshot.site.id }
}
