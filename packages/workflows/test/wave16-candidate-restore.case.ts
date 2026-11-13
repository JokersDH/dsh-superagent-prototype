/**
 * Wave-16 A3: real local SDK mock -> A18 completed result -> candidate GET/prepare -> explicit
 * confirmation, then a snapshot restored to a second private root and reviewed read-only.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '@personal-agent/storage'
import { key } from '../../orchestrator-core/src/core/ids.ts'
import { createControlledProduct, createProductRuntime, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { WorkflowSnapshots } from '../src/index.ts'
// @ts-expect-error main-owned plain-JS fixture without declarations
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'

const principal = { userId: 'wave16-candidate-user', authorityRef: 'wave16-candidate-authority' }
const actor = { ...principal, source: 'local_cli' as const }, projectId = 'wave16-candidate-project', conversationId = 'wave16-candidate-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const apiToken = 'a'.repeat(64), headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
const criteria = [
  { id: 'wave19-output', kind: 'machine' as const, required: true as const, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'wave19-human', kind: 'human' as const, required: true, description: 'Review output' },
]
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 10000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Product condition timed out: ${JSON.stringify(latest ?? null)}`)
}

test('a real candidate confirmation survives a snapshot restore at a second root', async t => {
  const model = await candidateModel(), root = model.root, stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  writeFileSync(join(projectRoot, 'index.mjs'), 'export const ok = true\n')
  git(['init', '-q']); git(['add', 'src/.gitkeep', 'index.mjs']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Candidate restore fixture'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  // Generate real Work/Ticket/question/answer/native delivery through the actual controlled product.
  const controlled = createControlledProduct({ store, principal, projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 64), stateRoot, scratchProject: projectRoot })
  let businessWorkId: string, businessQuestionId: string, businessAnswerId: string
  try {
    controlled.start()
    let seq = 0
    const businessCommand = (value: any) => controlled.application.dispatch({ commandId: `wave19-business-${++seq}`,
      conversationId, ...value }, actor)
    const created = await businessCommand({ kind: 'create_work', projectId, goal: 'Wave-19 controlled business work',
      profileId: 'profile-fixture-question', scope, criteria })
    assert.equal(created.status, 'recorded')
    businessWorkId = created.workId as string
    const view = await until(async () => controlled.application.inspect({}), value => value.questions.length === 1)
    const question = view.questions[0]!
    businessQuestionId = question.id
    const answer = await businessCommand({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] } })
    assert.equal(answer.status, 'recorded')
    await until(async () => controlled.application.questions.currentDeliveries(question.id), value => value[0]?.status === 'native_applied')
    const storedAnswer = store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(question.id) as { answer_id: string }
    businessAnswerId = storedAnswer.answer_id
    assert.ok((store.db.prepare('SELECT COUNT(*) AS n FROM dispatch_receipts').get() as { n: number }).n > 0)
  } finally { await controlled.close() }
  let product: ReturnType<typeof createProductRuntime> | undefined = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
    projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 61), assistantProvider: model.provider })
  let restored: ProductStore | undefined
  t.after(async () => { if (restored) try { restored.close() } catch { /* closed in test */ }
    if (product) await product.close(); store.close(); await model.close(); rmSync(root, { recursive: true, force: true }) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', read: product.read, operations: product.operations })
  const request = async (path: string, body?: unknown) => {
    const response = await app.request(`http://127.0.0.1${path}`, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers })
    return { status: response.status, value: (await response.json()) as any }
  }
  const receipt = await product.application.dispatch({ kind: 'chat', commandId: 'wave16-chat', projectId, conversationId, text: '请整理支付约束。' }, actor)
  assert.equal(receipt.status, 'recorded')
  product.start(); await product.execution.effects.idle('application.assistant.reply')
  const messageId = key('message', 'wave16-chat'), requestId = key('assistant-request', messageId)
  const review = await request(`/v1/messages/${encodeURIComponent(messageId)}/candidates`)
  assert.equal(review.status, 200); assert.equal(review.value.executable, false)
  const selected = review.value.candidates[0]; assert.ok(selected)
  const prepared = await request('/v1/assistant/candidates/prepare', { messageId, index: selected.index, payloadDigest: selected.payloadDigest })
  assert.equal(prepared.status, 200, JSON.stringify(prepared.value))
  const confirmed = await request('/v1/proposals/commands', { kind: 'confirm_proposal', commandId: 'wave16-confirm',
    projectId, conversationId, token: prepared.value.token })
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.value))
  assert.equal(store.workflows.assistant.proposals.get(prepared.value.record.proposalId)?.state, 'confirmed')
  assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get() as { n: number }).n, 1)
  const result = store.workflows.assistant.replyResults.forRequest(requestId)
  assert.ok(result)

  const contextCommand = 'wave16-context', contextMessageId = key('message', contextCommand)
  const contextPrepared = await request('/v1/assistant/context/prepare', { commandId: contextCommand, text: 'Read the candidate context.',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } } })
  assert.equal(contextPrepared.status, 200, JSON.stringify(contextPrepared.value))
  assert.equal((await request('/v1/assistant/context/send', { commandId: contextCommand, token: contextPrepared.value.token })).status, 200)
  await product.execution.effects.idle('application.assistant.reply')
  const contextBinding = store.workflows.assistant.contextBindings.forMessage(contextMessageId)
  assert.ok(contextBinding)
  store.queue.enqueue('application.execute', 'wave16-candidate-held', '{"held":true}', 1, 0, new Date().toISOString())
  await product.close(); product = undefined

  // Real HTTP source prepare/confirm/audit over the same Store (no no-op revalidate committer).
  const markerPath = join(stateRoot, 'restore-report.json')
  writeFileSync(markerPath, JSON.stringify({ protocol: 'personal-restore/1', targetPath: stateRoot,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const sourceRuntime = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
    projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 65), startupMode: 'recovery_readonly',
    recoveryExecutor: (() => ({ id: 'wave19-readonly-executor', revision: 1, executable: process.execPath, expectedVersion: process.version })) as any })
  let sourceRecord: any
  try {
    const sourceApp = createLocalHttpApp({ application: sourceRuntime.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
      allowedOrigins: ['http://127.0.0.1:5173'], mode: 'personal', startupMode: 'recovery_readonly',
      read: sourceRuntime.read, operations: sourceRuntime.operations })
    const sourceRequest = async (path: string, body: unknown) => {
      const response = await sourceApp.request(`http://127.0.0.1/v1/recovery/source/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
      return { status: response.status, value: await response.json() as any }
    }
    const prepareInput: any = {
      preflight: { expectedFingerprint: (await sourceRuntime.read.recovery!()).inspectionFingerprint,
        bindings: [{ sourceProjectId: projectId, project: { path: projectRoot, check: 'node_test' } }] },
      targetStateRoot: join(root, 'new-empty-target'),
    }
    const preparedSource = await sourceRequest('prepare', prepareInput)
    assert.equal(preparedSource.status, 200, JSON.stringify(preparedSource.value))
    assert.equal(preparedSource.value.authorization, 'not_granted')
    assert.equal(preparedSource.value.startupAvailable, false)
    const confirmation = await sourceRequest('confirm', { token: preparedSource.value.token })
    assert.equal(confirmation.status, 200, JSON.stringify(confirmation.value))
    sourceRecord = confirmation.value
    assert.equal(sourceRecord.authorization, 'not_granted')
    const audit = await sourceApp.request(`http://127.0.0.1/v1/recovery/activations/${sourceRecord.committed.intent.activationId}`, { headers })
    assert.equal(audit.status, 200)
    assert.deepEqual(await audit.json(), sourceRecord)
  } finally { await sourceRuntime.close() }
  const snapshot = join(root, 'snapshot')
  const created = await new WorkflowSnapshots(store).create({ destination: snapshot, formatVersion: 2 })
  assert.equal(created.status, 'ok', created.message)
  const restoreRoot = mkdtempSync(join(tmpdir(), 'wave16-candidate-restore-'))
  cpSync(snapshot, restoreRoot, { recursive: true })
  restored = new ProductStore({ path: join(restoreRoot, 'product.sqlite') })
  try {
    assert.equal(restored.workflows.assistant.proposals.get(prepared.value.record.proposalId)?.state, 'confirmed')
    assert.equal((restored.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get() as { n: number }).n, 1)
    assert.equal(restored.workflows.assistant.replyResults.forRequest(requestId)?.artifactDigest, result!.artifactDigest)
    assert.equal(restored.commands.get('wave16-confirm')?.payloadDigest, store.commands.get('wave16-confirm')?.payloadDigest)
    const artifact = restored.artifacts.read(result!.artifactRef)!.data.toString()
    assert.equal(JSON.parse(artifact).sourceMessageId, messageId)
    assert.ok(JSON.parse(artifact).suggestions.length > 0)
    const verification = new WorkflowSnapshots(restored).verify(restoreRoot)
    assert.equal(verification.status, 'ok', verification.message)
    assert.equal(restored.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10)
      .some(row => row.key === 'wave16-candidate-held'), true)
    assert.equal(restored.product.works.get(businessWorkId)?.title, 'Wave-19 controlled business work')
    assert.equal(restored.product.questions.get(businessQuestionId)?.validity, 'answered')
    assert.equal(restored.answers.get(businessAnswerId)?.questionId, businessQuestionId)
    assert.equal(restored.answers.deliveries(businessAnswerId)[0]?.status, 'native_applied')
    assert.equal(restored.workflows.assistant.contextBindings.forMessage(contextMessageId)?.bundleRef, contextBinding.bundleRef)
    assert.equal(restored.workflows.recoveryActivations.get(sourceRecord.committed.intent.activationId)?.commandId,
      sourceRecord.committed.intent.commandId)
    assert.equal(restored.commands.get(sourceRecord.committed.intent.commandId)?.payloadDigest,
      store.commands.get(sourceRecord.committed.intent.commandId)?.payloadDigest)
    const restoredSource = restored.workflows.recoverySource.inspect({ ignoreCommitted: sourceRecord.committed })
    assert.equal(restoredSource.coverage, 'complete')

    // Start the actual recovery_readonly runtime/HTTP over the second-root database.
    const readonly = createProductRuntime({ store: restored, stateRoot: restoreRoot, scratchProject: projectRoot, principal,
      projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 63), startupMode: 'recovery_readonly' })
    try {
      const app = createLocalHttpApp({ application: readonly.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
        allowedOrigins: ['http://127.0.0.1:5173'], mode: 'personal', startupMode: 'recovery_readonly',
        read: readonly.read, operations: readonly.operations })
      const historyResponse = await app.request(`http://127.0.0.1/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(conversationId)}`, { headers })
      const historyBody = await historyResponse.text()
      assert.equal(historyResponse.status, 200, historyBody)
      const historyValue = JSON.parse(historyBody)
      assert.ok(historyValue.entries.some((entry: any) => entry.messageId === contextMessageId))
      const queueBefore = restored.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10)
      const eventsBefore = restored.events.cursor()
      const rejected = await app.request('http://127.0.0.1/v1/commands', { method: 'POST', headers,
        body: JSON.stringify({ kind: 'chat', commandId: 'readonly-must-not-send', conversationId, projectId, text: 'Do not send' }) })
      assert.notEqual(rejected.status, 200)
      assert.deepEqual(restored.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10), queueBefore)
      assert.equal(restored.events.cursor(), eventsBefore)
      assert.equal(restored.product.messages.page(conversationId).messages.filter(message => message.provenance === 'reasoner_reply').length, 2)
    } finally { await readonly.close() }
  } finally { restored.close(); restored = undefined; rmSync(restoreRoot, { recursive: true, force: true }) }
})
