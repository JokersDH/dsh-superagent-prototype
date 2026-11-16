/**
 * Wave-30 immutable own-probe guard (guard3).
 *
 * Ownership is a WeakMap keyed by the opaque handle object returned at spawn. The registry stores a
 * private deep-frozen clone of the birth facts plus the original ChildProcess; the returned
 * observation is a separate defensive copy, so mutating it (pid/argv/root/config/op/birth/plan) or
 * copying a handle cannot retarget a signal. The first signal requires a complete resource plan; every
 * TERM/KILL re-reads the whole identity. `ps` failures remain UNKNOWN and never mean gone.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PS = '/bin/ps'
const REGISTRY = new WeakMap()

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

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry)
    Object.freeze(value)
  }
  return value
}

function clone(value) { return structuredClone(value) }

export function compareRecord3(record, observed) {
  const issues = []
  if (record === null || typeof record !== 'object') return { ok: false, issues: ['record_missing'] }
  for (const field of ['pid', 'ppid', 'uid', 'start', 'command', 'root', 'config', 'operation', 'executable'])
    if (record[field] === undefined || record[field] === null) issues.push(`record_${field}_missing`)
  if (!Array.isArray(record.argv) || record.argv.length === 0) issues.push('record_argv_missing')
  if (record.launch === undefined || record.launch === null) issues.push('record_launch_missing')
  else {
    if (record.launch.executable !== record.executable) issues.push('launch_executable_mismatch')
    if (!Array.isArray(record.launch.argv) || record.launch.argv.length < 2 || record.launch.argv[0] !== record.executable) issues.push('launch_argv_missing')
    else if (record.launch.argv.length !== record.argv.length + 1 || !record.argv.every((value, index) => value === record.launch.argv[index + 1])) issues.push('launch_argv_mismatch')
    if (record.launch.cwd === undefined || record.launch.cwd === null) issues.push('launch_cwd_missing')
    if (record.launch.ambiguous === true) issues.push('launch_argv_ambiguous')
    if (typeof record.launch.command !== 'string' || record.launch.command.length === 0) issues.push('launch_command_missing')
    else if (String(record.command ?? '').replace(/\s+/g, ' ').trim() !== record.launch.command.replace(/\s+/g, ' ').trim()) issues.push('launch_command_mismatch')
  }
  if (record.birth === undefined || record.birth === null) issues.push('record_birth_missing')
  if (record.birth?.source !== 'child_report+ps+spawn') issues.push('birth_source_invalid')
  if (record.plan === undefined || record.plan === null) issues.push('record_plan_missing')
  else if (record.plan.complete !== true || record.plan.resourceCount !== 1 || record.plan.verified !== 'birth') issues.push('record_plan_incomplete')
  if (!Array.isArray(record.resources) || record.resources.length !== 1) issues.push('record_resources_missing')
  else if (record.resources[0]?.pid !== record.pid || record.resources[0]?.start !== record.start) issues.push('record_resource_mismatch')
  if (observed === null || observed.state !== 'alive') return { ok: false, issues: [...issues, `observed_${observed?.state ?? 'missing'}`] }
  if (observed.pid !== record.pid) issues.push('pid_mismatch')
  if (observed.ppid !== record.ppid) issues.push('ppid_mismatch')
  if (observed.uid !== record.uid) issues.push('uid_mismatch')
  if (observed.start !== record.start) issues.push('start_mismatch')
  const expectedCommand = String(record.command ?? '').replace(/\s+/g, ' ').trim()
  const actualCommand = String(observed.command ?? '').replace(/\s+/g, ' ').trim()
  if (expectedCommand !== actualCommand) issues.push('argv_mismatch')
  if (!Array.isArray(record.birth?.argv) || record.argv.length !== record.birth.argv.length || !record.argv.every((value, index) => value === record.birth.argv[index])) issues.push('birth_argv_mismatch')
  if (record.birth?.root !== record.root) issues.push('birth_root_mismatch')
  if (record.birth?.config !== record.config) issues.push('birth_config_mismatch')
  if (record.birth?.operation !== record.operation) issues.push('birth_operation_mismatch')
  if (record.birth?.pid !== record.pid || record.birth?.ppid !== record.ppid || record.birth?.uid !== record.uid) issues.push('birth_pid_mismatch')
  return { ok: issues.length === 0, issues }
}

export async function spawnOwnProbe({
  root, operation, ignoreTerm = false,
  spawnImpl = spawn, observer = observeProcess, killImpl = process.kill, birthTimeoutMs = 3000,
}) {
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
  const child = spawnImpl(process.execPath, argv, { stdio: 'ignore' })
  const launchedAt = new Date().toISOString()
  const deadline = Date.now() + birthTimeoutMs
  let observed = null
  let birth = null
  while (Date.now() < deadline) {
    observed = observer(child.pid)
    if (observed.state === 'alive' && existsSync(ready) && existsSync(birthPath)) {
      try { birth = JSON.parse(readFileSync(birthPath, 'utf8')); break } catch { birth = null }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  const retained = (reason) => ({
    reason, pid: child.pid, root: probeDir, executable: process.execPath,
    argv: [process.execPath, ...argv], config, operation, observed, birth, launchedAt,
    birthPath, readyPath: ready, signalSent: false,
    note: 'birth identity is incomplete or unreadable; material is retained and no signal is sent',
  })
  if (observed === null || observed.state !== 'alive' || birth === null) {
    // No raw child.kill here: without a complete verified birth we have no authority to signal.
    const error = new Error(`Own probe birth was not complete: ${JSON.stringify({ observed, birth })}`)
    error.retained = retained(observed === null ? 'observation_missing' : observed.state === 'unknown' ? 'observation_unknown' : birth === null ? 'birth_report_missing' : 'observation_not_alive')
    throw error
  }
  const launchArgv = [process.execPath, ...argv]
  const launchAmbiguous = launchArgv.some((value) => /\s/.test(value) || value.includes('"') || value.includes("'") || value.includes('\\'))
  const facts = deepFreeze({
    pid: child.pid, ppid: process.pid, uid: process.getuid?.() ?? null, start: observed.start,
    command: observed.command, root: probeDir, config, operation,
    executable: process.execPath,
    launch: deepFreeze({ executable: process.execPath, argv: deepFreeze(launchArgv), command: launchArgv.join(' '), ambiguous: launchAmbiguous, cwd: process.cwd(), operation, root: probeDir, config, launchedAt }),
    argv: deepFreeze([...argv]),
    birth: deepFreeze({ source: 'child_report+ps+spawn', argv: birth.argv, pid: birth.pid, ppid: birth.ppid, uid: birth.uid, cwd: birth.cwd, root: probeDir, config, operation }),
    resources: deepFreeze([{ kind: 'own_probe', pid: child.pid, start: observed.start, uid: observed.uid ?? (process.getuid?.() ?? null), root: probeDir, config, operation }]),
    plan: deepFreeze({ complete: true, resourceCount: 1, children: 1, verified: 'birth' }),
    birthObservedAt: new Date().toISOString(),
  })
  const compare = compareRecord3(facts, observed)
  if (!compare.ok) {
    const error = new Error(`Own probe identity failed at birth: ${JSON.stringify(compare)}`)
    error.retained = { ...retained('identity_mismatch'), issues: compare.issues }
    throw error
  }
  const handle = Object.freeze(Object.create(null))
  REGISTRY.set(handle, { facts, child })
  return { handle, observation: clone(facts) }
}

/**
 * Signal one registered handle only. Ownership is never a plain object, copied handle or mutated
 * observation. The full resource plan is checked on every signal; `dryRun` performs the same checks
 * without sending, which is how pure controls stay at zero real signals.
 */
export function signalFresh({ handle, signal, observer = observeProcess, allowSignals = true, dryRun = false, killImpl = process.kill }) {
  if (allowSignals !== true) return { sent: false, refused: 'signals_disabled', issues: [] }
  const entry = handle !== null && typeof handle === 'object' ? REGISTRY.get(handle) : undefined
  if (entry === undefined) return { sent: false, refused: 'not_registered', issues: ['birth_not_registered'] }
  const { facts, child } = entry
  if (facts.plan?.complete !== true || facts.plan?.resourceCount !== 1 || facts.resources?.length !== 1) return { sent: false, refused: 'resource_plan_incomplete', issues: [] }
  if (child.exitCode !== null || child.signalCode !== null) return { sent: false, refused: 'already_exited', issues: [] }
  const observed = observer(facts.pid)
  const compare = compareRecord3(facts, observed)
  if (!compare.ok) return { sent: false, refused: observed.state === 'unknown' ? 'unknown_observation' : 'identity_not_fresh', issues: compare.issues, observed }
  if (dryRun === true) return { sent: false, dryRun: true, wouldSignal: { pid: facts.pid, start: facts.start, operation: facts.operation } }
  try {
    killImpl(facts.pid, signal)
    return { sent: true, signal, target: { pid: facts.pid, start: facts.start }, observedAt: new Date().toISOString() }
  } catch (error) {
    return { sent: false, refused: String(error?.code ?? error), issues: [] }
  }
}

export function describeHandle(handle) {
  const entry = handle !== null && typeof handle === 'object' ? REGISTRY.get(handle) : undefined
  if (entry === undefined) return null
  return { observation: clone(entry.facts), live: entry.child.exitCode === null && entry.child.signalCode === null }
}

export async function waitGone(handle, timeoutMs = 3000, observer = observeProcess) {
  const entry = handle !== null && typeof handle === 'object' ? REGISTRY.get(handle) : undefined
  if (entry === undefined) return { gone: false, refused: 'not_registered' }
  const { child, facts } = entry
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return { gone: true, via: 'child_exit', code: child.exitCode, signal: child.signalCode }
    const observed = observer(facts.pid)
    if (observed.state === 'gone') return { gone: true, via: 'ps_not_found' }
    if (observed.state === 'unknown') return { gone: false, unknown: true, reason: observed.reason }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  return { gone: false, timedOut: true }
}

export function pureControls(handle) {
  const entry = REGISTRY.get(handle)
  if (entry === undefined) return [{ id: 'unregistered_handle', refused: 'not_registered', ok: true }]
  const { facts } = entry
  const alive = observeProcess(facts.pid)
  const baseline = compareRecord3(facts, alive)
  const copied = Object.freeze({ ...handle })
  const external = describeHandle(handle)?.observation
  external.pid = facts.pid + 1
  external.argv = ['/bin/false']
  external.birth.pid = facts.pid + 1
  external.birth.argv = ['/bin/false']
  external.root = `${facts.root}-sibling`
  external.operation = `${facts.operation}-sibling`
  external.plan = { complete: false, resourceCount: 0, verified: 'forged' }
  external.resources = []
  const afterExternal = describeHandle(handle)?.observation
  const target = signalFresh({ handle, signal: 'SIGTERM', dryRun: true })
  const variants = {
    missing_birth: clone(facts),
    missing_argv: clone(facts),
    missing_plan: clone(facts),
    missing_resources: clone(facts),
    missing_launch: clone(facts),
    mutated_launch: clone(facts),
    launch_command_mismatch: clone(facts),
    launch_ambiguous: clone(facts),
    foreign_uid: clone(facts),
    recycled_start: clone(facts),
    sibling_pid: clone(facts),
  }
  delete variants.missing_birth.birth
  variants.missing_argv.argv = []
  variants.missing_plan.plan = { complete: false, resourceCount: 0, verified: 'forged' }
  variants.missing_resources.resources = []
  variants.missing_resources.plan = { complete: false, resourceCount: 0, verified: 'forged' }
  delete variants.missing_launch.launch
  variants.mutated_launch.launch.argv = ['/bin/false']
  variants.launch_command_mismatch.launch.command = ['/usr/bin/node', ...facts.argv, '--extra'].join(' ')
  variants.launch_ambiguous.launch.ambiguous = true
  variants.foreign_uid.uid = facts.uid + 1
  variants.recycled_start.start = 'Mon Jan  1 00:00:00 2001'
  variants.sibling_pid.pid = facts.pid + 1
  const variantResults = {}
  for (const [id, variant] of Object.entries(variants)) variantResults[id] = compareRecord3(variant, alive).ok === false
  return [
    { id: 'own_handle', ok: baseline.ok },
    { id: 'returned_observation_is_copy', ok: afterExternal !== null && afterExternal.pid === facts.pid && afterExternal.root === facts.root && afterExternal.plan.complete === true },
    { id: 'dry_run_targets_original_pid', ok: target.dryRun === true && target.sent === false && target.wouldSignal?.pid === facts.pid && target.wouldSignal?.operation === facts.operation },
    { id: 'plain_observation_rejected', result: signalFresh({ handle: clone(facts), signal: 'SIGTERM', dryRun: true }), expect: 'not_registered' },
    { id: 'copied_handle_rejected', result: signalFresh({ handle: copied, signal: 'SIGTERM', dryRun: true }), expect: 'not_registered' },
    { id: 'ps_unknown_refused', result: signalFresh({ handle, signal: 'SIGTERM', observer: () => ({ state: 'unknown', reason: 'ps_failed' }), dryRun: true }), expect: 'unknown_observation' },
    { id: 'ps_unknown_not_gone', ok: (classifyFixtures().unknownPermission.state === 'unknown') && (classifyFixtures().unknownParse.state === 'unknown') },
    ...Object.entries(variantResults).map(([id, ok]) => ({ id, ok })),
  ]
}

/**
 * Zero-spawn, zero-signal logic suite. It proves the comparison/ownership rules on synthetic facts and
 * never calls spawn, process.kill or /bin/ps. Live checks only run after every mock check passes.
 */

/**
 * Pure failure-path controls: no real spawn and no real signal. A fake child records both
 * `child.kill()` and the injected kill implementation, so a spawn-side fallback cannot hide.
 */
export async function failureControls({ baseRoot }) {
  const cases = []
  const run = async ({ id, writeBirth, observed, expected }) => {
    const root = mkdtempSync(join(baseRoot, 'case-'))
    const spy = { childKill: 0, processKill: 0, spawns: 0 }
    const child = { pid: 424242, exitCode: null, signalCode: null, kill() { spy.childKill += 1 } }
    const spawnImpl = (_executable, argv) => {
      spy.spawns += 1
      if (writeBirth) {
        const rootArg = argv[argv.indexOf('--root') + 1]
        const config = argv[argv.indexOf('--config') + 1]
        writeFileSync(`${rootArg}/birth.json`, JSON.stringify({ argv, pid: 424242, ppid: process.pid, uid: process.getuid?.() ?? null, cwd: process.cwd() }))
        writeFileSync(`${rootArg}/ready`, 'ready')
        writeFileSync(`${rootArg}/config.json`, JSON.stringify({ operation: argv[argv.indexOf('--operation') + 1], owned: true }))
      }
      return child
    }
    let retained = null
    try {
      await spawnOwnProbe({ root, operation: `h1-${id}`, spawnImpl, observer: () => observed, killImpl: () => { spy.processKill += 1 }, birthTimeoutMs: 40 })
    } catch (error) {
      retained = error.retained ?? { reason: 'missing_retained' }
    }
    cases.push({
      id, expected, retainedReason: retained?.reason ?? null, retainedPid: retained?.pid ?? null,
      retainedSignalSent: retained?.signalSent ?? null, spawns: spy.spawns,
      childKillCalls: spy.childKill, processKillCalls: spy.processKill,
      childExitCode: child.exitCode, root,
      ok: retained?.reason === expected && spy.childKill === 0 && spy.processKill === 0 && child.exitCode === null,
    })
    // The fake child never existed as an OS process, so the temp directory is safe to remove.
    rmSync(root, { recursive: true, force: true })
  }
  await run({ id: 'observation_unknown', writeBirth: false, observed: { state: 'unknown', reason: 'ps_failed' }, expected: 'observation_unknown' })
  await run({ id: 'birth_report_missing', writeBirth: false, observed: { state: 'alive', pid: 424242, ppid: process.pid, uid: process.getuid?.() ?? null, start: 'Sun Nov 15 10:00:00 2026', command: 'node fake' }, expected: 'birth_report_missing' })
  await run({ id: 'identity_mismatch', writeBirth: true, observed: { state: 'alive', pid: 424242, ppid: 1, uid: process.getuid?.() ?? null, start: 'Sun Nov 15 10:00:00 2026', command: 'node fake' }, expected: 'identity_mismatch' })
  return { ok: cases.every((entry) => entry.ok), cases, childKillCalls: cases.reduce((sum, entry) => sum + entry.childKillCalls, 0), processKillCalls: cases.reduce((sum, entry) => sum + entry.processKillCalls, 0) }
}

export function mockSuite() {
  const argv = ['/tmp/own/probe/probe.mjs', '--root', '/tmp/own/probe', '--config', '/tmp/own/probe/config.json', '--operation', 'own-op']
  const facts = deepFreeze({
    pid: 501, ppid: 1, uid: 501, start: 'Sun Nov 15 10:00:00 2026', command: `/usr/bin/node ${argv.join(' ')}`,
    root: '/tmp/own/probe', config: '/tmp/own/probe/config.json', operation: 'own-op', argv: deepFreeze([...argv]),
    executable: '/usr/bin/node',
    launch: deepFreeze({ executable: '/usr/bin/node', argv: deepFreeze(['/usr/bin/node', ...argv]), command: ['/usr/bin/node', ...argv].join(' '), ambiguous: false, cwd: '/tmp/own', operation: 'own-op', root: '/tmp/own/probe', config: '/tmp/own/probe/config.json', launchedAt: '2026-11-15T10:00:00.000Z' }),
    birth: deepFreeze({ source: 'child_report+ps+spawn', argv: [...argv], pid: 501, ppid: 1, uid: 501, cwd: '/tmp/own', root: '/tmp/own/probe', config: '/tmp/own/probe/config.json', operation: 'own-op' }),
    resources: deepFreeze([{ kind: 'own_probe', pid: 501, start: 'Sun Nov 15 10:00:00 2026', uid: 501, root: '/tmp/own/probe', config: '/tmp/own/probe/config.json', operation: 'own-op' }]),
    plan: deepFreeze({ complete: true, resourceCount: 1, children: 1, verified: 'birth' }),
  })
  const alive = { state: 'alive', pid: 501, ppid: 1, uid: 501, start: facts.start, command: facts.command }
  const checks = []
  const expectRefused = (id, mutate) => {
    const variant = clone(facts)
    mutate(variant)
    checks.push({ id, ok: compareRecord3(variant, alive).ok === false })
  }
  checks.push({ id: 'mock_frozen_birth_facts', ok: Object.isFrozen(facts) && Object.isFrozen(facts.birth) && Object.isFrozen(facts.birth.argv) })
  checks.push({ id: 'mock_defensive_copy_is_distinct', ok: clone(facts) !== facts })
  const external = clone(facts)
  external.pid = 999
  external.birth.pid = 999
  external.root = '/tmp/foreign'
  external.operation = 'foreign-op'
  external.argv = ['/bin/false']
  external.plan = { complete: false, resourceCount: 0, verified: 'forged' }
  external.resources = []
  checks.push({ id: 'mock_external_mutation_does_not_change_facts', ok: facts.pid === 501 && facts.root === '/tmp/own/probe' && facts.plan.complete === true && facts.argv[0] === argv[0] })
  checks.push({ id: 'mock_own_positive', ok: compareRecord3(facts, alive).ok })
  expectRefused('mock_foreign_pid_refused', (v) => { v.pid = 999 })
  expectRefused('mock_foreign_uid_refused', (v) => { v.uid = 0 })
  expectRefused('mock_recycled_start_refused', (v) => { v.start = 'Mon Jan  1 00:00:00 2001' })
  expectRefused('mock_sibling_root_refused', (v) => { v.root = `${v.root}-sibling` })
  expectRefused('mock_sibling_operation_refused', (v) => { v.operation = `${v.operation}-sibling` })
  expectRefused('mock_missing_birth_refused', (v) => { delete v.birth })
  expectRefused('mock_missing_argv_refused', (v) => { v.argv = [] })
  expectRefused('mock_birth_argv_mismatch_refused', (v) => { v.birth.argv = ['/bin/false'] })
  expectRefused('mock_missing_plan_refused', (v) => { v.plan = { complete: false, resourceCount: 0, verified: 'forged' } })
  expectRefused('mock_missing_resources_refused', (v) => { v.resources = [] })
  expectRefused('mock_argv_change_refused', (v) => { v.birth.argv = [...v.birth.argv, '--extra'] })
  const fixtures = classifyFixtures()
  checks.push({ id: 'mock_ps_fixture_alive', ok: fixtures.alive.state === 'alive' && fixtures.alive.pid === 10 })
  checks.push({ id: 'mock_ps_fixture_gone_only_on_not_found', ok: fixtures.gone.state === 'gone' && fixtures.unknownPermission.state === 'unknown' && fixtures.unknownParse.state === 'unknown' })
  return { ok: checks.every((check) => check.ok), checks, spawns: 0, signals: 0, ps: 0 }
}

export function classifyFixtures() {
  return {
    alive: classifyPs({ status: 0, stdout: '10 1 501 Sun Nov 15 10:00:00 2026 /usr/bin/node fixture\n', stderr: '' }),
    gone: classifyPs({ status: 1, stdout: '', stderr: 'ps: No such process' }),
    unknownPermission: classifyPs({ status: 1, stdout: '', stderr: 'ps: permission denied' }),
    unknownParse: classifyPs({ status: 0, stdout: 'not-a-ps-line\n', stderr: '' }),
  }
}
