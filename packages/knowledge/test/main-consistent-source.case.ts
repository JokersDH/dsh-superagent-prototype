import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { AssistantDecisionStore, DecisionTransactionService } from '../src/index.ts'

const principal = { userId: 'consistent-user', authorityRef: 'consistent-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'consistent-project'
const conversationId = 'consistent-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const API = 'a'.repeat(64)
const now = '2026-11-13T03:00:00.000Z'

/** One logical read of the current source (preview manifest + digests), then an async gap, then re-read. */
test('an async gap between two current-source reads is detected and never merged into one manifest', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-consistent-source-'))
  const stateRoot = join(root, 'state')
  const projectRoot = join(root, 'project')
  mkdirSync(stateRoot)
  mkdirSync(join(projectRoot, 'src'), { recursive: true })
  writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite'), artifactsRoot: join(stateRoot, 'artifacts') })
  store.product.messages.append({
    id: 'consistent-message',
    conversationId,
    projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'CONSISTENT-SOURCE: preserve error codes.',
    sourceRefs: [],
    createdAt: now,
  })
  const decisions = new AssistantDecisionStore(store.workflows.assistant)
  const transaction = new DecisionTransactionService(decisions, {
    getMessage(id: string) {
      const value = store.workflows.index.sourceMessage(id, [projectId])
      return value && {
        messageId: value.id,
        conversationId: value.conversationId,
        projectId: value.projectId ?? projectId,
        role: value.role,
        provenance: value.provenance as 'trusted_user',
        createdAt: value.createdAt,
        textDigest: value.textDigest,
      }
    },
  }, { now: () => new Date(now) })
  const actorValue = { actorRef: actor.authorityRef, projectId, grantScope: scope }
  store.uow.atomic(() =>
    transaction.commit(
      transaction.prepare(
        { decisionId: 'consistent-decision', content: 'Keep error codes stable', scope, sourceMessageId: 'consistent-message' },
        actorValue,
      ),
      actorValue,
    ),
  )
  const product = createProductRuntime({
    store,
    stateRoot,
    scratchProject: projectRoot,
    principal,
    projects: [{ id: projectId, scope }],
    actionSecret: Buffer.alloc(32, 83),
    now: () => now,
  })
  const app = createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: API,
    bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'],
    mode: 'fixture',
    read: product.read,
    operations: product.operations,
  })
  t.after(async () => {
    await product.close()
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  const preview = async () => {
    const response = await app.request('/v1/context/preview', {
      method: 'POST',
      headers: { authorization: `Bearer ${API}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        conversationId,
        selections: ['decisions', 'conversation'],
        budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 8192 },
      }),
    })
    return { status: response.status, value: (await response.json()) as Record<string, unknown> }
  }
  const digests = (value: Record<string, unknown>) =>
    (value.sources as { sourceId: string; sourceDigest: string; previewDigest: string }[])
      .map((source) => `${source.sourceId}:${source.sourceDigest}:${source.previewDigest}`)
      .sort()

  const first = await preview()
  assert.equal(first.status, 200)
  // The read itself never leaves a SQL transaction open across the following await.
  assert.equal(store.uow.nesting, 0)
  const firstDigests = digests(first.value)
  assert.ok(firstDigests.some((entry) => entry.startsWith('decision-')))

  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(store.uow.nesting, 0)

  store.uow.atomic(() => transaction.revoke('consistent-decision', 1, actorValue))
  const second = await preview()
  assert.equal(second.status, 200)
  const secondDigests = digests(second.value)
  assert.notDeepEqual(secondDigests, firstDigests)
  assert.equal(secondDigests.some((entry) => entry.startsWith('decision-')), false)
  // The first observation is not retroactively rewritten by the second read.
  assert.ok(firstDigests.some((entry) => entry.startsWith('decision-')))
  assert.equal(store.uow.nesting, 0)

  // A changed live message with the same preview request shape is a different digest set, not a merge.
  store.product.messages.append({
    id: 'consistent-new',
    conversationId,
    projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'LATER-SOURCE: appended after the async gap.',
    sourceRefs: [],
    createdAt: '2026-11-13T03:00:01.000Z',
  })
  const third = await preview()
  assert.equal(third.status, 200)
  assert.notDeepEqual(digests(third.value), secondDigests)
})

test('a frozen reply artifact is re-read from bytes, so an async replacement cannot be merged into the old result', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-consistent-artifact-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot)
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite'), artifactsRoot: join(stateRoot, 'artifacts') })
  const artifact = store.artifacts.write(Buffer.from(JSON.stringify({ protocol: 'assistant-reply-body/1', value: 'original' })))
  store.artifacts.insert(artifact)
  t.after(() => {
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  const first = store.artifacts.read(artifact.id)!
  assert.equal(JSON.parse(first.data.toString()).value, 'original')
  assert.equal(store.uow.nesting, 0)

  await new Promise((resolve) => setTimeout(resolve, 5))
  // Replace the bytes behind the same identity: the next read must not silently reuse the old body.
  const template = JSON.stringify({ protocol: 'assistant-reply-body/1', value: 'REPLACED' })
  writeFileSync(store.artifacts.filePath(artifact.id), template)
  // The store verifies bytes against the recorded digest: a replaced artifact is refused, not merged.
  assert.throws(() => store.artifacts.read(artifact.id))
  assert.equal(store.uow.nesting, 0)
})
