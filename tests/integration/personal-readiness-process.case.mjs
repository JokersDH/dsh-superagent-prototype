import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductApplication } from '../../packages/application/dist/index.js'
import { DISCUSSION_PROJECT } from '../../apps/coordinator/product/native-startup.ts'
import { NativeProjectRegistry } from '../../apps/coordinator/product/project-registry.ts'
import { personalCase, waitUntil } from './fixtures/personal-startup.mjs'

const privateText = value => /fixture-private-version|fixture-readiness-key|private bin/.test(JSON.stringify(value))
for (const mode of ['missing', 'incompatible', 'probe_error', 'operator']) test(`actual personal API starts in ${mode} discussion mode, without native or fixture sends`, async t => {
  const h = await personalCase({ mode, noSystemPath: true }); t.after(() => h.close())
  await h.start()
  const config = (await h.json('/v1/configuration')).value, health = (await h.json('/v1/health')).value
  assert.equal(health.mode, 'personal')
  assert.deepEqual(config.executionAvailability, { state: 'unavailable', reason: h.expectedReason })
  assert.ok(config.profiles.length); assert.ok(config.profiles.every(profile => profile.kind === 'native' && !profile.dispatchAllowed))
  assert.ok(config.projects.every(project => !project.dispatchAllowed && !project.defaultProfileId))
  assert.equal(privateText(config), false); assert.deepEqual(config.checks, [])
  assert.equal(existsSync(join(h.state, 'scratch-project.json')), false)
  const reply = await h.json('/v1/commands', { kind: 'chat', commandId: `chat-${mode}`, conversationId: 'conversation', projectId: DISCUSSION_PROJECT.id, text: '请帮我梳理需求。' })
  assert.equal(reply.value.status, 'recorded')
  await waitUntil(async () => (await h.json('/v1/snapshot?conversationId=conversation')).value.conversation?.messages.some(message => message.provenance === 'reasoner_reply'))
  assert.equal(h.modelRequests.length, 1)
  assert.match(h.modelRequests[0].messages[0].content, /开发执行器未就绪/)
  const block = await h.json('/v1/commands', { kind: 'create_work', commandId: `work-${mode}`, conversationId: 'conversation', projectId: DISCUSSION_PROJECT.id,
    goal: 'Must never dispatch', scope: DISCUSSION_PROJECT.scope, profileId: 'profile-fixture-pass', criteria: [{ id: 'review', kind: 'human', required: true, description: 'Must refuse' }] })
  assert.equal(block.value.status, 'rejected'); assert.equal(block.value.error.code, 'unsupported_capability')
  assert.equal((await h.json('/v1/snapshot')).value.works.length, 0)
  assert.equal(existsSync(h.launchLog), false)
  if (mode === 'operator') { assert.equal(existsSync(h.whichLog), false); assert.equal(existsSync(h.versionLog), false) }
  const history = await h.json(`/v1/context/history?projectId=${DISCUSSION_PROJECT.id}`)
  assert.equal(history.status, 200); assert.deepEqual(history.value.entries, [])
})

test('the actual workbench manager serves personal HTTP UI with no admitted project/profile', async t => {
  const h = await personalCase({ mode: 'missing', workbench: true }); t.after(() => h.close())
  await h.start()
  assert.equal((await fetch(h.consoleURL)).status, 200)
  const config = (await h.json('/v1/configuration')).value, record = JSON.parse(readFileSync(join(h.state, 'workbench.json'), 'utf8'))
  assert.equal(config.projects.some(project => project.dispatchAllowed), false)
  assert.equal(record.mode, 'personal'); assert.equal(record.executionAvailability.state, 'unavailable')
  assert.equal(existsSync(h.launchLog), false); assert.equal(h.modelRequests.length, 0)
})

test('restore marker remains readonly and cannot activate model or old business queues', async t => {
  const h = await personalCase({ mode: 'operator' }); t.after(() => h.close())
  writeFileSync(join(h.state, 'restore-report.json'), '{}', { mode: 0o600 })
  const before = readFileSync(join(h.state, 'restore-report.json'))
  const store = new ProductStore({ path: join(h.state, 'state.sqlite') })
  store.queue.enqueue('application.execute', 'old-native', '{"keep":"unchanged"}', 1, 0, new Date().toISOString()); store.close()
  await h.start()
  const config = (await h.json('/v1/configuration')).value
  assert.deepEqual(config.executionAvailability, { state: 'unavailable', reason: 'recovery_readonly' })
  const receipt = await h.json('/v1/commands', { kind: 'chat', commandId: 'readonly-chat', conversationId: 'conversation', projectId: DISCUSSION_PROJECT.id, text: 'Do not send' })
  assert.notEqual(receipt.status, 200); assert.equal(h.modelRequests.length, 0)
  assert.deepEqual(readFileSync(join(h.state, 'restore-report.json')), before)
  await h.stop()
  const reopened = new ProductStore({ path: join(h.state, 'state.sqlite') })
  try { assert.equal(reopened.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10)[0].payload, '{"keep":"unchanged"}') }
  finally { reopened.close() }
})

test('startup data failure releases its own writer lease and preserves the corrupt registry', async t => {
  const h = await personalCase({ mode: 'operator' }); t.after(() => h.close())
  const file = join(h.state, 'native-projects.json'); writeFileSync(file, '{invalid-private-registry', { mode: 0o600 })
  await assert.rejects(h.start(), /Personal process exited/)
  assert.equal(readFileSync(file, 'utf8'), '{invalid-private-registry')
  const store = new ProductStore({ path: join(h.state, 'state.sqlite') })
  try { assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM writer_claim').get().n, 0) }
  finally { store.close() }
})

test('actual degraded process preserves pre-existing native work, unknown writer and queue bytes', async t => {
  const h = await personalCase({ mode: 'missing', noSystemPath: true }); t.after(() => h.close())
  const projectRoot = join(h.root, 'legacy-project'); mkdirSync(projectRoot)
  const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  git(['init', '-q']); writeFileSync(join(projectRoot, 'source.txt'), 'legacy source')
  git(['add', 'source.txt']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Legacy fixture'])
  const registry = new NativeProjectRegistry(h.state), record = registry.prepare({ path: projectRoot, displayName: '已有项目', check: 'node_test' })
  registry.save(record)
  const scope = registry.scope(record), store = new ProductStore({ path: join(h.state, 'state.sqlite') })
  const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }, actor = { ...principal, source: 'local_cli' }
  const app = createProductApplication({ store, principal, projects: [{ id: record.id, scope }], profileIds: ['profile-codex-native'],
    registeredChecks: ['check-legacy'], actionSecret: Buffer.alloc(32, 62), nativeFence: () => 'unknown' })
  const command = { kind: 'create_work', commandId: 'legacy-native-work', conversationId: 'legacy-conversation', projectId: record.id, goal: 'Keep the original native work',
    scope, profileId: 'profile-codex-native', criteria: [{ id: 'check', kind: 'machine', required: true, description: 'Original check', checkDefinitionRef: 'check-legacy' }] }
  const receipt = await app.dispatch(command, actor), view = (await app.inspect({ workId: receipt.workId })).works[0]
  const binding = { ...view.actions.currentAssignment, attemptId: 'legacy-live-attempt', fenceEpoch: 1, state: 'active', source: 'codex-native', runnerIdentityRef: 'legacy-runner',
    resources: [{ ref: 'unknown-legacy-writer', ownership: 'spawned_process' }] }
  store.bindings.record(binding); store.bindings.setCurrent(binding.ticketId, binding.attemptId)
  store.queue.enqueue('runtime.reconcile', binding.attemptId, JSON.stringify(binding.ticketId), store.queue.maxSeq() + 1, 0, new Date().toISOString())
  store.queue.enqueue('questions.answer', 'legacy-answer', '{"do":"not resend"}', store.queue.maxSeq() + 1, 0, new Date().toISOString())
  const queued = store.db.prepare('SELECT * FROM effect ORDER BY kind, key').all(), oldBinding = store.bindings.current(binding.ticketId)
  store.close(); await h.start()
  const current = await h.json(`/v1/snapshot?workId=${receipt.workId}`)
  assert.equal(current.value.works[0].phase, 'uncertain'); assert.equal(current.value.works[0].resourceStatus, 'indeterminate')
  assert.deepEqual(current.value.works[0].actions.available, [])
  assert.deepEqual((await h.json('/v1/commands', command)).value, receipt)
  const stop = await h.json('/v1/commands', { kind: 'stop_work', commandId: 'new-stop', conversationId: 'legacy-conversation', workId: receipt.workId })
  assert.equal(stop.value.status, 'rejected'); assert.equal(stop.value.error.code, 'unsupported_capability')
  await h.stop()
  const reopened = new ProductStore({ path: join(h.state, 'state.sqlite') })
  try {
    assert.deepEqual(reopened.db.prepare('SELECT * FROM effect ORDER BY kind, key').all(), queued)
    assert.deepEqual(reopened.bindings.current(binding.ticketId), oldBinding)
    assert.equal(reopened.product.works.get(receipt.workId).title, 'Keep the original native work')
  } finally { reopened.close() }
  assert.equal(h.modelRequests.length, 0); assert.equal(existsSync(h.launchLog), false)
})
