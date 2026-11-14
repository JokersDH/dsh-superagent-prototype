/**
 * Re-derive a run's consistency from its own raw material (run.json + samples.ndjson), without
 * trusting the summary. Used for runs produced before the in-tool consistency section existed, and
 * useful as an independent check afterwards.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { TrialKitError, nowIso } from './output.mjs'

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

export async function verifyRun(runDir) {
  let run
  try { run = JSON.parse(await readFile(join(runDir, 'run.json'), 'utf8')) } catch (error) {
    throw new TrialKitError('run_unreadable', 'run.json is missing or invalid', { code: error?.code ?? 'invalid' })
  }
  const samplePath = join(runDir, run.samples?.path ?? 'samples.ndjson')
  const sampleInfo = await stat(samplePath)
  const sampleDigest = await digest(samplePath)
  const raw = await readFile(samplePath, 'utf8')
  const lines = raw.split('\n').filter((line) => line.length > 0)
  const issues = []
  if (sampleDigest !== run.samples?.sha256) issues.push('sample_digest_mismatch')
  if (lines.length !== run.samples?.count) issues.push('sample_count_mismatch')
  const samples = []
  for (const [index, line] of lines.entries()) {
    try { samples.push(JSON.parse(line)) } catch { issues.push(`sample_invalid_json:${index + 1}`); break }
  }
  let previous = -1
  for (const sample of samples) {
    if (!Number.isFinite(sample.elapsedMs) || sample.elapsedMs < previous) { issues.push('sample_time_not_monotonic'); break }
    previous = sample.elapsedMs
  }
  const lastSample = samples.at(-1) ?? null
  const elapsedSeconds = run.wallElapsedSeconds ?? 0
  if (lastSample !== null && lastSample.elapsedMs < elapsedSeconds * 1000 - 8000 && run.stoppedBy !== 'signal') issues.push('samples_ended_early')
  if (run.status === 'COMPLETED' && run.failures?.total !== 0) issues.push('completed_with_failures')
  if (run.status === 'COMPLETED' && (run.cleanup?.activeSockets ?? null) !== 0) issues.push('sockets_not_released')
  if (lastSample !== null && typeof lastSample.pollRequests === 'number' && lastSample.pollRequests > (run.counters?.pollRequests ?? 0)) issues.push('counter_regression')
  if (lastSample !== null && typeof lastSample.sseEvents === 'number' && lastSample.sseEvents > (run.counters?.sseEvents ?? 0)) issues.push('sse_counter_regression')
  const expected = run.requestedDurationSeconds !== undefined && run.stoppedBy === 'duration'
    ? Math.abs(elapsedSeconds - run.requestedDurationSeconds) <= 3
    : null
  if (expected === false) issues.push('duration_not_respected')
  return {
    protocol: 'trial-run-check/1', checkedAt: nowIso(), runDirectory: runDir,
    run: { status: run.status, startedAt: run.startedAt, endedAt: run.endedAt, wallElapsedSeconds: elapsedSeconds, requestedDurationSeconds: run.requestedDurationSeconds ?? null, stoppedBy: run.stoppedBy ?? null },
    samples: { path: run.samples?.path ?? 'samples.ndjson', lines: lines.length, declaredCount: run.samples?.count ?? null, bytes: sampleInfo.size, sha256: sampleDigest, lastElapsedMs: lastSample?.elapsedMs ?? null },
    counters: run.counters ?? null,
    failures: run.failures?.total ?? null,
    cleanup: run.cleanup ?? null,
    consistency: { ok: issues.length === 0, issues },
  }
}
