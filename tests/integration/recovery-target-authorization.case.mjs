import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { readRecoveryTargetAuthorization, verifyRecoveryTargetStartup } from '../../apps/coordinator/product/recovery-target-authorization.ts'

const principal = { userId: 'target-authorization-user', authorityRef: 'target-authorization-authority' }
const headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pa-target-auth-'))), stateRoot = join(root, 'source'), project = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(project)
  mkdirSync(join(root, 'targets'), { mode: 0o700 })
  writeFileSync(join(project, 'index.mjs'), 'export const ok = true\n')
  const git = args => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs'])
  git(['-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Authorization fixture'])
  const marker = join(stateRoot, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'personal-restore/1', targetPath: stateRoot,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  store.queue.enqueue('application.execute', 'old-held-work', '{"workId":"old-work"}', 1, 0, '2026-11-24T01:00:00.000Z')
  let at = '2026-11-24T01:00:00.000Z'
  let profile = { id: 'fixture-current-profile', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
    driverRelease: 'fixture', executable: process.execPath, argv: [], expectedVersion: process.version,
    nativeConfigRef: 'fixture-local-policy', permissionPolicyRevision: 'fixture-policy-1', requiredFeatures: [] }
  const runtimes = []
  const make = () => {
    const product = createProductRuntime({ store, stateRoot, scratchProject: project, principal,
      projects: [{ id: 'old-project', displayName: 'Old project', scope: { projectId: 'old-project', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } }],
      actionSecret: Buffer.alloc(32, 71), startupMode: 'recovery_readonly', now: () => at, recoveryExecutor: () => structuredClone(profile) })
    runtimes.push(product)
    const http = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
      mode: 'personal', startupMode: 'recovery_readonly', allowedOrigins: ['http://127.0.0.1:4499'], read: product.read, operations: product.operations })
    return { product, http }
  }
  const { product, http } = make()
  const send = (path, input, extra = {}) => http.request('/v1/recovery/' + path,
    { method: 'POST', headers, body: JSON.stringify(input), ...extra })
  const prepare = async () => {
    const input = { preflight: { expectedFingerprint: (await product.read.recovery()).inspectionFingerprint,
      bindings: [{ sourceProjectId: 'old-project', project: { path: project, check: 'node_test' } }] }, targetStateRoot: join(root, 'targets', 'new-execution') }
    const preparedResponse = await send('source/prepare', input)
    assert.equal(preparedResponse.status, 200, await preparedResponse.clone().text())
    const prepared = await preparedResponse.json(), confirm = await send('source/confirm', { token: prepared.token })
    assert.equal(confirm.status, 200, await confirm.clone().text())
    const record = await confirm.json(), target = await send('targets/prepare', { activationId: prepared.intent.activationId, configuration: prepared.configuration })
    assert.equal(target.status, 200, await target.clone().text())
    const status = await target.json()
    assert.equal(status.step, 'inventory_complete', JSON.stringify(status.blockers))
    return { prepared, record, status, targetRoot: prepared.intent.target.stateRoot,
      command: { activationId: prepared.intent.activationId, commandId: status.authorizationCommandId,
        configuration: prepared.configuration, expectedManifestDigest: status.material.manifestDigest, confirmNewExecution: true } }
  }
  t.after(async () => { for (const value of runtimes) await value.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, stateRoot, project, marker, store, product, http, send, prepare, make,
    get profile() { return structuredClone(profile) }, changeProfile() { profile = { ...profile, revision: 2 } }, setTime(value) { at = value } }
}

test('default HTTP source/target/explicit authorization keeps source fingerprint and held queue unchanged', async t => {
  const h = fixture(t), data = await h.prepare()
  const before = { fingerprint: h.store.workflows.recoverySource.inspect({ ignoreCommitted: data.record.committed }).sourceFingerprint,
    cursor: h.store.events.cursor(), queue: h.store.db.prepare('SELECT * FROM effect').all(), marker: readFileSync(h.marker) }
  assert.throws(() => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile), /explicit new execution authorization/)
  const response = await h.send('targets/authorize', data.command)
  assert.equal(response.status, 200, await response.clone().text())
  const result = await response.json()
  assert.equal(result.authorization, 'granted'); assert.equal(result.started, false); assert.equal(result.startupAvailable, false)
  assert.equal(result.grant.commandId, data.command.commandId)
  assert.equal(h.store.commands.get(data.command.commandId), undefined)
  assert.equal(h.store.workflows.recoverySource.inspect({ ignoreCommitted: data.record.committed }).sourceFingerprint, before.fingerprint)
  assert.equal(h.store.events.cursor(), before.cursor)
  assert.deepEqual(h.store.db.prepare('SELECT * FROM effect').all(), before.queue)
  assert.deepEqual(readFileSync(h.marker), before.marker)
  assert.deepEqual(readRecoveryTargetAuthorization(data.targetRoot), result)
  assert.doesNotThrow(() => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile))
})

test('lost grant response is audited and replayed under the same generation without reauthorizing after expiry', async t => {
  const h = fixture(t), data = await h.prepare()
  const first = await h.send('targets/authorize', data.command)
  assert.equal(first.status, 200, await first.clone().text())
  const record = await first.json()
  h.setTime('2026-11-24T01:20:00.000Z'); h.changeProfile()
  const { http } = h.make()
  const audit = await http.request(`/v1/recovery/targets/${data.command.activationId}/authorization`, { headers })
  assert.equal(audit.status, 200); assert.deepEqual(await audit.json(), record)
  const replay = await http.request('/v1/recovery/targets/authorize', { method: 'POST', headers, body: JSON.stringify(data.command) })
  assert.equal(replay.status, 200, await replay.clone().text()); assert.deepEqual(await replay.json(), record)
  // Audit replay reports an old permission; it cannot grant execution to a changed profile.
  assert.throws(() => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile), /another host, root, principal or executor/)
})

for (const kind of ['source', 'marker', 'profile', 'project', 'manifest', 'command', 'expiry'])
  test(`explicit grant refuses changed ${kind} and leaves target without permission`, async t => {
    const h = fixture(t), data = await h.prepare()
    if (kind === 'source') h.store.queue.enqueue('application.execute', 'new-held', '{}', 1, 0, '2026-11-24T01:00:01.000Z')
    if (kind === 'marker') writeFileSync(h.marker, 'changed source marker')
    if (kind === 'profile') h.changeProfile()
    if (kind === 'project') writeFileSync(join(h.project, 'index.mjs'), 'export const changed = true\n')
    if (kind === 'manifest') data.command.expectedManifestDigest = '0'.repeat(64)
    if (kind === 'command') data.command.commandId = 'different-command'
    if (kind === 'expiry') h.setTime('2026-11-24T01:06:00.000Z')
    const response = await h.send('targets/authorize', data.command)
    assert.notEqual(response.status, 200)
    assert.equal(readRecoveryTargetAuthorization(data.targetRoot), undefined)
    assert.equal(h.store.commands.get(data.command.commandId), undefined)
  })

test('authorization route has strict authentication, origin, body and mode guards', async t => {
  const h = fixture(t), data = await h.prepare()
  assert.equal((await h.send('targets/authorize', data.command, { headers: { 'content-type': 'application/json' } })).status, 401)
  for (const extra of [{ actor: principal }, { force: true }, { confirmNewExecution: false }, { started: true }])
    assert.equal((await h.send('targets/authorize', { ...data.command, ...extra })).status, 400)
  assert.equal((await h.send('targets/authorize?force=true', data.command)).status, 400)
  const cookieApi = createLocalHttpApp({ application: h.product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    mode: 'personal', startupMode: 'recovery_readonly', localDevelopmentAccess: true, allowedOrigins: ['http://127.0.0.1:4499'], read: h.product.read, operations: h.product.operations })
  assert.equal((await cookieApi.request('/v1/recovery/targets/authorize', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://foreign.invalid' }, body: JSON.stringify(data.command) })).status, 403)
  assert.equal(readRecoveryTargetAuthorization(data.targetRoot), undefined)
})

test('authorized root reopens with new business rows; copying or changing target config cannot inherit permission', async t => {
  const h = fixture(t), data = await h.prepare(), response = await h.send('targets/authorize', data.command)
  assert.equal(response.status, 200, await response.clone().text())
  const target = new ProductStore({ path: join(data.targetRoot, 'state.sqlite') })
  try { target.queue.enqueue('application.execute', 'new-work-only', '{}', 1, 0, '2026-11-24T01:01:00.000Z') } finally { target.close() }
  h.setTime('2026-11-24T02:00:00.000Z')
  assert.doesNotThrow(() => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile))
  assert.throws(() => verifyRecoveryTargetStartup(data.targetRoot, { ...principal, userId: 'foreign-user' }, h.profile))
  const copy = join(h.root, 'copied-target'); cpSync(data.targetRoot, copy, { recursive: true })
  assert.throws(() => verifyRecoveryTargetStartup(copy, principal, h.profile))
  writeFileSync(join(data.targetRoot, 'native-projects.json'), JSON.stringify({ version: 1, projects: [] }), { mode: 0o600 })
  assert.throws(() => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile), /configuration changed/)
})

test('replacing the database in the same directory cannot reuse its original authorization', async t => {
  const h = fixture(t), data = await h.prepare(), response = await h.send('targets/authorize', data.command)
  assert.equal(response.status, 200, await response.clone().text())
  const database = join(data.targetRoot, 'state.sqlite'), replacement = join(data.targetRoot, 'replacement.sqlite')
  copyFileSync(database, replacement); renameSync(replacement, database)
  assert.ok(readRecoveryTargetAuthorization(data.targetRoot), 'the copied receipt remains observable, not fresh execution authority')
  assert.throws(() => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile), /another host, root, principal or executor/)
})

for (const authorized of [false, true]) test(`replaced parent is refused ${authorized ? 'at startup' : 'before target grant'}`, async t => {
  const h = fixture(t), data = await h.prepare()
  if (authorized) assert.equal((await h.send('targets/authorize', data.command)).status, 200)
  const parent = join(h.root, 'targets'), moved = join(h.root, 'original-target-parent')
  renameSync(parent, moved); mkdirSync(parent, { mode: 0o700 })
  renameSync(join(moved, 'new-execution'), data.targetRoot)
  if (authorized) assert.throws(() => verifyRecoveryTargetStartup(data.targetRoot, principal, h.profile))
  else assert.notEqual((await h.send('targets/authorize', data.command)).status, 200)
})

test('the historical fault worker refuses an unapproved crash argument before creating a Store', t => {
  const root = mkdtempSync(join(tmpdir(), 'pa-disabled-fault-')), input = join(root, 'input.json')
  writeFileSync(input, '{}', { mode: 0o600 })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, ['tests/integration/fixtures/recovery-source-confirm-process.mjs', input, 'before-commit'], {
    encoding: 'utf8', timeout: 10000, env: { ...process.env, PA_RECOVERY_SOURCE_FAULT_EXPERIMENT: '' },
  })
  assert.equal(result.status, 1); assert.equal(result.signal, null)
  assert.match(result.stderr, /OS fault injection is disabled/)
})

test('the actual coordinator entry refuses an ungranted target before credentials or database writes', async t => {
  const h = fixture(t), data = await h.prepare()
  const snapshot = () => ({ files: readdirSync(data.targetRoot).sort(), database: createHash('sha256').update(readFileSync(join(data.targetRoot, 'state.sqlite'))).digest('hex') })
  const before = snapshot(), entry = new URL('../../apps/coordinator/product/demo.ts', import.meta.url).href
  const script = `process.argv=[process.execPath,'--state',${JSON.stringify(data.targetRoot)},'--discussion-only','--port','0'];
    setTimeout(()=>process.exit(91),1500).unref();
    try{await import(${JSON.stringify(entry)})}catch(error){if(error?.error?.code!=='forbidden')throw error;console.log('forbidden');process.exitCode=42}`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8' })
  assert.equal(result.signal, null)
  assert.equal(result.status, 42, result.stderr)
  assert.match(result.stdout, /forbidden/, result.stderr)
  assert.deepEqual(snapshot(), before)
})
