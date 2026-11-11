import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { fixture, actor, scope, createCommand } from '../../packages/application/test/helpers.ts'
import { ProductRecovery } from '../../apps/coordinator/product/recovery.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

function setup(t) {
  const h = fixture(t), source = join(h.directory, 'rebound-project')
  mkdirSync(source); writeFileSync(join(source, 'index.mjs'), 'export const ok = true\n')
  const git = args => execFileSync('git', args, { cwd: source, encoding: 'utf8', stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs']); git(['-c', 'user.name=Recovery Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Recovery base'])
  const marker = join(h.directory, 'restore-report.json')
  const bytes = JSON.stringify({ protocol: 'personal-restore/1', targetPath: h.directory,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 13 }, evidence: { status: 'verified' } })
  writeFileSync(marker, bytes, { mode: 0o600 })
  const profile = { id: 'profile-fixture-diagnostic', revision: 1, expectedVersion: process.version, executable: process.execPath }
  const options = { stateRoot: h.directory, startupMode: 'recovery_readonly', principal: actor,
    projects: () => [{ id: scope.projectId, displayName: 'Restored project' }], executor: () => profile,
    now: () => '2026-11-11T00:00:00.000Z' }
  const recovery = new ProductRecovery(h.store, options)
  const input = () => ({ expectedFingerprint: recovery.inspect().inspectionFingerprint,
    bindings: [{ sourceProjectId: scope.projectId, project: { path: source, check: 'node_test' } }] })
  return { ...h, recovery, options, source, marker, bytes, input }
}
test('recovery inspect and project preflight change no DB, marker, project registry or old queue', t => {
  const h = setup(t), cursor = h.store.events.cursor()
  h.store.queue.enqueue('application.execute', 'old-job', '{"old":true}', 1, 0, '2026-11-10T00:00:00.000Z')
  const before = h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10)
  const inspection = h.recovery.inspect(), plan = h.recovery.prepare(h.input(), actor)
  assert.equal(inspection.state, 'recovery_readonly')
  assert.equal(inspection.heldQueue.waiting, 1)
  assert.equal(plan.authorization, 'not_granted')
  assert.equal(plan.commitAvailable, false)
  assert.equal(plan.bindings[0].sourceProjectId, scope.projectId)
  assert.notEqual(plan.bindings[0].proposedProjectId, scope.projectId, 'A rebound identity is not silently substituted for an old source')
  assert.ok(plan.blockers.some(value => value.code === 'authorization_not_implemented'))
  assert.equal(h.store.events.cursor(), cursor)
  assert.deepEqual(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10), before)
  assert.equal(readFileSync(h.marker, 'utf8'), h.bytes)
  assert.equal(h.store.commands.get(plan.planId), undefined)
})
test('stale fingerprints, another actor/project and dirty targets are refused', t => {
  const h = setup(t), stale = h.input()
  h.store.events.append({ topic: 'test.changed', entityRef: 'change-one', payload: {} })
  assert.throws(() => h.recovery.prepare(stale, actor), error => error.error.code === 'conflict')
  assert.throws(() => h.recovery.prepare(h.input(), { ...actor, authorityRef: 'foreign-authority' }), error => error.error.code === 'forbidden')
  assert.throws(() => h.recovery.prepare({ ...h.input(), bindings: [{ sourceProjectId: 'unconfigured', project: { path: h.source, check: 'node_test' } }] }, actor), error => error.error.code === 'forbidden')
  writeFileSync(join(h.source, 'dirty.txt'), 'not committed')
  assert.throws(() => h.recovery.prepare(h.input(), actor), error => error.error.code === 'conflict')
})
test('read-only Git preflight cannot execute a repository filesystem-monitor command', t => {
  const h = setup(t), program = join(h.directory, 'monitor.sh'), sentinel = join(h.directory, 'monitor-ran')
  writeFileSync(program, `#!/bin/sh\ntouch '${sentinel}'\n`, { mode: 0o700 })
  execFileSync('git', ['config', 'core.fsmonitor', program], { cwd: h.source, stdio: 'pipe' })
  const before = h.store.events.cursor()
  h.recovery.prepare(h.input(), actor)
  assert.throws(() => readFileSync(sentinel))
  assert.equal(h.store.events.cursor(), before)
})
test('unsafe, redirected and mismatched restore markers cannot become a binding plan', t => {
  const h = setup(t)
  chmodSync(h.marker, 0o644)
  assert.ok(h.recovery.inspect().blockers.some(value => value.code === 'marker_invalid'))
  assert.throws(() => h.recovery.prepare(h.input(), actor), error => error.error.code === 'verification_failed')
  chmodSync(h.marker, 0o600)
  writeFileSync(h.marker, JSON.stringify({ ...JSON.parse(h.bytes), targetPath: h.source }))
  assert.ok(h.recovery.inspect().blockers.some(value => value.code === 'marker_invalid'))
  const target = join(h.directory, 'marker-copy.json'); writeFileSync(target, h.bytes, { mode: 0o600 }); unlinkSync(h.marker); symlinkSync(target, h.marker)
  assert.ok(h.recovery.inspect().blockers.some(value => value.code === 'marker_invalid'))
})
test('old ended bindings are not fresh resource proof, and missing bytes or executor are explicit gaps', async t => {
  const h = setup(t), created = await h.app.dispatch(createCommand(), actor), active = await h.start(created.workId)
  h.store.bindings.record({ ...active.binding, state: 'ended' })
  const artifact = h.store.artifacts.write(Buffer.from('required evidence')); h.store.artifacts.insert(artifact)
  unlinkSync(h.store.artifacts.filePath(artifact.id))
  const recovery = new ProductRecovery(h.store, { ...h.options, executor: () => { throw new Error('unavailable') } })
  const plan = recovery.prepare({ ...h.input(), expectedFingerprint: recovery.inspect().inspectionFingerprint }, actor)
  for (const code of ['historical_resources_need_revalidation', 'artifact_missing_or_corrupt', 'executor_unavailable'])
    assert.ok(plan.blockers.some(value => value.code === code), code)
  assert.equal(plan.authorization, 'not_granted')
})
test('only authenticated recovery preflight is exempt from the readonly mutation guard', async t => {
  const h = setup(t), options = { application: h.app, principal: actor, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'product', startupMode: 'recovery_readonly',
    read: { recovery: async () => h.recovery.inspect() }, operations: { retryVerification: h.app.retryVerification.bind(h.app), recoveryPrepare: async (input, trusted) => h.recovery.prepare(input, trusted) } }
  const http = createLocalHttpApp(options), headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
  assert.equal((await http.request('http://127.0.0.1/v1/recovery/inspect')).status, 401)
  assert.equal((await http.request('http://127.0.0.1/v1/recovery/inspect?force=true', { headers })).status, 400)
  const response = await http.request('http://127.0.0.1/v1/recovery/prepare', { method: 'POST', headers, body: JSON.stringify(h.input()) })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).authorization, 'not_granted')
  assert.equal((await http.request('http://127.0.0.1/v1/recovery/prepare', { method: 'POST', headers, body: JSON.stringify({ ...h.input(), force: true }) })).status, 400)
  for (const path of ['/v1/recovery/commit', '/v1/commands', '/v1/decisions/commands'])
    assert.equal((await http.request(`http://127.0.0.1${path}`, { method: 'POST', headers, body: '{}' })).status, 422)
  const normal = createLocalHttpApp({ ...options, startupMode: 'normal' })
  assert.equal((await normal.request('http://127.0.0.1/v1/recovery/prepare', { method: 'POST', headers, body: JSON.stringify(h.input()) })).status, 422)
})
