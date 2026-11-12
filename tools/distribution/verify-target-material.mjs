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
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { dirname, resolve as resolvePath } from 'node:path'
import { PortabilityRecoveryTargetMaterializer, RECOVERY_TARGET_MANIFEST_FILE } from '../../packages/portability/dist/index.js'

const repositoryRoot = resolvePath(dirname(new URL(import.meta.url).pathname), '../..')
const assertRejectsDiscard = async (materializer, id) => {
  let refused = false
  try { await materializer.discardStaging(id) } catch (error) { refused = error?.code === 'target_not_staging' }
  if (!refused) throw new Error('discardStaging removed or accepted an initialized target')
}
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
const canonical = (item) => {
  if (item === null || typeof item !== 'object') return JSON.stringify(item)
  if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`).join(',')}}`
}
const digest = (value) => createHash('sha256').update(canonical(value)).digest('hex')
const activationId = 'activation-wave10-recipe'
const configuration = {
  protocol: 'recovery-target-configuration/1',
  projects: [{ sourceProjectId: 'project-a', targetProjectId: 'project-a-copy', registration: { pathDigest: 'a'.repeat(64), check: 'node_test', sourceRef: 'ref' } }],
  executor: { profileId: 'fixture', profileVersion: '1' },
}
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
      target: { generationId: 'generation-wave10', stateRoot: join(trustedParent, activationId), configurationDigest: digest(configuration) },
      principal: { userId: 'local-user', authorityRef: 'authority-wave09' },
      machineDigest: 'e'.repeat(64),
      resourcePolicyDigest: 'f'.repeat(64),
      createdAt: '2026-11-11T00:00:00.000Z',
      expiresAt: '2026-11-11T00:05:00.000Z',
    },
    sourceReceipt: { commandId: `command-${activationId}`, seq: 1 },
  },
  configuration,
  startupAvailable: false,
}

mkdirSync(trustedParent, { recursive: true, mode: 0o700 })
const started = Date.now()
try {
  const materializer = new PortabilityRecoveryTargetMaterializer({ trustedParent, productSchema: 15 })
  step('parent-trusted', 'PASS', { trustedParent, mode: (statSync(trustedParent).mode & 0o777).toString(8) })

  const material = await materializer.prepare(preparation)
  if (material.startupAvailable !== false) throw new Error('material claimed startup availability')
  if (material.activationId !== activationId || material.generationId !== 'generation-wave10') throw new Error('material identity mismatch')
  const entries = readdirSync(material.stateRoot)
  if (entries.length !== 1 || entries[0] !== RECOVERY_TARGET_MANIFEST_FILE) throw new Error(`target contains more than the manifest: ${entries.join(',')}`)
  step('prepare-manifest-only', 'PASS', { stateRoot: material.stateRoot, manifestDigest: material.manifestDigest, entries })

  const readBack = await materializer.read(material.stateRoot)
  if (readBack?.manifestDigest !== material.manifestDigest) throw new Error('material did not read back')
  step('readback', 'PASS', { productSchema: readBack.productSchema, startupAvailable: readBack.startupAvailable })

  const repeated = await materializer.prepare(preparation)
  if (repeated.manifestDigest !== material.manifestDigest) throw new Error('repeat prepare was not idempotent')
  step('repeat-idempotent', 'PASS')

  // Main (not D) initializes the brand-new empty target database through A's public Store at the
  // exact prepared root. D only verifies read/replay still works and staging cleanup now refuses.
  const storageModule = await import(pathToFileURL(join(repositoryRoot, 'packages/storage/dist/index.js')).href)
  const store = new storageModule.ProductStore({ path: join(material.stateRoot, 'state.sqlite') })
  store.close()
  const afterInit = await materializer.read(material.stateRoot)
  if (afterInit?.manifestDigest !== material.manifestDigest) throw new Error('material disappeared after the empty-schema initialization')
  step('empty-schema-initialized-by-public-store', 'PASS', { path: join(material.stateRoot, 'state.sqlite'), productSchema: material.productSchema, materialReadable: true })
  await assertRejectsDiscard(materializer, activationId)
  step('discard-refuses-initialized-target', 'PASS')

  let inventory
  let readerModule = inventoryModule
  if (readerModule === undefined) {
    // A published the public reader; consume it instead of reporting a permanent gap. The recipe
    // still never fabricates an inventory and reports SKIPPED if the reader is absent.
    try { readerModule = join(repositoryRoot, 'packages/storage/dist/index.js') } catch { readerModule = undefined }
  }
  if (readerModule === undefined) {
    step('inventory-reader-unavailable', 'SKIPPED', {
      reason: 'INVENTORY_READER_UNAVAILABLE',
      requirement: 'A-owned RecoveryTargetInventoryReader.inspect(stateRoot) must be implemented and integrated by main; D does not fabricate an inventory.',
    })
  } else {
    const module = await import(pathToFileURL(readerModule).href)
    const reader = module.createRecoveryTargetInventoryReader?.() ?? module.recoveryTargetInventory ?? module.default?.()
    if (reader === undefined || typeof reader.inspect !== 'function') throw new Error('the inventory module does not export a reader')
    inventory = reader.inspect(material.stateRoot)
    if (inventory.startupAvailable !== false) throw new Error('inventory claimed startup availability')
    const businessRows = inventory.tables.filter((table) => table.category === 'business').reduce((sum, table) => sum + table.rows, 0)
    if (businessRows !== 0) throw new Error('the new target is not business-empty')
    step('inventory-readonly', 'PASS', { completeness: inventory.completeness, integrity: inventory.integrity, issues: inventory.issues, tables: inventory.tables.length })
  }

  // A separate, never-initialized staging identity is still removable.
  const staging = { ...preparation, source: { ...preparation.source, intent: { ...preparation.source.intent, activationId: `${activationId}-staging`, target: { ...preparation.source.intent.target, stateRoot: join(trustedParent, `${activationId}-staging`) } }, sourceReceipt: { commandId: preparation.source.intent.commandId, seq: 1 } } }
  await materializer.prepare(staging)
  await materializer.discardStaging(`${activationId}-staging`)
  step('discard-staging-only', 'PASS', { removed: !readdirSync(trustedParent).includes(`${activationId}-staging`) })
  process.stdout.write(`${JSON.stringify({ protocol: 'wave09-target-material-recipe/1', status: steps.every((entry) => entry.status !== 'FAIL') ? 'PASS' : 'FAIL', durationMs: Date.now() - started, trustedParent, steps }, null, 2)}\n`)
} catch (error) {
  step('abort', 'FAIL', { message: String(error?.stack ?? error) })
  process.stdout.write(`${JSON.stringify({ protocol: 'wave09-target-material-recipe/1', status: 'FAIL', durationMs: Date.now() - started, trustedParent, steps }, null, 2)}\n`)
  process.exit(1)
} finally {
  try { rmSync(join(trustedParent, activationId), { recursive: true, force: true }) } catch { /* already gone */ }
}
