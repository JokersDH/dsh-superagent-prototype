#!/usr/bin/env node
/**
 * Wave-29 B5/B6: exact ownership before any signal.
 *
 * A process is only signalled when a record that was REGISTERED by the spawner still matches a fresh
 * observation of the complete birth identity: pid, uid, start time, parent pid, full argv, and the exact
 * root/config/operation arguments that the original spawn declared. Matching is exact-token, never a
 * substring or a sibling prefix. `ps` returning "No such process" is the only way to say GONE; any
 * unreadable/parse/permission failure is UNKNOWN, and UNKNOWN is never treated as exited and never
 * triggers cleanup. Before the FIRST signal the declared child set is checked, and every escalation is
 * verified again.
 */
import { spawnSync } from 'node:child_process'

const PS_FIELDS = '-o pid=,uid=,ppid=,lstart=,command='

const NO_SUCH = [/no such process/i, /no matching process/i, /nonexistent/i]

/** Observe one pid. `state` is 'live' | 'gone' | 'unknown'; only 'gone' is proof of exit. */
export function observe(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return { state: 'unknown', reason: 'invalid_pid', alive: false }
  const result = spawnSync('/bin/ps', [PS_FIELDS, '-p', String(pid)], { encoding: 'utf8' })
  const stdout = (result.stdout ?? '').trim()
  const stderr = String(result.stderr ?? '')
  if (result.error) return { state: 'unknown', reason: 'ps_error', detail: String(result.error.message ?? result.error), alive: false }
  if (result.status !== 0) {
    if (NO_SUCH.some(pattern => pattern.test(stderr))) return { state: 'gone', reason: 'no_such_process', alive: false }
    // macOS `ps -p <dead pid>` exits 1 with NO output at all: that silence is the "no such process"
    // signal. Any stderr text (too large, permission, bad option) stays UNKNOWN instead of gone.
    if (stdout.length === 0 && stderr.trim().length === 0) return { state: 'gone', reason: 'silent_absence', alive: false }
    return { state: 'unknown', reason: 'ps_failed', detail: stderr.trim().slice(0, 200), alive: false }
  }
  if (stdout.length === 0) return { state: 'gone', reason: 'empty_output', alive: false }
  const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/.exec(stdout)
  if (!match) return { state: 'unknown', reason: 'unparseable', raw: stdout.slice(0, 200), alive: false }
  return { state: 'live', pid: Number(match[1]), uid: Number(match[2]), ppid: Number(match[3]), start: match[4], argv: match[5], alive: true }
}

/** Tokens of an observed command line, used for exact argument matching. */
const tokens = argv => argv.split(/\s+/).filter(Boolean)

/**
 * Register the birth identity of a process THIS probe spawned. The caller must supply the exact argv
 * arguments it spawned with; nothing about the pid alone is ownership.
 */
export function born(pid, expectations = {}) {
  const live = observe(pid)
  if (live.state !== 'live') return { ok: false, unknown: live.reason ?? live.state, live }
  const record = {
    kind: 'probe-born',
    pid: live.pid, uid: live.uid, ppid: live.ppid, start: live.start, argv: live.argv,
    exactArgs: [...(expectations.exactArgs ?? [])],
    markers: [...(expectations.markers ?? [])],
    expectedChildren: expectations.expectedChildren ? [...expectations.expectedChildren] : null,
    capturedAt: new Date().toISOString(),
  }
  return { ok: true, record }
}

/** Back-compat alias: capture is only a registration of a probe-born pid. */
export function capture(pid, expectations = {}) { return born(pid, expectations) }

function childPids(pid) {
  // BSD ps has no --ppid; pgrep -P is the exact parent filter. Exit 1 with no output means "no
  // children" (which is a real, exact answer), anything else is unreadable.
  const result = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
  if (result.error) return { state: 'unknown', reason: 'children_unreadable' }
  const stdout = String(result.stdout ?? '').trim()
  if (result.status === 1 && stdout.length === 0) return { state: 'ok', children: [] }
  if (result.status !== 0) return { state: 'unknown', reason: 'children_unreadable' }
  const children = stdout.split('\n').map(line => Number(line.trim())).filter(Number.isSafeInteger)
  return { state: 'ok', children }
}

/** Verify a record against a fresh observation, including exact declared arguments. */
export function verify(record) {
  if (!record || !Number.isSafeInteger(record.pid)) return { ok: false, unknown: 'no_record' }
  if (typeof record.start !== 'string' || record.start.length === 0) return { ok: false, unknown: 'no_start' }
  if (record.pid <= 0) return { ok: false, unknown: 'invalid_pid' }
  const live = observe(record.pid)
  if (live.state === 'unknown') return { ok: false, unknown: live.reason ?? 'unreadable', live }
  if (live.state === 'gone') return { ok: false, unknown: 'already_gone', live }
  const mismatches = []
  if (live.uid !== record.uid) mismatches.push('uid')
  if (live.start !== record.start) mismatches.push('start')
  if (live.ppid !== record.ppid) mismatches.push('ppid')
  if (record.argv && live.argv !== record.argv) mismatches.push('argv')
  const liveTokens = tokens(live.argv ?? '')
  const liveSet = new Set(liveTokens)
  for (const arg of record.exactArgs ?? []) {
    // Exact token equality only: a root /srv/app must never match /srv/app-old or /srv/app/child.
    if (!liveSet.has(arg)) mismatches.push(`arg:${arg}`)
  }
  for (const marker of record.markers ?? []) if (!(live.argv ?? '').includes(marker)) mismatches.push(`marker:${marker}`)
  return { ok: mismatches.length === 0, mismatches, live }
}

/**
 * Full resource precheck for the FIRST signal: the live child set must be exactly the declared one.
 * A missing declaration is not permission to signal; it is a refusal to proceed.
 */
export function verifyResources(record) {
  if (!record || !Array.isArray(record.expectedChildren)) return { ok: false, unknown: 'no_resource_plan' }
  const observed = childPids(record.pid)
  if (observed.state !== 'ok') return { ok: false, unknown: observed.reason ?? 'children_unreadable' }
  const declared = [...record.expectedChildren].sort((a, b) => a - b)
  const actual = [...observed.children].sort((a, b) => a - b)
  const ok = declared.length === actual.length && declared.every((pid, index) => pid === actual[index])
  return ok ? { ok: true, children: actual } : { ok: false, mismatches: [`children:${actual.join(',')}`], children: actual }
}

/** Signal ONLY after fresh verification (and the resource precheck for the first signal). */
export function signalOwned(record, signal = 'SIGKILL', { first = false } = {}) {
  const check = verify(record)
  if (!check.ok) return { sent: false, refused: true, unknown: check.unknown ?? null, mismatches: check.mismatches ?? [], live: check.live ?? null }
  if (first) {
    const resources = verifyResources(record)
    if (!resources.ok) return { sent: false, refused: true, unknown: resources.unknown ?? 'resource_mismatch', mismatches: resources.mismatches ?? [], resources }
  }
  try { process.kill(record.pid, signal) } catch (error) {
    const code = String(error?.code ?? error)
    // ESRCH after a fresh live observation is still an unknown transition, not a successful signal.
    return { sent: false, refused: false, unknown: code }
  }
  return { sent: true, pid: record.pid, signal }
}

/** Wait for the exact pid to be GONE. UNKNOWN at the deadline is not an exit. */
export async function confirmExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let last = observe(pid)
  while (Date.now() < deadline) {
    last = observe(pid)
    if (last.state === 'gone') return { exited: true, observedAt: new Date().toISOString() }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  if (last.state === 'gone') return { exited: true, observedAt: new Date().toISOString() }
  return { exited: false, unknown: last.state === 'unknown' ? (last.reason ?? 'unreadable') : 'still_readable', live: last.state === 'live' ? last : null }
}

/** TERM, a FRESH verification, then KILL only if the same identity is still the one running. */
export async function escalate(record, { termWaitMs = 1500 } = {}) {
  const term = signalOwned(record, 'SIGTERM', { first: true })
  if (!term.sent) return { term, kill: null, exit: term.refused ? { exited: false, retained: term.unknown ?? 'refused' } : { exited: false, unknown: term.unknown } }
  const first = await confirmExit(record.pid, termWaitMs)
  if (first.exited) return { term, kill: null, exit: first }
  const kill = signalOwned(record, 'SIGKILL')
  const second = kill.sent ? await confirmExit(record.pid, 5000) : { exited: false, unknown: kill.unknown ?? 'refused' }
  return { term, kill, exit: second }
}
