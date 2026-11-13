import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const principal = { userId: 'source-confirm-user', authorityRef: 'source-confirm-authority' }
const actor = { ...principal, source: 'local_ui' }, projectId = 'source-confirm-project'
const headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }

function fixture(t, mode = 'recovery_readonly') {
  const root = mkdtempSync('/tmp/pa-source-confirm-'), stateRoot = join(root, 'source'), project = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(project)
  writeFileSync(join(project, 'index.mjs'), 'export const ok = true\n')
  const git = args => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Source confirmation fixture'])
  const marker = join(stateRoot, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'personal-restore/1', targetPath: stateRoot,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  let at = '2026-11-13T02:00:00.000Z', profileRevision = 1
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  store.queue.enqueue('application.execute', 'old-held-work', '{"workId":"historical"}', 1, 0, at)
  const projects = [{ id: projectId, scope: { projectId, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } }]
  const runtimes = [], make = (secret = Buffer.alloc(32, 79)) => {
    const product = createProductRuntime({ store, stateRoot, scratchProject: project, principal, projects, actionSecret: secret,
      startupMode: mode, now: () => at,
      ...(mode === 'normal' ? { executionUnavailable: 'operator_disabled' } : {}),
      recoveryExecutor: () => ({ id: 'read-only-fixture-executor', revision: profileRevision, executable: process.execPath, expectedVersion: process.version }) })
    runtimes.push(product)
    const http = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
      mode: 'personal', startupMode: mode, allowedOrigins: ['http://127.0.0.1:5173'], read: product.read, operations: product.operations })
    return { product, http }
  }
  t.after(async () => { for (const value of runtimes) await value.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const { product, http } = make()
  const input = async () => ({ preflight: { expectedFingerprint: (await product.read.recovery()).inspectionFingerprint,
    bindings: [{ sourceProjectId: projectId, project: { path: project, check: 'node_test' } }] }, targetStateRoot: join(root, 'new-empty-target') })
  const request = (path, body, extra = {}) => http.request(`http://127.0.0.1/v1/recovery/source/${path}`, {
    method: 'POST', headers, body: JSON.stringify(body), ...extra })
  const prepare = async () => {
    const response = await request('prepare', await input())
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  return { root, stateRoot, project, store, marker, product, http, input, request, prepare, make,
    setTime: value => { at = value }, changeProfile: () => { profileRevision++ } }
}

test('actual source prepare is read-only and confirmation records one A fact/receipt with no target or business dispatch', async t => {
  const h = fixture(t), before = { source: h.store.workflows.recoverySource.inspect().sourceFingerprint,
    queue: h.store.db.prepare('SELECT * FROM effect').all(), marker: readFileSync(h.marker), cursor: h.store.events.cursor() }
  const prepared = await h.prepare()
  assert.equal(prepared.startupAvailable, false); assert.equal(prepared.authorization, 'not_granted')
  assert.equal(h.store.events.cursor(), before.cursor)
  assert.equal(h.store.workflows.recoveryActivations.get(prepared.intent.activationId), undefined)
  assert.equal(existsSync(prepared.intent.target.stateRoot), false)
  const response = await h.request('confirm', { token: prepared.token }), record = await response.json()
  assert.equal(response.status, 200, JSON.stringify(record))
  assert.equal(record.startupAvailable, false); assert.equal(record.authorization, 'not_granted')
  assert.deepEqual(record.committed.intent, prepared.intent)
  const normalized = h.store.workflows.recoverySource.inspect({ ignoreCommitted: record.committed })
  assert.equal(normalized.coverage, 'complete'); assert.equal(normalized.sourceFingerprint, before.source)
  assert.deepEqual(h.store.db.prepare('SELECT * FROM effect').all(), before.queue)
  assert.deepEqual(readFileSync(h.marker), before.marker)
  assert.equal(existsSync(prepared.intent.target.stateRoot), false)
  assert.equal(h.store.product.works.listByProject(projectId).length, 0)
  const audit = await h.http.request(`http://127.0.0.1/v1/recovery/activations/${prepared.intent.activationId}`, { headers })
  assert.deepEqual(await audit.json(), record)
})

test('a lost confirmation response replays its exact original receipt after expiry, source change and runtime reopen', async t => {
  const h = fixture(t), prepared = await h.prepare(), original = await (await h.request('confirm', { token: prepared.token })).json()
  const cursor = h.store.events.cursor()
  h.setTime('2026-11-13T02:20:00.000Z'); h.changeProfile()
  writeFileSync(h.marker, 'changed marker after committed confirmation')
  const { http } = h.make()
  const replay = await http.request('http://127.0.0.1/v1/recovery/source/confirm', { method: 'POST', headers, body: JSON.stringify({ token: prepared.token }) })
  assert.equal(replay.status, 200, await replay.clone().text())
  assert.deepEqual(await replay.json(), original)
  assert.equal(h.store.events.cursor(), cursor)
  assert.equal(existsSync(prepared.intent.target.stateRoot), false)
})

for (const [name, change] of [
  ['unlogged source row', h => h.store.queue.enqueue('application.execute', 'later-work', '{}', 1, 0, '2026-11-13T02:00:01.000Z')],
  ['marker bytes', h => writeFileSync(h.marker, 'changed marker')],
  ['current executor', h => h.changeProfile()],
  ['target now exists', (h, prepared) => mkdirSync(prepared.intent.target.stateRoot)],
  ['expiry', h => h.setTime('2026-11-13T02:06:00.000Z')],
]) test(`new source confirmation refuses ${name} without writing an intent`, async t => {
  const h = fixture(t), prepared = await h.prepare()
  change(h, prepared)
  const cursor = h.store.events.cursor(), response = await h.request('confirm', { token: prepared.token })
  assert.notEqual(response.status, 200)
  assert.equal(h.store.workflows.recoveryActivations.get(prepared.intent.activationId), undefined)
  assert.equal(h.store.commands.get(prepared.intent.commandId), undefined)
  assert.equal(h.store.events.cursor(), cursor)
})

test('unexpected same-transaction source writes beyond the exact confirmation roll back fact, event, receipt and queue together', async t => {
  const h = fixture(t), prepared = await h.prepare(), cursor = h.store.events.cursor()
  const originalRecord = h.store.commands.record.bind(h.store.commands)
  h.store.commands.record = (...args) => {
    const result = originalRecord(...args)
    if (args[0] === prepared.intent.commandId) h.store.queue.enqueue('application.execute', 'unrelated-write', '{}', 1, 0, '2026-11-13T02:00:01.000Z')
    return result
  }
  const response = await h.request('confirm', { token: prepared.token })
  assert.equal(response.status, 409, await response.clone().text())
  assert.equal(h.store.workflows.recoveryActivations.get(prepared.intent.activationId), undefined)
  assert.equal(h.store.commands.get(prepared.intent.commandId), undefined)
  assert.equal(h.store.events.cursor(), cursor)
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM effect').get().n, 1)
})

test('receipt-storage failure rolls back the original source fact and allows the identical still-current request', async t => {
  const h = fixture(t), prepared = await h.prepare(), record = h.store.commands.record.bind(h.store.commands)
  h.store.commands.record = (...args) => args[0] === prepared.intent.commandId ? record(args[0], args[1], () => {
    args[2](); throw new Error('Injected receipt fault')
  }) : record(...args)
  assert.notEqual((await h.request('confirm', { token: prepared.token })).status, 200)
  assert.equal(h.store.events.cursor(), 0)
  assert.equal(h.store.workflows.recoveryActivations.get(prepared.intent.activationId), undefined)
  h.store.commands.record = record
  assert.equal((await h.request('confirm', { token: prepared.token })).status, 200)
})

test('signature, server-only fields, foreign principal, unsupported media, origins and exact readonly exceptions stay enforced', async t => {
  const h = fixture(t), input = await h.input(), prepared = await h.prepare()
  assert.equal((await h.request('prepare', input, { headers: { 'content-type': 'application/json' } })).status, 401)
  assert.equal((await h.request('confirm', { token: prepared.token, intent: prepared.intent })).status, 400)
  assert.equal((await h.request('prepare', { ...input, machineDigest: 'a'.repeat(64) })).status, 400)
  assert.equal((await h.request('confirm', { token: `${prepared.token.slice(0, -1)}${prepared.token.endsWith('a') ? 'b' : 'a'}` })).status, 403)
  assert.equal((await h.request('confirm', { token: prepared.token }, { headers: { ...headers, origin: 'http://foreign.local' } })).status, 403)
  assert.equal((await h.request('confirm', { token: prepared.token }, { headers: { authorization: headers.authorization, 'content-type': 'text/plain' } })).status, 400)
  await assert.rejects(h.product.operations.recoverySourceConfirm({ token: prepared.token }, { ...actor, userId: 'foreign' }), error => error.error.code === 'forbidden')
  const otherKey = h.make(Buffer.alloc(32, 80))
  await assert.rejects(otherKey.product.operations.recoverySourceConfirm({ token: prepared.token }, actor), error => error.error.code === 'forbidden')
  const blocked = await h.http.request('http://127.0.0.1/v1/commands', { method: 'POST', headers, body: '{}' })
  assert.equal(blocked.status, 422)
  assert.equal(h.store.events.cursor(), 0)
})

test('normal startup refuses both source routes and historical/overlapping targets cannot be prepared', async t => {
  const normal = fixture(t, 'normal')
  assert.equal((await normal.request('prepare', await normal.input())).status, 422)
  const h = fixture(t)
  for (const targetStateRoot of [h.stateRoot, join(h.stateRoot, 'nested'), h.root]) {
    const response = await h.request('prepare', { ...await h.input(), targetStateRoot })
    assert.equal(response.status, 422)
  }
  assert.equal(h.store.events.cursor(), 0)
})

for (const window of ['before-commit', 'after-commit']) test(`actual independent-process SIGKILL ${window} preserves one original confirmation and held queue`, async t => {
  const h = fixture(t), prepared = await h.prepare(), path = join(h.root, 'process-input.json')
  writeFileSync(path, JSON.stringify({ stateRoot: h.stateRoot, project: h.project, principal, projectId,
    token: prepared.token, now: '2026-11-13T02:00:00.000Z' }), { mode: 0o600 })
  const run = crash => spawnSync(process.execPath, ['tests/integration/fixtures/recovery-source-confirm-process.mjs', path, ...(crash ? [crash] : [])],
    { encoding: 'utf8', timeout: 15000 })
  const interrupted = run(window)
  assert.equal(interrupted.signal, 'SIGKILL', interrupted.stderr)
  assert.equal(!!h.store.commands.get(prepared.intent.commandId), window === 'after-commit')
  const recovered = run()
  assert.equal(recovered.status, 0, recovered.stderr)
  const record = JSON.parse(recovered.stdout)
  assert.deepEqual(record.committed.intent, prepared.intent)
  const cursor = h.store.events.cursor()
  const replay = run()
  assert.equal(replay.status, 0, replay.stderr)
  assert.deepEqual(JSON.parse(replay.stdout), record)
  assert.equal(h.store.events.cursor(), cursor)
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM recovery_activations').get().n, 1)
  assert.equal(h.store.db.prepare('SELECT COUNT(*) AS n FROM effect').get().n, 1)
  assert.equal(existsSync(prepared.intent.target.stateRoot), false)
  assert.equal(record.startupAvailable, false)
})
