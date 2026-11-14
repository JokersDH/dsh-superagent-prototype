#!/usr/bin/env node
/**
 * `trial-soak` — bounded operational scenario: loopback fixture HTTP/SSE, controlled client
 * reconnect/reopen, resource sampling, one total duration and a hard deadline.
 *
 *   trial-soak --scenario mixed --duration-seconds 600 --out <new-dir>
 *
 * This is not a soak claim and not a release proof. It reports the actual start/end/elapsed of one
 * finite run, its input tuple, every failure and every unknown. `--duration-seconds 1800` is the
 * longest scenario this kit runs; 24 h/48 h are explicitly not measured.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parseOptions } from '../lib/args.mjs'
import { LIMITS, TOOL } from '../lib/limits.mjs'
import { EXIT, TrialKitError, createOutputRoot, nowIso, printHuman, writePrivateFile, writePrivateJson } from '../lib/output.mjs'
import { runSoak } from '../lib/soak.mjs'

const USAGE = `trial-soak — 有界 HTTP/SSE/重连/客户端重开场景（fixture only）
用法:
  trial-soak --out <新目录> [--scenario mixed] [--duration-seconds 600] [选项]
选项:
  --scenario <http|sse|mixed>          默认 mixed
  --duration-seconds <n>               1..7200；默认 60。本轮实际使用 600 与 1800
  --poll-ms <n>                        readiness 轮询间隔（默认 1000）
  --poll-timeout-ms <n>                单次轮询 deadline（默认 500）
  --sse-interval-ms <n>                fixture 事件间隔（默认 1000）
  --sse-idle-timeout-ms <n>            单连接空闲 deadline（默认 5000）
  --reconnect-backoff-ms <n>           重连退避（默认 250）
  --max-reconnects <n>                 重连次数上限（默认 2000）
  --reopen-seconds <n>                 客户端重开周期；0 关闭（默认 60）
  --sample-ms <n>                      资源采样间隔（默认 2000）
  --max-requests <n>                   readiness 请求上限（默认 100000）
  --max-events <n>                     SSE 连接内事件上限（默认 100000）
  --max-errors <n>                     失败数达到即停止（默认 50）
  --failure-mode <none|slow|truncate|duplicate|server_error|unauthorized|bad_json|oversized|unknown_field>
  --json                               只输出机器 JSON
退出: 0 场景按预期结束, 1 未达预期/有失败, 2 参数拒绝, 3 INTERNAL
`

const SPEC = {
  out: 'string', scenario: 'string', 'duration-seconds': 'number', 'poll-ms': 'number', 'poll-timeout-ms': 'number',
  'sse-interval-ms': 'number', 'sse-idle-timeout-ms': 'number', 'reconnect-backoff-ms': 'number', 'max-reconnects': 'number',
  'reopen-seconds': 'number', 'sample-ms': 'number', 'max-requests': 'number', 'max-events': 'number', 'max-errors': 'number',
  'failure-mode': 'string', json: 'boolean', help: 'boolean',
}

function bounded(values, name, fallback, min, max) {
  const value = values[name] ?? fallback
  if (!Number.isInteger(value) || value < min || value > max) throw new TrialKitError('usage', `--${name} must be an integer in ${min}..${max}`, { value })
  return value
}

async function fileDigest(path) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectPromise)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

async function main() {
  let values
  try { values = parseOptions(process.argv.slice(2), SPEC) } catch (error) {
    process.stderr.write(`soak: REFUSED ${error.code ?? 'usage'}: ${error.message}\n${USAGE}`)
    return EXIT.REFUSED
  }
  if (values.help === true) { printHuman([USAGE]); return EXIT.OK }
  let out = null
  try {
    if (values.out === undefined) throw new TrialKitError('usage', '--out <new-directory> is required')
    const scenario = values.scenario ?? 'mixed'
    if (!['http', 'sse', 'mixed'].includes(scenario)) throw new TrialKitError('usage', '--scenario must be http, sse or mixed')
    const defect = values['failure-mode'] ?? 'none'
    if (!['none', 'slow', 'truncate', 'duplicate', 'server_error', 'unauthorized', 'bad_json', 'oversized', 'unknown_field'].includes(defect))
      throw new TrialKitError('usage', '--failure-mode is not recognised')
    const config = {
      scenario,
      defect,
      durationSeconds: bounded(values, 'duration-seconds', 60, 1, LIMITS.maxSoakDurationSeconds),
      pollMs: bounded(values, 'poll-ms', 1000, 100, 60000),
      pollTimeoutMs: bounded(values, 'poll-timeout-ms', 500, 50, 30000),
      sseIntervalMs: bounded(values, 'sse-interval-ms', 1000, 50, 60000),
      sseIdleTimeoutMs: bounded(values, 'sse-idle-timeout-ms', 5000, 500, 120000),
      reconnectBackoffMs: bounded(values, 'reconnect-backoff-ms', 250, 10, 60000),
      maxReconnects: bounded(values, 'max-reconnects', 2000, 1, 100000),
      reopenSeconds: bounded(values, 'reopen-seconds', 60, 0, 3600),
      sampleMs: bounded(values, 'sample-ms', 2000, 100, 60000),
      maxRequests: bounded(values, 'max-requests', LIMITS.maxSoakRequests, 1, LIMITS.maxSoakRequests),
      maxSseEvents: bounded(values, 'max-events', LIMITS.maxSoakEvents, 1, LIMITS.maxSoakEvents),
      maxErrors: bounded(values, 'max-errors', 50, 1, 1_000_000),
      schema: null,
    }
    // Strict schema validation is reused from the published contract, not re-implemented.
    const moduleUrl = new URL('../../../packages/contracts/src/trial-readiness.ts', import.meta.url)
    config.schema = (await import(moduleUrl.href)).TrialReadinessSchema

    out = createOutputRoot(values.out)
    const result = await runSoak({ ...config, out })
    const samplePath = join(out, 'samples.ndjson')
    const sampleInfo = await stat(samplePath)
    result.samples.sha256 = await fileDigest(samplePath)
    result.samples.bytes = sampleInfo.size
    result.tool = { ...TOOL, command: 'soak' }
    result.outputRoot = values.out
    result.measurementScope = {
      measured: `one finite fixture scenario of ${config.durationSeconds}s (actual ${result.wallElapsedSeconds}s)`,
      notMeasured: ['24h/48h soak', 'daemon recovery', 'provider/queue stability', 'other machines', 'real model/native execution'],
    }
    result.resume.line = result.resume.arguments.join(' ')
    const serialized = `${JSON.stringify(result, null, 2)}\n`
    if (Buffer.byteLength(serialized) > LIMITS.maxReportBytes) throw new TrialKitError('report_too_large', 'Run report exceeds the byte budget')
    const runWritten = writePrivateJson(out, 'run.json', result)
    writePrivateFile(out, 'resume.txt', `${result.resume.line}\n`)
    if (values.json === true) process.stdout.write(serialized)
    else {
      printHuman([
        `soak: ${result.status}`,
        `  scenario: ${scenario} defect=${defect} requested=${config.durationSeconds}s actual=${result.wallElapsedSeconds}s stoppedBy=${result.stoppedBy ?? 'duration'}`,
        `  requests: ${result.counters.pollRequests} ok=${result.counters.pollOk} failed=${result.counters.pollFailed} p50=${result.counters.latencyMs.p50 ?? 'n/a'}ms p95=${result.counters.latencyMs.p95 ?? 'n/a'}ms`,
        `  sse: connections=${result.counters.sseConnections} events=${result.counters.sseEvents} reconnects=${result.counters.reconnects} reopens=${result.counters.reopens} duplicates=${result.counters.duplicates} gaps=${result.counters.gaps}`,
        `  samples: ${result.samples.count} -> samples.ndjson (sha256 ${result.samples.sha256.slice(0, 16)}...)`,
        `  failures: ${result.failures.total}${result.failures.total === 0 ? '' : ` ${JSON.stringify(result.failures.counts)}`}`,
        `  cleanup: sockets=${result.cleanup.activeSockets} connections=${result.cleanup.activeConnections}`,
        `  run: ${runWritten.path} (0600)`,
        '  note: 单次有限场景；不是 24/48 小时稳定性证明，也不含 daemon 恢复或真实模型/native',
      ])
      if (result.scenario.defectObserved !== null) printHuman([`  expected defect observed: ${result.scenario.defectObserved}`])
    }
    if (result.status === 'COMPLETED' || result.status === 'COMPLETED_WITH_OBSERVED_DEFECT') return EXIT.OK
    return EXIT.DEGRADED
  } catch (error) {
    const known = error instanceof TrialKitError ? error : new TrialKitError('internal', String(error?.message ?? error), undefined, EXIT.INTERNAL)
    if (out !== null) {
      try {
        writePrivateJson(out, 'run.json', {
          protocol: 'trial-soak/1', tool: { ...TOOL, command: 'soak' }, startedAt: nowIso(), status: 'REFUSED',
          failures: { total: 1, counts: { [known.code]: 1 }, samples: [{ kind: known.code, message: known.message }] },
          outputRoot: out,
        })
      } catch { /* keep the primary error */ }
    }
    if (values.json === true) process.stderr.write(`${JSON.stringify({ status: 'REFUSED', code: known.code, message: known.message })}\n`)
    else process.stderr.write(`soak: REFUSED ${known.code}: ${known.message}${out === null ? '' : ` (material kept in ${out})`}\n`)
    return known.exitCode ?? EXIT.REFUSED
  }
}

main().then((code) => { process.exitCode = code }).catch((error) => {
  process.stderr.write(`soak: INTERNAL ${String(error?.message ?? error)}\n`)
  process.exitCode = EXIT.INTERNAL
})
