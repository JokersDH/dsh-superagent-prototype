import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ApplicationFault } from '../../packages/application/dist/index.js'
import { ProductStore, PRODUCT_SCHEMA_VERSION, recoveryTargetInventory } from '../../packages/storage/dist/index.js'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'
import { RecoveryTargetMaterialSchema } from '../../packages/contracts/dist/index.js'
import { RecoveryIntentCommitter } from '../../apps/coordinator/product/recovery-intents.ts'
import { bindRecoveryTargetConfiguration } from '../../apps/coordinator/product/recovery-targets.ts'
import { ProductRecoveryTargets } from '../../apps/coordinator/product/recovery-target-service.ts'
import { initializeRecoveryTarget } from '../../apps/coordinator/product/recovery-target-initializer.ts'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
if (process.argv.length > 3) throw new Error('Usage: node tests/integration/recovery-target-d-consumer.mjs [candidate-root]')
const candidate = resolve(process.argv[2] ?? join(repository, '../superagent-agent-d'))
const output = join(repository, 'reports/releases/wave10-integration/recovery-d-consumer.json')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const digest = value => canonicalDigest(JSON.parse(JSON.stringify(value)))
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const candidateFiles = ['packages/portability/src/recovery-target.ts', 'packages/portability/src/errors.ts']
const mainFiles = ['apps/coordinator/product/recovery-target-service.ts', 'apps/coordinator/product/recovery-target-initializer.ts',
  'apps/coordinator/product/recovery-intents.ts', 'packages/storage/src/target-inventory.ts', 'packages/storage/src/migrations.ts',
  'packages/contracts/src/recovery-target.ts', 'tests/integration/recovery-target-d-consumer.mjs']
const hashes = (root, files) => Object.fromEntries(files.map(path => [path, sha(readFileSync(join(root, path)))]))
const cases = [], fixtures = []
const actor = { userId: 'consumer-user', authorityRef: 'consumer-authority', source: 'local_ui' }
const check = async (id, action) => {
  try { cases.push({ id, status: 'PASS', observation: await action() }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message }) }
}
let PortabilityRecoveryTargetMaterializer, report

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pa-actual-d-target-'))), stateRoot = join(root, 'historical'), trustedParent = join(root, 'targets')
  mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(trustedParent, { mode: 0o700 })
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), time = '2026-11-11T00:01:00.000Z'
  const activationId = 'actual-d-activation', targetRoot = join(trustedParent, activationId), marker = join(stateRoot, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'fixture-restored-source/1', stateRoot }), { mode: 0o600 })
  const configuration = { protocol: 'recovery-target-configuration/1', projects: [{ sourceProjectId: 'history-project', targetProjectId: 'fresh-project',
    registration: { path: '/tmp/fixture-project', check: 'node_test' } }], executor: { profileId: 'fixture-profile', revision: 1, identityDigest: 'a'.repeat(64) } }
  const intent = { protocol: 'recovery-activation-intent/1', activationId, commandId: 'actual-d-confirm', planId: 'actual-d-plan',
    planDigest: 'b'.repeat(64), source: { stateId: 'historical-state', stateRoot, markerDigest: sha(readFileSync(marker)), inspectionFingerprint: 'c'.repeat(64) },
    target: { generationId: 'fresh-generation', stateRoot: targetRoot, configurationDigest: digest(configuration) },
    principal: { userId: actor.userId, authorityRef: actor.authorityRef }, machineDigest: 'd'.repeat(64), resourcePolicyDigest: 'e'.repeat(64),
    createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z' }
  const validateFixtureSource = value => {
    if (realpathSync(value.source.stateRoot) !== stateRoot || realpathSync(store.db.name) !== join(stateRoot, 'state.sqlite') ||
      value.source.markerDigest !== sha(readFileSync(marker)) || value.target.stateRoot !== targetRoot ||
      value.target.configurationDigest !== digest(configuration))
      throw new ApplicationFault('conflict', 'Fixture source identity, marker or target configuration changed')
  }
  const committed = new RecoveryIntentCommitter(store, store.workflows.recoveryActivations, actor, validateFixtureSource, () => time).commit(intent, actor)
  const h = { root, stateRoot, trustedParent, targetRoot, marker, activationId, configuration, intent, committed,
    initializeCount: 0, input: { activationId, configuration }, get store() { return store },
    setTime(value) { time = value }, reopen() { store.close(); store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }) },
    sourceAudit() { return { receipt: store.commands.get(intent.commandId), fact: store.workflows.recoveryActivations.get(activationId),
      cursor: store.events.cursor(), queue: store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100),
      works: store.product.works.listByProject('history-project'), marker: readFileSync(marker, 'utf8') } },
    sourceDatabaseBytes() { return Object.fromEntries(readdirSync(stateRoot).filter(name => name === 'state.sqlite' || name === 'state.sqlite-wal')
      .map(name => [name, sha(readFileSync(join(stateRoot, name)))])) },
    close() { store.close(); rmSync(root, { recursive: true, force: true }) },
  }
  h.materializer = () => new PortabilityRecoveryTargetMaterializer({ trustedParent, productSchema: PRODUCT_SCHEMA_VERSION, now: () => new Date(time) })
  h.service = (materializer = h.materializer()) => new ProductRecoveryTargets({ store, principal: actor, stateRoot, materializer,
    inventory: recoveryTargetInventory, revalidateSource: commit => validateFixtureSource(commit.intent),
    async initialize(material) { h.initializeCount++; await initializeRecoveryTarget(material) }, now: () => time })
  fixtures.push(h)
  return h
}

try {
  const sourceCommit = git(candidate, ['rev-parse', 'HEAD']), sourceHashes = hashes(candidate, candidateFiles), testedMainSourceHashes = hashes(repository, mainFiles)
  const sourceWorktreeClean = git(candidate, ['status', '--porcelain']) === ''
  const materialModule = await import(pathToFileURL(join(candidate, candidateFiles[0])).href)
  PortabilityRecoveryTargetMaterializer = materialModule.PortabilityRecoveryTargetMaterializer
  await check('ACTUAL_D_PREPARE_MAIN_INITIALIZER_A_COMPLETE_EMPTY_INVENTORY', async () => {
    const h = fixture(), materializer = h.materializer(), before = h.sourceAudit(), bytes = h.sourceDatabaseBytes()
    const result = await h.service(materializer).prepare(h.input, actor)
    assert.equal(result.step, 'inventory_complete'); assert.equal(result.startupAvailable, false); assert.equal(result.authorization, 'not_granted')
    assert.equal(result.inventory.productSchema, PRODUCT_SCHEMA_VERSION); assert.equal(result.inventory.completeness, 'complete')
    assert.ok(result.inventory.tables.some(table => table.name === 'works' && table.rows === 0))
    assert.equal(result.inventory.tables.some(table => table.category === 'business' && table.rows > 0), false)
    assert.equal(h.initializeCount, 1)
    assert.deepEqual(RecoveryTargetMaterialSchema.parse(await materializer.read(h.targetRoot)), result.material)
    assert.deepEqual(h.sourceAudit(), before); assert.deepEqual(h.sourceDatabaseBytes(), bytes)
    return { step: result.step, productSchema: result.inventory.productSchema, tableCount: result.inventory.tables.length,
      initializedOnce: true, materialReadableAfterInitialization: true, sourceDataAndDatabaseBytesUnchanged: true,
      startupAvailable: result.startupAvailable, authorization: result.authorization }
  })
  await check('ACTUAL_MATERIAL_AND_TARGET_REPLAY_AFTER_SOURCE_REOPEN_DO_NOT_REINITIALIZE', async () => {
    const h = fixture(), materializer = h.materializer(), service = h.service(materializer), before = h.sourceAudit()
    const first = await service.prepare(h.input, actor), repeat = await service.prepare(h.input, actor)
    assert.equal(repeat.step, 'inventory_complete'); assert.deepEqual(repeat.material, first.material)
    assert.equal(repeat.inventory.databaseDigest, first.inventory.databaseDigest); assert.equal(h.initializeCount, 1)
    h.reopen()
    const audit = await h.service().read(h.activationId), reopenedRepeat = await h.service().prepare(h.input, actor)
    assert.equal(audit.step, 'inventory_complete'); assert.equal(reopenedRepeat.step, 'inventory_complete')
    assert.deepEqual(reopenedRepeat.material, first.material); assert.equal(h.initializeCount, 1)
    assert.deepEqual(h.sourceAudit(), before)
    return { repeatedStep: repeat.step, reopenedStep: reopenedRepeat.step, initializeCount: h.initializeCount, sourceHistoryUnchanged: true }
  })
  await check('ACTUAL_D_STAGING_DISCARD_REFUSES_INITIALIZED_DATABASE', async () => {
    const h = fixture(), materializer = h.materializer(), result = await h.service(materializer).prepare(h.input, actor)
    const database = sha(readFileSync(join(h.targetRoot, 'state.sqlite')))
    await assert.rejects(materializer.discardStaging(h.activationId), error => error.code === 'target_not_staging')
    assert.equal(sha(readFileSync(join(h.targetRoot, 'state.sqlite'))), database)
    assert.deepEqual(await materializer.read(h.targetRoot), result.material)
    assert.equal(recoveryTargetInventory.inspect(h.targetRoot).completeness, 'complete')
    return { refusedCode: 'target_not_staging', databaseAndMaterialPreserved: true }
  })
  await check('EXPIRED_SOURCE_REFUSES_PREPARATION_BUT_REMAINS_INERT_AUDIT', async () => {
    const h = fixture(), service = h.service(), before = h.sourceAudit()
    h.setTime('2026-11-11T00:05:00.000Z')
    await assert.rejects(service.prepare(h.input, actor), error => error.error?.code === 'stale_contract')
    assert.equal(existsSync(h.targetRoot), false); assert.equal(h.initializeCount, 0)
    const audit = await service.read(h.activationId)
    assert.equal(audit.step, 'blocked'); assert.ok(audit.blockers.some(blocker => blocker.code === 'source_expired'))
    assert.equal(audit.startupAvailable, false); assert.equal(audit.authorization, 'not_granted')
    assert.deepEqual(h.sourceAudit(), before)
    return { preparationRefusedBeforeTargetCreation: true, auditStep: audit.step, startupAvailable: false }
  })
  await check('CONFIGURATION_DRIFT_REFUSES_AT_MAIN_AND_ACTUAL_D_BEFORE_TARGET_CREATION', async () => {
    const h = fixture(), materializer = h.materializer(), input = structuredClone(h.input), before = h.sourceAudit()
    input.configuration.executor.identityDigest = '0'.repeat(64)
    await assert.rejects(h.service(materializer).prepare(input, actor), error => error.error?.code === 'conflict')
    const preparation = bindRecoveryTargetConfiguration(h.committed, h.configuration)
    preparation.configuration.executor.identityDigest = '0'.repeat(64)
    await assert.rejects(materializer.prepare(preparation), error => error.code === 'target_identity_mismatch')
    assert.equal(existsSync(h.targetRoot), false); assert.equal(h.initializeCount, 0); assert.deepEqual(h.sourceAudit(), before)
    return { mainRefusedCode: 'conflict', materializerRefusedCode: 'target_identity_mismatch', targetCreated: false }
  })
  await check('ACTUAL_A_RESIDUAL_BUSINESS_INVENTORY_BLOCKS_WITHOUT_REINITIALIZATION', async () => {
    const h = fixture(), materializer = h.materializer(), before = h.sourceAudit()
    const material = await materializer.prepare(bindRecoveryTargetConfiguration(h.committed, h.configuration))
    await initializeRecoveryTarget(material)
    const target = new ProductStore({ path: join(h.targetRoot, 'state.sqlite') })
    try { target.product.works.insert({ id: 'residual-work', projectId: 'history-project', conversationId: 'historical-conversation',
      title: 'Residual business history', createdAt: h.intent.createdAt }) } finally { target.close() }
    const bytes = sha(readFileSync(join(h.targetRoot, 'state.sqlite'))), result = await h.service(materializer).prepare(h.input, actor)
    assert.equal(result.step, 'blocked'); assert.ok(result.blockers.some(blocker => blocker.code === 'business_rows_present'))
    assert.equal(h.initializeCount, 0); assert.equal(sha(readFileSync(join(h.targetRoot, 'state.sqlite'))), bytes)
    assert.equal(result.startupAvailable, false); assert.deepEqual(h.sourceAudit(), before)
    return { step: result.step, residueObserved: true, initializeCount: 0, targetBytesPreserved: true, startupAvailable: false }
  })
  await check('CANDIDATE_AND_MAIN_TESTED_SOURCE_SNAPSHOTS_STAY_FIXED', () => {
    assert.equal(git(candidate, ['rev-parse', 'HEAD']), sourceCommit)
    assert.deepEqual(hashes(candidate, candidateFiles), sourceHashes)
    assert.deepEqual(hashes(repository, mainFiles), testedMainSourceHashes)
    return { candidateSourceUnchanged: true, mainTestedSourceUnchanged: true }
  })
  const passed = cases.every(value => value.status === 'PASS')
  report = { status: passed ? 'PASS_CROSS_SOURCE_RECOVERY_PREPARATION_CONSUMER' : 'FAIL_CROSS_SOURCE_RECOVERY_PREPARATION_CONSUMER',
    command: ['node', 'tests/integration/recovery-target-d-consumer.mjs', candidate], checkedAt: new Date().toISOString(), exitCode: passed ? 0 : 1,
    sourceRoot: candidate, sourceCommit, sourceWorktreeClean, sourceHashes,
    mainSourceCommit: git(repository, ['rev-parse', 'HEAD']), testedMainSourcesClean: git(repository, ['status', '--porcelain', '--', ...mainFiles]) === '',
    testedMainSourceHashes, productSchema: PRODUCT_SCHEMA_VERSION, cases, modelCalls: 0, nativeTurns: 0,
    limitations: [
      'Cross-source production-port composition: D TypeScript loads from its candidate checkout; it is not copied into main or a distributable artifact.',
      'Main source facts/receipts, exclusive target initialization and A readonly target inventory are actual production implementations.',
      'Current-source validation checks real temporary marker/root/configuration identity only; it does not establish real machine/profile/physical-resource or activation admission.',
      'The target path follows the D port rule trustedParent/activationId. All databases and filesystem mutations are isolated temporary resources.',
      'No launcher stop, installed artifact, model/native request, user service or target startup is exercised; startup availability remains false.',
    ] }
} catch (error) {
  report = { status: 'ERROR_CROSS_SOURCE_RECOVERY_CONSUMER', command: ['node', 'tests/integration/recovery-target-d-consumer.mjs', candidate],
    checkedAt: new Date().toISOString(), exitCode: 2, cases, error: error.message, modelCalls: 0, nativeTurns: 0 }
} finally { for (const h of fixtures) h.close() }
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2)); process.exitCode = report.exitCode
