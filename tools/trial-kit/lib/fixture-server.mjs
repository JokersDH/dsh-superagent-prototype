/**
 * In-process fixture server for bounded operational scenarios. It is a fixture, not the product:
 *   - binds 127.0.0.1 on an ephemeral port only;
 *   - serves one schema-valid `trial-readiness/1` document (or one deliberate defect), plus a small
 *     SSE stream used to observe reconnects and duplicate/gap handling;
 *   - never touches a product state, queue, provider or native session;
 *   - exposes byte/connection counters so the runner can assert its own cleanup.
 */
import { createServer } from 'node:http'

export const FIXTURE_AUTHORIZATION = 'fixture-token-not-a-product-credential'

export function readinessPayload({ mode = 'fixture', startupMode = 'normal', revision = 'a'.repeat(64), observedAt = new Date().toISOString(), extra = false } = {}) {
  const readonly = startupMode === 'recovery_readonly'
  const payload = {
    protocol: 'trial-readiness/1',
    observedAt,
    configurationRevision: revision,
    mode,
    startupMode,
    discussion: 'not_configured',
    execution: readonly ? { state: 'unavailable', reason: 'recovery_readonly' } : { state: 'unavailable', reason: 'not_installed' },
    development: readonly ? 'readonly' : mode === 'fixture' ? 'fixture_only' : 'blocked',
    projects: { development: 0, discussion: 0, dispatchable: 0 },
    profiles: { native: 0, controlled: readonly ? 0 : 1, admittedNative: 0, admittedControlled: 0 },
    capabilities: { contextHistory: false, contextSources: false, decisions: false, proposals: false },
    authorization: 'none',
  }
  if (extra) payload.unexpectedField = 'must be refused by the strict schema'
  return payload
}

const SSE_SAMPLES = [
  { sequence: 1, kind: 'fixture-heartbeat', observedAt: '2026-01-01T00:00:01.000Z' },
  { sequence: 2, kind: 'fixture-heartbeat', observedAt: '2026-01-01T00:00:02.000Z' },
  { sequence: 3, kind: 'fixture-heartbeat', observedAt: '2026-01-01T00:00:03.000Z' },
]

export async function startFixtureServer(options = {}) {
  const config = {
    readiness: options.readiness ?? 'ready', // ready | recovery | unknown | invalid_schema | unknown_field | unauthorized | server_error | bad_json | oversized | redirect | slow
    sse: options.sse ?? 'normal', // normal | duplicate | truncate | slow | server_error
    requireToken: options.requireToken ?? true,
    delayMs: options.delayMs ?? 0,
    eventIntervalMs: options.eventIntervalMs ?? 100,
    maxEvents: options.maxEvents ?? 0,
    readinessRevision: options.readinessRevision ?? 'a'.repeat(64),
    readinessObservedAt: options.readinessObservedAt ?? null,
    readinessMaxAgeSeconds: options.readinessMaxAgeSeconds ?? null,
  }
  const stats = {
    connections: 0, activeConnections: 0, maxConcurrentConnections: 0,
    readinessRequests: 0, readinessBytes: 0, readinessStatuses: {},
    sseConnections: 0, sseEvents: 0, sseBytes: 0, sseClosed: 0,
  }
  const sockets = new Set()
  const server = createServer((req, res) => {
    stats.connections += 1
    stats.activeConnections += 1
    stats.maxConcurrentConnections = Math.max(stats.maxConcurrentConnections, stats.activeConnections)
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const finish = () => { stats.activeConnections -= 1 }
    res.on('close', finish)

    const authorized = !config.requireToken || req.headers.authorization === `Bearer ${FIXTURE_AUTHORIZATION}`
    const send = (status, body, contentType = 'application/json') => {
      const bytes = Buffer.byteLength(body)
      res.writeHead(status, { 'content-type': contentType, 'content-length': String(bytes) })
      res.end(body)
      return bytes
    }

    if (url.pathname === '/v1/readiness') {
      if (url.search.length > 0) { res.writeHead(400).end('{"error":"query"}'); return }
      stats.readinessRequests += 1
      if (config.delayMs > 0) setTimeout(() => respondReadiness(), config.delayMs)
      else respondReadiness()
      return
    }
    if (url.pathname === '/v1/events') { respondSse(); return }
    if (url.pathname === '/healthz') { send(200, '{"status":"fixture"}'); return }
    res.writeHead(404).end('{"error":"not_found"}')

    function respondReadiness() {
      if (config.readiness === 'unauthorized' || !authorized) {
        stats.readinessStatuses[401] = (stats.readinessStatuses[401] ?? 0) + 1
        stats.readinessBytes += send(401, '{"error":{"code":"auth_required"}}')
        return
      }
      if (config.readiness === 'server_error') {
        stats.readinessStatuses[500] = (stats.readinessStatuses[500] ?? 0) + 1
        stats.readinessBytes += send(500, '{"error":{"code":"storage_unavailable"}}')
        return
      }
      if (config.readiness === 'redirect') {
        stats.readinessStatuses[302] = (stats.readinessStatuses[302] ?? 0) + 1
        res.writeHead(302, { location: 'http://127.0.0.1:1/v1/readiness' }).end()
        return
      }
      if (config.readiness === 'bad_json') {
        stats.readinessStatuses[200] = (stats.readinessStatuses[200] ?? 0) + 1
        stats.readinessBytes += send(200, '{not-json')
        return
      }
      const observedAt = config.readinessObservedAt ?? new Date().toISOString()
      if (config.readiness === 'oversized') {
        const payload = readinessPayload({ revision: config.readinessRevision, observedAt })
        payload.padding = 'x'.repeat(300_000)
        stats.readinessStatuses[200] = (stats.readinessStatuses[200] ?? 0) + 1
        stats.readinessBytes += send(200, JSON.stringify(payload))
        return
      }
      const recovery = config.readiness === 'recovery'
      const payload = recovery
        ? readinessPayload({ startupMode: 'recovery_readonly', revision: config.readinessRevision, observedAt })
        : readinessPayload({ revision: config.readinessRevision, observedAt, extra: config.readiness === 'unknown_field' })
      if (config.readiness === 'invalid_schema') delete payload.authorization
      if (config.readiness === 'unknown') {
        payload.execution = { state: 'unknown' }
        payload.development = 'unknown'
        payload.discussion = 'unknown'
      }
      stats.readinessStatuses[200] = (stats.readinessStatuses[200] ?? 0) + 1
      stats.readinessBytes += send(200, JSON.stringify(payload))
    }

    function respondSse() {
      if (!authorized || config.sse === 'server_error') {
        stats.readinessStatuses[500] = (stats.readinessStatuses[500] ?? 0) + 1
        send(500, '{"error":{"code":"stream_unavailable"}}')
        return
      }
      stats.sseConnections += 1
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
      let index = 0
      let closed = false
      const emit = () => {
        if (closed) return
        if (config.maxEvents > 0 && index >= config.maxEvents) { closeStream(); return }
        const sample = config.sse === 'duplicate' && index > 0 ? SSE_SAMPLES[0] : SSE_SAMPLES[index % SSE_SAMPLES.length]
        const id = config.sse === 'duplicate' ? 1 : index + 1
        const frame = `id: ${id}\nevent: heartbeat\ndata: ${JSON.stringify({ ...sample, sequence: id })}\n\n`
        stats.sseEvents += 1
        stats.sseBytes += Buffer.byteLength(frame)
        res.write(frame)
        index += 1
        if (config.sse === 'truncate' && index >= 3) { closeStream(); return }
        timer = setTimeout(emit, config.eventIntervalMs)
      }
      let timer = null
      const closeStream = () => {
        if (closed) return
        closed = true
        if (timer !== null) clearTimeout(timer)
        stats.sseClosed += 1
        res.destroy()
      }
      res.on('close', () => { closed = true; if (timer !== null) clearTimeout(timer) })
      if (config.sse === 'slow') timer = setTimeout(emit, Math.max(config.delayMs, 2000))
      else emit()
    }
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  const address = server.address()
  const url = `http://127.0.0.1:${address.port}`

  return {
    url,
    port: address.port,
    config,
    stats,
    async close() {
      const closed = [...sockets].map((socket) => new Promise((resolvePromise) => {
        socket.once('close', resolvePromise)
        socket.destroy()
      }))
      await Promise.race([Promise.all(closed), new Promise((resolvePromise) => setTimeout(resolvePromise, 500))])
      await new Promise((resolvePromise) => server.close(() => resolvePromise()))
      await new Promise((resolvePromise) => setImmediate(resolvePromise))
    },
    activeSockets() { return sockets.size },
  }
}
