/**
 * Plugin admin endpoints (gated by `plugins.manage`).
 *
 *   GET    /admin/api/cms/plugins                                   — list installed plugins + admin pages
 *   POST   /admin/api/cms/plugins                                   — install from a manifest JSON body
 *   POST   /admin/api/cms/plugins/inspect-package                   — read a plugin .zip without installing
 *   POST   /admin/api/cms/plugins/package                           — install (or upgrade) from a .zip
 *   PATCH  /admin/api/cms/plugins/:id                               — enable / disable an installed plugin
 *   DELETE /admin/api/cms/plugins/:id                               — uninstall + delete on-disk assets
 *   POST   /admin/api/cms/plugins/:id/pack/install                  — manual pack re-sync into the draft site
 *   GET    /admin/api/cms/plugins/:id/settings                      — masked settings
 *   PUT    /admin/api/cms/plugins/:id/settings                      — update settings + fire `settings.changed`
 *   POST   /admin/api/cms/plugins/:id/restart                       — manual restart for a parked plugin
 *   GET    /admin/api/cms/plugins/events                            — SSE stream of lifecycle events
 *   GET    /admin/api/cms/plugins/:id/resources/:rid/records        — list records for a plugin resource
 *   POST   /admin/api/cms/plugins/:id/resources/:rid/records        — create a plugin record
 *   PATCH  /admin/api/cms/plugins/:id/resources/:rid/records/:rec   — update a plugin record
 *   DELETE /admin/api/cms/plugins/:id/resources/:rid/records/:rec   — delete a plugin record
 *   *      /admin/api/cms/plugins/:id/runtime/...                   — opaque runtime requests handled by
 *                                                                     the plugin's own server module
 *
 * `handlePluginsRoutes` is a thin dispatcher: it matches the URL pattern,
 * runs the `plugins.manage` capability check, and forwards to one of the
 * per-route handlers in the topic files (`install.ts`, `state.ts`,
 * `settings.ts`, `pack.ts`, `records.ts`, `events.ts`). The lifecycle hook
 * orchestration lives in `lifecycle.ts`; cross-cutting helpers
 * (`pluginsPayload`, audit envelope, permission grants, on-disk assets)
 * live in `shared.ts`.
 */
import type { DbClient } from '../../../db/client'
import { requireCapability, requireStepUp } from '../../../auth/authz'
import {
  handleServerPluginRuntimeRequest,
  setPluginWorkerDbClient,
} from '../../../plugins/runtime'
import { jsonResponse } from '../../../http'
import { type CmsHandlerOptions } from '../shared'
import {
  handleInspectPackage,
  handlePackageInstall,
  handlePluginsCollection,
} from './install'
import { handlePluginPackInstall } from './pack'
import { handlePluginItem, handlePluginRestart } from './state'
import { handlePluginSettings } from './settings'
import {
  handlePluginRecordItem,
  handlePluginRecordsCollection,
} from './records'
import { handlePluginEventsStream } from './events'

// ---------------------------------------------------------------------------
// Route patterns
// ---------------------------------------------------------------------------

const PLUGIN_ITEM_PATTERN = /^\/admin\/api\/cms\/plugins\/([^/]+)$/
const PLUGIN_RECORDS_PATTERN = /^\/admin\/api\/cms\/plugins\/([^/]+)\/resources\/([^/]+)\/records$/
const PLUGIN_RECORD_ITEM_PATTERN = /^\/admin\/api\/cms\/plugins\/([^/]+)\/resources\/([^/]+)\/records\/([^/]+)$/
const PLUGIN_RUNTIME_PATTERN = /^\/admin\/api\/cms\/plugins\/([^/]+)\/runtime(?:\/.*)?$/
const PLUGIN_PACK_INSTALL_PATTERN = /^\/admin\/api\/cms\/plugins\/([^/]+)\/pack\/install$/
const PLUGIN_SETTINGS_PATTERN = /^\/admin\/api\/cms\/plugins\/([^/]+)\/settings$/
const PLUGIN_RESTART_PATTERN = /^\/admin\/api\/cms\/plugins\/([^/]+)\/restart$/
const PLUGIN_EVENTS_PATH = '/admin/api/cms/plugins/events'

// ---------------------------------------------------------------------------
// Step-up policy
// ---------------------------------------------------------------------------

/**
 * Plugin admin actions that run third-party code, modify the worker
 * registry, or rewrite on-disk plugin assets — i.e. anything with
 * host-RCE-class impact if a cookie were stolen or an XSS dropped a
 * forged request through the admin shell.
 *
 * Matches the step-up pattern used for `users.manage` (delete / suspend /
 * password change): a fresh password re-entry within the last 15 min is
 * required on top of the `plugins.manage` capability. Read-only routes
 * (listing, masked settings, inspect-package, events SSE) and plugin
 * record CRUD (which is bounded by a separately-installed plugin's own
 * schema) are deliberately not in this list.
 */
function requiresStepUp(method: string, pathname: string): boolean {
  // Fresh install / upgrade — uploads + executes arbitrary plugin code.
  if (method === 'POST' && pathname === '/admin/api/cms/plugins') return true
  if (method === 'POST' && pathname === '/admin/api/cms/plugins/package') return true

  // Per-plugin mutations — every branch below re-runs a lifecycle hook
  // (activate / deactivate / uninstall / migrate) or rewrites runtime
  // state in a way the plugin's own server code observes.
  if (method === 'PATCH' && PLUGIN_ITEM_PATTERN.test(pathname)) return true
  if (method === 'DELETE' && PLUGIN_ITEM_PATTERN.test(pathname)) return true
  if (method === 'POST' && PLUGIN_RESTART_PATTERN.test(pathname)) return true
  if (method === 'POST' && PLUGIN_PACK_INSTALL_PATTERN.test(pathname)) return true
  if (method === 'PUT' && PLUGIN_SETTINGS_PATTERN.test(pathname)) return true

  return false
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export async function handlePluginsRoutes(
  req: Request,
  db: DbClient,
  options: CmsHandlerOptions,
): Promise<Response | null> {
  const url = new URL(req.url)
  const { pathname } = url

  // Make sure the plugin worker host knows the current DbClient before any
  // worker-initiated `cms.storage.*` round-trip lands. Idempotent; the host
  // just stores the reference. Required because `activateInstalledServerPlugins`
  // (the canonical setter) only runs at boot and after disable/enable cycles —
  // without this call, a fresh install or upgrade would see api dispatches
  // fail with "no DbClient configured" until the next boot.
  setPluginWorkerDbClient(db)

  // Plugin runtime is a pass-through to the plugin's own server module — its
  // capability gating lives inside `handleServerPluginRuntimeRequest` because
  // the module decides which routes are public vs. authenticated.
  if (PLUGIN_RUNTIME_PATTERN.test(pathname)) {
    return (
      (await handleServerPluginRuntimeRequest(req, db)) ??
      jsonResponse({ error: 'Plugin route not found' }, { status: 404 })
    )
  }

  // Every CMS-side plugin route requires `plugins.manage`.
  if (!isPluginAdminPath(pathname)) return null
  const user = await requireCapability(req, db, 'plugins.manage')
  if (user instanceof Response) return user

  // Sensitive plugin actions (install / upgrade / enable / disable /
  // uninstall / restart / pack install / settings update) additionally
  // require a fresh step-up window. The capability check already gates
  // who is allowed at all; step-up further requires a recent password
  // re-entry so a stolen session cookie alone cannot land plugin code
  // on the host.
  if (requiresStepUp(req.method, pathname)) {
    const stepUp = await requireStepUp(req, db)
    if (stepUp instanceof Response) return stepUp
  }

  if (pathname === '/admin/api/cms/plugins') {
    return handlePluginsCollection(req, db, user)
  }

  if (pathname === '/admin/api/cms/plugins/inspect-package') {
    return handleInspectPackage(req)
  }

  if (pathname === '/admin/api/cms/plugins/package') {
    return handlePackageInstall(req, db, options, user)
  }

  const packInstallMatch = pathname.match(PLUGIN_PACK_INSTALL_PATTERN)
  if (packInstallMatch) {
    return handlePluginPackInstall(req, db, options, user, decodeURIComponent(packInstallMatch[1]))
  }

  const settingsMatch = pathname.match(PLUGIN_SETTINGS_PATTERN)
  if (settingsMatch) {
    return handlePluginSettings(req, db, user, decodeURIComponent(settingsMatch[1]))
  }

  const restartMatch = pathname.match(PLUGIN_RESTART_PATTERN)
  if (restartMatch) {
    return handlePluginRestart(req, db, options, user, decodeURIComponent(restartMatch[1]))
  }

  if (pathname === PLUGIN_EVENTS_PATH) {
    return handlePluginEventsStream(req)
  }

  const recordItemMatch = pathname.match(PLUGIN_RECORD_ITEM_PATTERN)
  if (recordItemMatch) {
    return handlePluginRecordItem(
      req,
      db,
      decodeURIComponent(recordItemMatch[1]),
      decodeURIComponent(recordItemMatch[2]),
      decodeURIComponent(recordItemMatch[3]),
    )
  }

  const recordsMatch = pathname.match(PLUGIN_RECORDS_PATTERN)
  if (recordsMatch) {
    return handlePluginRecordsCollection(
      req,
      db,
      decodeURIComponent(recordsMatch[1]),
      decodeURIComponent(recordsMatch[2]),
    )
  }

  const itemMatch = pathname.match(PLUGIN_ITEM_PATTERN)
  if (itemMatch) {
    return handlePluginItem(req, db, options, user, decodeURIComponent(itemMatch[1]))
  }

  return null
}

/**
 * Quick check that `pathname` is one of the plugin admin routes — the
 * runtime route is handled separately above. Centralising the prefix keeps
 * the dispatcher's auth gate from running on unrelated CMS paths.
 */
function isPluginAdminPath(pathname: string): boolean {
  if (pathname === '/admin/api/cms/plugins') return true
  if (pathname === '/admin/api/cms/plugins/inspect-package') return true
  if (pathname === '/admin/api/cms/plugins/package') return true
  return pathname.startsWith('/admin/api/cms/plugins/')
}
