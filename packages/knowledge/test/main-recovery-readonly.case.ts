import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { key } from '@personal-agent/orchestrator-core'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const principal = { userId: 'readonly-user', authorityRef: 'readonly-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'readonly-project'
const conversationId = 'readonly-conversation'
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

function appFor(product: ReturnType<typeof createProductRuntime>, readonly: boolean) {
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

function requestsFor(app: ReturnType<typeof appFor>) {
  return async (path: string, body?: unknown) => {
    const response = await app.request(path, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers,
    })
    return { status: response.status, value: (await response.json()) as Record<string, unknown> }
  }
}

test('a real recovery_readonly root reviews candidates and history but refuses business mutation', async (t) => {
  const candidateModel = await loadModel()
  const model = await candidateModel()
  const root = mkdtempSync(join(tmpdir(), 'pa-readonly-root-'))
  const stateRoot = join(root, 'state')
  const projectRoot = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 })
  mkdirSync(projectRoot)
  mkdirSync(join(projectRoot, 'src'))
  writeFileSync(join(projectRoot, 'src/index.mjs'), 'export const ok = true\n')
  const git = (args: string[]) => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', 'src/index.mjs'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Readonly fixture'])

  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite'), artifactsRoot: join(stateRoot, 'artifacts') })
  const normal = createProductRuntime({
    store,
    stateRoot,
    scratchProject: projectRoot,
    principal,
    projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 71),
    assistantProvider: model.provider as never,
  })
  const normalHttp = appFor(normal, false)
  const normalRequest = requestsFor(normalHttp)

  const chat = await normal.application.dispatch({
    kind: 'chat',
    commandId: 'readonly-chat',
    projectId,
    conversationId,
    text: '请给出一项明确建议。',
  }, actor)
  assert.equal(chat.status, 'recorded')
  normal.start()
  await normal.execution.effects.idle('application.assistant.reply')
  const messageId = key('message', 'readonly-chat')
  const review = await normalRequest(`/v1/messages/${encodeURIComponent(messageId)}/candidates`)
  assert.equal(review.status, 200)
  assert.equal(review.value.status, 'candidates')

  const prepared = await normalRequest('/v1/assistant/context/prepare', {
    commandId: 'readonly-context',
    text: '请核对冻结来源。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8192 } },
  })
  assert.equal(prepared.status, 200, JSON.stringify(prepared.value))
  const sent = await normalRequest('/v1/assistant/context/send', {
    commandId: 'readonly-context',
    token: (prepared.value as { token: string }).token,
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.value))
  await normal.execution.effects.idle('application.assistant.reply')
  const contextMessageId = key('message', 'readonly-context')
  const normalAudit = await normalRequest(`/v1/messages/${contextMessageId}/context`)
  assert.equal(normalAudit.status, 200)

  const inspection = await (normal.read.recovery as () => Promise<{ productSchema: number }>)()
  store.queue.enqueue('application.execute', 'old-held-work', '{"workId":"historical"}', 1, 0, '2026-11-13T02:00:00.000Z')
  const heldQueue = Number((store.db.prepare('SELECT COUNT(*) AS n FROM effect').get() as { n: number }).n)
  writeFileSync(join(stateRoot, 'restore-report.json'), JSON.stringify({
    protocol: 'personal-restore/1',
    targetPath: stateRoot,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: inspection.productSchema },
    evidence: { status: 'verified' },
  }), { mode: 0o600 })

  await normal.close()
  const modelCalls = model.requests.length
  const readonly = createProductRuntime({
    store,
    stateRoot,
    scratchProject: projectRoot,
    principal,
    projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 71),
    startupMode: 'recovery_readonly',
    assistantProvider: model.provider as never,
    recoveryExecutor: () => ({ id: 'read-only-fixture-executor', revision: 1, driverId: 'fixture-driver',
      driverApiMajor: 1 as const, driverRelease: 'fixture-release', executable: process.execPath, argv: [],
      expectedVersion: process.version, nativeConfigRef: 'fixture-config', permissionPolicyRevision: 'fixture-policy',
      requiredFeatures: [] }),
  })
  const app = appFor(readonly, true)
  const request = requestsFor(app)
  t.after(async () => {
    await readonly.close()
    store.close()
    await model.close()
    rmSync(root, { recursive: true, force: true })
  })

  // Read-only review paths keep working on the recovered root.
  const readonlyReview = await request(`/v1/messages/${encodeURIComponent(messageId)}/candidates`)
  assert.equal(readonlyReview.status, 200)
  assert.equal(readonlyReview.value.status, 'candidates')
  assert.equal(readonlyReview.value.executable, false)
  assert.equal(readonlyReview.value.authorization, 'none')
  const history = await request(`/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(conversationId)}`)
  assert.equal(history.status, 200, JSON.stringify(history.value))
  assert.ok(((history.value.entries as unknown[]) ?? []).length >= 1)
  const audit = await request(`/v1/messages/${contextMessageId}/context`)
  assert.equal(audit.status, 200)
  assert.equal(audit.value.bundleDigest, normalAudit.value.bundleDigest)
  const sources = await request(`/v1/messages/${contextMessageId}/context/sources`)
  assert.equal(sources.status, 200)

  // Every business mutation is refused in recovery_readonly.
  for (const [path, body] of [
    ['/v1/assistant/candidates/prepare', { messageId, index: 0, payloadDigest: (review.value.candidates as { payloadDigest: string }[])[0]!.payloadDigest }],
    ['/v1/proposals/commands', { kind: 'reject_proposal', commandId: 'readonly-reject', projectId, conversationId, token: 'a.b' }],
    ['/v1/proposals/prepare', { projectId, conversationId, sourceMessageId: messageId, payload: { kind: 'propose_decision', content: 'x', scope, sourceMessageId: messageId } }],
    ['/v1/context/preview', { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } }],
    ['/v1/assistant/context/prepare', { commandId: 'readonly-again', text: 'x', context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } } }],
    ['/v1/decisions/prepare', { projectId, conversationId, sourceMessageId: messageId, content: 'x', scope }],
  ] as const) {
    const refused = await request(path, body)
    assert.equal(refused.status, 422, `${path} ${JSON.stringify(refused.value)}`)
  }
  assert.throws(() => readonly.start())

  // main's actual source confirmation records intent only: no target, no business, no model call.
  const preflight = (await request('/v1/recovery/inspect')) as { status: number; value: { inspectionFingerprint: string } }
  assert.equal(preflight.status, 200)
  const sourcePrepared = await request('/v1/recovery/source/prepare', {
    preflight: {
      expectedFingerprint: preflight.value.inspectionFingerprint,
      bindings: [{ sourceProjectId: projectId, project: { path: projectRoot, check: 'node_test' } }],
    },
    targetStateRoot: join(root, 'new-empty-target'),
  })
  assert.equal(sourcePrepared.status, 200, JSON.stringify(sourcePrepared.value))
  assert.equal(sourcePrepared.value.authorization, 'not_granted')
  assert.equal(sourcePrepared.value.startupAvailable, false)
  const intent = sourcePrepared.value.intent as { activationId: string; target: { stateRoot: string } }
  assert.equal(existsSync(intent.target.stateRoot), false)

  const sourceConfirmed = await request('/v1/recovery/source/confirm', { token: sourcePrepared.value.token })
  assert.equal(sourceConfirmed.status, 200, JSON.stringify(sourceConfirmed.value))
  assert.equal(sourceConfirmed.value.authorization, 'not_granted')
  assert.equal(sourceConfirmed.value.startupAvailable, false)
  assert.equal(existsSync(intent.target.stateRoot), false)
  const auditActivation = await request(`/v1/recovery/activations/${intent.activationId}`)
  assert.equal(auditActivation.status, 200)
  assert.deepEqual(auditActivation.value, sourceConfirmed.value)

  // Confirmation never turns recovered candidates into executable work or consumes the held queue.
  assert.equal(Number((store.db.prepare('SELECT COUNT(*) AS n FROM effect').get() as { n: number }).n), heldQueue)
  assert.equal(store.product.works.listByProject(projectId).length, 0)
  assert.equal(model.requests.length, modelCalls)
  const stillInert = await request(`/v1/messages/${encodeURIComponent(messageId)}/candidates`)
  assert.equal(stillInert.status, 200)
  assert.equal(stillInert.value.executable, false)
})
