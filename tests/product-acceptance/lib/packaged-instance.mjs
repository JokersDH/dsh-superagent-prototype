/**
 * Probe-owned packaged instance lifecycle.
 *
 * Every resource this module touches was born in a private temporary root created here. Cleanup is
 * *proven* cleanup: the packaged `pa stop` boundary runs first and its real result is read; our own
 * signalling only happens per process after a fresh start-identity, uid, exact-argv and root match.
 * Substring or sibling path matches, missing start identities, mixed known/unknown sets and stop
 * timeouts are retained as material, never force-killed and never "cleaned" by deleting the record.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync, writeSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const sha256 = value => createHash('sha256').update(value).digest('hex')

const trace = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[lifecycle] ${message}\n`) }

export function freePort() {
  return new Promise(resolvePort => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolvePort(port)) })
  })
}

export function parseJson(text) {
  const value = String(text ?? '').trim()
  try { return JSON.parse(value) } catch {
    try { return JSON.parse(value.split('\n').filter(Boolean).at(-1)) } catch { return undefined }
  }
}

/** One private root per run; install/config/state are absolute and never shared with a user instance. */
export function privateRoot(prefix = 'pa-e-instance-') {
  const own = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  const root = { own, install: join(own, 'install'), config: join(own, 'config'), state: join(own, 'state') }
  // The package refuses a private config/state root that other users can read.
  mkdirSync(root.install, { recursive: true })
  mkdirSync(root.config, { recursive: true, mode: 0o700 })
  mkdirSync(root.state, { recursive: true, mode: 0o700 })
  return root
}

/** Extracts the frozen tar only after the tar bytes match their recorded identity. */
export function extractFrozen(target, install) {
  const bytes = readFileSync(target.tarPath)
  if (sha256(bytes) !== target.tarSha256 || bytes.byteLength !== target.tarBytes)
    throw new Error(`frozen tar identity mismatch for ${target.name ?? target.tarPath}`)
  const extracted = spawnSync('tar', ['-xzf', target.tarPath, '-C', install, '--strip-components=1'])
  if (extracted.status !== 0) throw new Error(`tar extract failed: ${String(extracted.stderr).slice(-300)}`)
  return { tarSha256: target.tarSha256, tarBytes: target.tarBytes }
}

export function launcher(install, args, { env = {}, timeoutMs = 90_000, nodePath = null } = {}) {
  const result = spawnSync(join(install, 'bin/pa'), args, {
    cwd: dirname(install), encoding: 'utf8', timeout: timeoutMs,
    env: { ...process.env, PA_NODE: nodePath ?? process.execPath, ...env },
  })
  return { status: result.status, json: parseJson(result.stdout), stderr: String(result.stderr).slice(-600), stdout: String(result.stdout).slice(-600) }
}

function ps(pid, field) {
  // `-ww` prevents ps from truncating a long argv at the terminal width; a truncated command line
  // cannot prove an exact path match.
  try { return String(execFileSync('ps', ['-ww', '-p', String(pid), '-o', `${field}=`], { encoding: 'utf8' })).trim() } catch { return null }
}

/** Independent live facts for one pid: never inferred from the instance record itself. */
export function liveIdentity(pidValue) {
  const pid = Number(pidValue)
  if (!Number.isSafeInteger(pid) || pid <= 0) return { pid: pidValue ?? null, alive: false }
  let alive = false
  try { process.kill(pid, 0); alive = true } catch (error) { alive = error.code === 'EPERM' }
  const stat = ps(pid, 'stat')
  if (alive && stat && stat.toUpperCase().startsWith('Z')) alive = false
  if (!alive) return { pid, alive: false, start: null, uid: null, ppid: null, command: null }
  const ppid = Number(ps(pid, 'ppid'))
  return { pid, alive: true, start: ps(pid, 'lstart'), uid: Number(ps(pid, 'uid')), ppid: Number.isSafeInteger(ppid) ? ppid : null, command: ps(pid, 'args') }
}

/** Path-prefix match at a `/` boundary: `<dir>/x` matches, `<dir>-sibling` never does. */
export function argvHasPathPrefix(command, dir) {
  if (typeof command !== 'string' || command.length === 0) return false
  const escaped = dir.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}(?:[/\\s]|$)`, 'u').test(command)
}

/** Exact-token match: a sibling path such as `<root>-sibling` never matches `<root>`. */
export function argvHasExactPath(command, path) {
  if (typeof command !== 'string' || command.length === 0) return false
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, 'u').test(command)
}

/**
 * The pre-stop known set: caller-supplied resources plus every pid the record names at this moment,
 * each with its independent live start. Captured before any package stop so a deleted record can
 * never be read as "nothing was running".
 */
function captureKnownSet(config, { resources = null } = {}) {
  const record = readRecord(config)
  const value = record.value ?? null
  const set = new Map()
  for (const item of Array.isArray(resources) ? resources : []) {
    if (Number.isSafeInteger(item.pid)) set.set(item.pid, { pid: item.pid, start: item.start ?? null, parentPid: item.parentPid ?? null, source: 'caller' })
  }
  const recorded = value ? [value.pid, value.apiPid, value.consolePid].filter(Number.isSafeInteger) : []
  for (const pid of recorded) {
    if (set.has(pid)) continue
    const live = liveIdentity(pid)
    set.set(pid, { pid, start: live.alive ? live.start : null, parentPid: pid === value.pid ? null : value.pid, source: 'record' })
  }
  return { present: record.present, hadRecord: record.present, set: [...set.values()] }
}

/** Independent observation of a fixed set: each pid is re-read by pid and start, never discovered. */
function observeFixedSet(set) {
  return set.map(item => {
    const live = liveIdentity(item.pid)
    return { pid: item.pid, expectedStart: item.start, alive: live.alive, start: live.start ?? null,
      uid: live.uid ?? null, sameIdentity: live.alive && live.start === item.start, source: item.source }
  })
}

function recordPath(config) { return join(config, 'instance.json') }

export function readRecord(config) {
  const path = recordPath(config)
  if (!existsSync(path)) return { present: false }
  try {
    const text = readFileSync(path, 'utf8')
    return { present: true, path, value: JSON.parse(text), sha256: sha256(text), bytes: Buffer.byteLength(text) }
  } catch (error) { return { present: true, path, error: String(error?.message ?? error), sha256: sha256(readFileSync(path)) } }
}

/**
 * Starts one packaged instance and records independent birth facts *before* any readiness wait.
 * A timeout or early exit returns `unknown` with the birth facts and the retained root, never a
 * silent success and never a deleted record.
 */
export function startOwned(root, {
  ports, mockFile, extraArgs = ['--discussion-only'], fixture = false, timeoutMs = 90_000, bin, nodePath = null,
} = {}) {
  const install = root.install, config = root.config, state = root.state
  const [consolePort, apiPort] = ports ?? []
  const args = ['start', '--json', '--port', String(consolePort), '--api-port', String(apiPort), ...extraArgs]
  if (fixture) args.push('--fixture')
  const binPath = bin ?? join(install, 'bin/pa')
  const env = { ...process.env, PA_NODE: nodePath ?? process.execPath, ...(mockFile ? { PA_MODEL_CONFIG: mockFile } : {}), PA_CONFIG_ROOT: config, PA_DATA_ROOT: state }
  const child = spawn(binPath, args, { cwd: dirname(install), stdio: ['ignore', 'pipe', 'pipe'], env })
  // Birth facts are taken now, before any RUNNING/health wait and before the child can be reaped.
  const birth = {
    pid: child.pid ?? null,
    start: child.pid ? ps(child.pid, 'lstart') : null,
    uid: child.pid ? Number(ps(child.pid, 'uid')) : null,
    argv: child.pid ? ps(child.pid, 'args') : null,
    install, state, config, consolePort: consolePort ?? null, apiPort: apiPort ?? null,
    argvExact: child.pid ? null : null, recordedAt: new Date().toISOString(),
  }
  birth.argvExact = argvHasExactPath(birth.argv ?? '', install) && argvHasExactPath(birth.argv ?? '', state)
  trace(`spawn pid=${birth.pid} start=${birth.start} uid=${birth.uid} exact=${birth.argvExact}`)
  child.stdout.on('data', () => {})
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  let buffer = ''
  const value = new Promise(resolvePromise => {
    let settled = false
    const finish = payload => { if (!settled) { settled = true; resolvePromise({ ...payload, stderr: stderr.slice(-1200), birth }) } }
    const timer = setTimeout(() => finish({ status: 'TIMEOUT' }), timeoutMs)
    child.stdout.on('data', chunk => {
      buffer += chunk
      const text = buffer.trim()
      if (!text.endsWith('}')) return
      try { const json = JSON.parse(text); clearTimeout(timer); finish({ ...json }) } catch { /* buffering */ }
    })
    child.once('exit', code => { clearTimeout(timer); finish({ status: 'EXITED', code }) })
    child.once('error', error => { clearTimeout(timer); finish({ status: 'SPAWN_ERROR', code: null, error: String(error?.message ?? error) }) })
  })
  return { child, value, birth }
}

/**
 * Stops one probe-owned instance.
 *
 * 1. The packaged `pa stop --json` runs with the exact install/config/state and its result is read.
 * 2. If it refused or timed out, nothing is force-killed and the record plus the whole root stay.
 * 3. `proofSignal` (only when explicitly allowed) signals one pid at a time and re-reads the start
 *    identity immediately before each TERM/KILL; every attempt is recorded.
 */
export async function stopOwned(root, { mockFile, birth = null, resources = null, packageStop = true, proofSignal = false, equivalentProof = false, timeoutMs = 30_000, nodePath = null } = {}) {
  const finish = value => { trace(`stop ${root.state} -> clean=${value.clean} reason=${value.reason ?? null} blocked=${JSON.stringify(value.blocked ?? null).slice(0, 160)} pkg=${value.packageStop?.json?.status ?? null}`); return value }
  const { install, config, state } = root
  const result = { install, state, config, attempts: [], signals: [], packageStop: null, record: null, clean: false, retained: false }
  // The set is fixed before any signal, so a deleted record cannot later masquerade as an empty set.
  const preStop = captureKnownSet(config, { resources })
  result.preStopSet = preStop.set
  if (packageStop) {
    const stopped = launcher(install, ['stop', '--json'], {
      timeoutMs,
      env: { ...(mockFile ? { PA_MODEL_CONFIG: mockFile } : {}), PA_CONFIG_ROOT: config, PA_DATA_ROOT: state },
      nodePath,
    })
    result.packageStop = { status: stopped.status, json: stopped.json ?? null, stderr: stopped.stderr }
    const status = stopped.json?.status ?? null
    if (stopped.status === 0 && (status === 'STOPPED' || status === 'STOPPED_ORPHAN')) {
      result.record = readRecord(config)
      // A packaged STOPPED is the product's claim, not an observation of this probe's resources. The
      // pre-stop set (recorded pids + caller set, captured before the call) must be re-observed.
      // A known birth without the product's record and without a caller set is an incomplete set: an
      // empty observation of it is NOT quiescence and must never release the root.
      // A known operation without its complete fixed set is UNKNOWN even when the launcher already
      // exited: a dead parent never proves its children are static.
      const completeSet = preStop.hadRecord || (Array.isArray(resources) && resources.length > 0)
      if (birth !== null && !completeSet) {
        result.retained = true
        result.clean = false
        result.reason = 'resources_unverified'
        result.preStopSet = preStop.set
        return finish(result)
      }
      const observed = observeFixedSet(preStop.set)
      result.observedBeforePackage = observed
      const survivors = observed.filter(item => item.alive && item.sameIdentity === true)
      const unknown = observed.filter(item => item.alive && item.sameIdentity !== true)
      if (survivors.length > 0 || unknown.length > 0) {
        result.packageStopSawNoRecord = !result.record.present
        result.retained = true
        result.clean = false
        result.reason = unknown.length > 0 ? 'known_resource_identity_unknown' : 'known_resource_alive_after_package_stop'
        result.aliveAfter = survivors
        result.unknownResources = unknown
        // A live known resource may still be stopped, but only through the explicit immutable-set proof
        // and only when the caller asked for it; the packaged success never authorizes cleaning the root.
        if ((proofSignal || equivalentProof) && resources !== null) return finish(await stopKnownSet(root, { birth, resources, result }))
        return finish(result)
      }
      if (!result.record.present) result.packageStopSawNoRecord = true
      result.clean = true
      result.legitimateExit = observed.length > 0 ? true : undefined
      return finish(result)
    } else {
    trace(`package stop refused: ${JSON.stringify(result.packageStop).slice(0, 300)}`)
    // A refused packaged stop is first recorded as a product finding. Without an explicit
    // equivalent-proof request it is also the end of cleanup: keep record, processes and root.
    result.record = readRecord(config)
    result.packageRefusal = { status: stopped.json?.status ?? null, code: stopped.json?.code ?? null,
      failures: stopped.json?.detail?.failures ?? [], detail: stopped.json?.detail ?? null, exit: stopped.status }
    if (!equivalentProof) {
      result.retained = true
      result.reason = 'package_stop_refused'
      return finish(result)
      }
      // A single retry of the product's own stop: a just-finished write can leave the coordinator
      // briefly unverifiable. This re-invokes the product guard; it never bypasses it.
      await new Promise(resolvePromise => setTimeout(resolvePromise, 600))
      const retried = launcher(install, ['stop', '--json'], {
        timeoutMs,
        env: { ...(mockFile ? { PA_MODEL_CONFIG: mockFile } : {}), PA_CONFIG_ROOT: config, PA_DATA_ROOT: state },
      })
      const retryStatus = retried.json?.status ?? null
      if (retried.status === 0 && (retryStatus === 'STOPPED' || retryStatus === 'STOPPED_ORPHAN')) {
        result.packageStop = { status: retried.status, json: retried.json ?? null, stderr: retried.stderr, retried: true }
        result.record = readRecord(config)
        const completeSet = preStop.hadRecord || (Array.isArray(resources) && resources.length > 0)
        if (birth !== null && !completeSet) {
          result.retained = true; result.clean = false; result.reason = 'resources_unverified'; return finish(result)
        }
        const observed = observeFixedSet(preStop.set)
        result.observedBeforePackage = observed
        const survivors = observed.filter(item => item.alive && item.sameIdentity === true)
        const unknown = observed.filter(item => item.alive && item.sameIdentity !== true)
        if (survivors.length > 0 || unknown.length > 0) {
          result.packageStopSawNoRecord = !result.record.present
          result.retained = true; result.clean = false
          result.reason = unknown.length > 0 ? 'known_resource_identity_unknown' : 'known_resource_alive_after_package_stop'
          result.aliveAfter = survivors; result.unknownResources = unknown
          return finish(result)
        }
        result.clean = true
        return finish(result)
      }
      trace('package stop refused after retry; attempting equivalent independent proof')
    }
  }
  const record = readRecord(config)
  result.record = record
  const value = record.value
  if (!record.present) {
    if (!birth) {
      // The caller never registered a spawn with this tool, so no pid here can be attributed.
      result.clean = true
      return finish(result)
    }
    const lived = liveIdentity(birth.pid)
    if (lived.alive && (lived.start !== birth.start || lived.uid !== process.getuid?.())) {
      result.retained = true
      result.reason = 'birth_identity_mismatch'
      result.birthAlive = { pid: birth.pid, expectedStart: birth.start, observedStart: lived.start ?? null }
      return finish(result)
    }
    // No discovery and no default cleanup: only the caller's complete immutable set can authorize a
    // signal; an incomplete or unobservable set is retained as UNKNOWN.
    if (!proofSignal && !equivalentProof) { result.retained = true; result.reason = 'record_missing_known_birth'; return finish(result) }
    if (!Array.isArray(resources) || resources.length === 0) {
      // The birth is known but the fixed set was never captured: UNKNOWN, retained, no signal.
      result.retained = true
      result.reason = 'resources_unverified'
      return finish(result)
    }
    return finish(await stopKnownSet(root, { birth, resources, result }))
  }
  if (record.error || !value || typeof value !== 'object') {
    result.retained = true
    result.reason = 'unreadable_record'
    return finish(result)
  }
  // A tar install root holds `bin/` and `app/`; the product records the payload root (`app/`). The
  // request names the bin holder, so the payload root is what the record must match.
  const payloadInstall = existsSync(join(install, 'app')) ? join(install, 'app') : install
  const scope = {
    recordState: value.state ?? null, recordInstall: value.install ?? null,
    requestedState: state, requestedInstall: install, payloadInstall,
    stateMatches: value.state === state, installMatches: value.install === payloadInstall,
  }
  result.scope = scope
  if (!scope.stateMatches || !scope.installMatches) {
    result.retained = true
    result.reason = 'requested_root_mismatch'
    return finish(result)
  }
  // One pid is one process: a record that names the same pid twice (synthetic controls do) must not
  // produce a second, unprovable entry after the first signal.
  const entries = []
  const seen = new Set()
  for (const entry of [
    { label: 'launcher', pid: value.pid, expected: value.processStart, parent: null },
    { label: 'api', pid: value.apiPid, expected: value.apiProcessStart, parent: value.pid },
    ...(Number.isInteger(value.consolePid) ? [{ label: 'console', pid: value.consolePid, expected: value.consoleProcessStart, parent: value.pid }] : []),
  ]) {
    if (!Number.isInteger(entry.pid) || seen.has(entry.pid)) continue
    seen.add(entry.pid)
    entries.push(entry)
  }
  const live = entries.map(entry => ({ ...entry, ...liveIdentity(entry.pid) }))
  const gaps = live.filter(entry => entry.alive && (typeof entry.expected !== 'string' || entry.expected.length === 0 ||
    entry.start === null || entry.start !== entry.expected))
  result.attempts = live
  if (gaps.length > 0) {
    result.retained = true
    result.reason = 'unknown_live_resource'
    result.gaps = gaps.map(entry => ({ label: entry.label, pid: entry.pid, expected: entry.expected ?? null, observed: entry.start ?? null }))
    return finish(result)
  }
  const owned = live.filter(entry => entry.alive)
  if (owned.length === 0) { result.clean = true; return finish(result) }
  if (!proofSignal && !equivalentProof) { result.retained = true; result.reason = 'signal_not_allowed'; return finish(result) }
  // Independent ownership facts for one pid: recorded start == live start, our uid, an exact
  // (boundary-anchored) argv match to the payload install and requested state, and a recorded
  // parent-child relation for the coordinator/console children. A record alone is never enough.
  const proofFor = (entry, fresh) => {
    const argvInstall = argvHasPathPrefix(fresh.command ?? '', payloadInstall)
    const argvState = argvHasExactPath(fresh.command ?? '', state)
    const ppid = fresh.pid ? Number(ps(fresh.pid, 'ppid')) : null
    // A child whose recorded launcher already exited is re-parented; that is still this record's child,
    // proven by its own start/uid/argv. A live parent must match exactly.
    const parentOk = entry.parent === null ? true : ppid === entry.parent || !liveIdentity(entry.parent).alive
    // The launcher carries the roots in its environment, not its argv. Its state/root proof must come
    // from the birth record captured at spawn: identical pid/start and the same state/config/install
    // this request names. A record that self-claims another root cannot substitute for that.
    const birthBound = entry.parent === null && birth !== null && typeof birth === 'object'
    const birthOk = entry.parent === null
      ? birthBound && birth.pid === entry.pid && birth.start === entry.expected &&
        birth.state === state && birth.config === config && resolve(birth.install) === resolve(install)
      : true
    const stateOk = entry.parent === null ? (birthBound && birth.state === state) || argvState : argvState
    return { expectedStart: entry.expected, freshStart: fresh.start ?? null, uid: fresh.uid ?? null, argvInstall, argvState,
      ppid, parentOk, birthOk, stateOk, birthBound,
      ok: fresh.alive && fresh.start === entry.expected && fresh.uid === process.getuid?.() && argvInstall && stateOk && parentOk && birthOk }
  }
  // Preflight the complete resource set before any signal: a wrong child root or an unbound launcher
  // must stop the whole attempt, never leave a TERMed parent with a still-running child.
  const preflight = owned.map(entry => ({ label: entry.label, pid: entry.pid, ...proofFor(entry, liveIdentity(entry.pid)) }))
  result.preflight = preflight
  const blocked = preflight.find(item => item.ok !== true)
  if (blocked) {
    result.retained = true
    result.reason = blocked.birthBound === false && blocked.label === 'launcher' ? 'launcher_birth_missing' : 'resource_scope_mismatch'
    result.blocked = { label: blocked.label, pid: blocked.pid, birthBound: blocked.birthBound, birthOk: blocked.birthOk,
      stateOk: blocked.stateOk, argvState: blocked.argvState, parentOk: blocked.parentOk, argvInstall: blocked.argvInstall }
    return finish(result)
  }
  for (const entry of owned) {
    const fresh = liveIdentity(entry.pid)
    const proof = proofFor(entry, fresh)
    const attempt = { label: entry.label, pid: entry.pid, ...proof, signalled: null }
    if (!proof.ok) { attempt.signalled = false; result.signals.push(attempt); result.retained = true; result.reason = 'fresh_identity_changed'; return finish(result) }
    try { process.kill(entry.pid, 'SIGTERM'); attempt.signalled = 'SIGTERM' } catch { attempt.signalled = false }
    result.signals.push(attempt)
  }
  await new Promise(resolvePromise => setTimeout(resolvePromise, 700))
  for (const entry of owned) {
    const after = liveIdentity(entry.pid)
    if (!after.alive) continue
    const proof = proofFor(entry, after)
    const attempt = { label: entry.label, pid: entry.pid, ...proof, signalled: null }
    if (!proof.ok) { attempt.signalled = false; result.signals.push(attempt); result.retained = true; result.reason = 'fresh_identity_changed_after_term'; return finish(result) }
    try { process.kill(entry.pid, 'SIGKILL'); attempt.signalled = 'SIGKILL' } catch { attempt.signalled = false }
    result.signals.push(attempt)
  }
  await new Promise(resolvePromise => setTimeout(resolvePromise, 400))
  const survivors = entries.map(entry => liveIdentity(entry.pid)).filter(item => item.alive)
  result.aliveAfter = survivors
  result.clean = survivors.length === 0
  if (!result.clean) { result.retained = true; result.reason = 'survivors_after_signal'; return finish(result) }
  // Only after every recorded pid is proven gone may the record be removed: it is the equivalent of
  // the packaged stop's own remove-after-verified-stop, and it is recorded as such.
  try { rmSync(recordPath(config), { force: true }); result.recordRemoved = true } catch { result.recordRemoved = false }
  return finish(result)
}

/**
 * Stops a known set only when the caller supplies the complete, immutable resource facts of this exact
 * spawn (launcher birth + every child with pid/start/uid/argv). There is no process discovery here:
 * an incomplete or unobservable collection is UNKNOWN and retained, and nothing is signalled.
 */
async function stopKnownSet(root, { birth, resources, result }) {
  const { install, config, state } = root
  const payloadInstall = existsSync(join(install, 'app')) ? join(install, 'app') : install
  if (!Array.isArray(resources) || resources.length === 0) {
    result.retained = true
    result.reason = 'resources_unverified'
    return result
  }
  const birthMatches = birth !== null && birth !== undefined && birth.pid === resources[0]?.pid &&
    birth.start === resources[0]?.start && birth.state === state && birth.config === config && birth.install === install
  result.source = 'known_set'
  result.resources = resources.map(item => ({ pid: item.pid, start: item.start, parentPid: item.parentPid ?? null }))
  result.preflight = resources.map(item => {
    const live = liveIdentity(item.pid)
    return { pid: item.pid, expectedStart: item.start ?? null, uid: live.uid ?? null, alive: live.alive,
      startOk: live.start === item.start, uidOk: live.uid === process.getuid?.(),
      argvInstall: argvHasPathPrefix(live.command ?? '', payloadInstall),
      argvState: argvHasExactPath(live.command ?? '', state),
      parentOk: item.parentPid === undefined || item.parentPid === null
        ? true
        : live.ppid === item.parentPid || !liveIdentity(item.parentPid).alive,
      parentGone: item.parentPid !== undefined && item.parentPid !== null && !liveIdentity(item.parentPid).alive }
  })
  if (!birthMatches) { result.retained = true; result.reason = 'birth_set_mismatch'; return result }
  const bad = result.preflight.find(item => item.alive && (!item.startOk || !item.uidOk || !item.argvInstall || !item.argvState || !item.parentOk))
  if (bad) { result.retained = true; result.reason = 'resource_scope_mismatch'; result.blocked = bad; return result }
  const alive = result.preflight.filter(item => item.alive)
  if (alive.length === 0) { result.clean = true; result.legitimateExit = true; return result }
  for (const target of alive) {
    const fresh = liveIdentity(target.pid)
    const ok = fresh.alive && fresh.start === target.expectedStart && fresh.uid === process.getuid?.() &&
      argvHasPathPrefix(fresh.command ?? '', payloadInstall) && argvHasExactPath(fresh.command ?? '', state)
    const attempt = { label: 'resource', pid: target.pid, expectedStart: target.expectedStart, freshStart: fresh.start ?? null,
      uid: fresh.uid ?? null, signalled: null }
    if (!ok) { attempt.signalled = false; result.signals.push(attempt); result.retained = true; result.reason = 'fresh_identity_changed'; return result }
    try { process.kill(target.pid, 'SIGTERM'); attempt.signalled = 'SIGTERM' } catch { attempt.signalled = false }
    result.signals.push(attempt)
  }
  await new Promise(resolvePromise => setTimeout(resolvePromise, 700))
  for (const target of alive) {
    const after = liveIdentity(target.pid)
    if (!after.alive) continue
    const ok = after.start === target.expectedStart && after.uid === process.getuid?.() &&
      argvHasPathPrefix(after.command ?? '', payloadInstall) && argvHasExactPath(after.command ?? '', state)
    const attempt = { label: 'resource', pid: target.pid, expectedStart: target.expectedStart, freshStart: after.start ?? null,
      uid: after.uid ?? null, signalled: null }
    if (!ok) { attempt.signalled = false; result.signals.push(attempt); result.retained = true; result.reason = 'fresh_identity_changed_after_term'; return result }
    try { process.kill(target.pid, 'SIGKILL'); attempt.signalled = 'SIGKILL' } catch { attempt.signalled = false }
    result.signals.push(attempt)
  }
  await new Promise(resolvePromise => setTimeout(resolvePromise, 400))
  // Independent post-stop observation of the fixed pre-stop set; the record is never re-read here.
  const survivors = result.resources.map(item => liveIdentity(item.pid)).filter(item => item.alive)
  result.aliveAfter = survivors
  result.clean = survivors.length === 0
  if (!result.clean) { result.retained = true; result.reason = 'survivors_after_signal' }
  return result
}

/**
 * Retains private material for an unknown or refused cleanup: the root stays in place, the record and
 * small markers are hashed, and nothing is deleted. Callers report this as UNKNOWN material, not CLEAN.
 */
export function retainMaterial(root, reason, { files = [] } = {}) {
  const record = readRecord(root.config)
  const extras = []
  for (const relative of files) {
    const path = resolve(root.own, relative)
    if (!existsSync(path)) continue
    try {
      const bytes = readFileSync(path)
      extras.push({ path, relative, sha256: sha256(bytes), bytes: bytes.byteLength })
    } catch (error) { extras.push({ path, relative, error: String(error?.message ?? error) }) }
  }
  return { reason, root: root.own, install: root.install, config: root.config, state: root.state,
    record: record.present ? { path: record.path, sha256: record.sha256, bytes: record.bytes, error: record.error ?? null } : { present: false },
    files: extras, retainedAt: new Date().toISOString(),
    deleted: false }
}

/** Removes a root only when the caller has proven every process gone and the record is gone. */
export function releaseRoot(root, proof) {
  if (proof?.clean !== true) return { removed: false, reason: 'not_proven_clean', proof: proof?.reason ?? null }
  try { rmSync(root.own, { recursive: true, force: true }); return { removed: true } } catch (error) { return { removed: false, reason: String(error?.message ?? error) } }
}

/** Writes a synthetic instance record for pure ownership controls; never used against product state. */
export function writeSyntheticRecord(root, value) {
  const path = recordPath(root.config)
  const fd = openSync(path, 'wx', 0o600)
  try { writeSync(fd, JSON.stringify(value, null, 2)) } finally { closeSync(fd) }
  return path
}

/** Spawns a plain probe-owned sleeper whose argv names the exact roots, for pure controls. */
export function spawnSleeper(root, { install = root.install, state = root.state, name = 'sleeper' } = {}) {
  const script = join(root.own, `${name}.mjs`)
  writeFileSync(script, 'setInterval(() => {}, 1000)\n')
  const child = spawn(process.execPath, [script, '--install', install, '--state', state, '--config-root', root.config],
    { stdio: 'ignore', detached: false })
  const identity = liveIdentity(child.pid)
  return { child, pid: child.pid, start: identity.start, uid: identity.uid, command: identity.command, script }
}

