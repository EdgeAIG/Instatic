import { describe, expect, it } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { parsePluginManifest } from '../../core/extensions/manifest'

describe('plugin author template', () => {
  it('ships a valid plugin manifest template', async () => {
    const manifest = parsePluginManifest(JSON.parse(
      await readFile('examples/plugins/template/plugin.json', 'utf-8'),
    ))
    expect(manifest.id).toBe('acme.template')
    expect(manifest.entrypoints?.server).toBe('server/index.js')
    expect(manifest.entrypoints?.editor).toBe('editor/index.js')
  })

  it('ships SDK declaration examples for all runtime surfaces', async () => {
    const declarations = await readFile('examples/plugins/plugin-sdk.d.ts', 'utf-8')
    expect(declarations).toContain('interface ServerPluginApi')
    expect(declarations).toContain('interface EditorPluginApi')
    expect(declarations).toContain('interface PluginAdminAppApi')
  })
})
