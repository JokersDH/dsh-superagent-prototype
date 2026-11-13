import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  chmodSync, copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { WorkflowSnapshots } from '@personal-agent/workflows'
import { key } from '@personal-agent/orchestrator-core'
import { localCredentials } from '../../../apps/coordinator/http/local-state.ts'
import { loadRestoredReview, prepareRestoredReview } from '../../../apps/coordinator/product/restored-review.ts'
import { createControlledProduct, createProductRuntime, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const reviewTool = join(repoRoot, 'tools/dev/review-restored.mjs')
const demoEntry = join(repoRoot, 'apps/coordinator/product/demo.ts')
const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'personal-history-project'
const conversationId = 'personal-history-conversation'
const runtimeScope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const reviewScope = { projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] }
const criteria = [
  { id: 'criterion-output', kind: 'machine' as const, required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
]

async function loadModel() {
  // @ts-expect-error - main-owned fixture has no type declarations.
  const module = (await import('../../../tests/integration/fixtures/assistant-candidate-model.mjs')) as unknown as {
    candidateModel(options?: { reply?: (context: Record<string, unknown>) => unknown }): Promise<{
      root: string
      file: string
      requests: unknown[]
      provider: unknown
      close(): Promise<void>
    }>
  }
  return module.candidateModel
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 30000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`Personal review condition timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 40))
  }
}

const forbidden = (error: unknown) => (error as { error?: { code?: string } }).error?.code === 'forbidden'

test('the actual personal read-startup reviews real historical Work/Q&A and candidate data without execution', async (t) => {
  const model = await loadModel().then((factory) => factory())
  const root = mkdtempSync(join(tmpdir(), 'pa-personal-readstartup-'))
  const source = join(root, 'source')
  const restored = join(root, 'restored')
  const scratch = join(root, 'project')
  mkdirSync(source, { mode: 0o700 })
  mkdirSync(restored, { mode: 0o700 })
  mkdirSync(join(scratch, 'src'), { recursive: true })
  mkdirSync(join(source, 'receipts'), { recursive: true })
  writeFileSync(join(scratch, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: scratch, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', 'src/.gitkeep'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Personal review fixture'])

  const original = new ProductStore({ path: join(source, 'state.sqlite'), artifactsRoot: source })
  const runtime = createControlledProduct({
    store: original,
    principal,
    projects: [{ id: projectId, scope: runtimeScope }],
    actionSecret: Buffer.alloc(32, 101),
    stateRoot: source,
    scratchProject: scratch,
    assistantProvider: model.provider as never,
  })
  runtime.start()
  const cleanups: (() => void | Promise<void>)[] = []
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(root, { recursive: true, force: true })
  })

  // Real controlled Work/Broker question/answer/native_applied in the historical store.
  const created = await runtime.application.dispatch({
    commandId: 'personal-work', conversationId, kind: 'create_work', projectId,
    goal: 'Produce the controlled scratch artifact', profileId: 'profile-fixture-question', scope: runtimeScope,
    criteria: [...criteria, { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' }],
  } as never, actor)
  assert.equal(created.status, 'recorded')
  const workId = (created as { workId: string }).workId
  const pending = await until(
    () => runtime.application.inspect({ workId }),
    (value) => value.questions.length >= 1,
  )
  const question = pending.questions[0]!
  assert.equal(question.contract.workId, workId)
  const answered = await runtime.application.dispatch({
    commandId: 'personal-answer', conversationId, kind: 'answer_question',
    questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['allow'] },
  } as never, actor)
  assert.equal(answered.status, 'recorded')
  const ready = await until(
    async () => (await runtime.application.inspect({ workId })).works[0],
    (value) => value !== undefined && value.actions.available.includes('accept_candidate'),
  )
  assert.equal(runtime.application.questions.currentDeliveries(question.id)[0]?.status, 'native_applied')
  const accepted = await runtime.application.dispatch({ commandId: 'personal-accept', conversationId, kind: 'accept_candidate', candidate: ready!.actions.currentCandidate } as never, actor)
  assert.equal(accepted.status, 'recorded')

  // Q&A lives in its own records; only a non-reusable permission display enters the conversation.
  const beforePage = original.product.messages.page(conversationId).messages
  const initialIds = new Set(beforePage.map((message) => message.id))
  const displayMessage = beforePage.find((message) => message.provenance === 'question_answer_display')
  assert.ok(displayMessage)
  assert.ok(beforePage.some((message) => message.role === 'user' && message.provenance === 'trusted_user' && message.anchor))

  // The historical discussion is produced by a normal no-executor instance carrying the exact review scope,
  // so the recorded candidate scope is the same one the personal review selection will grant.
  await runtime.close()
  const viewer = createProductRuntime({
    store: original,
    principal,
    projects: [{ id: projectId, scope: reviewScope }],
    actionSecret: Buffer.alloc(32, 101),
    stateRoot: source,
    scratchProject: scratch,
    assistantProvider: model.provider as never,
    executionUnavailable: 'operator_disabled',
  })
  viewer.start()
  const chat = await viewer.application.dispatch({ commandId: 'personal-chat', conversationId, kind: 'chat', projectId, text: '把保留错误码整理成决定建议。' }, actor)
  assert.equal(chat.status, 'recorded')
  await viewer.execution.effects.idle('application.assistant.reply')
  const sourceMessageId = key('message', 'personal-chat')
  const preparedContext = await viewer.operations.assistantContextPrepare({
    commandId: 'personal-context',
    text: '按原错误码约束再核对一次。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } },
  }, actor)
  await viewer.operations.assistantContextSend({ commandId: preparedContext.commandId, token: preparedContext.token }, actor)
  await viewer.execution.effects.idle('application.assistant.reply')
  const contextMessageId = key('message', 'personal-context')

  // Original candidate identity and frozen context digest are captured before the snapshot.
  const sourceApp = createLocalHttpApp({
    application: viewer.application, principal, apiToken: 'c'.repeat(64), bootstrapToken: 'd'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', read: viewer.read, operations: viewer.operations,
  })
  const sourceHeaders = { authorization: `Bearer ${'c'.repeat(64)}`, 'content-type': 'application/json' }
  const sourceCandidates = await (await sourceApp.request(`/v1/messages/${encodeURIComponent(sourceMessageId)}/candidates`, { headers: sourceHeaders })).json()
  const reviewedCandidate = (sourceCandidates.candidates as { index: number; payloadDigest: string }[])[0]!
  assert.ok(reviewedCandidate.payloadDigest)
  const sourceAudit = await (await sourceApp.request(`/v1/messages/${encodeURIComponent(contextMessageId)}/context`, { headers: sourceHeaders })).json()
  const frozenDigest = sourceAudit.bundleDigest as string
  assert.ok(frozenDigest)
  const modelCalls = model.requests.length
  assert.equal(modelCalls, 2)

  // Same store, default v1 and explicit v2 snapshot; invalid versions never create a destination.
  original.queue.enqueue('application.execute', 'held-personal', '{}', 1, 0, new Date().toISOString())
  const snapshots = new WorkflowSnapshots(original)
  const v1 = await snapshots.create({ destination: join(root, 'snapshot-v1') })
  assert.equal(v1.status, 'ok')
  assert.equal(v1.manifest.protocol, 'workflow-snapshot/1')
  assert.equal(v1.manifest.evidence.protocol, 'workflow-evidence/1')
  assert.equal(snapshots.verify(v1.destination).status, 'ok')
  const v2 = await snapshots.create({ destination: join(root, 'snapshot-v2'), formatVersion: 2 })
  assert.equal(v2.status, 'ok')
  assert.equal(v2.manifest.protocol, 'workflow-snapshot/2')
  assert.equal(v2.manifest.evidence.protocol, 'workflow-evidence/2')
  assert.equal((v2.manifest.evidence as { familySetVersion?: number }).familySetVersion, 2)
  assert.equal(snapshots.verify(v2.destination).status, 'ok')
  await assert.rejects(async () => snapshots.create({ destination: join(root, 'snapshot-invalid'), formatVersion: 3 as never }))
  assert.equal(existsSync(join(root, 'snapshot-invalid')), false)
  await viewer.close()
  cleanups.push(() => model.close())
  cleanups.push(() => original.close())

  // The restored root is a real copy of the default v1 snapshot, labeled by its own personal-evidence protocol.
  const v1Dir = v1.destination
  copyFileSync(join(v1Dir, 'product.sqlite'), join(restored, 'state.sqlite'))
  cpSync(join(v1Dir, 'artifacts'), join(restored, 'artifacts'), { recursive: true })
  writeFileSync(join(restored, 'restore-report.json'), JSON.stringify({
    protocol: 'personal-restore/1',
    targetPath: restored,
    database: { integrity: v1.manifest.database.integrity, foreignKeyViolations: v1.manifest.database.foreignKeyViolations, productSchema: v1.manifest.database.productSchema },
    evidence: { status: 'verified' },
  }), { mode: 0o600 })

  // Actual personal entry: an unbound restored project refuses reads before any explicit selection.
  const credential = localCredentials(restored)
  const secret = Buffer.from(credential('action.key'), 'hex')
  const apiKey = credential('api.key')
  const port = await availablePort()
  const api = `http://127.0.0.1:${port}`
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }
  let child: ReturnType<typeof spawn> | undefined
  let output = ''
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const done = once(child, 'exit')
    const timer = setTimeout(() => child!.kill('SIGKILL'), 6000)
    child.kill('SIGTERM')
    try { await done } finally { clearTimeout(timer) }
    child = undefined
  }
  cleanups.push(stop)
  const start = async (reviewFile?: string) => {
    output = ''
    child = spawn(process.execPath, [demoEntry, '--state', restored, '--port', String(port), '--discussion-only', '--assistant',
      ...(reviewFile ? ['--review-restored-scope', reviewFile] : [])], {
      cwd: repoRoot,
      env: { ...process.env, PA_MODEL_CONFIG: model.file },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', (bytes) => { output += bytes })
    child.stderr!.on('data', (bytes) => { output += bytes })
    await until(async () => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(output.slice(-4000))
      try { return (await fetch(`${api}/v1/health`)).ok } catch { return false }
    }, (healthy) => healthy)
  }

  await start()
  assert.equal((await fetch(`${api}/v1/messages/${sourceMessageId}/candidates`, { headers })).status, 403)
  assert.equal((await fetch(`${api}/v1/context/history?projectId=${projectId}`, { headers })).status, 403)
  await stop()

  // The explicit CLI selection writes a brand-new private 600 file bound to this root/principal/host/key/marker/source.
  const reviewFile = join(root, 'explicit-startup-review.json')
  const prepared = JSON.parse(execFileSync(process.execPath, [reviewTool, '--state', restored, '--project', projectId,
    '--allow-path', 'src/', '--output', reviewFile], { encoding: 'utf8' }))
  assert.equal(prepared.status, 'prepared')
  assert.equal(prepared.startupAvailable, false)
  assert.equal(prepared.access, 'historical_data_read_only')
  assert.equal(existsSync(reviewFile), true)
  assert.equal(lstatSync(reviewFile).mode & 0o777, 0o600)
  // The CLI refuses to overwrite its own consent file.
  assert.throws(() => execFileSync(process.execPath, [reviewTool, '--state', restored, '--project', projectId,
    '--allow-path', 'src/', '--output', reviewFile], { stdio: 'pipe' }))

  const fileText = JSON.parse(readFileSync(reviewFile, 'utf8'))
  assert.equal(fileText.payload.access, 'historical_data_read_only')
  assert.equal(fileText.payload.startupAvailable, false)
  assert.ok(Date.parse(fileText.payload.expiresAt) - Date.parse(fileText.payload.createdAt) <= 5 * 60 * 1000)
  const serialized = JSON.stringify(fileText)
  assert.equal(fileText.payload.stateRoot, realpathSync(restored))
  assert.equal(serialized.includes(apiKey), false)
  assert.equal(serialized.includes(secret.toString('hex')), false)
  assert.equal(fileText.payload.protocol, 'restored-personal-review/1')
  assert.notEqual(fileText.payload.protocol, v1.manifest.protocol)

  // Signature, scope, file, expiry and identity changes are refused by the actual loader.
  const checkStore = new ProductStore({ path: join(restored, 'state.sqlite') })
  cleanups.push(() => checkStore.close())
  assert.deepEqual(loadRestoredReview(reviewFile, checkStore, restored, principal, secret), [{ id: projectId, displayName: projectId, scope: reviewScope, discussionOnly: true }])
  // The consent is bound to the source fingerprint of exactly this restored database, not a refreshed one.
  assert.equal(fileText.payload.sourceFingerprint, checkStore.workflows.recoverySource.inspect().sourceFingerprint)
  assert.throws(() => loadRestoredReview(reviewFile, checkStore, restored, principal, secret, new Date(Date.now() + 10 * 60 * 1000).toISOString()), forbidden)
  assert.throws(() => loadRestoredReview(reviewFile, checkStore, restored, { ...principal, userId: 'foreign' }, secret), forbidden)
  assert.throws(() => loadRestoredReview(reviewFile, checkStore, root, principal, secret), forbidden)
  assert.throws(() => loadRestoredReview(reviewFile, checkStore, restored, principal, Buffer.alloc(32, 102)), forbidden)
  const widened = JSON.parse(readFileSync(reviewFile, 'utf8'))
  widened.payload.projects[0].allowedPaths = ['.']
  writeFileSync(reviewFile, JSON.stringify(widened))
  assert.throws(() => loadRestoredReview(reviewFile, checkStore, restored, principal, secret), forbidden)
  writeFileSync(reviewFile, JSON.stringify(fileText))
  chmodSync(reviewFile, 0o644)
  assert.throws(() => loadRestoredReview(reviewFile, checkStore, restored, principal, secret), forbidden)
  chmodSync(reviewFile, 0o600)
  const link = join(root, 'review-link.json')
  symlinkSync(reviewFile, link)
  assert.throws(() => loadRestoredReview(link, checkStore, restored, principal, secret), forbidden)
  unlinkSync(link)
  const fifo = join(root, 'review.fifo')
  execFileSync('mkfifo', [fifo])
  assert.throws(() => loadRestoredReview(fifo, checkStore, restored, principal, secret), forbidden)
  assert.throws(() => loadRestoredReview(join(root, 'missing.json'), checkStore, restored, principal, secret))

  // A tiny synthetic copy proves source/marker/signature drift is refused without touching the real restored root.
  {
    const driftRoot = join(root, 'drift')
    const driftState = join(driftRoot, 'state')
    mkdirSync(driftState, { recursive: true, mode: 0o700 })
    const driftStore = new ProductStore({ path: join(driftState, 'state.sqlite') })
    try {
      driftStore.product.messages.append({
        id: 'drift-source', projectId, conversationId: 'drift-conversation', role: 'user', provenance: 'trusted_user',
        text: '保留原错误码', sourceRefs: [], createdAt: '2026-11-13T00:00:00.000Z',
      })
      const marker = join(driftState, 'restore-report.json')
      writeFileSync(marker, JSON.stringify({ protocol: 'personal-restore/1', targetPath: driftState,
        database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
      const now = new Date().toISOString()
      const consent = prepareRestoredReview(driftStore, driftState, principal, [{ projectId, allowedPaths: ['src/'], excludedPaths: ['.git'] }], secret, now)
      const driftFile = join(driftRoot, 'review.json')
      writeFileSync(driftFile, JSON.stringify(consent), { mode: 0o600 })
      loadRestoredReview(driftFile, driftStore, driftState, principal, secret, now)
      for (const [label, mutate] of [
        ['source change', () => driftStore.queue.enqueue('application.execute', 'drift-queue', '{}', 1, 0, now)],
        ['marker change', () => writeFileSync(marker, 'changed restore marker')],
        ['signature change', () => { const tampered = { ...consent, signature: '0'.repeat(64) }; writeFileSync(driftFile, JSON.stringify(tampered)) }],
      ] as const) {
        mutate()
        assert.throws(() => loadRestoredReview(driftFile, driftStore, driftState, principal, secret, now), forbidden, label)
      }
      for (const selection of [
        [{ projectId: 'unknown-project', allowedPaths: ['src/'] }],
        [{ projectId, allowedPaths: ['../outside'] }],
        [{ projectId, allowedPaths: ['src/'], externalActions: ['deploy'] }],
        [{ projectId, allowedPaths: ['src/'], executable: true }],
      ]) {
        assert.throws(() => prepareRestoredReview(driftStore, driftState, principal, selection as never, secret, now), JSON.stringify(selection))
      }
    } finally {
      driftStore.close()
    }
  }

  // A fresh valid file (the real root is unchanged) starts the explicit read-only review.
  const freshReview = join(root, 'fresh-startup-review.json')
  execFileSync(process.execPath, [reviewTool, '--state', restored, '--project', projectId,
    '--allow-path', 'src/', '--output', freshReview], { encoding: 'utf8' })
  await start(freshReview)
  const health = await (await fetch(`${api}/v1/health`)).json()
  assert.equal(health.mode, 'personal')
  assert.equal(health.startupMode, 'recovery_readonly')
  const config = await (await fetch(`${api}/v1/configuration`, { headers })).json()
  const selected = config.projects.find((project: { id: string }) => project.id === projectId)
  assert.ok(selected)
  assert.equal(selected.dispatchAllowed, false)
  assert.deepEqual(selected.profileIds, [])
  assert.deepEqual(selected.scope, reviewScope)

  // Historical candidate/body/source/history stay reviewable with the original identity and frozen digests.
  const candidateResponse = await fetch(`${api}/v1/messages/${sourceMessageId}/candidates`, { headers })
  const candidates = await candidateResponse.json()
  assert.equal(candidateResponse.status, 200, JSON.stringify(candidates))
  assert.equal(candidates.executable, false, JSON.stringify(candidates))
  assert.equal(candidates.authorization, 'none')
  assert.equal((candidates.candidates as { payloadDigest: string }[])[0]!.payloadDigest, reviewedCandidate.payloadDigest)
  const historyResponse = await fetch(`${api}/v1/context/history?projectId=${projectId}`, { headers })
  const history = await historyResponse.json()
  assert.equal(historyResponse.status, 200, JSON.stringify(history))
  assert.equal(history.entries.length, 1)
  assert.equal(history.entries[0].messageId, contextMessageId)
  const sourcesResponse = await fetch(`${api}/v1/messages/${contextMessageId}/context/sources`, { headers })
  assert.equal(sourcesResponse.status, 200, await sourcesResponse.clone().text())
  const sources = await sourcesResponse.json()
  assert.equal(sources.state, 'verified')
  const frozenAudit = await (await fetch(`${api}/v1/messages/${contextMessageId}/context`, { headers })).json()
  assert.equal(frozenAudit.bundleDigest, frozenDigest)
  for (const payload of [candidates, history, sources, frozenAudit]) {
    const serialized = JSON.stringify(payload)
    assert.equal(serialized.includes(realpathSync(restored)), false)
    assert.equal(serialized.includes(apiKey), false)
    assert.equal(serialized.includes(secret.toString('hex')), false)
  }

  // Real Work/Ticket/Q&A data is visible, while its permission display never becomes reusable model input.
  const snapshotResponse = await fetch(`${api}/v1/snapshot`, { headers })
  assert.equal(snapshotResponse.status, 200)
  const snapshot = await snapshotResponse.json()
  assert.ok((snapshot.works as { work: { id: string } }[]).some((work) => work.work.id === workId))
  const deliveredWork = await (await fetch(`${api}/v1/works/${workId}`, { headers })).json()
  assert.equal(deliveredWork.phase, 'delivered')
  const deliveries = await (await fetch(`${api}/v1/questions/${question.id}/deliveries`, { headers })).json()
  assert.equal((deliveries as { status: string }[])[0]?.status, 'native_applied')
  const restoredPage = new ProductStore({ path: join(restored, 'state.sqlite') })
  try {
    const messages = restoredPage.product.messages.page(conversationId).messages
    const restoredDisplay = messages.find((message) => message.provenance === 'question_answer_display')
    assert.ok(restoredDisplay)
    for (const source of (sources.sources as { content: string }[])) assert.equal(source.content.includes(restoredDisplay.text), false)
    for (const message of messages) {
      if (!initialIds.has(message.id) || message.provenance === 'question_answer_display') continue
      assert.ok(message.anchor !== undefined, `historical message ${message.id} lost its anchor`)
    }
  } finally {
    restoredPage.close()
  }

  // Every business mutation and provider/queue/native effect stays refused in personal review.
  for (const [path, body] of [
    ['/v1/assistant/candidates/prepare', { messageId: sourceMessageId, index: reviewedCandidate.index, payloadDigest: reviewedCandidate.payloadDigest }],
    ['/v1/commands', { kind: 'chat', commandId: 'review-chat', projectId, conversationId, text: 'x' }],
    ['/v1/commands', { kind: 'answer_question', commandId: 'review-answer', conversationId, questionId: question.id, expectedVersion: 2, answer: { kind: 'choices', optionIds: ['allow'] } }],
    ['/v1/commands', { kind: 'create_work', commandId: 'review-create', conversationId, projectId, goal: 'x', profileId: 'profile-fixture-question', scope: runtimeScope, criteria }],
    ['/v1/proposals/commands', { kind: 'reject_proposal', commandId: 'review-reject', projectId, conversationId, token: 'a.b' }],
    ['/v1/context/preview', { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } }],
    ['/v1/assistant/context/send', { commandId: 'personal-context', token: preparedContext.token }],
  ] as const) {
    const refused = await fetch(`${api}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
    assert.equal(refused.status, 422, `${path} ${await refused.clone().text()}`)
  }
  assert.equal(model.requests.length, modelCalls)

  // Source facts can be prepared and confirmed in the personal review, but never grant target/business authority.
  const inspection = await (await fetch(`${api}/v1/recovery/inspect`, { headers })).json()
  assert.ok(inspection.inspectionFingerprint)
  const sourcePrepared = await (await fetch(`${api}/v1/recovery/source/prepare`, {
    method: 'POST', headers,
    body: JSON.stringify({
      preflight: { expectedFingerprint: inspection.inspectionFingerprint, bindings: [{ sourceProjectId: projectId, project: { path: scratch, check: 'node_test' } }] },
      targetStateRoot: join(root, 'review-target'),
    }),
  })).json() as { authorization: string; startupAvailable: boolean; token: string; intent: { activationId: string; target: { stateRoot: string } } }
  assert.equal(sourcePrepared.authorization, 'not_granted')
  assert.equal(sourcePrepared.startupAvailable, false)
  assert.equal(existsSync(sourcePrepared.intent.target.stateRoot), false)
  const sourceConfirmed = await (await fetch(`${api}/v1/recovery/source/confirm`, { method: 'POST', headers, body: JSON.stringify({ token: sourcePrepared.token }) })).json() as { startupAvailable: boolean }
  assert.equal(sourceConfirmed.startupAvailable, false)
  const audit = await (await fetch(`${api}/v1/recovery/activations/${sourcePrepared.intent.activationId}`, { headers })).json()
  assert.deepEqual(audit, sourceConfirmed)
  assert.equal(existsSync(sourcePrepared.intent.target.stateRoot), false)

  await stop()
  const after = new ProductStore({ path: join(restored, 'state.sqlite') })
  try {
    assert.equal(after.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length, 1)
    assert.equal(after.product.works.listByProject(projectId).length, 1)
  } finally { after.close() }
})
