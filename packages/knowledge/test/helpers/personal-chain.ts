import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
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
  readonly ticketId: string
  readonly assignmentId: string
  readonly attemptId: string
  readonly fenceEpoch: number
  readonly contract: { workId: string; revision: number; digest: string }
  readonly deliveryTargetId: string
  readonly answerId: string
  readonly dispatchWindows: { written: { commandId: string; target: string }; unknown: { commandId: string; target: string } }
  readonly sourceMessageId: string
  readonly contextMessageId: string
  readonly reviewedCandidate: { index: number; payloadDigest: string }
  readonly contextToken: string
  readonly confirmToken: string
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
    const target = question.targets[0] as { id: string; ticketId: string; assignmentId: string; fenceEpoch: number; contract: PersonalChain['contract'] }
    await controlled.application.dispatch({
      commandId: 'w22-answer', conversationId, kind: 'answer_question',
      questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['allow'] },
    } as never, actor)
    const ready = await until(
      async () => (await controlled.application.inspect({ workId })).works[0],
      (value) => value !== undefined && value.actions.available.includes('accept_candidate'),
    )
    if (controlled.application.questions.currentDeliveries(question.id)[0]?.status !== 'native_applied') throw new Error('Delivery is not native_applied')
    const attemptId = original.bindings.current<{ attemptId: string }>(target.ticketId)!.attemptId
    original.dispatch.beginSend('w24-written', 'w24-target')
    original.dispatch.markWritten('w24-written', 'w24-target')
    original.dispatch.beginSend('w24-unknown', 'w24-target')
    original.dispatch.markIndeterminate('w24-unknown', 'w24-target', 'transport unknown')
    const answerId = (original.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(question.id) as { answer_id: string }).answer_id
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
      const confirmToken = (preview as { token: string }).token
      const confirmed = await (await app.request('/v1/proposals/commands', {
        method: 'POST', headers,
        body: JSON.stringify({ kind: 'confirm_proposal', commandId: 'w22-confirm', projectId, conversationId, token: confirmToken }),
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
        source, scratch, v1: v1 as never, v2: v2 as never, workId, question, ticketId: target.ticketId,
        assignmentId: target.assignmentId, attemptId, fenceEpoch: target.fenceEpoch, contract: target.contract,
        deliveryTargetId: target.id, answerId,
        dispatchWindows: { written: { commandId: 'w24-written', target: 'w24-target' }, unknown: { commandId: 'w24-unknown', target: 'w24-target' } },
        sourceMessageId, contextMessageId,
        reviewedCandidate, contextToken: preparedContext.token, confirmToken, frozenDigest, bindingScope, frozenSourceIds, modelCalls,
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


/**
 * Restore a workflow snapshot with A's official restore path. Independent expectations are derived
 * before the restore: snapshot digest, source content digest and the manifest artifact inventory.
 */
export async function restoreSnapshotWithA(aWorktree: string, snapshotDirectory: string, target: string, sourceRoot: string) {
  const restoreModule = await import(pathToFileURL(`${aWorktree}/packages/workflows/src/restore.ts`).href)
  const storageModule = await import(pathToFileURL(`${aWorktree}/packages/storage/dist/index.js`).href)
  const manifestPath = join(snapshotDirectory, 'snapshot.json')
  const manifest = JSON.parse((await import('node:fs')).readFileSync(manifestPath, 'utf8'))
  const snapshotDigest = createHash('sha256').update((await import('node:fs')).readFileSync(manifestPath)).digest('hex')
  const content = storageModule.readWorkflowContent(join(sourceRoot, 'state.sqlite'))
  if (content.complete !== true || typeof content.digest !== 'string') throw new Error('source content proof is incomplete')
  const artifacts = manifest.artifacts.map(({ id, digest, bytes }: { id: string; digest: string; bytes: number }) => ({ id, digest, bytes }))
  const result = await restoreModule.restoreWorkflowSnapshot({ snapshotDirectory, targetStateDir: target, sourceStateRoot: sourceRoot,
    expected: { protocol: manifest.protocol, snapshotDigest, contentDigest: content.digest, artifacts } })
  if (result.status !== 'ok') throw new Error(`A restore failed: ${result.message ?? JSON.stringify(result)}`)
  return { protocol: manifest.protocol as 'workflow-snapshot/1' | 'workflow-snapshot/2', snapshotDigest,
    contentDigest: content.digest as string, artifacts, report: result.report, reportPath: result.reportPath }
}
