import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { key } from '@personal-agent/orchestrator-core'
import { ProductStore } from '@personal-agent/storage'
import {
  AssistantDecisionStore, DecisionGovernance, assertDecisionSelectionBindingCurrentSync, assertDecisionSelectionCurrent,
  bindDecisionSelection, prepareDecisionSelection,
} from '@personal-agent/knowledge'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const principal = { userId: 'wave34-work-user', authorityRef: 'wave34-work-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
const projectA = 'wave34-project-a', projectB = 'wave34-project-b'
const runtimeScope = (projectId: string) => ({ projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })
const decisionScope = (projectId: string) => ({ projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] })
const criteria = [
  { id: 'fixed-output', kind: 'machine' as const, required: true, description: 'Output matches the registered check', checkDefinitionRef: 'check-fixture-output' },
  { id: 'review-output', kind: 'human' as const, required: true, description: 'Review the frozen output' },
]
async function bounded<T>(promise: Promise<T> | T, label: string, ms = 25000): Promise<T> {
  return await Promise.race([Promise.resolve(promise),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`step '${label}' exceeded ${ms}ms`)), ms))])
}

test('an explicit decision preparation is asserted before and after the original Work creation', { timeout: 240000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave34-work-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const database = join(stateRoot, 'state.sqlite')
  // @ts-expect-error - main-owned fixture has no type declarations.
  const modelModule = (await import('../../../tests/integration/fixtures/assistant-candidate-model.mjs')) as unknown as {
    candidateModel(): Promise<{ file: string; requests: unknown[]; provider: unknown; close(): Promise<void> }>
  }
  const model = await modelModule.candidateModel()
  const store = new ProductStore({ path: database })
  const product = createProductRuntime({ store, stateRoot, scratchProject: join(root, 'scratch'), assistantProvider: model.provider as never,
    projects: [{ id: projectA, displayName: 'A', scope: runtimeScope(projectA) }, { id: projectB, displayName: 'B', scope: runtimeScope(projectB) }],
    principal, actionSecret: Buffer.alloc(32, 41) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
  product.start()
  t.after(async () => {
    await bounded(Promise.all([product.close().catch(() => undefined), model.close().catch(() => undefined)]), 'cleanup')
      .catch((error) => console.error('AFTER_CLEANUP', String(error)))
    store.close(); rmSync(root, { recursive: true, force: true })
  })

  const governance = new DecisionGovernance(new AssistantDecisionStore(store.workflows.assistant), {
    getMessage: async (id: string) => {
      const source = store.workflows.index.sourceMessage(id, [projectA, projectB])
      if (!source?.projectId || source.role !== 'user' || source.provenance !== 'trusted_user') return undefined
      return { messageId: source.id, projectId: source.projectId, conversationId: source.conversationId,
        role: 'user' as const, provenance: 'trusted_user' as const, textDigest: source.textDigest, createdAt: source.createdAt }
    },
  })
  const chat = async (projectId: string, conversationId: string) => {
    await product.application.dispatch({ commandId: `${conversationId}-chat`, conversationId, kind: 'chat', projectId, text: '讨论。' }, actor)
    await bounded(product.execution.effects.idle('application.assistant.reply'), 'chat-idle')
    return key('message', `${conversationId}-chat`)
  }
  const messageA = await chat(projectA, 'wave34-conv-a')
  const messageB = await chat(projectB, 'wave34-conv-b')
  const recordDecision = async (projectId: string, conversationId: string, messageId: string, content: string, commandId: string, supersedes?: string) => {
    const prepared = (await (await app.request('/v1/decisions/prepare', { method: 'POST', headers, body: JSON.stringify({
      projectId, conversationId, sourceMessageId: messageId, content, scope: decisionScope(projectId),
      ...(supersedes ? { supersedes } : {}) }) })).json()) as Record<string, any>
    const receipt = (await (await app.request('/v1/decisions/commands', { method: 'POST', headers, body: JSON.stringify({
      kind: 'record_decision', commandId, projectId, conversationId, token: prepared.token }) })).json()) as Record<string, any>
    assert.equal(receipt.status, 'recorded')
    return prepared.decision.id as string
  }
  const decisionA = await recordDecision(projectA, 'wave34-conv-a', messageA, '保留错误码 E1。', 'wave34-decision-a')
  const decisionB = await recordDecision(projectB, 'wave34-conv-b', messageB, 'B 项目约定。', 'wave34-decision-b')

  const preparation = await prepareDecisionSelection(governance, { projectId: projectA, selectedDecisionIds: [decisionA],
    projectScope: runtimeScope(projectA) })
  assert.equal(preparation.protocol, 'decision-selection-preparation/1')
  assert.equal(preparation.authorization, 'none')
  assert.equal(preparation.scopeChecked, true)
  assert.equal(preparation.scopeMatch, true)
  assert.deepEqual(preparation.snapshot.decisions.map((decision) => decision.decisionId), [decisionA])
  assert.equal(preparation.snapshot.decisions[0]!.version, 1)
  assert.equal((await assertDecisionSelectionCurrent(governance, preparation, { projectId: projectA,
    projectScope: runtimeScope(projectA) })).current, true)
  assert.equal((await prepareDecisionSelection(governance, { projectId: projectA, selectedDecisionIds: [decisionB] })
    .then(() => false, (error: { code?: string }) => error.code === 'not_found')), true)
  await assert.rejects(() => prepareDecisionSelection(governance, { projectId: projectA, selectedDecisionIds: [decisionA, decisionA] }),
    (error: { code?: string }) => error.code === 'conflict')
  await assert.rejects(() => prepareDecisionSelection(governance, { projectId: projectA, projectScope: runtimeScope(projectB) }),
    (error: { code?: string }) => error.code === 'invalid_scope')
  await assert.rejects(() => prepareDecisionSelection(governance, { projectId: projectA, max: Number.NaN }),
    (error: { code?: string }) => error.code === 'invalid_scope')

  // Main's own preview names the same decision source/version that the preparation selected.
  const preview = (await (await app.request('/v1/context/preview', { method: 'POST', headers, body: JSON.stringify({
    projectId: projectA, conversationId: 'wave34-conv-a', selections: ['decisions'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8000 } }) })).json()) as Record<string, any>
  const previewDecision = (preview.sources as { kind: string; content: string; sourceDigest: string }[]).find((source) => source.kind === 'decision')!
  const embedded = JSON.parse(previewDecision.content) as { decisionId: string; sourceMessageId: string; scope: { projectId: string; allowedPaths: string[] } }
  assert.equal(embedded.decisionId, decisionA)
  assert.equal(embedded.sourceMessageId, preparation.snapshot.decisions[0]!.sourceMessageId)
  assert.deepEqual(embedded.scope.allowedPaths, preparation.snapshot.decisions[0]!.scope.allowedPaths)
  const decisionDigest = previewDecision.sourceDigest

  const worksBefore = ((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works.length
  const assertion = await assertDecisionSelectionCurrent(governance, preparation, { projectId: projectA, projectScope: runtimeScope(projectA) })
  assert.equal(assertion.current, true)
  const binding = await bindDecisionSelection(governance, preparation, { projectId: projectA, projectScope: runtimeScope(projectA) })
  assert.equal(binding.protocol, 'decision-selection-binding/1')
  assert.equal(binding.authorization, 'none')
  assert.match(binding.snapshotDigest, /^[a-f0-9]{64}$/)
  assert.equal(binding.decisions[0]!.decisionId, decisionA)
  const decisionRecords = new AssistantDecisionStore(store.workflows.assistant)
  const reader = {
    getDecision: (id: string) => decisionRecords.getSync(id),
    sourceTextDigest: (id: string) => store.workflows.index.sourceMessage(id, [projectA, projectB])?.textDigest,
  }
  const command = { kind: 'create_work' as const, commandId: 'wave34-work-a', conversationId: 'wave34-conv-a',
    projectId: projectA, goal: '按当前决定修正错误码', profileId: 'profile-fixture-pass', scope: runtimeScope(projectA), criteria }
  const preparedCommand = await product.application.prepareCommand(command as never, actor)
  const created = store.uow.atomic(() => {
    const guarded = assertDecisionSelectionBindingCurrentSync(binding, reader, { projectId: projectA, projectScope: runtimeScope(projectA) })
    assert.equal(guarded.current, true, JSON.stringify(guarded))
    return product.application.commitPrepared(preparedCommand) as unknown as { workId: string }
  })
  const worksAfter = ((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works.length
  assert.equal(worksAfter, worksBefore + 1)
  assert.equal((await assertDecisionSelectionCurrent(governance, preparation, { projectId: projectA,
    projectScope: runtimeScope(projectA) })).current, true)

  const workContext = await product.operations.assistantContextPrepare({ commandId: 'wave34-work-context', text: '按冻结来源继续。',
    context: { projectId: projectA, conversationId: 'wave34-conv-a', workId: created.workId, selections: ['work', 'decisions'],
      budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16000 } } }, actor)
  await product.operations.assistantContextSend({ commandId: workContext.commandId, token: workContext.token }, actor)
  await bounded(product.execution.effects.idle('application.assistant.reply'), 'send-idle')
  const frozen = (await (await app.request(`/v1/messages/${encodeURIComponent(key('message', workContext.commandId))}/context`, { headers })).json()) as Record<string, any>
  assert.equal((frozen.sources as { kind: string; sourceDigest: string }[]).some((source) => source.kind === 'decision' && source.sourceDigest === decisionDigest), true)

  // A decision change after creation requires an explicit re-preview; the frozen Work context is untouched.
  const revoke = await app.request('/v1/decisions/commands', { method: 'POST', headers, body: JSON.stringify({
    kind: 'revoke_decision', commandId: 'wave34-revoke-a', projectId: projectA, conversationId: 'wave34-conv-a',
    decisionId: decisionA, expectedVersion: 1 }) })
  assert.equal(revoke.status, 200)
  const late = await assertDecisionSelectionCurrent(governance, preparation, { projectId: projectA, projectScope: runtimeScope(projectA) })
  assert.equal(late.current, false)
  assert.equal(late.code, 'inactive')
  const frozenAgain = (await (await app.request(`/v1/messages/${encodeURIComponent(key('message', workContext.commandId))}/context`, { headers })).json()) as Record<string, any>
  assert.equal(frozenAgain.bundleDigest, frozen.bundleDigest)
  const lateBinding = assertDecisionSelectionBindingCurrentSync(binding, reader, { projectId: projectA, projectScope: runtimeScope(projectA) })
  assert.equal(lateBinding.current, false)
  const beforeRefusal = ((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works.length
  const preparedAfterRevoke = await product.application.prepareCommand({ ...command, commandId: 'wave34-work-after-revoke' } as never, actor)
  assert.equal(assertDecisionSelectionBindingCurrentSync(binding, reader, { projectId: projectA }).current, false)
  assert.equal(typeof preparedAfterRevoke, 'object')
  assert.equal(((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works.length, beforeRefusal)
  const forgedBinding = { ...binding, protocol: 'decision-selection-binding/2' }
  assert.equal(assertDecisionSelectionBindingCurrentSync(forgedBinding as never, reader).code, 'invalid_binding')
  assert.equal(assertDecisionSelectionBindingCurrentSync(binding, reader, { projectId: projectB }).code, 'project_mismatch')
  // The canonical digest and nested refs are part of the binding, not a decorative string.
  assert.equal(assertDecisionSelectionBindingCurrentSync({ ...binding, snapshotDigest: 'f'.repeat(64) }, reader).code, 'invalid_binding')
  const swappedRefs = { ...binding, decisions: binding.decisions.map((decision) => ({ ...decision, version: decision.version + 1 })) }
  assert.equal(assertDecisionSelectionBindingCurrentSync(swappedRefs as never, reader).code, 'invalid_binding')
  assert.equal(assertDecisionSelectionBindingCurrentSync({ ...binding, decisions: [] }, reader).code, 'invalid_binding')

  // A superseded predecessor fails even though its own version/revokedAt did not change.
  const supersededId = await recordDecision(projectA, 'wave34-conv-a', messageA, '将被替代。', 'wave34-decision-superseded')
  const supersededPreparation = await prepareDecisionSelection(governance, { projectId: projectA, selectedDecisionIds: [supersededId],
    projectScope: runtimeScope(projectA) })
  const supersededBinding = await bindDecisionSelection(governance, supersededPreparation, { projectId: projectA, projectScope: runtimeScope(projectA) })
  assert.equal(assertDecisionSelectionBindingCurrentSync(supersededBinding, reader, { projectId: projectA }).current, true)
  await recordDecision(projectA, 'wave34-conv-a', messageA, '替代版本。', 'wave34-decision-replacement', supersededId)
  const supersededNow = assertDecisionSelectionBindingCurrentSync(supersededBinding, reader, { projectId: projectA })
  assert.equal(supersededNow.current, false)
  assert.equal(supersededNow.code, 'inactive')
  assert.equal((await assertDecisionSelectionCurrent(governance, supersededPreparation, { projectId: projectA })).code, 'inactive')

  // A guard failure inside the transaction leaves no receipt and no Work.
  const refusedCommand = { ...command, commandId: 'wave36-guard-refused' }
  const refusedPrepared = await product.application.prepareCommand(refusedCommand as never, actor)
  const beforeGuardFailure = ((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works.length
  store.uow.atomic(() => {
    const guarded = assertDecisionSelectionBindingCurrentSync(supersededBinding, reader, { projectId: projectA })
    assert.equal(guarded.current, false)
    assert.equal(guarded.code, 'inactive')
  })
  assert.equal(store.commands.get('wave36-guard-refused'), undefined)
  assert.equal(((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works.length, beforeGuardFailure)
  assert.equal(typeof refusedPrepared, 'object')

  // Replaying an already committed create command returns the original Work even after later changes.
  const replayed = (await product.application.dispatch(command as never, actor)) as unknown as { workId: string }
  assert.equal(replayed.workId, created.workId)
  assert.equal(((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works.length, beforeGuardFailure)

  // A narrower project scope or a mismatched project cannot claim the preparation is current.
  const decisionC = await recordDecision(projectA, 'wave34-conv-a', messageA, '另一条决定。', 'wave34-decision-c')
  const narrow = await prepareDecisionSelection(governance, { projectId: projectA, selectedDecisionIds: [decisionC],
    projectScope: { ...runtimeScope(projectA), allowedPaths: ['docs/'] } })
  assert.equal(narrow.scopeChecked, true)
  assert.equal(narrow.scopeMatch, false)
  assert.equal((await assertDecisionSelectionCurrent(governance, narrow, { projectId: projectA,
    projectScope: { ...runtimeScope(projectA), allowedPaths: ['docs/'] } })).code, 'scope_changed')
  assert.equal((await assertDecisionSelectionCurrent(governance, narrow, { projectId: projectB })).code, 'project_mismatch')
  const forged = { ...preparation, protocol: 'decision-selection-preparation/2' }
  assert.equal((await assertDecisionSelectionCurrent(governance, forged as never)).code, 'invalid_snapshot')

  // No selection keeps the ordinary delegation path available.
  const ordinary = (await product.application.dispatch({ kind: 'create_work', commandId: 'wave34-work-ordinary', conversationId: 'wave34-conv-b',
    projectId: projectB, goal: '普通委托', profileId: 'profile-fixture-pass', scope: runtimeScope(projectB), criteria }, actor)) as unknown as { workId: string }
  assert.notEqual(ordinary.workId, created.workId)
  assert.equal(((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works.length, worksAfter + 1)
})
