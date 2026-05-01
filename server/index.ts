import { createPgPool } from './cms/db'
import { runMigrations } from './cms/migrations'
import { readServerConfig } from './config'

await import('./domEnvironment')
const { handleServerRequest } = await import('./router')
const { activateInstalledServerPlugins } = await import('./cms/serverPluginRuntime')

const config = readServerConfig()
const db = createPgPool(config.databaseUrl)
await runMigrations(db)
await activateInstalledServerPlugins(db, config.uploadsDir)

const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.VITE_ALLOWED_ORIGIN,
].filter(Boolean) as string[]

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }
}

Bun.serve({
  port: config.port,

  async fetch(req: Request) {
    const origin = req.headers.get('origin')
    const cors = corsHeaders(origin)

    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    try {
      const res = await handleServerRequest(req, {
        db,
        staticDir: config.staticDir,
        uploadsDir: config.uploadsDir,
      })
      for (const [k, v] of Object.entries(cors)) {
        res.headers.set(k, v)
      }
      return res
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal server error'
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...cors },
      })
    }
  },

  error(err: Error) {
    console.error('[server] Unhandled error:', err)
    return new Response('Internal Server Error', { status: 500 })
  },
})

console.log(`[server] Listening on http://localhost:${config.port}`)
