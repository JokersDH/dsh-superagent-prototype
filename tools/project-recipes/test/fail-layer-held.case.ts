/**
 * Outcome J2 evidence: why a real machine-FAIL loop is HELD in the controlled fixture.
 *
 * In fixture mode the coordinator derives completion criteria from its own fixture check, and the
 * project's registered check (and the settings/authorize path that would run it) only exists when a
 * native project configuration is supplied. So a failing project test suite does not fail the work
 * here — asserting that honestly prevents anyone from mistaking fixture delivery for real
 * verification. The real FAIL → repair → same-Work re-check needs main/H's verifier with an admitted
 * native configuration, which is outside this wave's budget.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'

const until = async <T>(read: () => Promise<T>, predicate: (value: T) => boolean, label: string): Promise<T> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`original product did not reach ${label}`)
}

test('fixture mode completes with its own check, so a failing project suite is not a product FAIL', { timeout: 120_000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-recipes-fail-held-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const path = join(root, 'failing-project')
  mkdirSync(join(path, 'src'), { recursive: true })
  mkdirSync(join(path, 'test'), { recursive: true })
  writeFileSync(join(path, 'package.json'), JSON.stringify({ name: 'failing', type: 'module', scripts: { test: 'node --test' } }))
  writeFileSync(join(path, 'src/index.mjs'), 'export const x = 1\n')
  writeFileSync(join(path, 'test/bad.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';test('fails',()=>assert.equal(1,2))\n")
  const git = (args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd: path, stdio: 'ignore' })
  git(['init', '-q'])
  git(['add', '.'])
  git(['commit', '-q', '-m', 'failing suite'])

  const registry = new NativeProjectRegistry(stateRoot)
  const record = registry.prepare({ path, displayName: '测试失败项目', check: 'node_test' })
  registry.save(record)
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const principal = { userId: 'held-user', authorityRef: 'held-authority' }
  const actor = { ...principal, source: 'local_ui' as const }
  const product = createProductRuntime({
    store,
    stateRoot,
    scratchProject: path,
    projectRegistry: registry,
    projects: [{ id: record.id, displayName: record.displayName, scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [] as string[], externalActions: [] as string[] } }],
    principal,
    actionSecret: Buffer.alloc(32, 41),
  })
  product.start()
  t.after(async () => {
    await product.close().catch(() => undefined)
    store.close()
    rmSync(root, { recursive: true, force: true })
  })

  const configuration = (await product.read.configuration!())!
  // Fixture mode exposes only its own check; the project's registered check is not part of the
  // public configuration and its settings/authorize path is only created with a native config.
  assert.deepEqual(configuration.checks.map((check) => check.id), ['check-fixture-output'])
  const criteria = configuration.projects[0]!.defaultCriteria
  const machine = criteria.filter((criterion) => criterion.kind === 'machine' && criterion.required)
  assert.deepEqual(machine.map((criterion) => (criterion.kind === 'machine' ? criterion.checkDefinitionRef : '')), ['check-fixture-output'])

  const preview = await product.read.projectRecipePreview!({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' })
  assert.equal(preview.status, 'draft')
  assert.deepEqual(preview.fields!.criteria.filter((criterion) => criterion.kind === 'machine').map((criterion) => (criterion.kind === 'machine' ? criterion.checkDefinitionRef : '')), ['check-fixture-output'])

  const created = await product.application.dispatch({ kind: 'create_work', commandId: 'held-create', conversationId: 'held-chat', ...preview.fields! }, actor)
  assert.equal(created.status, 'recorded')
  const ready = await until(
    async () => (await product.application.inspect({ workId: created.workId! })).works[0]!,
    (work) => work.actions.available.includes('accept_candidate'),
    'fixture readiness',
  )
  // The completion contract names the fixture check, not the failing project suite.
  assert.deepEqual(ready.contract.criteria.filter((criterion) => criterion.kind === 'machine').map((criterion) => (criterion.kind === 'machine' ? criterion.checkDefinitionRef : '')), ['check-fixture-output'])
  const accepted = await product.application.dispatch(
    { kind: 'accept_candidate', commandId: 'held-accept', conversationId: 'held-chat', candidate: ready.actions.currentCandidate! },
    actor,
  )
  assert.equal(accepted.status, 'recorded')
  assert.equal((await product.application.inspect({ workId: created.workId! })).works[0]!.phase, 'delivered')
})
