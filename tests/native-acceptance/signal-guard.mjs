#!/usr/bin/env node
/**
 * Wave-31 B1: spawn-intent authority, not a ps snapshot.
 *
 * A pid is never ownership. Ownership starts at the spawner: `spawnOwned` (or `adoptSpawn` for a child
 * the caller spawned elsewhere) records the immutable spawn intent (executable + ordered argv + the
 * declared root/config/operation and the complete child resource plan) and returns an opaque handle.
 * Every verification re-reads the live process and compares it with THAT intent: full argv must match
 * token-for-token, uid/start/ppid must match, and the whole declared child set must match. A copied,
 * edited, partial-argv or unregistered record has no authority. ps failure is UNKNOWN, never exit.
 *
 * Dependencies (spawn/ps/kill) are injectable so the pure controls never touch a live process.
 */
import { randomUUID } from 'node:crypto'
import { ChildProcess, spawn as realSpawn, spawnSync } from 'node:child_process'

const PS_FIELDS = '-o pid=,uid=,ppid=,lstart=,command='

const realDeps = {
  spawn: realSpawn,
  ps: (pid) => {
    const result = spawnSync('/bin/ps', [PS_FIELDS, '-p', String(pid)], { encoding: 'utf8' })
    const stdout = (result.stdout ?? '').trim()
    const stderr = String(result.stderr ?? '')
    if (result.error) return { state: 'unknown', reason: 'ps_error', detail: String(result.error.message ?? result.error) }
    if (result.status !== 0) {
      if (/no such process|no matching process|nonexistent/i.test(stderr)) return { state: 'gone', reason: 'no_such_process' }
      if (stdout.length === 0 && stderr.trim().length === 0) return { state: 'gone', reason: 'silent_absence' }
      return { state: 'unknown', reason: 'ps_failed', detail: stderr.trim().slice(0, 200) }
    }
    if (stdout.length === 0) return { state: 'gone', reason: 'empty_output' }
    const match = /^(\d+)\s+(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(.*)$/.exec(stdout)
    if (!match) return { state: 'unknown', reason: 'unparseable', raw: stdout.slice(0, 200) }
    return { state: 'live', pid: Number(match[1]), uid: Number(match[2]), ppid: Number(match[3]), start: match[4], argv: match[5] }
  },
  pgrep: (pid) => {
    const result = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
    if (result.error) return { state: 'unknown', reason: 'children_unreadable' }
    const stdout = String(result.stdout ?? '').trim()
    if (result.status === 1 && stdout.length === 0) return { state: 'ok', children: [] }
    if (result.status !== 0) return { state: 'unknown', reason: 'children_unreadable' }
    return { state: 'ok', children: stdout.split('\n').map(line => Number(line.trim())).filter(Number.isSafeInteger) }
  },
  kill: (pid, signal) => process.kill(pid, signal),
}

let deps = { ...realDeps }
/** Test-only injection; production callers never re-configure the tool. */
export function configureSignalGuard(overrides = {}) {
  deps = { ...realDeps, ...overrides }
}
export function resetSignalGuard() { deps = { ...realDeps } }

/** Opaque handle registry: the handle id (not the record) is the capability. */
const registry = new Map()
const deepFreeze = value => { if (value && typeof value === 'object') { Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]) } return value }
const tokens = argv => argv.split(/\s+/).filter(Boolean)
const sameTokens = (a, b) => a.length === b.length && a.every((token, index) => token === b[index])

function snapshot(pid) {
  const live = deps.ps(pid)
  if (!live || typeof live !== 'object') return { state: 'unknown', reason: 'ps_failed' }
  return live
}

function registerIntent(pid, intent) {
  const plan = intent.expectedChildren
  if (!Array.isArray(plan)) return { ok: false, unknown: 'no_resource_plan' }
  const live = snapshot(pid)
  if (live.state !== 'live') return { ok: false, unknown: live.reason ?? live.state, live }
  const intended = tokens(intent.argv.join(' '))
  if (intended.length === 0) return { ok: false, unknown: 'no_spawn_argv' }
  const observed = tokens(live.argv ?? '')
  // Full ordered argv: a partial prefix, a sibling command or a single node token is not this spawn.
  if (!sameTokens(observed, intended)) return { ok: false, unknown: 'argv_mismatch', observed, intended }
  const record = deepFreeze({
    kind: 'probe-spawn',
    pid: live.pid, uid: live.uid, ppid: live.ppid, start: live.start, argv: live.argv,
    argvTokens: intended,
    executable: intent.executable,
    root: intent.root ?? null, config: intent.config ?? null, operation: intent.operation ?? null,
    expectedChildren: [...plan],
    capturedAt: new Date().toISOString(),
  })
  const handleId = randomUUID()
  const handle = Object.freeze({ handleId, record })
  registry.set(handleId, { handle, record, deps })
  return { ok: true, handle, record }
}

/** Spawn a process this probe owns and register its immutable spawn intent. */
/** Private provenance: a spawn capability is issued only by the factory that performed the spawn. */
function issueSpawn(store, spawnFn, executable, args, intent = {}) {
  // Resolve the spawner at call time so a configured test factory replaces it deterministically.
  const child = (spawnFn ?? deps.spawn)(executable, args, intent.spawnOptions ?? { stdio: ['ignore', 'pipe', 'pipe'] })
  if (!child || !Number.isSafeInteger(child.pid)) return { ok: false, unknown: 'spawn_failed', child }
  const argv = [executable, ...args]
  for (const [name, value] of [['root', intent.root], ['config', intent.config], ['operation', intent.operation]]) {
    if (value !== undefined && value !== null && !argv.includes(value)) return { ok: false, unknown: `spawn_${name}_not_in_argv`, child }
  }
  const registered = registerIntent(child.pid, {
    executable, argv,
    ...(intent.root === undefined ? {} : { root: intent.root }),
    ...(intent.config === undefined ? {} : { config: intent.config }),
    ...(intent.operation === undefined ? {} : { operation: intent.operation }),
    ...(intent.expectedChildren === undefined ? {} : { expectedChildren: intent.expectedChildren }),
  })
  if (!registered.ok) return { ...registered, child }
  // Immutable birth record: every later re-adoption must match these exact identity fields, not take a
  // fresh ps snapshot as a new birth.
  const birth = deepFreeze(structuredClone({
    pid: registered.record.pid, uid: registered.record.uid, ppid: registered.record.ppid,
    start: registered.record.start, argvTokens: registered.record.argvTokens,
    executable: registered.record.executable, record: registered.record,
  }))
  store.set(child, birth)
  return { ...registered, child, argv }
}

function adoptWithProvenance(store, childOrPid, intent = {}) {
  if (!childOrPid || typeof childOrPid !== 'object') return { ok: false, unknown: 'numeric_pid_not_accepted' }
  const birth = store.get(childOrPid)
  // No provenance means this factory never spawned this object: a plain object, a copied ChildProcess,
  // Object.create(ChildProcess.prototype), new ChildProcess() and a foreign process all fail here.
  if (!birth) return { ok: false, unknown: 'foreign_spawn' }
  // The public child.pid is not authority: mutating it must not retarget the immutable birth.
  if (childOrPid.pid !== birth.pid) return { ok: false, unknown: 'pid_mutated' }
  const live = snapshot(birth.pid)
  if (live.state === 'unknown') return { ok: false, unknown: live.reason ?? 'unreadable', live }
  if (live.state === 'gone') return { ok: false, unknown: 'already_gone', live }
  // Re-adoption never renews the birth: the fresh identity must equal the stored birth exactly.
  const birthMismatch = live.uid !== birth.uid || live.start !== birth.start || live.ppid !== birth.ppid ||
    !sameTokens(tokens(live.argv ?? ''), birth.argvTokens)
  if (birthMismatch) return { ok: false, unknown: 'birth_mismatch', live }
  if (Array.isArray(intent.argv) && !sameTokens(intent.argv, birth.argvTokens)) return { ok: false, unknown: 'intent_differs_from_spawn' }
  if (typeof intent.executable === 'string' && intent.executable !== birth.executable) return { ok: false, unknown: 'intent_differs_from_spawn' }
  for (const [name, value] of [['root', intent.root], ['config', intent.config], ['operation', intent.operation]]) {
    if (value !== undefined && value !== null && !birth.argvTokens.includes(value)) return { ok: false, unknown: `spawn_${name}_not_in_argv` }
  }
  const registered = registerIntent(birth.pid, {
    executable: birth.executable, argv: birth.argvTokens.slice(),
    ...(birth.record.root === null ? {} : { root: birth.record.root }),
    ...(birth.record.config === null ? {} : { config: birth.record.config }),
    ...(birth.record.operation === null ? {} : { operation: birth.record.operation }),
    ...(intent.expectedChildren === undefined ? { expectedChildren: birth.record.expectedChildren } : { expectedChildren: intent.expectedChildren }),
  })
  return registered.ok ? { ...registered, child: childOrPid } : registered
}

/**
 * An explicit original factory. Only children returned by THIS factory's `spawn` can be adopted by it;
 * the provenance WeakMap is private, so an external ChildProcess cannot be recollected into authority.
 */
function lookup(handle) {
  if (!handle || typeof handle !== 'object') return null
  const entry = registry.get(handle.handleId)
  // The capability is the exact frozen handle object, not the id/record it carries.
  if (!entry || entry.handle !== handle) return null
  return { ok: true, ...entry }
}

export function createSpawnFactory(spawnFn) {
  const store = new WeakMap()
  return Object.freeze({
    spawn: (executable, args, intent = {}) => issueSpawn(store, spawnFn, executable, args, intent),
    adopt: (childOrPid, intent = {}) => adoptWithProvenance(store, childOrPid, intent),
  })
}

const defaultFactory = createSpawnFactory()

/** Spawn through the module's default factory and return its capability for that child. */
export function spawnOwned(executable, args, intent = {}) {
  return defaultFactory.spawn(executable, args, intent)
}

/** Adopt only a child this module's default factory itself spawned; numeric/plain/foreign are refused. */
export function adoptSpawn(childOrPid, intent = {}) {
  return defaultFactory.adopt(childOrPid, intent)
}

export function observe(pid) {
  const live = snapshot(pid)
  return { ...live, alive: live.state === 'live' }
}

/** Re-read the live process and compare it with the registered spawn intent. */
export function verify(handle) {
  const owned = lookup(handle)
  if (!owned?.ok) return { ok: false, unknown: 'unknown_handle' }
  const record = owned.record
  const live = snapshot(record.pid)
  if (live.state === 'unknown') return { ok: false, unknown: live.reason ?? 'unreadable', live }
  if (live.state === 'gone') return { ok: false, unknown: 'already_gone', live }
  const mismatches = []
  if (live.uid !== record.uid) mismatches.push('uid')
  if (live.start !== record.start) mismatches.push('start')
  if (live.ppid !== record.ppid) mismatches.push('ppid')
  if (!sameTokens(tokens(live.argv ?? ''), record.argvTokens)) mismatches.push('argv')
  return { ok: mismatches.length === 0, mismatches, live }
}

/** The declared child set must match on EVERY signal, not only the first. */
export function verifyResources(handle) {
  const owned = lookup(handle)
  if (!owned?.ok) return { ok: false, unknown: 'unknown_handle' }
  const observed = deps.pgrep(owned.record.pid)
  if (observed.state !== 'ok') return { ok: false, unknown: observed.reason ?? 'children_unreadable' }
  const declared = [...owned.record.expectedChildren].sort((a, b) => a - b)
  const actual = [...observed.children].sort((a, b) => a - b)
  const ok = declared.length === actual.length && declared.every((pid, index) => pid === actual[index])
  return ok ? { ok: true, children: actual } : { ok: false, mismatches: [`children:${actual.join(',')}`], children: actual }
}

/** Signal ONLY after fresh spawn-intent + resource verification. */
export function signalOwned(handle, signal = 'SIGKILL') {
  const check = verify(handle)
  if (!check.ok) return { sent: false, refused: true, unknown: check.unknown ?? null, mismatches: check.mismatches ?? [], live: check.live ?? null }
  const resources = verifyResources(handle)
  if (!resources.ok) return { sent: false, refused: true, unknown: resources.unknown ?? 'resource_mismatch', mismatches: resources.mismatches ?? [], resources }
  try { deps.kill(check.live.pid, signal) } catch (error) { return { sent: false, refused: false, unknown: String(error?.code ?? error) } }
  return { sent: true, pid: check.live.pid, signal }
}

/** Wait for GONE. UNKNOWN at the deadline is retained, never reported as exit. */
export async function confirmExit(pid, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  let last = snapshot(pid)
  while (Date.now() < deadline) {
    last = snapshot(pid)
    if (last.state === 'gone') return { exited: true, observedAt: new Date().toISOString() }
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return last.state === 'gone'
    ? { exited: true, observedAt: new Date().toISOString() }
    : { exited: false, unknown: last.state === 'unknown' ? (last.reason ?? 'unreadable') : 'still_readable', live: last.state === 'live' ? last : null }
}

/** TERM, fresh spawn-intent check, then KILL only if the same intent still matches. */
export async function escalate(handle, { termWaitMs = 1500 } = {}) {
  const term = signalOwned(handle, 'SIGTERM')
  if (!term.sent) return { term, kill: null, exit: { exited: false, retained: term.unknown ?? 'refused' } }
  const first = await confirmExit(term.pid, termWaitMs)
  if (first.exited) return { term, kill: null, exit: first }
  const kill = signalOwned(handle, 'SIGKILL')
  const second = kill.sent ? await confirmExit(kill.pid, 5000) : { exited: false, unknown: kill.unknown ?? 'refused' }
  return { term, kill, exit: second }
}

/** Diagnostics only: how many live handles this tool retains. */
export const registrySize = () => registry.size
