/**
 * Re-derive a run's consistency from its own raw material.
 *
 * The summary is explicitly NOT trusted: duration comes from `startedAt`/`endedAt`, the monotonic
 * `elapsedMs` timeline and each sample's `at`, and those three must agree. Material is bound to the
 * run directory (regular files, no symlinks, no `..`/absolute sample paths) and read under byte and
 * line budgets. Contradictions (zero-length clock claiming 600 s, samples that stop early, reordered
 * time, missing failure accounting) are refused instead of "passing because the summary is
 * self-consistent".
 */
import { createHash } from 'node:crypto'
import { createReadStream, lstatSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { TrialKitError, nowIso } from './output.mjs'
import { homeDir, redactPath } from './redact.mjs'

const MAX_RUN_BYTES = 8 * 1024 * 1024
const MAX_SAMPLES_BYTES = 64 * 1024 * 1024
const MAX_SAMPLES_LINES = 50_000
const CLOCK_TOLERANCE_MS = 10_000

async function digest(path) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectPromise)
    stream.on('end', resolvePromise)
  })
  return hash.digest('hex')
}

function regularFile(path, label) {
  let info
  try { info = lstatSync(path) } catch { throw new TrialKitError('material_missing', `${label} is missing`, { label }) }
  if (info.isSymbolicLink()) throw new TrialKitError('material_symlink', `${label} must not be a symlink`, { label })
  if (!info.isFile()) throw new TrialKitError('material_not_regular', `${label} must be a regular file`, { label })
  return info
}

function boundSamplesPath(runDir, declared) {
  if (typeof declared !== 'string' || declared.length === 0) return 'samples.ndjson'
  if (isAbsolute(declared) || declared.includes('\\') || declared.includes('/') || declared === '..' || declared === '.')
    throw new TrialKitError('material_path_refused', 'Sample path must be one file name inside the run directory', { declared })
  const resolved = resolve(runDir, declared)
  if (dirname(resolved) !== resolve(runDir)) throw new TrialKitError('material_path_refused', 'Sample path escapes the run directory', { declared })
  return declared
}

function parseTimestamp(value) {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function median(values) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export async function verifyRun(runDirInput) {
  const issues = []
  const runDir = resolve(runDirInput)
  const rootInfo = lstatSync(runDir)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new TrialKitError('run_root_refused', 'Run directory must be a real directory, not a symlink')
  const runInfo = regularFile(resolve(runDir, 'run.json'), 'run.json')
  if (runInfo.size > MAX_RUN_BYTES) throw new TrialKitError('material_too_large', 'run.json exceeds the byte budget')
  let run
  try { run = JSON.parse(await readFile(resolve(runDir, 'run.json'), 'utf8')) } catch (error) {
    throw new TrialKitError('run_unreadable', 'run.json is missing or invalid', { code: error?.code ?? 'invalid' })
  }

  const sampleName = boundSamplesPath(runDir, run.samples?.path)
  const samplePath = resolve(runDir, sampleName)
  const sampleInfo = regularFile(samplePath, sampleName)
  if (sampleInfo.size > MAX_SAMPLES_BYTES) throw new TrialKitError('material_too_large', 'samples file exceeds the byte budget')
  const sampleDigest = await digest(samplePath)
  const raw = await readFile(samplePath, 'utf8')
  const lines = raw.split('\n').filter((line) => line.length > 0)
  if (lines.length > MAX_SAMPLES_LINES) throw new TrialKitError('material_too_large', 'Sample line count exceeds the budget')

  if (sampleDigest !== run.samples?.sha256) issues.push('sample_digest_mismatch')
  if (lines.length !== run.samples?.count) issues.push('sample_count_mismatch')
  if (typeof run.counters?.samples === 'number' && run.counters.samples !== lines.length) issues.push('counter_sample_count_mismatch')

  const samples = []
  for (const [index, line] of lines.entries()) {
    try { samples.push(JSON.parse(line)) } catch { issues.push(`sample_invalid_json:${index + 1}`); break }
  }

  // Monotonic time in both dimensions.
  let previousElapsed = -1
  let previousAt = -Infinity
  for (const sample of samples) {
    if (!Number.isFinite(sample.elapsedMs) || sample.elapsedMs < previousElapsed) { issues.push('sample_time_not_monotonic'); break }
    const at = parseTimestamp(sample.at)
    if (at === null) { issues.push('sample_at_invalid'); break }
    if (at < previousAt) { issues.push('sample_at_not_monotonic'); break }
    previousElapsed = sample.elapsedMs
    previousAt = at
  }

  // Independent duration: wall clock first, then the monotonic sample span.
  const startedAt = parseTimestamp(run.startedAt)
  const endedAt = parseTimestamp(run.endedAt)
  const requested = Number.isFinite(run.requestedDurationSeconds) ? run.requestedDurationSeconds : null
  let derivedWallSeconds = null
  if (startedAt === null || endedAt === null) issues.push('clock_invalid')
  else {
    derivedWallSeconds = (endedAt - startedAt) / 1000
    if (derivedWallSeconds < 0) issues.push('clock_negative')
    if (requested !== null && derivedWallSeconds > requested + 60) issues.push('clock_overshoot')
    if (run.stoppedBy === 'duration' && requested !== null && Math.abs(derivedWallSeconds - requested) > 3) issues.push('duration_mismatch')
  }
  if (typeof run.wallElapsedSeconds === 'number' && derivedWallSeconds !== null && Math.abs(run.wallElapsedSeconds - derivedWallSeconds) > 2)
    issues.push('summary_clock_mismatch')
  if (typeof run.wallElapsedSeconds !== 'number') issues.push('summary_clock_missing')

  const first = samples[0] ?? null
  const last = samples.at(-1) ?? null
  const sampleSpanMs = first !== null && last !== null && Number.isFinite(last.elapsedMs) && Number.isFinite(first.elapsedMs)
    ? last.elapsedMs - first.elapsedMs : null
  const sampleMs = Number.isFinite(run.scenario?.config?.sampleMs) ? run.scenario.config.sampleMs : null
  const tolerance = Math.max(5000, (sampleMs ?? 0) * 2)
  if (first !== null && Number.isFinite(first.elapsedMs) && first.elapsedMs > tolerance) issues.push('first_sample_late')
  if (derivedWallSeconds !== null && sampleSpanMs !== null) {
    const expectedSpan = derivedWallSeconds * 1000
    if (run.stoppedBy !== 'signal' && sampleSpanMs < expectedSpan - tolerance) issues.push('samples_do_not_cover_run')
    if (sampleSpanMs > expectedSpan + tolerance) issues.push('samples_exceed_run')
  }
  if (samples.length > 0 && startedAt !== null) {
    const mismatched = samples.filter((sample) => {
      const at = parseTimestamp(sample.at)
      return at !== null && Number.isFinite(sample.elapsedMs) && Math.abs(at - (startedAt + sample.elapsedMs)) > CLOCK_TOLERANCE_MS
    })
    if (mismatched.length > 0) issues.push('sample_timestamp_elapsed_mismatch')
  }
  if (sampleMs !== null && derivedWallSeconds !== null && run.stoppedBy !== 'signal') {
    const expectedSamples = Math.floor((derivedWallSeconds * 1000) / sampleMs) + 1
    if (samples.length < Math.floor(expectedSamples * 0.8)) issues.push('sample_count_low')
    const intervals = samples.slice(1).map((sample, index) => sample.elapsedMs - samples[index].elapsedMs).filter((value) => Number.isFinite(value) && value > 0)
    const typical = median(intervals)
    if (typical !== null && (typical < sampleMs * 0.5 || typical > sampleMs * 2)) issues.push('sample_cadence_off')
    const maxGap = intervals.length === 0 ? null : Math.max(...intervals)
    if (maxGap !== null && maxGap > Math.max(sampleMs * 3, 10_000) && run.stoppedBy !== 'signal') issues.push('sample_gap')
  }

  // Failure, status and cleanup accounting.
  const failureTotal = run.failures?.total
  const failureCounts = run.failures?.counts ?? {}
  if (!Number.isSafeInteger(failureTotal) || failureTotal < 0) issues.push('failures_missing')
  else {
    const counted = Object.values(failureCounts).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
    if (counted !== failureTotal) issues.push('failure_accounting_mismatch')
  }
  if (run.cleanup?.closed !== true) issues.push('cleanup_not_closed')
  if ((run.cleanup?.activeSockets ?? null) !== 0) issues.push('sockets_not_released')
  if ((run.cleanup?.activeConnections ?? null) !== 0) issues.push('connections_not_released')
  const defectObserved = run.scenario?.defectObserved
  if (run.status === 'COMPLETED') {
    if (failureTotal !== 0) issues.push('completed_with_failures')
    if (defectObserved !== null && defectObserved !== undefined) issues.push('completed_with_defect_claim')
    if (requested !== null && derivedWallSeconds !== null && derivedWallSeconds < requested - 3) issues.push('completed_early')
  }
  if (run.status === 'COMPLETED_WITH_FAILURES' && failureTotal === 0) issues.push('failure_status_without_failures')
  if (run.status === 'COMPLETED_WITH_OBSERVED_DEFECT' && (defectObserved !== true || failureTotal === 0)) issues.push('defect_status_inconsistent')
  if (run.status === 'INTERRUPTED' && run.stoppedBy !== 'signal') issues.push('interrupt_status_inconsistent')
  if (run.status === 'DEADLINE' && run.stoppedBy !== 'deadline') issues.push('deadline_status_inconsistent')

  if (last !== null && Number.isFinite(last.pollRequests) && Number.isFinite(run.counters?.pollRequests) && last.pollRequests > run.counters.pollRequests)
    issues.push('counter_regression')
  if (last !== null && Number.isFinite(last.sseEvents) && Number.isFinite(run.counters?.sseEvents) && last.sseEvents > run.counters.sseEvents)
    issues.push('sse_counter_regression')

  return {
    protocol: 'trial-run-check/2', checkedAt: nowIso(), runDirectory: redactPath(runDir, homeDir()),
    run: {
      status: run.status, startedAt: run.startedAt, endedAt: run.endedAt,
      derivedWallSeconds, summaryWallElapsedSeconds: run.wallElapsedSeconds ?? null,
      requestedDurationSeconds: requested, stoppedBy: run.stoppedBy ?? null,
    },
    samples: {
      path: sampleName, lines: lines.length, declaredCount: run.samples?.count ?? null, bytes: sampleInfo.size,
      sha256: sampleDigest, firstElapsedMs: first?.elapsedMs ?? null, lastElapsedMs: last?.elapsedMs ?? null,
      sampleSpanMs, medianIntervalMs: median(samples.slice(1).map((sample, index) => sample.elapsedMs - samples[index].elapsedMs).filter((value) => Number.isFinite(value) && value > 0)),
    },
    counters: run.counters ?? null,
    failures: failureTotal ?? null,
    failureCounts,
    cleanup: run.cleanup ?? null,
    consistency: { ok: issues.length === 0, issues },
  }
}
