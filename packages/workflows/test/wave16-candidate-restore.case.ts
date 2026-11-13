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
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { WorkflowSnapshots } from '../src/index.ts'
// @ts-expect-error main-owned plain-JS fixture without declarations
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'

const principal = { userId: 'wave16-candidate-user', authorityRef: 'wave16-candidate-authority' }
const actor = { ...principal, source: 'local_cli' as const }, projectId = 'wave16-candidate-project', conversationId = 'wave16-candidate-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const apiToken = 'a'.repeat(64), headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }

test('a real candidate confirmation survives a snapshot restore at a second root', async t => {
  const model = await candidateModel(), root = model.root, stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Candidate restore fixture'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
    projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 61), assistantProvider: model.provider })
  let restored: ProductStore | undefined
  t.after(async () => { if (restored) try { restored.close() } catch { /* closed in test */ }
    await product.close(); store.close(); await model.close(); rmSync(root, { recursive: true, force: true }) })
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

  store.queue.enqueue('application.execute', 'wave16-candidate-held', '{"held":true}', 1, 0, new Date().toISOString())
  const snapshot = join(root, 'snapshot')
  const created = await new WorkflowSnapshots(store).create({ destination: snapshot })
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

    // Start the actual recovery_readonly runtime/HTTP over the second-root database.
    const readonly = createProductRuntime({ store: restored, stateRoot: restoreRoot, scratchProject: projectRoot, principal,
      projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 63), startupMode: 'recovery_readonly' })
    try {
      const app = createLocalHttpApp({ application: readonly.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
        allowedOrigins: ['http://127.0.0.1:5173'], mode: 'personal', startupMode: 'recovery_readonly',
        read: readonly.read, operations: readonly.operations })
      const snapshotResponse = await app.request(`http://127.0.0.1/v1/snapshot?conversationId=${encodeURIComponent(conversationId)}`, { headers })
      assert.equal(snapshotResponse.status, 200)
      const snapshotValue = await snapshotResponse.json() as any
      assert.ok(snapshotValue.conversation.messages.some((message: any) => message.provenance === 'reasoner_reply' && message.text.length > 0))
      const queueBefore = restored.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10)
      const eventsBefore = restored.events.cursor()
      const rejected = await app.request('http://127.0.0.1/v1/commands', { method: 'POST', headers,
        body: JSON.stringify({ kind: 'chat', commandId: 'readonly-must-not-send', conversationId, projectId, text: 'Do not send' }) })
      assert.notEqual(rejected.status, 200)
      assert.deepEqual(restored.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10), queueBefore)
      assert.equal(restored.events.cursor(), eventsBefore)
      assert.equal(restored.product.messages.page(conversationId).messages.filter(message => message.provenance === 'reasoner_reply').length, 1)
    } finally { await readonly.close() }
  } finally { restored.close(); restored = undefined; rmSync(restoreRoot, { recursive: true, force: true }) }
})
