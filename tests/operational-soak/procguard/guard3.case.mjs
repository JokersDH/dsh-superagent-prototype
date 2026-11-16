import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnOwnProbe, failureControls, mockSuite, classifyFixtures, compareRecord3, signalFresh, waitGone } from './guard3.mjs'

test('guard3 mock suite: immutable clone semantics, exact identity, zero spawn/signal/ps', () => {
  const suite = mockSuite()
  const failed = suite.checks.filter((check) => check.ok !== true)
  assert.deepEqual(failed, [], `failed checks: ${JSON.stringify(failed)}`)
  assert.equal(suite.spawns, 0)
  assert.equal(suite.signals, 0)
  assert.equal(suite.ps, 0)
})

test('guard3 ps classification: only explicit not-found is gone; failures and parse errors stay unknown', () => {
  const fixtures = classifyFixtures()
  assert.equal(fixtures.alive.state, 'alive')
  assert.equal(fixtures.alive.pid, 10)
  assert.equal(fixtures.gone.state, 'gone')
  assert.equal(fixtures.unknownPermission.state, 'unknown')
  assert.equal(fixtures.unknownParse.state, 'unknown')
})

test('guard3 unregistered owners obtain nothing: plain observation, copied handle, and forged record all refuse', async () => {
  const forged = { pid: 1, ppid: 0, uid: 0, start: 'x', command: 'x', root: '/tmp', config: '/tmp/c', operation: 'x', argv: ['x'], birth: { source: 'child_report+ps+spawn' }, resources: [], plan: { complete: true, resourceCount: 1, verified: 'birth' } }
  for (const handle of [forged, Object.freeze({}), Object.freeze({ token: Symbol('forged') }), null, undefined]) {
    const result = signalFresh({ handle, signal: 'SIGTERM', dryRun: true })
    assert.equal(result.sent, false)
    assert.equal(result.refused, 'not_registered')
  }
  const gone = await waitGone(forged, 10)
  assert.equal(gone.gone, false)
  assert.equal(gone.refused, 'not_registered')
  assert.equal(compareRecord3({ ...forged, plan: undefined }, { state: 'alive', ...forged }).ok, false)
})

function fakeSpawn({ writeBirth = false, failWrite = false } = {}) {
  const state = { spawn: 0, childKill: 0, processKill: 0, child: null, argv: null }
  state.child = {
    pid: 424242,
    exitCode: null,
    signalCode: null,
    kill() { state.childKill += 1 },
  }
  state.spawnImpl = (_executable, argv) => {
    state.spawn += 1
    state.argv = argv
    if (writeBirth) {
      const root = argv[argv.indexOf('--root') + 1]
      const config = argv[argv.indexOf('--config') + 1]
      if (!failWrite) {
        writeFileSync(`${root}/birth.json`, JSON.stringify({ argv, pid: 424242, ppid: process.pid, uid: process.getuid(), cwd: process.cwd() }))
        writeFileSync(`${root}/ready`, 'ready')
        writeFileSync(`${root}/config.json`, JSON.stringify({ operation: argv[argv.indexOf('--operation') + 1], owned: true }))
      }
    }
    return state.child
  }
  state.killImpl = () => { state.processKill += 1 }
  return state
}

test('incomplete birth or UNKNOWN observation retains material and sends no signal', async () => {
  for (const scenario of [
    { id: 'observation_unknown', writeBirth: false, observed: { state: 'unknown', reason: 'ps_failed' }, expected: 'observation_unknown' },
    { id: 'birth_report_missing', writeBirth: false, observed: { state: 'alive', pid: 424242, ppid: process.pid, uid: process.getuid(), start: 'Sun Nov 15 10:00:00 2026', command: 'node fake' }, expected: 'birth_report_missing' },
  ]) {
    const root = mkdtempSync(join(tmpdir(), 'guard3-failure-'))
    const spy = fakeSpawn({ writeBirth: scenario.writeBirth })
    try {
      await assert.rejects(
        () => spawnOwnProbe({ root, operation: 'h1-failure', spawnImpl: spy.spawnImpl, observer: () => scenario.observed, killImpl: spy.killImpl, birthTimeoutMs: 30 }),
        (error) => {
          assert.equal(error.retained?.reason, scenario.expected)
          assert.equal(error.retained?.signalSent, false)
          assert.equal(error.retained?.pid, 424242)
          return true
        },
      )
      assert.equal(spy.childKill, 0, `${scenario.id}: raw child.kill must stay 0`)
      assert.equal(spy.processKill, 0, `${scenario.id}: process.kill must stay 0`)
      assert.equal(spy.child.exitCode, null, `${scenario.id}: child is retained, not cleaned`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})

test('identity mismatch at birth retains the probe and sends no signal', async () => {
  const root = mkdtempSync(join(tmpdir(), 'guard3-mismatch-'))
  const spy = fakeSpawn({ writeBirth: true })
  try {
    await assert.rejects(
      () => spawnOwnProbe({ root, operation: 'h1-mismatch', spawnImpl: spy.spawnImpl, observer: () => ({ state: 'alive', pid: 424242, ppid: 1, uid: process.getuid(), start: 'Sun Nov 15 10:00:00 2026', command: 'node fake' }), killImpl: spy.killImpl, birthTimeoutMs: 100 }),
      (error) => {
        assert.equal(error.retained?.reason, 'identity_mismatch')
        assert.ok(error.retained?.issues.includes('ppid_mismatch'))
        return true
      },
    )
    assert.equal(spy.childKill, 0)
    assert.equal(spy.processKill, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a complete mocked birth signals only through the registered handle and kill injection', async () => {
  const root = mkdtempSync(join(tmpdir(), 'guard3-success-'))
  const spy = fakeSpawn({ writeBirth: true })
  const observed = () => ({ state: 'alive', pid: 424242, ppid: process.pid, uid: process.getuid(), start: 'Sun Nov 15 10:00:00 2026', command: [process.execPath, ...spy.argv].join(' ') })
  try {
    const probe = await spawnOwnProbe({ root, operation: 'h1-success', spawnImpl: spy.spawnImpl, observer: observed, killImpl: spy.killImpl, birthTimeoutMs: 100 })
    assert.equal(probe.observation.executable, process.execPath)
    assert.deepEqual(probe.observation.launch.argv.slice(1), probe.observation.argv)
    assert.equal(probe.observation.launch.argv[0], probe.observation.executable)
    const result = signalFresh({ handle: probe.handle, signal: 'SIGTERM', observer: observed, killImpl: spy.killImpl })
    assert.equal(result.sent, true)
    assert.equal(spy.processKill, 1)
    assert.equal(spy.childKill, 0)
    probe.observation.pid = 1
    probe.observation.launch.argv = ['/bin/false']
    const again = signalFresh({ handle: probe.handle, signal: 'SIGTERM', observer: observed, killImpl: spy.killImpl, dryRun: true })
    assert.equal(again.wouldSignal.pid, 424242)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test('failure controls: every incomplete birth retains material with zero child.kill and zero process.kill', async () => {
  const baseRoot = mkdtempSync(join(tmpdir(), 'guard3-failure-suite-'))
  try {
    const report = await failureControls({ baseRoot })
    assert.equal(report.ok, true, JSON.stringify(report.cases))
    assert.equal(report.childKillCalls, 0)
    assert.equal(report.processKillCalls, 0)
    assert.deepEqual(report.cases.map((entry) => entry.retainedReason), ['observation_unknown', 'birth_report_missing', 'identity_mismatch'])
    assert.ok(report.cases.every((entry) => entry.spawns === 1 && entry.childExitCode === null))
  } finally {
    rmSync(baseRoot, { recursive: true, force: true })
  }
})
