/**
 * Outcome 2: two independent original projects complete the *original delivery* flow.
 *
 * Preview -> apply fields -> explicit create_work -> the fixture attempt produces an artifact ->
 * the original check/candidate becomes actionable -> explicit manual accept -> delivered, and the
 * work, candidate and every artifact byte are readable again after a reopen. A stale accept and a
 * cross-project candidate are rejected only after the same work legally reached accept readiness.
 *
 * Controlled fixture protocol only: no real vendor/model/native turn, and the fixture check is the
 * product's own configured check, not a substitute for the original product chain.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import type { CandidateRef } from '../../../packages/contracts/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import { makeNpmProject, makePnpmProject } from './project-fixtures.ts'

const PROFILE = 'profile-fixture-pass'

const until = async <T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`original product did not reach ${label}`)
}

test('two original projects reach delivered work with readable artifacts and honest stale refusals', { timeout: 180_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-recipes-delivery-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const npmPath = join(root, 'npm-app')
  const pnpmPath = join(root, 'pnpm-app')
  makeNpmProject(npmPath)
  makePnpmProject(pnpmPath)

  const principal = { userId: 'delivery-user', authorityRef: 'delivery-authority' }
  const actor = { ...principal, source: 'local_ui' as const }
  const openStore = () => new ProductStore({ path: join(stateRoot, 'state.sqlite'), artifactsRoot: join(stateRoot, 'artifacts') })

  let store = openStore()
  let registry = new NativeProjectRegistry(stateRoot)
  for (const [path, displayName] of [[npmPath, '项目 NPM'], [pnpmPath, '项目 PNPM']] as const) {
    const record = registry.prepare({ path, displayName, check: 'node_test' })
    registry.save(record)
  }
  const records = registry.list()
  assert.equal(records.length, 2)

  const runtimeFor = (currentRegistry: NativeProjectRegistry, currentStore: ProductStore) =>
    createProductRuntime({
      store: currentStore,
      stateRoot,
      scratchProject: records[0]!.path,
      projectRegistry: currentRegistry,
      projects: records.map((record) => ({
        id: record.id,
        displayName: record.displayName,
        scope: { projectId: record.id, allowedPaths: ['src/', 'test/'], excludedPaths: [] as string[], externalActions: [] as string[] },
      })),
      principal,
      actionSecret: Buffer.alloc(32, 29),
    })

  let product = runtimeFor(registry, store)
  product.start()
  t.after(async () => {
    await product.close().catch(() => undefined)
    store.close()
    rmSync(root, { recursive: true, force: true })
  })

  const previewRecipe = product.read.projectRecipePreview!
  const inspect = async (workId: string) => (await product.application.inspect({ workId })).works[0]!
  const created: { projectId: string; workId: string; conversationId: string }[] = []

  for (const [index, record] of records.entries()) {
    const preview = await previewRecipe({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: PROFILE })
    assert.equal(preview.status, 'draft', `${record.displayName}: ${JSON.stringify(preview.issues)}`)
    assert.ok(preview.fields)
    const conversationId = `delivery-chat-${index}`
    const commandId = `delivery-create-${index}`
    let receipt = await product.application.dispatch({ kind: 'create_work', commandId, conversationId, ...preview.fields }, actor)
    assert.equal(receipt.status, 'recorded', JSON.stringify(receipt))
    assert.ok(receipt.workId)
    created.push({ projectId: record.id, workId: receipt.workId, conversationId })
  }

  // Before the candidate is ready the product does not offer accept; the early attempt is refused
  // for that reason (it is not reported as a stale success).
  const early = await inspect(created[0]!.workId)
  if (!early.actions.available.includes('accept_candidate')) {
    const earlyCandidate = {
      ticketId: 'ticket-early',
      assignmentId: 'assignment-early',
      contract: { workId: early.contract.workId, revision: early.contract.revision, digest: early.contract.digest },
      candidateGeneration: 1,
    }
    const refused = await product.application.dispatch(
      { kind: 'accept_candidate', commandId: 'delivery-accept-early', conversationId: created[0]!.conversationId, candidate: earlyCandidate },
      actor,
    )
    assert.equal(refused.status, 'rejected')
  }

  const readyWorks: { projectId: string; workId: string; conversationId: string; candidate: CandidateRef }[] = []
  for (const work of created) {
    const ready = await until(
      async () => inspect(work.workId),
      (value) => value.actions.available.includes('accept_candidate') && value.actions.currentCandidate !== undefined,
      `${work.projectId} accept readiness`,
    )
    assert.notEqual(ready.phase, 'delivered')
    assert.equal(ready.contract.scope.projectId, work.projectId, 'the work belongs to the original project')
    const candidate = ready.actions.currentCandidate
    assert.ok(candidate)
    readyWorks.push({ ...work, candidate })
  }

  for (const [index, entry] of readyWorks.entries()) {
    // A candidate from the other project is not accepted on this work.
    const foreign = readyWorks[(index + 1) % readyWorks.length]!.candidate
    const crossed = await product.application.dispatch(
      { kind: 'accept_candidate', commandId: `delivery-accept-crossed-${index}`, conversationId: entry.conversationId, candidate: foreign },
      actor,
    )
    assert.equal(crossed.status, 'rejected', 'another project candidate cannot be accepted here')

    const accepted = await product.application.dispatch(
      { kind: 'accept_candidate', commandId: `delivery-accept-${index}`, conversationId: entry.conversationId, candidate: entry.candidate },
      actor,
    )
    assert.equal(accepted.status, 'recorded', JSON.stringify(accepted))
    const delivered = await inspect(entry.workId)
    assert.equal(delivered.phase, 'delivered')
    assert.ok(delivered.artifactIds.length > 0, 'a delivered work exposes its artifacts')

    // Replaying the accept of the same candidate is a real stale refusal after a legal positive.
    const replay = await product.application.dispatch(
      { kind: 'accept_candidate', commandId: `delivery-accept-replay-${index}`, conversationId: entry.conversationId, candidate: entry.candidate },
      actor,
    )
    assert.equal(replay.status, 'rejected', 'the same candidate is no longer acceptable')

    for (const artifactId of delivered.artifactIds) {
      const artifact = store.artifacts.read(artifactId)
      assert.ok(artifact, `artifact ${artifactId} is readable`)
      assert.ok(artifact!.data.byteLength > 0)
    }
  }

  // A second delegation on the same runtime: revise the same original Work and deliver revision 2.
  const revisedWork = created[0]!
  const currentContract = (await inspect(revisedWork.workId)).contract
  const revised = await product.application.dispatch(
    {
      kind: 'revise_work',
      commandId: 'delivery-revise-1',
      conversationId: revisedWork.conversationId,
      expected: { workId: currentContract.workId, revision: currentContract.revision, digest: currentContract.digest },
      goal: '修订后的目标：完成同一项目的后续变更',
      scope: currentContract.scope,
      criteria: currentContract.criteria,
    },
    actor,
  )
  assert.equal(revised.status, 'recorded', JSON.stringify(revised))
  const revReady = await until(
    async () => (await product.application.inspect({ workId: revised.workId! })).works[0]!,
    (work) => work.actions.available.includes('accept_candidate'),
    'revision 2 readiness',
  )
  assert.equal(revReady.contract.revision, 2)
  assert.ok(revReady.actions.currentCandidate)
  const revAccepted = await product.application.dispatch(
    { kind: 'accept_candidate', commandId: 'delivery-revise-accept', conversationId: revisedWork.conversationId, candidate: revReady.actions.currentCandidate! },
    actor,
  )
  assert.equal(revAccepted.status, 'recorded')
  assert.equal((await inspect(revised.workId!)).contract.revision, 2)
  assert.equal((await inspect(revised.workId!)).phase, 'delivered')

  // The original completion history (A facts via main's scoped reader) is readable for the revised
  // work: two contract revisions, its verification rows and the human criterion acceptance.
  const history = product.read.workCompletionHistory!
  const contracts = await history(revised.workId!, { kind: 'contracts', limit: 1 })
  assert.equal(contracts.status, 'ok')
  assert.equal(contracts.kind, 'contracts')
  assert.ok(contracts.available >= 2)
  assert.equal(contracts.returned, 1)
  assert.equal(contracts.hasMore, true)
  assert.ok(contracts.nextCursor)
  // The cursor binds kind/limit/current contract, so a continuation repeats the same limit.
  const nextPage = await history(revised.workId!, { kind: 'contracts', limit: 1, cursor: contracts.nextCursor! })
  assert.equal(nextPage.status, 'ok')
  assert.deepEqual(
    [...contracts.entries, ...nextPage.entries].map((row) => (row.kind === 'contracts' ? row.revision : -1)).sort((a, b) => a - b),
    [1, 2],
  )
  await assert.rejects(
    history(revised.workId!, { kind: 'contracts', limit: 1, cursor: `${contracts.nextCursor!.slice(0, -2)}xy` }),
    (error: unknown) => (error as { error?: { code?: string } }).error?.code === 'conflict',
  )
  const verifications = await history(revised.workId!, { kind: 'verifications', limit: 20 })
  assert.equal(verifications.status, 'ok')
  assert.ok(verifications.entries.length >= 1)
  assert.ok(verifications.entries.every((row) => row.kind === 'verifications'))
  const acceptances = await history(revised.workId!, { kind: 'acceptances', limit: 20 })
  assert.equal(acceptances.status, 'ok')
  assert.ok(acceptances.entries.every((row) => row.kind === 'acceptances'))

  // Reopen the same state: the delivered works, candidates and artifact bytes are still verifiable.
  await product.close()
  store.close()
  store = openStore()
  registry = new NativeProjectRegistry(stateRoot)
  product = runtimeFor(registry, store)
  for (const entry of created) {
    const reopened = (await product.application.inspect({ workId: entry.workId })).works[0]!
    assert.equal(reopened.phase, 'delivered')
    assert.equal(reopened.contract.scope.projectId, entry.projectId)
    assert.ok(reopened.contract.revision >= 1)
    const reopenedHistory = await product.read.workCompletionHistory!(entry.workId, { kind: 'contracts', limit: 20 })
    assert.equal(reopenedHistory.status, 'ok')
    assert.equal(reopenedHistory.projectId, entry.projectId)
    for (const artifactId of reopened.artifactIds) {
      const artifact = store.artifacts.read(artifactId)
      assert.ok(artifact, `artifact ${artifactId} survives reopen`)
      assert.equal(typeof artifact!.record.digest, 'string')
    }
  }
})

