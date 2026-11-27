import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { AcpDriver, AcpV1SettingsSchema } from '../../packages/drivers/acp-v1/src/index.ts'
import { createControlledAcpAgent } from '../../packages/drivers/acp-v1/test/controlled-agent.ts'
import { attemptIdentity } from '../../packages/driver-kit/src/index.ts'
import { JsonSchema, PreparedExecutionPolicySchema } from '../../packages/contracts/src/schemas.ts'
import { nativeCallbackLink } from './fixtures/native-callback-link.ts'

const principal = { userId: 'standard-acp-consumer', authorityRef: 'standard-acp-authority' }
async function until(read, predicate, label) {
  const deadline = Date.now() + 8000
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await new Promise(resolve => setTimeout(resolve, 15))
  }
  throw new Error(`${label}: ${JSON.stringify(last, (key, value) => /token|secret|api.?key|credential/i.test(key) ? '<REDACTED>' : value)}`)
}

for (const scenario of ['allow', 'deny', 'deny_bad_exit', 'cancel', 'cancel_after_written']) test(`standard ACP ${scenario}: original HTTP/Application/Broker/Runner consumer`, { timeout: 15000 }, async t => {
  const root = mkdtempSync('/tmp/pa-standard-acp-'), projectPath = join(root, 'project'), stateRoot = join(root, 'state')
  mkdirSync(join(projectPath, 'src'), { recursive: true }); mkdirSync(stateRoot)
  writeFileSync(join(projectPath, 'src/base.txt'), 'Original project\n')
  const git = args => execFileSync('git', args, { cwd: projectPath, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/base.txt']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'initial'])
  const trace = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0, protocolMethods: [], errors: [], closers: [] }
  const cancelling = scenario.startsWith('cancel')
  const denying = scenario.startsWith('deny')
  const peer = createControlledAcpAgent({ permission: !cancelling, hold: cancelling })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const scope = { projectId: 'one', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
  const profile = { id: 'profile-controlled-acp', revision: 1, driverId: 'acp-v1', driverApiMajor: 1,
    driverRelease: 'controlled-official-sdk', executable: process.execPath, argv: [], expectedVersion: 'controlled-only',
    nativeConfigRef: 'controlled-acp-settings', permissionPolicyRevision: 'controlled-policy', requiredFeatures: [] }
  const check = { id: 'standard-acp-output-check', revision: 1, executable: process.execPath,
    argv: ['-e', "if(require('node:fs').readFileSync('src/product-output.txt','utf8')!=='approved product output\\n')process.exit(1)"],
    deadlineMs: 1000, outputLimitBytes: 1024 }
  const executor = { profile, profileView: { id: profile.id, revision: 1, driverId: 'acp-v1', kind: 'native',
    displayName: 'Controlled ACP SDK peer (no vendor)', readiness: 'inspection_passed', dispatchAllowed: true,
    trialAdmission: { mode: 'explicit_trial', identityDigest: 'c'.repeat(64), policyDigest: 'a'.repeat(64), confirmationCommandId: 'controlled-fixture-consent-only' },
    compatibility: { classification: 'compatible_unverified', nativeVersion: 'controlled-only', protocol: 'acp-v1', schemaDigest: 'd'.repeat(64),
      checkedAt: '2026-11-27T01:00:00.000Z', operations: ['begin', 'answer', 'steer', 'cancel', 'resume'].map(operation => ({
        operation, supported: !['steer', 'resume'].includes(operation), validation: 'controlled', enabled: !['steer', 'resume'].includes(operation),
      })) } },
    policyIdentity: 'a'.repeat(64), admissionCurrent: () => true, projects: [{ id: 'one', path: projectPath, check }],
    settings: ({ workspacePath, scope }) => JsonSchema.parse(AcpV1SettingsSchema.parse({ kind: 'acp-v1-settings/1', workspacePath, scope, timeoutMs: 5000 })) }
  const fingerprint = 'b'.repeat(64)
  const policyHost = {
    async prepare(input) {
      // This witness is for the virtual protocol fixture only, never a production policy admission.
      const evidence = await input.io.payloads.store({ controlledOnly: true, scope: input.settings.scope }, 'critical')
      return { policy: PreparedExecutionPolicySchema.parse({ ...attemptIdentity(input.spec), requestedPolicyRevision: profile.permissionPolicyRevision,
        nativeAppliedSettingsRef: evidence, effectiveConfigFingerprint: fingerprint, enforcement: 'enforced', verification: 'passed', evidenceRef: evidence }),
        currentFingerprint: fingerprint }
    },
    async currentFingerprint() { return fingerprint },
  }
  const originalKill = process.kill, suppressedSignals = []
  process.kill = (pid, signal) => { suppressedSignals.push({ pid, signal }); return true }
  const product = createProductRuntime({ store, stateRoot, scratchProject: projectPath, principal, actionSecret: Buffer.alloc(32, 52),
    projects: [{ id: 'one', scope }], executors: [executor],
    nativeRunnerLinkFactory: nativeCallbackLink(trace, (spec, hooks) => {
      assert.equal(spec.profile.driverId, 'acp-v1', 'the selected ACP profile must reach the original Runner')
      const driver = new AcpDriver({ connect: peer.connect, policyHost, beforeAnswerWrite: hooks.beforeNativeWrite, businessOpen: hooks.isBusinessOpen })
      return { inspect: driver.inspect.bind(driver), reconcile: driver.reconcile.bind(driver),
        serve: async (spec, io) => {
          const exit = await driver.serve(spec, { ...io, commands: (async function* () {
            for await (const command of io.commands) { (trace.controlCommands ??= []).push(command.kind); yield command }
          })() })
          return scenario === 'deny_bad_exit' ? { ...exit, reason: 'terminal' } : exit
        } }
    }) })
  t.after(async () => {
    try { await product.close(); await Promise.all(trace.closers.map(close => close())); peer.close() }
    finally { process.kill = originalKill; store.close(); rmSync(root, { recursive: true, force: true }) }
  })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    mode: 'fixture', allowedOrigins: [], read: product.read, operations: product.operations })
  const post = async body => {
    const response = await app.request('http://127.0.0.1/v1/commands', { method: 'POST',
      headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }, body: JSON.stringify({ conversationId: 'conv-main', ...body }) })
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result
  }
  product.start()
  const created = await post({ kind: 'create_work', commandId: `acp-${scenario}-create`, projectId: 'one', profileId: profile.id,
    goal: 'Prepare the requested output using the selected standard ACP Agent', scope,
    criteria: [{ id: 'tests', kind: 'machine', required: true, description: 'Registered output check', checkDefinitionRef: check.id },
      { id: 'review', kind: 'human', required: true, description: 'Review frozen patch' }] })
  assert.equal(created.status, 'recorded')
  const snapshot = () => product.application.inspect({ workId: created.workId })
  if (cancelling) {
    await until(() => peer.observations.prompts, value => value.length === 1, 'ACP prompt in flight')
    const active = (await snapshot()).works[0]
    if (scenario === 'cancel_after_written') await until(() => {
      const binding = store.bindings.current(active.links[0].ticketId)
      return store.db.prepare('SELECT delivery FROM dispatch_receipts WHERE target = ?').all(binding.attemptId)
    }, rows => rows.some(row => row.delivery === 'written'), 'Original written dispatch observation')
    assert.equal(active.resourceStatus, 'active')
    assert.equal((await post({ kind: 'stop_work', commandId: 'acp-stop-running', workId: created.workId })).status, 'recorded')
    await until(snapshot, value => value.works[0].resourceStatus === 'quiescent', 'Original resource barrier')
    assert.equal(peer.observations.cancellations.length, 1, 'standard cancel reached the still-running ACP session')
    if (scenario === 'cancel_after_written') {
      assert.equal(trace.controlCommands.filter(kind => kind === 'cancel').length, 1)
      assert.equal(trace.spawnAdmissionClosures, 1, 'original Runner revoked new spawn admission before control drain')
    }
    assert.equal(peer.observations.writes.length, 0)
    assert.equal(peer.observations.prompts.length, 1)
    assert.equal((await snapshot()).works[0].phase, 'ended')
    return
  }
  const questioned = await until(snapshot, value => value.questions.length === 1, 'Original ACP permission question')
  const question = questioned.questions[0]
  assert.equal(question.kind, 'permission')
  assert.equal(question.targets[0].nativeMethod, 'session/request_permission')
  const executionURL = `http://127.0.0.1/v1/works/${created.workId}/execution`
  assert.equal((await app.request(executionURL)).status, 401)
  assert.equal((await app.request(executionURL + '?actor=forged', { headers: { authorization: `Bearer ${'a'.repeat(64)}` } })).status, 400)
  const executionView = await app.request(executionURL, { headers: { authorization: `Bearer ${'a'.repeat(64)}` } })
  const execution = await executionView.json()
  assert.equal(execution.profileId, profile.id)
  assert.equal(execution.driverId, 'acp-v1')
  assert.equal(execution.runningInput, 'unsupported')
  assert.doesNotMatch(JSON.stringify(execution), /executable|argv|credential|workspacePath/)
  const beforeInputs = store.domain.tickets.get(question.targets[0].ticketId).undelivered
  const unsupported = await post({ kind: 'chat', commandId: `acp-${scenario}-unsupported-steer`, projectId: 'one',
    text: 'This must not poison the running Work input queue', anchor: { workId: created.workId } })
  assert.equal(unsupported.status, 'rejected')
  assert.equal(unsupported.error.code, 'unsupported_capability')
  assert.deepEqual(store.domain.tickets.get(question.targets[0].ticketId).undelivered, beforeInputs)
  const answer = { kind: 'answer_question', commandId: `acp-${scenario}-answer`, questionId: question.id, expectedVersion: question.version,
    answer: { kind: 'choices', optionIds: [question.presentation.options.find(option => option.semantic === (scenario === 'allow' ? 'allow_once' : 'deny')).id] } }
  assert.equal((await post(answer)).status, 'recorded')
  assert.equal((await post(answer)).status, 'recorded', 'same-ID replay uses the original command receipt')
  if (denying) {
    await until(snapshot, value => value.works[0].resourceStatus === 'quiescent', 'Denied Work released original resources')
    await until(snapshot, value => value.works[0].actions.available.includes('retry_assignment') ||
      value.works[0].actions.currentCandidate !== undefined, 'Original assignment consumed the refusal')
    assert.equal(peer.observations.writes.length, 0)
    assert.equal(peer.observations.prompts.length, 1)
    assert.equal(peer.observations.permissions[0].outcome.optionId, 'reject-once')
    assert.equal((await snapshot()).works[0].phase === 'delivered', false)
    assert.equal((await snapshot()).works[0].actions.currentCandidate, undefined, 'a refused native turn cannot become a candidate')
    return
  }
  const ready = await until(snapshot, value => value.works[0].actions.available.includes('accept_candidate'), 'Checked ACP candidate')
  const work = ready.works[0], binding = store.bindings.current(work.links[0].ticketId)
  assert.equal(binding.source, 'acp-v1')
  assert.equal(binding.state, 'ended')
  const deliveries = product.application.questions.currentDeliveries(question.id)
  assert.equal(deliveries[0].status, 'response_written')
  assert.equal(deliveries.some(value => value.status === 'native_applied'), false)
  assert.equal(peer.observations.prompts.length, 1)
  assert.equal(peer.observations.writes.length, 1)
  assert.match(peer.observations.prompts[0], /requested output/)
  assert.doesNotMatch(peer.observations.prompts[0], /^payload:/)
  assert.ok(store.events.after(0).some(event => event.topic === 'application.execution.progress' && event.entityRef === created.workId), 'SDK stream reached original public changes')
  const verification = await product.read.verification(work.actions.currentVerificationId)
  assert.equal(verification.results.find(result => result.criterionId === 'tests').outcome, 'PASS')
  assert.equal(work.phase === 'delivered', false)
  assert.equal((await post({ kind: 'accept_candidate', commandId: 'acp-accept-current', candidate: work.actions.currentCandidate })).status, 'recorded')
  assert.equal((await snapshot()).works[0].phase, 'delivered')
  assert.equal(readFileSync(join(projectPath, 'src/base.txt'), 'utf8'), 'Original project\n')
  assert.deepEqual(trace.errors, [])
  console.log(JSON.stringify({ scope: 'official ACP SDK peer / original product / controlled virtual resources',
    workId: created.workId, source: binding.source, phase: 'delivered', originalChecksAndHumanAcceptance: true,
    nativeAppliedClaimed: false, realVendorTurns: 0, realSignals: 0, physicalNativeProof: false,
    suppressedVerifierSignals: suppressedSignals.length }))
})
