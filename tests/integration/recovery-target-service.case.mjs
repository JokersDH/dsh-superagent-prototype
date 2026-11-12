import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore, PRODUCT_SCHEMA_VERSION } from '../../packages/storage/dist/index.js'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'
import { ApplicationFault } from '../../packages/application/src/errors.ts'
import { RecoveryIntentCommitter } from '../../apps/coordinator/product/recovery-intents.ts'
import { ProductRecoveryTargets } from '../../apps/coordinator/product/recovery-target-service.ts'

const require = createRequire(new URL('../../packages/storage/package.json', import.meta.url))
const Database = require('better-sqlite3')
const actor = { userId: 'recovery-user', authorityRef: 'recovery-authority', source: 'local_ui' }
const digest = value => canonicalDigest(JSON.parse(JSON.stringify(value)))
const fault = code => error => error?.error?.code === code
const metadata = new Set(['schema_meta', 'coordinator_instances', 'writer_claim', 'artifacts', 'ingress_payloads',
  'event_log', 'command_receipts', 'fact_receipts', 'conversation_search', 'conversation_search_data', 'conversation_search_idx',
  'conversation_search_content', 'conversation_search_docsize', 'conversation_search_config'])

function fixture(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'pa-target-consumer-')), stateRoot = join(root, 'source'), targetRoot = join(root, 'targets', 'generation-one')
  mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(join(root, 'targets'), { mode: 0o700 }); mkdirSync(join(root, 'foreign'), { mode: 0o700 })
  writeFileSync(join(stateRoot, 'restore-report.json'), JSON.stringify({ restored: true }), { mode: 0o600 })
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), time = '2026-11-11T00:01:00.000Z'
  const configuration = { protocol: 'recovery-target-configuration/1', projects: [{ sourceProjectId: 'old-project', targetProjectId: 'new-project',
    registration: { path: '/tmp/project', check: 'node_test' } }], executor: { profileId: 'codex', revision: 1, identityDigest: 'a'.repeat(64) } }
  const intent = { protocol: 'recovery-activation-intent/1', activationId: 'activation-one', commandId: 'recovery-confirm', planId: 'recovery-plan',
    planDigest: 'b'.repeat(64), source: { stateId: 'old-state', stateRoot, markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
    target: { generationId: 'generation-one', stateRoot: targetRoot, configurationDigest: digest(configuration) },
    principal: { userId: actor.userId, authorityRef: actor.authorityRef }, machineDigest: 'e'.repeat(64), resourcePolicyDigest: 'f'.repeat(64),
    createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z' }
  if (options.intent) options.intent(intent, { root, stateRoot, targetRoot })
  if (options.unconfirmed) store.workflows.recoveryActivations.put(intent)
  else new RecoveryIntentCommitter(store, store.workflows.recoveryActivations, actor, () => {}, () => time).commit(intent, actor)
  const counts = { prepare: 0, read: 0, initialize: 0, inventory: 0, revalidate: 0 }
  const h = { root, stateRoot, targetRoot, configuration, intent, counts,
    get store() { return store }, setTime(value) { time = value },
    reopen() { store.close(); store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }) },
    corruptReceipt() { store.db.prepare('UPDATE command_receipts SET payload_digest = ? WHERE command_id = ?').run('0'.repeat(64), intent.commandId) },
    input: { activationId: intent.activationId, configuration },
  }
  const materializer = {
    async prepare(input) {
      counts.prepare++; assert.equal(store.uow.nesting, 0)
      mkdirSync(input.source.intent.target.stateRoot, { recursive: true, mode: 0o700 })
      const material = { protocol: 'recovery-target-material/1', activationId: intent.activationId, generationId: intent.target.generationId,
        stateRoot: intent.target.stateRoot, intentDigest: digest(input.source.intent), configurationDigest: digest(input.configuration),
        manifestDigest: digest(input), productSchema: PRODUCT_SCHEMA_VERSION, preparedAt: intent.createdAt, startupAvailable: false }
      const path = join(material.stateRoot, 'material.json')
      if (existsSync(path)) assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), material)
      else writeFileSync(path, JSON.stringify(material), { mode: 0o600 })
      await h.afterPrepare?.(material)
      return h.prepareTransform ? h.prepareTransform(structuredClone(material)) : structuredClone(material)
    },
    async read(root) {
      counts.read++; assert.equal(store.uow.nesting, 0)
      const path = join(root, 'material.json'), material = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined
      await h.afterRead?.(material)
      return h.readTransform ? h.readTransform(structuredClone(material)) : structuredClone(material)
    },
    async discardStaging() { throw new Error('The consumer must never discard material or state') },
  }
  // Controlled test ports inspect real private SQLite; they do not certify A/D target admission.
  const inventory = { inspect(root) {
    counts.inventory++; assert.equal(store.uow.nesting, 0)
    const path = join(root, 'state.sqlite')
    let result = { protocol: 'recovery-target-inventory/1', stateRoot: root, observedAt: time, productSchema: null,
      databaseDigest: null, integrity: 'unknown', completeness: 'unsupported', tables: [], issues: ['missing_database'], startupAvailable: false }
    if (existsSync(path)) {
      const db = new Database(path, { readonly: true, fileMustExist: true })
      try {
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
          .map(({ name }) => ({ name, category: metadata.has(name) ? 'metadata' : 'business',
            rows: db.prepare(`SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).get().n }))
        result = { ...result, productSchema: Number(JSON.parse(db.prepare("SELECT value FROM schema_meta WHERE key='product_schema'").get().value)),
          databaseDigest: createHash('sha256').update(readFileSync(path)).digest('hex'), integrity: 'ok', completeness: 'complete', tables,
          issues: tables.some(table => table.category === 'business' && table.rows > 0) ? ['business_rows_present'] : [] }
      } finally { db.close() }
    }
    return h.inventoryTransform ? h.inventoryTransform(structuredClone(result)) : result
  } }
  h.makeService = (overrides = {}) => new ProductRecoveryTargets({ store, principal: actor, stateRoot,
    materializer, inventory, revalidateSource(commit) {
      counts.revalidate++; assert.equal(store.uow.nesting, 0); assert.equal(commit.intent.activationId, intent.activationId)
      if (h.sourceRefused) throw new ApplicationFault('conflict', 'Current source marker, host or resource state changed')
    }, async initialize(material) {
      counts.initialize++; assert.equal(store.uow.nesting, 0)
      await h.beforeInitialize?.(material)
      if (h.initializationError === 'before') throw new Error('Controlled initialization failure')
      const target = new ProductStore({ path: join(material.stateRoot, 'state.sqlite') }); target.close()
      await h.afterInitialize?.(material)
      if (h.initializationError === 'after') throw new Error('Controlled lost initialization result')
    }, now: () => time, ...overrides })
  h.snapshot = () => ({ changes: store.db.prepare('SELECT total_changes() AS n').get().n, cursor: store.events.cursor(),
    marker: readFileSync(join(stateRoot, 'restore-report.json'), 'utf8'),
    facts: store.workflows.recoveryActivations.get(intent.activationId), receipt: store.commands.get(intent.commandId),
    queue: store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100) })
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  return h
}

test('production source/receipt and a real new empty Store prepare without source changes or startup authority', async t => {
  const h = fixture(t), service = h.makeService(), before = h.snapshot()
  const result = await service.prepare(h.input, actor)
  assert.equal(result.step, 'inventory_complete'); assert.equal(result.authorization, 'not_granted'); assert.equal(result.startupAvailable, false)
  assert.equal(result.material.activationId, h.intent.activationId); assert.equal(result.inventory.productSchema, PRODUCT_SCHEMA_VERSION)
  assert.ok(result.inventory.tables.some(table => table.name === 'works' && table.rows === 0))
  assert.equal(result.blockers.length, 1); assert.equal(result.blockers[0].code, 'authorization_not_implemented')
  assert.deepEqual(h.snapshot(), before); assert.equal(h.counts.initialize, 1)
  assert.deepEqual(await service.prepare(h.input, actor), result)
  assert.equal(h.counts.initialize, 1)
  h.reopen()
  const after = await h.makeService().read(h.intent.activationId)
  assert.deepEqual(after, result); assert.equal(h.counts.initialize, 1)
  assert.equal(h.store.domain.tickets.list().length, 0)
})

test('actor, unconfirmed fact, source-root and configuration refusals happen before filesystem ports', async t => {
  for (const kind of ['actor', 'unconfirmed', 'source_root', 'configuration', 'expired', 'missing']) await t.test(kind, async t => {
    const h = fixture(t, { unconfirmed: kind === 'unconfirmed', ...(kind === 'source_root' ? {
      intent(value, { root }) { value.source.stateRoot = join(root, 'foreign') },
    } : {}) }), service = h.makeService()
    if (kind === 'expired') h.setTime('2026-11-11T00:05:00.000Z')
    const input = structuredClone(h.input)
    if (kind === 'configuration') input.configuration.executor.identityDigest = '0'.repeat(64)
    if (kind === 'missing') input.activationId = 'missing'
    const expected = { actor: 'forbidden', unconfirmed: 'storage_unavailable', source_root: 'forbidden',
      configuration: 'conflict', expired: 'stale_contract', missing: 'invalid_request' }[kind]
    await assert.rejects(service.prepare(input, kind === 'actor' ? { ...actor, userId: 'foreign' } : actor), fault(expected))
    assert.deepEqual({ prepare: h.counts.prepare, read: h.counts.read, initialize: h.counts.initialize, inventory: h.counts.inventory },
      { prepare: 0, read: 0, initialize: 0, inventory: 0 })
  })
})

test('source/receipt drift, fresh validation failure and expiry after every awaited preparation phase refuse', async t => {
  for (const phase of ['prepare', 'readback', 'initialize']) for (const change of ['receipt', 'expiry', 'validation'])
    await t.test(`${phase}:${change}`, async t => {
      const h = fixture(t), service = h.makeService()
      let changed = false
      const mutate = () => {
        if (changed) return
        changed = true
        if (change === 'receipt') h.corruptReceipt()
        if (change === 'expiry') h.setTime('2026-11-11T00:05:00.000Z')
        if (change === 'validation') h.sourceRefused = true
      }
      if (phase === 'prepare') h.afterPrepare = mutate
      if (phase === 'readback') h.afterRead = mutate
      if (phase === 'initialize') h.afterInitialize = mutate
      await assert.rejects(service.prepare(h.input, actor), fault(change === 'receipt' ? 'storage_unavailable' : change === 'expiry' ? 'stale_contract' : 'conflict'))
      assert.equal(h.counts.initialize, phase === 'initialize' ? 1 : 0)
    })
})

test('material protocol, exact subject and stable readback refuse before initializing a target', async t => {
  for (const kind of ['prefixed_digest', 'wrong_root', 'wrong_generation', 'wrong_intent', 'readback_changed']) await t.test(kind, async t => {
    const h = fixture(t), service = h.makeService()
    h.prepareTransform = material => {
      if (kind === 'prefixed_digest') material.intentDigest = `sha256:${material.intentDigest}`
      if (kind === 'wrong_root') material.stateRoot = join(h.root, 'other-target')
      if (kind === 'wrong_generation') material.generationId = 'another-generation'
      if (kind === 'wrong_intent') material.intentDigest = '0'.repeat(64)
      return material
    }
    if (kind === 'readback_changed') h.readTransform = material => ({ ...material, manifestDigest: '0'.repeat(64) })
    await assert.rejects(service.prepare(h.input, actor), fault(kind === 'prefixed_digest' ? 'verification_failed' : 'conflict'))
    assert.equal(h.counts.initialize, 0)
  })
})

test('incomplete, unsafe, wrong-schema and business-residual targets stay blocked without initialization', async t => {
  for (const kind of ['bounded', 'unsafe', 'wrong_schema', 'business', 'empty_tables']) await t.test(kind, async t => {
    const h = fixture(t), service = h.makeService()
    await service.prepare(h.input, actor)
    const before = h.counts.initialize
    h.inventoryTransform = inventory => {
      if (kind === 'bounded') return { ...inventory, completeness: 'bounded', issues: ['busy_or_changed'] }
      if (kind === 'unsafe') return { ...inventory, issues: ['unsafe_link'] }
      if (kind === 'wrong_schema') return { ...inventory, productSchema: PRODUCT_SCHEMA_VERSION + 1 }
      if (kind === 'business') return { ...inventory, tables: inventory.tables.map(table => table.name === 'works' ? { ...table, rows: 1 } : table) }
      return { ...inventory, tables: [] }
    }
    const result = await service.prepare(h.input, actor)
    assert.equal(result.step, 'blocked'); assert.equal(result.startupAvailable, false)
    assert.equal(result.blockers[0].code, kind === 'business' ? 'business_rows_present' : kind === 'unsafe' ? 'target_unsafe' : 'inventory_incomplete')
    assert.equal(h.counts.initialize, before)
  })
})

test('lost initialization result is auditable and a repeat uses the completed database without initializing twice', async t => {
  const h = fixture(t), service = h.makeService()
  h.initializationError = 'after'
  const result = await service.prepare(h.input, actor)
  assert.equal(result.step, 'blocked'); assert.equal(result.blockers[0].code, 'initialization_unknown')
  assert.equal((await service.read(h.intent.activationId)).step, 'inventory_complete')
  h.reopen()
  assert.equal((await h.makeService().prepare(h.input, actor)).step, 'inventory_complete')
  assert.equal(h.counts.initialize, 1)
})

test('simultaneous same-body preparation shares one initialization; caller mutation cannot change the result', async t => {
  const h = fixture(t), service = h.makeService()
  let release, entered
  const wait = new Promise(resolve => { release = resolve }), seen = new Promise(resolve => { entered = resolve })
  h.afterPrepare = async () => { entered(); await wait }
  const first = service.prepare(h.input, actor)
  await seen
  const second = service.prepare(h.input, actor)
  release()
  const [left, right] = await Promise.all([first, second])
  assert.deepEqual(left, right); assert.equal(h.counts.prepare, 1); assert.equal(h.counts.initialize, 1)
  left.material.generationId = 'caller-mutation'
  assert.equal(right.material.generationId, h.intent.target.generationId)
})

test('read stays audit-only for absent, material-only, expired and changed material state', async t => {
  const h = fixture(t), service = h.makeService()
  assert.equal(await service.read('missing'), undefined)
  assert.equal((await service.read(h.intent.activationId)).step, 'not_prepared')
  await h.makeService({ async initialize() { throw new Error('Controlled initialization unavailable') } }).prepare(h.input, actor)
  const before = { ...h.counts }, source = h.snapshot()
  assert.equal((await service.read(h.intent.activationId)).step, 'material_prepared')
  assert.equal(h.counts.initialize, before.initialize); assert.equal(h.counts.revalidate, before.revalidate)
  h.setTime('2026-11-11T00:06:00.000Z')
  const expired = await service.read(h.intent.activationId)
  assert.equal(expired.step, 'blocked'); assert.equal(expired.blockers[0].code, 'source_expired')
  h.readTransform = material => ({ ...material, generationId: 'foreign' })
  const invalid = await service.read(h.intent.activationId)
  assert.ok(invalid.blockers.some(blocker => blocker.code === 'material_mismatch'))
  assert.deepEqual(h.snapshot(), source)
})

test('source transactions and asynchronous revalidation callbacks are refused', async t => {
  const h = fixture(t), service = h.makeService()
  let pending
  h.store.uow.atomic(() => { pending = service.prepare(h.input, actor) })
  await assert.rejects(pending, fault('invalid_request'))
  assert.throws(() => h.makeService({ async revalidateSource() {} }), /synchronous/)
  await assert.rejects(h.makeService({ revalidateSource() { return Promise.resolve() } }).prepare(h.input, actor), fault('invalid_request'))
  assert.equal(h.counts.prepare, 0)
})

test('a rejected thenable source callback is observed and cannot begin target preparation', async t => {
  const h = fixture(t)
  const service = h.makeService({ revalidateSource: () => Promise.reject(new Error('asynchronous source callback')) })
  await assert.rejects(service.prepare(h.input, actor), fault('invalid_request'))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(h.counts.prepare, 0); assert.equal(h.counts.initialize, 0)
})

test('a configured root cannot substitute for the actual source Store root', async t => {
  const h = fixture(t, { intent(value, { root }) { value.source.stateRoot = join(root, 'foreign') } })
  const service = h.makeService({ stateRoot: join(h.root, 'foreign') })
  await assert.rejects(service.prepare(h.input, actor), fault('forbidden'))
  assert.equal(h.counts.prepare, 0)
})

test('port failures remain inspectable blocked outcomes and do not initialize unknown material', async t => {
  for (const phase of ['prepare', 'readback', 'inventory']) await t.test(phase, async t => {
    const h = fixture(t)
    let overrides
    if (phase === 'prepare') overrides = { materializer: { async prepare() { throw new Error('Controlled material failure') } } }
    if (phase === 'readback') h.afterRead = () => { throw new Error('Controlled read failure') }
    if (phase === 'inventory') overrides = { inventory: { inspect() { throw new Error('Controlled inventory failure') } } }
    const result = await h.makeService(overrides).prepare(h.input, actor)
    assert.equal(result.step, 'blocked'); assert.equal(result.startupAvailable, false)
    assert.equal(result.blockers[0].code, phase === 'inventory' ? 'inventory_incomplete' : 'target_unsafe')
    assert.equal(h.counts.initialize, 0)
  })
})
