import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import * as sdk from '../../core/plugin-sdk'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))
const scannedRoots = ['src', 'server', 'docs']
const legacyTypesPath = join('src', 'core', 'extensions', 'types.ts')
const legacyTypesImportMarker = ['extensions', 'types'].join('/')

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) return collectFiles(fullPath)
    if (!entry.isFile()) return []
    if (!/\.(ts|tsx|md)$/.test(entry.name)) return []
    return [fullPath]
  }))
  return files.flat()
}

describe('public plugin SDK exports', () => {
  it('exports stable runtime constants and helper functions', () => {
    expect(sdk.PLUGIN_API_VERSION).toBe(1)
    expect(typeof sdk.permissionLabel).toBe('function')
    expect(typeof sdk.assertPluginPermission).toBe('function')
  })

  it('exports lifecycle hook names in execution order', () => {
    expect(sdk.SERVER_PLUGIN_LIFECYCLE_HOOKS).toEqual([
      'install',
      'activate',
      'deactivate',
      'uninstall',
    ])
  })

  it('does not keep legacy plugin type compatibility paths', async () => {
    expect(existsSync(join(repoRoot, legacyTypesPath))).toBe(false)

    const files = (await Promise.all(
      scannedRoots.map((root) => collectFiles(join(repoRoot, root))),
    )).flat()

    const offenders: string[] = []
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      if (content.includes(legacyTypesImportMarker)) {
        offenders.push(relative(repoRoot, file))
      }
    }

    expect(offenders).toEqual([])
  })

  it('keeps public plugin types at the SDK boundary', async () => {
    const compatibilityReexports = [
      'src/core/extensions/runtime.ts',
      'src/core/extensions/adminRuntime.ts',
      'server/cms/serverPluginRuntime.ts',
    ]

    const offenders: string[] = []
    for (const file of compatibilityReexports) {
      const content = await readFile(join(repoRoot, file), 'utf8')
      if (/export\s+type\s+\{[\s\S]*?\}\s+from\s+['"].*plugin-sdk['"]/.test(content)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })
})
