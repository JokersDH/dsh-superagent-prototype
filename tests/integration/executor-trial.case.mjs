import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'
import { classifyCompatibility } from '../../packages/catalog/src/compatibility.ts'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { readExecutorTrialAdmission } from '../../apps/coordinator/product/executor-trial.ts'
import { prepareInspectedPersonalStartup } from '../../apps/coordinator/product/inspected-startup.ts'
import { NativeAdmissionError } from '../../apps/coordinator/product/native-startup.ts'
import { inspectRecoveryExecutor, nativeInspectionPolicyDigest } from '../../apps/coordinator/product/native-inspection.ts'

const principal = { userId: 'trial-user', authorityRef: 'trial-authority' }
const headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
const digest = value => canonicalDigest(JSON.parse(JSON.stringify(value)))
function observation(revision = 1, status = 'observed') {
  const profile = { id: 'profile-codex-native', revision, driverId: 'codex-native', driverApiMajor: 1, driverRelease: 'controlled-test',
    executable: process.execPath, argv: [], expectedVersion: 'unverified-test-version', nativeConfigRef: 'test-settings',
    permissionPolicyRevision: 'test-policy-1', requiredFeatures: [] }
  const identity = { profileId: profile.id, profileRevision: revision, driverRelease: profile.driverRelease, driverApiMajor: 1,
    executableDigest: createHash('sha256').update(readFileSync(profile.executable)).digest('hex'), nativeVersion: profile.expectedVersion, wireVersion: 'test-protocol', schemaDigest: 'b'.repeat(64),
    resolvedConfigFingerprint: 'c'.repeat(64), permissionPolicyRevision: profile.permissionPolicyRevision, configStability: 'frozen',
    platform: process.platform, architecture: process.arch, runtimeVersion: process.version }
  const probe = { identity, capabilities: [], readiness: 'inspection_passed', checkedAt: '2026-11-26T00:00:00.000Z', evidenceRefs: [] }
  const surface = { wireVersion: identity.wireVersion, schemaDigest: identity.schemaDigest, methods: ['begin'], requestFields: {},
    enums: {}, notifications: [], serverRequests: [], requestIdTypes: ['integer', 'string'] }
  const verdict = classifyCompatibility({ profile, probe, surface: status === 'observed' ? { status, surface, evidenceRefs: [] }
    : { status, reason: 'incomplete-test-probe', evidenceRefs: [] }, required: { methods: ['begin'], requestFields: {}, enums: {}, notifications: [] } })
  return { profile, verdict, identityDigest: digest(identity), policyDigest: nativeInspectionPolicyDigest(profile, identity.executableDigest),
    operations: [{ operation: 'begin', supported: true, validation: 'controlled', enabled: false },
      { operation: 'steer', supported: null, validation: 'unobserved', enabled: false }] }
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pa-executor-trial-')), state = join(root, 'state')
  mkdirSync(state, { mode: 0o700 })
  let store = new ProductStore({ path: join(state, 'state.sqlite') }), facts = observation()
  const products = []
  const make = () => {
    const product = createProductRuntime({ store, stateRoot: state, scratchProject: root, principal, projects: [], actionSecret: Buffer.alloc(32, 47),
      executionUnavailable: 'incompatible_version', inspectExecutor: async () => structuredClone(facts) })
    products.push(product)
    const api = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
      mode: 'personal', allowedOrigins: ['http://127.0.0.1:4499'], read: product.read, operations: product.operations })
    return { product, api }
  }
  const { product, api } = make()
  const inspect = async () => {
    const response = await api.request('/v1/executors/trial', { headers })
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  const command = async () => { const value = await inspect(); return { commandId: value.confirmationCommandId, profileId: value.profile.id,
    revision: value.profile.revision, identityDigest: value.identityDigest, policyDigest: value.policyDigest, confirmUnverifiedVersion: true } }
  const send = (input, extra = {}) => api.request('/v1/executors/trial/confirm', { method: 'POST', headers, body: JSON.stringify(input), ...extra })
  t.after(async () => { for (const value of products) await value.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, state, product, api, inspect, command, send, get store() { return store }, get facts() { return structuredClone(facts) },
    trackRuntime(value) { products.push(value) },
    setFacts(value) { facts = value }, async reopen() { for (const value of products) await value.close(); store.close(); store = new ProductStore({ path: join(state, 'state.sqlite') }); return make() } }
}

test('inspection writes no authority; explicit consent records one original receipt and leaves execution disabled until normal reopening', async t => {
  const h = fixture(t), before = h.store.events.cursor(), inspection = await h.inspect()
  assert.equal(inspection.confirmationAvailable, true); assert.equal(inspection.profile.dispatchAllowed, false)
  assert.equal(h.store.events.cursor(), before)
  assert.equal(readExecutorTrialAdmission(h.store, h.facts, principal), undefined)
  const input = await h.command(), response = await h.send(input)
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json()
  assert.equal(result.effective, 'next_normal_start'); assert.equal(result.commandId, input.commandId)
  assert.equal(h.store.commands.get(input.commandId).seq, result.seq)
  assert.ok(readExecutorTrialAdmission(h.store, h.facts, principal))
  const configuration = await (await h.api.request('/v1/configuration', { headers })).json()
  assert.equal(configuration.executionAvailability.state, 'unavailable')
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('response loss reconciles against the same receipt across Store reopening without duplicate effects', async t => {
  const h = fixture(t), input = await h.command(), first = await h.send(input)
  assert.equal(first.status, 200, await first.clone().text())
  const receipt = await first.json(), cursor = h.store.events.cursor(), { api } = await h.reopen()
  const audit = await (await api.request('/v1/executors/trial', { headers })).json()
  assert.equal(audit.authorization, 'granted'); assert.equal(audit.confirmationCommandId, input.commandId)
  const replay = await api.request('/v1/executors/trial/confirm', { method: 'POST', headers, body: JSON.stringify(input) })
  assert.deepEqual(await replay.json(), receipt); assert.equal(h.store.events.cursor(), cursor)
})

test('changed identity, policy or incomplete observation cannot reuse a prior consent', async t => {
  const h = fixture(t), input = await h.command()
  assert.equal((await h.send(input)).status, 200)
  for (const facts of [observation(2), { ...observation(), policyDigest: 'e'.repeat(64) }, observation(1, 'partial'),
    { ...observation(), operations: [{ operation: 'begin', supported: true, validation: 'protocol', enabled: false }] }]) {
    h.setFacts(facts)
    assert.equal(readExecutorTrialAdmission(h.store, h.facts, principal), undefined)
    assert.notEqual((await h.send(input)).status, 200)
  }
  assert.ok(h.store.commands.get(input.commandId))
  const oldReceipt = await h.api.request(`/v1/executors/trial/receipts/${input.commandId}`, { headers })
  assert.equal(oldReceipt.status, 200)
  assert.equal((await oldReceipt.json()).identityDigest, input.identityDigest)
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('strict HTTP consent accepts no caller authority, forged digest, implicit agreement or unknown Origin', async t => {
  const h = fixture(t), input = await h.command()
  assert.equal((await h.send(input, { headers: { 'content-type': 'application/json' } })).status, 401)
  for (const extra of [{ actor: principal }, { force: true }, { confirmUnverifiedVersion: false }])
    assert.equal((await h.send({ ...input, ...extra })).status, 400)
  assert.equal((await h.send({ ...input, identityDigest: 'f'.repeat(64) })).status, 409)
  assert.equal((await h.send(input, { headers: { ...headers, origin: 'http://foreign.invalid' } })).status, 403)
  assert.equal(h.store.commands.get(input.commandId), undefined)
})

test('the default inspected startup consumes only a current original consent and keeps unknown controls disabled', async t => {
  const h = fixture(t), input = await h.command()
  const options = { admit() { throw new NativeAdmissionError('incompatible_version') }, inspect: async () => h.facts }
  const before = await prepareInspectedPersonalStartup(h.state, h.store, principal, options)
  assert.equal(before.executionUnavailable, 'not_admitted'); assert.equal('native' in before, false)
  assert.equal((await h.send(input)).status, 200)
  const after = await prepareInspectedPersonalStartup(h.state, h.store, principal, options)
  assert.equal(after.native.profileView.readiness, 'inspection_passed')
  assert.equal(after.native.profileView.trialAdmission.confirmationCommandId, input.commandId)
  assert.equal(after.native.profileView.compatibility.operations.find(item => item.operation === 'steer').enabled, false)
  assert.equal(after.native.admissionCurrent(), true)
  h.setFacts(observation(2))
  assert.equal('native' in await prepareInspectedPersonalStartup(h.state, h.store, principal, options), false)
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('a CLI replacement after startup invalidates the trusted new-attempt predicate without starting a task', async t => {
  const h = fixture(t), executable = join(h.root, 'fake-native-cli')
  writeFileSync(executable, 'original private executable', { mode: 0o700 })
  const facts = h.facts
  facts.profile.executable = executable
  facts.verdict.identity.executableDigest = createHash('sha256').update(readFileSync(executable)).digest('hex')
  facts.identityDigest = digest(facts.verdict.identity)
  facts.policyDigest = nativeInspectionPolicyDigest(facts.profile, facts.verdict.identity.executableDigest)
  h.setFacts(facts)
  assert.equal((await h.send(await h.command())).status, 200)
  const startup = await prepareInspectedPersonalStartup(h.state, h.store, principal, {
    admit() { throw new NativeAdmissionError('incompatible_version') }, inspect: async () => h.facts,
  })
  assert.equal(startup.native.admissionCurrent(), true)
  const active = createProductRuntime({ store: h.store, stateRoot: h.state, scratchProject: h.root, principal, projects: [],
    actionSecret: Buffer.alloc(32, 71), native: startup.native })
  h.trackRuntime(active)
  assert.equal((await active.read.configuration()).executionAvailability.state, 'available')
  writeFileSync(executable, 'replaced private executable', { mode: 0o700 })
  assert.equal(startup.native.admissionCurrent(), false)
  const changed = await active.read.configuration()
  assert.equal(changed.executionAvailability.state, 'unavailable')
  assert.equal(changed.profiles[0].dispatchAllowed, false)
  assert.equal(changed.profiles[0].compatibility.operations.some(operation => operation.enabled), false)
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('a consent receipt without its exact original command event grants no execution', async t => {
  const h = fixture(t), input = await h.command()
  const response = await h.send(input)
  assert.equal(response.status, 200)
  const record = await response.json()
  h.store.db.prepare('UPDATE event_log SET entity_ref = ? WHERE seq = ?').run('foreign-command', record.seq)
  assert.throws(() => readExecutorTrialAdmission(h.store, h.facts, principal), /original explicit consent/)
  const audit = await h.api.request(`/v1/executors/trial/receipts/${input.commandId}`, { headers })
  assert.notEqual(audit.status, 200)
})

test('copying a Store to a fresh root does not copy the original trial permission', async t => {
  const h = fixture(t), input = await h.command()
  assert.equal((await h.send(input)).status, 200)
  const copiedRoot = join(h.root, 'copied-state'); mkdirSync(copiedRoot, { mode: 0o700 })
  await h.store.db.backup(join(copiedRoot, 'state.sqlite'))
  const copied = new ProductStore({ path: join(copiedRoot, 'state.sqlite') })
  try { assert.equal(readExecutorTrialAdmission(copied, h.facts, principal), undefined) }
  finally { copied.close() }
})

test('a read-only recovery source can propose a compatible current version without copying old trial consent', async t => {
  const h = fixture(t)
  const options = { admit() { throw new NativeAdmissionError('incompatible_version') }, inspect: async () => h.facts }
  assert.deepEqual(await inspectRecoveryExecutor(options), h.facts.profile)
  assert.equal(h.store.events.cursor(), 0)
  assert.equal(readExecutorTrialAdmission(h.store, h.facts, principal), undefined)
  h.setFacts(observation(1, 'partial'))
  assert.equal(await inspectRecoveryExecutor(options), undefined)
})
