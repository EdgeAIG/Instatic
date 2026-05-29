/**
 * Site CSS bundle — server-side builder.
 *
 * Builds the three external CSS files served at `/_pb/css/<filename>` for
 * every published page. See `src/core/publisher/siteCssBundle.ts` for the type
 * definitions and the cache strategy rationale (hashed filenames + immutable
 * cache headers).
 *
 * This file lives under `server/cms/` because it depends on `node:crypto` for
 * content hashing — that import is unavailable in the editor's app build, so
 * the implementation is server-only. The published-page renderer
 * (`publicRenderer.ts`) and the CSS route handler (`router.ts`) call it on
 * every request.
 *
 * Why rebuild on every request?
 * - Bundles are tiny (kB) and the build is microseconds (deduped by moduleId).
 * - Browsers / CDNs cache the response for a year (`immutable`), so the
 *   route handler only fires for the FIRST visitor of a given hash.
 * - When the site's hash changes (a class was edited, the framework was
 *   reconfigured), HTML pages re-render with the new `<link href>` referencing
 *   the new filename, and visitors fetch the new bundle exactly once.
 */

import { createHash } from 'node:crypto'
import type { Page, SiteDocument } from '@core/page-tree'
import type { IModuleRegistry } from '@core/module-engine/types'
import { PUBLISHER_RESET_CSS } from '@core/publisher/reset'
import { collectClassCSS } from '@core/publisher/cssCollector'
import { buildSiteFrameworkCss } from '@core/publisher/frameworkCss'
import { renderNode, type RenderContext } from '@core/publisher/render'
import { collectUserStylesheetCss } from '@core/publisher/userStylesheets'
import type {
  CssBundleFile,
  SiteCssBundle,
  SiteCssBundleId,
} from '@core/publisher/siteCssBundle'

/**
 * Build the four site CSS files from a `SiteDocument`.
 *
 * `reset`, `framework`, and `style` are page-invariant — they depend only on
 * the site + registry. `userStyles` is page-scoped: each stylesheet's
 * `SiteStyleRuntimeConfig` decides whether it targets `page`, and `priority`
 * orders the cascade. Passing different pages therefore yields different
 * `userStyles` content (and hash); omitting `page` includes every enabled
 * stylesheet (authoring/export view).
 *
 * Determinism + content-hashed filenames mean two calls with the same inputs
 * always return identical filenames — safe to call on every request without
 * memoisation.
 */
export function buildSiteCssBundle(
  site: SiteDocument,
  registry: IModuleRegistry,
  page?: Page,
): SiteCssBundle {
  return {
    reset: makeBundleFile('reset', PUBLISHER_RESET_CSS),
    framework: makeBundleFile('framework', buildFrameworkCss(site, registry)),
    style: makeBundleFile('style', collectClassCSS(site)),
    userStyles: makeBundleFile('userStyles', collectUserStylesheetCss(site, page)),
  }
}

/**
 * Build the `framework.css` body: site-wide platform CSS plus any plugin
 * module CSS used anywhere on the site.
 */
function buildFrameworkCss(site: SiteDocument, registry: IModuleRegistry): string {
  const frameworkCss = buildSiteFrameworkCss(site)
  const moduleCss = collectAllModuleCss(site, registry)
  return [frameworkCss, moduleCss].filter(Boolean).join('\n')
}

/**
 * Walk every page's node tree and accumulate module CSS deduped by moduleId.
 *
 * The walker is `renderNode`, which also produces HTML strings — those are
 * thrown away here. Discarding the HTML is cheaper than maintaining a
 * separate CSS-only walker that would drift from the canonical render path
 * over time. The cssMap is shared across pages, so a module's CSS is
 * collected at most once for the whole site even if it appears on every page.
 *
 * Note: every base module emits `css: ''` — they are pure semantic-HTML
 * emitters and styling comes exclusively from user classes. The module-CSS
 * path exists for plugin modules that *might* emit CSS via their `render()`
 * return.
 */
function collectAllModuleCss(site: SiteDocument, registry: IModuleRegistry): string {
  const cssMap = new Map<string, string>()
  for (const page of site.pages) {
    const ctx: RenderContext = {
      page,
      site,
      registry,
      breakpointId: undefined,
      cssMap,
    }
    renderNode(page.rootNodeId, ctx)
  }
  return Array.from(cssMap.values()).join('\n')
}

/**
 * Wrap a CSS body in a `CssBundleFile`. The hash is content-derived so
 * filenames are stable across servers, processes, and process restarts —
 * good for CDN cache reuse.
 *
 * 12-hex-char SHA-256 prefix = 48 bits of entropy ≈ 2.8e14 distinct values.
 * Collision-free for any realistic CMS site count.
 */
function makeBundleFile(
  bundle: SiteCssBundleId,
  content: string,
): CssBundleFile {
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12)
  return {
    bundle,
    filename: `${bundle}-${hash}.css`,
    hash,
    content,
  }
}
