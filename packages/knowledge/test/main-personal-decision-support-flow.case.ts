import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { buildPersonalChain, conversationId, projectId, reviewScope } from './helpers/personal-chain.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const historyTool = join(repoRoot, 'packages/context/tools/wave30-completion-history.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'
const principal = { userId: 'wave22-user', authorityRef: 'wave22-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }

function facts(database: string, workId: string): Record<string, any> {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', historyTool,
    '--a-worktree', aWorktree, '--db', database, '--work', workId, '--project', projectId], { encoding: 'utf8', timeout: 60000 })
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Record<string, any>
}

test('accepted and unknown stay distinct while revoked or superseded decisions never revive or grant execution', { timeout: 180000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave30-support-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const database = join(chain.source, 'state.sqlite')

  // Accepted comes from the original manual acceptance; the recorded unknown send is preserved as unknown.
  const before = facts(database, chain.workId)
  assert.equal(before.completion.acceptances.length, 1)
  assert.equal(before.completion.acceptances[0].actorRef, 'local-demo-authority')
  assert.equal(before.completion.reviews[0].canonical, true)
  const store = new ProductStore({ path: database })
  try {
    const unknown = store.dispatch.get(chain.dispatchWindows.unknown.commandId, chain.dispatchWindows.unknown.target)
    assert.equal(unknown?.delivery, 'indeterminate')
    assert.equal(typeof unknown?.error, 'string')
    const written = store.dispatch.get(chain.dispatchWindows.written.commandId, chain.dispatchWindows.written.target)
    assert.equal(written?.delivery, 'written')
    assert.equal(store.dispatch.beginSend(chain.dispatchWindows.unknown.commandId, chain.dispatchWindows.unknown.target).proceed, false)
    assert.equal(store.dispatch.get(chain.dispatchWindows.unknown.commandId, chain.dispatchWindows.unknown.target)?.delivery, 'indeterminate')
  } finally { store.close() }

  const runtime = createProductRuntime({ store: new ProductStore({ path: database }), principal,
    projects: [{ id: projectId, scope: reviewScope }], actionSecret: Buffer.alloc(32, 121),
    stateRoot: chain.source, scratchProject: chain.scratch, executionUnavailable: 'operator_disabled' })
  t.after(async () => { await runtime.close().catch(() => undefined) })
  const app = createLocalHttpApp({ application: runtime.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: runtime.read, operations: runtime.operations })
  runtime.start()

  const sourceMessageId = chain.sourceMessageId
  const decisionA = `decision-${Date.now()}`
  const preparedA = (await (await app.request('/v1/decisions/prepare', { method: 'POST', headers,
    body: JSON.stringify({ projectId, conversationId, sourceMessageId,
      content: '保留错误码 E1，不要吞掉异常。', scope: reviewScope }) })).json()) as Record<string, any>
  assert.equal(preparedA.protocol, 'decision-preview/1')
  const recordedA = (await (await app.request('/v1/decisions/commands', { method: 'POST', headers,
    body: JSON.stringify({ kind: 'record_decision', commandId: `w30-record-a-${decisionA}`, projectId,
      conversationId, token: preparedA.token }) })).json()) as Record<string, any>
  assert.equal(recordedA.status, 'recorded')
  const decisionId = preparedA.decision.id as string
  assert.equal(typeof decisionId, 'string')

  const previewBefore = (await (await app.request('/v1/context/preview', { method: 'POST', headers,
    body: JSON.stringify({ projectId, conversationId, selections: ['decisions', 'conversation'],
      budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } }) })).json()) as Record<string, any>
  const decisionGroup = (previewBefore.groups as { name: string; status: string; used: number }[]).find((group) => group.name === 'decisions')
  assert.ok(decisionGroup)
  assert.notEqual(decisionGroup!.status, 'unavailable')

  const preparedB = (await (await app.request('/v1/decisions/prepare', { method: 'POST', headers,
    body: JSON.stringify({ projectId, conversationId, sourceMessageId, supersedes: decisionId,
      content: '改用结构化错误对象，仍不暴露内部路径。', scope: reviewScope }) })).json()) as Record<string, any>
  assert.equal(preparedB.protocol, 'decision-preview/1')
  const recordedB = (await (await app.request('/v1/decisions/commands', { method: 'POST', headers,
    body: JSON.stringify({ kind: 'record_decision', commandId: `w30-record-b-${decisionA}`, projectId,
      conversationId, token: preparedB.token }) })).json()) as Record<string, any>
  assert.equal(recordedB.status, 'recorded')
  const decisionB = preparedB.decision.id as string
  const superseded = (await (await app.request(`/v1/decisions?projectId=${projectId}&limit=50`, { headers })).json()) as Record<string, any>
  const statusOf = (id: string) => (superseded.decisions as { record: { decision: { id: string } }; status: string }[])
    .find((view) => view.record.decision.id === id)?.status
  assert.equal(statusOf(decisionId), 'superseded')
  assert.equal(statusOf(decisionB), 'recorded')
  const previewWithB = (await (await app.request('/v1/context/preview', { method: 'POST', headers,
    body: JSON.stringify({ projectId, conversationId, selections: ['decisions', 'conversation'],
      budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } }) })).json()) as Record<string, any>
  const usedWithB = (previewWithB.groups as { name: string; used: { files: number } }[]).find((group) => group.name === 'decisions')?.used.files
  assert.equal(usedWithB !== undefined && usedWithB >= 1, true)

  const revoked = (await (await app.request('/v1/decisions/commands', { method: 'POST', headers,
    body: JSON.stringify({ kind: 'revoke_decision', commandId: `w30-revoke-b-${decisionA}`, projectId,
      conversationId, decisionId: decisionB, expectedVersion: 1 }) })).json()) as Record<string, any>
  assert.equal(revoked.status, 'recorded')
  // A superseded or revoked predecessor can never take a new successor again.
  const preparedC = await app.request('/v1/decisions/prepare', { method: 'POST', headers,
    body: JSON.stringify({ projectId, conversationId, sourceMessageId, supersedes: decisionId,
      content: '第三条建议。', scope: reviewScope }) })
  assert.equal([409, 422].includes(preparedC.status), true, `supersede inactive returned ${preparedC.status}`)

  // Superseded/revoked records stay auditable; replaying the old token does not resurrect them.
  const catalog = (await (await app.request(`/v1/decisions?projectId=${projectId}&limit=50`, { headers })).json()) as Record<string, any>
  const entry = (catalog.decisions as { record: { decision: { id: string; version: number } }; status: string }[])
    .find((view) => view.record.decision.id === decisionId)
  assert.ok(entry)
  assert.equal(entry!.status, 'superseded')
  const entryB = (catalog.decisions as { record: { decision: { id: string; version: number } }; status: string }[])
    .find((view) => view.record.decision.id === decisionB)
  assert.equal(entryB!.status, 'revoked')
  assert.equal(entryB!.record.decision.version, 2)
  const replay = (await (await app.request('/v1/decisions/commands', { method: 'POST', headers,
    body: JSON.stringify({ kind: 'record_decision', commandId: `w30-record-a-${decisionA}`, projectId,
      conversationId, token: preparedA.token }) })).json()) as Record<string, any>
  assert.equal(replay.status, 'recorded')
  const catalogAfterReplay = (await (await app.request(`/v1/decisions?projectId=${projectId}&limit=50`, { headers })).json()) as Record<string, any>
  const replayed = (catalogAfterReplay.decisions as { record: { decision: { id: string } }; status: string }[])
    .find((view) => view.record.decision.id === decisionId)
  assert.equal(replayed!.status, 'superseded')
  const previewAfter = (await (await app.request('/v1/context/preview', { method: 'POST', headers,
    body: JSON.stringify({ projectId, conversationId, selections: ['decisions', 'conversation'],
      budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } }) })).json()) as Record<string, any>
  const afterGroup = (previewAfter.groups as { name: string; used: { files: number } }[]).find((group) => group.name === 'decisions')
  assert.equal(afterGroup !== undefined && usedWithB !== undefined && afterGroup.used.files === usedWithB - 1, true)
  const decisionSources = (previewAfter.sources as { kind: string; path: string }[]).filter((source) => source.kind === 'decision')
  assert.equal(decisionSources.some((source) => source.path.includes(decisionId) || source.path.includes(decisionB)), false)

  // Supersede/revoke writes no acceptance, verification, dispatch or model call.
  const after = facts(database, chain.workId)
  assert.equal(after.completion.acceptances.length, before.completion.acceptances.length)
  assert.equal(after.completion.verifications.length, before.completion.verifications.length)
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
