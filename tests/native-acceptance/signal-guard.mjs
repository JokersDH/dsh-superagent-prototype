#!/usr/bin/env node
/**
 * Wave-28 B5: signal safety as a tool, not as a habit.
 *
 * A process is only ever signalled when a caller-declared record matches a FRESH observation of its
 * complete birth identity: pid, start time, uid, full argv and the declared root/config/operation
 * markers carried in that argv. Anything unreadable, recycled, pre-recorded or foreign is UNKNOWN and
 * is retained - never silently cleaned up, never force-killed by pid alone.
 */
import { execFileSync } from 'node:child_process'

const PS = ['-o', 'pid=,uid=,lstart=,command=', '-p']

/** Read one live process. Returns { alive:false } when the pid does not exist. */
export function observe(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { alive: false, reason: 'invalid_pid' }
  let raw
  try { raw = execFileSync('/bin/ps', [...PS, String(pid)], { encoding: 'utf8' }).trim() } catch { return { alive: false, reason: 'not_found' } }
  if (!raw) return { alive: false, reason: 'not_found' }
  const match = /^(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/.exec(raw)
  if (!match) return { alive: true, reason: 'unparseable', raw }
  return { alive: true, pid: Number(match[1]), uid: Number(match[2]), start: match[3], argv: match[4], raw }
}

/**
 * Capture the birth identity a caller intends to own. `markers` are literal substrings the live argv
 * must contain (root, config, operation); they are the caller's claim, not an inference.
 */
export function capture(pid, { markers = [] } = {}) {
  const live = observe(pid)
  if (!live.alive) return { ok: false, unknown: 'not_alive', pid, live }
  return {
    ok: true,
    record: { pid: live.pid, uid: live.uid, start: live.start, argv: live.argv, markers: [...markers], capturedAt: new Date().toISOString() },
  }
}

/**
 * Re-check a record against a fresh observation. `ok` is true only when every field matches and every
 * declared marker is still present in argv.
 */
export function verify(record) {
  if (!record || !Number.isSafeInteger(record.pid)) return { ok: false, unknown: 'no_record' }
  if (typeof record.start !== 'string' || record.start.length === 0) return { ok: false, unknown: 'no_start' }
  const live = observe(record.pid)
  if (!live.alive) return { ok: false, unknown: 'already_gone', live }
  if (live.reason === 'unparseable') return { ok: false, unknown: 'unreadable', live }
  const mismatches = []
  if (live.pid !== record.pid) mismatches.push('pid')
  if (live.uid !== record.uid) mismatches.push('uid')
  if (live.start !== record.start) mismatches.push('start')
  if (record.argv && live.argv !== record.argv) mismatches.push('argv')
  for (const marker of record.markers ?? []) if (!live.argv.includes(marker)) mismatches.push(`marker:${marker}`)
  return { ok: mismatches.length === 0, mismatches, live }
}

/**
 * Signal ONLY after a fresh verification. Returns what actually happened:
 * - refused: the record did not match, so nothing was sent;
 * - sent: the exact pid received the signal (exit is then confirmed separately);
 * - unknown: the process could not be read, so nothing was sent and material is retained.
 */
export function signalOwned(record, signal = 'SIGKILL') {
  const check = verify(record)
  if (!check.ok) return { sent: false, refused: true, unknown: check.unknown ?? null, mismatches: check.mismatches ?? [], live: check.live ?? null }
  try { process.kill(record.pid, signal) } catch (error) { return { sent: false, refused: false, unknown: String(error?.code ?? error) } }
  return { sent: true, pid: record.pid, signal }
}

/** Wait for the exact pid to disappear, bounded. Unknown when the pid is still readable at the deadline. */
export async function confirmExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!observe(pid).alive) return { exited: true, observedAt: new Date().toISOString() }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  const live = observe(pid)
  return live.alive ? { exited: false, unknown: 'still_readable', live } : { exited: true, observedAt: new Date().toISOString() }
}

/** TERM, then a FRESH verification and KILL only if the same birth identity is still the one running. */
export async function escalate(record, { termWaitMs = 1500 } = {}) {
  const term = signalOwned(record, 'SIGTERM')
  if (!term.sent) return { term, kill: null, exit: term.refused ? { exiting: false, retained: 'refused' } : { unknown: term.unknown } }
  const first = await confirmExit(record.pid, termWaitMs)
  if (first.exited) return { term, kill: null, exit: first }
  const kill = signalOwned(record, 'SIGKILL')
  const second = kill.sent ? await confirmExit(record.pid, 5000) : { exiting: false, unknown: kill.unknown ?? 'refused' }
  return { term, kill, exit: second }
}
