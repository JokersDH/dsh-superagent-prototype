import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { projectSettingsFixture } from './project-settings.fixture.mjs'

const create = (h, id, project) => h.product.application.dispatch({ kind: 'create_work', commandId: id,
  conversationId: 'settings-conversation', projectId: h.projectId, scope: project.scope, criteria: project.defaultCriteria,
  profileId: h.profile.id, goal: 'Configuration fixture only; do not start a model task' }, h.actor)
const update = (h, changes = {}) => ({ kind: 'update_project_settings', commandId: 'settings-update', projectId: h.projectId,
  expectedRevision: 1, displayName: '支付服务新版', check: 'npm_test', environment: { policy: 'existing_only' }, ...changes })

test('settings versions freeze old queued contracts and survive reconstruction without rewriting private project bindings', async t => {
  const h = projectSettingsFixture(); t.after(() => h.close())
  const registryBytes = readFileSync(join(h.stateRoot, 'native-projects.json'), 'utf8')
  const originalConfiguration = await h.product.read.configuration(), original = originalConfiguration.projects[0]
  const created = await create(h, 'old-settings-work', original)
  assert.equal(created.status, 'recorded')
  const wrongProfile = await h.product.application.dispatch({ kind: 'create_work', commandId: 'wrong-profile-work', conversationId: 'settings-conversation',
    projectId: h.projectId, scope: original.scope, criteria: original.defaultCriteria, profileId: 'profile-fixture-pass', goal: 'Cannot switch a native project to a fixture' }, h.actor)
  assert.equal(wrongProfile.status, 'rejected')
  const wrongCheck = await create(h, 'wrong-project-check', { ...original, defaultCriteria: [{ ...original.defaultCriteria[0], checkDefinitionRef: 'check-fixture-output' }] })
  assert.equal(wrongCheck.status, 'rejected')
  const oldContract = (await h.product.application.inspect({ workId: created.workId })).works[0].contract
  const before = h.product.projectSettings.forContract(oldContract)
  const receipt = await h.product.operations.projectSettings(update(h), h.actor)
  assert.equal(receipt.status, 'recorded')
  const configuration = await h.product.read.configuration(), current = configuration.projects[0]
  assert.equal(current.displayName, '支付服务新版')
  assert.notEqual(current.defaultCriteria[0].checkDefinitionRef, original.defaultCriteria[0].checkDefinitionRef)
  assert.notEqual(configuration.revision, originalConfiguration.revision)
  assert.deepEqual((await h.product.application.inspect({ workId: created.workId })).works[0].contract, oldContract)
  assert.deepEqual(h.product.projectSettings.forContract(oldContract), before)
  const stale = await create(h, 'stale-settings-work', original)
  assert.equal(stale.status, 'rejected'); assert.equal(stale.error.code, 'conflict')
  const next = await create(h, 'new-settings-work', current)
  assert.equal(next.status, 'recorded')
  const newContract = (await h.product.application.inspect({ workId: next.workId })).works[0].contract
  assert.deepEqual(h.product.projectSettings.forContract(newContract).check.argv, ['test'])
  await h.reopen()
  assert.equal((await h.product.read.projectSettings(h.projectId)).current.revision, 2)
  assert.deepEqual(h.product.projectSettings.forContract(oldContract), before)
  assert.deepEqual(h.product.projectSettings.forContract(newContract).check.argv, ['test'])
  assert.deepEqual(await h.product.operations.projectSettings(update(h), h.actor), receipt)
  assert.equal(readFileSync(join(h.stateRoot, 'native-projects.json'), 'utf8'), registryBytes)
  assert.equal(h.store.bindings.current((await h.product.application.inspect({ workId: created.workId })).works[0].actions.currentAssignment.ticketId), undefined)
})

test('archive blocks new authorization while current work stays readable and existing profile/check identity remains frozen', async t => {
  const h = projectSettingsFixture(); t.after(() => h.close())
  const before = await h.product.read.configuration(), project = before.projects[0]
  const created = await create(h, 'before-archive', project)
  const contract = (await h.product.application.inspect({ workId: created.workId })).works[0].contract
  const archived = await h.product.operations.projectSettings({ kind: 'archive_project', commandId: 'archive-project', projectId: h.projectId, expectedArchiveRevision: 0, archived: true }, h.actor)
  assert.equal(archived.status, 'recorded')
  const disabled = await h.product.read.configuration()
  assert.equal(disabled.projects[0].dispatchAllowed, false)
  assert.notEqual(disabled.revision, before.revision)
  assert.equal((await create(h, 'after-archive', project)).status, 'rejected')
  assert.deepEqual((await h.product.application.inspect({ workId: created.workId })).works[0].contract, contract)
  assert.ok(h.product.projectSettings.forContract(contract))
  const refused = await h.product.operations.projectSettings(update(h), h.actor)
  assert.equal(refused.status, 'rejected')
  await h.product.operations.projectSettings({ kind: 'archive_project', commandId: 'unarchive-project', projectId: h.projectId, expectedArchiveRevision: 1, archived: false }, h.actor)
  assert.equal((await h.product.read.configuration()).projects[0].dispatchAllowed, true)
  assert.equal((await create(h, 'after-unarchive', project)).status, 'recorded')
})

test('CAS, actor, bad environment and receipt failure cannot replace settings or leak a half-committed check', async t => {
  const h = projectSettingsFixture(); t.after(() => h.close())
  const old = await h.product.read.projectSettings(h.projectId)
  await assert.rejects(h.product.operations.projectSettings(update(h), { ...h.actor, userId: 'foreign-user' }), error => error.error.code === 'forbidden')
  const bad = await h.product.operations.projectSettings(update(h, { commandId: 'bad-cache', environment: { policy: 'offline_install', storeDir: h.projectPath } }), h.actor)
  assert.equal(bad.status, 'rejected')
  h.store.db.exec("CREATE TRIGGER reject_settings_receipt BEFORE INSERT ON command_receipts WHEN NEW.command_id = 'settings-update' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
  await assert.rejects(h.product.operations.projectSettings(update(h), h.actor))
  assert.deepEqual(await h.product.read.projectSettings(h.projectId), old)
  assert.equal(h.product.checks.ids().some(id => id.endsWith('.s2')), false)
  h.store.db.exec('DROP TRIGGER reject_settings_receipt')
  const first = await h.product.operations.projectSettings(update(h), h.actor)
  assert.equal(first.status, 'recorded')
  assert.deepEqual(await h.product.operations.projectSettings(update(h), h.actor), first)
  await assert.rejects(h.product.operations.projectSettings(update(h, { displayName: 'changed-payload' }), h.actor), error => error.error.code === 'conflict')
  const stale = await h.product.operations.projectSettings(update(h, { commandId: 'stale-settings' }), h.actor)
  assert.equal(stale.status, 'rejected')
  assert.equal((await h.product.read.projectSettings(h.projectId)).history.length, 2)
})

test('changing offline policy does not replace the old contract environment, and a dirty project cannot authorize new settings', async t => {
  const h = projectSettingsFixture(); t.after(() => h.close())
  const project = (await h.product.read.configuration()).projects[0]
  const created = await create(h, 'old-environment', project)
  const contract = (await h.product.application.inspect({ workId: created.workId })).works[0].contract
  const cache = join(h.root, 'cache'); mkdirSync(cache)
  const result = await h.product.operations.projectSettings(update(h, { environment: { policy: 'offline_install', storeDir: cache }, check: 'pnpm_test' }), h.actor)
  assert.equal(result.status, 'recorded')
  assert.equal(h.product.projectSettings.forContract(contract).environment, undefined)
  assert.equal((await h.product.read.workEnvironment(created.workId)).status, 'not_configured')
  assert.equal((await h.product.read.projectSettings(h.projectId)).current.environment.policy, 'offline_install')
  assert.equal(h.product.projectSettings.latest(h.projectId).environment.policy, 'offline_install')
  writeFileSync(join(h.projectPath, 'dirty.mjs'), '// preserve user change\n')
  const denied = await h.product.operations.projectSettings(update(h, { commandId: 'dirty-update', expectedRevision: 2 }), h.actor)
  assert.equal(denied.status, 'rejected')
  assert.equal((await h.product.read.projectSettings(h.projectId)).current.revision, 2)
  assert.equal(readFileSync(join(h.projectPath, 'dirty.mjs'), 'utf8'), '// preserve user change\n')
})

test('HTTP settings routes require trusted local identity and validate request/receipt boundaries', async t => {
  const h = projectSettingsFixture(); t.after(() => h.close())
  const http = h.http(), path = `http://127.0.0.1:5180/v1/projects/${h.projectId}/settings`, headers = { origin: 'http://127.0.0.1:5180', 'content-type': 'application/json' }
  const authHttp = h.http()
  assert.equal((await http.request(path, { headers: { authorization: 'Bearer wrong' } })).status, 401)
  const before = await (await authHttp.request(path)).json()
  assert.equal(before.current.revision, 1)
  assert.equal((await http.request(`${path}?actor=forged`)).status, 400)
  assert.equal((await http.request(path, { method: 'POST', headers, body: JSON.stringify({ ...update(h), actor: h.actor }) })).status, 400)
  assert.equal((await http.request(path, { method: 'POST', headers, body: JSON.stringify({ ...update(h), projectId: 'another-project' }) })).status, 400)
  assert.equal((await http.request(path, { method: 'POST', headers: { ...headers, origin: 'http://evil.invalid' }, body: JSON.stringify(update(h)) })).status, 403)
  assert.equal((await (await http.request(path, { method: 'POST', headers, body: JSON.stringify(update(h)) })).json()).status, 'recorded')
  assert.equal((await (await http.request(path)).json()).current.revision, 2)
  assert.doesNotMatch(JSON.stringify(await h.product.read.configuration()), new RegExp(h.root))
})
