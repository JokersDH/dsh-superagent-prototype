#!/usr/bin/env node
/**
 * D3/D4 recipe: private recovery-target materialization, readback and staging cleanup.
 *
 * It runs the D-owned materializer only. It never starts a target and never claims activation:
 * `startupAvailable` is false in every material. If a shared inventory reader implementation is
 * passed with `--inventory-module`, the prepared target is inspected readonly; if it is not
 * available (A's reader is not integrated in this checkout), the result records
 * INVENTORY_READER_UNAVAILABLE with the exact handoff requirements instead of pretending emptiness.
 *
 * usage: verify-target-material.mjs --trusted-parent <private-dir> [--inventory-module <file.mjs>] [--json]
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PortabilityRecoveryTargetMaterializer, RECOVERY_TARGET_MANIFEST_FILE } from '../../packages/portability/dist/index.js'

const args = process.argv.slice(2)
const value = (name) => { const index = args.indexOf(name); return index === -1 ? undefined : args[index + 1] }
const trustedParent = value('--trusted-parent')
const inventoryModule = value('--inventory-module')
if (trustedParent === undefined) {
  process.stderr.write('usage: verify-target-material.mjs --trusted-parent <private-dir> [--inventory-module <file.mjs>] [--json]\n')
  process.exit(2)
}
const steps = []
const step = (id, status, detail = {}) => { steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const activationId = 'activation-wave09-recipe'
const preparation = {
  protocol: 'recovery-target-preparation/1',
  source: {
    protocol: 'recovery-activation-commit/1',
    intent: {
      protocol: 'recovery-activation-intent/1',
      activationId,
      commandId: `command-${activationId}`,
      planId: 'plan-wave09',
      planDigest: 'a'.repeat(64),
      source: { stateId: 'historical-state', stateRoot: join(tmpdir(), 'pa-recovery-source-reference'), markerDigest: 'b'.repeat(64), inspectionFingerprint: 'c'.repeat(64) },
      target: { generationId: 'generation-wave09', stateRoot: join(trustedParent, activationId), configurationDigest: 'd'.repeat(64) },
      principal: { userId: 'local-user', authorityRef: 'authority-wave09' },
      machineDigest: 'e'.repeat(64),
      resourcePolicyDigest: 'f'.repeat(64),
      createdAt: '2026-11-11T00:00:00.000Z',
      expiresAt: '2026-11-11T00:05:00.000Z',
    },
    sourceReceipt: { commandId: `command-${activationId}`, seq: 1 },
  },
  configuration: {
    protocol: 'recovery-target-configuration/1',
    projects: [{ sourceProjectId: 'project-a', targetProjectId: 'project-a-copy', registration: { pathDigest: 'a'.repeat(64), check: 'node_test', sourceRef: 'ref' } }],
    executor: { profileId: 'fixture', profileVersion: '1' },
  },
  startupAvailable: false,
}

mkdirSync(trustedParent, { recursive: true, mode: 0o700 })
const started = Date.now()
try {
  const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent, productSchema: 15 })
  step('parent-trusted', 'PASS', { trustedParent, mode: (statSync(trustedParent).mode & 0o777).toString(8) })

  const material = await materializer.prepare(preparation)
  if (material.startupAvailable !== false) throw new Error('material claimed startup availability')
  if (material.activationId !== activationId || material.generationId !== 'generation-wave09') throw new Error('material identity mismatch')
  const entries = readdirSync(material.stateRoot)
  if (entries.length !== 1 || entries[0] !== RECOVERY_TARGET_MANIFEST_FILE) throw new Error(`target contains more than the manifest: ${entries.join(',')}`)
  step('prepare-manifest-only', 'PASS', { stateRoot: material.stateRoot, manifestDigest: material.manifestDigest, entries })

  const readBack = await materializer.read(material.stateRoot)
  if (readBack?.manifestDigest !== material.manifestDigest) throw new Error('material did not read back')
  step('readback', 'PASS', { productSchema: readBack.productSchema, startupAvailable: readBack.startupAvailable })

  const repeated = await materializer.prepare(preparation)
  if (repeated.manifestDigest !== material.manifestDigest) throw new Error('repeat prepare was not idempotent')
  step('repeat-idempotent', 'PASS')

  let inventory
  if (inventoryModule === undefined) {
    step('inventory-reader-unavailable', 'SKIPPED', {
      reason: 'INVENTORY_READER_UNAVAILABLE',
      requirement: 'A-owned RecoveryTargetInventoryReader.inspect(stateRoot) must be implemented and integrated by main; D does not fabricate an inventory.',
    })
  } else {
    const module = await import(pathToFileURL(inventoryModule).href)
    const reader = module.createRecoveryTargetInventoryReader?.() ?? module.default?.()
    if (reader === undefined || typeof reader.inspect !== 'function') throw new Error('the inventory module does not export a reader')
    inventory = reader.inspect(material.stateRoot)
    if (inventory.startupAvailable !== false) throw new Error('inventory claimed startup availability')
    const businessRows = inventory.tables.filter((table) => table.category === 'business').reduce((sum, table) => sum + table.rows, 0)
    if (businessRows !== 0) throw new Error('the new target is not business-empty')
    step('inventory-readonly', 'PASS', { completeness: inventory.completeness, integrity: inventory.integrity, issues: inventory.issues, tables: inventory.tables.length })
  }

  await materializer.discardStaging(activationId)
  step('discard-staging', 'PASS', { removed: !readdirSync(trustedParent).includes(activationId) })
  process.stdout.write(`${JSON.stringify({ protocol: 'wave09-target-material-recipe/1', status: steps.every((entry) => entry.status !== 'FAIL') ? 'PASS' : 'FAIL', durationMs: Date.now() - started, trustedParent, steps }, null, 2)}\n`)
} catch (error) {
  step('abort', 'FAIL', { message: String(error?.stack ?? error) })
  process.stdout.write(`${JSON.stringify({ protocol: 'wave09-target-material-recipe/1', status: 'FAIL', durationMs: Date.now() - started, trustedParent, steps }, null, 2)}\n`)
  process.exit(1)
} finally {
  try { rmSync(join(trustedParent, activationId), { recursive: true, force: true }) } catch { /* already gone */ }
}
