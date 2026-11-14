/**
 * Bounded operational scenario runner.
 *
 * What it actually exercises: one in-process loopback fixture server, one bounded HTTP polling loop
 * against `/v1/readiness`, one SSE subscription loop with reconnect/backoff, optional controlled
 * "client reopen" (a new connection, explicitly NOT daemon recovery), and periodic resource samples.
 *
 * What it never does: start/stop/upgrade a daemon, touch a personal state root, write a queue, call a
 * model, fall back to a real CLI, or retry without a bound. Every request, connection and sample has
 * a deadline and a count budget, and the whole scenario has a total duration and a hard deadline
 * with explicit margin.
 */
import { openSync, writeSync, closeSync, fsyncSync } from 'node:fs'
import { request } from 'node:http'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { join } from 'node:path'
import { FIXTURE_AUTHORIZATION, startFixtureServer } from './fixture-server.mjs'
import { LIMITS } from './limits.mjs'

const nowIso = () => new Date().toISOString()

const DEFECT_MODES = new Set(['slow', 'truncate', 'duplicate', 'server_error', 'unauthorized', 'bad_json', 'oversized', 'unknown_field'])
const DEFECT_EXPECTATIONS = {
  slow: 'deadline_or_latency',
  truncate: 'sse_disconnect',
  duplicate: 'duplicate_event',
  server_error: 'http_5xx',
  unauthorized: 'http_401',
  bad_json: 'invalid_json',
  oversized: 'body_size',
  unknown_field: 'schema_refusal',
}

function fixtureConfigFor(defect, config) {
  if (defect === 'truncate') return { sse: 'truncate' }
  if (defect === 'duplicate') return { sse: 'duplicate' }
  if (defect === 'server_error') return { sse: 'server_error', readiness: 'server_error' }
  if (defect === 'unauthorized') return { readiness: 'unauthorized' }
  if (defect === 'bad_json') return { readiness: 'bad_json' }
  if (defect === 'oversized') return { readiness: 'oversized' }
  if (defect === 'unknown_field') return { readiness: 'unknown_field' }
  if (defect === 'slow') return { delayMs: Math.max(config.pollTimeoutMs + 250, 1000) }
  return {}
}

function latencyPercentile(sorted, fraction) {
  if (sorted.length === 0) return null
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))
  return Math.round(sorted[index] * 100) / 100
}

function delay(ms, signal) {
  return new Promise((resolvePromise) => {
    if (ms <= 0) { resolvePromise(); return }
    const timer = setTimeout(resolvePromise, ms)
    signal?.addEventListener('abort', () => { clearTimeout(timer); resolvePromise() }, { once: true })
  })
}

class SseClient {
  constructor({ url, token, counters, idleTimeoutMs, onEvent, onDisconnect }) {
    this.url = url
    this.token = token
    this.counters = counters
    this.idleTimeoutMs = idleTimeoutMs
    this.onEvent = onEvent
    this.onDisconnect = onDisconnect
    this.req = null
    this.closed = false
    this.buffer = ''
  }

  /** Resolves when this connection ends, not when headers arrive: the caller awaits a lifetime. */
  open() {
    return new Promise((resolvePromise) => {
      let settled = false
      const settle = () => { if (!settled) { settled = true; resolvePromise() } }
      const target = new URL('/v1/events', this.url)
      this.req = request({
        hostname: target.hostname, port: target.port, path: target.pathname, method: 'GET',
        headers: { accept: 'text/event-stream', authorization: `Bearer ${this.token}` }, agent: false,
      }, (response) => {
        this.counters.sseConnections += 1
        if (response.statusCode !== 200) {
          this.counters.sseFailedConnections += 1
          this.counters.httpStatuses[response.statusCode] = (this.counters.httpStatuses[response.statusCode] ?? 0) + 1
          response.resume()
          response.on('end', () => { this.onDisconnect('http_status'); settle() })
          response.on('error', () => { this.onDisconnect('http_status'); settle() })
          return
        }
        let idle = setTimeout(() => this.close('idle_timeout'), this.idleTimeoutMs)
        response.on('data', (chunk) => {
          clearTimeout(idle)
          idle = setTimeout(() => this.close('idle_timeout'), this.idleTimeoutMs)
          const text = chunk.toString('utf8')
          this.counters.sseBytes += chunk.byteLength
          this.buffer += text
          let boundary = this.buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const frame = this.buffer.slice(0, boundary)
            this.buffer = this.buffer.slice(boundary + 2)
            const event = parseFrame(frame)
            if (event !== null) this.onEvent(event)
            boundary = this.buffer.indexOf('\n\n')
          }
        })
        response.on('end', () => { clearTimeout(idle); this.onDisconnect(this.closed ? this.closeReason : 'end'); settle() })
        response.on('error', () => { clearTimeout(idle); this.onDisconnect(this.closed ? this.closeReason : 'error'); settle() })
      })
      this.req.on('error', (error) => {
        this.counters.sseFailedConnections += 1
        this.onDisconnect(this.closed ? 'closed' : String(error?.code ?? 'request_error'))
        settle()
      })
      this.req.end()
    })
  }

  close(reason = 'closed') {
    if (this.closed) return
    this.closed = true
    this.closeReason = reason
    this.req?.destroy()
    this.onDisconnect(reason)
  }
}

function parseFrame(frame) {
  const lines = frame.split('\n')
  let id = null
  let data = null
  for (const line of lines) {
    if (line.startsWith('id: ')) id = line.slice(4)
    else if (line.startsWith('data: ')) data = (data === null ? '' : `${data}\n`) + line.slice(6)
  }
  if (id === null || data === null) return null
  let payload
  try { payload = JSON.parse(data) } catch { return { id, invalidJson: true, payload: null } }
  return { id, payload }
}

export async function runSoak(config) {
  const durationMs = config.durationSeconds * 1000
  const deadlineMs = durationMs + 30_000
  const startedAt = nowIso()
  const startHr = performance.now()
  const controller = new AbortController()
  let stoppedBy = null
  const failures = []
  const failureCounts = {}
  const recordFailure = (kind, detail = undefined) => {
    failureCounts[kind] = (failureCounts[kind] ?? 0) + 1
    if (failures.length < 200) failures.push({ at: nowIso(), kind, detail })
    if (Object.values(failureCounts).reduce((sum, value) => sum + value, 0) >= config.maxErrors && stoppedBy === null) {
      stoppedBy = 'max_errors'
      controller.abort()
    }
  }

  const fixture = await startFixtureServer({
    requireToken: true,
    eventIntervalMs: Math.max(50, config.sseIntervalMs),
    maxEvents: config.maxEvents,
    ...fixtureConfigFor(config.defect, config),
  })
  const server = { url: fixture.url, port: fixture.port, defect: config.defect, startedAt: nowIso() }

  const counters = {
    pollRequests: 0, pollOk: 0, pollFailed: 0, pollLatencyMs: [],
    httpStatuses: {},
    sseConnections: 0, sseEvents: 0, sseBytes: 0, sseFailedConnections: 0,
    duplicates: 0, gaps: 0, reconnects: 0, reopens: 0,
    samples: 0,
  }
  let lastEventId = null
  let lastEventAt = null
  let lastSampleElapsedMs = 0
  let currentConnectionIds = new Set()

  const histogram = monitorEventLoopDelay({ resolution: 20 })
  histogram.enable()

  const samplePath = join(config.out, 'samples.ndjson')
  let sampleFd = null
  const pendingSamples = []
  const flushSamples = () => {
    if (sampleFd === null || pendingSamples.length === 0) return
    writeSync(sampleFd, pendingSamples.join(''))
    pendingSamples.length = 0
  }
  const sample = () => {
    const memory = process.memoryUsage()
    const entry = {
      at: nowIso(), elapsedMs: Math.round(performance.now() - startHr),
      rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external,
      eventLoopP99Ms: Math.round(histogram.percentile(99) / 1e5) / 10,
      pollRequests: counters.pollRequests, sseEvents: counters.sseEvents, sseConnections: counters.sseConnections,
      reconnects: counters.reconnects, duplicates: counters.duplicates, gaps: counters.gaps,
      serverActiveConnections: fixture.stats.activeConnections, serverActiveSockets: fixture.activeSockets(),
    }
    if (counters.samples >= LIMITS.maxSoakSamples) { recordFailure('max_samples'); return }
    counters.samples += 1
    lastSampleElapsedMs = entry.elapsedMs
    pendingSamples.push(`${JSON.stringify(entry)}\n`)
    flushSamples()
  }

  const stopTimer = setTimeout(() => { stoppedBy = 'duration'; controller.abort() }, durationMs)
  const deadlineTimer = setTimeout(() => { stoppedBy = 'deadline'; controller.abort() }, deadlineMs)
  const sampleTimer = setInterval(sample, config.sampleMs)
  sampleFd = openSync(samplePath, 'wx', 0o600)
  sample()

  // One bounded readiness poll: the same strict read the machinecheck uses, but we only need the
  // status/latency/refusal class here.
  const pollOnce = async () => {
    if (counters.pollRequests >= config.maxRequests) { recordFailure('max_requests'); return }
    counters.pollRequests += 1
    const started = performance.now()
    const token = FIXTURE_AUTHORIZATION
    const outcome = await new Promise((resolvePromise) => {
      const target = new URL('/v1/readiness', fixture.url)
      const req = request({ hostname: target.hostname, port: target.port, path: target.pathname, method: 'GET', headers: { authorization: `Bearer ${token}`, accept: 'application/json' }, agent: false }, (response) => {
        const chunks = []
        let bytes = 0
        let oversized = false
        response.on('data', (chunk) => {
          bytes += chunk.byteLength
          if (bytes > LIMITS.maxResponseBytes) { oversized = true; req.destroy(); return }
          chunks.push(chunk)
        })
        response.on('end', () => {
          const latency = performance.now() - started
          counters.pollLatencyMs.push(latency)
          counters.httpStatuses[response.statusCode] = (counters.httpStatuses[response.statusCode] ?? 0) + 1
          if (oversized) resolvePromise({ kind: 'body_size' })
          else if (response.statusCode !== 200) resolvePromise({ kind: `http_${response.statusCode}` })
          else {
            let payload
            try { payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { resolvePromise({ kind: 'invalid_json' }); return }
            const parsed = config.schema === null ? { success: true } : config.schema.safeParse(payload)
            if (!parsed.success) resolvePromise({ kind: 'schema_invalid' })
            else { counters.pollOk += 1; resolvePromise({ kind: 'ok' }) }
          }
        })
        response.on('error', () => resolvePromise({ kind: 'response_error' }))
      })
      const timer = setTimeout(() => req.destroy(new Error('poll_timeout')), config.pollTimeoutMs)
      req.on('close', () => clearTimeout(timer))
      req.on('error', (error) => {
        clearTimeout(timer)
        counters.pollLatencyMs.push(performance.now() - started)
        resolvePromise({ kind: String(error?.message) === 'poll_timeout' ? 'poll_timeout' : String(error?.code ?? 'request_error') })
      })
      req.end()
    })
    if (outcome.kind !== 'ok') { counters.pollFailed += 1; recordFailure(`poll:${outcome.kind}`) }
  }

  const pollLoop = async () => {
    while (!controller.signal.aborted) {
      await pollOnce()
      await delay(config.pollMs, controller.signal)
    }
  }

  const connectSse = async () => {
    const client = new SseClient({
      url: fixture.url,
      token: FIXTURE_AUTHORIZATION,
      counters,
      idleTimeoutMs: config.sseIdleTimeoutMs,
      onEvent(event) {
        counters.sseEvents += 1
        lastEventAt = nowIso()
        if (event.invalidJson) { recordFailure('sse:invalid_json'); return }
        const numeric = Number(event.id)
        if (Number.isFinite(numeric)) {
          if (currentConnectionIds.has(numeric)) { counters.duplicates += 1; recordFailure('sse:duplicate_event', { id: numeric }) }
          else if (lastEventId !== null && numeric > lastEventId + 1) { counters.gaps += 1; recordFailure('sse:gap', { from: lastEventId, to: numeric }) }
          currentConnectionIds.add(numeric)
          lastEventId = numeric
        }
        if (counters.sseEvents >= config.maxSseEvents) { recordFailure('max_events'); controller.abort() }
      },
      onDisconnect(reason) {
        if (!['closed', 'reopen', 'stopped'].includes(reason)) recordFailure(`sse:disconnect:${reason}`)
      },
    })
    currentConnectionIds = new Set()
    lastEventId = null
    activeClient = client
    await client.open()
  }

  let activeClient = null
  controller.signal.addEventListener('abort', () => { activeClient?.close('stopped') }, { once: true })
  const sseLoop = async () => {
    let attempts = 0
    while (!controller.signal.aborted && attempts < config.maxReconnects) {
      await connectSse()
      attempts += 1
      if (controller.signal.aborted) break
      counters.reconnects += 1
      await delay(config.reconnectBackoffMs, controller.signal)
    }
    if (attempts >= config.maxReconnects && !controller.signal.aborted) recordFailure('max_reconnects')
  }

  const reopenLoop = async () => {
    if (config.reopenSeconds <= 0) return
    while (!controller.signal.aborted) {
      await delay(config.reopenSeconds * 1000, controller.signal)
      if (controller.signal.aborted) break
      counters.reopens += 1
      activeClient?.close('reopen')
      if (config.scenario !== 'sse') await pollOnce()
    }
  }

  const tasks = []
  if (config.scenario === 'http' || config.scenario === 'mixed') tasks.push(pollLoop())
  if (config.scenario === 'sse' || config.scenario === 'mixed') tasks.push(sseLoop())
  tasks.push(reopenLoop())
  const onSignal = () => { stoppedBy = 'signal'; controller.abort() }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)

  await Promise.allSettled(tasks)
  clearTimeout(stopTimer)
  clearTimeout(deadlineTimer)
  clearInterval(sampleTimer)
  sample()
  flushSamples()
  histogram.disable()
  process.removeListener('SIGINT', onSignal)
  process.removeListener('SIGTERM', onSignal)
  activeClient?.close('closed')

  const endedAt = nowIso()
  const elapsedMs = Math.round(performance.now() - startHr)
  const wallElapsedSeconds = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)
  if (sampleFd !== null) { try { fsyncSync(sampleFd) } catch { /* ignore */ } closeSync(sampleFd); sampleFd = null }

  const serverStatsBeforeClose = { ...fixture.stats }
  await fixture.close()
  const cleanup = { closed: true, activeSockets: fixture.activeSockets(), activeConnections: fixture.stats.activeConnections }

  // Cross-check that the timeline, counters and elapsed time describe the same run.
  const consistencyIssues = []
  if (Math.abs(elapsedMs - wallElapsedSeconds * 1000) > 3000) consistencyIssues.push('wall_clock_skew')
  if (stoppedBy !== 'signal' && counters.samples > 0 && lastSampleElapsedMs < elapsedMs - config.sampleMs * 3) consistencyIssues.push('samples_ended_early')
  if (stoppedBy !== 'signal' && (config.scenario === 'http' || config.scenario === 'mixed')) {
    const expectedPolls = Math.floor(durationMs / config.pollMs) * 0.8
    if (counters.pollRequests < expectedPolls && stoppedBy !== 'max_errors') consistencyIssues.push('poll_undercount')
  }
  for (const issue of consistencyIssues) recordFailure(`consistency:${issue}`)

  const sortedLatencies = [...counters.pollLatencyMs].sort((a, b) => a - b)
  const totalFailures = Object.values(failureCounts).reduce((sum, value) => sum + value, 0)
  const expectedDefect = config.defect !== 'none'
  const defectObserved = expectedDefect ? expectedDefectObserved(config.defect, failureCounts, counters) : null
  const durationRespected = elapsedMs >= durationMs - 1500 || stoppedBy === 'max_errors' || stoppedBy === 'signal' || stoppedBy === 'deadline'
  const status = stoppedBy === 'deadline' ? 'DEADLINE'
    : stoppedBy === 'signal' ? 'INTERRUPTED'
      : expectedDefect ? (defectObserved === true ? 'COMPLETED_WITH_OBSERVED_DEFECT' : 'COMPLETED_DEFECT_NOT_OBSERVED')
        : !durationRespected ? 'INTERRUPTED'
          : totalFailures === 0 && cleanup.activeSockets === 0 ? 'COMPLETED' : 'COMPLETED_WITH_FAILURES'

  const resumeArguments = [
    'node tools/trial-kit/bin/trial-soak.mjs',
    `--scenario ${config.scenario}`,
    `--duration-seconds ${config.durationSeconds}`,
    `--poll-ms ${config.pollMs}`,
    `--sse-interval-ms ${config.sseIntervalMs}`,
    `--reconnect-backoff-ms ${config.reconnectBackoffMs}`,
    `--reopen-seconds ${config.reopenSeconds}`,
    `--sample-ms ${config.sampleMs}`,
    `--max-errors ${config.maxErrors}`,
    `--failure-mode ${config.defect}`,
    '--out <NEW-OUT>',
  ]

  return {
    protocol: 'trial-soak/1',
    startedAt,
    endedAt,
    elapsedMs,
    wallElapsedSeconds,
    requestedDurationSeconds: config.durationSeconds,
    stoppedBy,
    status,
    scenario: {
      scenario: config.scenario,
      defect: config.defect,
      expectedDefectObservation: expectedDefect ? DEFECT_EXPECTATIONS[config.defect] : null,
      defectObserved,
      config: {
        pollMs: config.pollMs, sseIntervalMs: config.sseIntervalMs, reconnectBackoffMs: config.reconnectBackoffMs,
        sseIdleTimeoutMs: config.sseIdleTimeoutMs, reopenSeconds: config.reopenSeconds, sampleMs: config.sampleMs,
        maxRequests: config.maxRequests, maxSseEvents: config.maxSseEvents, maxReconnects: config.maxReconnects,
        maxErrors: config.maxErrors, pollTimeoutMs: config.pollTimeoutMs,
      },
    },
    fixture: { url: server.url, port: server.port, defect: server.defect, stats: serverStatsBeforeClose },
    counters: {
      pollRequests: counters.pollRequests, pollOk: counters.pollOk, pollFailed: counters.pollFailed,
      latencyMs: { count: sortedLatencies.length, p50: latencyPercentile(sortedLatencies, 0.5), p95: latencyPercentile(sortedLatencies, 0.95), max: sortedLatencies.at(-1) === undefined ? null : Math.round(sortedLatencies.at(-1) * 100) / 100 },
      httpStatuses: counters.httpStatuses,
      sseConnections: counters.sseConnections, sseEvents: counters.sseEvents, sseBytes: counters.sseBytes,
      sseFailedConnections: counters.sseFailedConnections, duplicates: counters.duplicates, gaps: counters.gaps,
      reconnects: counters.reconnects, reopens: counters.reopens, samples: counters.samples,
      lastEventAt,
    },
    failures: { total: totalFailures, counts: failureCounts, samples: failures },
    samples: { path: 'samples.ndjson', count: counters.samples, sha256: null },
    cleanup,
    consistency: { ok: consistencyIssues.length === 0, issues: consistencyIssues, lastSampleElapsedMs },
    unknowns: [
      'client reopen is a new HTTP/SSE connection, not daemon process recovery',
      'provider/queue/old-request behaviour is not observable from this fixture and is not claimed',
      'server-side handler timing is not separately instrumented; client latency is reported',
      'resource samples cover this process and the fixture server only, never another user process',
    ],
    resume: { arguments: resumeArguments, note: 'replace <NEW-OUT>; the same duration and failure mode are required for comparability' },
  }
}

function expectedDefectObserved(defect, failureCounts, counters) {
  if (defect === 'slow') return (failureCounts['poll:poll_timeout'] ?? 0) > 0
  if (defect === 'truncate') return (failureCounts['sse:disconnect:end'] ?? 0) > 0 || (failureCounts['sse:disconnect:error'] ?? 0) > 0 || counters.sseFailedConnections > 0
  if (defect === 'duplicate') return counters.duplicates > 0
  if (defect === 'server_error') return (failureCounts['poll:http_500'] ?? 0) > 0
  if (defect === 'unauthorized') return (failureCounts['poll:http_401'] ?? 0) > 0
  if (defect === 'bad_json') return (failureCounts['poll:invalid_json'] ?? 0) > 0
  if (defect === 'oversized') return (failureCounts['poll:body_size'] ?? 0) > 0
  if (defect === 'unknown_field') return (failureCounts['poll:schema_invalid'] ?? 0) > 0
  return null
}

export function soakResumeLine(config) {
  return ['node tools/trial-kit/bin/trial-soak.mjs', `--scenario ${config.scenario}`, `--duration-seconds ${config.durationSeconds}`, '--out <NEW-OUT>'].join(' ')
}

