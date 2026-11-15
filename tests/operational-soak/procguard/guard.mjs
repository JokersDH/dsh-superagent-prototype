/**
 * Safe own-probe birth and per-signal freshness guard.
 *
 * Ownership is a complete record — pid, parent pid, uid, process start time, full argv, root, config
 * and operation — read from the OS for a probe this test spawned. A foreign pid, a sibling, a recycled
 * pid, a missing field or a changed start time refuses. Every TERM/KILL re-reads the whole record
 * immediately before the signal; a proof from before a TERM is never reused for KILL.
 *
 * The helper only ever signals a pid it spawned in this run. It never scans processes, matches paths
 * or substrings, or touches a user instance.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PS = '/bin/ps'

function psLine(pid) {
  const result = spawnSync(PS, ['-ww', '-p', String(pid), '-o', 'pid=,ppid=,uid=,lstart=,command='],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
  if (result.status !== 0) return null
  const text = result.stdout.trim()
  if (text.length === 0) return null
  const match = /^(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.*)$/.exec(text)
  if (match === null) return { raw: text, parse: false }
  return { pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), start: match[4].replace(/\s+/g, ' '), command: match[5].trim(), parse: true }
}

export function observeProcess(pid) {
  const observed = psLine(pid)
  if (observed === null) return { alive: false, reason: 'missing' }
  if (observed.parse === false) return { alive: true, reason: 'unparsable', raw: observed.raw }
  return { alive: true, ...observed }
}

/** Spawn one probe in an owned private root and record its complete birth identity. */
export async function spawnOwnProbe({ root, operation, ignoreTerm = false }) {
  const probeDir = join(root, 'probe')
  mkdirSync(probeDir, { recursive: true, mode: 0o700 })
  const script = join(probeDir, 'probe.mjs')
  const ready = join(probeDir, 'ready')
  const body = ignoreTerm
    ? `import { writeFileSync } from 'node:fs'; process.on('SIGTERM', () => {}); writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);\n`
    : `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);\n`
  writeFileSync(script, body, { mode: 0o600 })
  const config = join(probeDir, 'config.json')
  writeFileSync(config, `${JSON.stringify({ operation, owned: true })}\n`, { mode: 0o600 })
  const argv = [script, '--root', probeDir, '--config', config, '--operation', operation]
  const child = spawn(process.execPath, argv, { stdio: 'ignore' })
  const expectedCommand = [process.execPath, ...argv].join(' ')
  const deadline = Date.now() + 3000
  let observed = null
  while (Date.now() < deadline) {
    observed = observeProcess(child.pid)
    if (observed.alive === true && observed.parse === true && existsSync(ready)) break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  if (observed === null || observed.alive !== true || observed.parse !== true)
    throw new Error(`Own probe never became observable: ${JSON.stringify(observed)}`)
  const record = {
    pid: child.pid, ppid: process.pid, uid: process.getuid?.() ?? null,
    start: observed.start, command: expectedCommand, observedCommand: observed.command,
    root: probeDir, config, operation, argv, ready,
    birth: { source: 'spawn_return+ps', observedAt: new Date().toISOString() },
  }
  const matches = compareRecord(record, observed)
  if (!matches.ok) {
    throw new Error(`Own probe identity did not match at birth: ${JSON.stringify(matches)}`)
  }
  return { child, record }
}

export function compareRecord(record, observed) {
  const issues = []
  if (record === null || typeof record !== 'object') return { ok: false, issues: ['record_missing'] }
  for (const field of ['pid', 'ppid', 'uid', 'start', 'command', 'root', 'config', 'operation'])
    if (record[field] === undefined || record[field] === null) issues.push(`record_${field}_missing`)
  if (observed === null || observed.alive !== true) return { ok: false, issues: [...issues, 'not_alive'] }
  if (observed.parse !== true) return { ok: false, issues: [...issues, 'unparsable'] }
  if (observed.pid !== record.pid) issues.push('pid_mismatch')
  if (observed.ppid !== record.ppid) issues.push('ppid_mismatch')
  if (observed.uid !== record.uid) issues.push('uid_mismatch')
  if (observed.start !== record.start) issues.push('start_mismatch')
  const expectedCommand = String(record.command ?? '').replace(/\s+/g, ' ').trim()
  const actualCommand = String(observed.command ?? '').replace(/\s+/g, ' ').trim()
  if (expectedCommand !== actualCommand) issues.push('argv_mismatch')
  for (const token of [record.root, record.config, record.operation])
    if (typeof token !== 'string' || !actualCommand.includes(token)) issues.push('operation_root_config_missing')
  return { ok: issues.length === 0, issues }
}

/**
 * Re-read the entire identity immediately before one signal. Only an exact match sends it; otherwise
 * the call refuses and sends nothing. KILL after TERM requires its own fresh call.
 */
export function signalFresh({ record, signal, allowSignals = true }) {
  if (allowSignals !== true) return { sent: false, refused: 'signals_disabled', issues: [] }
  const observed = observeProcess(record.pid)
  const compare = compareRecord(record, observed)
  if (!compare.ok) return { sent: false, refused: 'identity_not_fresh', issues: compare.issues, observed }
  try {
    process.kill(record.pid, signal)
    return { sent: true, signal, observedAt: new Date().toISOString(), observed: { pid: observed.pid, start: observed.start, uid: observed.uid, ppid: observed.ppid } }
  } catch (error) {
    return { sent: false, refused: String(error?.code ?? error), issues: [] }
  }
}

export async function waitGone(pid, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (observeProcess(pid).alive !== true) return { gone: true, at: new Date().toISOString() }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  return { gone: false, at: new Date().toISOString() }
}

/** Pure controls: no signal is ever sent by these helpers. */
export function pureControls(record) {
  const forged = (patch) => ({ ...record, ...patch })
  const observed = observeProcess(record.pid)
  const cases = [
    { id: 'own_matches', expected: compareRecord(record, observed) },
    { id: 'foreign_uid', expected: compareRecord(forged({ uid: record.uid + 1 }), observed) },
    { id: 'foreign_ppid', expected: compareRecord(forged({ ppid: record.ppid + 1 }), observed) },
    { id: 'recycled_start', expected: compareRecord(forged({ start: 'Thu Jan  1 00:00:00 1970' }), observed) },
    { id: 'wrong_argv', expected: compareRecord(forged({ command: `${record.command} --foreign` }), observed) },
    { id: 'missing_operation', expected: compareRecord(forged({ operation: undefined }), observed) },
    { id: 'pre_record_pid', expected: compareRecord({ ...record, pid: 1 }, observed) },
    { id: 'missing_pid', expected: compareRecord(forged({ pid: undefined }), observed) },
    { id: 'sibling_pid', expected: compareRecord(forged({ pid: record.pid + 1 }), observed) },
  ]
  return cases
}
