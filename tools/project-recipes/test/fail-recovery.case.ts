/**
 * Outcome 2: repairable failures and project switching on the real product.
 *
 * A user can be told exactly what is missing or stale, fix it, and then complete the delivery. The
 * controlled fixture always satisfies the product's own completion check, so a verification-FAIL
 * oracle is not exercised here (E/main own the real oracle); everything asserted below is reachable
 * in the ordinary product path.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import { PreviewError, matchRecipe, parseProjectRecipeDraft, previewInputs } from '../../../packages/project-recipes/src/index.ts'
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

const fixture = (t: { after(fn: () => void): void }) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-recipes-fail-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const npmPath = join(root, 'npm-app')
  const pnpmPath = join(root, 'pnpm-app')
  makeNpmProject(npmPath)
  makePnpmProject(pnpmPath)
  const registry = new NativeProjectRegistry(stateRoot)
  for (const [path, displayName] of [[npmPath, 'NPM 项目'], [pnpmPath, 'PNPM 项目']] as const) {
    const record = registry.prepare({ path, displayName, check: 'node_test' })
    registry.save(record)
  }
  const records = registry.list()
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite'), artifactsRoot: join(stateRoot, 'artifacts') })
  const principal = { userId: 'fail-user', authorityRef: 'fail-authority' }
  const actor = { ...principal, source: 'local_ui' as const }
  const product = createProductRuntime({
    store,
    stateRoot,
    scratchProject: records[0]!.path,
    projectRegistry: registry,
    projects: records.map((record) => ({
      id: record.id,
      displayName: record.displayName,
      scope: { projectId: record.id, allowedPaths: ['src/', 'test/'], excludedPaths: [] as string[], externalActions: [] as string[] },
    })),
    principal,
    actionSecret: Buffer.alloc(32, 31),
  })
  product.start()
  t.after(async () => {
    await product.close().catch(() => undefined)
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { records, product, actor }
}

test('missing input is reported, then repaired, and the corrected work is delivered', { timeout: 120_000 }, async (t) => {
  const h = fixture(t)
  const record = h.records[0]!
  const previewRecipe = h.product.read.projectRecipePreview!
  const inspect = async (workId: string) => (await h.product.application.inspect({ workId })).works[0]!

  // 1. The user asks for an atom the project never declared: the product explains instead of guessing.
  const missing = await previewRecipe({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['docs/'], profileId: PROFILE })
  assert.equal(missing.status, 'needs_input')
  assert.equal(missing.fields, null)
  assert.ok(missing.issues.some((issue) => issue.code === 'scope_not_declared' || issue.code.includes('scope')))

  // 2. Repair: choose a declared atom and continue the same goal.
  const preview = await previewRecipe({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: PROFILE })
  assert.equal(preview.status, 'draft')
  const created = await h.product.application.dispatch({ kind: 'create_work', commandId: 'repair-create-1', conversationId: 'repair-chat', ...preview.fields! }, h.actor)
  assert.equal(created.status, 'recorded')

  // 3. Re-using the same command id with a different body is refused as a conflict (thrown by the
  // original Application), so a second work is never created silently.
  await assert.rejects(
    h.product.application.dispatch(
      { kind: 'create_work', commandId: 'repair-create-1', conversationId: 'repair-chat', ...preview.fields!, goal: '另一个不同的目标' },
      h.actor,
    ),
    (error: unknown) => (error as { error?: { code?: string } }).error?.code === 'conflict',
  )

  // 4. A fresh command id continues normally and the delivery completes.
  const retried = await h.product.application.dispatch({ kind: 'create_work', commandId: 'repair-create-2', conversationId: 'repair-chat-2', ...preview.fields! }, h.actor)
  assert.equal(retried.status, 'recorded')
  const ready = await until(async () => inspect(retried.workId!), (work) => work.actions.available.includes('accept_candidate'), 'accept readiness')
  assert.ok(ready.actions.currentCandidate)
  const accepted = await h.product.application.dispatch(
    { kind: 'accept_candidate', commandId: 'repair-accept-2', conversationId: 'repair-chat-2', candidate: ready.actions.currentCandidate! },
    h.actor,
  )
  assert.equal(accepted.status, 'recorded')
  assert.equal((await inspect(retried.workId!)).phase, 'delivered')
})

test('a switched project never inherits the other project draft, and both still deliver', { timeout: 120_000 }, async (t) => {
  const h = fixture(t)
  const previewRecipe = h.product.read.projectRecipePreview!
  const inspect = async (workId: string) => (await h.product.application.inspect({ workId })).works[0]!
  const [npmRecord, pnpmRecord] = [h.records[0]!, h.records[1]!]

  const npmPreview = await previewRecipe({ projectId: npmRecord.id, kind: 'regression_fix', allowedPaths: ['src/'], profileId: PROFILE })
  const pnpmPreview = await previewRecipe({ projectId: pnpmRecord.id, kind: 'regression_fix', allowedPaths: ['src/'], profileId: PROFILE })
  assert.equal(npmPreview.status, 'draft')
  assert.equal(pnpmPreview.status, 'draft')
  assert.notEqual(npmPreview.fields!.projectId, pnpmPreview.fields!.projectId)

  // Switching back and forth keeps each suggestion scoped to its own project.
  const again = await previewRecipe({ projectId: npmRecord.id, kind: 'regression_fix', allowedPaths: ['src/'], profileId: PROFILE })
  assert.deepEqual(again.fields, npmPreview.fields)

  for (const [index, preview] of [npmPreview, pnpmPreview].entries()) {
    const created = await h.product.application.dispatch(
      { kind: 'create_work', commandId: `switch-create-${index}`, conversationId: `switch-chat-${index}`, ...preview.fields! },
      h.actor,
    )
    assert.equal(created.status, 'recorded')
    const ready = await until(async () => inspect(created.workId!), (work) => work.actions.available.includes('accept_candidate'), `switch readiness ${index}`)
    assert.equal(ready.contract.scope.projectId, preview.fields!.projectId)
    const accepted = await h.product.application.dispatch(
      { kind: 'accept_candidate', commandId: `switch-accept-${index}`, conversationId: `switch-chat-${index}`, candidate: ready.actions.currentCandidate! },
      h.actor,
    )
    assert.equal(accepted.status, 'recorded')
    assert.equal((await inspect(created.workId!)).phase, 'delivered')
  }
})

test('an applied draft becomes stale when the configuration revision changes, then re-reads cleanly', () => {
  const facts = {
    protocol: 'project-facts/1',
    projectId: 'project-alpha',
    observedAt: '2026-11-14T11:55:00.000Z',
    provenance: { source: 'injected', authority: 'none', provider: 'fail-recovery/1', scope: 'package', inputs: [] },
    stack: { kind: 'node' },
    manager: { kind: 'pnpm' },
    locks: [{ name: 'pnpm-lock.yaml' }],
    workspace: { declaration: 'none' },
    scripts: ['test'],
    languages: ['node'],
    missing: [],
    omissions: [],
  } as const
  const criteria = [{ id: 'tests', description: 'Tests pass.', kind: 'machine' as const, required: true as const, checkDefinitionRef: 'check-node-test' }]
  const base = {
    protocol: 'application-configuration/1' as const,
    revision: 'c'.repeat(64),
    executionAvailability: { state: 'available' as const, kind: 'native' as const },
    projects: [{ id: 'project-alpha', displayName: 'Alpha', scope: { projectId: 'project-alpha', allowedPaths: ['src/'], excludedPaths: [] as string[], externalActions: [] as string[] }, profileIds: ['profile-native'], defaultProfileId: 'profile-native', defaultCriteria: criteria, dispatchAllowed: true }],
    profiles: [{ id: 'profile-native', revision: 1, displayName: 'Native', driverId: 'codex', kind: 'native' as const, readiness: 'native_test_passed' as const, dispatchAllowed: true }],
    checks: [{ id: 'check-node-test', revision: 1, displayName: 'node --test' }],
  }
  const draft = parseProjectRecipeDraft(matchRecipe({ facts, configuration: base, kind: 'regression_fix', selection: { paths: ['src/'] }, now: '2026-11-14T12:00:00.000Z' }))
  assert.equal(draft.status, 'draft')
  assert.doesNotThrow(() => previewInputs(draft, { configuration: base, facts, now: '2026-11-14T12:10:00.000Z' }))

  const changed = { ...base, revision: 'd'.repeat(64) }
  assert.throws(
    () => previewInputs(draft, { configuration: changed, facts, now: '2026-11-14T12:10:00.000Z' }),
    (error: unknown) => error instanceof PreviewError && error.staleInputs.includes('configuration'),
  )
  // Re-read against the changed configuration produces a fresh, applicable draft for the same project.
  const refreshed = parseProjectRecipeDraft(matchRecipe({ facts, configuration: changed, kind: 'regression_fix', selection: { paths: ['src/'] }, now: '2026-11-14T12:10:00.000Z' }))
  assert.equal(refreshed.status, 'draft')
  assert.doesNotThrow(() => previewInputs(refreshed, { configuration: changed, facts, now: '2026-11-14T12:10:00.000Z' }))
  assert.notEqual(refreshed.revision, draft.revision)
})
