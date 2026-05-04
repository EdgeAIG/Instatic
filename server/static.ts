import { extname, resolve, sep } from 'node:path'
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib'

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.map': 'application/json; charset=utf-8',
  '.mp4': 'video/mp4',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

// Mime types worth compressing. Already-compressed binary formats (woff2, png,
// jpg, mp4, webp, webm) gain nothing and would burn CPU.
const COMPRESSIBLE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.svg', '.map'])

// Below this size compression overhead (extra response bytes for headers,
// CPU cost) outweighs the savings.
const COMPRESS_MIN_BYTES = 1024

interface CachedCompression {
  brotli: Uint8Array | null
  gzip: Uint8Array | null
  // mtime fingerprint so we automatically invalidate when the file changes
  // (e.g. between deploys without a server restart).
  mtimeMs: number
}

// Cache compressed bytes per absolute file path. Static assets in /assets/
// are immutable+hashed so this is effectively populated once per deploy.
const compressionCache = new Map<string, CachedCompression>()

function contentType(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

function resolveStaticPath(root: string, pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }

  const rootPath = resolve(root)
  const filePath = resolve(rootPath, `.${decoded}`)
  if (filePath !== rootPath && !filePath.startsWith(`${rootPath}${sep}`)) return null
  return filePath
}

function isCompressible(filePath: string, byteLength: number): boolean {
  if (byteLength < COMPRESS_MIN_BYTES) return false
  return COMPRESSIBLE_EXTENSIONS.has(extname(filePath).toLowerCase())
}

/**
 * Pick the best encoding the client will accept. Order of preference:
 *   br > gzip > identity
 * We do not parse q-values — clients in the wild include `br, gzip` either
 * way, and a wrong q-value parse would give us a bigger response, never a
 * broken one.
 */
function selectEncoding(acceptEncoding: string | null): 'br' | 'gzip' | null {
  if (!acceptEncoding) return null
  const normalized = acceptEncoding.toLowerCase()
  if (normalized.includes('br')) return 'br'
  if (normalized.includes('gzip')) return 'gzip'
  return null
}

async function compressForEncoding(
  filePath: string,
  bytes: Uint8Array,
  encoding: 'br' | 'gzip',
  mtimeMs: number,
): Promise<Uint8Array> {
  let entry = compressionCache.get(filePath)
  if (!entry || entry.mtimeMs !== mtimeMs) {
    entry = { brotli: null, gzip: null, mtimeMs }
    compressionCache.set(filePath, entry)
  }

  if (encoding === 'br') {
    if (!entry.brotli) {
      // Brotli quality 5 — sweet spot for first-request latency on text payloads
      // (~99% of max ratio for ~10% of the CPU vs. quality 11). We cache the
      // result in-process anyway, so repeat hits pay zero cost.
      entry.brotli = brotliCompressSync(bytes, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
      })
    }
    return entry.brotli
  }

  if (!entry.gzip) {
    entry.gzip = Bun.gzipSync(bytes)
  }
  return entry.gzip
}

export async function serveStaticFile(
  staticDir: string,
  pathname: string,
  req?: Request,
): Promise<Response | null> {
  const filePath = resolveStaticPath(staticDir, pathname)
  if (!filePath) return null

  const file = Bun.file(filePath)
  if (!(await file.exists())) return null

  const cacheControl = pathname.startsWith('/assets/')
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  const mime = contentType(filePath)

  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const acceptEncoding = req?.headers.get('accept-encoding') ?? null
  const encoding = isCompressible(filePath, bytes.byteLength)
    ? selectEncoding(acceptEncoding)
    : null

  if (encoding) {
    const compressed = await compressForEncoding(filePath, bytes, encoding, file.lastModified)
    // Body bytes are owned by us — no risk of consumer mutation.
    return new Response(compressed, {
      headers: {
        'content-type': mime,
        'cache-control': cacheControl,
        'content-encoding': encoding,
        // Tells caches the response varies based on the request encoding,
        // so a gzip-only client doesn't get served a cached brotli payload.
        'vary': 'accept-encoding',
      },
    })
  }

  return new Response(bytes, {
    headers: {
      'content-type': mime,
      'cache-control': cacheControl,
    },
  })
}

export function serveAdminApp(staticDir: string, req?: Request): Promise<Response | null> {
  return serveStaticFile(staticDir, '/index.html', req)
}
