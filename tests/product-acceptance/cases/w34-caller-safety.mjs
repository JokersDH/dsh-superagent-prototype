import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { createOperation, observeBirth, resourceBirth, resourceSetComplete } from '../lib/caller-safety.mjs'
import { liveIdentity, spawnSleeper } from '../lib/packaged-instance.mjs'

/**
 * Wave-34 caller-safety controls.
 *
 * These are pure: every process is a plain Node sleeper or short-lived script spawned here, and every
 * material directory is a fresh private scratch root. They prove the *caller protocol* that
 * w33-outer-zip / w33-cohort-recovery now consume — an UNKNOWN operation never releases or signals, a
 * complete exited set does, and a source-level scan finds no caller deleting its own materials.
 */
const sha = value => String(value ?? '').slice(0, 12)
const define = (id, title) => ({ id, title, layer: LAYERS.READONLY, limitations: [
  'Pure caller-protocol control: synthetic Node sleepers and private scratch roots, no product bytes.',
] })

const scratch = () => realpathSync(mkdtempSync(join(tmpdir(), 'pa-e-w34-caller-')))
const wait = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))
const waitGone = async pid => { for (let index = 0; index < 60; index += 1) { if (!liveIdentity(pid).alive) return true; await wait(50) } return !liveIdentity(pid).alive }

/** Runs a caller protocol against one synthetic operation and returns the observable outcome. */
async function runScenario({ keepMaterial = false, sleeperMs = 400, beforeRelease = null } = {}) {
  const own = scratch()
  const material = join(own, 'install-and-state')
  mkdirSync(material, { recursive: true })
  writeFileSync(join(material, 'node'), 'synthetic runtime\n')
  const operation = createOperation({ id: 'w34-control' })
  operation.addMaterial(own, 'private-root')
  const script = join(own, 'child.mjs')
  writeFileSync(script, `setTimeout(() => {}, ${sleeperMs})\n`)
  const child = spawn(process.execPath, [script, '--install', material, '--state', material], { stdio: 'ignore' })
  const birth = resourceBirth(child.pid, { root: material, state: material, op: 'w34-control' })
  operation.track(birth)
  const afterTrack = operation.isComplete()
  const observationAlive = operation.observe()
  const refusedWhileAlive = operation.release()
  if (beforeRelease) await beforeRelease({ operation, child, material })
  await waitGone(child.pid)
  const observationDead = operation.observe()
  const result = { own, material, operation, birth, afterTrack, observationAlive, refusedWhileAlive, observationDead }
  return result
}

export async function runCallerSafety() {
  const cases = []

  cases.push(await runCase(define('E1-CALLER-RETAIN-PREVENTS-RELEASE'), async ({ assert, evidence }) => {
    const own = scratch()
    const material = join(own, 'install')
    mkdirSync(material, { recursive: true })
    writeFileSync(join(material, 'runtime'), 'bytes\n')
    const operation = createOperation({ id: 'retain' })
    operation.addMaterial(own, 'private-root')
    const sleeper = spawnSleeper({ own, install: material, state: material, config: material }, { name: 'retain-child' })
    operation.track(resourceBirth(sleeper.pid, { root: material, state: material, op: 'retain' }))
    operation.retain('stop_unknown')
    const release = operation.release()
    const signal = operation.signal(sleeper.pid, 'SIGTERM')
    const existsAfter = existsSync(material) && existsSync(join(material, 'runtime'))
    const observation = operation.observe()
    assert('RETAIN_REFUSES_RELEASE', release.released.length === 0 && release.verdict.reason === 'operation_unknown', JSON.stringify(release.verdict))
    assert('RETAIN_REFUSES_SIGNAL', signal.signalled === null && signal.refused === 'operation_unknown', JSON.stringify(signal))
    assert('RETAIN_KEEPS_MATERIAL', existsAfter === true, JSON.stringify(operation.materialExists()))
    evidence.callerRetain = { release: release.verdict, signal, materialExists: operation.materialExists(), observation }
    // The sleeper is probe-owned scratch with no self-exit: terminate it only through a *fresh*
    // preflighted signal on a second operation that shares the exact same birth facts.
    const cleanup = createOperation({ id: 'retain-cleanup' })
    cleanup.track({ ...operation.births[0] })
    const kill = cleanup.signal(sleeper.pid, 'SIGTERM')
    await waitGone(sleeper.pid)
    evidence.callerRetain.cleanup = kill
    // The scratch root itself is removed only after the control recorded the refusal; the operation
    // API never released it.
    rmSync(own, { recursive: true, force: true })
  }))

  cases.push(await runCase(define('E1-CALLER-COMPLETE-RELEASE'), async ({ assert, evidence }) => {
    const run = await runScenario({ sleeperMs: 300 })
    assert('COMPLETE_SET_TRACKED', run.afterTrack === true, JSON.stringify(run.birth))
    assert('ALIVE_SET_REFUSED', run.refusedWhileAlive.released.length === 0 && run.refusedWhileAlive.verdict.reason === 'resource_alive',
      JSON.stringify(run.refusedWhileAlive.verdict))
    const allowed = run.operation.releaseAllowed(run.observationDead)
    const release = run.operation.release({ observation: run.observationDead })
    assert('EXITED_SET_RELEASES', allowed.allowed === true && release.released.length === 1 && release.retained.length === 0,
      JSON.stringify({ allowed, release }))
    assert('MATERIAL_REMOVED', existsSync(run.own) === false, run.own)
    evidence.callerComplete = { birth: run.birth, observationDead: run.observationDead, release: release.verdict }
  }))

  cases.push(await runCase(define('E1-CALLER-INCOMPLETE-SET'), async ({ assert, evidence }) => {
    const own = scratch()
    const operation = createOperation({ id: 'incomplete' })
    const sleeper = spawnSleeper({ own }, { name: 'incomplete-child' })
    let missingStart = null, missingArgv = null
    try { operation.track({ pid: sleeper.pid, start: null, uid: 501, argv: 'x', argvSha256: 'a'.repeat(64) }) } catch (error) { missingStart = String(error.message) }
    try { operation.track({ pid: sleeper.pid + 1, start: 'x', uid: 501, argv: null, argvSha256: null }) } catch (error) { missingArgv = String(error.message) }
    const forged = [{ pid: sleeper.pid, start: null, uid: null, argv: null, argvSha256: null }]
    assert('MISSING_START_REFUSED', missingStart !== null && /no stable start/u.test(missingStart), String(missingStart))
    assert('MISSING_ARGV_REFUSED', missingArgv !== null && /no argv/u.test(missingArgv), String(missingArgv))
    assert('SET_INCOMPLETE', resourceSetComplete(forged) === false && operation.isComplete() === false, JSON.stringify(forged))
    evidence.callerIncomplete = { missingStart, missingArgv, complete: operation.isComplete() }
    const cleanup = createOperation({ id: 'incomplete-cleanup' })
    cleanup.track(resourceBirth(sleeper.pid, { root: own }))
    cleanup.signal(sleeper.pid, 'SIGTERM')
    await waitGone(sleeper.pid)
    rmSync(own, { recursive: true, force: true })
  }))

  cases.push(await runCase(define('E1-CALLER-DUPLICATE-AND-FOREIGN'), async ({ assert, evidence }) => {
    const run = await runScenario({ sleeperMs: 200 })
    const idempotent = run.operation.track(run.birth)
    let duplicate = null
    try { run.operation.track({ ...run.birth, start: 'Mon Nov 16 00:00:00 2026' }) } catch (error) { duplicate = String(error.message) }
    const foreignObservation = run.observationDead.map((row, index) =>
      index === 0 ? { ...row, pid: row.pid + 1000 } : row)
    const foreign = run.operation.releaseAllowed(foreignObservation)
    const duplicateObservation = [...run.observationDead, { ...run.observationDead[0] }]
    const duplicated = run.operation.releaseAllowed(duplicateObservation)
    assert('IDENTITY_REREGISTRATION_IDEMPOTENT', idempotent?.pid === run.birth.pid, JSON.stringify(idempotent?.pid))
    assert('CONFLICTING_DUPLICATE_REFUSED', duplicate !== null && /duplicate pid/u.test(duplicate), String(duplicate))
    assert('FOREIGN_OBSERVATION_REFUSED', foreign.allowed === false && foreign.reason === 'foreign_observation', JSON.stringify(foreign))
    assert('DUPLICATE_OBSERVATION_REFUSED', duplicated.allowed === false && duplicated.reason === 'observation_missing', JSON.stringify(duplicated))
    evidence.callerDuplicate = { duplicate, foreign, duplicated, idempotent: idempotent?.pid ?? null }
    rmSync(run.own, { recursive: true, force: true })
  }))

  cases.push(await runCase(define('E1-CALLER-EXPECTED-START-MISMATCH'), async ({ assert, evidence }) => {
    const run = await runScenario({ sleeperMs: 200 })
    const wrong = run.observationDead.map(row => ({ ...row, expectedStart: 'Mon Nov 16 99:99:99 2026' }))
    const verdict = run.operation.releaseAllowed(wrong)
    const aliveForged = [{ ...run.observationDead[0], alive: true, sameIdentity: false, observedStart: 'x' }]
    const aliveVerdict = run.operation.releaseAllowed(aliveForged)
    assert('WRONG_EXPECTED_START_REFUSED', verdict.allowed === false && verdict.reason === 'expected_start_mismatch', JSON.stringify(verdict))
    assert('FORGED_ALIVE_REFUSED', aliveVerdict.allowed === false && aliveVerdict.reason === 'resource_alive', JSON.stringify(aliveVerdict))
    evidence.callerStart = { verdict, aliveVerdict }
    rmSync(run.own, { recursive: true, force: true })
  }))

  cases.push(await runCase(define('E1-CALLER-PARENT-DEAD-CHILD-ALIVE'), async ({ assert, evidence }) => {
    const own = scratch()
    const material = join(own, 'install')
    mkdirSync(material, { recursive: true })
    const op = createOperation({ id: 'parent-child' })
    op.addMaterial(own, 'private-root')
    const script = join(own, 'parent.mjs')
    writeFileSync(script, `import { spawn } from 'node:child_process'\nconst child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1200)'], { stdio: 'ignore' })\nchild.unref()\nprocess.stdout.write(String(child.pid))\n`)
    const parent = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    parent.stdout.on('data', chunk => { out += chunk })
    op.track(resourceBirth(parent.pid, { root: material, op: 'parent-child' }))
    await wait(300)
    const childPid = Number(out.trim())
    op.track(resourceBirth(childPid, { root: material, op: 'parent-child', parentPid: parent.pid, role: 'child' }))
    const parentDead = await waitGone(parent.pid)
    const observation = op.observe()
    const refused = op.releaseAllowed(observation)
    const childRow = observation.find(row => row.pid === childPid)
    assert('CHILD_KNOWN', Number.isSafeInteger(childPid) && childRow !== undefined, JSON.stringify({ childPid, out }))
    assert('PARENT_EXITED', parentDead === true, JSON.stringify(observation.find(row => row.pid === parent.pid)))
    assert('CHILD_ALIVE_BLOCKS_RELEASE', refused.allowed === false && refused.reason === 'resource_alive', JSON.stringify({ refused, observation }))
    const signal = op.signal(childPid, 'SIGTERM')
    await waitGone(childPid)
    const after = op.releaseAllowed(op.observe())
    assert('FRESH_CHILD_SIGNAL', signal.signalled === 'SIGTERM', JSON.stringify(signal))
    assert('RELEASE_AFTER_CHILD_EXIT', after.allowed === true, JSON.stringify(after))
    evidence.callerParentChild = { parentDead, refused, signal, after }
    rmSync(own, { recursive: true, force: true })
  }))

  cases.push(await runCase(define('E1-CALLER-SIGNAL-REFUSES-STALE-IDENTITY'), async ({ assert, evidence }) => {
    const own = scratch()
    const op = createOperation({ id: 'stale-signal' })
    const sleeper = spawnSleeper({ own }, { name: 'stale-child' })
    // The forged birth claims a different start and argv for the same live pid.
    op.track({ pid: sleeper.pid, start: 'Mon Nov 16 01:01:01 2026', uid: 501, argv: '/bin/other --flag',
      argvSha256: 'b'.repeat(64), root: own, op: 'stale-signal' })
    const signal = op.signal(sleeper.pid, 'SIGTERM')
    const alive = liveIdentity(sleeper.pid).alive
    assert('STALE_IDENTITY_REFUSED', signal.signalled === null && signal.refused === 'identity_changed', JSON.stringify(signal))
    assert('NO_MISGUIDED_SIGNAL', alive === true && op.signals.length === 0, JSON.stringify({ alive, signals: op.signals.length }))
    evidence.callerStale = { signal, signals: op.signals.length }
    const cleanup = createOperation({ id: 'stale-cleanup' })
    cleanup.track(resourceBirth(sleeper.pid, { root: own }))
    cleanup.signal(sleeper.pid, 'SIGTERM')
    await waitGone(sleeper.pid)
    rmSync(own, { recursive: true, force: true })
  }))

  cases.push(await runCase(define('E1-CALLER-ASSERT-FAILURE-RETAINS'), async ({ assert, evidence }) => {
    const run = await runScenario({ sleeperMs: 300, beforeRelease: async ({ operation }) => { operation.fail('assertion', new Error('PRODUCT_ASSERTION_FAILED')); operation.retain('assertion_failure') } })
    const release = run.operation.release()
    const retainedPaths = run.operation.materialExists()
    assert('ASSERT_FAILURE_RETAINS', release.released.length === 0 && release.verdict.reason === 'operation_unknown', JSON.stringify(release.verdict))
    assert('MATERIAL_STILL_PRESENT', retainedPaths.every(item => item.exists === true), JSON.stringify(retainedPaths))
    assert('FAILURE_RECORDED', run.operation.failures.some(item => item.stage === 'assertion'), JSON.stringify(run.operation.failures))
    evidence.callerAssert = { release: release.verdict, retainedPaths, failures: run.operation.failures }
    rmSync(run.own, { recursive: true, force: true })
  }))

  cases.push(await runCase(define('E1-CALLER-NO-FORCE-API'), async ({ assert, evidence }) => {
    const module = await import('../lib/caller-safety.mjs')
    const names = Object.keys(module)
    const operation = createOperation({ id: 'api-surface' })
    const methods = Object.keys(operation).sort()
    const forbidden = methods.filter(name => /force|cleanupall|discover|killbypath|rmrf|deleteall/iu.test(name))
    assert('NO_FORCE_METHOD', forbidden.length === 0, JSON.stringify(forbidden))
    assert('EXPECTED_EXPORTS', ['createOperation', 'observeBirth', 'resourceBirth', 'resourceSetComplete'].every(name => names.includes(name)), JSON.stringify(names))
    assert('SIGNAL_AND_RELEASE_ONLY', methods.includes('signal') && methods.includes('release') && methods.includes('retain'), JSON.stringify(methods))
    evidence.callerApi = { exports: names, methods, forbidden }
    rmSync(scratch(), { recursive: true, force: true })
  }))

  cases.push(await runCase(define('E1-CALLER-SOURCE-DISCIPLINE'), async ({ assert, evidence }) => {
    const here = resolve('.')
    const roots = ['tests/product-acceptance/cases', 'tests/product-acceptance/lib', 'tests/product-acceptance/run.mjs']
    const offenders = []
    const callers = []
    const walk = path => {
      const text = readFileSync(path, 'utf8')
      // Only the wave-33/34 lifecycle callers and the shared module are in scope here: older
      // single-purpose cases own their own ephemeral scratch handling.
      if (/w3[34]-/u.test(path) && !/w34-caller-safety\.mjs$/u.test(path) && /rmSync\(/u.test(text)) offenders.push(path)
      if (/w33-(outer-zip|cohort-recovery)\.mjs$/u.test(path)) callers.push({ path, usesOperation: /createOperation/u.test(text), directRm: /rmSync\(/u.test(text), forceDelete: /force:\s*true/u.test(text) })
    }
    for (const root of roots) {
      const absolute = join(here, root)
      if (root.endsWith('.mjs')) { walk(absolute); continue }
      for (const name of readdirSync(absolute)) if (name.endsWith('.mjs')) walk(join(absolute, name))
    }
    assert('CALLERS_USE_OPERATION', callers.length === 2 && callers.every(item => item.usesOperation === true), JSON.stringify(callers))
    assert('CALLERS_DO_NOT_DELETE', callers.every(item => item.directRm === false && item.forceDelete === false), JSON.stringify(callers))
    assert('ONLY_SHARED_MODULE_REMOVES', offenders.length === 0, JSON.stringify(offenders))
    evidence.callerSource = { callers, offenders }
  }))

  return { cases, artifacts: {} }
}
