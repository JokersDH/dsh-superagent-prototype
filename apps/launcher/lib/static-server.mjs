/**
 * Loopback static server for the built console plus a transparent reverse proxy for `/v1`. This is
 * a distribution shim, not a product HTTP entry: it implements no business route, never writes the
 * database and simply pipes /v1 requests to the coordinator's authenticated loopback API so the
 * browser keeps one origin. It should be deleted once main serves static assets same-origin.
 */
import { createReadStream, lstatSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { extname, join, resolve, sep } from 'node:path'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
}

const SECURITY_HEADERS = {
  'content-security-policy':
    "default-src 'self'; base-uri 'none'; object-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'])

const isLoopback = (hostname) => hostname === '127.0.0.1' || hostname === '[::1]'

/** Validate a numeric loopback origin (no credentials, path, query or hash). */
export function loopbackOrigin(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' || !isLoopback(url.hostname) || !url.port) return null
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null
  if (String(url) !== value && `${url.origin}` !== value) return null
  return url.origin
}

function serveStatic(root, pathname, res, headOnly) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS })
    res.end('Bad request\n')
    return
  }
  if (decoded.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS })
    res.end('Bad request\n')
    return
  }
  const relativePath = decoded === '/' ? '/index.html' : decoded
  let file = resolve(root, `.${relativePath}`)
  const inside = file === root || file.startsWith(`${root}${sep}`)
  if (!inside) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS })
    res.end('Bad request\n')
    return
  }
  try {
    if (!lstatSync(file).isFile()) throw new Error('not a file')
  } catch {
    // Single-page app: unknown extensionless paths fall back to index.html; asset misses stay 404.
    if (!extname(relativePath)) {
      file = join(root, 'index.html')
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS })
      res.end('Not found\n')
      return
    }
  }
  try {
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('unsafe file')
    const headers = {
      ...SECURITY_HEADERS,
      'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(stat.size),
      'cache-control': 'no-store',
    }
    res.writeHead(200, headers)
    if (headOnly) {
      res.end()
      return
    }
    createReadStream(file).on('error', () => res.destroy()).pipe(res)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS })
    res.end('Not found\n')
  }
}

export function createDistributionServer({ staticRoot, apiOrigin, buildId }) {
  const upstreamOrigin = loopbackOrigin(apiOrigin)
  if (upstreamOrigin === null) throw new Error('apiOrigin must be a numeric loopback origin')
  const upstream = new URL(upstreamOrigin)
  const root = resolve(staticRoot)
  const server = createServer((req, res) => {
    let pathname
    try {
      pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    } catch {
      res.writeHead(400, { ...SECURITY_HEADERS })
      res.end()
      return
    }
    if (pathname === '/__pa/instance' && (req.method === 'GET' || req.method === 'HEAD')) {
      const body = JSON.stringify({ product: 'dsh-superagent', buildId })
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'content-type': 'application/json; charset=utf-8',
        'content-length': String(Buffer.byteLength(body)),
        'cache-control': 'no-store',
      })
      res.end(req.method === 'HEAD' ? undefined : body)
      return
    }
    if (pathname === '/v1' || pathname.startsWith('/v1/')) {
      const headers = { ...req.headers }
      for (const name of HOP_BY_HOP) delete headers[name]
      headers.host = upstream.host
      const upstreamRequest = httpRequest(
        {
          protocol: 'http:',
          hostname: upstream.hostname,
          port: upstream.port,
          method: req.method,
          path: req.url,
          headers,
        },
        (upstreamResponse) => {
          const responseHeaders = { ...upstreamResponse.headers }
          for (const name of HOP_BY_HOP) delete responseHeaders[name]
          res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
          upstreamResponse.pipe(res)
        },
      )
      upstreamRequest.on('error', () => {
        if (!res.headersSent) {
          const body = JSON.stringify({ error: { code: 'storage_unavailable', message: 'Local product API is unreachable', retry: 'safe' } })
          res.writeHead(502, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(Buffer.byteLength(body)), ...SECURITY_HEADERS })
          res.end(body)
        } else res.destroy()
      })
      req.on('aborted', () => upstreamRequest.destroy())
      req.pipe(upstreamRequest)
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS, allow: 'GET, HEAD' })
      res.end('Method not allowed\n')
      return
    }
    serveStatic(root, pathname, res, req.method === 'HEAD')
  })
  // SSE responses are long-lived; do not impose an application request timeout on proxied streams.
  server.requestTimeout = 0
  server.headersTimeout = 20_000
  server.keepAliveTimeout = 5_000
  return server
}

export function listenDistributionServer(server, port) {
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolvePromise(server)
    })
  })
}
