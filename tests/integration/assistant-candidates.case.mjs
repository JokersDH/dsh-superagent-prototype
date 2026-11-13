import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { candidateModel } from './fixtures/assistant-candidate-model.mjs'

const principal = { userId: 'candidate-user', authorityRef: 'candidate-authority' }, actor = { ...principal, source: 'local_cli' }
const projectId = 'candidate-project', conversationId = 'candidate-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
async function fixture(t, reply) {
  const model = await candidateModel({ reply }), stateRoot = join(model.root, 'state'), projectRoot = join(model.root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
  const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Candidate fixture'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
    projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 60), assistantProvider: model.provider })
  const http = (extra = {}) => createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', read: product.read, operations: product.operations, ...extra })
  const request = async (path, body, target = http(), headers = {}) => {
    const response = await target.request(`http://127.0.0.1${path}`, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json', ...headers } })
    return { status: response.status, value: await response.json() }
  }
  const chat = async (commandId = 'candidate-chat') => {
    const receipt = await product.application.dispatch({ kind: 'chat', commandId, projectId, conversationId, text: '请整理支付接口的约束。' }, actor)
    assert.equal(receipt.status, 'recorded'); product.start(); await product.execution.effects.idle('application.assistant.reply')
    return key('message', commandId)
  }
  const inspect = messageId => request(`/v1/messages/${encodeURIComponent(messageId)}/candidates`)
  const prepare = async messageId => {
    const review = await inspect(messageId); assert.equal(review.status, 200)
    const selected = review.value.candidates[0]; assert.ok(selected, JSON.stringify(review.value))
    const result = await request('/v1/assistant/candidates/prepare', { messageId, index: selected.index, payloadDigest: selected.payloadDigest })
    assert.equal(result.status, 200, JSON.stringify(result.value)); return { review: review.value, selected, preview: result.value }
  }
  const confirm = (preview, commandId = 'candidate-confirm', rest = {}) => request('/v1/proposals/commands', {
    kind: 'confirm_proposal', commandId, projectId, conversationId, token: preview.token, ...rest })
  t.after(async () => { await product.close(); store.close(); await model.close() })
  return { model, store, product, http, request, chat, inspect, prepare, confirm }
}
test('actual SDK data is stored in the original SQLite reply artifact and only inert verified candidates are exposed', async t => {
  const h = await fixture(t), messageId = await h.chat(), cursor = h.store.events.cursor(), changes = h.store.db.prepare('SELECT total_changes() AS n').get().n
  const { review, selected, preview } = await h.prepare(messageId)
  assert.equal(h.model.requests.length, 1); assert.equal(review.status, 'candidates'); assert.equal(review.executable, false)
  assert.equal(review.authorization, 'none'); assert.equal(selected.kind, 'propose_decision'); assert.deepEqual(selected.requiredInputs, [])
  assert.equal(preview.record.payload.content, '支付接口保留原有错误码。')
  assert.equal(preview.record.payloadDigest, selected.payloadDigest)
  assert.equal(h.store.commands.get(key('assistant-request', messageId)).result.sourceTextDigest, preview.record.sourceTextDigest)
  const result = h.store.workflows.assistant.replyResults.forRequest(key('assistant-request', messageId))
  const body = JSON.parse(h.store.artifacts.read(result.artifactRef).data.toString())
  assert.equal(body.suggestions.length, 1); assert.equal(body.sourceMessageId, messageId)
  assert.equal(h.store.events.cursor(), cursor); assert.equal(h.store.db.prepare('SELECT total_changes() AS n').get().n, changes)
  assert.equal(h.store.product.works.listByProject(projectId).length, 0)
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(JSON.stringify({ review, preview }).includes(h.model.key), false)
})
test('one explicit confirmation uses the existing decision/proposal transaction and its original receipt replays', async t => {
  const h = await fixture(t), messageId = await h.chat(), { preview } = await h.prepare(messageId)
  const first = await h.confirm(preview), replay = await h.confirm(preview)
  assert.equal(first.status, 200); assert.equal(first.value.status, 'recorded'); assert.deepEqual(replay, first)
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId).state, 'confirmed')
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get().n, 1)
  assert.equal(h.model.requests.length, 1); assert.equal(h.store.product.works.listByProject(projectId).length, 0)
  const result = h.store.workflows.assistant.replyResults.forRequest(key('assistant-request', messageId))
  writeFileSync(h.store.artifacts.filePath(result.artifactRef), 'corrupt after the recorded business result')
  assert.deepEqual(await h.confirm(preview), first, 'A prior confirmation receipt is still replayed, never executed again')
})
test('explicit rejection records the existing proposal state with no business effect or model resend', async t => {
  const h = await fixture(t), messageId = await h.chat(), { preview } = await h.prepare(messageId)
  const result = await h.request('/v1/proposals/commands', { kind: 'reject_proposal', commandId: 'candidate-reject', projectId, conversationId, token: preview.token })
  assert.equal(result.value.status, 'recorded'); assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId).state, 'rejected')
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get().n, 0)
  assert.equal(h.model.requests.length, 1); assert.equal(h.store.product.works.listByProject(projectId).length, 0)
})
test('work proposals require explicit scope, registered criteria and profile before creating one real Work', async t => {
  const h = await fixture(t, context => ({ text: '建议增加幂等用例。', suggestions: [{ kind: 'propose_work', goal: '增加幂等用例', projectId: context.projectId, sourceMessageId: context.sourceMessageId }] }))
  const messageId = await h.chat(), { preview } = await h.prepare(messageId)
  await h.product.close()
  assert.deepEqual(preview.requiredInputs, ['work.scope', 'work.criteria', 'work.profileId'])
  const missing = await h.confirm(preview, 'candidate-work-missing')
  assert.equal(missing.value.status, 'rejected'); assert.equal(h.store.product.works.listByProject(projectId).length, 0)
  const configuration = await h.product.read.configuration(), project = configuration.projects.find(project => project.id === projectId)
  const recorded = await h.confirm(preview, 'candidate-work-confirm', { work: { scope, criteria: project.defaultCriteria, profileId: 'profile-fixture-pass' } })
  assert.equal(recorded.value.status, 'recorded'); assert.ok(recorded.value.workId)
  assert.equal(h.store.product.works.listByProject(projectId).length, 1); assert.equal(h.model.requests.length, 1)
})
test('candidate index/digest and strict DTO refusals occur without accepting client payload or authority', async t => {
  const h = await fixture(t), messageId = await h.chat(), review = (await h.inspect(messageId)).value, selected = review.candidates[0]
  for (const change of [{ index: 7 }, { payloadDigest: 'f'.repeat(64) }]) {
    const result = await h.request('/v1/assistant/candidates/prepare', { messageId, index: selected.index, payloadDigest: selected.payloadDigest, ...change })
    assert.equal(result.status, 409)
  }
  for (const extra of [{ actor }, { verifiedBy: 'main-completed-reply' }, { payload: { kind: 'propose_work' } }, { sourceMessageId: messageId }]) {
    const result = await h.request('/v1/assistant/candidates/prepare', { messageId, index: selected.index, payloadDigest: selected.payloadDigest, ...extra })
    assert.equal(result.status, 400)
  }
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM assistant_proposal_versions').get().n, 0); assert.equal(h.model.requests.length, 1)
})
test('an escalating decision remains an inert rejected suggestion rather than gaining current project scope', async t => {
  const h = await fixture(t, context => ({ text: '保留这份普通回复。', suggestions: [{ kind: 'propose_decision', content: 'An unauthorized action',
    scope: { ...context.scope, externalActions: ['deploy'] }, sourceMessageId: context.sourceMessageId }] }))
  const messageId = await h.chat(), result = await h.inspect(messageId)
  assert.equal(result.value.status, 'none'); assert.deepEqual(result.value.candidates, [])
  assert.equal(result.value.rejected[0].reason, 'scope_escalation')
  assert.ok(h.store.product.messages.page(conversationId).messages.some(message => message.text === '保留这份普通回复。'))
  assert.equal(h.store.product.works.listByProject(projectId).length, 0); assert.equal(h.model.requests.length, 1)
})
for (const mutation of ['source-text', 'artifact']) test(`original reply ${mutation} drift refuses a previously prepared confirmation without another request`, async t => {
  const h = await fixture(t), messageId = await h.chat(), { preview } = await h.prepare(messageId)
  if (mutation === 'source-text') {
    const source = h.store.product.messages.getById(messageId)
    h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...source, text: 'Changed source text' }), messageId)
  } else {
    const result = h.store.workflows.assistant.replyResults.forRequest(key('assistant-request', messageId))
    writeFileSync(h.store.artifacts.filePath(result.artifactRef), 'corrupt selected original reply')
  }
  const rejected = await h.confirm(preview)
  assert.equal(rejected.value.status, 'rejected'); assert.equal(rejected.value.error.code, 'verification_failed')
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get().n, 0)
  assert.equal(h.model.requests.length, 1)
})
test('HTTP auth, exact origins, readonly mode and response identity are enforced for candidate operations', async t => {
  const h = await fixture(t), messageId = await h.chat(), review = (await h.inspect(messageId)).value, selected = review.candidates[0]
  assert.equal((await h.http().request(`http://127.0.0.1/v1/messages/${messageId}/candidates`)).status, 401)
  assert.equal((await h.request(`/v1/messages/${messageId}/candidates?force=true`)).status, 400)
  const input = { messageId, index: selected.index, payloadDigest: selected.payloadDigest }
  assert.equal((await h.request('/v1/assistant/candidates/prepare', input, h.http(), { origin: 'http://foreign.invalid' })).status, 403)
  assert.equal((await h.request('/v1/assistant/candidates/prepare', input, h.http({ startupMode: 'recovery_readonly' }))).status, 422)
  const wrongRead = h.http({ read: { ...h.product.read, replyCandidates: async () => ({ ...review, messageId: 'foreign-source' }) } })
  assert.equal((await h.request(`/v1/messages/${messageId}/candidates`, undefined, wrongRead)).status, 503)
  assert.equal(h.model.requests.length, 1)
})
test('a persisted nonempty result survives publication failure and effects recover it without another SDK request', async t => {
  const h = await fixture(t)
  h.store.db.exec("CREATE TRIGGER fail_candidate_reply BEFORE INSERT ON conversation_messages WHEN json_extract(NEW.value, '$.role') = 'assistant' BEGIN SELECT RAISE(ABORT, 'candidate-reply-window'); END")
  const messageId = await h.chat(), result = h.store.workflows.assistant.replyResults.forRequest(key('assistant-request', messageId))
  assert.ok(result); assert.equal(h.model.requests.length, 1)
  assert.equal(h.store.product.messages.page(conversationId).messages.filter(message => message.role === 'assistant').length, 0)
  h.store.db.exec('DROP TRIGGER fail_candidate_reply')
  for (const row of h.store.queue.dueRows('application.assistant.reply', Number.MAX_SAFE_INTEGER, 100))
    h.store.queue.reschedule(row.kind, row.key, row.seq, row.generation, 0)
  h.product.execution.effects.kick(); await h.product.execution.effects.idle('application.assistant.reply')
  assert.equal(h.store.product.messages.page(conversationId).messages.filter(message => message.role === 'assistant').length, 1)
  assert.equal((await h.inspect(messageId)).value.candidates.length, 1); assert.equal(h.model.requests.length, 1)
  assert.deepEqual(h.store.workflows.assistant.replyResults.forRequest(key('assistant-request', messageId)), result)
})
test('suggestion mode settings use authenticated strict JSON and preserve the private credential', async t => {
  const h = await fixture(t)
  const changed = await h.request('/v1/assistant/suggestions', { enabled: false })
  assert.equal(changed.status, 200); assert.equal(changed.value.suggestionsEnabled, false)
  assert.equal(JSON.parse(readFileSync(h.model.file, 'utf8')).apiKey, h.model.key)
  assert.equal((await h.request('/v1/assistant/suggestions', { enabled: true, apiKey: 'untrusted' })).status, 400)
  assert.equal((await h.request('/v1/assistant/suggestions', { enabled: true }, h.http({ startupMode: 'recovery_readonly' }))).status, 422)
  assert.equal(h.model.requests.length, 0)
})
