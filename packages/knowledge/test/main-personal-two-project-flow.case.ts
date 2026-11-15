import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { key } from '@personal-agent/orchestrator-core'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { ensureStarterProject, NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const principal = { userId: 'two-project-user', authorityRef: 'two-project-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }
const scopeFor = (projectId: string) => ({ projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 30000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`two-project condition timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

test('two controlled projects run the current preview, original Work, evidence, context and observation readers', { timeout: 240000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave30-two-projects-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const registry = new NativeProjectRegistry(stateRoot)
  const paths = [join(root, 'project-a'), join(root, 'project-b')]
  const records = paths.map((path, index) => {
    ensureStarterProject(path)
    const record = registry.prepare({ path, displayName: `two-project-${index}`, check: 'node_test' })
    registry.save(record)
    return record
  })
  // @ts-expect-error - main-owned fixture has no type declarations.
  const modelModule = (await import('../../../tests/integration/fixtures/assistant-candidate-model.mjs')) as unknown as {
    candidateModel(): Promise<{ file: string; requests: unknown[]; provider: unknown; close(): Promise<void> }>
  }
  const model = await modelModule.candidateModel()
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createProductRuntime({
    store, stateRoot, scratchProject: paths[0]!, projectRegistry: registry, assistantProvider: model.provider as never,
    projects: records.map((record, index) => ({ id: record.id, displayName: record.displayName, scope: scopeFor(record.id) })),
    principal, actionSecret: Buffer.alloc(32, 12),
  })
  t.after(async () => { await product.close().catch(() => undefined); await model.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
  product.start()
  const snapshotWorks = async () => ((await (await app.request('/v1/snapshot', { headers })).json()) as { works: { id: string; projectId: string }[] }).works
  const baseline = await snapshotWorks()

  const contexts = [] as { projectId: string; messageId: string; frozen: Record<string, any>; confirmToken: string }[]
  for (const [index, record] of records.entries()) {
    const chatId = `two-chat-${index}`, contextChatId = `two-context-prepare-${index}`
    await product.application.dispatch({ commandId: chatId, conversationId: `two-conversation-${index}`, kind: 'chat', projectId: record.id,
      text: `项目 ${index} 的普通讨论。` }, actor)
    await product.execution.effects.idle('application.assistant.reply')
    const sourceMessageId = key('message', chatId)
    const reviewed = (await (await app.request(`/v1/messages/${encodeURIComponent(sourceMessageId)}/candidates`, { headers })).json()) as
      { candidates: { index: number; payloadDigest: string }[] }
    const candidate = reviewed.candidates[0]!
    const preview = (await (await app.request('/v1/assistant/candidates/prepare', { method: 'POST', headers,
      body: JSON.stringify({ messageId: sourceMessageId, index: candidate.index, payloadDigest: candidate.payloadDigest }) })).json()) as { token: string }
    const confirmed = (await (await app.request('/v1/proposals/commands', { method: 'POST', headers,
      body: JSON.stringify({ kind: 'confirm_proposal', commandId: `two-confirm-${index}`, projectId: record.id,
        conversationId: `two-conversation-${index}`, token: preview.token }) })).json()) as { status?: string }
    assert.equal(confirmed.status, 'recorded')
    const prepared = await product.operations.assistantContextPrepare({ commandId: contextChatId,
      text: '按选定上下文再核对一次。', context: { projectId: record.id, conversationId: `two-conversation-${index}`,
        selections: ['conversation'], budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } } }, actor)
    await product.operations.assistantContextSend({ commandId: prepared.commandId, token: prepared.token }, actor)
    await product.execution.effects.idle('application.assistant.reply')
    const frozenResponse = await app.request(`/v1/messages/${encodeURIComponent(key('message', contextChatId))}/context`, { headers })
    const frozen = (await frozenResponse.json()) as Record<string, any>
    assert.equal(frozen.scope.projectId, record.id)
    assert.equal(Array.isArray(frozen.sources), true)
    contexts.push({ projectId: record.id, messageId: sourceMessageId, frozen, confirmToken: preview.token })
  }
  assert.match(contexts[0]!.frozen.bundleDigest, /^[a-f0-9]{64}$/)
  assert.match(contexts[1]!.frozen.bundleDigest, /^[a-f0-9]{64}$/)
  assert.notEqual(contexts[0]!.frozen.scope.projectId, contexts[1]!.frozen.scope.projectId)
  const modelCalls = model.requests.length

  const created: { projectId: string; workId: string; factsDigest: string; goal: string }[] = []
  for (const [index, record] of records.entries()) {
    const input = { projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }
    const first = (await (await app.request(`/v1/projects/${record.id}/recipes/preview`, { method: 'POST', headers, body: JSON.stringify(input) })).json()) as Record<string, any>
    assert.equal(first.status, 'draft', JSON.stringify(first.issues))
    assert.equal(first.authorization, 'none')
    assert.equal('token' in first, false)
    assert.equal(first.fields.projectId, record.id)
    assert.equal(JSON.stringify(first).includes(root), false)
    const again = (await (await app.request(`/v1/projects/${record.id}/recipes/preview`, { method: 'POST', headers, body: JSON.stringify(input) })).json()) as Record<string, any>
    assert.equal(again.factsDigest, first.factsDigest)
    assert.equal(again.configurationRevision, first.configurationRevision)

    // Cancel/abandon the preview: no Work is created by reading it.
    assert.equal((await snapshotWorks()).length, baseline.length + created.length)

    const dispatch = { kind: 'create_work' as const, commandId: `two-create-${index}`, conversationId: `two-conversation-${index}`, ...first.fields }
    const firstCreate = (await product.application.dispatch(dispatch as never, actor)) as unknown as { workId: string; status: string }
    const retried = (await product.application.dispatch(dispatch as never, actor)) as unknown as { workId: string; status: string }
    assert.equal(retried.workId, firstCreate.workId)
    assert.equal(retried.status, 'recorded')
    await assert.rejects(() => Promise.resolve(product.application.dispatch({ ...dispatch, goal: 'different goal' } as never, actor)))
    assert.equal((await snapshotWorks()).length, baseline.length + created.length + 1)

    const ready = await until(async () => (await product.application.inspect({ workId: firstCreate.workId })).works[0],
      (work) => work !== undefined && work.actions.available.includes('accept_candidate'))
    if (!ready!.actions.currentCandidate) throw new Error('work has no candidate')
    await product.application.dispatch({ kind: 'accept_candidate', commandId: `two-accept-${index}`,
      conversationId: `two-conversation-${index}`, candidate: ready!.actions.currentCandidate }, actor)
    assert.equal((await product.application.inspect({ workId: firstCreate.workId })).works[0]?.phase, 'delivered')

    const evidence = (await (await app.request(`/v1/works/${firstCreate.workId}/evidence`, { headers })).json()) as Record<string, any>
    assert.equal(evidence.workId, firstCreate.workId)
    const history = (await (await app.request(`/v1/works/${firstCreate.workId}/evidence/history`, { headers })).json()) as Record<string, any>
    assert.equal(Array.isArray(history.entries ?? history.items ?? history.history), true)
    created.push({ projectId: record.id, workId: firstCreate.workId, factsDigest: first.factsDigest, goal: first.fields.goal })
  }
  assert.notEqual(created[0]!.workId, created[1]!.workId)
  assert.equal(created[0]!.projectId, records[0]!.id)
  assert.equal(created[1]!.projectId, records[1]!.id)

  // Fresh facts must invalidate the earlier preview's digest; the stale digest is not an authorization.
  writeFileSync(join(paths[1]!, 'package.json'), JSON.stringify(
    { name: 'personal-agent-project', private: true, type: 'module', scripts: { test: 'node --test', probe: 'node --test' } }, null, 2) + '\n')
  const refreshed = (await (await app.request(`/v1/projects/${records[1]!.id}/recipes/preview`, { method: 'POST', headers,
    body: JSON.stringify({ projectId: records[1]!.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }) })).json()) as Record<string, any>
  assert.notEqual(refreshed.factsDigest, created[1]!.factsDigest)
  assert.equal(refreshed.authorization, 'none')

  // Foreign project, wrong path parameter and unknown project are refused by the existing readers.
  const cross = await app.request(`/v1/projects/${records[0]!.id}/recipes/preview`, { method: 'POST', headers,
    body: JSON.stringify({ projectId: records[1]!.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }) })
  assert.equal(cross.status, 400)
  const unknown = await app.request('/v1/projects/not-registered/recipes/preview', { method: 'POST', headers,
    body: JSON.stringify({ projectId: 'not-registered', kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }) })
  assert.equal(unknown.status, 403)

  // 7/30-day observation stays per project, read-only and layer-labelled.
  const worksBefore = (await snapshotWorks()).length
  for (const record of records) {
    for (const days of [7, 30]) {
      const observation = (await (await app.request(`/v1/insights?days=${days}&projectId=${record.id}&timezone=UTC`, { headers })).json()) as Record<string, any>
      assert.equal(observation.protocol, 'usage-observation/1')
      assert.equal(observation.days, days)
      assert.equal(observation.authorization, 'none')
      assert.deepEqual(observation.scope.projectIds, [record.id])
      assert.equal(observation.scope.aggregation, 'single_project')
      assert.equal(observation.windowLabel.includes(String(days)), true)
      assert.equal(observation.unknownCount === null || Number.isInteger(observation.unknownCount), true)
      for (const metric of observation.metrics as { layer: string }[])
        assert.equal(['native', 'controlled', 'observed', 'operator', 'unknown'].includes(metric.layer), true)
      assert.equal(JSON.stringify(observation).includes(root), false)
    }
  }
  const foreign = await app.request('/v1/insights?days=7&projectId=not-registered', { headers })
  assert.equal(foreign.status, 403)
  const invalidWindow = await app.request(`/v1/insights?days=90&projectId=${records[0]!.id}`, { headers })
  assert.equal(invalidWindow.status, 400)

  // Reading evidence, observation and preview adds no work, no model call and no native layer.
  assert.equal((await snapshotWorks()).length, worksBefore)
  assert.equal(model.requests.length, modelCalls)
})
