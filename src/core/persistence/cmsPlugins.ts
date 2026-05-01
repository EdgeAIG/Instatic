import type {
  CmsPluginsPayload,
  InstalledPlugin,
  PluginManifest,
  PluginPermission,
} from '../plugin-sdk'
import { responseErrorMessage } from './httpErrors'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res, fallback))
  }
  return await res.json() as T
}

function emptyPayload(body: Partial<CmsPluginsPayload>): CmsPluginsPayload {
  return {
    plugins: Array.isArray(body.plugins) ? body.plugins : [],
    adminPages: Array.isArray(body.adminPages) ? body.adminPages : [],
  }
}

export async function listCmsPlugins(
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<CmsPluginsPayload> {
  const res = await fetchImpl(`${basePath}/plugins`, {
    method: 'GET',
    credentials: 'include',
  })
  return emptyPayload(await readJson<CmsPluginsPayload>(
    res,
    `CMS plugins failed with ${res.status}`,
  ))
}

export async function installCmsPluginManifest(
  manifest: PluginManifest,
  grantedPermissionsOrFetch: PluginPermission[] | FetchLike = [],
  fetchImplOrBasePath: FetchLike | string = globalThis.fetch.bind(globalThis),
  maybeBasePath = '/api/cms',
): Promise<{ plugin?: InstalledPlugin } & CmsPluginsPayload> {
  const grantedPermissions = Array.isArray(grantedPermissionsOrFetch) ? grantedPermissionsOrFetch : []
  const fetchImpl =
    typeof grantedPermissionsOrFetch === 'function'
      ? grantedPermissionsOrFetch
      : typeof fetchImplOrBasePath === 'function'
        ? fetchImplOrBasePath
        : globalThis.fetch.bind(globalThis)
  const basePath =
    typeof fetchImplOrBasePath === 'string'
      ? fetchImplOrBasePath
      : maybeBasePath

  const res = await fetchImpl(`${basePath}/plugins`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      grantedPermissions.length > 0
        ? { manifest, grantedPermissions }
        : manifest,
    ),
  })
  const body = await readJson<{ plugin?: InstalledPlugin } & Partial<CmsPluginsPayload>>(
    res,
    `CMS plugin install failed with ${res.status}`,
  )
  return {
    plugin: body.plugin,
    ...emptyPayload(body),
  }
}

export async function inspectCmsPluginPackage(
  file: File,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<PluginManifest> {
  const formData = new FormData()
  formData.set('file', file)
  const res = await fetchImpl(`${basePath}/plugins/inspect-package`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const body = await readJson<{ manifest?: PluginManifest }>(
    res,
    `CMS plugin package inspection failed with ${res.status}`,
  )
  if (!body.manifest) throw new Error('CMS plugin package inspection response was missing manifest')
  return body.manifest
}

export async function installCmsPluginPackage(
  file: File,
  grantedPermissions: PluginPermission[],
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<{ plugin?: InstalledPlugin } & CmsPluginsPayload> {
  const formData = new FormData()
  formData.set('file', file)
  formData.set('grantedPermissions', JSON.stringify(grantedPermissions))

  const res = await fetchImpl(`${basePath}/plugins/package`, {
    method: 'POST',
    credentials: 'include',
    body: formData,
  })
  const body = await readJson<{ plugin?: InstalledPlugin } & Partial<CmsPluginsPayload>>(
    res,
    `CMS plugin package install failed with ${res.status}`,
  )
  return {
    plugin: body.plugin,
    ...emptyPayload(body),
  }
}

export async function setCmsPluginEnabled(
  pluginId: string,
  enabled: boolean,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<{ plugin?: InstalledPlugin } & CmsPluginsPayload> {
  const res = await fetchImpl(`${basePath}/plugins/${encodeURIComponent(pluginId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled }),
  })
  const body = await readJson<{ plugin?: InstalledPlugin } & Partial<CmsPluginsPayload>>(
    res,
    `CMS plugin update failed with ${res.status}`,
  )
  return {
    plugin: body.plugin,
    ...emptyPayload(body),
  }
}

export async function removeCmsPlugin(
  pluginId: string,
  fetchImpl: FetchLike = globalThis.fetch.bind(globalThis),
  basePath = '/api/cms',
): Promise<void> {
  const res = await fetchImpl(`${basePath}/plugins/${encodeURIComponent(pluginId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(await responseErrorMessage(res, `CMS plugin delete failed with ${res.status}`))
  }
}
