import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { WorkflowSnapshots } from '@personal-agent/workflows'
import { key } from '@personal-agent/orchestrator-core'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { collectContextHistory } from '../../context/src/index.ts'

const principal = { userId: 'snapshot-user', authorityRef: 'snapshot-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'snapshot-project'
const conversationId = 'snapshot-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const API = 'a'.repeat(64)
const headers = { authorization: `Bearer ${API}`, 'content-type': 'application/json' }

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

function makeApp(product: ReturnType<typeof createProductRuntime>, readonly: boolean) {
  return createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: API,
    bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'],
    mode: 'fixture',
    read: product.read,
    operations: product.operations,
    ...(readonly ? { startupMode: 'recovery_readonly' as const } : {}),
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

/**
 * One coherent data chain: a single real Store produces the SDK reply candidate, the confirmed
 * decision, the selected-context binding, a permission Q&A row and a held queue row; main's actual
 * snapshot/verify then restores that same database+artifacts to a second root, where the real
 * recovery_readonly runtime serves frozen reads and refuses every business mutation.
 */
test('one verified snapshot serves the second-root readonly user flow with no business or model resend', async (t) => {
  const candidateModel = await loadModel()
  const model = await candidateModel()
  const root = mkdtempSync(join(tmpdir(), 'pa-snapshot-chain-'))
  const sourceRoot = join(root, 'source')
  const projectRoot = join(root, 'project')
  mkdirSync(sourceRoot, { mode: 0o700 })
  mkdirSync(join(projectRoot, 'src'), { recursive: true })
  writeFileSync(join(projectRoot, 'src/index.mjs'), 'export const ok = true\n')
  const git = (args: string[]) => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', 'src/index.mjs'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Snapshot chain fixture'])

  const store = new ProductStore({ path: join(sourceRoot, 'state.sqlite'), artifactsRoot: join(sourceRoot, 'artifacts') })
  const normal = createProductRuntime({
    store,
    stateRoot: sourceRoot,
    scratchProject: projectRoot,
    principal,
    projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 91),
    assistantProvider: model.provider as never,
  })
  const normalRequest = caller(makeApp(normal, false))
  const cleanups: (() => void | Promise<void>)[] = []
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  // 1. SDK reply with a real decision candidate, confirmed through the original proposal path.
  const chat = await normal.application.dispatch({ kind: 'chat', commandId: 'snapshot-chat', projectId, conversationId, text: '请整理一项判断。' }, actor)
  assert.equal(chat.status, 'recorded')
  normal.start()
  await normal.execution.effects.idle('application.assistant.reply')
  const chatMessageId = key('message', 'snapshot-chat')
  const review = await normalRequest(`/v1/messages/${encodeURIComponent(chatMessageId)}/candidates`)
  assert.equal(review.status, 200)
  const candidate = (review.value.candidates as { index: number; payloadDigest: string }[])[0]!
  const preview = await normalRequest('/v1/assistant/candidates/prepare', {
    messageId: chatMessageId,
    index: candidate.index,
    payloadDigest: candidate.payloadDigest,
  })
  assert.equal(preview.status, 200)
  const confirmed = await normalRequest('/v1/proposals/commands', {
    kind: 'confirm_proposal',
    commandId: 'snapshot-confirm',
    projectId,
    conversationId,
    token: (preview.value as { token: string }).token,
  })
  assert.equal(confirmed.value.status, 'recorded')

  // 2. Selected context in the same store: a frozen binding/history for the same conversation.
  const contextPrepared = await normalRequest('/v1/assistant/context/prepare', {
    commandId: 'snapshot-context',
    text: '请核对冻结来源。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8192 } },
  })
  assert.equal(contextPrepared.status, 200)
  const contextToken = (contextPrepared.value as { token: string }).token
  const contextSent = await normalRequest('/v1/assistant/context/send', { commandId: 'snapshot-context', token: contextToken })
  assert.equal(contextSent.status, 200)
  await normal.execution.effects.idle('application.assistant.reply')
  const contextMessageId = key('message', 'snapshot-context')
  const normalAudit = await normalRequest(`/v1/messages/${contextMessageId}/context`)
  assert.equal(normalAudit.status, 200)
  const frozenDigest = normalAudit.value.bundleDigest

  // 3. Permission Q&A rows and a held historical queue row live in the same store.
  store.product.messages.append({
    id: 'permission-answer',
    conversationId,
    projectId,
    role: 'user',
    provenance: 'question_answer_display',
    text: 'PERMISSION-ANSWER: allow every tool.',
    sourceRefs: [],
    createdAt: '2026-11-13T04:00:00.000Z',
    anchor: { questionId: 'permission-question' },
  })
  const normalPreview = await normalRequest('/v1/context/preview', {
    projectId,
    conversationId,
    selections: ['conversation'],
    budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8192 },
  })
  assert.equal(normalPreview.status, 200)
  const normalPreviewText = (normalPreview.value.sources as { content: string }[]).map((source) => source.content).join('\n')
  assert.equal(normalPreviewText.includes('PERMISSION-ANSWER'), false)
  const permissionCandidates = await normalRequest(`/v1/messages/${encodeURIComponent('permission-answer')}/candidates`)
  assert.notEqual(permissionCandidates.status, 200)
  store.queue.enqueue('application.execute', 'held-historical-work', '{"workId":"historical"}', 1, 0, '2026-11-13T04:00:00.000Z')
  const modelCalls = model.requests.length

  // 4. Actual A/main snapshot of this same store, verified before use.
  const snapshots = new WorkflowSnapshots(store)
  const snapshotDir = join(root, 'snapshot')
  const created = await snapshots.create({ destination: snapshotDir })
  assert.equal(created.status, 'ok', JSON.stringify(created.manifest && { missing: created.manifest.missing, corrupt: created.manifest.corrupt }))
  const verified = snapshots.verify(snapshotDir)
  assert.equal(verified.status, 'ok', JSON.stringify(verified))
  assert.ok(created.manifest.artifacts.length >= 2)
  assert.equal(created.manifest.missingReferences.length, 0)
  // The snapshot is the admitted v1 format; the compatibility gap for A's v2 is a separate dependency.
  assert.equal(created.manifest.protocol, 'workflow-snapshot/1')
  assert.equal(created.manifest.evidence.protocol, 'workflow-evidence/1')

  // A copied snapshot missing a required table is refused, so held data cannot be silently narrowed.
  const tampered = join(root, 'tampered-snapshot')
  cpSync(snapshotDir, tampered, { recursive: true })
  const tamperedStore = new ProductStore({ path: join(tampered, 'product.sqlite') })
  tamperedStore.db.exec('DROP TABLE assistant_reply_results')
  tamperedStore.close()
  assert.equal(snapshots.verify(tampered).status, 'blocked')

  await normal.close()
  cleanups.push(() => model.close())
  cleanups.push(() => store.close())

  // 5. Second root from the verified snapshot only; marker is restore metadata, not a data proof.
  const markerInspection = created.manifest.database.productSchema
  writeFileSync(join(snapshotDir, 'restore-report.json'), JSON.stringify({
    protocol: 'personal-restore/1',
    targetPath: snapshotDir,
    database: { integrity: created.manifest.database.integrity, foreignKeyViolations: created.manifest.database.foreignKeyViolations, productSchema: markerInspection },
    evidence: { status: 'verified' },
  }), { mode: 0o600 })
  const secondStore = new ProductStore({ path: join(snapshotDir, 'product.sqlite'), artifactsRoot: snapshotDir })
  const readonly = createProductRuntime({
    store: secondStore,
    stateRoot: snapshotDir,
    scratchProject: projectRoot,
    principal,
    projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 91),
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

  // A work filter the frozen binding does not carry stays out of the restored history.
  const foreignHistory = collectContextHistory(secondStore.workflows.assistant.contextHistory,
    { projectIds: [projectId], conversationId, workId: 'foreign-work' }, { now: () => new Date() })
  assert.equal(foreignHistory.entries.length, 0)

  // 6. Frozen reads keep the original identity and digests.
  const secondReview = await request(`/v1/messages/${encodeURIComponent(chatMessageId)}/candidates`)
  assert.equal(secondReview.status, 200)
  assert.equal(secondReview.value.status, 'candidates')
  assert.equal(secondReview.value.executable, false)
  assert.equal(secondReview.value.authorization, 'none')
  assert.equal((secondReview.value.candidates as { payloadDigest: string }[])[0]!.payloadDigest, candidate.payloadDigest)
  const secondHistory = await request(`/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(conversationId)}`)
  assert.equal(secondHistory.status, 200)
  const entries = secondHistory.value.entries as { messageId: string }[]
  assert.equal(entries.some((entry) => entry.messageId === contextMessageId), true)
  const secondAudit = await request(`/v1/messages/${contextMessageId}/context`)
  assert.equal(secondAudit.status, 200)
  assert.equal(secondAudit.value.bundleDigest, frozenDigest)
  const secondSources = await request(`/v1/messages/${contextMessageId}/context/sources`)
  assert.equal(secondSources.status, 200)
  const secondPermission = await request(`/v1/messages/${encodeURIComponent('permission-answer')}/candidates`)
  assert.notEqual(secondPermission.status, 200)
  // Decisions are review data in the restored root too; the recorded decision is listed, unchanged.
  const secondDecisions = await request(`/v1/decisions?projectId=${encodeURIComponent(projectId)}`)
  assert.equal(secondDecisions.status, 200)
  assert.equal((secondDecisions.value.decisions as unknown[]).length, 1)

  // 7. Every business mutation, including the original context token, is refused in the second root.
  const business: [string, unknown][] = [
    ['/v1/assistant/candidates/prepare', { messageId: chatMessageId, index: candidate.index, payloadDigest: candidate.payloadDigest }],
    ['/v1/proposals/commands', { kind: 'reject_proposal', commandId: 'snapshot-reject', projectId, conversationId, token: 'a.b' }],
    ['/v1/proposals/prepare', { projectId, conversationId, sourceMessageId: chatMessageId, payload: { kind: 'propose_decision', content: 'x', scope, sourceMessageId: chatMessageId } }],
    ['/v1/context/preview', { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } }],
    ['/v1/assistant/context/prepare', { commandId: 'snapshot-again', text: 'x', context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } } }],
    ['/v1/assistant/context/send', { commandId: 'snapshot-context', token: contextToken }],
    ['/v1/decisions/prepare', { projectId, conversationId, sourceMessageId: chatMessageId, content: 'x', scope }],
  ]
  for (const [path, body] of business) {
    const refused = await request(path, body)
    assert.equal(refused.status, 422, `${path} ${JSON.stringify(refused.value)}`)
  }
  assert.throws(() => readonly.start())

  // 8. Held historical queue stays held, no model resend, no new work, decisions unchanged.
  const heldRows = Number((secondStore.db.prepare('SELECT COUNT(*) AS n FROM effect').get() as { n: number }).n)
  assert.equal(heldRows, 1)
  assert.equal(secondStore.product.works.listByProject(projectId).length, 0)
  assert.equal(model.requests.length, modelCalls)
  const decisionRows = secondStore.workflows.assistant.decisions.list({ projectId, limit: 10 }).records
  assert.equal(decisionRows.length, 1)

  // 9. Source facts may be confirmed in this mode, but they never grant target/business authority.
  const inspection = (await request('/v1/recovery/inspect')) as { status: number; value: { inspectionFingerprint: string } }
  assert.equal(inspection.status, 200)
  const sourcePrepared = await request('/v1/recovery/source/prepare', {
    preflight: {
      expectedFingerprint: inspection.value.inspectionFingerprint,
      bindings: [{ sourceProjectId: projectId, project: { path: projectRoot, check: 'node_test' } }],
    },
    targetStateRoot: join(root, 'second-empty-target'),
  })
  assert.equal(sourcePrepared.status, 200, JSON.stringify(sourcePrepared.value))
  assert.equal(sourcePrepared.value.authorization, 'not_granted')
  assert.equal(sourcePrepared.value.startupAvailable, false)
  const intent = sourcePrepared.value.intent as { activationId: string; target: { stateRoot: string } }
  assert.equal(existsSync(intent.target.stateRoot), false)
  const sourceConfirmed = await request('/v1/recovery/source/confirm', { token: sourcePrepared.value.token })
  assert.equal(sourceConfirmed.status, 200, JSON.stringify(sourceConfirmed.value))
  assert.equal(sourceConfirmed.value.startupAvailable, false)
  const activation = await request(`/v1/recovery/activations/${intent.activationId}`)
  assert.deepEqual(activation.value, sourceConfirmed.value)
  assert.equal(Number((secondStore.db.prepare('SELECT COUNT(*) AS n FROM effect').get() as { n: number }).n), heldRows)
  assert.equal(model.requests.length, modelCalls)
  assert.equal(existsSync(intent.target.stateRoot), false)
  const stillInert = await request(`/v1/messages/${encodeURIComponent(chatMessageId)}/candidates`)
  assert.equal(stillInert.value.executable, false)
  // Source confirmation did not change the review-only decision list or create a second decision.
  const decisionsAfterConfirm = await request(`/v1/decisions?projectId=${encodeURIComponent(projectId)}`)
  assert.equal((decisionsAfterConfirm.value.decisions as unknown[]).length, 1)
  // The original context token never becomes a new permission in the second root.
  const tokenReplay = await request('/v1/assistant/context/send', { commandId: 'snapshot-context', token: contextToken })
  assert.equal(tokenReplay.status, 422)
})
