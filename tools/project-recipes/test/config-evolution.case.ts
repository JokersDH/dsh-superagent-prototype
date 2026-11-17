/**
 * Closure one: the current configuration may evolve while old work keeps its own contract.
 *
 * Two runtimes over one store represent a product restart after a declaration change (here the
 * project's display name, which is part of the public configuration projection). The delivered work
 * keeps revision 1 and its own criteria; a draft produced under the old revision is no longer
 * current; a fresh preview serves the new revision; and the old work's completion history is still
 * readable.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import { draftCurrency, matchRecipe, parseProjectRecipeDraft, previewInputs } from '../../../packages/project-recipes/src/index.ts'
import { makePnpmProject } from './project-fixtures.ts'

const PROFILE = 'profile-fixture-pass'

const until = async <T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`product did not reach ${label}`)
}

test('a changed configuration revision serves a fresh draft while the old work keeps its contract', { timeout: 180_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-recipes-config-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const path = join(root, 'pnpm-app')
  makePnpmProject(path)
  const principal = { userId: 'config-user', authorityRef: 'config-authority' }
  const actor = { ...principal, source: 'local_ui' as const }
  const registry = new NativeProjectRegistry(stateRoot)
  const record = registry.prepare({ path, displayName: '配置演进项目', check: 'node_test' })
  registry.save(record)
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const runtime = (displayName: string) =>
    createProductRuntime({
      store,
      stateRoot,
      scratchProject: path,
      projectRegistry: registry,
      projects: [{ id: record.id, displayName, scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [] as string[], externalActions: [] as string[] } }],
      principal,
      actionSecret: Buffer.alloc(32, 43),
    })

  let product = runtime('配置演进项目')
  product.start()
  t.after(async () => {
    await product.close().catch(() => undefined)
    store.close()
    rmSync(root, { recursive: true, force: true })
  })

  const firstConfig = (await product.read.configuration!())!
  const facts = {
    protocol: 'project-facts/1' as const,
    projectId: record.id,
    observedAt: new Date().toISOString(),
    provenance: { source: 'injected' as const, authority: 'none' as const, provider: 'config-evolution/1', scope: 'package' as const, inputs: [] as string[] },
    stack: { kind: 'node' as const },
    manager: { kind: 'pnpm' as const },
    locks: [{ name: 'pnpm-lock.yaml' as const }],
    workspace: { declaration: 'none' as const },
    scripts: ['test'],
    languages: ['node' as const],
    missing: [] as never[],
    omissions: [] as never[],
  }
  const preview = await product.read.projectRecipePreview!({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: PROFILE })
  assert.equal(preview.status, 'draft')
  const firstDraft = parseProjectRecipeDraft(
    matchRecipe({ facts, configuration: firstConfig, kind: 'scoped_change', selection: { paths: ['src/'], profileId: PROFILE }, now: new Date().toISOString() }),
  )
  assert.equal(firstDraft.status, 'draft')

  const created = await product.application.dispatch({ kind: 'create_work', commandId: 'config-create', conversationId: 'config-chat', ...preview.fields! }, actor)
  assert.equal(created.status, 'recorded')
  const ready = await until(
    async () => (await product.application.inspect({ workId: created.workId! })).works[0]!,
    (work) => work.actions.available.includes('accept_candidate'),
    'accept readiness',
  )
  await product.application.dispatch(
    { kind: 'accept_candidate', commandId: 'config-accept', conversationId: 'config-chat', candidate: ready.actions.currentCandidate! },
    actor,
  )
  const delivered = (await product.application.inspect({ workId: created.workId! })).works[0]!
  assert.equal(delivered.phase, 'delivered')
  const originalContract = { revision: delivered.contract.revision, digest: delivered.contract.digest }

  // Restart with a changed declaration (display name is part of the public configuration).
  await product.close()
  product = runtime('配置演进项目（已改名）')
  const secondConfig = (await product.read.configuration!())!
  assert.notEqual(secondConfig.revision, firstConfig.revision)
  assert.equal(secondConfig.projects[0]!.displayName, '配置演进项目（已改名）')

  // The old work still shows its own contract and remains delivered.
  const reopened = (await product.application.inspect({ workId: created.workId! })).works[0]!
  assert.equal(reopened.phase, 'delivered')
  assert.deepEqual({ revision: reopened.contract.revision, digest: reopened.contract.digest }, originalContract)
  assert.equal(reopened.contract.scope.projectId, record.id)

  // The old draft is no longer current under the new configuration, and re-reading produces a new one.
  const currency = draftCurrency(firstDraft, { configuration: secondConfig, facts, now: new Date().toISOString() })
  assert.equal(currency.current, false)
  assert.deepEqual(currency.reasons.map((entry) => entry.code), ['configuration_changed'])
  assert.throws(
    () => previewInputs(firstDraft, { configuration: secondConfig, facts, now: new Date().toISOString() }),
    (error: unknown) => error instanceof Error && 'staleInputs' in error && (error as { staleInputs: string[] }).staleInputs.includes('configuration'),
  )

  const fresh = await product.read.projectRecipePreview!({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: PROFILE })
  assert.equal(fresh.status, 'draft')
  assert.equal(fresh.configurationRevision, secondConfig.revision)

  // The original history still belongs to the old work and is readable through main's reader.
  const history = await product.read.workCompletionHistory!(created.workId!, { kind: 'contracts', limit: 20 })
  assert.equal(history.status, 'ok')
  assert.equal(history.projectId, record.id)
  assert.ok(history.entries.some((row) => row.kind === 'contracts' && row.revision === 1))
})
