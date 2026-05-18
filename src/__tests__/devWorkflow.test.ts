import { describe, expect, it } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'

const root = new URL('../../', import.meta.url)

function readSiteFile(path: string) {
  return readFileSync(new URL(path, root), 'utf-8')
}

describe('development workflow', () => {
  it('`bun run dev` is the one-command launcher for cms + vite', () => {
    const pkg = JSON.parse(readSiteFile('package.json')) as {
      scripts: Record<string, string>
    }

    expect(pkg.scripts['dev']).toBe('bun run scripts/dev.ts')
    expect(pkg.scripts['dev:agent']).toBe('bun run dev:server')
    expect(pkg.scripts['dev:server']).toBe('bun --watch server/index.ts')
    expect(pkg.scripts['dev:all']).toBeUndefined()
    expect(existsSync(new URL('scripts/dev.ts', root))).toBe(true)
    expect(existsSync(new URL('scripts/dev-all.ts', root))).toBe(false)

    const script = readSiteFile('scripts/dev.ts')
    // Spawns cms + vite directly (no recursive `bun run dev` call).
    expect(script).toContain('bun --watch server/index.ts')
    expect(script).toContain('vite --host 127.0.0.1')
    // Knows about the docker postgres host port.
    expect(script).toContain('127.0.0.1')
    expect(script).toContain('5433')
    // Manages the docker postgres + app containers.
    expect(script).toContain('compose')
    expect(script).toContain('postgres')
    expect(script).toContain('app')
    // Forwards signals to children.
    expect(script).toContain('SIGINT')
    expect(script).toContain('SIGTERM')
  })

  it('Vite proxies CMS API and uploaded media to the local Bun server', () => {
    const viteConfig = readSiteFile('vite.config.ts')

    // `/admin/api` covers both the CMS endpoints (`/admin/api/cms/...`) and
    // the agent endpoints (`/admin/api/agent`, `/admin/api/agent/tool-result`).
    // The shared `/admin/` prefix is required so the session cookie (scoped
    // to `Path=/admin`) is sent on every request to the Bun backend.
    expect(viteConfig).toContain("'/admin/api'")
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

  it('Vite forwards published runtime assets to the CMS server in local dev', () => {
    const viteConfig = readSiteFile('vite.config.ts')

    expect(viteConfig).toContain("pathname.startsWith('/_pb/assets/')")
  })

  it('Docker Postgres uses a non-default host port for local dev', () => {
    const compose = readSiteFile('docker-compose.yml')

    // docker-compose.yml is dev-only and only exposes the Postgres container
    // on a non-default host port (5433) to avoid clashing with a local
    // Postgres install. The DATABASE_URL the app uses to reach the container
    // lives in compose.prod.yml — not in the dev-only compose file.
    expect(compose).toContain('"5433:5432"')
    expect(compose).toContain('image: postgres:16')
  })
})
