import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { executorProfiles, executorProfileRef } from '../../apps/coordinator/product/executor-profiles.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const principal = { userId: 'profile-consumer', authorityRef: 'profile-consumer-authority' }
const scope = { projectId: 'one', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
const check = { id: 'profile-check', revision: 1, executable: process.execPath, argv: ['-e', 'process.exit(0)'], deadlineMs: 1000, outputLimitBytes: 1024 }
const fixture = (root, id, driverId, current = () => true) => ({
  profile: { id, revision: 1, driverId, driverApiMajor: 1, driverRelease: 'controlled-only', executable: process.execPath,
    argv: [], expectedVersion: process.version, nativeConfigRef: `config-${id}`, permissionPolicyRevision: 'controlled-only', requiredFeatures: [] },
  // Synthetic admission tests composition, never vendor support, native policy or paid execution.
  profileView: { id, revision: 1, driverId, kind: 'native', displayName: `Controlled ${id}`, readiness: 'native_test_passed', dispatchAllowed: true },
  admissionCurrent: current, policyIdentity: (id === 'first' ? '1' : '2').repeat(64),
  projects: [{ id: 'one', path: root, check }],
  settings: ({ workspacePath, scope }) => ({ kind: 'controlled-profile-settings/1', workspacePath, scope, model: `${id}-model` }),
})
async function harness(t, entries) {
  const root = mkdtempSync('/tmp/pa-profiles-'), stateRoot = join(root, 'state')
  mkdirSync(stateRoot)
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const configs = entries(root)
  const product = createProductRuntime({ store, stateRoot, scratchProject: root, principal,
    actionSecret: Buffer.alloc(32, 31), projects: [{ id: 'one', scope }], executors: configs })
  const api = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    mode: 'fixture', allowedOrigins: [], read: product.read, operations: product.operations })
  t.after(async () => { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const post = async (profileId, commandId) => {
    const response = await api.request('http://127.0.0.1/v1/commands', { method: 'POST',
      headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'create_work', commandId, conversationId: 'conv-main', projectId: 'one', goal: 'Controlled composition test',
        scope, profileId, criteria: [{ id: 'tests', kind: 'machine', required: true, description: 'Registered check', checkDefinitionRef: check.id },
          { id: 'human', kind: 'human', required: true, description: 'Manual review' }] }) })
    assert.equal(response.status, 200)
    return response.json()
  }
  return { root, store, product, configs, api, post }
}

test('authenticated default configuration exposes independent profiles without leaking launch or policy settings', async t => {
  let secondCurrent = true
  const h = await harness(t, root => [fixture(root, 'first', 'codex-native'), fixture(root, 'second', 'acp-v1', () => secondCurrent)])
  const response = await h.api.request('http://127.0.0.1/v1/configuration', { headers: { authorization: `Bearer ${'a'.repeat(64)}` } })
  assert.equal(response.status, 200)
  const configuration = await response.json()
  assert.deepEqual(configuration.projects[0].profileIds, ['first', 'second'])
  assert.deepEqual(configuration.profiles.map(profile => profile.driverId), ['codex-native', 'acp-v1'])
  assert.doesNotMatch(JSON.stringify(configuration), /workspacePath|first-model|second-model|credentialReference|"executable"/)
  secondCurrent = false
  const changed = await h.product.read.configuration()
  assert.equal(changed.profiles.find(profile => profile.id === 'first').dispatchAllowed, true)
  assert.equal(changed.profiles.find(profile => profile.id === 'second').dispatchAllowed, false)
  assert.deepEqual(changed.projects[0].profileIds, ['first'])
  assert.equal(changed.executionAvailability.state, 'available')
  assert.equal((await h.post('second', 'blocked-second')).status, 'rejected')
  assert.equal((await h.post('first', 'allowed-first')).status, 'recorded')
})

test('each Work captures its selected immutable profile in its original transactional trigger', async t => {
  const h = await harness(t, root => [fixture(root, 'first', 'codex-native'), fixture(root, 'second', 'acp-v1')])
  const a = await h.post('first', 'create-first'), b = await h.post('second', 'create-second')
  for (const [receipt, config] of [[a, h.configs[0]], [b, h.configs[1]]]) {
    assert.equal(receipt.status, 'recorded')
    const work = (await h.product.application.inspect({ workId: receipt.workId })).works[0]
    const ticket = h.store.domain.tickets.get(work.links[0].ticketId)
    const origin = h.store.domain.triggers.get(ticket.origin.triggerId)
    assert.equal(origin.meta.profileId, config.profile.id)
    assert.deepEqual(origin.meta.executionProfile, executorProfileRef(config))
  }
  assert.equal((await h.post('unknown-driver-profile', 'reject-unknown')).status, 'rejected')
  assert.notEqual(a.workId, b.workId)
})

test('profile registry snapshots inputs, rejects duplicate identities and does not assign Codex policy to a foreign driver', () => {
  const a = fixture('/tmp/example', 'first', 'acp-v1')
  const entries = executorProfiles(undefined, [a])
  const original = executorProfileRef(entries[0])
  a.profile.revision = 2; a.projects[0].path = '/tmp/changed'
  assert.equal(entries[0].profile.revision, 1)
  assert.equal(entries[0].projects[0].path, '/tmp/example')
  assert.deepEqual(executorProfileRef(entries[0]), original)
  a.profile.revision = 1
  assert.throws(() => executorProfiles(undefined, [a, a]), /unique/)
  assert.throws(() => executorProfiles({ profile: a.profile, projects: a.projects, approvalPolicy: 'on-request' }), /explicit registered policy adapter/)
  assert.throws(() => executorProfiles(undefined, [{ ...a, profileView: { ...a.profileView, revision: 9 } }]), /must match/)
  for (const conflict of [{ path: '/tmp/foreign' }, { check: { ...check, id: 'foreign-check' } }, { environment: { policy: 'existing_only' } }]) {
    const other = fixture('/tmp/changed', 'second', 'codex-native')
    other.projects[0] = { ...other.projects[0], ...conflict }
    assert.throws(() => executorProfiles(undefined, [a, other]), /conflicting/)
  }
})

for (const missing of [false, true]) test(missing
  ? 'a legacy unstarted Codex Work needs explicit profile confirmation instead of inheriting new admission'
  : 'a queued Work with a changed profile binding is held before reserving or spawning a writer', { timeout: 5000 }, async t => {
  const h = await harness(t, root => [fixture(root, 'first', 'codex-native')])
  const receipt = await h.post('first', 'queued-profile-identity')
  const work = (await h.product.application.inspect({ workId: receipt.workId })).works[0]
  const ticket = h.store.domain.tickets.get(work.links[0].ticketId)
  const original = h.store.domain.triggers.get(ticket.origin.triggerId)
  // Simulate an original pre-snapshot row or a prior confirmed identity after configuration changed.
  if (missing) delete original.meta.executionProfile
  else original.meta.executionProfile.identityDigest = 'f'.repeat(64)
  h.store.uow.atomic(() => h.store.domain.triggers.save(original))
  h.product.start()
  const deadline = Date.now() + 3000
  while (!h.store.queue.parked('application.execute').length && Date.now() < deadline)
    await new Promise(resolve => setTimeout(resolve, 10))
  const rows = h.store.queue.parked('application.execute')
  assert.equal(rows.length, 1)
  assert.match(rows[0].parkedReason, missing ? /profile_snapshot_missing/ : /profile_changed/)
  assert.equal(h.store.bindings.current(ticket.id), undefined)
  assert.equal((await h.product.application.inspect({ workId: receipt.workId })).works[0].work.id, receipt.workId)
})
