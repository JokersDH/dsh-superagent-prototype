import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ApplicationFault } from '../../packages/application/dist/index.js'
import { PRODUCT_SCHEMA_VERSION, recoveryTargetInventory } from '../../packages/storage/dist/index.js'
import { canonicalDigest } from '../../packages/contracts/src/canonical.ts'
import { actor, fixture as sourceFixture, scope } from '../../packages/application/test/helpers.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { RecoveryIntentCommitter } from '../../apps/coordinator/product/recovery-intents.ts'
import { ProductRecoveryTargets } from '../../apps/coordinator/product/recovery-target-service.ts'
import { initializeRecoveryTarget } from '../../apps/coordinator/product/recovery-target-initializer.ts'

const digest = value => canonicalDigest(JSON.parse(JSON.stringify(value)))
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const origin = 'http://127.0.0.1:4499', bootstrapToken = 'a'.repeat(64), apiToken = 'b'.repeat(64)
const auth = { authorization: `Bearer ${apiToken}` }, json = { ...auth, 'content-type': 'application/json' }
const path = '/v1/recovery/targets/prepare', targetPath = '/v1/recovery/targets/activation-one'
const stableStatus = value => ({ ...value, ...(value.inventory ? { inventory: { ...value.inventory, observedAt: 'fresh-observation' } } : {}) })

function fixture(t) {
  const source = sourceFixture(t), root = realpathSync(mkdtempSync(join(tmpdir(), 'pa-target-http-'))), targetRoot = join(root, 'generation-one')
  const marker = join(source.directory, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'fixture-restored-state/1', stateRoot: source.directory }), { mode: 0o600 })
  let time = '2026-11-11T00:01:00.000Z'
  const configuration = { protocol: 'recovery-target-configuration/1', projects: [{ sourceProjectId: scope.projectId, targetProjectId: 'target-project',
    registration: { path: '/tmp/fixture-project', check: 'node_test' } }], executor: { profileId: 'codex', revision: 1, identityDigest: 'a'.repeat(64) } }
  const intent = { protocol: 'recovery-activation-intent/1', activationId: 'activation-one', commandId: 'http-target-confirm', planId: 'http-plan',
    planDigest: 'b'.repeat(64), source: { stateId: 'source-state', stateRoot: source.directory, markerDigest: sha(readFileSync(marker)), inspectionFingerprint: 'c'.repeat(64) },
    target: { generationId: 'generation-one', stateRoot: targetRoot, configurationDigest: digest(configuration) },
    principal: { userId: actor.userId, authorityRef: actor.authorityRef }, machineDigest: 'd'.repeat(64), resourcePolicyDigest: 'e'.repeat(64),
    createdAt: '2026-11-11T00:00:00.000Z', expiresAt: '2026-11-11T00:05:00.000Z' }
  new RecoveryIntentCommitter(source.store, source.store.workflows.recoveryActivations, actor,
    candidate => assert.equal(candidate.source.markerDigest, sha(readFileSync(marker))), () => time).commit(intent, actor)
  const counts = { prepare: 0, read: 0, inventory: 0, initialize: 0, revalidate: 0 }
  const h = { source, root, targetRoot, marker, configuration, intent, counts, input: { activationId: intent.activationId, configuration },
    setTime(value) { time = value } }
  const materializer = {
    async prepare(preparation) {
      counts.prepare++
      assert.equal(source.store.uow.nesting, 0)
      assert.equal(preparation.source.intent.target.stateRoot, targetRoot)
      assert.equal(digest(preparation.configuration), intent.target.configurationDigest)
      mkdirSync(targetRoot, { recursive: true, mode: 0o700 })
      const material = { protocol: 'recovery-target-material/1', activationId: intent.activationId, generationId: intent.target.generationId,
        stateRoot: targetRoot, intentDigest: digest(intent), configurationDigest: intent.target.configurationDigest,
        manifestDigest: digest(preparation), productSchema: PRODUCT_SCHEMA_VERSION, preparedAt: intent.createdAt, startupAvailable: false }
      const file = join(targetRoot, 'material.json')
      if (existsSync(file)) assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), material)
      else writeFileSync(file, JSON.stringify(material), { mode: 0o600 })
      await h.afterPrepare?.()
      return material
    },
    async read(root) {
      counts.read++
      const file = join(root, 'material.json')
      return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
    },
    async discardStaging() { throw new Error('HTTP preparation may not discard target state') },
  }
  // A's admitted reader and main's initializer are production; D material and source proof stay fixtures.
  const inventory = { inspect(root) {
    counts.inventory++
    return recoveryTargetInventory.inspect(root)
  } }
  h.service = () => new ProductRecoveryTargets({ store: source.store, principal: actor, stateRoot: source.directory,
    materializer, inventory, revalidateSource(commit) {
      counts.revalidate++
      // Explicit fixture identity checks; no claim to validate real host or physical writer proof.
      if (realpathSync(commit.intent.source.stateRoot) !== realpathSync(source.directory) ||
        realpathSync(source.store.db.name) !== join(realpathSync(source.directory), 'state.sqlite') ||
        commit.intent.source.markerDigest !== sha(readFileSync(marker)) ||
        commit.intent.target.configurationDigest !== digest(configuration))
        throw new ApplicationFault('conflict', 'Fixture source identity or marker changed')
    }, async initialize(material) { counts.initialize++; await initializeRecoveryTarget(material) }, now: () => time })
  h.http = (overrides = {}) => {
    const service = h.service()
    return createLocalHttpApp({ application: source.app, principal: actor, bootstrapToken, apiToken, allowedOrigins: [origin], mode: 'fixture',
      startupMode: 'recovery_readonly', operations: { recoveryTargetPrepare: (input, identity) => {
        h.lastActor = identity; return service.prepare(input, identity)
      } }, read: { recoveryTarget: id => service.read(id) }, ...overrides })
  }
  h.send = (app, body = h.input, headers = json, url = path) => app.request(url, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) })
  h.snapshot = () => ({ totalChanges: source.store.db.prepare('SELECT total_changes() AS n').get().n, cursor: source.store.events.cursor(),
    receipt: source.store.commands.get(intent.commandId), fact: source.store.workflows.recoveryActivations.get(intent.activationId),
    marker: readFileSync(marker, 'utf8'), queue: source.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100),
    works: source.store.product.works.listByProject(scope.projectId).length })
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return h
}

test('target preparation and audit require authentication and exact browser write origin', async t => {
  const h = fixture(t), api = h.http()
  assert.equal((await api.request(targetPath)).status, 401)
  assert.equal((await h.send(api, h.input, { 'content-type': 'application/json' })).status, 401)
  assert.equal((await h.send(api, h.input, { ...json, authorization: 'Bearer invalid' })).status, 401)
  const browserApi = h.http({ localDevelopmentAccess: true })
  assert.equal((await h.send(browserApi, h.input, { 'content-type': 'application/json' })).status, 403)
  assert.equal((await h.send(browserApi, h.input, { 'content-type': 'application/json', origin: 'http://untrusted.invalid' })).status, 403)
  const login = await api.request('/v1/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ bootstrapToken }) })
  assert.equal(login.status, 200)
  const cookie = login.headers.get('set-cookie').split(';')[0]
  assert.equal((await h.send(api, h.input, { cookie, 'content-type': 'application/json', origin: 'http://untrusted.invalid' })).status, 403)
  assert.equal(h.counts.prepare, 0); assert.equal(h.counts.initialize, 0)
})

test('strict target DTO accepts no caller actor, raw source, authority or query overrides', async t => {
  const h = fixture(t), api = h.http(), before = h.snapshot()
  for (const extra of [{ actor }, { source: h.intent }, { principal: actor }, { force: true }, { startupAvailable: true }])
    assert.equal((await h.send(api, { ...h.input, ...extra })).status, 400)
  assert.equal((await h.send(api, '{')).status, 400)
  assert.equal((await h.send(api, h.input, { ...auth, 'content-type': 'text/plain' })).status, 400)
  assert.equal((await h.send(api, h.input, json, `${path}?force=true`)).status, 400)
  assert.equal((await api.request(`${targetPath}?force=true`, { headers: auth })).status, 400)
  assert.equal((await api.request('/v1/recovery/targets/bad%2Fid', { headers: auth })).status, 400)
  assert.equal(h.counts.prepare, 0); assert.deepEqual(h.snapshot(), before)
})

test('normal mode and absent configured ports cannot prepare; the readonly mutation exception is exact', async t => {
  const h = fixture(t), before = h.snapshot()
  assert.equal((await h.send(h.http({ startupMode: 'normal' }))).status, 422)
  const unavailable = h.http({ operations: undefined, read: undefined })
  assert.equal((await h.send(unavailable)).status, 422)
  assert.equal((await unavailable.request(targetPath, { headers: auth })).status, 422)
  const readonly = h.http()
  assert.equal((await h.send(readonly, { kind: 'chat', commandId: 'forbidden-chat', conversationId: 'conversation', projectId: scope.projectId, text: 'Do not dispatch' }, json, '/v1/commands')).status, 422)
  assert.equal((await h.send(readonly, h.input, json, `${path}/`)).status, 422)
  assert.equal((await h.send(readonly, h.input, json, '/v1/recovery/targets/activate')).status, 422)
  assert.equal((await h.send(readonly, h.input, json, '/v1/recovery/commit')).status, 422)
  assert.equal(h.counts.prepare, 0); assert.deepEqual(h.snapshot(), before)
})

test('explicit restored preparation initializes one real exclusive target; lost response replay and audit leave source unchanged', async t => {
  const h = fixture(t), api = h.http(), before = h.snapshot()
  // Discard the first response: a caller retry must observe the same durable material and database.
  assert.equal((await h.send(api)).status, 200)
  const result = await (await h.send(api)).json()
  assert.equal(result.step, 'inventory_complete'); assert.equal(result.authorization, 'not_granted'); assert.equal(result.startupAvailable, false)
  assert.equal(result.material.stateRoot, h.targetRoot); assert.equal(result.inventory.productSchema, PRODUCT_SCHEMA_VERSION)
  assert.equal(h.counts.initialize, 1); assert.equal(h.lastActor.source, 'local_cli')
  assert.ok(result.inventory.tables.some(table => table.name === 'works' && table.rows === 0))
  assert.ok(result.blockers.some(blocker => blocker.code === 'authorization_not_implemented'))
  const counts = { ...h.counts }, audit = await api.request(targetPath, { headers: auth })
  assert.equal(audit.status, 200); assert.deepEqual(stableStatus(await audit.json()), stableStatus(result))
  assert.equal(h.counts.initialize, counts.initialize); assert.equal(h.counts.revalidate, counts.revalidate)
  assert.deepEqual(h.snapshot(), before)
  h.source.reopen()
  assert.deepEqual(stableStatus(await (await h.http().request(targetPath, { headers: auth })).json()), stableStatus(result))
  assert.equal(h.counts.initialize, 1); assert.equal(h.source.store.domain.tickets.list().length, 0)
})

test('audit 404, response identity and ungrantable status are enforced at the actual HTTP boundary', async t => {
  const h = fixture(t), api = h.http()
  assert.equal((await api.request('/v1/recovery/targets/missing', { headers: auth })).status, 404)
  const status = await h.service().read(h.intent.activationId), foreign = { ...status, activationId: 'foreign' }
  assert.equal((await h.http({ read: { recoveryTarget: async () => foreign } }).request(targetPath, { headers: auth })).status, 503)
  assert.equal((await h.send(h.http({ operations: { recoveryTargetPrepare: async () => foreign } }))).status, 503)
  const granted = { ...status, authorization: 'granted', startupAvailable: true }
  assert.equal((await h.http({ read: { recoveryTarget: async () => granted } }).request(targetPath, { headers: auth })).status, 400)
  assert.equal(h.counts.initialize, 0)
})

test('fixture source identity revalidation rejects changed marker before database creation; expired records remain readonly audit', async t => {
  const h = fixture(t), api = h.http()
  h.afterPrepare = () => writeFileSync(h.marker, JSON.stringify({ changed: true }), { mode: 0o600 })
  assert.equal((await h.send(api)).status, 409)
  assert.equal(h.counts.initialize, 0); assert.equal(existsSync(join(h.targetRoot, 'state.sqlite')), false)
  h.setTime('2026-11-11T00:06:00.000Z')
  const result = await (await api.request(targetPath, { headers: auth })).json()
  assert.equal(result.step, 'blocked'); assert.equal(result.blockers[0].code, 'source_expired')
  assert.equal(result.startupAvailable, false); assert.equal(result.authorization, 'not_granted'); assert.equal(h.counts.initialize, 0)
})
