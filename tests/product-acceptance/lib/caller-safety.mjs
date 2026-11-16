/**
 * Caller-level ownership for probe operations.
 *
 * A caller that starts a packaged process owns *an operation*: the immutable birth facts of every
 * process it caused, the roots/config/state/Node/model/mock materials that operation uses, and the
 * signals it sent. Deleting any of those materials is only allowed after every known process has been
 * re-observed with its exact original identity and has exited, and only when the operation was never
 * marked UNKNOWN. A failed assertion, a thrown status/stop error, a refused stop or a timeout marks the
 * operation UNKNOWN: the whole material set is retained for later diagnosis, no process is signalled by
 * inference, and the parent's exit is never used to infer a child's.
 *
 * There is deliberately no `force`, `cleanupAll`, `discover` or `killByPath` entry.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { liveIdentity, sha256 } from './packaged-instance.mjs'

/** One immutable birth record: identity plus the roots and operation that bind it. */
export function resourceBirth(pid, { root, config = null, state = null, op = null, parentPid = null, role = 'process' } = {}) {
  const live = liveIdentity(pid)
  if (!live.alive && live.start === null) return { pid, start: null, uid: null, argv: null, argvSha256: null, aliveAtBirth: false, root, config, state, op, parentPid, role }
  return { pid, start: live.start, uid: live.uid, ppid: live.ppid, argv: live.command,
    argvSha256: sha256(live.command ?? ''), aliveAtBirth: live.alive === true, root, config, state, op, parentPid, role }
}

/** Independent re-observation of one birth record; never discovers anything. */
export function observeBirth(entry) {
  const live = liveIdentity(entry.pid)
  const argvSha256 = live.alive ? sha256(live.command ?? '') : null
  const sameIdentity = live.alive && entry.start !== null && live.start === entry.start &&
    live.uid === entry.uid && argvSha256 === entry.argvSha256
  return {
    pid: entry.pid, expectedStart: entry.start, expectedUid: entry.uid ?? null, expectedArgvSha256: entry.argvSha256 ?? null,
    alive: live.alive, observedStart: live.start ?? null, observedUid: live.uid ?? null, observedPpid: live.ppid ?? null,
    observedArgvSha256: argvSha256, sameIdentity, query: 'ps', queryOk: live.alive ? live.start !== null : true,
    observation: 'independent-ps',
  }
}

/**
 * The set is complete only if every member has the facts a later signal/observation needs. A record
 * that cannot say start/uid/argv is UNKNOWN, not a smaller proven set.
 */
export function resourceSetComplete(set) {
  if (!Array.isArray(set) || set.length === 0) return false
  const pids = new Set()
  for (const entry of set) {
    if (!entry || !Number.isSafeInteger(entry.pid) || entry.pid <= 0) return false
    if (pids.has(entry.pid)) return false
    pids.add(entry.pid)
    if (typeof entry.start !== 'string' || entry.start.length === 0) return false
    if (!Number.isSafeInteger(entry.uid)) return false
    if (typeof entry.argv !== 'string' || entry.argv.length === 0) return false
    if (!/^[a-f0-9]{64}$/u.test(String(entry.argvSha256 ?? ''))) return false
  }
  return true
}

export function createOperation({ id }) {
  const births = new Map()
  const materials = []
  let retained = null
  const signals = []
  const failures = []

  const operation = {
    id,
    /** Adds a birth record. A duplicate pid or a record without immutable identity is refused. */
    track(entry) {
      if (!entry || !Number.isSafeInteger(entry.pid) || entry.pid <= 0) throw new Error('invalid pid')
      const existing = births.get(entry.pid)
      if (existing) {
        // Same pid+start+uid is the same process lineage. The packaged launcher execs in place, so its
        // argv may legitimately change; keep both digests instead of inventing a second process.
        if (existing.start === entry.start && existing.uid === entry.uid) {
          if (existing.argvSha256 !== entry.argvSha256) {
            existing.argvHistory = [...(existing.argvHistory ?? [existing.argvSha256]), entry.argvSha256]
            existing.argv = entry.argv
            existing.argvSha256 = entry.argvSha256
          }
          return existing
        }
        throw new Error(`duplicate pid ${entry.pid} with a different start identity`)
      }
      if (typeof entry.start !== 'string' || entry.start.length === 0) throw new Error(`pid ${entry.pid} has no stable start`)
      if (!Number.isSafeInteger(entry.uid)) throw new Error(`pid ${entry.pid} has no uid`)
      if (typeof entry.argv !== 'string' || entry.argv.length === 0) throw new Error(`pid ${entry.pid} has no argv`)
      births.set(entry.pid, entry)
      return entry
    },
    /** Registers a private material directory that this operation created and still uses. */
    addMaterial(path, kind = 'root') {
      if (typeof path !== 'string' || path.length === 0) throw new Error('invalid material path')
      if (!materials.some(item => item.path === path)) materials.push({ path, kind })
      return path
    },
    get materials() { return materials.map(item => ({ ...item })) },
    get births() { return [...births.values()].map(item => ({ ...item })) },
    get signals() { return signals.map(item => ({ ...item })) },
    get failures() { return [...failures] },
    get retained() { return retained === null ? null : { ...retained } },
    isComplete() { return resourceSetComplete(operation.births) },
    /** Sticky UNKNOWN: once set, no release can happen in this process. */
    retain(reason) {
      if (retained === null) retained = { reason: String(reason ?? 'unknown'), at: new Date().toISOString() }
      return retained
    },
    fail(stage, error) { failures.push({ stage, error: String(error?.message ?? error).slice(0, 400) }) },
    observe() { return operation.births.map(observeBirth) },
    /**
     * Whole-set freshness: every known birth must be re-observable now. A live process must still match
     * its start/uid/argv; a dead one is an exited member, not an unknown. Any mismatch blocks every
     * effect of the operation until a human resolves it.
     */
    preflightAll() {
      const observation = operation.observe()
      const issues = []
      for (const row of observation) {
        if (row.queryOk !== true) issues.push(`query:${row.pid}`)
        if (row.alive === true && row.sameIdentity !== true) issues.push(`identity:${row.pid}`)
        if (row.alive === false && row.observedStart !== null) issues.push(`exited_fields:${row.pid}`)
      }
      return { ok: issues.length === 0, issues, observation }
    },
    /**
     * Targeted descendant check for the set: a child born after capture is an unknown related
     * resource. Only known pids are queried (`pgrep -P`), never a global listing.
     */
    lateDescendants() {
      const known = new Set(operation.births.map(item => item.pid))
      const late = []
      for (const pid of known) {
        try {
          const out = spawnSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5_000 })
          for (const line of String(out.stdout ?? '').split('\n').map(item => item.trim()).filter(Boolean)) {
            const child = Number(line)
            if (Number.isSafeInteger(child) && !known.has(child)) late.push({ parent: pid, pid: child })
          }
        } catch { /* no children */ }
      }
      return late
    },
    /** A signal needs the whole set preflighted and this pid's identity re-read immediately before. */
    signal(pid, signal = 'SIGTERM') {
      const entry = births.get(pid)
      if (!entry) return { pid, signalled: null, refused: 'not_owned' }
      if (retained !== null) return { pid, signalled: null, refused: 'operation_unknown' }
      if (!operation.isComplete()) return { pid, signalled: null, refused: 'incomplete_set' }
      const all = operation.preflightAll()
      if (all.ok !== true) return { pid, signalled: null, refused: 'set_not_fresh', issues: all.issues }
      const late = operation.lateDescendants()
      if (late.length > 0) return { pid, signalled: null, refused: 'late_child', late }
      const fresh = observeBirth(entry)
      if (!fresh.sameIdentity) return { pid, signalled: null, refused: fresh.alive ? 'identity_changed' : 'not_alive', fresh }
      try {
        process.kill(pid, signal)
        signals.push({ pid, signal, at: new Date().toISOString(), fresh })
        return { pid, signalled: signal }
      } catch (error) {
        return { pid, signalled: null, refused: `kill_failed:${error.code ?? 'unknown'}`, fresh }
      }
    },
    /**
     * Release is authorised only by a complete set observed exited. Unknown, missing set, retained
     * material, duplicates or a mismatched observation all deny it.
     */
    releaseAllowed(observation = operation.observe()) {
      if (retained !== null) return { allowed: false, reason: 'operation_unknown' }
      const late = operation.lateDescendants()
      if (late.length > 0) return { allowed: false, reason: 'late_child', late }
      if (!operation.isComplete()) return { allowed: false, reason: 'incomplete_set' }
      if (observation.length !== births.size) return { allowed: false, reason: 'observation_missing' }
      const observedPids = observation.map(row => row?.pid)
      if (new Set(observedPids).size !== observation.length) return { allowed: false, reason: 'duplicate_observation' }
      for (const pid of observedPids) if (!births.has(pid)) return { allowed: false, reason: 'foreign_observation' }
      for (const row of observation) {
        const entry = births.get(row.pid)
        if (!entry) return { allowed: false, reason: 'foreign_observation' }
        if (row.expectedStart !== entry.start) return { allowed: false, reason: 'expected_start_mismatch' }
        if (row.queryOk !== true) return { allowed: false, reason: 'query_failed' }
        if (row.alive === true) return { allowed: false, reason: 'resource_alive' }
        if (row.alive === false && row.sameIdentity === true) return { allowed: false, reason: 'contradictory_observation' }
      }
      return { allowed: true, reason: null }
    },
    /** Deletes the whole material set only when release is authorised. */
    release({ observation } = {}) {
      const rows = observation ?? operation.observe()
      const verdict = operation.releaseAllowed(rows)
      if (!verdict.allowed) return { released: [], retained: operation.materials, verdict, observation: rows }
      const released = []
      for (const item of operation.materials) {
        try { rmSync(item.path, { recursive: true, force: true }); released.push(item.path) } catch (error) { return { released, retained: operation.materials, verdict: { ...verdict, error: String(error?.message ?? error) }, observation: rows } }
      }
      materials.length = 0
      return { released, retained: [], verdict, observation: rows }
    },
    /** Retains everything and reports the paths a later diagnostic needs. */
    retainAll(reason) {
      operation.retain(reason)
      return { retained: operation.materials, reason: retained.reason, birth: operation.births, observation: operation.observe() }
    },
    materialExists() {
      return operation.materials.map(item => ({ ...item, exists: existsSync(item.path) }))
    },
  }
  return operation
}

/**
 * Captures the complete immutable set for a caller's cohort phase. `pids` must be every process the
 * product record names at this moment; nothing is discovered and a dead pid cannot be captured.
 */
export function captureSet(pids, { root, config = null, state = null, op, roles = {} } = {}) {
  return pids.map(pid => resourceBirth(pid, { root, config, state, op, parentPid: null, role: roles[pid] ?? 'product' }))
}

/** Independent post-set rows for evidence and for the release decision. */
export function rollout(set) {
  return set.map(observeBirth)
}

/**
 * Pure oracle for a pre/post resource mapping. Returns issue codes; an empty array is quiescence of
 * exactly the captured set. Cardinality, uniqueness, missing start/uid/argv, foreign pids, duplicates,
 * unobserved rows and any still-alive identity are all issues.
 */
export function resourceRowsIssues(before, after) {
  const issues = []
  if (!Array.isArray(before) || before.length === 0) return ['before_empty']
  const seen = new Set()
  for (const [index, entry] of before.entries()) {
    if (!entry || !Number.isSafeInteger(entry.pid) || entry.pid <= 0) { issues.push(`before_pid:${index}`); continue }
    if (seen.has(entry.pid)) issues.push(`before_duplicate:${index}`)
    seen.add(entry.pid)
    if (typeof entry.start !== 'string' || entry.start.length === 0) issues.push(`before_start:${index}`)
    if (!Number.isSafeInteger(entry.uid)) issues.push(`before_uid:${index}`)
    if (typeof entry.argv !== 'string' || entry.argv.length === 0) issues.push(`before_argv:${index}`)
    if (!/^[a-f0-9]{64}$/u.test(String(entry.argvSha256 ?? ''))) issues.push(`before_argv_sha:${index}`)
    if (typeof entry.root !== 'string' || entry.root.length === 0) issues.push(`before_root:${index}`)
    if (typeof entry.op !== 'string' || entry.op.length === 0) issues.push(`before_op:${index}`)
  }
  if (!Array.isArray(after)) return [...issues, 'after_missing']
  if (after.length !== before.length) issues.push('after_cardinality')
  const seenAfter = new Set()
  for (const [index, row] of after.entries()) {
    const entry = before[index]
    if (!row || typeof row !== 'object') { issues.push(`after_row:${index}`); continue }
    if (!Number.isSafeInteger(row.pid) || row.pid !== entry?.pid) { issues.push(`after_pid:${index}`); continue }
    if (seenAfter.has(row.pid)) issues.push(`after_duplicate:${index}`)
    seenAfter.add(row.pid)
    if (row.expectedStart !== entry?.start) issues.push(`after_expected_start:${index}`)
    if (row.expectedUid !== entry?.uid) issues.push(`after_expected_uid:${index}`)
    if (row.expectedArgvSha256 !== entry?.argvSha256) issues.push(`after_expected_argv:${index}`)
    if (typeof row.alive !== 'boolean' || typeof row.sameIdentity !== 'boolean') { issues.push(`after_boolean:${index}`); continue }
    if (row.query !== 'ps' || row.queryOk !== true) issues.push(`after_query:${index}`)
    if (row.alive === true) {
      issues.push(`after_alive:${index}`)
      const expectedSame = row.observedStart === entry?.start && row.observedUid === entry?.uid &&
        row.observedArgvSha256 === entry?.argvSha256
      if (row.sameIdentity !== expectedSame) issues.push(`after_same_identity:${index}`)
    } else {
      if (row.sameIdentity !== false) issues.push(`after_exited_identity:${index}`)
      if (row.observedStart !== null || row.observedUid !== null || row.observedArgvSha256 !== null) issues.push(`after_exited_fields:${index}`)
    }
  }
  return issues
}
