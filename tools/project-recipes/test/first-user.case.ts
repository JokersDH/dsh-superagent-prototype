/**
 * The first-user flow on the real product composition.
 *
 * A colleague imports an ordinary Node project — plain (`ensureStarterProject`), npm or pnpm single
 * package — through main's `NativeProjectRegistry`, then asks the real coordinator consumer for the
 * three template kinds and creates the work through the original `ProductApplication`.
 *
 * Nothing here writes to the product beyond registering the projects in a temporary private state
 * root and dispatching controlled commands; no install, no script execution, no model/native call.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import { makeNpmProject, makePnpmProject, makePlainProject } from './project-fixtures.ts'
import {
  createProjectFactsObserver,
  rebindRegisteredProject,
  type ProjectFacts,
} from '../../../packages/project-recipes/src/index.ts'

const KINDS = ['regression_fix', 'scoped_change', 'verification_followup'] as const
const PROFILE = 'profile-fixture-pass'

const paths = (root: string) => ({ plain: join(root, 'plain'), npm: join(root, 'npm-app'), pnpm: join(root, 'pnpm-app') })

const fixture = (t: { after(fn: () => void): void }) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-recipes-first-user-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const registry = new NativeProjectRegistry(stateRoot)
  const projectPaths = paths(root)
  makePlainProject(projectPaths.plain)
  makeNpmProject(projectPaths.npm)
  makePnpmProject(projectPaths.pnpm)
  const records = (Object.keys(projectPaths) as (keyof typeof projectPaths)[]).map((key) => {
    const record = registry.prepare({ path: projectPaths[key], displayName: `项目 ${key}`, check: 'node_test' })
    registry.save(record)
    return record
  })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const principal = { userId: 'first-user', authorityRef: 'first-user-authority' }
  const actor = { ...principal, source: 'local_ui' as const }
  const product = createProductRuntime({
    store,
    stateRoot,
    scratchProject: projectPaths.plain,
    projectRegistry: registry,
    projects: records.map((record) => ({
      id: record.id,
      displayName: record.displayName,
      scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [] as string[], externalActions: [] as string[] },
    })),
    principal,
    actionSecret: Buffer.alloc(32, 23),
  })
  t.after(async () => {
    await product.close()
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, paths: projectPaths, records, registry, product, actor }
}

test('three ordinary project shapes get a draft for every kind and create the original work', async (t) => {
  const h = fixture(t)
  const previewRecipe = h.product.read.projectRecipePreview!
  assert.equal(h.records.length, 3)

  const observed: Record<string, ProjectFacts> = {}
  for (const record of h.records) {
    observed[record.id] = createProjectFactsObserver({ rootFor: (id) => (id === record.id ? record.path : undefined) })
      .observe({ projectId: record.id, observedAt: new Date().toISOString() }).facts
  }
  const managers = Object.values(observed).map((facts) => facts.manager.kind).sort()
  assert.deepEqual(managers, ['none', 'npm', 'pnpm'], 'plain, npm and pnpm projects are all observed as such')

  let created = 0
  for (const record of h.records) {
    for (const kind of KINDS) {
      const preview = await previewRecipe({
        projectId: record.id,
        kind,
        allowedPaths: ['src/'],
        profileId: PROFILE,
      })
      assert.equal(preview.status, 'draft', `${record.displayName}:${kind} ${JSON.stringify(preview.issues)}`)
      assert.ok(preview.fields)
      assert.equal(preview.fields.projectId, record.id, 'the fields belong to the imported project, never another one')
      assert.equal(preview.fields.profileId, PROFILE)
      assert.deepEqual(preview.fields.scope.allowedPaths, ['src/'])
      assert.ok(preview.fields.criteria.some((criterion) => criterion.kind === 'machine' && criterion.required))
      assert.equal(preview.authorization, 'none')
    }
    const preview = await previewRecipe({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: PROFILE })
    assert.ok(preview.fields)
    const receipt = await h.product.application.dispatch(
      {
        kind: 'create_work',
        commandId: `first-user-${record.id}`,
        conversationId: `first-user-chat-${record.id}`,
        ...preview.fields,
      },
      h.actor,
    )
    assert.equal(receipt.status, 'recorded', `${record.displayName}: ${JSON.stringify(receipt)}`)
    created += 1
  }
  assert.equal(created, 3)
})

test('a scope atom the project never declared is needs_input, and a missing project never borrows another', async (t) => {
  const h = fixture(t)
  const previewRecipe = h.product.read.projectRecipePreview!
  const undeclared = await previewRecipe({
    projectId: h.records[0]!.id,
    kind: 'scoped_change',
    allowedPaths: ['test/'],
    profileId: PROFILE,
  })
  assert.equal(undeclared.status, 'needs_input')
  assert.equal(undeclared.fields, null)
  assert.ok(undeclared.issues.length > 0)

  await assert.rejects(
    previewRecipe({ projectId: 'project-not-imported', kind: 'scoped_change', allowedPaths: ['src/'], profileId: PROFILE }),
    (error: unknown) => (error as { error?: { code?: string } }).error?.code === 'forbidden',
  )
})

test('a migrated project is re-read through the registry mapping and never reuses the old suggestion', async (t) => {
  const h = fixture(t)
  const previewRecipe = h.product.read.projectRecipePreview!
  const source = h.records[2]! // pnpm project
  const previous = createProjectFactsObserver({ rootFor: () => source.path })
    .observe({ projectId: source.id, observedAt: new Date().toISOString() }).facts

  // main may point the same project id at a new root after an operator re-bind.
  const sameIdentity = rebindRegisteredProject({
    previous,
    observedAt: new Date().toISOString(),
    roots: { rootFor: (id) => (id === source.id ? h.paths.npm : undefined) },
  })
  assert.equal(sameIdentity.report.status, 'changed')
  assert.ok(sameIdentity.report.changes.includes('manager'))
  assert.equal(sameIdentity.report.authorization, 'none')

  // A moved project re-registered under a new id is reidentified: the diff is shown, reuse is refused.
  // records were prepared in order: plain, npm, pnpm
  const movedRecord = h.records[1]!
  const reidentified = rebindRegisteredProject({
    previous,
    projectId: movedRecord.id,
    observedAt: new Date().toISOString(),
    roots: { rootFor: (id) => (id === movedRecord.id ? movedRecord.path : undefined) },
  })
  assert.equal(reidentified.report.status, 'reidentified')
  assert.equal(reidentified.report.previousProjectId, source.id)
  assert.ok(reidentified.facts)
  // The new identity still gets its own current suggestion through the same product consumer.
  const preview = await previewRecipe({
    projectId: movedRecord.id,
    kind: 'regression_fix',
    allowedPaths: ['src/'],
    profileId: PROFILE,
  })
  assert.equal(preview.status, 'draft')
  assert.equal(preview.fields?.projectId, movedRecord.id)
})
