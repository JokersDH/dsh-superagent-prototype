/**
 * Wave-09 A3: source activation commit -> main target binder -> empty target inventory. The D
 * materializer is not in this checkout; the target DB below is an explicit fixture created through
 * the product's empty-schema initialization, not a claim that D materialized it.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { JsonSchema } from '@personal-agent/contracts'
import type { RecoveryActivationIntent, RecoveryTargetConfiguration, TrustedActor } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ProductStore } from '@personal-agent/storage'
import { RecoveryIntentCommitter } from '../../../apps/coordinator/product/recovery-intents.ts'
import { bindRecoveryTargetConfiguration } from '../../../apps/coordinator/product/recovery-targets.ts'
import { createWorkflowPorts, recoveryTargetInventory, WorkflowConflict } from '../src/index.ts'

const at = '2026-11-11T00:00:00.000Z'
const actor: TrustedActor = { userId: 'user-1', authorityRef: 'authority-1', source: 'local_ui' }
const faultCode = (error: unknown): string | undefined => (error as { error?: { code?: string } } | null)?.error?.code
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

function configuration(): RecoveryTargetConfiguration {
  return {
    protocol: 'recovery-target-configuration/1',
    projects: [{ sourceProjectId: 'project-source', targetProjectId: 'project-target',
      registration: { path: '/tmp/recovered-project', check: 'node_test', displayName: 'Recovered' } }],
    executor: { profileId: 'codex', revision: 1, identityDigest: 'a'.repeat(64) },
  }
}

function intent(config: RecoveryTargetConfiguration): RecoveryActivationIntent {
  return {
    protocol: 'recovery-activation-intent/1', activationId: 'activation-1', commandId: 'recovery-command-1',
    planId: 'recovery-plan-1', planDigest: 'b'.repeat(64),
    source: { stateId: 'state-source', stateRoot: '/tmp/source-state', markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
    target: { generationId: 'generation-1', stateRoot: '/tmp/target-state',
      configurationDigest: canonicalDigest(JsonSchema.parse(config)) },
    principal: { userId: actor.userId, authorityRef: actor.authorityRef },
    machineDigest: 'e'.repeat(64), resourcePolicyDigest: 'f'.repeat(64),
    createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z',
  }
}

function sourceStore() {
  const dir = tmp('recovery-source-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  const ports = createWorkflowPorts(store)
  const config = configuration()
  const committer = new RecoveryIntentCommitter(store, ports.recoveryActivations,
    { userId: actor.userId, authorityRef: actor.authorityRef }, () => undefined, () => at)
  const commit = committer.commit(intent(config), actor)
  writeFileSync(join(dir, 'restore-report.json'), '{"protocol":"personal-restore/1"}\n')
  store.queue.enqueue('application.execute', 'old-queue', '{"legacy":true}', 1, 0, at)
  return { dir, store, ports, config, committer, commit }
}

test('main binder binds the committed source to an inert preparation; an empty target inventories cleanly', () => {
  const source = sourceStore()
  const targetRoot = tmp('recovery-target-')
  try {
    const preparation = bindRecoveryTargetConfiguration(source.commit, source.config)
    assert.equal(preparation.protocol, 'recovery-target-preparation/1')
    assert.equal(preparation.startupAvailable, false)
    assert.equal(preparation.source.sourceReceipt.commandId, 'recovery-command-1')
    assert.equal(preparation.source.intent.activationId, 'activation-1')
    assert.equal(preparation.source.intent.target.configurationDigest,
      canonicalDigest(JsonSchema.parse(source.config)))
    assert.throws(() => bindRecoveryTargetConfiguration(source.commit, {
      ...source.config,
      executor: { ...source.config.executor, identityDigest: '0'.repeat(64) },
    }), (error: unknown) => faultCode(error) === 'conflict')

    mkdirSync(targetRoot, { recursive: true, mode: 0o700 })
    const target = new ProductStore({ path: join(targetRoot, 'state.sqlite') })
    target.close()
    const beforeQueue = source.store.queue.oldestRow('application.execute')!
    const beforeMarker = readFileSync(join(source.dir, 'restore-report.json'), 'utf8')
    const inventory = recoveryTargetInventory.inspect(targetRoot)
    assert.equal(inventory.completeness, 'complete')
    assert.equal(inventory.productSchema, target.database.productSchema)
    assert.equal(inventory.issues.includes('business_rows_present'), false)
    assert.equal(inventory.startupAvailable, false)
    assert.equal(inventory.databaseDigest?.length, 64)
    assert.deepEqual(source.store.queue.oldestRow('application.execute'), beforeQueue, 'target inspection does not consume the source queue')
    assert.equal(readFileSync(join(source.dir, 'restore-report.json'), 'utf8'), beforeMarker)
    assert.deepEqual(source.ports.recoveryActivations.get('activation-1'), source.commit.intent)

    // Same source identity replays the same stable receipt and preparation digest.
    const replay = source.committer.commit(intent(source.config), actor)
    assert.equal(replay.sourceReceipt.seq, source.commit.sourceReceipt.seq)
    assert.deepEqual(bindRecoveryTargetConfiguration(replay, source.config), preparation)
  } finally {
    source.store.close()
    rmSync(source.dir, { recursive: true, force: true })
    rmSync(targetRoot, { recursive: true, force: true })
  }
})

test('partial, missing or residual targets never become a start permission', () => {
  const source = sourceStore()
  try {
    const missingRoot = tmp('recovery-target-missing-')
    try {
      const inventory = recoveryTargetInventory.inspect(missingRoot)
      assert.equal(inventory.completeness, 'unsupported')
      assert.equal(inventory.issues.includes('missing_database'), true)
      assert.equal(inventory.startupAvailable, false)
    } finally { rmSync(missingRoot, { recursive: true, force: true }) }

    const residualRoot = tmp('recovery-target-residual-')
    try {
      const target = new ProductStore({ path: join(residualRoot, 'state.sqlite') })
      target.product.works.insert({ id: 'copied-work', projectId: 'project-source', conversationId: 'conversation-1', title: 'Copied', createdAt: at })
      target.close()
      const inventory = recoveryTargetInventory.inspect(residualRoot)
      assert.equal(inventory.issues.includes('business_rows_present'), true)
      assert.equal(inventory.startupAvailable, false)
      assert.equal(inventory.tables.find(table => table.name === 'works')!.rows, 1)
    } finally { rmSync(residualRoot, { recursive: true, force: true }) }

    const partialRoot = tmp('recovery-target-partial-')
    try {
      mkdirSync(partialRoot, { recursive: true, mode: 0o700 })
      writeFileSync(join(partialRoot, 'state.sqlite'), 'partial copy')
      const inventory = recoveryTargetInventory.inspect(partialRoot)
      assert.equal(inventory.completeness, 'unsupported')
      assert.equal(inventory.integrity, 'failed')
      assert.equal(inventory.startupAvailable, false)
    } finally { rmSync(partialRoot, { recursive: true, force: true }) }
  } finally {
    source.store.close()
    rmSync(source.dir, { recursive: true, force: true })
  }
})

test('a forged target directory can never create activation facts or a start permission', () => {
  const dir = tmp('recovery-forged-target-')
  const store = new ProductStore({ path: join(dir, 'source.sqlite') })
  const targetRoot = tmp('recovery-forged-root-')
  try {
    mkdirSync(targetRoot, { recursive: true, mode: 0o700 })
    writeFileSync(join(targetRoot, 'recovery-target-material.json'),
      JSON.stringify({ protocol: 'recovery-target-material/1', activationId: 'activation-1', startupAvailable: true }))
    writeFileSync(join(targetRoot, 'restore-report.json'), '{"protocol":"personal-restore/1"}')
    const facts = createWorkflowPorts(store).recoveryActivations
    assert.equal(facts.get('activation-1'), undefined)
    assert.equal(facts.forCommand('recovery-command-1'), undefined)
    const inventory = recoveryTargetInventory.inspect(targetRoot)
    assert.equal(inventory.startupAvailable, false)
    assert.equal(inventory.completeness, 'unsupported')
    assert.equal(inventory.issues.includes('missing_database'), true)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
    rmSync(targetRoot, { recursive: true, force: true })
  }
})
