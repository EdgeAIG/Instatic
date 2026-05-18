/**
 * Draft-site read/write endpoint.
 *
 *   GET /admin/api/cms/site — load the entire draft `SiteDocument` (gated
 *                              by `site.read`). Used by the editor to
 *                              hydrate the in-memory store on boot.
 *   PUT /admin/api/cms/site — replace the broad draft `SiteDocument`. The
 *                              caller needs *at least one* of the three
 *                              site-write capabilities
 *                              (`site.structure.edit` / `site.content.edit` /
 *                              `site.style.edit`); a granular diff between
 *                              the existing draft and the incoming one then
 *                              rejects categories of change the caller is
 *                              not allowed to make. This is what lets a
 *                              "Client" role (`site.content.edit` only) save
 *                              copy edits without smuggling structural or
 *                              style changes through.
 */
import type { DbClient } from '../../db/client'
import { requireAnyCapability, requireCapability } from '../../auth/authz'
import { SITE_WRITE_CAPABILITIES } from '../../auth/capabilities'
import { loadDraftSite, saveDraftSite } from '../../repositories/site'
import { validateSite, SiteValidationError } from '@core/persistence/validate'
import {
  ForbiddenSiteChangeError,
  validateSiteWriteDiff,
} from './siteDiff'
import { badRequest, jsonResponse, methodNotAllowed, readJsonObject } from '../../http'

export async function handleSiteRoutes(req: Request, db: DbClient): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== '/admin/api/cms/site') return null

  const user = req.method === 'GET'
    ? await requireCapability(req, db, 'site.read')
    : await requireAnyCapability(req, db, SITE_WRITE_CAPABILITIES)
  if (user instanceof Response) return user

  if (req.method === 'GET') {
    const site = await loadDraftSite(db)
    if (!site) return jsonResponse({ error: 'draft site not found' }, { status: 404 })
    return jsonResponse({ site })
  }

  if (req.method === 'PUT') {
    const body = await readJsonObject(req)
    try {
      const nextSite = validateSite(body.site)
      // Granular diff gate: walk the changes between the saved draft and the
      // incoming one, and reject if any change category isn't covered by the
      // caller's capabilities. A full editor (all three caps) sails through
      // without inspection — the diff walk is short-circuited.
      const previousSite = await loadDraftSite(db)
      try {
        validateSiteWriteDiff(previousSite, nextSite, user.capabilities)
      } catch (err) {
        if (err instanceof ForbiddenSiteChangeError) {
          return jsonResponse(
            { error: err.message, kind: err.kind, path: err.path },
            { status: 403 },
          )
        }
        throw err
      }
      await saveDraftSite(db, nextSite, user.id)
      return jsonResponse({ ok: true })
    } catch (err) {
      if (err instanceof SiteValidationError) return badRequest(err.message)
      throw err
    }
  }

  return methodNotAllowed()
}
