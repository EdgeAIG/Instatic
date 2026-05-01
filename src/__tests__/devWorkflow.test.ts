import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)

function readSiteFile(path: string) {
  return readFileSync(new URL(path, root), 'utf-8')
}

describe('development workflow', () => {
  it('dev:all starts the CMS server and Vite dev server together', () => {
    const pkg = JSON.parse(readSiteFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts['dev:all']).toBe('bun run scripts/dev-all.ts')
    expect(pkg.scripts['dev:agent']).toBe('bun run dev:server')
    expect(pkg.scripts['dev:server']).toBe('bun --watch server/index.ts')
    expect(existsSync(new URL('scripts/dev-all.ts', root))).toBe(true)

    const script = readSiteFile('scripts/dev-all.ts')
    expect(script).toContain('bun run dev:server')
    expect(script).toContain('bun run dev -- --host 127.0.0.1')
    expect(script).toContain('127.0.0.1:5433')
    expect(script).toContain('SIGINT')
    expect(script).toContain('SIGTERM')
  })

  it('Vite proxies CMS API and uploaded media to the local Bun server', () => {
    const viteConfig = readSiteFile('vite.config.ts')

    expect(viteConfig).toContain("'/api/cms'")
    expect(viteConfig).toContain("'/uploads'")
    expect(viteConfig).toContain("target: 'http://localhost:3001'")
    expect(viteConfig).toContain('changeOrigin: true')
  })

  it('Vite forwards public page routes to the CMS server instead of the admin SPA', () => {
    const viteConfig = readSiteFile('vite.config.ts')

    expect(viteConfig).toContain('function publicSiteDevProxyPlugin')
    expect(viteConfig).toContain('publicSiteDevProxyPlugin()')
    expect(viteConfig).toContain("pathname === '/admin'")
    expect(viteConfig).toContain("pathname.startsWith('/admin/')")
    expect(viteConfig).toContain("pathname === '/'")
    expect(viteConfig).toContain('proxyPublicSiteRequest')
  })

  it('Docker Postgres uses a non-default host port for local dev', () => {
    const compose = readSiteFile('docker-compose.yml')

    expect(compose).toContain('"5433:5432"')
    expect(compose).toContain('postgres://page_builder:page_builder@postgres:5432/page_builder')
  })
})
