import { defineConfig, type Plugin } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
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

  // Bun server namespaces — explicitly proxied even though they carry a file
  // extension. The fallthrough rule below rejects anything with `.<ext>` to
  // avoid swallowing requests for editor static assets, which means we have
  // to opt in any backend route whose URL ends with `.something`.
  //   /_pb/assets/  → runtime script bundles (esbuild output)
  //   /_pb/css/     → per-site published CSS bundle (reset / framework / style)
  if (pathname.startsWith('/_pb/assets/')) return true
  if (pathname.startsWith('/_pb/css/')) return true

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
  if (moduleId.includes('node_modules/@dnd-kit') || moduleId.includes('node_modules/@use-gesture')) {
    return 'dnd-vendor'
  }
  if (moduleId.includes('node_modules/@sinclair/typebox')) return 'validation-vendor'
  if (moduleId.includes('node_modules/dompurify') || moduleId.includes('node_modules/immer')) {
    return 'state-vendor'
  }
  return null
}

// React Compiler — enabled in `infer` mode (the preset default).
//
// `infer` only compiles functions that look like components or hooks
// (`UpperCamelCase` names returning JSX, or `useFoo` hooks). Plain helpers —
// including the router's module-level `browserSubscribe` / `getBrowserSnapshot`
// passed to `useSyncExternalStore`, and Zustand selector arrow functions —
// are NOT compiled. That avoids the `useMemoCache` insertions into non-hook
// code that previously broke Rules-of-Hooks.
//
// The previous trial of `compilationMode: 'all'` (which DID try to compile
// helpers) is what produced the earlier errors. Leaving the preset on its
// default avoids that whole failure mode.
//
// Zustand + Immer notes:
//   - The immer middleware wraps `setState((draft) => ...)` in `produce()`.
//     Drafts only live for the duration of that callback; after `produce`
//     returns, callers see a regular immutable object. Selectors used inside
//     a component render therefore never see a draft proxy — the compiler's
//     memo cache holds references to post-produce objects, which are valid
//     forever (immer just replaces them on the next mutation).
//   - The earlier "Cannot perform 'get' on a proxy that has been revoked"
//     report was against pre-1.0 babel-plugin-react-compiler; v1.0 GA
//     handles store-shaped reads cleanly in the patterns this codebase uses.
//
// If a specific function legitimately can't be compiled (escape hatch),
// add the `"use no memo"` directive at the top of the function body.

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    publicSiteDevProxyPlugin(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ],
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, 'src/core'),
      '@modules': path.resolve(__dirname, 'src/modules'),
      '@ui': path.resolve(__dirname, 'src/ui'),
      '@admin': path.resolve(__dirname, 'src/admin'),
      '@site': path.resolve(__dirname, 'src/admin/pages/site'),
      '@content': path.resolve(__dirname, 'src/admin/pages/content'),
      '@plugins': path.resolve(__dirname, 'src/admin/pages/plugins'),
      '@users': path.resolve(__dirname, 'src/admin/pages/users'),
      // pixel-art-icons resolves through node_modules (link: dep during local
      // dev, registry version once published). No alias needed.
    },
  },
  build: {
    // Aligned with the per-chunk caps in
    // `src/__tests__/architecture/bundle-size-budgets.test.ts` — the real
    // enforcement of bundle size in this repo. The two intentionally-large
    // lazy chunks (`AdminCanvasLayout-*` budget 700 KB, `CodeMirrorEditor-*`
    // budget 650 KB) sit just above Vite's default 500 KB warning threshold,
    // so the default fires on every build for chunks that are explicitly
    // capped and route-lazy. Raising this to 720 KB silences the
    // false-positive noise while still catching anything that grows past the
    // established budgets — `bundle-size-budgets.test.ts` is the actual gate.
    chunkSizeWarningLimit: 720,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: vendorChunkName }],
          // Safety net: don't emit a vendor chunk so small the extra HTTP
          // request costs more than the bytes saved. If a group shrinks
          // below this floor, Rolldown folds it back into a parent chunk.
          minSize: 10_000,
        },
        // Manual chunk groups can reorder module evaluation across chunks,
        // which matters when a module has side effects at evaluation time
        // (e.g. global polyfill registration, CSS-in-JS injection). This
        // injects tiny runtime helpers so modules always run in declared
        // order. Costs a few bytes; bounded by the bundle-size budgets in
        // src/__tests__/architecture/bundle-size-budgets.test.ts.
        strictExecutionOrder: true,
      },
    },
  },
  server: {
    proxy: {
      // The whole `/admin/api/` prefix (CMS + agent) is forwarded to the
      // Bun backend. Agent endpoints live under `/admin/api/agent` (and
      // `/admin/api/agent/tool-result`) so the admin session cookie —
      // scoped to `Path=/admin` to keep it off the public site — actually
      // accompanies the request. The `ws: false` default suffices; we do
      // not need WebSocket upgrades for the agent (NDJSON streams over a
      // standard HTTP response).
      '/admin/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      // Public-site runtime endpoints — frontend tracker POSTs, loop
      // pagination GETs, runtime asset / CSS bundles. Must be in this
      // explicit `proxy:` map (not just the GET-only middleware) because
      // the tracker uses POST and the GET-only `publicSiteDevProxyPlugin`
      // would otherwise drop those requests.
      '/_pb': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
