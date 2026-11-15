import test from 'node:test'
import assert from 'node:assert/strict'
import { mockSuite, classifyFixtures, compareRecord3, signalFresh, waitGone } from './guard3.mjs'

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
