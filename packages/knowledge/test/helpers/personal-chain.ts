import { execFileSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import { WorkflowSnapshots } from '@personal-agent/workflows'
import { key } from '@personal-agent/orchestrator-core'
import { createControlledProduct, createProductRuntime, FIXTURE_CHECK } from '../../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../../apps/coordinator/http/app.ts'

export const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }
export const actor = { ...principal, source: 'local_cli' as const }
export const projectId = 'wave22-project'
export const conversationId = 'wave22-conversation'
export const runtimeScope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
export const reviewScope = { projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] }
const criteria = [
  { id: 'criterion-output', kind: 'machine' as const, required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
]

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 30000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`Wave22 chain condition timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 40))
  }
}

export interface PersonalChain {
  readonly model: { file: string; requests: unknown[]; close(): Promise<void> }
  readonly source: string
  readonly scratch: string
  readonly v1: { destination: string; manifest: { protocol: string; database: { integrity: string; foreignKeyViolations: number; productSchema: number }; evidence: { protocol: string; familySetVersion?: number } } }
  readonly v2: { destination: string; manifest: { protocol: string; database: { integrity: string; foreignKeyViolations: number; productSchema: number }; evidence: { protocol: string; familySetVersion?: number } } }
  readonly workId: string
  readonly question: { id: string; version: number }
  readonly sourceMessageId: string
  readonly contextMessageId: string
  readonly reviewedCandidate: { index: number; payloadDigest: string }
  readonly frozenDigest: string
  readonly bindingScope: { projectId: string; allowedPaths: readonly string[]; excludedPaths: readonly string[]; externalActions: readonly string[]; expiresAt?: string }
  readonly frozenSourceIds: readonly string[]
  readonly modelCalls: number
}

/** Real controlled Work/Broker Q&A plus real SDK candidate, confirmed proposal and frozen context. */
export async function buildPersonalChain(root: string, options: { expiresAt?: string } = {}): Promise<PersonalChain> {
  // @ts-expect-error - main-owned fixture has no type declarations.
  const module = (await import('../../../../tests/integration/fixtures/assistant-candidate-model.mjs')) as unknown as {
    candidateModel(): Promise<{ file: string; requests: unknown[]; provider: unknown; close(): Promise<void> }>
  }
  const model = await module.candidateModel()
  const source = join(root, 'source')
  const scratch = join(root, 'project')
  mkdirSync(source, { mode: 0o700 })
  mkdirSync(join(scratch, 'src'), { recursive: true })
  mkdirSync(join(source, 'receipts'), { recursive: true })
  writeFileSync(join(scratch, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: scratch, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', 'src/.gitkeep'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Wave22 fixture'])

  const original = new ProductStore({ path: join(source, 'state.sqlite'), artifactsRoot: source })
  const controlled = createControlledProduct({
    store: original, principal, projects: [{ id: projectId, scope: runtimeScope }], actionSecret: Buffer.alloc(32, 121),
    stateRoot: source, scratchProject: scratch, assistantProvider: model.provider as never,
  })
  controlled.start()
  try {
    const created = await controlled.application.dispatch({
      commandId: 'w22-work', conversationId, kind: 'create_work', projectId,
      goal: 'Produce the controlled scratch artifact', profileId: 'profile-fixture-question', scope: runtimeScope,
      criteria: [...criteria, { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' }],
    } as never, actor)
    const workId = (created as { workId: string }).workId
    const question = (await until(() => controlled.application.inspect({ workId }), (value) => value.questions.length >= 1)).questions[0]!
    await controlled.application.dispatch({
      commandId: 'w22-answer', conversationId, kind: 'answer_question',
      questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['allow'] },
    } as never, actor)
    const ready = await until(
      async () => (await controlled.application.inspect({ workId })).works[0],
      (value) => value !== undefined && value.actions.available.includes('accept_candidate'),
    )
    if (controlled.application.questions.currentDeliveries(question.id)[0]?.status !== 'native_applied') throw new Error('Delivery is not native_applied')
    await controlled.application.dispatch({ commandId: 'w22-accept', conversationId, kind: 'accept_candidate', candidate: ready!.actions.currentCandidate } as never, actor)
    await controlled.close()

    const viewerScope = options.expiresAt ? { ...reviewScope, expiresAt: options.expiresAt } : reviewScope
    const viewer = createProductRuntime({
      store: original, principal, projects: [{ id: projectId, scope: viewerScope }], actionSecret: Buffer.alloc(32, 121),
      stateRoot: source, scratchProject: scratch, assistantProvider: model.provider as never, executionUnavailable: 'operator_disabled',
    })
    viewer.start()
    try {
      await viewer.application.dispatch({ commandId: 'w22-chat', conversationId, kind: 'chat', projectId, text: '把保留错误码整理成决定建议。' }, actor)
      await viewer.execution.effects.idle('application.assistant.reply')
      const sourceMessageId = key('message', 'w22-chat')
      const preparedContext = await viewer.operations.assistantContextPrepare({
        commandId: 'w22-context', text: '按原错误码约束再核对一次。',
        context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } },
      }, actor)
      await viewer.operations.assistantContextSend({ commandId: preparedContext.commandId, token: preparedContext.token }, actor)
      await viewer.execution.effects.idle('application.assistant.reply')
      const contextMessageId = key('message', 'w22-context')
      const app = createLocalHttpApp({
        application: viewer.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
        allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', read: viewer.read, operations: viewer.operations,
      })
      const headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
      const reviewed = await (await app.request(`/v1/messages/${encodeURIComponent(sourceMessageId)}/candidates`, { headers })).json()
      const reviewedCandidate = (reviewed.candidates as { index: number; payloadDigest: string }[])[0]!
      const preview = await (await app.request('/v1/assistant/candidates/prepare', {
        method: 'POST', headers, body: JSON.stringify({ messageId: sourceMessageId, index: reviewedCandidate.index, payloadDigest: reviewedCandidate.payloadDigest }),
      })).json()
      const confirmed = await (await app.request('/v1/proposals/commands', {
        method: 'POST', headers,
        body: JSON.stringify({ kind: 'confirm_proposal', commandId: 'w22-confirm', projectId, conversationId, token: (preview as { token: string }).token }),
      })).json()
      if (confirmed.status !== 'recorded') throw new Error('Proposal confirmation was not recorded')
      const frozen = await (await app.request(`/v1/messages/${encodeURIComponent(contextMessageId)}/context`, { headers })).json()
      const bindingScope = frozen.scope as PersonalChain['bindingScope']
      const frozenSourceIds = (frozen.sources as { sourceId: string }[]).map((entry) => entry.sourceId)
      const frozenDigest = frozen.bundleDigest as string
      const modelCalls = model.requests.length
      await viewer.close()
      original.queue.enqueue('application.execute', 'held-wave22', '{}', 1, 0, new Date().toISOString())
      const snapshots = new WorkflowSnapshots(original)
      const v1 = await snapshots.create({ destination: join(root, 'snapshot-v1') })
      const v2 = await snapshots.create({ destination: join(root, 'snapshot-v2'), formatVersion: 2 })
      if (v1.status !== 'ok' || v2.status !== 'ok') throw new Error('Snapshot creation failed')
      return {
        model: { file: model.file, requests: model.requests, close: () => model.close() },
        source, scratch, v1: v1 as never, v2: v2 as never, workId, question, sourceMessageId, contextMessageId,
        reviewedCandidate, frozenDigest, bindingScope, frozenSourceIds, modelCalls,
      }
    } finally {
      await viewer.close().catch(() => undefined)
    }
  } finally {
    original.close()
  }
}

export function restoreSnapshot(snapshot: { destination: string; manifest: { database: object } }, target: string) {
  mkdirSync(target, { recursive: true, mode: 0o700 })
  copyFileSync(join(snapshot.destination, 'product.sqlite'), join(target, 'state.sqlite'))
  cpSync(join(snapshot.destination, 'artifacts'), join(target, 'artifacts'), { recursive: true })
  writeFileSync(join(target, 'restore-report.json'), JSON.stringify({ protocol: 'personal-restore/1', targetPath: target,
    database: { ...snapshot.manifest.database }, evidence: { status: 'verified' } }), { mode: 0o600 })
}
