import {
  createCmsPluginResourceRecord,
  deleteCmsPluginResourceRecord,
  listCmsPluginResourceRecords,
  updateCmsPluginResourceRecord,
} from '../persistence/cmsPluginRecords'
import type {
  PluginAdminAppApi,
  PluginAdminAppContext,
  PluginAdminAppModule,
  PluginAdminPageRoute,
} from '../plugin-sdk'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type PluginAdminAppImport = (url: string) => Promise<PluginAdminAppModule>

interface RenderPluginAdminAppOptions {
  page: PluginAdminPageRoute
  root: HTMLElement
  fetchImpl?: FetchLike
  importModule?: PluginAdminAppImport
}

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init)

const defaultImportModule: PluginAdminAppImport = async (url) =>
  await import(/* @vite-ignore */ url) as PluginAdminAppModule

function appEntrypointUrl(assetPath: string, entrypoint: string): string {
  return `${assetPath.replace(/\/+$/g, '')}/${entrypoint.replace(/^\/+/g, '')}`
}

function runtimePath(pluginId: string, path: string): string {
  const normalized = path.trim().replace(/^\/+/g, '')
  return `/api/cms/plugins/${encodeURIComponent(pluginId)}/runtime/${normalized}`
}

function createAdminPluginApi(pluginId: string, fetchImpl: FetchLike): PluginAdminAppApi {
  return {
    cms: {
      routes: {
        fetch(path, init) {
          return fetchImpl(runtimePath(pluginId, path), {
            credentials: 'include',
            ...init,
          })
        },
        async json<T = unknown>(path: string, init?: RequestInit): Promise<T> {
          const res = await fetchImpl(runtimePath(pluginId, path), {
            credentials: 'include',
            ...init,
          })
          if (!res.ok) throw new Error(`Plugin route failed with ${res.status}`)
          return await res.json() as T
        },
      },
      storage: {
        collection(resourceId) {
          return {
            list: () => listCmsPluginResourceRecords(pluginId, resourceId, fetchImpl),
            create: (data) => createCmsPluginResourceRecord(pluginId, resourceId, data, fetchImpl),
            update: (recordId, data) => updateCmsPluginResourceRecord(pluginId, resourceId, recordId, data, fetchImpl),
            delete: (recordId) => deleteCmsPluginResourceRecord(pluginId, resourceId, recordId, fetchImpl),
          }
        },
      },
    },
  }
}

export async function renderPluginAdminApp({
  page,
  root,
  fetchImpl = defaultFetch,
  importModule = defaultImportModule,
}: RenderPluginAdminAppOptions): Promise<() => void | Promise<void>> {
  if (page.content.kind !== 'app') {
    throw new Error('Plugin admin app renderer requires app page content')
  }
  if (!page.content.assetPath) {
    throw new Error(`Plugin admin app "${page.pluginId}:${page.id}" is missing an asset path`)
  }

  root.replaceChildren()
  const mod = await importModule(appEntrypointUrl(page.content.assetPath, page.content.entry))
  if (typeof mod.render !== 'function') {
    throw new Error(`Plugin admin app "${page.pluginId}:${page.id}" does not export render()`)
  }

  const context: PluginAdminAppContext = {
    root,
    page,
    api: createAdminPluginApi(page.pluginId, fetchImpl),
  }
  await mod.render(context)

  return async () => {
    if (mod.cleanup) await mod.cleanup(context)
    root.replaceChildren()
  }
}
