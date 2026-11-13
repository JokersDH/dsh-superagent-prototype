import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { key } from '@personal-agent/orchestrator-core'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { CompletedAssistantReplies } from '../../../apps/coordinator/product/assistant-reply-results.ts'
import { collectContextHistory } from '../../context/src/index.ts'
import { proposalDigest } from '../../proposals/src/index.ts'

const principal = { userId: 'chain-user', authorityRef: 'chain-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'chain-project'
const conversationId = 'chain-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const API = 'a'.repeat(64)

type ReplyContext = { projectId: string; conversationId: string; sourceMessageId: string; scope: typeof scope }
interface ModelFixture {
  readonly root: string
  readonly requests: unknown[]
  readonly key: string
  readonly provider: unknown
  setReply(value: (context: ReplyContext) => unknown): void
  close(): Promise<void>
}

async function loadModel(): Promise<(options?: { reply?: (context: ReplyContext) => unknown }) => Promise<ModelFixture>> {
  // @ts-expect-error - main-owned fixture has no type declarations; this test types its observed surface.
  const module = (await import('../../../tests/integration/fixtures/assistant-candidate-model.mjs')) as unknown as {
    candidateModel(options?: { reply?: (context: ReplyContext) => unknown }): Promise<ModelFixture>
  }
  return module.candidateModel
}

async function fixture(t: { after(fn: () => void): void }, reply?: (context: ReplyContext) => unknown) {
  const candidateModel = await loadModel()
  const model = await candidateModel(reply === undefined ? {} : { reply })
  const stateRoot = join(model.root, 'state')
  const projectRoot = join(model.root, 'project')
  mkdirSync(stateRoot, { recursive: true })
  mkdirSync(join(projectRoot, 'src'), { recursive: true })
  writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', 'src/.gitkeep'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Candidate chain fixture'])
  const storePath = join(stateRoot, 'state.sqlite')
  const artifactsRoot = join(stateRoot, 'artifacts')
  const store = new ProductStore({ path: storePath, artifactsRoot })
  const product = createProductRuntime({
    store,
    stateRoot,
    scratchProject: projectRoot,
    principal,
    projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 61),
    assistantProvider: model.provider as never,
  })
  const app = createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: API,
    bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5180'],
    mode: 'fixture',
    read: product.read,
    operations: product.operations,
  })
  const request = async (path: string, body?: unknown) => {
    const response = await app.request(path, {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
      headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' },
    })
    return { status: response.status, value: (await response.json()) as Record<string, unknown> }
  }
  let chats = 0
  const chat = async () => {
    chats += 1
    const commandId = `chain-chat-${chats}`
    const receipt = await product.application.dispatch({ kind: 'chat', commandId, projectId, conversationId, text: '请整理这个判断。' }, actor)
    assert.equal(receipt.status, 'recorded')
    product.start()
    await product.execution.effects.idle('application.assistant.reply')
    return key('message', commandId)
  }
  const inspect = (messageId: string) => request(`/v1/messages/${encodeURIComponent(messageId)}/candidates`)
  const prepare = async (messageId: string, index: number, payloadDigest: string) => {
    const result = await request('/v1/assistant/candidates/prepare', { messageId, index, payloadDigest })
    return result
  }
  const confirm = (preview: Record<string, unknown>, commandId: string, extra: Record<string, unknown> = {}) =>
    request('/v1/proposals/commands', { kind: 'confirm_proposal', commandId, projectId, conversationId, token: preview.token, ...extra })
  const reject = (preview: Record<string, unknown>, commandId: string) =>
    request('/v1/proposals/commands', { kind: 'reject_proposal', commandId, projectId, conversationId, token: preview.token })
  let closed = false
  t.after(async () => {
    if (!closed) {
      closed = true
      await product.close()
      store.close()
      await model.close()
    }
  })
  return {
    model,
    store,
    storePath,
    stateRoot,
    artifactsRoot,
    product,
    request,
    chat,
    inspect,
    prepare,
    confirm,
    reject,
    closeProduct: async () => {
      if (closed) return
      closed = true
      await product.close()
      store.close()
      await model.close()
    },
  }
}

function selectedCandidate(review: Record<string, unknown>, index = 0) {
  const candidates = review.candidates as { index: number; kind: string; payloadDigest: string; requiredInputs: string[] }[]
  return candidates.find((candidate) => candidate.index === index)!
}

test('the real local SDK result reaches candidate GET and pointer prepare without inventing a wrapper', async (t) => {
  const h = await fixture(t)
  const messageId = await h.chat()
  assert.equal(h.model.requests.length, 1)
  const review = await h.inspect(messageId)
  assert.equal(review.status, 200)
  const value = review.value
  assert.equal(value.protocol, 'assistant-candidates/1')
  assert.equal(value.status, 'candidates')
  assert.equal(value.executable, false)
  assert.equal(value.authorization, 'none')
  const candidate = selectedCandidate(value)
  assert.equal(candidate.kind, 'propose_decision')
  assert.deepEqual(candidate.requiredInputs, [])

  const prepared = await h.prepare(messageId, candidate.index, candidate.payloadDigest)
  assert.equal(prepared.status, 200, JSON.stringify(prepared.value))
  const preview = prepared.value as Record<string, unknown> & {
    record: { payloadDigest: string; payload: { content: string }; sourceTextDigest: string }
  }
  assert.equal(preview.record.payloadDigest, candidate.payloadDigest)
  assert.ok(preview.record.payload.content.length > 0)
  const receipt = h.store.commands.get(key('assistant-request', messageId))!
  const inference = receipt.result as { sourceTextDigest?: string }
  assert.equal(inference.sourceTextDigest, preview.record.sourceTextDigest)

  // The repo's real completed reader still verifies the artifact/receipt tuple behind that preview.
  const completed = new CompletedAssistantReplies(h.store, h.store.workflows.assistant.replyResults, principal, () => [projectId])
  const verified = completed.readVerified(key('assistant-request', messageId))!
  assert.equal(proposalDigest(verified.body.suggestions[candidate.index] as never), candidate.payloadDigest)
})

test('decision confirm, artifact corruption replay, and rejection keep one original transaction', async (t) => {
  const h = await fixture(t)
  const messageId = await h.chat()
  const review = (await h.inspect(messageId)).value
  const candidate = selectedCandidate(review)
  const preview = (await h.prepare(messageId, candidate.index, candidate.payloadDigest)).value as Record<string, unknown>
  const first = await h.confirm(preview, 'chain-confirm-1')
  assert.equal(first.status, 200)
  assert.equal(first.value.status, 'recorded')
  const replay = await h.confirm(preview, 'chain-confirm-1')
  assert.deepEqual(replay, first)
  const proposalId = (preview.record as { proposalId: string }).proposalId
  assert.equal(h.store.workflows.assistant.proposals.get(proposalId)?.state, 'confirmed')
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length, 1)
  assert.equal(h.model.requests.length, 1)

  // Revoking the recorded decision does not revive anything and the original receipt still replays.
  const recordedDecision = h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records[0]!.decision
  const revoked = await h.product.operations.decision({
    kind: 'revoke_decision',
    commandId: 'chain-revoke',
    projectId,
    conversationId,
    decisionId: recordedDecision.id,
    expectedVersion: 1,
  }, actor)
  assert.equal(revoked.status, 'recorded')
  assert.ok(h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records[0]!.decision.revokedAt)
  assert.deepEqual(await h.confirm(preview, 'chain-confirm-1'), first)
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length, 1)
  assert.equal(h.model.requests.length, 1)

  // A recorded confirmation replays even after the artifact bytes are damaged; nothing re-executes.
  const result = h.store.workflows.assistant.replyResults.forRequest(key('assistant-request', messageId))!
  writeFileSync(h.store.artifacts.filePath(result.artifactRef), 'corrupt after the recorded business result')
  assert.deepEqual(await h.confirm(preview, 'chain-confirm-1'), first)

  // A second reply rejects the original candidate and records no decision.
  const secondMessage = await h.chat()
  const secondReview = (await h.inspect(secondMessage)).value
  const rejectCandidate = selectedCandidate(secondReview)
  const rejectPreview = (await h.prepare(secondMessage, rejectCandidate.index, rejectCandidate.payloadDigest)).value as Record<string, unknown>
  const rejected = await h.reject(rejectPreview, 'chain-reject-1')
  assert.equal(rejected.value.status, 'recorded')
  assert.equal(h.store.workflows.assistant.proposals.get((rejectPreview.record as { proposalId: string }).proposalId)?.state, 'rejected')
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length, 1)
})

test('work candidates keep required inputs, refuse confirmation without them, and create one Work only when confirmed', async (t) => {
  const h = await fixture(t, (context) => ({
    text: '建议增加幂等用例。',
    suggestions: [{ kind: 'propose_work', goal: '增加幂等用例', projectId: context.projectId, sourceMessageId: context.sourceMessageId }],
  }))
  const messageId = await h.chat()
  const review = (await h.inspect(messageId)).value
  const candidate = selectedCandidate(review)
  assert.equal(candidate.kind, 'propose_work')
  assert.deepEqual(candidate.requiredInputs, ['work.scope', 'work.criteria', 'work.profileId'])
  const preview = (await h.prepare(messageId, candidate.index, candidate.payloadDigest)).value as Record<string, unknown>

  const missing = await h.confirm(preview, 'chain-work-missing')
  assert.equal(missing.value.status, 'rejected')
  assert.equal(h.store.product.works.listByProject(projectId).length, 0)

  const configuration = await h.product.read.configuration!()
  const project = configuration.projects.find((entry) => entry.id === projectId)!
  const recorded = await h.confirm(preview, 'chain-work-confirm', {
    work: { scope, criteria: project.defaultCriteria, profileId: 'profile-fixture-pass' },
  })
  assert.equal(recorded.value.status, 'recorded')
  assert.ok(recorded.value.workId)
  assert.equal(h.store.product.works.listByProject(projectId).length, 1)
})

test('a revision candidate targets the current contract and requires the complete revision input', async (t) => {
  const h = await fixture(t, (context) => ({
    text: '建议增加幂等用例。',
    suggestions: [{ kind: 'propose_work', goal: '增加幂等用例', projectId: context.projectId, sourceMessageId: context.sourceMessageId }],
  }))
  const workMessage = await h.chat()
  const workReview = (await h.inspect(workMessage)).value
  const workCandidate = selectedCandidate(workReview)
  const workPreview = (await h.prepare(workMessage, workCandidate.index, workCandidate.payloadDigest)).value as Record<string, unknown>
  const configuration = await h.product.read.configuration!()
  const project = configuration.projects.find((entry) => entry.id === projectId)!
  const confirmedWork = await h.confirm(workPreview, 'chain-work-for-revision', {
    work: { scope, criteria: project.defaultCriteria, profileId: 'profile-fixture-pass' },
  })
  assert.equal(confirmedWork.value.status, 'recorded')
  const workId = confirmedWork.value.workId as string
  const contract = (await h.product.application.inspect({ workId })).works[0]!.contract

  h.model.setReply((context) => ({
    text: '建议修订合同。',
    suggestions: [{
      kind: 'propose_revision',
      expected: { workId: contract.workId, revision: contract.revision, digest: contract.digest },
      rationale: '加入幂等检查',
      sourceMessageId: context.sourceMessageId,
    }],
  }))
  const revisionMessage = await h.chat()
  const revisionReview = (await h.inspect(revisionMessage)).value
  const revisionCandidate = selectedCandidate(revisionReview)
  assert.equal(revisionCandidate.kind, 'propose_revision')
  assert.deepEqual(revisionCandidate.requiredInputs, ['revision.goal', 'revision.scope', 'revision.criteria'])
  const revisionPreview = (await h.prepare(revisionMessage, revisionCandidate.index, revisionCandidate.payloadDigest)).value as Record<string, unknown>

  const missing = await h.confirm(revisionPreview, 'chain-revision-missing')
  assert.equal(missing.value.status, 'rejected')
  const recorded = await h.confirm(revisionPreview, 'chain-revision-confirm', {
    revision: { goal: '加入幂等检查与回归', scope, criteria: project.defaultCriteria },
  })
  assert.equal(recorded.value.status, 'recorded')
  const updated = (await h.product.application.inspect({ workId })).works[0]!.contract
  assert.equal(updated.revision, contract.revision + 1)
})

test('mixed valid and stale candidates are separated, and a reply-only body exposes no candidates', async (t) => {
  const h = await fixture(t, (context) => ({
    text: '一条有效，一条过期。',
    suggestions: [
      { kind: 'propose_decision', content: '保留错误码。', scope: context.scope, sourceMessageId: context.sourceMessageId },
      { kind: 'propose_revision', expected: { workId: 'missing-work', revision: 1, digest: 'a'.repeat(64) },
        rationale: '过期目标', sourceMessageId: context.sourceMessageId },
    ],
  }))
  const messageId = await h.chat()
  const review = (await h.inspect(messageId)).value
  assert.equal(review.status, 'candidates')
  assert.deepEqual((review.candidates as { index: number; kind: string }[]).map((candidate) => [candidate.index, candidate.kind]), [[0, 'propose_decision']])
  assert.deepEqual((review.rejected as { index: number; reason: string }[]).map((entry) => [entry.index, entry.reason]), [[1, 'contract_stale']])

  h.model.setReply(() => ({ text: '仅普通回复。', suggestions: [] }))
  const replyOnly = await h.chat()
  const replyReview = (await h.inspect(replyOnly)).value
  assert.equal(replyReview.status, 'none')
  assert.deepEqual(replyReview.candidates, [])
  const refused = await h.prepare(replyOnly, 0, 'a'.repeat(64))
  assert.equal(refused.status, 409)
})

test('source drift and candidate pointer drift refuse confirmation without a second business effect', async (t) => {
  const h = await fixture(t)
  const messageId = await h.chat()
  const review = (await h.inspect(messageId)).value
  const candidate = selectedCandidate(review)
  const preview = (await h.prepare(messageId, candidate.index, candidate.payloadDigest)).value as Record<string, unknown>

  // Pointer drift before confirmation is refused by the strict prepare DTO.
  const wrongIndex = await h.prepare(messageId, candidate.index + 1, candidate.payloadDigest)
  assert.equal(wrongIndex.status, 409)
  const wrongDigest = await h.prepare(messageId, candidate.index, 'f'.repeat(64))
  assert.equal(wrongDigest.status, 409)

  // A live source edit after preparation invalidates the origin check at confirmation.
  const source = h.store.product.messages.getById(messageId)!
  h.store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?')
    .run(JSON.stringify({ ...source, text: 'CHANGED-AFTER-PREPARE' }), source.id)
  const drifted = await h.confirm(preview, 'chain-drift-confirm')
  assert.notEqual(drifted.value.status, 'recorded')
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length, 0)
  assert.equal(h.model.requests.length, 1)
})

test('a second-root snapshot reads frozen history and refuses a missing completed artifact', async (t) => {
  const h = await fixture(t)
  const messageId = await h.chat()
  const review = (await h.inspect(messageId)).value
  const candidate = selectedCandidate(review)
  const preview = (await h.prepare(messageId, candidate.index, candidate.payloadDigest)).value as Record<string, unknown>
  await h.confirm(preview, 'chain-crossroot-confirm')

  // Create one selected-context send so the snapshot also contains frozen history, not only a reply.
  const contextPrepared = await h.request('/v1/assistant/context/prepare', {
    commandId: 'chain-cross-context',
    text: '请核对冻结来源。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8192 } },
  })
  assert.equal(contextPrepared.status, 200, JSON.stringify(contextPrepared.value))
  const sent = await h.request('/v1/assistant/context/send', {
    commandId: 'chain-cross-context',
    token: (contextPrepared.value as { token: string }).token,
  })
  assert.equal(sent.status, 200, JSON.stringify(sent.value))
  await h.product.execution.effects.idle('application.assistant.reply')
  const contextMessageId = key('message', 'chain-cross-context')

  const copyRoot = mkdtempSync(join(tmpdir(), 'chain-second-root-'))
  t.after(() => rmSync(copyRoot, { recursive: true, force: true }))
  // Flush WAL and copy the whole state root (database + artifacts): a second root is a real snapshot.
  h.store.db.pragma('wal_checkpoint(TRUNCATE)')
  execFileSync('cp', ['-R', h.stateRoot, join(copyRoot, 'state')])
  const second = new ProductStore({ path: join(copyRoot, 'state/state.sqlite'), artifactsRoot: join(copyRoot, 'state/artifacts') })
  t.after(() => second.close())

  // Frozen reply candidate data is readable in the second root, with no new business effect there.
  const before = second.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length
  const completed = new CompletedAssistantReplies(second, second.workflows.assistant.replyResults, principal, () => [projectId])
  const verified = completed.readVerified(key('assistant-request', messageId))!
  assert.equal(verified.body.sourceMessageId, messageId)
  assert.equal(second.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length, before)

  // A missing artifact in the snapshot is refused rather than treated as a fresh reply.
  const result = second.workflows.assistant.replyResults.forRequest(key('assistant-request', messageId))!
  rmSync(second.artifacts.filePath(result.artifactRef), { force: true })
  assert.throws(() => completed.readVerified(key('assistant-request', messageId)))

  // Frozen history is readable in the second root with its original binding and completed reply.
  const secondCompleted = new CompletedAssistantReplies(second, second.workflows.assistant.replyResults, principal, () => [projectId])
  const secondReader = (id: string) => {
    try {
      const requestId = key('assistant-request', id)
      if (secondCompleted.readVerified(requestId) === undefined) return undefined
      const stored = second.workflows.assistant.replyResults.forRequest(requestId)
      return stored === undefined ? undefined : { result: stored, verifiedBy: 'main-completed-reply' as const }
    } catch {
      return undefined
    }
  }
  const history = collectContextHistory(second.workflows.assistant.contextHistory, { projectIds: [projectId], conversationId },
    { now: () => new Date(), replyReader: secondReader })
  assert.equal(history.entries.length, 1)
  assert.equal(history.entries[0]!.messageId, contextMessageId)
  assert.equal(history.entries[0]!.state, 'current_window')
  assert.equal(history.entries[0]!.requiresExplicitReauthorization, true)
  assert.equal(history.entries[0]!.completedReply?.artifactDigest.length, 64)
  // Reading history never creates business state in the snapshot root.
  assert.equal(second.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length, before)
})

test('eight candidates with a long reply stay bounded to one reader call, and a missing artifact is refused', async (t) => {
  const longText = `长回复 ${'内容'.repeat(8000)}`
  const h = await fixture(t, (context) => ({
    text: longText,
    suggestions: Array.from({ length: 8 }, (_, index) => ({
      kind: 'propose_decision',
      content: `候选决定 ${index}`,
      scope: context.scope,
      sourceMessageId: context.sourceMessageId,
    })),
  }))
  const messageId = await h.chat()
  assert.equal(h.model.requests.length, 1)
  const review = (await h.inspect(messageId)).value
  assert.equal(review.status, 'candidates')
  assert.equal((review.candidates as unknown[]).length, 8)
  assert.deepEqual((review.candidates as { index: number }[]).map((candidate) => candidate.index), [0, 1, 2, 3, 4, 5, 6, 7])
  const candidate = selectedCandidate(review, 7)
  const preview = (await h.prepare(messageId, candidate.index, candidate.payloadDigest)).value as Record<string, unknown>
  const confirmed = await h.confirm(preview, 'chain-eight-confirm')
  assert.equal(confirmed.value.status, 'recorded')
  assert.equal(h.model.requests.length, 1)
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId, limit: 10 }).records.length, 1)

  // A snapshot whose artifact bytes are gone reports unavailable instead of exposing stale candidates.
  const missingMessage = await h.chat()
  const result = h.store.workflows.assistant.replyResults.forRequest(key('assistant-request', missingMessage))!
  rmSync(h.store.artifacts.filePath(result.artifactRef), { force: true })
  const missing = await h.inspect(missingMessage)
  assert.notEqual(missing.status, 200)
  const refused = await h.prepare(missingMessage, 0, 'a'.repeat(64))
  assert.notEqual(refused.status, 200)
  assert.equal(h.model.requests.length, 2)
})
