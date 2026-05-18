/**
 * Fonts library endpoints.
 *
 *   GET    /admin/api/cms/fonts/google           — bundled Google Fonts directory (no CDN hit)
 *   POST   /admin/api/cms/fonts/estimate         — sum woff2 `Content-Length` for a selection
 *   POST   /admin/api/cms/fonts/install          — download woff2 files, return a FontEntry
 *   DELETE /admin/api/cms/fonts/family/:family   — remove on-disk font files for a family
 *
 * The fonts library itself lives inside `site.settings.fonts`, so this REST
 * surface is intentionally narrow: install + uninstall perform on-disk
 * work; the metadata is persisted with the rest of the site settings via
 * `PUT /admin/api/cms/site`. All endpoints are gated by `site.style.edit`
 * — fonts are typography / visual setup, not content edits.
 */
import type { DbClient } from '../../db/client'
import { requireCapability } from '../../auth/authz'
import { estimateGoogleFont, FontInstallError, installGoogleFont, uninstallFontFamily } from '../../repositories/fonts'
import { listGoogleFonts } from '@core/fonts/googleDirectory'
import { badRequest, jsonResponse, methodNotAllowed, readJsonObject } from '../../http'
import { readString, type CmsHandlerOptions } from './shared'

interface GoogleFontSelection {
  family: string
  variants: string[]
  subsets: string[]
}

/**
 * Validate the JSON body shared by `/fonts/estimate` and `/fonts/install`. The
 * two endpoints accept the same shape — `family`, `variants[]`, `subsets[]` —
 * and reject the same way. Returns the validated selection or a Response with
 * the appropriate 400.
 */
async function readGoogleFontSelectionBody(
  req: Request,
): Promise<GoogleFontSelection | Response> {
  const body = await readJsonObject(req)
  const family = readString(body, 'family')
  const variants = Array.isArray(body.variants)
    ? (body.variants as unknown[]).filter((v): v is string => typeof v === 'string')
    : []
  const subsets = Array.isArray(body.subsets)
    ? (body.subsets as unknown[]).filter((s): s is string => typeof s === 'string')
    : []

  if (!family) return badRequest('Missing font family')
  if (variants.length === 0) return badRequest('Pick at least one variant')
  if (subsets.length === 0) return badRequest('Pick at least one subset')
  return { family, variants, subsets }
}

export async function handleFontsRoutes(
  req: Request,
  db: DbClient,
  options: CmsHandlerOptions,
): Promise<Response | null> {
  const url = new URL(req.url)

  if (url.pathname === '/admin/api/cms/fonts/google') {
    const user = await requireCapability(req, db, 'site.style.edit')
    if (user instanceof Response) return user
    if (req.method !== 'GET') return methodNotAllowed()
    return jsonResponse({ families: listGoogleFonts() })
  }

  if (url.pathname === '/admin/api/cms/fonts/estimate') {
    const user = await requireCapability(req, db, 'site.style.edit')
    if (user instanceof Response) return user
    if (req.method !== 'POST') return methodNotAllowed()

    const selection = await readGoogleFontSelectionBody(req)
    if (selection instanceof Response) return selection

    try {
      const estimate = await estimateGoogleFont(selection)
      return jsonResponse(estimate)
    } catch (err) {
      if (err instanceof FontInstallError) return badRequest(err.message)
      console.error('[fonts:estimate]', err)
      return jsonResponse({ error: 'Font estimate failed' }, { status: 500 })
    }
  }

  if (url.pathname === '/admin/api/cms/fonts/install') {
    const user = await requireCapability(req, db, 'site.style.edit')
    if (user instanceof Response) return user
    if (req.method !== 'POST') return methodNotAllowed()
    if (!options.uploadsDir) {
      return jsonResponse({ error: 'Uploads directory is not configured' }, { status: 500 })
    }

    const selection = await readGoogleFontSelectionBody(req)
    if (selection instanceof Response) return selection

    try {
      const entry = await installGoogleFont(selection, options.uploadsDir)
      return jsonResponse({ font: entry }, { status: 201 })
    } catch (err) {
      if (err instanceof FontInstallError) return badRequest(err.message)
      console.error('[fonts:install]', err)
      return jsonResponse({ error: 'Font install failed' }, { status: 500 })
    }
  }

  const fontFamilyMatch = url.pathname.match(/^\/admin\/api\/cms\/fonts\/family\/([^/]+)$/)
  if (fontFamilyMatch) {
    const user = await requireCapability(req, db, 'site.style.edit')
    if (user instanceof Response) return user
    if (req.method !== 'DELETE') return methodNotAllowed()
    if (!options.uploadsDir) {
      return jsonResponse({ error: 'Uploads directory is not configured' }, { status: 500 })
    }

    const family = decodeURIComponent(fontFamilyMatch[1])
    try {
      await uninstallFontFamily(family, options.uploadsDir)
      return jsonResponse({ ok: true })
    } catch (err) {
      console.error('[fonts:uninstall]', err)
      return jsonResponse({ error: 'Font uninstall failed' }, { status: 500 })
    }
  }

  return null
}
