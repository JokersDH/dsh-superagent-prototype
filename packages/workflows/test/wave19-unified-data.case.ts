/**
 * Wave-19 A3–A6: one store that holds a real controlled product business chain (Work, Ticket,
 * Broker question/answer, native_applied delivery) plus the local SDK reply/candidate, selected
 * context and the real source confirmation. The same store is snapshotted in the default v1 and the
 * explicit v2 recipe, restored to a second private root, and reviewed through the actual
 * recovery_readonly HTTP composition with the old queue held and no provider resend.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

const principal = { userId: 'wave19-unified-user', authorityRef: 'wave19-unified-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'wave19-unified-project', conversationId = 'wave19-unified-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const apiToken = 'a'.repeat(64), headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
const criteria = [
  { id: 'wave19-output', kind: 'machine' as const, required: true as const, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'wave19-human', kind: 'human' as const, required: true, description: 'Review output' },
]

async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Product condition timed out: ${JSON.stringify(latest ?? null)}`)
}

test('one real business+SDK store snapshots in both recipes and reopens read-only at a second root', async t => {
  const model = await candidateModel()
  const root = model.root, stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(join(projectRoot, 'src'), { recursive: true })
  writeFileSync(join(projectRoot, 'index.mjs'), 'export const ok = true\n')
  const git = (args: string[]) => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Wave-19 unified fixture'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const restored: ProductStore[] = []
  let product: ReturnType<typeof createProductRuntime> | undefined
  t.after(async () => {
    for (const value of restored) try { value.close() } catch { /* already closed */ }
    if (product) await product.close()
    store.close(); await model.close(); rmSync(root, { recursive: true, force: true })
  })

  // A3/A4: real application -> effects -> Broker chain, not hand-written public rows.
  let workId = '', questionId = '', answerId = ''
  const controlled = createControlledProduct({ store, principal, projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 64), stateRoot, scratchProject: projectRoot })
  try {
    controlled.start()
    let seq = 0
    const command = (value: any) => controlled.application.dispatch({ commandId: `wave19-unified-${++seq}`, conversationId, ...value }, actor)
    const created = await command({ kind: 'create_work', projectId, goal: 'Wave-19 unified real business work', profileId: 'profile-fixture-question', scope, criteria })
    assert.equal(created.status, 'recorded')
    workId = created.workId as string
    const view = await until(async () => controlled.application.inspect({}), value => value.questions.length === 1)
    const question = view.questions[0]!
    questionId = question.id
    assert.equal((await command({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] } })).status, 'recorded')
    await until(async () => controlled.application.questions.currentDeliveries(question.id), value => value[0]?.status === 'native_applied')
    answerId = (store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(question.id) as { answer_id: string }).answer_id
  } finally { await controlled.close() }
  const rowCounts = () => ({
    works: (store.db.prepare('SELECT COUNT(*) AS n FROM works').get() as { n: number }).n,
    tickets: (store.db.prepare('SELECT COUNT(*) AS n FROM ticket').get() as { n: number }).n,
    questions: (store.db.prepare('SELECT COUNT(*) AS n FROM user_questions').get() as { n: number }).n,
    answers: (store.db.prepare('SELECT COUNT(*) AS n FROM answers').get() as { n: number }).n,
    deliveries: (store.db.prepare('SELECT COUNT(*) AS n FROM answer_deliveries').get() as { n: number }).n,
    nativeApplied: (store.db.prepare("SELECT COUNT(*) AS n FROM answer_deliveries WHERE status = 'native_applied'").get() as { n: number }).n,
    dispatch: (store.db.prepare('SELECT COUNT(*) AS n FROM dispatch_receipts').get() as { n: number }).n,
  })
  const business = rowCounts()
  assert.ok(business.works >= 1 && business.tickets >= 1 && business.questions === 1 && business.answers === 1)
  assert.equal(business.deliveries, 1); assert.equal(business.nativeApplied, 1); assert.ok(business.dispatch >= 1)

  product = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
    projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 61), assistantProvider: model.provider })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', read: product.read, operations: product.operations })
  const request = async (path: string, body?: unknown) => {
    const response = await app.request(`http://127.0.0.1${path}`, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers })
    return { status: response.status, value: (await response.json()) as any }
  }
  assert.equal((await product.application.dispatch({ kind: 'chat', commandId: 'wave19-unified-chat', projectId, conversationId, text: '请整理支付约束。' }, actor)).status, 'recorded')
  product.start(); await product.execution.effects.idle('application.assistant.reply')
  const messageId = key('message', 'wave19-unified-chat'), requestId = key('assistant-request', messageId)
  const review = await request(`/v1/messages/${encodeURIComponent(messageId)}/candidates`)
  assert.equal(review.status, 200); const selected = review.value.candidates[0]; assert.ok(selected)
  const prepared = await request('/v1/assistant/candidates/prepare', { messageId, index: selected.index, payloadDigest: selected.payloadDigest })
  assert.equal(prepared.status, 200, JSON.stringify(prepared.value))
  assert.equal((await request('/v1/proposals/commands', { kind: 'confirm_proposal', commandId: 'wave19-unified-confirm',
    projectId, conversationId, token: prepared.value.token })).status, 200)
  const result = store.workflows.assistant.replyResults.forRequest(requestId); assert.ok(result)
  const contextCommand = 'wave19-unified-context', contextMessageId = key('message', contextCommand)
  const contextPrepared = await request('/v1/assistant/context/prepare', { commandId: contextCommand, text: 'Read the selected context.',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } } })
  assert.equal(contextPrepared.status, 200, JSON.stringify(contextPrepared.value))
  assert.equal((await request('/v1/assistant/context/send', { commandId: contextCommand, token: contextPrepared.value.token })).status, 200)
  await product.execution.effects.idle('application.assistant.reply')
  const contextBinding = store.workflows.assistant.contextBindings.forMessage(contextMessageId); assert.ok(contextBinding)
  store.queue.enqueue('application.execute', 'wave19-unified-held', '{"held":true}', 1, 0, new Date().toISOString())
  await product.close(); product = undefined

  // A6: real source facts through the published prepare/confirm/audit, not a no-op committer.
  const markerPath = join(stateRoot, 'restore-report.json')
  writeFileSync(markerPath, JSON.stringify({ protocol: 'personal-restore/1', targetPath: stateRoot,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const sourceRuntime = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
    projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 65), startupMode: 'recovery_readonly',
    recoveryExecutor: () => ({ id: 'wave19-unified-readonly-executor', revision: 1,
      driverId: 'wave19-readonly-fixture', driverApiMajor: 1 as const, driverRelease: 'fixture-1',
      executable: process.execPath, argv: [], expectedVersion: process.version,
      nativeConfigRef: 'wave19-readonly-config', permissionPolicyRevision: 'wave19-readonly-policy',
      requiredFeatures: [] }) })
  let sourceRecord: any
  try {
    const sourceApp = createLocalHttpApp({ application: sourceRuntime.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
      allowedOrigins: ['http://127.0.0.1:5173'], mode: 'personal', startupMode: 'recovery_readonly',
      read: sourceRuntime.read, operations: sourceRuntime.operations })
    const sourceRequest = async (path: string, body: unknown) => {
      const response = await sourceApp.request(`http://127.0.0.1/v1/recovery/source/${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
      return { status: response.status, value: await response.json() as any }
    }
    const recoveryRead = sourceRuntime.read.recovery
    assert.ok(recoveryRead)
    const preparedSource = await sourceRequest('prepare', {
      preflight: { expectedFingerprint: (await recoveryRead()).inspectionFingerprint,
        bindings: [{ sourceProjectId: projectId, project: { path: projectRoot, check: 'node_test' } }] },
      targetStateRoot: join(root, 'wave19-empty-target') })
    assert.equal(preparedSource.status, 200, JSON.stringify(preparedSource.value))
    assert.equal(preparedSource.value.authorization, 'not_granted')
    assert.equal(preparedSource.value.startupAvailable, false)
    sourceRecord = (await sourceRequest('confirm', { token: preparedSource.value.token })).value
    assert.equal(sourceRecord.authorization, 'not_granted')
    const audit = await sourceApp.request(`http://127.0.0.1/v1/recovery/activations/${sourceRecord.committed.intent.activationId}`, { headers })
    assert.deepEqual(await audit.json(), sourceRecord)
  } finally { await sourceRuntime.close() }

  // A1/A5: the same store in default v1 and explicit v2; verify both recipes.
  const v1Dir = join(root, 'snapshot-v1'), v2Dir = join(root, 'snapshot-v2')
  const createdV1 = await new WorkflowSnapshots(store).create({ destination: v1Dir })
  const createdV2 = await new WorkflowSnapshots(store).create({ destination: v2Dir, formatVersion: 2 })
  assert.equal(createdV1.status, 'ok', createdV1.message)
  assert.equal(createdV2.status, 'ok', createdV2.message)
  assert.equal(createdV1.manifest.protocol, 'workflow-snapshot/1')
  assert.equal(createdV1.manifest.evidence.protocol, 'workflow-evidence/1')
  assert.equal(createdV1.manifest.evidence.families.length, 13)
  assert.equal(createdV1.manifest.evidence.familySetVersion, undefined)
  assert.equal(createdV2.manifest.protocol, 'workflow-snapshot/2')
  assert.equal(createdV2.manifest.evidence.families.length, 21)
  assert.equal(createdV2.manifest.evidence.familySetVersion, 2)

  const providerRequests = model.requests.length
  const queueBefore = store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10)
  const restoreRoots = [mkdtempSync(join(tmpdir(), 'wave19-v1-root-')), mkdtempSync(join(tmpdir(), 'wave19-v2-root-'))]
  const metrics: any[] = []
  for (const [index, snapshot] of [v1Dir, v2Dir].entries()) {
    const restoreRoot = restoreRoots[index]!
    cpSync(snapshot, restoreRoot, { recursive: true })
    const databasePath = join(restoreRoot, 'product.sqlite')
    const dbBytes = statSync(databasePath).size
    const archive = new ProductStore({ path: databasePath })
    restored.push(archive)
    assert.equal(new WorkflowSnapshots(archive).verify(restoreRoot).status, 'ok')
    assert.equal(archive.product.works.get(workId)?.title, 'Wave-19 unified real business work')
    assert.equal(archive.product.questions.get(questionId)?.validity, 'answered')
    assert.equal(archive.answers.get(answerId)?.questionId, questionId)
    assert.equal(archive.answers.deliveries(answerId)[0]?.status, 'native_applied')
    assert.equal(archive.workflows.assistant.proposals.get(prepared.value.record.proposalId)?.state, 'confirmed')
    assert.equal(archive.workflows.assistant.replyResults.forRequest(requestId)?.artifactDigest, result!.artifactDigest)
    assert.equal(archive.workflows.assistant.contextBindings.forMessage(contextMessageId)?.bundleRef, contextBinding.bundleRef)
    assert.equal(archive.workflows.recoveryActivations.get(sourceRecord.committed.intent.activationId)?.commandId,
      sourceRecord.committed.intent.commandId)
    assert.equal(archive.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).some(row => row.key === 'wave19-unified-held'), true)
    const readonly = createProductRuntime({ store: archive, stateRoot: restoreRoot, scratchProject: projectRoot, principal,
      projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 63), startupMode: 'recovery_readonly' })
    try {
      const readApp = createLocalHttpApp({ application: readonly.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
        allowedOrigins: ['http://127.0.0.1:5173'], mode: 'personal', startupMode: 'recovery_readonly',
        read: readonly.read, operations: readonly.operations })
      const history = await readApp.request(`http://127.0.0.1/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(conversationId)}`, { headers })
      const historyValue = JSON.parse(await history.text())
      assert.equal(history.status, 200)
      assert.ok(historyValue.entries.some((entry: any) => entry.messageId === contextMessageId))
      const candidates = await readApp.request(`http://127.0.0.1/v1/messages/${encodeURIComponent(messageId)}/candidates`, { headers })
      const candidatesValue = JSON.parse(await candidates.text())
      assert.equal(candidates.status, 200)
      assert.equal(candidatesValue.executable, false)
      assert.ok(candidatesValue.candidates.length >= 1)
      const eventsBefore = archive.events.cursor()
      const rejected = await readApp.request('http://127.0.0.1/v1/commands', { method: 'POST', headers,
        body: JSON.stringify({ kind: 'chat', commandId: 'wave19-readonly-must-not-send', conversationId, projectId, text: 'Do not send' }) })
      assert.notEqual(rejected.status, 200)
      assert.deepEqual(archive.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10), queueBefore)
      assert.equal(archive.events.cursor(), eventsBefore)
    } finally { await readonly.close() }
    metrics.push({ format: index === 0 ? 1 : 2, databaseBytes: dbBytes, families: index === 0 ? 13 : 21,
      status: 'ok', business, candidates: 1, contextRows: 1 })
  }
  assert.equal(model.requests.length, providerRequests, 'no provider request is made by the restored root')
  rmSync(restoreRoots[0]!, { recursive: true, force: true }); rmSync(restoreRoots[1]!, { recursive: true, force: true })
  console.log(`WAVE19_UNIFIED_METRICS ${JSON.stringify({ business, formats: metrics, providerRequests })}`)
})
