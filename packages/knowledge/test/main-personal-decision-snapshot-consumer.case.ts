import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { key } from '@personal-agent/orchestrator-core'
import { ProductStore } from '@personal-agent/storage'
import {
  AssistantDecisionStore, DecisionGovernance, captureDecisionSnapshot, revalidateDecisionSnapshot,
} from '@personal-agent/knowledge'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const principal = { userId: 'wave33-snapshot-user', authorityRef: 'wave33-snapshot-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
const projectA = 'wave33-project-a', projectB = 'wave33-project-b'
const scopeFor = (projectId: string) => ({ projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] })
const runtimeScope = (projectId: string) => ({ projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })
async function bounded<T>(promise: Promise<T> | T, label: string, ms = 45000): Promise<T> {
  return await Promise.race([Promise.resolve(promise),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`step '${label}' exceeded ${ms}ms`)), ms))])
}

test('a new Work can trace the current decision snapshot while revocation only changes future eligibility', { timeout: 240000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave33-snapshot-'))
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
    principal, actionSecret: Buffer.alloc(32, 31) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
  product.start()
  t.after(async () => {
    await bounded(Promise.all([product.close().catch(() => undefined), model.close().catch(() => undefined)]), 'cleanup', 20000)
      .catch((error) => console.error('AFTER_CLEANUP', String(error)))
    store.close()
    rmSync(root, { recursive: true, force: true })
  })

  const governance = new DecisionGovernance(new AssistantDecisionStore(store.workflows.assistant), {
    getMessage: async (id: string) => {
      const source = store.workflows.index.sourceMessage(id, [projectA, projectB])
      if (!source?.projectId || source.role !== 'user' || source.provenance !== 'trusted_user') return undefined
      return { messageId: source.id, projectId: source.projectId, conversationId: source.conversationId,
        role: 'user' as const, provenance: 'trusted_user' as const, textDigest: source.textDigest, createdAt: source.createdAt }
    },
  })

  const chat = async (projectId: string, conversationId: string, text: string) => {
    await product.application.dispatch({ commandId: `${conversationId}-chat`, conversationId, kind: 'chat', projectId, text }, actor)
    await bounded(product.execution.effects.idle('application.assistant.reply'), 'chat-idle')
    return key('message', `${conversationId}-chat`)
  }
  const messageA = await chat(projectA, 'wave33-conv-a', 'A 项目讨论：保留错误码。')
  const messageB = await chat(projectB, 'wave33-conv-b', 'B 项目讨论。')
  const recordDecision = async (projectId: string, conversationId: string, messageId: string, content: string, commandId: string) => {
    const prepared = (await (await app.request('/v1/decisions/prepare', { method: 'POST', headers, body: JSON.stringify({
      projectId, conversationId, sourceMessageId: messageId, content, scope: scopeFor(projectId) }) })).json()) as Record<string, any>
    const receipt = (await (await app.request('/v1/decisions/commands', { method: 'POST', headers, body: JSON.stringify({
      kind: 'record_decision', commandId, projectId, conversationId, token: prepared.token }) })).json()) as Record<string, any>
    assert.equal(receipt.status, 'recorded')
    return prepared.decision.id as string
  }
  const decisionA = await recordDecision(projectA, 'wave33-conv-a', messageA, '保留错误码 E1。', 'wave33-decision-a')
  const decisionB = await recordDecision(projectB, 'wave33-conv-b', messageB, 'B 项目约定。', 'wave33-decision-b')
  const modelCalls = model.requests.length

  const snapshotA = await captureDecisionSnapshot(governance, { projectId: projectA, max: 16 })
  assert.equal(snapshotA.authorization, 'none')
  assert.deepEqual(snapshotA.decisions.map((decision) => decision.decisionId), [decisionA])
  assert.equal(snapshotA.decisions[0]!.version, 1)
  assert.equal(snapshotA.decisions[0]!.scope.projectId, projectA)
  assert.equal(snapshotA.decisions[0]!.sourceMessageId, messageA)
  assert.equal((await captureDecisionSnapshot(governance, { projectId: projectB })).decisions[0]!.decisionId, decisionB)
  assert.equal((await revalidateDecisionSnapshot(governance, snapshotA, { projectId: projectA })).valid, true)

  // The current main context preview exposes the same decision source that the snapshot names.
  const preview = (await (await app.request('/v1/context/preview', { method: 'POST', headers, body: JSON.stringify({
    projectId: projectA, conversationId: 'wave33-conv-a', selections: ['decisions'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8000 } }) })).json()) as Record<string, any>
  const decisionSources = (preview.sources as { kind: string; path: string; content: string; sourceDigest: string }[]).filter((source) => source.kind === 'decision')
  assert.equal(decisionSources.length, 1)
  const embedded = JSON.parse(decisionSources[0]!.content) as { decisionId: string; content: string }
  assert.equal(embedded.decisionId, decisionA)
  assert.equal(decisionSources[0]!.path.includes(decisionA), true)
  const decisionDigest = decisionSources[0]!.sourceDigest
  assert.equal(model.requests.length, modelCalls)

  // A new Work created explicitly, then a Work-scoped context send, freezes both the Work and the decision.
  const created = (await product.application.dispatch({ kind: 'create_work', commandId: 'wave33-work', conversationId: 'wave33-conv-a',
    projectId: projectA, goal: '按当前决定修正错误码', profileId: 'profile-fixture-pass', scope: { ...scopeFor(projectA), excludedPaths: [] },
    criteria: [{ id: 'fixed-output', kind: 'machine', required: true, description: 'Output matches the registered check', checkDefinitionRef: 'check-fixture-output' },
      { id: 'review-output', kind: 'human', required: true, description: 'Review the frozen output' }] }, actor)) as unknown as { workId: string }
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const work = (await product.application.inspect({ workId: created.workId })).works[0]
    if (work?.actions.available.includes('accept_candidate')) break
    await new Promise((done) => setTimeout(done, 20))
  }
  const prepared = await product.operations.assistantContextPrepare({ commandId: 'wave33-work-context', text: '按冻结来源继续。',
    context: { projectId: projectA, conversationId: 'wave33-conv-a', workId: created.workId, selections: ['work', 'decisions'],
      budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16000 } } }, actor)
  await product.operations.assistantContextSend({ commandId: prepared.commandId, token: prepared.token }, actor)
  await bounded(product.execution.effects.idle('application.assistant.reply'), 'send-idle')
  const frozen = (await bounded((async () => await (await app.request(`/v1/messages/${encodeURIComponent(key('message', prepared.commandId))}/context`, { headers })).json())(), 'frozen-context')) as Record<string, any>
  const frozenSources = (frozen.sources ?? []) as { kind: string; sourceDigest: string; sourceId: string }[]
  assert.equal(frozenSources.some((source) => source.kind === 'decision' && source.sourceDigest === decisionDigest), true)
  assert.equal(frozenSources.some((source) => source.kind === 'work' || source.kind === 'contract'), true)

  // Revoking the decision blocks future selection but leaves the frozen context readable.
  const revoked = await bounded(app.request('/v1/decisions/commands', { method: 'POST', headers, body: JSON.stringify({
    kind: 'revoke_decision', commandId: 'wave33-revoke-a', projectId: projectA, conversationId: 'wave33-conv-a',
    decisionId: decisionA, expectedVersion: 1 }) }), 'revoke-request')
  assert.equal(revoked.status, 200)
  const late = await revalidateDecisionSnapshot(governance, snapshotA, { projectId: projectA })
  assert.equal(late.valid, false)
  assert.equal(late.code, 'inactive')
  const future = (await (await app.request('/v1/context/preview', { method: 'POST', headers, body: JSON.stringify({
    projectId: projectA, conversationId: 'wave33-conv-a', selections: ['decisions'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8000 } }) })).json()) as Record<string, any>
  assert.equal(((future.sources as { kind: string }[]) ?? []).filter((source) => source.kind === 'decision').length, 0)
  const frozenAgain = (await bounded((async () => await (await app.request(`/v1/messages/${encodeURIComponent(key('message', prepared.commandId))}/context`, { headers })).json())(), 'frozen-again')) as Record<string, any>
  assert.equal(frozenAgain.bundleDigest, frozen.bundleDigest)
  await assert.rejects(() => captureDecisionSnapshot(governance, { projectId: projectA, selectedDecisionIds: [decisionA] }),
    (error: { code?: string }) => error?.code === 'not_found')
  // Only the explicit context send produced one fixture reply; snapshots and reads add no model work.
  assert.equal(model.requests.length, modelCalls + 1)
  assert.equal((await product.application.inspect({ workId: created.workId })).works[0]?.phase !== undefined, true)
})
