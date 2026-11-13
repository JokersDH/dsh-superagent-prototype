/** The static console server serves only built files and proxies /v1 without implementing product routes. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createDistributionServer, listenDistributionServer, loopbackOrigin } from '../lib/static-server.mjs'

const html = '<!doctype html><html><body><div id="root"></div><script type="module" src="/assets/app.js"></script></body></html>'

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pa-static-'))
  mkdirSync(join(root, 'assets'), { recursive: true })
  writeFileSync(join(root, 'index.html'), html)
  writeFileSync(join(root, 'assets/app.js'), 'console.log("ok")')
  const upstream = createServer((request, response) => {
    if (request.url === '/v1/health') {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ status: 'ok', method: request.method, host: request.headers.host }))
      return
    }
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const apiOrigin = `http://127.0.0.1:${upstream.address().port}`
  const server = createDistributionServer({ staticRoot: root, apiOrigin, buildId: 'test-build' })
  await listenDistributionServer(server, 0)
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    apiOrigin,
    async close() {
      await new Promise((resolve) => server.close(resolve))
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      await new Promise((resolve) => upstream.close(resolve))
      rmSync(root, { recursive: true, force: true })
    },
  }
}

const get = async (url, init) => {
  const response = await fetch(url, { redirect: 'error', headers: { connection: 'close' }, ...init })
  return { status: response.status, headers: response.headers, body: await response.text() }
}

test('static console assets are served with a strict CSP and no-store caching', async (t) => {
  const spot = await fixture()
  t.after(() => spot.close())
  const page = await get(`${spot.origin}/`)
  assert.equal(page.status, 200)
  assert.match(page.body, /<div id="root">/)
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'self'/)
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(page.headers.get('cache-control'), 'no-store')
  const asset = await get(`${spot.origin}/assets/app.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type') ?? '', /text\/javascript/)
  const marker = await get(`${spot.origin}/__pa/instance`)
  assert.deepEqual(JSON.parse(marker.body), { product: 'dsh-superagent', buildId: 'test-build' })
})

test('/v1 is piped to the loopback API with the original request path', async (t) => {
  const spot = await fixture()
  t.after(() => spot.close())
  const health = await get(`${spot.origin}/v1/health`)
  assert.equal(health.status, 200)
  const body = JSON.parse(health.body)
  assert.equal(body.status, 'ok')
  assert.equal(body.method, 'GET')
  assert.match(body.host, /^127\.0\.0\.1:\d+$/)
  const missing = await get(`${spot.origin}/v1/unknown`)
  assert.equal(missing.status, 404)
})

test('unsafe paths, unknown assets and non-GET static requests are refused', async (t) => {
  const spot = await fixture()
  t.after(() => spot.close())
  // WHATWG URL normalization may fold encoded dot segments; either way nothing outside the build
  // root is served and the response never contains a host file.
  // Encoded dot segments may be normalized into an in-root SPA path; the escaped case below is the
  // one that must be rejected. Neither may ever return a host file.
  const traversal = await get(`${spot.origin}/%2e%2e/%2e%2e/etc/passwd`)
  assert.ok([200, 400, 404].includes(traversal.status))
  assert.doesNotMatch(traversal.body, /root:/)
  const absolute = await get(`${spot.origin}/..%2F..%2Fetc%2Fpasswd`)
  assert.equal(absolute.status, 400)
  const backslash = await get(`${spot.origin}/assets%5C..%5C..%5Cetc%5Cpasswd`)
  assert.ok([400, 404].includes(backslash.status))
  const missingAsset = await get(`${spot.origin}/assets/nope.js`)
  assert.equal(missingAsset.status, 404)
  // Extensionless paths fall back to the single-page app entry.
  const spa = await get(`${spot.origin}/work/123`)
  assert.equal(spa.status, 200)
  const post = await get(`${spot.origin}/assets/app.js`, { method: 'POST', headers: { connection: 'close', 'content-type': 'text/plain' } })
  assert.equal(post.status, 405)
})

test('an unreachable API yields a bounded JSON 502 instead of a hang', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-static-'))
  writeFileSync(join(root, 'index.html'), html)
  const server = createDistributionServer({ staticRoot: root, apiOrigin: 'http://127.0.0.1:1', buildId: 'b' })
  await listenDistributionServer(server, 0)
  t.after(async () => {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    rmSync(root, { recursive: true, force: true })
  })
  const response = await get(`http://127.0.0.1:${server.address().port}/v1/health`)
  assert.equal(response.status, 502)
  assert.equal(JSON.parse(response.body).error.code, 'storage_unavailable')
})

test('loopbackOrigin only accepts numeric loopback origins', () => {
  assert.equal(loopbackOrigin('http://127.0.0.1:8790'), 'http://127.0.0.1:8790')
  assert.equal(loopbackOrigin('http://localhost:8790'), null)
  assert.equal(loopbackOrigin('https://127.0.0.1:8790'), null)
  assert.equal(loopbackOrigin('http://127.0.0.1:8790/path'), null)
  assert.equal(loopbackOrigin('http://user:pass@127.0.0.1:8790'), null)
  assert.equal(loopbackOrigin('http://0.0.0.0:8790'), null)
})
