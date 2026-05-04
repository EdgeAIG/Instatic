import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'node:http'

const CMS_DEV_SERVER_ORIGIN = 'http://localhost:3001'
const FILE_EXTENSION_RE = /\.[a-zA-Z0-9]+$/

function isEditorAppPath(pathname: string): boolean {
  return (
    pathname === '/admin' ||
    pathname.startsWith('/admin/') ||
    pathname === '/index.html' ||
    pathname.startsWith('/@') ||
    pathname.startsWith('/__vite') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/node_modules/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/uploads/')
  )
}

function shouldProxyPublicSiteRequest(req: IncomingMessage): boolean {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false
  if (!req.url) return false

  const { pathname } = new URL(req.url, CMS_DEV_SERVER_ORIGIN)
  if (isEditorAppPath(pathname)) return false

  if (pathname.startsWith('/_pb/assets/')) return true

  return pathname === '/' || !FILE_EXTENSION_RE.test(pathname)
}

async function proxyPublicSiteRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const target = new URL(req.url ?? '/', CMS_DEV_SERVER_ORIGIN)
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value) continue
    if (['connection', 'host', 'content-length'].includes(key.toLowerCase())) continue
    headers.set(key, Array.isArray(value) ? value.join(', ') : value)
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      redirect: 'manual',
    })
  } catch {
    res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('CMS development server is not reachable')
    return
  }

  const responseHeaders: Record<string, string> = {}
  upstream.headers.forEach((value, key) => {
    responseHeaders[key] = value
  })
  res.writeHead(upstream.status, responseHeaders)

  if (req.method === 'HEAD' || !upstream.body) {
    res.end()
    return
  }

  const body = Buffer.from(await upstream.arrayBuffer())
  res.end(body)
}

function publicSiteDevProxyPlugin(): Plugin {
  return {
    name: 'page-builder-public-site-dev-proxy',
    apply: 'serve',

    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!shouldProxyPublicSiteRequest(req)) {
          next()
          return
        }

        void proxyPublicSiteRequest(req, res).catch((err) => {
          next(err)
        })
      })
    },
  }
}

/**
 * Embeds the Claude Agent SDK handler directly in the Vite dev server so
 * the editor app gets a working agent endpoint without needing a separate
 * `bun run dev:agent` process.
 *
 * POST /api/agent is served by the same process as the HMR/asset server.
 * Auth: ambient Claude Code credentials (claude auth login) — Constraint #385.
 * No ANTHROPIC_API_KEY, no endpoint URL, no env var required.
 *
 * In normal use, run the full stack via `bun run dev` (which spawns both
 * vite and the Bun cms server on 3001). The standalone `bun run dev:vite`
 * also works when only the editor SPA + agent endpoint is needed.
 */
function agentDevPlugin(): Plugin {
  return {
    name: 'page-builder-agent-dev',
    apply: 'serve',

    configureServer(server) {
      const handlerPath = path.resolve(__dirname, 'server/agentHandler.ts')

      const getHandler = async () => {
        const cached = server.moduleGraph.getModuleById(handlerPath)
        if (cached) {
          server.moduleGraph.invalidateModule(cached)
        }
        // ssrLoadModule uses Vite's esbuild pipeline; reloading per request keeps
        // AI prompt/tool changes visible during development without restarting Vite.
        const mod = await server.ssrLoadModule(handlerPath)
        return mod.handleAgentRequest as (req: Request) => Promise<Response>
      }

      // NOTE: this path must match AGENT_API_PATH in src/core/agent/agentConfig.ts
      server.middlewares.use(
        '/api/agent',
        (req: IncomingMessage, res: ServerResponse) => {
          const origin = req.headers.origin ?? null
          const corsHeaders: Record<string, string> = {
            'Access-Control-Allow-Origin': origin ?? '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          }

          // CORS preflight
          if (req.method === 'OPTIONS') {
            res.writeHead(204, corsHeaders)
            res.end()
            return
          }

          if (req.method !== 'POST') {
            res.writeHead(405, corsHeaders)
            res.end('Method not allowed')
            return
          }

          // Collect request body chunks
          const chunks: Buffer[] = []
          req.on('data', (chunk: Buffer) => chunks.push(chunk))
          req.on('error', () => {
            if (!res.headersSent) {
              res.writeHead(500, corsHeaders)
              res.end(JSON.stringify({ error: 'Request error' }))
            }
          })
          req.on('end', () => {
            // Deliberately NOT awaiting here — kick off async work inside
            void (async () => {
              try {
                const handler = await getHandler()
                const body = Buffer.concat(chunks)

                // Wrap Node IncomingMessage into the Web API Request that
                // handleAgentRequest expects.
                const fakeReq = new Request('http://localhost/api/agent', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body,
                })

                const response = await handler(fakeReq)

                res.writeHead(response.status, {
                  'Content-Type':
                    response.headers.get('Content-Type') ?? 'application/x-ndjson',
                  'Cache-Control': 'no-cache',
                  'X-Accel-Buffering': 'no',
                  ...corsHeaders,
                })

                if (!response.body) {
                  res.end()
                  return
                }

                // Stream NDJSON chunks back to the browser
                const reader = response.body.getReader()
                try {
                  while (true) {
                    const { done, value } = await reader.read()
                    if (done) {
                      res.end()
                      break
                    }
                    // Respect backpressure
                    if (!res.write(value)) {
                      await new Promise<void>((r) => res.once('drain', r))
                    }
                  }
                } catch {
                  if (!res.headersSent) res.writeHead(500, corsHeaders)
                  try { res.end() } catch { /* already closed */ }
                }
              } catch (err) {
                console.error('[agent-dev-plugin]', err)
                if (!res.headersSent) {
                  res.writeHead(500, {
                    'Content-Type': 'application/json',
                    ...corsHeaders,
                  })
                }
                try {
                  res.end(JSON.stringify({ error: 'Internal server error' }))
                } catch { /* already ended */ }
              }
            })()
          })
        },
      )
    },
  }
}

// Stable vendor chunk groups for long-term browser caching. Vendor code
// rarely changes, so isolating it from the app code means returning users
// re-download only the (small) app chunks when we ship a new build.
//
// Notes:
//   - We deliberately do NOT chunk @codemirror / @lezer / codemirror — they
//     are already isolated via React.lazy() in CodeMirrorEditor.tsx.
//   - We deliberately do NOT chunk pixel-art-icons — it tree-shakes through
//     deep imports, and forcing a vendor chunk would pull every icon in.
function vendorChunkName(moduleId: string): string | null {
  if (!moduleId.includes('node_modules')) return null
  if (moduleId.includes('node_modules/react-dom') || /node_modules\/react(\/|\\)/.test(moduleId)) {
    return 'react-vendor'
  }
  if (moduleId.includes('node_modules/react-router')) return 'router-vendor'
  if (moduleId.includes('node_modules/@dnd-kit') || moduleId.includes('node_modules/@use-gesture')) {
    return 'dnd-vendor'
  }
  if (moduleId.includes('node_modules/zod')) return 'validation-vendor'
  if (moduleId.includes('node_modules/dompurify') || moduleId.includes('node_modules/immer')) {
    return 'state-vendor'
  }
  return null
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    publicSiteDevProxyPlugin(),
    react(),
    agentDevPlugin(),
  ],
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@editor': path.resolve(__dirname, 'src/editor'),
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@admin': path.resolve(__dirname, 'src/admin'),
      // pixel-art-icons resolves through node_modules (link: dep during local
      // dev, registry version once published). No alias needed.
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: vendorChunkName }],
        },
      },
    },
  },
  server: {
    proxy: {
      '/api/cms': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
