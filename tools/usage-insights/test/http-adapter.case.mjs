/**
 * Collection-adapter contract tests against a local stub.
 *
 * These prove the *adapter* boundary: loopback-only origins, explicit credential files, redirect
 * refusal, per-request timeouts, byte caps, bounded pagination and sanitized diagnostics. They are
 * adapter tests, not product observations — the real product read path is exercised by
 * `tools/usage-insights/probe/observe-two-projects.mjs`.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const CLI = fileURLToPath(new URL('../cli.mjs', import.meta.url))
const TOKEN = 'f0'.repeat(32)
const WINDOW = ['--from', '2026-11-08T00:00:00Z', '--to', '2026-11-09T00:00:00Z']

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

const evidence = workId => ({
  protocol: 'work-evidence/1',
  workId,
  projection: 'recorded',
  entries: [{ at: '2026-11-08T09:00:00.000Z', kind: 'question.opened', sourceRef: 'question-1', detail: {} }],
  outcomes: [],
  truncated: false,
})

const history = (workId, overrides = {}) => ({
  protocol: 'work-evidence-history/1',
  workId,
  contract: { workId, revision: 1, digest: 'c'.repeat(64) },
  observedAt: '2026-11-08T10:00:00.000Z',
  entries: [],
  hasMore: false,
  window: 'complete',
  sourcesCapped: [],
  ...overrides,
})

const snapshot = { works: [{ work: { id: 'work-a', projectId: 'project-atlas' }, contract: { workId: 'work-a', revision: 1, digest: 'c'.repeat(64) }, phase: 'needs_user' }] }

async function stub(t, handler) {
  const seen = []
  const server = createServer(async (request, response) => {
    seen.push({ url: request.url, authorization: request.headers.authorization })
    try {
      await handler(request, response, seen)
    } catch {
      response.writeHead(500)
      response.end('{}')
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  const close = () => new Promise(resolve => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })
  t.after(close)
  return { base: `http://127.0.0.1:${port}`, seen, close }
}

function withToken(directory, value = TOKEN) {
  const path = join(directory, 'token')
  writeFileSync(path, `${value}\n`, { mode: 0o600 })
  return path
}

const json = (response, value, status = 200, headers = {}) => {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), ...headers })
  response.end(body)
}

test('a non-loopback origin, embedded credentials or a path is refused before any request', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  for (const base of ['http://example.com:1234', 'https://127.0.0.1:1234', 'http://user:pass@127.0.0.1:1234', 'http://127.0.0.1:1234/api']) {
    const result = await run(['collect', '--base-url', base, '--token-file', token, ...WINDOW, '--out', join(directory, `out-${Math.random()}.json`)])
    assert.equal(result.status, 2, `expected refusal for ${base}`)
    assert.ok(result.stderr.includes('invalid_argument'))
  }
})

test('the credential file must be an explicit, regular, absolute file with one token', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const server = await stub(t, (_request, response) => json(response, snapshot))
  const good = withToken(directory)
  assert.equal((await run(['collect', '--base-url', server.base, '--token-file', 'token', ...WINDOW, '--out', join(directory, 'a.json')])).status, 2)
  const spaced = join(directory, 'spaced')
  writeFileSync(spaced, 'two tokens here that are long enough')
  assert.equal((await run(['collect', '--base-url', server.base, '--token-file', spaced, ...WINDOW, '--out', join(directory, 'b.json')])).status, 2)
  const missing = join(directory, 'missing')
  assert.equal((await run(['collect', '--base-url', server.base, '--token-file', missing, ...WINDOW, '--out', join(directory, 'c.json')])).status, 2)
  void good
  await server.close()
})

test('authentication failure, a redirect and a server error are fatal and leave no output', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)

  const unauthorised = await stub(t, (_request, response) => json(response, { error: { code: 'auth_required' } }, 401))
  const first = await run(['collect', '--base-url', unauthorised.base, '--token-file', token, ...WINDOW, '--out', join(directory, 'a.json')])
  assert.equal(first.status, 5)
  assert.ok(first.stderr.includes('auth_required'))
  assert.equal(existsSync(join(directory, 'a.json')), false)
  await unauthorised.close()

  const redirect = await stub(t, (_request, response) => {
    response.writeHead(302, { location: 'http://evil.example/steal' })
    response.end()
  })
  const second = await run(['collect', '--base-url', redirect.base, '--token-file', token, ...WINDOW, '--out', join(directory, 'b.json')])
  assert.equal(second.status, 5)
  assert.ok(second.stderr.includes('redirect_refused'))
  assert.equal(existsSync(join(directory, 'b.json')), false)
  await redirect.close()

  const failing = await stub(t, (_request, response) => json(response, { error: { code: 'storage_unavailable' } }, 503))
  const third = await run(['collect', '--base-url', failing.base, '--token-file', token, ...WINDOW, '--out', join(directory, 'c.json')])
  assert.equal(third.status, 5)
  assert.ok(third.stderr.includes('server_error'))
  await failing.close()
})

test('a slow response is bounded by the request timeout', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const slow = await stub(t, async (_request, response) => {
    await new Promise(resolve => setTimeout(resolve, 400))
    json(response, snapshot)
  })
  const result = await run(['collect', '--base-url', slow.base, '--token-file', token, '--request-timeout-ms', '100', ...WINDOW, '--out', join(directory, 'a.json')])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('timeout'))
  assert.equal(existsSync(join(directory, 'a.json')), false)
  await slow.close()
})

test('a response that exceeds the byte budget is refused', async (t) => {
  const directory = mkdtempSync(join(directoryTemp(), 'usage-adapter-'))
  const token = withToken(directory)
  const big = await stub(t, (_request, response) => {
    const body = JSON.stringify({ ...snapshot, padding: 'x'.repeat(4000) })
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) })
    response.end(body)
  })
  const result = await run(['collect', '--base-url', big.base, '--token-file', token, '--max-bytes', '500', ...WINDOW, '--out', join(directory, 'a.json')])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('limits'))
  await big.close()
})

test('the bearer token is sent but never persisted in the bundle or the report', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/v1/snapshot') return json(response, snapshot)
    if (url.pathname === '/v1/works/work-a/evidence') return json(response, evidence('work-a'))
    if (url.pathname === '/v1/works/work-a/evidence/history') return json(response, history('work-a'))
    if (url.pathname === '/v1/attention') {
      return json(response, {
        protocol: 'attention-inbox/1', observedAt: '2026-11-08T12:00:00.000Z', items: [], ranks: [],
        ranking: 'waiting_order', scannedWorks: 0, questionCoverage: 'complete', hasMore: false,
      })
    }
    json(response, { error: { code: 'not_found' } }, 404)
  })
  const bundlePath = join(directory, 'bundle.json')
  const reportPath = join(directory, 'report.md')
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--project', 'project-atlas',
    '--include-attention', ...WINDOW, '--captured-at', '2026-11-08T12:00:00Z', '--out', bundlePath, '--report', reportPath])
  assert.equal(result.status, 0, result.stderr)
  const bundle = readFileSync(bundlePath, 'utf8')
  const report = readFileSync(reportPath, 'utf8')
  assert.equal(bundle.includes(TOKEN), false)
  assert.equal(report.includes(TOKEN), false)
  assert.equal(bundle.includes(directory), false)
  assert.ok(server.seen.every(call => call.authorization === `Bearer ${TOKEN}`), 'every request carries the operator credential')
  assert.ok(server.seen.every(call => !call.url.includes('token')), 'the credential never enters a query string')
  await server.close()
})

test('a wrong protocol is quarantined per work while the rest is collected', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/v1/snapshot') return json(response, snapshot)
    if (url.pathname === '/v1/works/work-a/evidence') return json(response, { ...evidence('work-a'), workId: 'work-other' })
    if (url.pathname === '/v1/works/work-a/evidence/history') return json(response, history('work-a'))
    json(response, {}, 404)
  })
  const bundlePath = join(directory, 'bundle.json')
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--work', 'work-a', '--project', 'project-atlas', ...WINDOW, '--out', bundlePath])
  assert.equal(result.status, 3)
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  assert.ok(bundle.collectionIssues.some(issue => issue.code === 'bad_schema'))
  assert.equal(bundle.declaredCoverage.workEvidence, 'source_missing')
  await server.close()
})

test('an unstable history cursor stops pagination instead of looping forever', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/v1/snapshot') return json(response, snapshot)
    if (url.pathname === '/v1/works/work-a/evidence') return json(response, evidence('work-a'))
    if (url.pathname === '/v1/works/work-a/evidence/history') {
      return json(response, history('work-a', { hasMore: true, nextCursor: 'c2VyY29kZQ' }))
    }
    json(response, {}, 404)
  })
  const bundlePath = join(directory, 'bundle.json')
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--work', 'work-a', '--project', 'project-atlas', '--history-pages', '3', ...WINDOW, '--out', bundlePath])
  assert.equal(result.status, 3)
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  assert.ok(bundle.collectionIssues.some(issue => issue.code === 'unstable_cursor'))
  const historyCalls = server.seen.filter(call => call.url.includes('/evidence/history')).length
  assert.ok(historyCalls <= 2, `pagination stopped after ${historyCalls} calls`)
  await server.close()
})

test('an unavailable attention reader is reported as missing, not as an empty inbox', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/v1/snapshot') return json(response, snapshot)
    if (url.pathname === '/v1/works/work-a/evidence') return json(response, evidence('work-a'))
    if (url.pathname === '/v1/works/work-a/evidence/history') return json(response, history('work-a'))
    json(response, { error: { code: 'unsupported_capability' } }, 501)
  })
  const bundlePath = join(directory, 'bundle.json')
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--work', 'work-a', '--project', 'project-atlas', '--include-attention', ...WINDOW, '--out', bundlePath])
  assert.equal(result.status, 3)
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  assert.equal(bundle.declaredCoverage.attention, 'source_missing')
  assert.deepEqual(bundle.attentionPages, [])
  await server.close()
})

test('a work bound stops collection and says which bound stopped it', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const multi = { works: [
    { work: { id: 'work-a', projectId: 'project-atlas' }, contract: { workId: 'work-a', revision: 1, digest: 'c'.repeat(64) }, phase: 'needs_user' },
    { work: { id: 'work-b', projectId: 'project-atlas' }, contract: { workId: 'work-b', revision: 1, digest: 'c'.repeat(64) }, phase: 'needs_user' },
  ] }
  const server = await stub(t, (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    if (url.pathname === '/v1/snapshot') return json(response, multi)
    const match = url.pathname.match(/^\/v1\/works\/([^/]+)\/evidence$/)
    if (match) return json(response, evidence(match[1]))
    if (url.pathname.endsWith('/evidence/history')) return json(response, history(url.pathname.split('/')[3]))
    json(response, {}, 404)
  })
  const bundlePath = join(directory, 'bundle.json')
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--max-works', '1', ...WINDOW, '--out', bundlePath])
  assert.equal(result.status, 3)
  const bundle = JSON.parse(readFileSync(bundlePath, 'utf8'))
  assert.equal(bundle.workEvidence.length, 1)
  assert.ok(bundle.collectionIssues.some(issue => /max-works/.test(issue.message)))
  await server.close()
})

function directoryTemp() {
  return tmpdir()
}

// ---- streaming budget (G4) -------------------------------------------------------------------

test('positive: a small chunked response without Content-Length is accepted', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1')
    const body = JSON.stringify(url.pathname === '/v1/snapshot' ? snapshot : {})
    // No content-length: the response is chunked.
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(body)
  })
  const bundlePath = join(directory, 'bundle.json')
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--project', 'project-atlas',
    '--work', 'work-a', '--max-bytes', '4096', ...WINDOW, '--out', bundlePath])
  assert.ok([0, 3].includes(result.status), `unexpected status ${result.status}: ${result.stderr}`)
  assert.equal(result.stderr.includes('limits'), false)
})

test('negative: an unknown-length 131072-byte body stops mid-stream under a 1024-byte budget', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, async (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    const chunk = Buffer.alloc(16 * 1024, 0x20)
    let written = 0
    while (written < 131_072) {
      if (!response.write(chunk)) await new Promise(resolve => response.once('drain', resolve))
      written += chunk.byteLength
    }
    response.end()
  })
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--project', 'project-atlas',
    '--max-bytes', '1024', ...WINDOW, '--out', join(directory, 'bundle.json')])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('limits'), result.stderr)
  const match = /bytesReceived=(\d+)/.exec(result.stderr)
  assert.ok(match, `the failure must report how far the body got: ${result.stderr}`)
  const received = Number(match[1])
  assert.ok(received > 1024, 'it stopped only after the budget was crossed')
  assert.ok(received < 131_072, 'the whole body was never accumulated')
  assert.equal(existsSync(join(directory, 'bundle.json')), false)
})

test('negative: a declared oversized Content-Length is refused before reading the body', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '131072' })
    response.write('{"works":')
  })
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--project', 'project-atlas',
    '--max-bytes', '1024', ...WINDOW, '--out', join(directory, 'bundle.json')])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('declaredLength=131072'), result.stderr)
})

test('negative: a body framed shorter than the JSON it claims is refused, not partially accepted', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, (_request, response) => {
    // The frame ends before the JSON does; the client must reject rather than accept a fragment.
    response.writeHead(200, { 'content-type': 'application/json', 'content-length': '10' })
    response.end('{"works":[')
  })
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--project', 'project-atlas',
    '--max-bytes', '1024', ...WINDOW, '--out', join(directory, 'bundle.json')])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('bad_schema'), result.stderr)
  assert.ok(/bytesReceived=\d+/.test(result.stderr), result.stderr)
  assert.equal(existsSync(join(directory, 'bundle.json')), false)
})

test('negative: a trickling stream is bounded by the request timeout and reports progress', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, async (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{"works":')
    await new Promise(resolve => setTimeout(resolve, 2000))
    response.end('[]}')
  })
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--request-timeout-ms', '120',
    '--project', 'project-atlas', ...WINDOW, '--out', join(directory, 'bundle.json')])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('timeout'), result.stderr)
  assert.ok(/bytesReceived=\d+/.test(result.stderr), result.stderr)
})

test('negative: a large error body is discarded within a fixed cap', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-adapter-'))
  const token = withToken(directory)
  const server = await stub(t, (_request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' })
    const chunk = Buffer.alloc(16 * 1024, 0x20)
    for (let index = 0; index < 8; index++) response.write(chunk)
    response.end()
  })
  const result = await run(['collect', '--base-url', server.base, '--token-file', token, '--project', 'project-atlas',
    '--max-bytes', '1024', ...WINDOW, '--out', join(directory, 'bundle.json')])
  assert.equal(result.status, 5)
  assert.ok(result.stderr.includes('server_error'), result.stderr)
  assert.ok(/errorBodyLimit=16384/.test(result.stderr), result.stderr)
})
