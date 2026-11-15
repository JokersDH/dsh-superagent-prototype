import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { buildPersonalChain, projectId, restoreSnapshotWithA } from './helpers/personal-chain.ts'
import { createControlledProduct } from '../../../apps/coordinator/product/runtime.ts'

test('original completion facts are read from existing ProductCompletion records, not a candidate table', { timeout: 120000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave28-completion-'))
  const chain = await buildPersonalChain(root)
  t.after(async () => { await chain.model.close(); rmSync(root, { recursive: true, force: true }) })
  const facts = chain.completionFacts
  assert.ok(facts.candidate)
  assert.equal(typeof facts.verificationId, 'string')
  assert.equal(typeof facts.readyAt, 'string')
  assert.equal(typeof facts.eventCursor, 'number')
  assert.equal(typeof facts.artifactDigest, 'string')
  assert.ok(facts.acceptanceRef === null || typeof facts.acceptanceRef === 'string')

  const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'
  const restored = join(root, 'restored-completion')
  await restoreSnapshotWithA(aWorktree, chain.v1.destination, restored, chain.source)
  const store = new ProductStore({ path: join(restored, 'state.sqlite') })
  const product = createControlledProduct({
    store, principal: { userId: 'local-demo-user', authorityRef: 'local-demo-authority' },
    projects: [{ id: projectId, scope: { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } }],
    actionSecret: Buffer.alloc(32, 151), stateRoot: restored, scratchProject: chain.scratch,
    startupMode: 'recovery_readonly', assistantProvider: chain.model.provider as never,
    recoveryExecutor: () => ({ id: 'read-only-completion-executor', revision: 1, driverId: 'fixture-driver',
      driverApiMajor: 1 as const, driverRelease: 'fixture-release', executable: process.execPath, argv: [],
      expectedVersion: process.version, nativeConfigRef: 'fixture-config', permissionPolicyRevision: 'fixture-policy', requiredFeatures: [] }),
  })
  t.after(async () => { await product.close(); store.close() })
  const restoredMetadata = product.completion.metadata(facts.candidate as never)
  assert.equal(restoredMetadata?.verificationId, facts.verificationId)
  assert.equal(restoredMetadata?.readyAt, facts.readyAt)
  assert.equal(restoredMetadata?.eventCursor, facts.eventCursor)
  const review = product.completion.current(facts.candidate as never)
  assert.ok(review)
  assert.equal(review.verification.id, facts.verificationId)
  assert.equal(review.proposal.artifactDigest, facts.artifactDigest)
  const restoredWork = (await product.application.inspect({ workId: chain.workId })).works[0]
  assert.equal(restoredWork?.phase, 'delivered')
  // A plain data reader never calls the model.
  assert.equal(chain.model.requests.length, chain.modelCalls)
})
