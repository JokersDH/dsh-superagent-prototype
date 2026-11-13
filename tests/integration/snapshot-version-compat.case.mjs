import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore, readWorkflowEvidence } from '../../packages/storage/dist/index.js'
import { WorkflowSnapshots } from '../../packages/workflows/src/snapshot.ts'

const require = createRequire(new URL('../../packages/storage/package.json', import.meta.url)), Database = require('better-sqlite3')
const golden = JSON.parse(readFileSync(new URL('./fixtures/genuine-v1-evidence.json', import.meta.url), 'utf8'))
function fixture(t) {
  const root = mkdtempSync('/tmp/pa-version-compat-'), store = new ProductStore({ path: join(root, 'state.sqlite') })
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const bundle = store.artifacts.write(Buffer.from(golden.fixture.bundleText)); store.artifacts.insert(bundle)
  assert.equal(bundle.id, golden.fixture.binding.bundleRef)
  store.workflows.assistant.contextBindings.put(golden.fixture.binding)
  return { root, store, snapshots: new WorkflowSnapshots(store) }
}
const save = (path, manifest) => writeFileSync(join(path, 'snapshot.json'), JSON.stringify(manifest))
const rehash = (path, manifest) => {
  const bytes = readFileSync(join(path, 'product.sqlite'))
  manifest.database.bytes = bytes.byteLength; manifest.database.sha256 = createHash('sha256').update(bytes).digest('hex')
  save(path, manifest)
}
test('the existing default producer and reader retain the full genuine historical v1 evidence vector', async t => {
  const h = fixture(t), path = join(h.root, 'default'), result = await h.snapshots.create({ destination: path })
  assert.equal(result.status, 'ok'); assert.equal(result.manifest.protocol, golden.snapshotProtocol)
  assert.deepEqual(result.manifest.evidence, golden.evidence)
  assert.deepEqual(readWorkflowEvidence(join(path, 'product.sqlite')), golden.evidence)
  assert.equal('schemaInventory' in result.manifest, false)
  const before = [readFileSync(join(path, 'product.sqlite')), readFileSync(join(path, 'snapshot.json'))]
  assert.equal(h.snapshots.verify(path).status, 'ok')
  assert.deepEqual(readFileSync(join(path, 'product.sqlite')), before[0]); assert.deepEqual(readFileSync(join(path, 'snapshot.json')), before[1])
})
test('explicit format2 includes the exact expanded family set and its distinct binding recipe', async t => {
  const h = fixture(t), path = join(h.root, 'v2')
  h.store.queue.enqueue('application.execute', 'held', '{"workId":"legacy-work"}', 1, 0, golden.fixture.binding.confirmedAt)
  const result = await h.snapshots.create({ destination: path, formatVersion: 2 }), evidence = result.manifest.evidence
  assert.equal(result.status, 'ok'); assert.equal(result.manifest.protocol, 'workflow-snapshot/2')
  assert.equal(evidence.protocol, 'workflow-evidence/2'); assert.equal(evidence.familySetVersion, 2)
  assert.equal(evidence.families.length, 21)
  assert.equal(evidence.families.find(value => value.name === 'effect_queue').count, 1)
  assert.equal(evidence.families.find(value => value.name === 'assistant_context_bindings').digest,
    '7022d0a2ca54342c557a37667dbdcadf90b487be66640eb76dffbaa26b6b5bc8')
  assert.equal(h.snapshots.verify(path).status, 'ok')
})
test('verification accepts captured old-producer evidence rather than deriving a legacy label from new hashes', async t => {
  const h = fixture(t), path = join(h.root, 'captured-old'), result = await h.snapshots.create({ destination: path, formatVersion: 2 })
  const { schemaInventory: _, ...manifest } = result.manifest
  save(path, { ...manifest, protocol: golden.snapshotProtocol, evidence: golden.evidence })
  assert.equal(golden.producer.producerFilesStable, true); assert.equal(golden.evidence.families.length, 13)
  assert.equal(h.snapshots.verify(path).status, 'ok')
})
for (const [name, change] of [
  ['missing queue family', value => { value.evidence.families = value.evidence.families.filter(item => item.name !== 'effect_queue') }],
  ['duplicate family', value => { value.evidence.families[1] = value.evidence.families[0] }],
  ['future family set', value => { value.evidence.familySetVersion = 3 }],
  ['mixed inner version', value => { value.evidence.protocol = 'workflow-evidence/1' }],
  ['mixed outer version', value => { value.protocol = 'workflow-snapshot/1' }],
]) test(`format2 refuses ${name}`, async t => {
  const h = fixture(t), path = join(h.root, 'invalid'), result = await h.snapshots.create({ destination: path, formatVersion: 2 })
  change(result.manifest); save(path, result.manifest)
  assert.equal(h.snapshots.verify(path).status, 'blocked')
})
test('legacy evidence cannot downgrade to a partial family list', async t => {
  const h = fixture(t), path = join(h.root, 'partial-v1'), result = await h.snapshots.create({ destination: path })
  result.manifest.evidence.families = result.manifest.evidence.families.slice(0, 2); save(path, result.manifest)
  assert.equal(h.snapshots.verify(path).status, 'blocked')
})
for (const schema of [0, 1.5]) for (const formatVersion of [1, 2]) test(`format${formatVersion} create and verify reject schema${schema}`, async t => {
  const h = fixture(t), validPath = join(h.root, 'valid'), valid = await h.snapshots.create({ destination: validPath, formatVersion })
  const db = new Database(join(validPath, 'product.sqlite'))
  try { db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'product_schema'").run(JSON.stringify(schema)) } finally { db.close() }
  valid.manifest.database.productSchema = schema; rehash(validPath, valid.manifest)
  assert.equal(h.snapshots.verify(validPath).status, 'blocked')
  h.store.db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'product_schema'").run(JSON.stringify(schema))
  const result = await h.snapshots.create({ destination: join(h.root, 'invalid-create'), formatVersion })
  assert.equal(result.status, 'blocked'); assert.equal(result.manifest.complete, false)
})
test('unsupported requested versions fail before creating a destination or opening an evidence database', async t => {
  const h = fixture(t)
  for (const formatVersion of [0, 3, null, '2']) {
    const destination = join(h.root, `format-${String(formatVersion)}`)
    await assert.rejects(h.snapshots.create({ destination, formatVersion }), /Unsupported snapshot/)
    assert.equal(existsSync(destination), false)
    assert.throws(() => readWorkflowEvidence(join(h.root, 'missing.sqlite'), formatVersion), /Unsupported workflow evidence/)
  }
})
