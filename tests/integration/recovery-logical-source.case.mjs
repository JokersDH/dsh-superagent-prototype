import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { ProductRecovery } from '../../apps/coordinator/product/recovery.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const principal = { userId: 'source-preflight-user', authorityRef: 'source-preflight-authority' }
const actor = { ...principal, source: 'local_ui' }, projectId = 'restored-project', at = '2026-11-12T00:00:00.000Z'
function fixture(t) {
  const root = mkdtempSync('/tmp/pa-logical-preflight-'), project = join(root, 'project')
  mkdirSync(project); writeFileSync(join(project, 'index.mjs'), 'export const ok = true\n')
  const git = args => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Logical source fixture'])
  const marker = join(root, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'personal-restore/1', targetPath: root,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const store = new ProductStore({ path: join(root, 'state.sqlite') }), runtimes = []
  const projects = [{ id: projectId, scope: { projectId, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } }]
  const options = { stateRoot: root, startupMode: 'recovery_readonly', principal, projects: () => projects,
    now: () => at, executor: () => ({ id: 'profile-diagnostic', revision: 1, expectedVersion: process.version, executable: process.execPath }) }
  const recovery = new ProductRecovery(store, options)
  const input = () => ({ expectedFingerprint: recovery.inspect().inspectionFingerprint,
    bindings: [{ sourceProjectId: projectId, project: { path: project, check: 'node_test' } }] })
  const runtime = () => {
    const value = createProductRuntime({ store, stateRoot: root, scratchProject: project, principal, projects,
      actionSecret: Buffer.alloc(32, 57), startupMode: 'recovery_readonly' })
    runtimes.push(value); return value
  }
  t.after(async () => { for (const value of runtimes) await value.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, project, marker, store, recovery, options, input, runtime }
}
test('actual runtime HTTP recovery inspect consumes the production A logical source reader', async t => {
  const h = fixture(t), product = h.runtime()
  const http = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'personal', startupMode: 'recovery_readonly', read: product.read, operations: product.operations })
  const headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
  const before = { cursor: h.store.events.cursor(), queue: h.store.db.prepare('SELECT * FROM effect').all(), marker: readFileSync(h.marker) }
  const response = await http.request('http://127.0.0.1/v1/recovery/inspect', { headers }), value = await response.json()
  assert.equal(response.status, 200)
  assert.deepEqual(value.logicalSource, { coverage: 'complete', fingerprint: h.store.workflows.recoverySource.inspect().sourceFingerprint })
  assert.equal(value.commitAvailable, false)
  const original = value.inspectionFingerprint
  h.store.product.works.insert({ id: 'http-source-change', projectId, conversationId: 'conversation', title: 'An unlogged data change', createdAt: at })
  const rejected = await http.request('http://127.0.0.1/v1/recovery/prepare', { method: 'POST', headers,
    body: JSON.stringify({ ...h.input(), expectedFingerprint: original }) })
  assert.equal(rejected.status, 409); assert.equal((await rejected.json()).error.code, 'conflict')
  assert.equal((await http.request('http://127.0.0.1/v1/recovery/commit', { method: 'POST', headers, body: '{}' })).status, 422)
  assert.equal(h.store.events.cursor(), before.cursor); assert.deepEqual(h.store.db.prepare('SELECT * FROM effect').all(), before.queue)
  assert.deepEqual(readFileSync(h.marker), before.marker)
})
test('a logical business change invalidates a prior binding preview without a new event', t => {
  const h = fixture(t)
  h.store.product.works.insert({ id: 'old-work', projectId, conversationId: 'conversation', title: 'Original title', createdAt: at })
  const input = h.input(), cursor = h.store.events.cursor()
  h.store.db.prepare('UPDATE works SET value = ? WHERE id = ?')
    .run(JSON.stringify({ ...h.store.product.works.get('old-work'), title: 'Changed without an event' }), 'old-work')
  assert.equal(h.store.events.cursor(), cursor)
  assert.throws(() => h.recovery.prepare(input, actor), error => error.error.code === 'conflict')
})
test('the sole heartbeat exclusion stays stable while writer identity changes remain visible', t => {
  const h = fixture(t)
  h.store.db.prepare('INSERT INTO coordinator_instances (nonce, pid, started_at, heartbeat_at) VALUES (?, ?, ?, ?)').run('fixture-instance', 12345, at, at)
  const before = h.recovery.inspect()
  h.store.db.prepare('UPDATE coordinator_instances SET heartbeat_at = ? WHERE nonce = ?').run('2026-11-12T00:00:01.000Z', 'fixture-instance')
  assert.equal(h.recovery.inspect().inspectionFingerprint, before.inspectionFingerprint)
  const plan = h.recovery.prepare({ ...h.input(), expectedFingerprint: before.inspectionFingerprint }, actor)
  assert.deepEqual(plan.logicalSource, before.logicalSource); assert.equal(plan.authorization, 'not_granted'); assert.equal(plan.commitAvailable, false)
  h.store.db.prepare('UPDATE coordinator_instances SET pid = ? WHERE nonce = ?').run(12346, 'fixture-instance')
  assert.notEqual(h.recovery.inspect().inspectionFingerprint, before.inspectionFingerprint)
})
for (const [id, change] of [
  ['unknown table', store => store.db.exec('CREATE TABLE extra_business (id TEXT PRIMARY KEY)')],
  ['missing required table', store => store.db.exec('DROP TABLE assistant_reply_results')],
  ['future schema', store => store.db.prepare("UPDATE schema_meta SET value = '99' WHERE key = 'product_schema'").run()],
]) test(`unsupported logical source (${id}) cannot become a binding plan`, t => {
  const h = fixture(t); change(h.store)
  const inspection = h.recovery.inspect()
  assert.deepEqual(inspection.logicalSource, { coverage: 'unsupported', fingerprint: null })
  assert.ok(inspection.blockers.some(blocker => blocker.code === 'source_checkpoint_unavailable'))
  assert.throws(() => h.recovery.prepare(h.input(), actor), error => error.error.code === 'verification_failed')
})
test('an actually bounded production source cannot prepare a binding plan', t => {
  const h = fixture(t)
  h.store.uow.atomic(() => {
    for (let index = 0; index < 10001; index++) h.store.queue.enqueue('application.execute', `held-${index}`, '{}', index + 1, 0, at)
  })
  const before = h.store.db.prepare('SELECT COUNT(*) AS n FROM effect').get().n, inspection = h.recovery.inspect()
  assert.deepEqual(inspection.logicalSource, { coverage: 'bounded', fingerprint: null })
  assert.throws(() => h.recovery.prepare(h.input(), actor), error => error.error.code === 'verification_failed')
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM effect').get().n, before)
})
test('an unlogged logical change during executable preflight is rejected by the final check', t => {
  const h = fixture(t), input = h.input()
  const recovery = new ProductRecovery(h.store, { ...h.options, executor: () => {
    h.store.product.works.insert({ id: 'changed-during-prepare', projectId, conversationId: 'conversation', title: 'New source row', createdAt: at })
    return h.options.executor()
  } })
  assert.throws(() => recovery.prepare(input, actor), error => error.error.code === 'conflict')
  assert.equal(h.store.events.cursor(), 0)
})
