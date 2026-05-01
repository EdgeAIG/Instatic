import { listCmsPlugins } from '../persistence/cmsPlugins'
import type { EditorPluginModule } from '../plugin-sdk'
import { activateEditorPlugin, pluginRuntime } from './runtime'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
type ImportModule = (url: string) => Promise<EditorPluginModule>

export interface InstalledEditorPluginActivationFailure {
  pluginId: string
  error: unknown
}

export interface InstalledEditorPluginActivationResult {
  activated: string[]
  failed: InstalledEditorPluginActivationFailure[]
}

interface ActivateInstalledEditorPluginsOptions {
  fetchImpl?: FetchLike
  importModule?: ImportModule
}

const defaultFetch: FetchLike = (input, init) => globalThis.fetch(input, init)

const defaultImportModule: ImportModule = async (url) =>
  await import(/* @vite-ignore */ url) as EditorPluginModule

function editorEntrypointUrl(assetBasePath: string, entrypoint: string): string {
  return `${assetBasePath.replace(/\/+$/g, '')}/${entrypoint.replace(/^\/+/g, '')}`
}

export async function activateInstalledEditorPlugins(
  options: ActivateInstalledEditorPluginsOptions = {},
): Promise<InstalledEditorPluginActivationResult> {
  const fetchImpl = options.fetchImpl ?? defaultFetch
  const importModule = options.importModule ?? defaultImportModule
  const result: InstalledEditorPluginActivationResult = {
    activated: [],
    failed: [],
  }

  pluginRuntime.reset()

  const payload = await listCmsPlugins(fetchImpl)
  for (const plugin of payload.plugins) {
    const { manifest } = plugin
    if (
      !plugin.enabled ||
      plugin.lifecycleStatus === 'error' ||
      !manifest.assetBasePath ||
      !manifest.entrypoints?.editor
    ) {
      continue
    }

    try {
      const mod = await importModule(
        editorEntrypointUrl(manifest.assetBasePath, manifest.entrypoints.editor),
      )
      await activateEditorPlugin({
        ...manifest,
        grantedPermissions: plugin.grantedPermissions,
      }, mod, fetchImpl)
      result.activated.push(plugin.id)
    } catch (error) {
      result.failed.push({ pluginId: plugin.id, error })
    }
  }

  return result
}
