import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore, PRODUCT_SCHEMA_VERSION, requiredSchemaObjects } from '../../packages/storage/dist/index.js'
import { WorkflowSnapshots } from '../../packages/workflows/src/snapshot.ts'

const require = createRequire(new URL('../../packages/storage/package.json', import.meta.url)), Database = require('better-sqlite3')
async function fixture(t) {
  const root = mkdtempSync('/tmp/pa-schema-admission-'), store = new ProductStore({ path: join(root, 'state.sqlite') })
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  const bundle = store.artifacts.write(Buffer.from('{"bounded":true}')); store.artifacts.insert(bundle)
  store.workflows.assistant.contextBindings.put({ protocol: 'assistant-context-binding/1',
    commandId: 'legacy-command', messageId: 'legacy-message', requestId: 'legacy-request',
    projectId: 'legacy-project', conversationId: 'legacy-conversation', userTextDigest: 'a'.repeat(64),
    principal: { userId: 'legacy-user', authorityRef: 'legacy-authority' }, purpose: 'conversation_discussion',
    scope: { projectId: 'legacy-project', allowedPaths: ['src'], excludedPaths: [], externalActions: [] },
    contract: { workId: 'legacy-work', revision: 1, digest: 'b'.repeat(64) }, selections: ['work'],
    bundleRef: bundle.id, bundleDigest: bundle.digest,
    sources: [{ sourceId: 'legacy-work', kind: 'contract', sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), truncated: false }],
    confirmedAt: '2026-11-13T00:00:00.000Z', expiresAt: '2026-11-13T00:04:00.000Z' })
  const snapshots = new WorkflowSnapshots(store), path = join(root, 'snapshot'), created = await snapshots.create({ destination: path })
  assert.equal(created.status, 'ok'); assert.equal(snapshots.verify(path).status, 'ok')
  return { root, store, snapshots, path, created }
}
const rewriteHash = path => {
  const file = join(path, 'snapshot.json'), manifest = JSON.parse(readFileSync(file, 'utf8')), bytes = readFileSync(join(path, 'product.sqlite'))
  manifest.database.bytes = bytes.byteLength; manifest.database.sha256 = createHash('sha256').update(bytes).digest('hex')
  writeFileSync(file, JSON.stringify(manifest))
}
test('actual v1 nonempty context bindings retain the original evidence digest recipe and readonly verification', async t => {
  const h = await fixture(t), before = readFileSync(join(h.path, 'product.sqlite'))
  assert.equal(h.created.manifest.protocol, 'workflow-snapshot/1'); assert.equal(h.created.manifest.evidence.protocol, 'workflow-evidence/1')
  const family = h.created.manifest.evidence.families.find(value => value.name === 'assistant_context_bindings')
  assert.equal(family.count, 1); assert.equal(family.digest, '51d53c57b7d4be9c586f5b6a255a9d8f6bbd8db64c71f3e032e70a2df6cce7dd')
  assert.equal(h.snapshots.verify(h.path).status, 'ok'); assert.deepEqual(readFileSync(join(h.path, 'product.sqlite')), before)
})
for (const [name, mutate] of [
  ['empty required table missing', db => db.exec('DROP TABLE assistant_reply_results')],
  ['required index missing', db => db.exec(`DROP INDEX "${[...requiredSchemaObjects(PRODUCT_SCHEMA_VERSION).indexes][0]}"`)],
  ['unknown FTS-like table', db => db.exec('CREATE TABLE conversation_search_untrusted (value TEXT)')],
  ['schema metadata missing', db => db.exec('DROP TABLE schema_meta')],
]) test(`snapshot verifier refuses ${name} after a database hash rewrite`, async t => {
  const h = await fixture(t), path = join(h.root, 'changed'); cpSync(h.path, path, { recursive: true })
  const db = new Database(join(path, 'product.sqlite'))
  try { mutate(db) } finally { db.close() }
  rewriteHash(path)
  assert.equal(h.snapshots.verify(path).status, 'blocked')
})
test('snapshot creation does not mark an unknown schema as complete', async t => {
  const h = await fixture(t)
  h.store.db.prepare("UPDATE schema_meta SET value = '0' WHERE key = 'product_schema'").run()
  const result = await h.snapshots.create({ destination: join(h.root, 'unknown-schema') })
  assert.equal(result.status, 'blocked'); assert.equal(result.manifest.complete, false)
})
test('the admitted v1 verifier refuses an unsupported evidence protocol', async t => {
  const h = await fixture(t), file = join(h.path, 'snapshot.json'), manifest = JSON.parse(readFileSync(file, 'utf8'))
  manifest.evidence.protocol = 'workflow-evidence/2'; writeFileSync(file, JSON.stringify(manifest))
  assert.equal(h.snapshots.verify(h.path).status, 'blocked')
})
