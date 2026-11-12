import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { DISCUSSION_PROJECT, NativeAdmissionError, preparePersonalStartup } from '../../apps/coordinator/product/native-startup.ts'

const principal = { userId: 'discussion-user', authorityRef: 'discussion-authority' }, actor = { ...principal, source: 'local_cli' }
const scope = { projectId: 'legacy-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
function fixture(t) {
  const root = mkdtempSync('/tmp/pa-discussion-'), stateRoot = join(root, 'state'), project = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(project)
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), runtimes = []
  let calls = 0
  const requests = []
  const status = () => ({ protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1', model: 'mock', models: ['mock'], state: 'configured', secureTransport: true })
  const provider = { status, selectModel: status, reply: async (messages, onDelta) => { calls++; requests.push(messages); onDelta?.('讨论回复'); return { text: '讨论回复', model: 'mock' } } }
  const runtime = extra => {
    const value = createProductRuntime({ store, stateRoot, scratchProject: project, principal,
      projects: [{ id: scope.projectId, displayName: '原有项目', scope }, DISCUSSION_PROJECT], actionSecret: Buffer.alloc(32, 61), assistantProvider: provider, ...extra })
    runtimes.push(value); return value
  }
  t.after(async () => { for (const value of runtimes) await value.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, store, runtime, requests, get calls() { return calls } }
}
const create = (id = 'work-command') => ({ kind: 'create_work', commandId: id, conversationId: 'conversation', projectId: scope.projectId,
  goal: 'Legacy pending work', scope, profileId: 'profile-fixture-pass', criteria: [{ id: 'check', kind: 'machine', required: true, description: 'Registered check', checkDefinitionRef: 'check-fixture-output' }] })
const oldQueue = store => store.db.prepare("SELECT * FROM effect WHERE kind <> 'application.assistant.reply' ORDER BY kind, key").all()

test('expected unavailable startup does not need a Git project or silently enable a fixture', t => {
  const h = fixture(t)
  for (const reason of ['not_installed', 'incompatible_version', 'probe_failed']) {
    const result = preparePersonalStartup(h.root, { admit: () => { throw new NativeAdmissionError(reason) } })
    assert.equal(result.executionUnavailable, reason); assert.equal('native' in result, false); assert.deepEqual(result.projects, [])
  }
  const explicit = preparePersonalStartup(h.root, { discussionOnly: true, admit: () => { throw Error('Must not probe') } })
  assert.equal(explicit.executionUnavailable, 'operator_disabled')
  assert.throws(() => preparePersonalStartup(h.root, { admit: () => { throw Error('Unclassified corruption') } }), /Unclassified corruption/)
})
test('corrupt private registry data fails instead of becoming an empty safe state', t => {
  const h = fixture(t)
  writeFileSync(join(h.root, 'native-projects.json'), '{broken', { mode: 0o600 })
  assert.throws(() => preparePersonalStartup(h.root, { discussionOnly: true }))
})
test('discussion runtime publishes only blocked native readiness and still streams and stores a reply', async t => {
  const h = fixture(t), p = h.runtime({ executionUnavailable: 'not_installed' }), configuration = await p.read.configuration()
  assert.deepEqual(configuration.executionAvailability, { state: 'unavailable', reason: 'not_installed' })
  assert.equal(configuration.profiles.length, 1); assert.equal(configuration.profiles[0].kind, 'native')
  assert.equal(configuration.profiles[0].readiness, 'missing'); assert.equal(configuration.profiles[0].dispatchAllowed, false)
  assert.equal(configuration.projects.some(project => project.dispatchAllowed || project.defaultProfileId), false)
  assert.deepEqual(configuration.checks, []); assert.equal(configuration.contextHistoryAvailable, true); assert.equal(configuration.contextSourcesAvailable, true)
  p.start()
  const receipt = await p.application.dispatch({ kind: 'chat', commandId: 'chat', conversationId: 'conversation', projectId: DISCUSSION_PROJECT.id, text: '请帮我拆解需求' }, actor)
  assert.equal(receipt.status, 'recorded'); p.execution.effects.kick(); await p.execution.effects.idle()
  assert.equal(h.calls, 1); assert.match(h.requests[0][0].content, /开发执行器未就绪/); assert.doesNotMatch(h.requests[0][0].content, /固定 scratch/)
  const reply = h.store.product.messages.page('conversation').messages.find(message => message.provenance === 'reasoner_reply')
  assert.equal(reply.text, '讨论回复'); assert.ok(h.store.workflows.assistant.replyResults.forReply(reply.id))
  assert.equal(h.store.domain.tickets.list().length, 0)
})
test('old business queues, unknown writer binding and original command receipt remain intact', async t => {
  const h = fixture(t), prior = h.runtime({}), command = create()
  const original = await prior.application.dispatch(command, actor), view = (await prior.application.inspect({ workId: original.workId })).works[0]
  const binding = { ...view.actions.currentAssignment, attemptId: 'old-attempt', fenceEpoch: 1, runnerIdentityRef: 'old-runner', source: 'codex-native', state: 'active',
    resources: [{ ref: 'unverified-old-writer', ownership: 'spawned_process' }] }
  h.store.bindings.record(binding); h.store.bindings.setCurrent(binding.ticketId, binding.attemptId)
  h.store.queue.enqueue('questions.answer', 'old-answer', '{"must":"remain-unconsumed"}', h.store.queue.maxSeq() + 1, 0, new Date().toISOString())
  const queued = oldQueue(h.store), before = structuredClone(h.store.bindings.current(binding.ticketId))
  await prior.close()
  const p = h.runtime({ executionUnavailable: 'incompatible_version' })
  p.start(); await p.execution.effects.idle()
  assert.deepEqual(oldQueue(h.store), queued); assert.deepEqual(h.store.bindings.current(binding.ticketId), before)
  assert.deepEqual(await p.application.dispatch(command, actor), original)
  const readonly = (await p.application.inspect({ workId: original.workId })).works[0]
  assert.equal(readonly.resourceStatus, 'indeterminate'); assert.equal(readonly.phase, 'uncertain'); assert.deepEqual(readonly.actions.available, [])
  assert.equal(h.calls, 0)
})
test('every new work/control/anchored-chat/verification command refuses before modifying the old work', async t => {
  const h = fixture(t), prior = h.runtime({}), original = await prior.application.dispatch(create(), actor)
  const view = (await prior.application.inspect({ workId: original.workId })).works[0], assignment = view.actions.currentAssignment
  const ref = { workId: view.contract.workId, revision: view.contract.revision, digest: view.contract.digest }
  const candidate = { ...assignment, candidateGeneration: 1 }, snapshot = oldQueue(h.store)
  await prior.close(); const p = h.runtime({ executionUnavailable: 'not_installed' })
  const commands = [create('new-work'), { kind: 'stop_work', workId: original.workId }, { kind: 'continue_work', expected: ref },
    { kind: 'pause_dispatch', expected: ref, expectedHoldRevision: 0 }, { kind: 'resume_dispatch', expected: ref, expectedHoldRevision: 0 },
    { kind: 'retry_assignment', expected: assignment, actionToken: 'old-token' }, { kind: 'accept_candidate', candidate },
    { kind: 'answer_question', questionId: 'old-question', expectedVersion: 1, answer: { kind: 'free_text', text: 'do not send' } },
    { kind: 'chat', projectId: scope.projectId, text: 'do not steer', anchor: { workId: original.workId } }]
  for (const [index, body] of commands.entries()) {
    const command = { commandId: `blocked-${index}`, conversationId: 'conversation', ...body }
    const receipt = await p.application.dispatch(command, actor)
    assert.equal(receipt.status, 'rejected'); assert.equal(receipt.error.code, 'unsupported_capability')
    assert.deepEqual(await p.application.dispatch(command, actor), receipt)
  }
  const verified = await p.operations.retryVerification({ kind: 'retry_verification', commandId: 'blocked-verification', conversationId: 'conversation', candidate, blockedId: 'old-block' }, actor)
  assert.equal(verified.status, 'rejected'); assert.equal(verified.error.code, 'unsupported_capability')
  assert.equal(h.store.product.works.listByProject(scope.projectId).length, 1); assert.deepEqual(oldQueue(h.store), snapshot)
  assert.equal(h.calls, 0)
})
test('explicit context discussion remains available without work admission', async t => {
  const h = fixture(t), p = h.runtime({ executionUnavailable: 'operator_disabled' })
  h.store.product.messages.append({ id: 'discussion-source', conversationId: 'conversation', projectId: scope.projectId, role: 'user', provenance: 'trusted_user', text: 'Keep error codes.', sourceRefs: [], createdAt: new Date().toISOString() })
  const prepared = await p.operations.assistantContextPrepare({ commandId: 'selected', text: 'Explain the scope.', context: { projectId: scope.projectId, conversationId: 'conversation', selections: ['project', 'conversation'], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } } }, actor)
  assert.equal((await p.operations.assistantContextSend({ commandId: prepared.commandId, token: prepared.token }, actor)).status, 'recorded')
  p.start(); await p.execution.effects.idle()
  const messageId = key('message', 'selected')
  assert.equal((await p.read.contextHistory({ projectId: scope.projectId })).entries[0].messageId, messageId)
  assert.equal((await p.read.contextSources(messageId)).state, 'verified')
  assert.equal(h.calls, 1); assert.equal(h.store.domain.tickets.list().length, 0)
})
test('the permanent discussion workspace stays non-executable even in an explicit fixture runtime', async t => {
  const h = fixture(t), p = h.runtime({}), configuration = await p.read.configuration(), project = configuration.projects.find(project => project.id === DISCUSSION_PROJECT.id)
  assert.equal(project.dispatchAllowed, false); assert.equal(project.discussionOnly, true)
  const receipt = await p.application.dispatch({ ...create('no-discussion-work'), projectId: DISCUSSION_PROJECT.id, scope: DISCUSSION_PROJECT.scope }, actor)
  assert.equal(receipt.status, 'rejected'); assert.equal(receipt.error.code, 'unsupported_capability')
})
