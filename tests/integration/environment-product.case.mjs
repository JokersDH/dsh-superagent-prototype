import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { test } from 'node:test'
import { existsSync, lstatSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { WorkspaceManager } from '../../packages/workspaces/dist/index.js'
import { CheckRegistry, VerificationRunner } from '../../packages/verification/dist/index.js'
import { ProductEnvironments } from '../../apps/coordinator/product/environments.ts'
import { EnvironmentPlanSchema, readEnvironmentOutcome } from '../../apps/runner/src/environment-preparation.ts'
import { RunnerLink } from '../../apps/runner/src/runner-link-client.ts'
import { endpointDirectory } from '../../apps/runner/src/recovery-endpoint.ts'
import { connectRunnerRecovery, verifiedRunnerInspection } from '../../apps/coordinator/runner-link.ts'
import { makeAttemptSpec } from '../../packages/testing/src/index.ts'
import { makePnpmFixture, copies } from '../../packages/environment-preparation/test/helpers.ts'

const entry = fileURLToPath(new URL('../../apps/runner/test/fixtures/preparation-worker.ts', import.meta.url))
async function until(read, predicate) {
  const deadline = Date.now() + 12000
  for (;;) {
    const result = await read()
    if (predicate(result)) return result
    if (Date.now() > deadline) throw new Error('Environment product integration timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
async function fixture(t, policy = 'offline_install') {
  const recipe = makePnpmFixture(), source = copies(recipe), state = join(recipe.root, 'state')
  const store = new ProductStore({ path: join(state, 'state.sqlite') })
  const environments = new ProductEnvironments(store, state)
  const workspaces = new WorkspaceManager(join(recipe.root, 'product-workspaces'), { environment: environments })
  const spec = makeAttemptSpec(), attempt = { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
  const workspace = workspaces.reserve({ projectPath: source.project, assignment: attempt })
  const before = readFileSync(join(source.project, '.git/index'))
  const planRef = environments.plan(attempt, source.project, workspace.path, { policy, storeDir: recipe.store, managerCommand: execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim() })
  const plan = EnvironmentPlanSchema.parse((await store.payloads.read(planRef)).value)
  const recovery = join(recipe.root, 'recovery'), directory = endpointDirectory(recovery, spec.attemptId)
  let grants = 0
  const link = new RunnerLink({ executable: process.execPath, entry, args: ['environment'], stateRoot: join(state, 'runner'),
    env: { PA_PREPARATION_WORKSPACE: workspace.path, PA_PREPARATION_RECOVERY: recovery, PA_PREPARATION_PLAN: planRef },
    payloads: { read: async reference => {
      assert.equal(reference, planRef)
      assert.equal(environments.status(attempt).status, 'preparing')
      assert.ok(store.events.after(0).some(event => event.topic === 'application.environment.preparing'))
      grants++
      return (await store.payloads.read(reference)).value
    } },
  })
  const child = await link.spawnAttempt(spec, async fact => ({ factId: fact.factId, persisted: true, seq: 1 }))
  t.after(async () => { await child.close(); store.close(); rmSync(recipe.root, { recursive: true, force: true }) })
  return { recipe, store, environments, workspaces, workspace: workspace.path, project: source.project, attempt, plan, planRef, child, before, directory, grants: () => grants }
}
test('an independent Runner prepares real offline dependencies; signed proof, patch and verification survive reconstruction', { timeout: 30000 }, async t => {
  const h = await fixture(t)
  await until(() => existsSync(join(h.workspace, 'native-started')), Boolean)
  assert.equal(h.grants(), 1)
  const outcome = readEnvironmentOutcome(h.plan)
  assert.equal(outcome.status, 'ready')
  h.environments.capture(h.attempt)
  assert.equal(h.environments.status(h.attempt).status, 'ready')
  const frozen = h.workspaces.freeze(h.attempt)
  assert.equal(frozen.environment.exclusionPolicy, 'workspace-environment/1')
  assert.doesNotMatch(readFileSync(frozen.patchPath, 'utf8'), /node_modules|product-environment|authorityRoot|COREPACK/)
  const reconstructed = new ProductEnvironments(h.store, join(h.recipe.root, 'state'))
  const second = new WorkspaceManager(join(h.recipe.root, 'product-workspaces'), { environment: reconstructed })
  assert.equal(second.digest(h.attempt), frozen.artifactDigest)
  const registry = new CheckRegistry()
  registry.register({ id: 'actual-offline-check', revision: 1, executable: process.execPath, argv: ['--test'], deadlineMs: 3000, outputLimitBytes: 4096 })
  const values = h.environments.checkEnvironment(h.attempt)
  const verification = await new VerificationRunner(registry).run({
    candidate: { ticketId: h.attempt.ticketId, assignmentId: h.attempt.assignmentId, contract: h.attempt.contract, candidateGeneration: 1 },
    criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Actual offline dependency test', checkDefinitionRef: 'actual-offline-check' }],
    artifactDigest: frozen.artifactDigest, workspacePath: h.workspace, environmentRef: values.reference, environment: values.values,
    verifyArtifact: () => second.digest(h.attempt) === frozen.artifactDigest,
  })
  assert.equal(verification.verification.results[0].outcome, 'PASS')
  assert.deepEqual(readFileSync(join(h.project, '.git/index')), h.before)
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: h.project, encoding: 'utf8' }), '')
  const clone = join(h.recipe.root, 'clone')
  execFileSync('git', ['clone', '-q', h.project, clone], { stdio: 'pipe' })
  execFileSync('git', ['apply', frozen.patchPath], { cwd: clone, stdio: 'pipe' })
  assert.equal(readFileSync(join(clone, 'native-started'), 'utf8'), 'yes')
  writeFileSync(join(h.workspace, 'node_modules/env-dep/index.js'), 'module.exports=()=>"changed"\n')
  assert.equal(h.environments.status(h.attempt).status, 'blocked')
  assert.throws(() => second.digest(h.attempt))
  assert.throws(() => h.environments.checkEnvironment(h.attempt))
})
test('missing dependencies with existing-only policy never launch native work or produce a trusted ready receipt', { timeout: 30000 }, async t => {
  const h = await fixture(t, 'existing_only')
  await until(() => existsSync(join(h.plan.authorityRoot, 'outcome.json')), Boolean)
  const outcome = readEnvironmentOutcome(h.plan)
  assert.equal(outcome.status, 'blocked')
  assert.equal(h.environments.status(h.attempt).status, 'blocked')
  assert.equal(existsSync(join(h.workspace, 'native-started')), false)
  assert.throws(() => h.environments.capture(h.attempt))
  assert.throws(() => h.workspaces.freeze(h.attempt))
})
test('prepared receipt cannot be captured for another attempt, authority or workspace', { timeout: 30000 }, async t => {
  const h = await fixture(t)
  await until(() => existsSync(join(h.workspace, 'native-started')), Boolean)
  const path = join(h.plan.authorityRoot, 'outcome.json'), original = JSON.parse(readFileSync(path, 'utf8'))
  for (const outcome of [
    { ...original, planRef: 'payload:' + 'f'.repeat(64) },
    { ...original, ref: { ...original.ref, authorityRoot: h.project } },
    { ...original, attempt: { ...original.attempt, fenceEpoch: 99 } },
  ]) {
    writeFileSync(path, JSON.stringify(outcome))
    assert.throws(() => h.environments.capture(h.attempt))
  }
  writeFileSync(path, JSON.stringify(original))
  h.environments.capture(h.attempt)
  assert.equal(h.environments.status(h.attempt).status, 'ready')
  rmSync(join(h.plan.authorityRoot, 'receipts', original.ref.receiptId + '.json'))
  assert.equal(h.environments.status(h.attempt).status, 'blocked')
  assert.throws(() => h.workspaces.digest(h.attempt))
})
