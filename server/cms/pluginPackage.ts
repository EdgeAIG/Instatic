import { strFromU8, unzipSync } from 'fflate'
import {
  parsePluginManifest,
} from '../../src/core/extensions/manifest'
import type { PluginManifest } from '../../src/core/plugin-sdk'

const SAFE_PACKAGE_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[a-zA-Z0-9._/-]+$/

export interface PluginPackage {
  manifest: PluginManifest
  files: Record<string, string>
}

function assertSafePackagePath(path: string): void {
  if (!SAFE_PACKAGE_PATH.test(path)) {
    throw new Error(`Unsafe plugin package path "${path}"`)
  }
}

export async function readPluginPackage(file: File): Promise<PluginPackage> {
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()))
  const files: Record<string, string> = {}

  for (const [path, bytes] of Object.entries(archive)) {
    if (path.endsWith('/')) continue
    assertSafePackagePath(path)
    files[path] = strFromU8(bytes)
  }

  const manifestText = files['plugin.json']
  if (!manifestText) throw new Error('Plugin package is missing plugin.json')

  const manifest = parsePluginManifest(JSON.parse(manifestText))
  const entrypoints = [
    ...Object.values(manifest.entrypoints ?? {}),
    ...manifest.adminPages.flatMap((page) =>
      page.content.kind === 'app' ? [page.content.entry] : [],
    ),
  ]

  for (const entry of entrypoints) {
    if (entry && !files[entry]) {
      throw new Error(`Missing plugin entrypoint "${entry}"`)
    }
  }

  return { manifest, files }
}
