/**
 * Role management endpoints (gated by `roles.manage`).
 *
 *   GET    /admin/api/cms/roles      — list every role + its capabilities
 *   POST   /admin/api/cms/roles      — create a custom role
 *   PATCH  /admin/api/cms/roles/:id  — rename / re-describe / re-cap
 *   DELETE /admin/api/cms/roles/:id  — delete a custom role (built-ins
 *                                       reject inside the repository)
 */
import type { DbClient } from '../../db/client'
import { requireAnyCapability, requireCapability, requireStepUp } from '../../auth/authz'
import { createAuditEvent } from '../../repositories/audit'
import {
  createCustomRole,
  deleteCustomRole,
  listRoles,
  updateRole,
} from '../../repositories/roles'
import { normalizeCapabilities } from '../../auth/capabilities'
import { Type } from '@core/utils/typeboxHelpers'
import { badRequest, jsonResponse, methodNotAllowed } from '../../http'
import {
  CMS_API_PREFIX,
  mutationErrorResponse,
  readValidatedBody,
  requestAuditContext,
} from './shared'

const RoleCreateBodySchema = Type.Object({
  name: Type.String(),
  slug: Type.Optional(Type.String()),
  description: Type.Optional(Type.String()),
  capabilities: Type.Array(Type.String()),
})

const RolePatchBodySchema = Type.Partial(Type.Object({
  name: Type.String(),
  slug: Type.String(),
  description: Type.String(),
  capabilities: Type.Array(Type.String()),
}))


export async function handleRolesRoutes(req: Request, db: DbClient): Promise<Response | null> {
  const url = new URL(req.url)

  if (url.pathname === `${CMS_API_PREFIX}/roles`) {
    if (req.method === 'GET') {
      const actor = await requireAnyCapability(req, db, ['roles.manage', 'users.manage'])
      if (actor instanceof Response) return actor
      return jsonResponse({ roles: await listRoles(db) })
    }

    if (req.method === 'POST') {
      const actor = await requireCapability(req, db, 'roles.manage')
      if (actor instanceof Response) return actor
      const stepUp = await requireStepUp(req, db)
      if (stepUp instanceof Response) return stepUp
      const body = await readValidatedBody(req, RoleCreateBodySchema)
      if (!body) return badRequest('Invalid role payload')
      try {
        const role = await createCustomRole(db, {
          name: body.name,
          slug: body.slug,
          description: body.description ?? '',
          capabilities: normalizeCapabilities(body.capabilities),
        })
        await createAuditEvent(db, {
          actorUserId: actor.id,
          action: 'role.create',
          targetType: 'role',
          targetId: role.id,
          metadata: { slug: role.slug, name: role.name },
          ...requestAuditContext(req),
        })
        return jsonResponse({ role }, { status: 201 })
      } catch (err) {
        return mutationErrorResponse(err)
      }
    }

    return methodNotAllowed()
  }

  const roleItemMatch = url.pathname.match(/^\/admin\/api\/cms\/roles\/([^/]+)$/)
  if (roleItemMatch) {
    const actor = await requireCapability(req, db, 'roles.manage')
    if (actor instanceof Response) return actor

    const roleId = decodeURIComponent(roleItemMatch[1])

    if (req.method === 'PATCH') {
      const stepUp = await requireStepUp(req, db)
      if (stepUp instanceof Response) return stepUp
      const body = await readValidatedBody(req, RolePatchBodySchema)
      if (!body) return badRequest('Invalid role payload')
      try {
        const role = await updateRole(db, roleId, {
          name: body.name,
          slug: body.slug,
          description: body.description,
          capabilities: body.capabilities ? normalizeCapabilities(body.capabilities) : undefined,
        })
        if (!role) return jsonResponse({ error: 'Role not found' }, { status: 404 })
        await createAuditEvent(db, {
          actorUserId: actor.id,
          action: 'role.update',
          targetType: 'role',
          targetId: role.id,
          metadata: { slug: role.slug, name: role.name },
          ...requestAuditContext(req),
        })
        return jsonResponse({ role })
      } catch (err) {
        return mutationErrorResponse(err)
      }
    }

    if (req.method === 'DELETE') {
      const stepUp = await requireStepUp(req, db)
      if (stepUp instanceof Response) return stepUp
      try {
        const deletedRole = await deleteCustomRole(db, roleId)
        if (!deletedRole) return jsonResponse({ error: 'Role not found' }, { status: 404 })
        await createAuditEvent(db, {
          actorUserId: actor.id,
          action: 'role.delete',
          targetType: 'role',
          targetId: roleId,
          metadata: { slug: deletedRole.slug, name: deletedRole.name },
          ...requestAuditContext(req),
        })
        return jsonResponse({ ok: true })
      } catch (err) {
        return mutationErrorResponse(err)
      }
    }

    return methodNotAllowed()
  }

  return null
}
