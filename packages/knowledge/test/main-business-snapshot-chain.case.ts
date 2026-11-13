import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { WorkflowSnapshots } from '@personal-agent/workflows'
import { key } from '@personal-agent/orchestrator-core'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const principal = { userId: 'business-chain-user', authorityRef: 'business-chain-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'business-chain-project'
const conversationId = 'business-chain-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const API = 'a'.repeat(64)
const headers = { authorization: `Bearer ${API}`, 'content-type': 'application/json' }
const criteria = [
  { id: 'criterion-output', kind: 'machine' as const, required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
]

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 20000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`Business chain condition timed out: ${JSON.stringify(latest)}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function loadModel() {
  // @ts-expect-error - main-owned fixture has no type declarations.
  const module = (await import('../../../tests/integration/fixtures/assistant-candidate-model.mjs')) as unknown as {
    candidateModel(options?: { reply?: (context: Record<string, unknown>) => unknown }): Promise<{
      root: string
      requests: unknown[]
      provider: unknown
      close(): Promise<void>
    }>
  }
  return module.candidateModel
}

function makeApp(product: ReturnType<typeof createControlledProduct>, readonlyMode: boolean) {
  return createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: API,
    bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'],
    mode: 'fixture',
    read: product.read,
    operations: product.operations,
    ...(readonlyMode ? { startupMode: 'recovery_readonly' as const } : {}),
  })
}

function caller(app: ReturnType<typeof makeApp>) {
  return async (path: string, body?: unknown) => {
    const response = await app.request(path, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers,
    })
    return { status: response.status, value: (await response.json()) as Record<string, unknown> }
  }
}

test('one snapshot carries real Work/Ticket/Broker Q&A into the second-root readonly flow', async (t) => {
  const candidateModel = await loadModel()
  const model = await candidateModel()
  const root = mkdtempSync(join(tmpdir(), 'pa-business-chain-'))
  const stateRoot = join(root, 'source')
  const scratchProject = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 })
  mkdirSync(join(scratchProject, 'src'), { recursive: true })
  mkdirSync(join(stateRoot, 'receipts'), { recursive: true })
  writeFileSync(join(scratchProject, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', 'src/.gitkeep'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Business chain fixture'])

  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite'), artifactsRoot: stateRoot })
  const product = createControlledProduct({
    store,
    principal,
    projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 97),
    stateRoot,
    scratchProject,
    assistantProvider: model.provider as never,
  })
  const cleanups: (() => void | Promise<void>)[] = []
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
  })
  product.start()
  let seq = 0
  const command = (value: Record<string, unknown>) =>
    product.application.dispatch({ commandId: `business-command-${++seq}`, conversationId, ...value } as never, actor)

  // 1. Real Work/Ticket/Broker question through the controlled normal product path.
  const created = await command({
    kind: 'create_work',
    projectId,
    goal: 'Produce the controlled scratch artifact',
    profileId: 'profile-fixture-question',
    scope,
    criteria: [...criteria, { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' }],
  })
  assert.equal(created.status, 'recorded')
  const pending = await until(
    async () => product.application.inspect({ workId: (created as { workId: string }).workId }),
    (value) => value.questions.length >= 1,
  )
  const question = pending.questions[0]!
  assert.equal(question.contract.workId, (created as { workId: string }).workId)
  const answered = await command({
    kind: 'answer_question',
    questionId: question.id,
    expectedVersion: question.version,
    answer: { kind: 'choices', optionIds: ['allow'] },
  })
  assert.equal(answered.status, 'recorded')
  const readyWork = await until(
    async () => (await product.application.inspect({ workId: (created as { workId: string }).workId })).works[0],
    (value) => value !== undefined && value.actions.available.includes('accept_candidate'),
  )
  const deliveries = product.application.questions.currentDeliveries(question.id)
  assert.equal(deliveries[0]?.status, 'native_applied')
  const accepted = await command({ kind: 'accept_candidate', candidate: readyWork!.actions.currentCandidate })
  assert.equal(accepted.status, 'recorded')

  // 2. A second real question stays pending for the read-only review in the second root.
  const second = await command({
    kind: 'create_work',
    projectId,
    goal: 'Second controlled artifact for pending question',
    profileId: 'profile-fixture-question',
    scope,
    criteria,
  })
  assert.equal(second.status, 'recorded')
  const pendingQuestion = await until(
    async () => product.application.inspect({ workId: (second as { workId: string }).workId }),
    (value) => value.questions.length >= 1,
  )
  const openQuestion = pendingQuestion.questions[0]!

  // Q&A lives in its own records, not in the ordinary conversation stream the model may reuse.
  const pageBefore = store.product.messages.page(conversationId).messages
  const messagesBefore = pageBefore.length
  // The real Broker question/answer surfaces as anchored permission-display data, never as a plain reply.
  const displayMessage = pageBefore.find((message) => message.provenance === 'question_answer_display')
  assert.ok(displayMessage)
  assert.ok(pageBefore.some((message) => message.role === 'user' && message.provenance === 'trusted_user' && message.anchor))
  assert.equal(pageBefore.some((message) => message.provenance === 'reasoner_reply'), false)

  // 3. The already-passing SDK candidate/context chain in the same store.
  const chat = await product.application.dispatch({ kind: 'chat', commandId: 'business-chat', projectId, conversationId, text: '请整理一项判断。' }, actor)
  assert.equal(chat.status, 'recorded')
  await product.execution.effects.idle('application.assistant.reply')
  const chatMessageId = key('message', 'business-chat')
  const normal = caller(makeApp(product, false))
  const review = await normal(`/v1/messages/${encodeURIComponent(chatMessageId)}/candidates`)
  assert.equal(review.status, 200)
  const candidate = (review.value.candidates as { index: number; payloadDigest: string }[])[0]!
  const preview = await normal('/v1/assistant/candidates/prepare', { messageId: chatMessageId, index: candidate.index, payloadDigest: candidate.payloadDigest })
  assert.equal(preview.status, 200)
  const confirmed = await normal('/v1/proposals/commands', {
    kind: 'confirm_proposal',
    commandId: 'business-confirm',
    projectId,
    conversationId,
    token: (preview.value as { token: string }).token,
  })
  assert.equal(confirmed.value.status, 'recorded')
  const contextPrepared = await normal('/v1/assistant/context/prepare', {
    commandId: 'business-context',
    text: '请核对冻结来源。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8192 } },
  })
  assert.equal(contextPrepared.status, 200)
  const contextSources = (contextPrepared.value.preview as { sources: { content: string }[] }).sources
  assert.equal(contextSources.some((source) => source.content.includes(displayMessage!.text)), false)
  const contextToken = (contextPrepared.value as { token: string }).token
  const contextSent = await normal('/v1/assistant/context/send', { commandId: 'business-context', token: contextToken })
  assert.equal(contextSent.status, 200)
  await product.execution.effects.idle('application.assistant.reply')
  const contextMessageId = key('message', 'business-context')
  const normalAudit = await normal(`/v1/messages/${contextMessageId}/context`)
  assert.equal(normalAudit.status, 200)
  const frozenDigest = normalAudit.value.bundleDigest

  // 4. Default v1 and explicit v2 snapshots of this same store.
  const snapshots = new WorkflowSnapshots(store)
  const v1Dir = join(root, 'snapshot-v1')
  const v1 = await snapshots.create({ destination: v1Dir })
  assert.equal(v1.status, 'ok', JSON.stringify(v1.manifest && { missing: v1.manifest.missing, corrupt: v1.manifest.corrupt }))
  assert.equal(v1.manifest.protocol, 'workflow-snapshot/1')
  assert.equal(v1.manifest.evidence.protocol, 'workflow-evidence/1')
  assert.equal(snapshots.verify(v1Dir).status, 'ok')
  const v2Dir = join(root, 'snapshot-v2')
  const v2 = await snapshots.create({ destination: v2Dir, formatVersion: 2 })
  assert.equal(v2.status, 'ok')
  assert.equal(v2.manifest.protocol, 'workflow-snapshot/2')
  assert.equal(v2.manifest.evidence.protocol, 'workflow-evidence/2')
  assert.equal((v2.manifest.evidence as { familySetVersion?: number }).familySetVersion, 2)
  assert.equal(snapshots.verify(v2Dir).status, 'ok')
  const invalidDir = join(root, 'snapshot-invalid')
  await assert.rejects(async () => snapshots.create({ destination: invalidDir, formatVersion: 3 as never }))
  assert.equal(existsSync(invalidDir), false)

  const modelCalls = model.requests.length
  await product.close()
  cleanups.push(() => model.close())
  cleanups.push(() => store.close())

  // 5. Second root from the default v1 snapshot; outstanding work stays held and answerable only in a writer instance.
  writeFileSync(join(v1Dir, 'restore-report.json'), JSON.stringify({
    protocol: 'personal-restore/1',
    targetPath: v1Dir,
    database: { integrity: v1.manifest.database.integrity, foreignKeyViolations: v1.manifest.database.foreignKeyViolations, productSchema: v1.manifest.database.productSchema },
    evidence: { status: 'verified' },
  }), { mode: 0o600 })
  const secondStore = new ProductStore({ path: join(v1Dir, 'product.sqlite'), artifactsRoot: v1Dir })
  const readonly = createControlledProduct({
    store: secondStore,
    principal,
    projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 97),
    stateRoot: v1Dir,
    scratchProject,
    startupMode: 'recovery_readonly',
    assistantProvider: model.provider as never,
    recoveryExecutor: () => ({
      id: 'read-only-fixture-executor',
      revision: 1,
      driverId: 'fixture-driver',
      driverApiMajor: 1 as const,
      driverRelease: 'fixture-release',
      executable: process.execPath,
      argv: [],
      expectedVersion: process.version,
      nativeConfigRef: 'fixture-config',
      permissionPolicyRevision: 'fixture-policy',
      requiredFeatures: [],
    }),
  })
  cleanups.push(async () => {
    await readonly.close()
  })
  cleanups.push(() => secondStore.close())
  const request = caller(makeApp(readonly, true))

  const snapshot = await request('/v1/snapshot')
  assert.equal(snapshot.status, 200)
  const works = snapshot.value.works as { work: { id: string }; phase?: string }[]
  assert.ok(works.some((work) => work.work.id === (second as { workId: string }).workId))
  const deliveredWork = await request(`/v1/works/${(created as { workId: string }).workId}`)
  assert.equal(deliveredWork.status, 200)
  assert.equal(deliveredWork.value.phase, 'delivered')
  const questions = snapshot.value.questions as { id: string; contract: { workId: string } }[]
  const restoredOpen = questions.find((entry) => entry.id === openQuestion.id)
  assert.ok(restoredOpen, JSON.stringify(questions))
  const delivered = await request(`/v1/questions/${question.id}/deliveries`)
  assert.equal(delivered.status, 200)
  assert.equal(((delivered.value as unknown as { status: string }[])[0])?.status, 'native_applied')

  // The pending answer is a business mutation: refused, queue held, no provider resend.
  const queueBefore = Number((secondStore.db.prepare('SELECT COUNT(*) AS n FROM effect').get() as { n: number }).n)
  const answerRefused = await request('/v1/commands', {
    kind: 'answer_question',
    commandId: 'readonly-answer',
    conversationId,
    questionId: restoredOpen!.id,
    expectedVersion: 1,
    answer: { kind: 'choices', optionIds: ['allow'] },
  })
  assert.equal(answerRefused.status, 422)
  for (const [path, body] of [
    ['/v1/commands', { kind: 'create_work', commandId: 'readonly-create', conversationId, projectId, goal: 'x', profileId: 'profile-fixture-question', scope, criteria }],
    ['/v1/assistant/candidates/prepare', { messageId: chatMessageId, index: candidate.index, payloadDigest: candidate.payloadDigest }],
    ['/v1/proposals/commands', { kind: 'reject_proposal', commandId: 'readonly-reject', projectId, conversationId, token: 'a.b' }],
    ['/v1/context/preview', { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } }],
    ['/v1/assistant/context/send', { commandId: 'business-context', token: contextToken }],
  ] as const) {
    const refused = await request(path, body)
    assert.equal(refused.status, 422, `${path} ${JSON.stringify(refused.value)}`)
  }
  assert.throws(() => readonly.start())

  // Frozen candidate/history/source remain reviewable in the same second root.
  const frozenReview = await request(`/v1/messages/${encodeURIComponent(chatMessageId)}/candidates`)
  assert.equal(frozenReview.status, 200)
  assert.equal((frozenReview.value.candidates as { payloadDigest: string }[])[0]!.payloadDigest, candidate.payloadDigest)
  const history = await request(`/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(conversationId)}`)
  assert.equal(history.status, 200)
  assert.equal((history.value.entries as { messageId: string }[]).some((entry) => entry.messageId === contextMessageId), true)
  const audit = await request(`/v1/messages/${contextMessageId}/context`)
  assert.equal(audit.value.bundleDigest, frozenDigest)

  // Q&A records did not become ordinary messages the model could reuse.
  assert.equal(secondStore.product.messages.page(conversationId).messages.length, messagesBefore + 4)
  // The original work/question messages stay anchored; only the chat/context turns are plain discussion.
  const initialIds = new Set(pageBefore.map((message) => message.id))
  for (const message of secondStore.product.messages.page(conversationId).messages) {
    if (!initialIds.has(message.id)) continue
    assert.ok(message.anchor !== undefined || message.provenance === 'question_answer_display')
  }

  // Source facts can be confirmed, but never grant target/business authority.
  const inspection = (await request('/v1/recovery/inspect')) as { status: number; value: { inspectionFingerprint: string } }
  assert.equal(inspection.status, 200)
  const sourcePrepared = await request('/v1/recovery/source/prepare', {
    preflight: {
      expectedFingerprint: inspection.value.inspectionFingerprint,
      bindings: [{ sourceProjectId: projectId, project: { path: scratchProject, check: 'node_test' } }],
    },
    targetStateRoot: join(root, 'second-empty-target'),
  })
  assert.equal(sourcePrepared.status, 200, JSON.stringify(sourcePrepared.value))
  assert.equal(sourcePrepared.value.authorization, 'not_granted')
  assert.equal(sourcePrepared.value.startupAvailable, false)
  const intent = sourcePrepared.value.intent as { activationId: string; target: { stateRoot: string } }
  assert.equal(existsSync(intent.target.stateRoot), false)
  const sourceConfirmed = await request('/v1/recovery/source/confirm', { token: sourcePrepared.value.token })
  assert.equal(sourceConfirmed.status, 200)
  assert.equal(sourceConfirmed.value.startupAvailable, false)
  const activation = await request(`/v1/recovery/activations/${intent.activationId}`)
  assert.deepEqual(activation.value, sourceConfirmed.value)

  assert.equal(Number((secondStore.db.prepare('SELECT COUNT(*) AS n FROM effect').get() as { n: number }).n), queueBefore)
  assert.equal(model.requests.length, modelCalls)
  assert.equal(existsSync(intent.target.stateRoot), false)
})
