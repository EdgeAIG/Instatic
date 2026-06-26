/**
 * Saved-layout CRUD endpoints backed by `data_rows` (table_id = 'layouts').
 *
 *   GET /admin/api/cms/layouts — list all non-deleted layout rows as
 *                                DataRow[] (gated by `site.read`). The client
 *                                adapter converts these to SavedLayout[]
 *                                via savedLayoutFromRow + validateSavedLayouts.
 *
 *   PUT /admin/api/cms/layouts — incremental roster save. The body carries
 *                                `{ changedLayouts, layoutIds }`: only the
 *                                layouts the editor changed are validated and
 *                                written; `layoutIds` is the client's full
 *                                roster and rows missing from it are reaped —
 *                                identical semantics to the components
 *                                endpoint. Identity rules (unique id + name)
 *                                run against the merged post-save roster (see
 *                                validateSavedLayoutsForPartialWrite).
 *
 *                                Gated by any site-write capability, then
 *                                restricted to no-op saves unless the caller
 *                                has `site.structure.edit`. The reconcile can
 *                                soft-delete any layout missing from the
 *                                incoming roster, so actual layout changes and
 *                                roster reaps remain structural work.
 *
 * The GET response returns raw DataRow objects (not SavedLayout objects) so
 * the client adapter can reconstruct layouts via savedLayoutFromRow without a
 * second validation layer on the server. The adapter validates via
 * validateSavedLayouts immediately after conversion.
 */
import type { DbClient } from '../../db/client'
import { requireAnyCapability, requireCapability } from '../../auth/authz'
import type { CoreCapability } from '../../auth/capabilities'
import { listDataRows, reconcileDataRowRoster } from '../../repositories/data'
import { savedLayoutFromRow, savedLayoutToCells } from '../../../src/core/data/layoutFromRow'
import { SiteValidationError } from '@core/persistence/validate'
import { validateSavedLayoutsForPartialWrite } from '@core/persistence/validateLayouts'
import { SavedLayoutSchema, layoutSlugFromName, type SavedLayout } from '@core/layouts'
import { badRequest, jsonResponse, methodNotAllowed, readValidatedBody } from '../../http'
import { Type } from '@core/utils/typeboxHelpers'
import { CMS_API_PREFIX } from './shared'
import { ForbiddenSiteChangeError } from './siteDiff'

const LAYOUT_WRITE_CAPABILITIES = [
  'site.structure.edit',
  'site.content.edit',
  'site.style.edit',
] satisfies CoreCapability[]

export async function handleLayoutsRoutes(req: Request, db: DbClient): Promise<Response | null> {
  const url = new URL(req.url)
  if (url.pathname !== `${CMS_API_PREFIX}/layouts`) return null

  if (req.method === 'GET') {
    const user = await requireCapability(req, db, 'site.read')
    if (user instanceof Response) return user

    const rows = await listDataRows(db, 'layouts')
    return jsonResponse({ rows })
  }

  if (req.method === 'PUT') {
    const user = await requireAnyCapability(req, db, LAYOUT_WRITE_CAPABILITIES)
    if (user instanceof Response) return user

    const LayoutsBodySchema = Type.Object({
      // Only the layouts the editor changed since its last save.
      changedLayouts: Type.Array(SavedLayoutSchema),
      // The client's FULL layout-id roster; rows missing from it are reaped.
      layoutIds: Type.Array(Type.String()),
    }, { additionalProperties: false })
    const body = await readValidatedBody(req, LayoutsBodySchema)
    if (!body) return badRequest('Invalid request body')

    const layoutIds = new Set(body.layoutIds)
    const canEditStructure = user.capabilities.includes('site.structure.edit')

    // Identity rules (unique id + name) are roster-wide, so validation merges
    // the changed batch over the stored roster. This runs OUTSIDE the
    // transaction (sanitization is CPU work; the SQLite adapter serializes
    // every transaction through one chain).
    const existingRows = await listDataRows(db, 'layouts')
    const existingLayouts = existingRows.flatMap((r) => {
      const layout = savedLayoutFromRow(r)
      return layout ? [layout] : []
    })
    const reapedIds = existingLayouts.filter((layout) => !layoutIds.has(layout.id)).map((layout) => layout.id)
    if (!canEditStructure && (body.changedLayouts.length > 0 || reapedIds.length > 0)) {
      return jsonResponse(
        {
          error: new ForbiddenSiteChangeError(
            'structure',
            'layoutIds',
            reapedIds.length > 0 ? `layout roster removed ${reapedIds.join(', ')}` : 'layout changed',
          ).message,
          kind: 'structure',
          path: 'layoutIds',
        },
        { status: 403 },
      )
    }

    let layouts: SavedLayout[]
    try {
      layouts = validateSavedLayoutsForPartialWrite(body.changedLayouts, existingLayouts, layoutIds)
      for (const layout of layouts) {
        if (!layoutIds.has(layout.id)) {
          throw new SiteValidationError(`changed layout "${layout.id}" missing from layoutIds roster`, 'layoutIds')
        }
      }
    } catch (err) {
      if (err instanceof SiteValidationError) {
        return badRequest(err.message)
      }
      throw err
    }

    // Batch reconcile: soft-delete / create / update in one short transaction
    // (reap-first + two-phase slug writes — see rows/reconcile.ts).
    await reconcileDataRowRoster(db, {
      tableId: 'layouts',
      writes: layouts.map((layout) => ({
        id: layout.id,
        cells: savedLayoutToCells(layout),
        slug: layoutSlugFromName(layout.name),
      })),
      keepIds: layoutIds,
      actorUserId: user.id,
    })

    return jsonResponse({ ok: true })
  }

  return methodNotAllowed()
}
