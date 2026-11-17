/**
 * Outcome 5: after a non-empty restore, a moved project is re-registered and the old history stays
 * readable under its original identity.
 *
 * The simulation uses one real ProductStore: deliver a work for project A, close everything, reopen
 * the same non-empty state (the "restored" data), then register a moved copy of the tree as project
 * B. The old work keeps A's identity and its artifact bytes; the new project gets fresh suggestions;
 * an old draft can never be applied to B.
 *
 * True backup/restore belongs to A/D; this proves only that the J-owned data path does not confuse
 * the two identities and does not reuse the old result as new permission.
 */
import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import {
  PreviewError,
  createProjectFactsObserver,
  matchRecipe,
  parseProjectRecipeDraft,
  previewInputs,
  rebindRegisteredProject,
} from '../../../packages/project-recipes/src/index.ts'
import { makePnpmProject } from './project-fixtures.ts'

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

test('a restored non-empty state keeps the old identity while a moved project is registered anew', { timeout: 180_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-recipes-restore-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const originalPath = join(root, 'pnpm-app')
  makePnpmProject(originalPath)
  const principal = { userId: 'restore-user', authorityRef: 'restore-authority' }
  const actor = { ...principal, source: 'local_ui' as const }
  const openStore = () => new ProductStore({ path: join(stateRoot, 'state.sqlite'), artifactsRoot: join(stateRoot, 'artifacts') })

  let store = openStore()
  let registry = new NativeProjectRegistry(stateRoot)
  const originalRecord = registry.prepare({ path: originalPath, displayName: 'PNPM 原项目', check: 'node_test' })
  registry.save(originalRecord)

  const runtimeFor = (currentRegistry: NativeProjectRegistry, currentStore: ProductStore) =>
    createProductRuntime({
      store: currentStore,
      stateRoot,
      scratchProject: originalPath,
      projectRegistry: currentRegistry,
      projects: currentRegistry.list().map((record) => ({
        id: record.id,
        displayName: record.displayName,
        scope: { projectId: record.id, allowedPaths: ['src/', 'test/'], excludedPaths: [] as string[], externalActions: [] as string[] },
      })),
      principal,
      actionSecret: Buffer.alloc(32, 37),
    })

  let product = runtimeFor(registry, store)
  product.start()
  t.after(async () => {
    await product.close().catch(() => undefined)
    store.close()
    rmSync(root, { recursive: true, force: true })
  })

  // 1. Deliver one work for the original project and record its identity and artifacts.
  const preview = await product.read.projectRecipePreview!({ projectId: originalRecord.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: PROFILE })
  assert.equal(preview.status, 'draft')
  const created = await product.application.dispatch({ kind: 'create_work', commandId: 'restore-create', conversationId: 'restore-chat', ...preview.fields! }, actor)
  assert.equal(created.status, 'recorded')
  const ready = await until(
    async () => (await product.application.inspect({ workId: created.workId! })).works[0]!,
    (work) => work.actions.available.includes('accept_candidate'),
    'accept readiness',
  )
  const accepted = await product.application.dispatch(
    { kind: 'accept_candidate', commandId: 'restore-accept', conversationId: 'restore-chat', candidate: ready.actions.currentCandidate! },
    actor,
  )
  assert.equal(accepted.status, 'recorded')
  const delivered = (await product.application.inspect({ workId: created.workId! })).works[0]!
  assert.equal(delivered.phase, 'delivered')
  const artifactIds = [...delivered.artifactIds]
  const bytesBefore = artifactIds.map((id) => Buffer.from(store.artifacts!.read(id)!.data))
  assert.ok(bytesBefore.every((bytes) => bytes.byteLength > 0))

  // 2. The old draft is captured before the restore, so it can be tested against the new project.
  const previousFacts = createProjectFactsObserver({ rootFor: () => originalPath })
    .observe({ projectId: originalRecord.id, observedAt: new Date().toISOString() }).facts
  const configurationAtRestore = (await product.read.configuration!())
  const previousDraft = parseProjectRecipeDraft(
    matchRecipe({
      facts: previousFacts,
      configuration: configurationAtRestore,
      kind: 'scoped_change',
      selection: { paths: ['src/'], profileId: PROFILE },
      now: new Date().toISOString(),
    }),
  )
  assert.equal(previousDraft.status, 'draft')

  // 3. Close everything (the operator stops the product) and move the tree to a new root.
  await product.close()
  store.close()
  const movedPath = join(root, 'pnpm-app-moved')
  cpSync(originalPath, movedPath, { recursive: true })

  // 4. Reopen the same non-empty state; the old work is still there under its original identity.
  store = openStore()
  registry = new NativeProjectRegistry(stateRoot)
  assert.equal(registry.list().length, 1, 'the registration survives the reopen')
  const movedRecord = registry.prepare({ path: movedPath, displayName: 'PNPM 迁移项目', check: 'node_test' })
  registry.save(movedRecord)
  assert.notEqual(movedRecord.id, originalRecord.id, 'a moved root gets a new project identity')

  product = runtimeFor(registry, store)
  const reopened = (await product.application.inspect({ workId: created.workId! })).works[0]!
  assert.equal(reopened.phase, 'delivered')
  assert.equal(reopened.contract.scope.projectId, originalRecord.id)
  assert.deepEqual([...reopened.artifactIds], artifactIds)
  for (const [index, id] of artifactIds.entries()) {
    const artifact = store.artifacts!.read(id)
    assert.ok(artifact, 'original artifact still readable after restore')
    assert.deepEqual(Buffer.from(artifact!.data), bytesBefore[index], 'original bytes are unchanged')
  }

  // The restored original history stays readable under the original identity through main's reader.
  const restoredHistory = await product.read.workCompletionHistory!(created.workId!, { kind: 'contracts', limit: 20 })
  assert.equal(restoredHistory.status, 'ok')
  assert.equal(restoredHistory.workId, created.workId)
  assert.equal(restoredHistory.projectId, originalRecord.id)
  assert.ok(restoredHistory.entries.length >= 1)
  assert.ok(restoredHistory.entries.every((row) => row.kind === 'contracts'))

  // 5. The new project gets its own fresh suggestion; the old draft never applies to it.
  const fresh = await product.read.projectRecipePreview!({ projectId: movedRecord.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: PROFILE })
  assert.equal(fresh.status, 'draft')
  assert.equal(fresh.fields!.projectId, movedRecord.id)
  const movedFacts = createProjectFactsObserver({ rootFor: () => movedPath })
    .observe({ projectId: movedRecord.id, observedAt: new Date().toISOString() }).facts
  const configurationAfterRestore = (await product.read.configuration!())
  assert.throws(
    () => previewInputs(previousDraft, { configuration: configurationAfterRestore, facts: movedFacts }),
    (error: unknown) => error instanceof PreviewError && error.staleInputs.includes('facts'),
  )

  // 6. The identity change is reported, and the old result is not reused as new permission.
  const rebind = rebindRegisteredProject({
    previous: previousFacts,
    projectId: movedRecord.id,
    observedAt: new Date().toISOString(),
    roots: { rootFor: (id) => (id === movedRecord.id ? movedPath : undefined) },
  })
  assert.equal(rebind.report.status, 'reidentified')
  assert.equal(rebind.report.previousProjectId, originalRecord.id)
  assert.equal(rebind.report.authorization, 'none')
})
