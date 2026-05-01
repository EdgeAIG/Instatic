import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { DbClient } from './db'
import {
  createPluginRecord,
  deletePluginRecord,
  listInstalledPlugins,
  listPluginRecords,
  updatePluginRecord,
} from './pluginRepository'
import {
  findPluginResource,
  validatePluginRecordData,
} from '../../src/core/extensions/manifest'
import type {
  PluginManifest,
  RouteMethod,
  ServerPluginApi,
  ServerPluginLifecycleHook,
  ServerPluginModule,
  ServerPluginRouteHandler,
} from '../../src/core/plugin-sdk'
import { assertPluginPermission } from '../../src/core/plugin-sdk'
import { jsonResponse } from '../http'
import { nanoid } from 'nanoid'

interface ServerPluginRoute {
  pluginId: string
  method: RouteMethod
  path: string
  handler: ServerPluginRouteHandler
}

class ServerPluginRuntime {
  private routes = new Map<string, ServerPluginRoute>()

  reset(): void {
    this.routes.clear()
  }

  registerRoute(route: ServerPluginRoute): void {
    this.routes.set(this.routeKey(route.pluginId, route.method, route.path), route)
  }

  unregisterPlugin(pluginId: string): void {
    for (const key of this.routes.keys()) {
      if (key.startsWith(`${pluginId}:`)) this.routes.delete(key)
    }
  }

  findRoute(pluginId: string, method: string, path: string): ServerPluginRoute | null {
    return this.routes.get(this.routeKey(pluginId, method.toUpperCase(), normalizeRoutePath(path))) ?? null
  }

  private routeKey(pluginId: string, method: string, path: string): string {
    return `${pluginId}:${method}:${normalizeRoutePath(path)}`
  }
}

export const serverPluginRuntime = new ServerPluginRuntime()

function normalizeRoutePath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed || trimmed === '/') return '/'
  return `/${trimmed.replace(/^\/+|\/+$/g, '')}`
}

function createServerPluginApi(
  manifest: PluginManifest,
  db: DbClient,
): ServerPluginApi {
  function register(method: RouteMethod, path: string, handler: ServerPluginRouteHandler) {
    assertPluginPermission(manifest, 'cms.routes')
    serverPluginRuntime.registerRoute({
      pluginId: manifest.id,
      method,
      path: normalizeRoutePath(path),
      handler,
    })
  }

  return {
    plugin: {
      id: manifest.id,
      version: manifest.version,
      permissions: manifest.grantedPermissions ?? [],
      log: (...args) => {
        console.info(`[plugin:${manifest.id}]`, ...args)
      },
    },
    cms: {
      routes: {
        get: (path, handler) => register('GET', path, handler),
        post: (path, handler) => register('POST', path, handler),
        patch: (path, handler) => register('PATCH', path, handler),
        delete: (path, handler) => register('DELETE', path, handler),
      },
      storage: {
        collection(resourceId) {
          assertPluginPermission(manifest, 'cms.storage')
          const resource = findPluginResource(manifest, resourceId)
          return {
            list: () => listPluginRecords(db, manifest.id, resourceId),
            create: (data) => createPluginRecord(db, {
              id: nanoid(),
              pluginId: manifest.id,
              resourceId,
              data: resource ? validatePluginRecordData(resource, data) : data,
            }),
            update: (recordId, data) => updatePluginRecord(db, {
              id: recordId,
              pluginId: manifest.id,
              resourceId,
              data: resource ? validatePluginRecordData(resource, data) : data,
            }),
            delete: (recordId) => deletePluginRecord(db, {
              id: recordId,
              pluginId: manifest.id,
              resourceId,
            }),
          }
        },
      },
    },
  }
}

export async function activateServerPlugin(
  manifest: PluginManifest,
  mod: ServerPluginModule,
  db: DbClient,
): Promise<void> {
  await runServerPluginLifecycleHook(manifest, mod, db, 'activate')
}

export async function runServerPluginLifecycleHook(
  manifest: PluginManifest,
  mod: ServerPluginModule,
  db: DbClient,
  hook: ServerPluginLifecycleHook,
): Promise<void> {
  const handler = mod[hook]
  if (!handler) return
  await handler(createServerPluginApi(manifest, db))
}

export async function loadServerPluginModule(
  manifest: PluginManifest,
  uploadsDir?: string,
): Promise<ServerPluginModule | null> {
  if (!uploadsDir || !manifest.assetBasePath || !manifest.entrypoints?.server) return null
  const relativeBase = manifest.assetBasePath.replace(/^\/uploads\/?/, '')
  const entryPath = join(uploadsDir, relativeBase, manifest.entrypoints.server)
  return await import(`${pathToFileURL(entryPath).href}?v=${Date.now()}`) as ServerPluginModule
}

export async function handleServerPluginRuntimeRequest(
  req: Request,
  db: DbClient,
): Promise<Response | null> {
  const url = new URL(req.url)
  const match = url.pathname.match(/^\/api\/cms\/plugins\/([^/]+)\/runtime(\/.*)?$/)
  if (!match) return null

  const pluginId = decodeURIComponent(match[1])
  const routePath = normalizeRoutePath(decodeURIComponent(match[2] ?? '/'))
  const route = serverPluginRuntime.findRoute(pluginId, req.method, routePath)
  if (!route) return jsonResponse({ error: 'Plugin route not found' }, { status: 404 })

  let body: Record<string, unknown> = {}
  if (req.method !== 'GET') {
    try {
      const parsed = await req.json()
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {}
    } catch {
      body = {}
    }
  }

  const result = await route.handler({ req, db, body })
  if (result instanceof Response) return result
  return jsonResponse(result ?? { ok: true })
}

export async function activateInstalledServerPlugins(
  db: DbClient,
  uploadsDir?: string,
): Promise<void> {
  if (!uploadsDir) return
  serverPluginRuntime.reset()
  const plugins = await listInstalledPlugins(db)
  for (const plugin of plugins) {
    const { manifest } = plugin
    if (!plugin.enabled || !manifest.assetBasePath || !manifest.entrypoints?.server) continue
    const mod = await loadServerPluginModule(manifest, uploadsDir)
    if (!mod) continue
    await activateServerPlugin({
      ...manifest,
      grantedPermissions: plugin.grantedPermissions,
    }, mod, db)
  }
}
