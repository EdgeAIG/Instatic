import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { nanoid } from 'nanoid'
import type { DbClient } from './db'
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  hashPassword,
  hashSessionToken,
  sessionExpiry,
  verifyPassword,
} from './auth'
import {
  createAdminUser,
  createSession,
  createSite,
  deleteSessionByHash,
  findAdminBySessionHash,
  findAdminByEmail,
  getSetupStatus,
} from './repositories'
import { loadDraftSite, saveDraftSite } from './siteRepository'
import { getDraftPublishStatus, publishDraftSite } from './publishRepository'
import {
  createContentCollection,
  createContentEntry,
  getContentEntry,
  listContentCollections,
  listContentEntries,
  publishContentEntry,
  saveContentEntryDraft,
  softDeleteContentCollection,
  softDeleteContentEntry,
  updateContentCollection,
  updateContentEntryStatus,
} from './contentRepository'
import {
  createMediaAsset,
  deleteMediaAsset,
  listMediaAssets,
  renameMediaAsset,
} from './mediaRepository'
import {
  createPluginRecord,
  deletePluginRecord,
  deletePlugin,
  getInstalledPlugin,
  installPlugin,
  listInstalledPlugins,
  listPluginRecords,
  setPluginLifecycleStatus,
  setPluginEnabled,
  updatePluginRecord,
} from './pluginRepository'
import type { AdminUserRow } from './types'
import {
  collectEnabledAdminPages,
  findPluginResource,
  missingPluginPermissionGrants,
  parsePluginManifest,
  validatePluginRecordData,
} from '../../src/core/extensions/manifest'
import type {
  InstalledPlugin,
  PluginLifecycleStatus,
  PluginManifest,
  PluginPermission,
  PluginResource,
  ServerPluginLifecycleHook,
} from '../../src/core/plugin-sdk'
import { readPluginPackage } from './pluginPackage'
import {
  activateInstalledServerPlugins,
  handleServerPluginRuntimeRequest,
  loadServerPluginModule,
  runServerPluginLifecycleHook,
  serverPluginRuntime,
} from './serverPluginRuntime'
import { validateSite, SiteValidationError } from '../../src/core/persistence/validate'
import {
  badRequest,
  jsonResponse,
  methodNotAllowed,
  readJsonObject,
  setCookieHeader,
} from '../http'

interface CmsHandlerOptions {
  uploadsDir?: string
}

const MAX_MEDIA_BYTES = 50 * 1024 * 1024

function readString(body: Record<string, unknown>, key: string): string {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readNullableString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key]
  if (value === null) return null
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled'
}

function sessionCookie(token: string, expires: Date): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; Expires=${expires.toUTCString()}; HttpOnly; SameSite=Lax`
}

function readCookie(req: Request, name: string): string {
  const cookie = req.headers.get('cookie') ?? ''
  for (const part of cookie.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=')
    if (rawKey === name) return rawValue.join('=')
  }
  return ''
}

async function getSessionHash(req: Request): Promise<string> {
  const token = readCookie(req, SESSION_COOKIE_NAME)
  return token ? hashSessionToken(token) : ''
}

async function getAuthenticatedAdmin(
  req: Request,
  db: DbClient,
): Promise<AdminUserRow | null> {
  const idHash = await getSessionHash(req)
  if (!idHash) return null
  return findAdminBySessionHash(db, idHash)
}

function isAcceptedMediaType(mimeType: string): boolean {
  return /^image\/|^video\//.test(mimeType)
}

async function pluginsPayload(db: DbClient) {
  const plugins = await listInstalledPlugins(db)
  return {
    plugins,
    adminPages: collectEnabledAdminPages(plugins),
  }
}

function readPermissionGrants(value: unknown): PluginPermission[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is PluginPermission => typeof item === 'string') as PluginPermission[]
}

function assertPluginPermissionGrants(
  manifest: PluginManifest,
  grantedPermissions: PluginPermission[],
): Response | null {
  const missing = missingPluginPermissionGrants(manifest, grantedPermissions)
  if (missing.length === 0) return null
  return badRequest(`Plugin install requires permission grants: ${missing.join(', ')}`)
}

function pluginManifestWithGrants(plugin: InstalledPlugin): PluginManifest {
  return {
    ...plugin.manifest,
    grantedPermissions: plugin.grantedPermissions,
  }
}

function lifecycleErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Plugin lifecycle hook failed'
}

async function runPluginLifecycleHook(
  db: DbClient,
  plugin: InstalledPlugin,
  options: CmsHandlerOptions,
  hook: ServerPluginLifecycleHook,
  successStatus: PluginLifecycleStatus,
): Promise<{ plugin: InstalledPlugin; ok: boolean }> {
  const manifest = pluginManifestWithGrants(plugin)

  try {
    const mod = await loadServerPluginModule(manifest, options.uploadsDir)
    if (!mod?.[hook]) {
      const updated = await setPluginLifecycleStatus(db, plugin.id, successStatus)
      return { plugin: updated ?? plugin, ok: true }
    }

    await runServerPluginLifecycleHook(manifest, mod, db, hook)
    const updated = await setPluginLifecycleStatus(db, plugin.id, successStatus)
    return { plugin: updated ?? plugin, ok: true }
  } catch (err) {
    if (hook === 'activate') {
      serverPluginRuntime.unregisterPlugin(plugin.id)
    }
    const updated = await setPluginLifecycleStatus(db, plugin.id, 'error', lifecycleErrorMessage(err))
    return { plugin: updated ?? plugin, ok: false }
  }
}

async function removePluginAssets(plugin: InstalledPlugin, uploadsDir?: string): Promise<void> {
  const assetBasePath = plugin.manifest.assetBasePath
  if (!uploadsDir || !assetBasePath?.startsWith('/uploads/plugins/')) return
  const relativeBasePath = assetBasePath.replace(/^\/uploads\/?/, '')
  await rm(join(uploadsDir, relativeBasePath), { recursive: true, force: true })
}

async function readPluginPackageForm(req: Request): Promise<{
  file: File | null
  grantedPermissions: PluginPermission[]
}> {
  const body = await req.formData()
  const file = body.get('file')
  const rawPermissions = body.get('grantedPermissions')
  let grantedPermissions: PluginPermission[] = []
  if (typeof rawPermissions === 'string') {
    try {
      grantedPermissions = readPermissionGrants(JSON.parse(rawPermissions))
    } catch {
      grantedPermissions = []
    }
  }
  return {
    file: file instanceof File ? file : null,
    grantedPermissions,
  }
}

async function writePluginPackageFiles(
  uploadsDir: string,
  manifest: PluginManifest,
  files: Record<string, string>,
): Promise<PluginManifest> {
  const relativeBasePath = `plugins/${manifest.id}/${manifest.version}`
  const diskBasePath = join(uploadsDir, relativeBasePath)
  await rm(diskBasePath, { recursive: true, force: true })

  for (const [path, content] of Object.entries(files)) {
    if (path === 'plugin.json') continue
    const outputPath = join(diskBasePath, path)
    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(outputPath, content, 'utf-8')
  }

  return {
    ...manifest,
    assetBasePath: `/uploads/${relativeBasePath}`,
  }
}

async function getEnabledPluginResource(
  db: DbClient,
  pluginId: string,
  resourceId: string,
): Promise<PluginResource | null> {
  const plugin = await getInstalledPlugin(db, pluginId)
  if (!plugin?.enabled) return null
  return findPluginResource(plugin.manifest, resourceId)
}

function safeStorageName(filename: string): string {
  const normalized = filename.replace(/\\/g, '/')
  const safe = basename(normalized).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+/, '')
  return safe || 'upload.bin'
}

async function readUploadedFile(req: Request): Promise<File | null> {
  const body = await req.formData()
  const file = body.get('file')
  return file instanceof File ? file : null
}

export async function handleCmsRequest(
  req: Request,
  db: DbClient,
  options: CmsHandlerOptions = {},
): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/api/cms/setup/status') {
    if (req.method !== 'GET') return methodNotAllowed()
    return jsonResponse(await getSetupStatus(db))
  }

  if (url.pathname === '/api/cms/setup') {
    if (req.method !== 'POST') return methodNotAllowed()
    const status = await getSetupStatus(db)
    if (!status.needsSetup) {
      return jsonResponse({ error: 'Setup already complete' }, { status: 409 })
    }

    const body = await readJsonObject(req)
    const siteName = readString(body, 'siteName')
    const email = readString(body, 'email').toLowerCase()
    const password = readString(body, 'password')

    if (!siteName) return badRequest('Missing siteName')
    if (!email.includes('@')) return badRequest('Invalid email')
    if (password.length < 12) return badRequest('Password must be at least 12 characters')

    await db.query('begin')
    try {
      await createSite(db, siteName, {})
      await createAdminUser(db, {
        id: nanoid(),
        email,
        passwordHash: await hashPassword(password),
      })
      await db.query('commit')
      return jsonResponse({ ok: true }, { status: 201 })
    } catch (err) {
      await db.query('rollback')
      throw err
    }
  }

  if (url.pathname === '/api/cms/login') {
    if (req.method !== 'POST') return methodNotAllowed()
    const body = await readJsonObject(req)
    const email = readString(body, 'email').toLowerCase()
    const password = readString(body, 'password')
    const admin = await findAdminByEmail(db, email)

    if (!admin || !(await verifyPassword(password, admin.password_hash))) {
      return jsonResponse({ error: 'Invalid email or password' }, { status: 401 })
    }

    const token = createSessionToken()
    const expiresAt = sessionExpiry()
    await createSession(db, {
      idHash: await hashSessionToken(token),
      adminUserId: admin.id,
      expiresAt,
    })

    return setCookieHeader(jsonResponse({ ok: true }), sessionCookie(token, expiresAt))
  }

  if (url.pathname === '/api/cms/logout') {
    if (req.method !== 'POST') return methodNotAllowed()
    const idHash = await getSessionHash(req)
    if (idHash) await deleteSessionByHash(db, idHash)
    return setCookieHeader(
      jsonResponse({ ok: true }),
      `${SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    )
  }

  if (url.pathname === '/api/cms/site') {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    if (req.method === 'GET') {
      const site = await loadDraftSite(db)
      if (!site) return jsonResponse({ error: 'draft site not found' }, { status: 404 })
      return jsonResponse({ site })
    }

    if (req.method === 'PUT') {
      const body = await readJsonObject(req)
      try {
        const site = validateSite(body.site)
        await saveDraftSite(db, site)
        return jsonResponse({ ok: true })
      } catch (err) {
        if (err instanceof SiteValidationError) return badRequest(err.message)
        throw err
      }
    }

    return methodNotAllowed()
  }

  if (url.pathname === '/api/cms/media') {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    if (req.method === 'GET') {
      return jsonResponse({ assets: await listMediaAssets(db) })
    }

    if (req.method === 'POST') {
      if (!options.uploadsDir) {
        return jsonResponse({ error: 'Uploads directory is not configured' }, { status: 500 })
      }

      const file = await readUploadedFile(req)
      if (!file) return badRequest('Missing file')
      if (file.size <= 0) return badRequest('File is empty')
      if (file.size > MAX_MEDIA_BYTES) return badRequest('File exceeds the 50 MB hard limit')

      const mimeType = file.type || 'application/octet-stream'
      if (!isAcceptedMediaType(mimeType)) {
        return badRequest('Only image and video files can be uploaded')
      }

      const storagePath = `${nanoid()}-${safeStorageName(file.name)}`
      const publicPath = `/uploads/${storagePath}`
      await mkdir(options.uploadsDir, { recursive: true })
      await writeFile(join(options.uploadsDir, storagePath), new Uint8Array(await file.arrayBuffer()))

      const asset = await createMediaAsset(db, {
        id: nanoid(),
        filename: file.name || storagePath,
        mimeType,
        sizeBytes: file.size,
        storagePath,
        publicPath,
      })
      return jsonResponse({ asset }, { status: 201 })
    }

    return methodNotAllowed()
  }

  const mediaItemMatch = url.pathname.match(/^\/api\/cms\/media\/([^/]+)$/)
  if (mediaItemMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    const assetId = decodeURIComponent(mediaItemMatch[1])

    if (req.method === 'PATCH') {
      const body = await readJsonObject(req)
      const filename = readString(body, 'filename')
      if (!filename) return badRequest('Filename is required')

      const asset = await renameMediaAsset(db, assetId, filename)
      if (!asset) return jsonResponse({ error: 'Media asset not found' }, { status: 404 })
      return jsonResponse({ asset })
    }

    if (req.method === 'DELETE') {
      if (!options.uploadsDir) {
        return jsonResponse({ error: 'Uploads directory is not configured' }, { status: 500 })
      }

      const deleted = await deleteMediaAsset(db, assetId)
      if (!deleted) return jsonResponse({ error: 'Media asset not found' }, { status: 404 })

      await rm(join(options.uploadsDir, deleted.storagePath), { force: true })
      return jsonResponse({ ok: true })
    }

    return methodNotAllowed()
  }

  if (url.pathname === '/api/cms/plugins') {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    if (req.method === 'GET') {
      return jsonResponse(await pluginsPayload(db))
    }

    if (req.method === 'POST') {
      const body = await readJsonObject(req)
      try {
        const manifest = parsePluginManifest(body.manifest ?? body)
        const grantedPermissions = readPermissionGrants(body.grantedPermissions)
        const grantError = assertPluginPermissionGrants(manifest, grantedPermissions)
        if (grantError) return grantError
        const installed = await installPlugin(db, manifest, grantedPermissions)
        const plugin = await setPluginLifecycleStatus(db, installed.id, 'active') ?? installed
        return jsonResponse({ plugin, ...await pluginsPayload(db) }, { status: 201 })
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : 'Invalid plugin manifest')
      }
    }

    return methodNotAllowed()
  }

  if (url.pathname === '/api/cms/plugins/inspect-package') {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    if (req.method !== 'POST') return methodNotAllowed()

    const { file } = await readPluginPackageForm(req)
    if (!file) return badRequest('Missing plugin package')
    try {
      const pluginPackage = await readPluginPackage(file)
      return jsonResponse({ manifest: pluginPackage.manifest })
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Invalid plugin package')
    }
  }

  if (url.pathname === '/api/cms/plugins/package') {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    if (req.method !== 'POST') return methodNotAllowed()
    if (!options.uploadsDir) return jsonResponse({ error: 'Uploads directory is not configured' }, { status: 500 })

    const { file, grantedPermissions } = await readPluginPackageForm(req)
    if (!file) return badRequest('Missing plugin package')

    try {
      const pluginPackage = await readPluginPackage(file)
      const grantError = assertPluginPermissionGrants(pluginPackage.manifest, grantedPermissions)
      if (grantError) return grantError
      const manifest = await writePluginPackageFiles(options.uploadsDir, pluginPackage.manifest, pluginPackage.files)
      const installed = await installPlugin(db, manifest, grantedPermissions)
      const installLifecycle = await runPluginLifecycleHook(db, installed, options, 'install', 'installed')
      if (!installLifecycle.ok) {
        return jsonResponse({ plugin: installLifecycle.plugin, ...await pluginsPayload(db) }, { status: 201 })
      }

      serverPluginRuntime.unregisterPlugin(installed.id)
      const activateLifecycle = await runPluginLifecycleHook(
        db,
        installLifecycle.plugin,
        options,
        'activate',
        'active',
      )
      return jsonResponse({ plugin: activateLifecycle.plugin, ...await pluginsPayload(db) }, { status: 201 })
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Invalid plugin package')
    }
  }

  const pluginItemMatch = url.pathname.match(/^\/api\/cms\/plugins\/([^/]+)$/)
  if (pluginItemMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    const pluginId = decodeURIComponent(pluginItemMatch[1])

    if (req.method === 'PATCH') {
      const body = await readJsonObject(req)
      if (typeof body.enabled !== 'boolean') return badRequest('Plugin enabled must be a boolean')

      const current = await getInstalledPlugin(db, pluginId)
      if (!current) return jsonResponse({ error: 'Plugin not found' }, { status: 404 })

      if (!body.enabled) {
        const disabled = await setPluginEnabled(db, pluginId, false)
        if (!disabled) return jsonResponse({ error: 'Plugin not found' }, { status: 404 })
        serverPluginRuntime.unregisterPlugin(pluginId)
        const lifecycle = await runPluginLifecycleHook(db, disabled, options, 'deactivate', 'disabled')
        await activateInstalledServerPlugins(db, options.uploadsDir)
        return jsonResponse({ plugin: lifecycle.plugin, ...await pluginsPayload(db) })
      }

      const enabled = await setPluginEnabled(db, pluginId, true)
      if (!enabled) return jsonResponse({ error: 'Plugin not found' }, { status: 404 })
      serverPluginRuntime.unregisterPlugin(pluginId)
      const lifecycle = await runPluginLifecycleHook(db, enabled, options, 'activate', 'active')
      return jsonResponse({ plugin: lifecycle.plugin, ...await pluginsPayload(db) })
    }

    if (req.method === 'DELETE') {
      const current = await getInstalledPlugin(db, pluginId)
      if (!current) return jsonResponse({ error: 'Plugin not found' }, { status: 404 })
      const lifecycle = await runPluginLifecycleHook(db, current, options, 'uninstall', current.lifecycleStatus)
      if (!lifecycle.ok) {
        return badRequest(lifecycle.plugin.lastError ?? 'Plugin uninstall failed')
      }

      const deleted = await deletePlugin(db, pluginId)
      if (!deleted) return jsonResponse({ error: 'Plugin not found' }, { status: 404 })
      serverPluginRuntime.unregisterPlugin(pluginId)
      await removePluginAssets(current, options.uploadsDir)
      await activateInstalledServerPlugins(db, options.uploadsDir)
      return jsonResponse({ ok: true })
    }

    return methodNotAllowed()
  }

  const pluginRecordsMatch = url.pathname.match(/^\/api\/cms\/plugins\/([^/]+)\/resources\/([^/]+)\/records$/)
  if (pluginRecordsMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    const pluginId = decodeURIComponent(pluginRecordsMatch[1])
    const resourceId = decodeURIComponent(pluginRecordsMatch[2])
    const resource = await getEnabledPluginResource(db, pluginId, resourceId)
    if (!resource) return jsonResponse({ error: 'Plugin resource not found' }, { status: 404 })

    if (req.method === 'GET') {
      return jsonResponse({
        resource,
        records: await listPluginRecords(db, pluginId, resourceId),
      })
    }

    if (req.method === 'POST') {
      const body = await readJsonObject(req)
      try {
        const data = validatePluginRecordData(resource, body.data ?? body)
        const record = await createPluginRecord(db, {
          id: nanoid(),
          pluginId,
          resourceId,
          data,
        })
        return jsonResponse({ record }, { status: 201 })
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : 'Invalid plugin record data')
      }
    }

    return methodNotAllowed()
  }

  const pluginRuntimeMatch = url.pathname.match(/^\/api\/cms\/plugins\/([^/]+)\/runtime(?:\/.*)?$/)
  if (pluginRuntimeMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    return await handleServerPluginRuntimeRequest(req, db)
      ?? jsonResponse({ error: 'Plugin route not found' }, { status: 404 })
  }

  const pluginRecordItemMatch = url.pathname.match(/^\/api\/cms\/plugins\/([^/]+)\/resources\/([^/]+)\/records\/([^/]+)$/)
  if (pluginRecordItemMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    const pluginId = decodeURIComponent(pluginRecordItemMatch[1])
    const resourceId = decodeURIComponent(pluginRecordItemMatch[2])
    const recordId = decodeURIComponent(pluginRecordItemMatch[3])
    const resource = await getEnabledPluginResource(db, pluginId, resourceId)
    if (!resource) return jsonResponse({ error: 'Plugin resource not found' }, { status: 404 })

    if (req.method === 'PATCH') {
      const body = await readJsonObject(req)
      try {
        const data = validatePluginRecordData(resource, body.data ?? body)
        const record = await updatePluginRecord(db, {
          id: recordId,
          pluginId,
          resourceId,
          data,
        })
        if (!record) return jsonResponse({ error: 'Plugin record not found' }, { status: 404 })
        return jsonResponse({ record })
      } catch (err) {
        return badRequest(err instanceof Error ? err.message : 'Invalid plugin record data')
      }
    }

    if (req.method === 'DELETE') {
      const deleted = await deletePluginRecord(db, {
        id: recordId,
        pluginId,
        resourceId,
      })
      if (!deleted) return jsonResponse({ error: 'Plugin record not found' }, { status: 404 })
      return jsonResponse({ ok: true })
    }

    return methodNotAllowed()
  }

  if (url.pathname === '/api/cms/content/collections') {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    if (req.method === 'GET') {
      return jsonResponse({ collections: await listContentCollections(db) })
    }

    if (req.method === 'POST') {
      const body = await readJsonObject(req)
      const name = readString(body, 'name')
      if (!name) return badRequest('Collection name is required')

      const singularLabel = readString(body, 'singularLabel') || name.replace(/s$/i, '') || name
      const pluralLabel = readString(body, 'pluralLabel') || name
      const slug = slugify(readString(body, 'slug') || pluralLabel)
      const routeBase = readString(body, 'routeBase') || slug
      const collection = await createContentCollection(db, {
        name,
        slug,
        routeBase,
        singularLabel,
        pluralLabel,
      })
      return jsonResponse({ collection }, { status: 201 })
    }

    return methodNotAllowed()
  }

  const collectionItemMatch = url.pathname.match(/^\/api\/cms\/content\/collections\/([^/]+)$/)
  if (collectionItemMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    const collectionId = decodeURIComponent(collectionItemMatch[1])
    if (req.method === 'PATCH') {
      const body = await readJsonObject(req)
      const routeBase = readString(body, 'routeBase')
      if (!routeBase) return badRequest('Route base is required')

      const collection = await updateContentCollection(db, collectionId, { routeBase })
      if (!collection) return jsonResponse({ error: 'Collection not found' }, { status: 404 })
      return jsonResponse({ collection })
    }

    if (req.method === 'DELETE') {
      const collection = await softDeleteContentCollection(db, collectionId)
      if (!collection) return jsonResponse({ error: 'Collection cannot be deleted' }, { status: 409 })
      return jsonResponse({ collection })
    }

    return methodNotAllowed()
  }

  const collectionEntriesMatch = url.pathname.match(/^\/api\/cms\/content\/collections\/([^/]+)\/entries$/)
  if (collectionEntriesMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    const collectionId = decodeURIComponent(collectionEntriesMatch[1])
    if (req.method === 'GET') {
      return jsonResponse({ entries: await listContentEntries(db, collectionId) })
    }

    if (req.method === 'POST') {
      const body = await readJsonObject(req)
      const title = readString(body, 'title') || 'Untitled'
      const entry = await createContentEntry(db, {
        collectionId,
        title,
        slug: slugify(readString(body, 'slug') || title),
        bodyMarkdown: readString(body, 'bodyMarkdown'),
        featuredMediaId: readNullableString(body, 'featuredMediaId'),
        seoTitle: readString(body, 'seoTitle'),
        seoDescription: readString(body, 'seoDescription'),
      })
      return jsonResponse({ entry }, { status: 201 })
    }

    return methodNotAllowed()
  }

  const contentEntryMatch = url.pathname.match(/^\/api\/cms\/content\/entries\/([^/]+)$/)
  if (contentEntryMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })

    const entryId = decodeURIComponent(contentEntryMatch[1])
    if (req.method === 'GET') {
      const entry = await getContentEntry(db, entryId)
      if (!entry) return jsonResponse({ error: 'Content entry not found' }, { status: 404 })
      return jsonResponse({ entry })
    }

    if (req.method === 'PUT') {
      const body = await readJsonObject(req)
      const title = readString(body, 'title') || 'Untitled'
      const entry = await saveContentEntryDraft(db, entryId, {
        title,
        slug: slugify(readString(body, 'slug') || title),
        bodyMarkdown: readString(body, 'bodyMarkdown'),
        featuredMediaId: readNullableString(body, 'featuredMediaId'),
        seoTitle: readString(body, 'seoTitle'),
        seoDescription: readString(body, 'seoDescription'),
      })
      if (!entry) return jsonResponse({ error: 'Content entry not found' }, { status: 404 })
      return jsonResponse({ entry })
    }

    if (req.method === 'DELETE') {
      const entry = await softDeleteContentEntry(db, entryId)
      if (!entry) return jsonResponse({ error: 'Content entry not found' }, { status: 404 })
      return jsonResponse({ entry })
    }

    return methodNotAllowed()
  }

  const publishContentEntryMatch = url.pathname.match(/^\/api\/cms\/content\/entries\/([^/]+)\/publish$/)
  if (publishContentEntryMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    if (req.method !== 'POST') return methodNotAllowed()

    const entryId = decodeURIComponent(publishContentEntryMatch[1])
    return jsonResponse(await publishContentEntry(db, entryId, admin.id))
  }

  const contentEntryStatusMatch = url.pathname.match(/^\/api\/cms\/content\/entries\/([^/]+)\/status$/)
  if (contentEntryStatusMatch) {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    if (req.method !== 'PATCH') return methodNotAllowed()

    const body = await readJsonObject(req)
    const status = readString(body, 'status')
    if (status !== 'draft' && status !== 'unpublished') {
      return badRequest('Status must be draft or unpublished')
    }

    const entryId = decodeURIComponent(contentEntryStatusMatch[1])
    const entry = await updateContentEntryStatus(db, entryId, status)
    if (!entry) return jsonResponse({ error: 'Content entry not found' }, { status: 404 })
    return jsonResponse({ entry })
  }

  if (url.pathname === '/api/cms/publish') {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    if (req.method !== 'POST') return methodNotAllowed()

    return jsonResponse(await publishDraftSite(db, admin.id))
  }

  if (url.pathname === '/api/cms/publish/status') {
    const admin = await getAuthenticatedAdmin(req, db)
    if (!admin) return jsonResponse({ error: 'Unauthorized' }, { status: 401 })
    if (req.method !== 'GET') return methodNotAllowed()

    return jsonResponse(await getDraftPublishStatus(db))
  }

  return jsonResponse({ error: 'Not found' }, { status: 404 })
}
