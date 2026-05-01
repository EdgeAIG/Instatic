import { handleAgentRequest } from './agentHandler'
import { handleCmsRequest } from './cms/handlers'
import type { DbClient } from './cms/db'
import {
  getContentEntryRedirectByRoute,
  getPublishedContentEntryByRoute,
} from './cms/contentRepository'
import { getLatestPublishedSiteSnapshot, getPublishedPageBySlug } from './cms/publishRepository'
import { renderPublishedContentTemplate, renderPublishedSnapshot } from './cms/publicRenderer'
import { jsonResponse } from './http'
import { serveAdminApp, serveStaticFile } from './static'

interface ServerRuntime {
  db: DbClient
  staticDir?: string
  uploadsDir?: string
}

function publicSlugFromPath(pathname: string): string {
  const trimmed = pathname.replace(/^\/+|\/+$/g, '')
  return trimmed === '' ? 'index' : trimmed
}

function contentRouteFromPath(pathname: string): { collectionRouteBase: string; entrySlug: string } | null {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (parts.length < 2) return null
  return {
    collectionRouteBase: `/${parts.slice(0, -1).map((part) => decodeURIComponent(part)).join('/')}`,
    entrySlug: decodeURIComponent(parts[parts.length - 1]),
  }
}

export async function handleServerRequest(
  req: Request,
  runtime: ServerRuntime,
): Promise<Response> {
  const url = new URL(req.url)

  if (url.pathname === '/health') {
    return jsonResponse({ status: 'ok', ts: Date.now() })
  }

  if (url.pathname.startsWith('/api/cms/')) {
    return handleCmsRequest(req, runtime.db, { uploadsDir: runtime.uploadsDir })
  }

  if (url.pathname === '/api/agent') {
    return handleAgentRequest(req)
  }

  if (runtime.staticDir && url.pathname.startsWith('/assets/')) {
    const asset = await serveStaticFile(runtime.staticDir, url.pathname)
    if (asset) return asset
  }

  if (runtime.uploadsDir && url.pathname.startsWith('/uploads/')) {
    const upload = await serveStaticFile(runtime.uploadsDir, url.pathname.slice('/uploads'.length))
    if (upload) return upload
  }

  if (
    runtime.staticDir &&
    (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))
  ) {
    const adminApp = await serveAdminApp(runtime.staticDir)
    if (adminApp) return adminApp
  }

  if (req.method === 'GET') {
    const snapshot = await getPublishedPageBySlug(runtime.db, publicSlugFromPath(url.pathname))
    if (snapshot) {
      return new Response(renderPublishedSnapshot(snapshot), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }

    const contentRoute = contentRouteFromPath(url.pathname)
    if (contentRoute) {
      const entry = await getPublishedContentEntryByRoute(
        runtime.db,
        contentRoute.collectionRouteBase,
        contentRoute.entrySlug,
      )
      if (entry) {
        const siteSnapshot = await getLatestPublishedSiteSnapshot(runtime.db)
        if (siteSnapshot) {
          const html = renderPublishedContentTemplate(siteSnapshot, entry)
          if (html) {
            return new Response(html, {
              headers: { 'content-type': 'text/html; charset=utf-8' },
            })
          }
        }
      }

      const redirect = await getContentEntryRedirectByRoute(
        runtime.db,
        contentRoute.collectionRouteBase,
        contentRoute.entrySlug,
      )
      if (redirect) {
        return new Response(null, {
          status: 301,
          headers: { location: `${redirect.targetPath}${url.search}` },
        })
      }
    }
  }

  return jsonResponse({ error: 'Not found' }, { status: 404 })
}
