/**
 * Wave-29 safe process guard v2.
 *
 * Ownership is an in-run registration, not a JSON record: only a handle returned by this module's
 * `spawnOwnProbe` can be signalled. The record is bound at birth from three independent sources —
 * the spawn arguments, the child's own birth report (`process.argv/pid/ppid/uid/cwd`) and the OS
 * observation (start/uid) — and root/config/operation must match their exact spawn values, never a
 * substring/prefix. `ps` failures are UNKNOWN, never "gone".
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PS = '/bin/ps'
const REGISTRY = new Map()

export function classifyPs(result) {
  if (result?.error) return { state: 'unknown', reason: 'ps_error', code: String(result.error.code ?? result.error) }
  if (result?.status === 0) {
    const parsed = parsePsLine(result.stdout ?? '')
    if (parsed !== null) return { state: 'alive', ...parsed }
    return { state: 'unknown', reason: 'ps_unparsable' }
  }
  const stderr = String(result?.stderr ?? '')
  if (/no such process|process not found|not found/i.test(stderr)) return { state: 'gone', reason: 'ps_not_found' }
  return { state: 'unknown', reason: 'ps_failed', status: result?.status ?? null }
}

function parsePsLine(stdout) {
  const text = String(stdout).trim()
  if (text.length === 0) return null
  const match = /^(\d+)\s+(\d+)\s+(\d+)\s+([A-Z][a-z]{2} [A-Z][a-z]{2} +\d{1,2} \d{2}:\d{2}:\d{2} \d{4})\s+(.*)$/.exec(text)
  if (match === null) return null
  return { pid: Number(match[1]), ppid: Number(match[2]), uid: Number(match[3]), start: match[4].replace(/\s+/g, ' '), command: match[5].trim() }
}

export function observeProcess(pid) {
  const result = spawnSync(PS, ['-ww', '-p', String(pid), '-o', 'pid=,ppid=,uid=,lstart=,command='],
    { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } })
  return classifyPs(result)
}

function exactArgsMatch(spawnArgs, birthArgv) {
  if (!Array.isArray(spawnArgs) || !Array.isArray(birthArgv)) return false
  if (spawnArgs.length !== birthArgv.length) return false
  return spawnArgs.every((value, index) => typeof value === 'string' && value === birthArgv[index])
}

/** Compare a complete record to one observation. Root/config/op are exact declared values. */
export function compareRecord2(record, observed) {
  const issues = []
  if (record === null || typeof record !== 'object') return { ok: false, issues: ['record_missing'] }
  for (const field of ['pid', 'ppid', 'uid', 'start', 'command', 'root', 'config', 'operation'])
    if (record[field] === undefined || record[field] === null) issues.push(`record_${field}_missing`)
  if (!Array.isArray(record.argv) || record.argv.length === 0) issues.push('record_argv_missing')
  if (record.birth === undefined || record.birth === null) issues.push('record_birth_missing')
  if (record.birth?.source !== 'child_report+ps+spawn') issues.push('birth_source_invalid')
  if (observed === null || observed.state !== 'alive') return { ok: false, issues: [...issues, `observed_${observed?.state ?? 'missing'}`] }
  if (observed.pid !== record.pid) issues.push('pid_mismatch')
  if (observed.ppid !== record.ppid) issues.push('ppid_mismatch')
  if (observed.uid !== record.uid) issues.push('uid_mismatch')
  if (observed.start !== record.start) issues.push('start_mismatch')
  const expectedCommand = String(record.command ?? '').replace(/\s+/g, ' ').trim()
  const actualCommand = String(observed.command ?? '').replace(/\s+/g, ' ').trim()
  if (expectedCommand !== actualCommand) issues.push('argv_mismatch')
  if (!Array.isArray(record.birth?.argv) || !exactArgsMatch(record.argv, record.birth.argv)) issues.push('birth_argv_mismatch')
  if (record.birth?.root !== record.root) issues.push('birth_root_mismatch')
  if (record.birth?.config !== record.config) issues.push('birth_config_mismatch')
  if (record.birth?.operation !== record.operation) issues.push('birth_operation_mismatch')
  return { ok: issues.length === 0, issues }
}

/** Spawn one probe and register its immutable birth facts. */
export async function spawnOwnProbe({ root, operation, ignoreTerm = false }) {
  const probeDir = join(root, 'probe')
  mkdirSync(probeDir, { recursive: true, mode: 0o700 })
  const script = join(probeDir, 'probe.mjs')
  const birthPath = join(probeDir, 'birth.json')
  const ready = join(probeDir, 'ready')
  const config = join(probeDir, 'config.json')
  writeFileSync(config, `${JSON.stringify({ operation, owned: true })}\n`, { mode: 0o600 })
  const body = `import { writeFileSync } from 'node:fs';\n`
    + `if (${ignoreTerm}) process.on('SIGTERM', () => {});\n`
    + `writeFileSync(${JSON.stringify(birthPath)}, JSON.stringify({ argv: process.argv.slice(1), pid: process.pid, ppid: process.ppid, uid: process.getuid?.() ?? null, cwd: process.cwd() }));\n`
    + `writeFileSync(${JSON.stringify(ready)}, 'ready');\n`
    + `setInterval(() => {}, 1000);\n`
  writeFileSync(script, body, { mode: 0o600 })
  const argv = [script, '--root', probeDir, '--config', config, '--operation', operation]
  const child = spawn(process.execPath, argv, { stdio: 'ignore' })
  const deadline = Date.now() + 3000
  let observed = null
  let birth = null
  while (Date.now() < deadline) {
    observed = observeProcess(child.pid)
    if (observed.state === 'alive' && existsSync(ready) && existsSync(birthPath)) {
      try { birth = JSON.parse(readFileSync(birthPath, 'utf8')); break } catch { birth = null }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  if (observed === null || observed.state !== 'alive' || birth === null)
    throw new Error(`Own probe birth was not complete: ${JSON.stringify({ observed, birth })}`)
  const record = {
    pid: child.pid, ppid: process.pid, uid: process.getuid?.() ?? null, start: observed.start,
    command: [process.execPath, ...argv].join(' '), root: probeDir, config, operation, argv,
    birth: { source: 'child_report+ps+spawn', argv: birth.argv, pid: birth.pid, ppid: birth.ppid, uid: birth.uid, cwd: birth.cwd, root: probeDir, config, operation },
  }
  const compare = compareRecord2(record, observed)
  if (!compare.ok) throw new Error(`Own probe identity failed at birth: ${JSON.stringify(compare)}`)
  const token = Symbol(`probe-${child.pid}`)
  REGISTRY.set(token, { record, child })
  return { handle: Object.freeze({ token }), record }
}

/**
 * Send one signal only for a registered handle whose complete identity still matches right now.
 * `observer` and `allowSignals` are test-only injections; a JSON record alone is always refused.
 */
export function signalFresh({ handle, signal, observer = observeProcess, allowSignals = true }) {
  if (allowSignals !== true) return { sent: false, refused: 'signals_disabled', issues: [] }
  if (handle === null || typeof handle !== 'object' || !REGISTRY.has(handle.token))
    return { sent: false, refused: 'not_registered', issues: ['birth_not_registered'] }
  const { record } = REGISTRY.get(handle.token)
  const observed = observer(record.pid)
  const compare = compareRecord2(record, observed)
  if (!compare.ok) return { sent: false, refused: observed.state === 'unknown' ? 'unknown_observation' : 'identity_not_fresh', issues: compare.issues, observed }
  try {
    process.kill(record.pid, signal)
    return { sent: true, signal, observedAt: new Date().toISOString(), observed: { pid: observed.pid, start: observed.start, uid: observed.uid, ppid: observed.ppid } }
  } catch (error) {
    return { sent: false, refused: String(error?.code ?? error), issues: [] }
  }
}

/** Gone requires the owned child exit event or a definite ps not-found; unknown is not gone. */
export async function waitGone(handle, timeoutMs = 3000, observer = observeProcess) {
  if (!REGISTRY.has(handle?.token)) return { gone: false, refused: 'not_registered' }
  const { child, record } = REGISTRY.get(handle.token)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return { gone: true, via: 'child_exit', code: child.exitCode, signal: child.signalCode }
    const observed = observer(record.pid)
    if (observed.state === 'gone') return { gone: true, via: 'ps_not_found' }
    if (observed.state === 'unknown') return { gone: false, unknown: true, reason: observed.reason }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  return { gone: false, timedOut: true }
}

export function unregister(handle) {
  if (REGISTRY.has(handle?.token)) REGISTRY.delete(handle.token)
}

export function pureControls(handle) {
  const { record } = REGISTRY.get(handle.token)
  const alive = observeProcess(record.pid)
  const plain = { ...record }
  const forged = (patch) => ({ ...record, ...patch })
  return [
    { id: 'own_handle', result: compareRecord2(record, alive), expected: true },
    { id: 'plain_record_rejected', signal: signalFresh({ handle: plain, signal: 'SIGTERM' }), expectedRefusal: 'not_registered' },
    { id: 'missing_birth', result: compareRecord2(forged({ birth: undefined }), alive), expected: false },
    { id: 'missing_argv', result: compareRecord2(forged({ argv: undefined }), alive), expected: false },
    { id: 'prefix_root', result: compareRecord2(forged({ root: `${record.root}-sibling` }), alive), expected: false },
    { id: 'prefix_operation', result: compareRecord2(forged({ operation: `${record.operation}-sibling` }), alive), expected: false },
    { id: 'foreign_uid', result: compareRecord2(forged({ uid: record.uid + 1 }), alive), expected: false },
    { id: 'recycled_start', result: compareRecord2(forged({ start: 'Thu Jan  1 00:00:00 1970' }), alive), expected: false },
    { id: 'sibling_pid', result: compareRecord2(forged({ pid: record.pid + 1 }), alive), expected: false },
    { id: 'ps_unknown', signal: signalFresh({ handle, signal: 'SIGTERM', observer: () => ({ state: 'unknown', reason: 'ps_failed' }) }), expectedRefusal: 'unknown_observation' },
  ]
}

export function classifyFixtures() {
  return {
    alive: classifyPs({ status: 0, stdout: '10 1 501 Sun Nov 15 10:00:00 2026 /usr/bin/node fixture\n', stderr: '' }),
    gone: classifyPs({ status: 1, stdout: '', stderr: 'ps: No such process' }),
    unknownPermission: classifyPs({ status: 1, stdout: '', stderr: 'ps: permission denied' }),
    unknownParse: classifyPs({ status: 0, stdout: 'not-a-ps-line\n', stderr: '' }),
  }
}
