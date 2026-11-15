import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { ProjectRecipePreviewSchema } from '../../packages/contracts/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { ProductProjectRecipes } from '../../apps/coordinator/product/project-recipes.ts'
import { ensureStarterProject, NativeProjectRegistry } from '../../apps/coordinator/product/project-registry.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const principal = { userId: 'recipe-user', authorityRef: 'recipe-authority' }, actor = { ...principal, source: 'local_cli' }
function fixture(t) {
  const root = mkdtempSync('/tmp/pa-recipes-'), stateRoot = join(root, 'state'); mkdirSync(stateRoot, { mode: 0o700 })
  const registry = new NativeProjectRegistry(stateRoot)
  const records = ['alpha', 'beta'].map(name => {
    const path = join(root, name); ensureStarterProject(path)
    const record = registry.prepare({ path, displayName: name, check: 'node_test' }); registry.save(record); return record
  })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createProductRuntime({ store, stateRoot, scratchProject: records[0].path, projectRegistry: registry,
    projects: records.map(record => ({ id: record.id, displayName: record.displayName, scope: { projectId: record.id,
      allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } })), principal, actionSecret: Buffer.alloc(32, 11) })
  t.after(async () => { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const input = (index = 0, kind = 'scoped_change') => ({ projectId: records[index].id, kind, allowedPaths: ['src/'], profileId: 'profile-fixture-pass' })
  const http = overrides => createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations, ...overrides })
  return { root, records, registry, store, product, input, http }
}
const post = (app, body, suffix = '', headers = {}) => app.request(`http://127.0.0.1/v1/projects/${body.projectId}/recipes/preview${suffix}`, {
  method: 'POST', headers: { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })

test('registered project metadata becomes exact scoped form fields with no events or project writes', async t => {
  const h = fixture(t), before = h.store.events.cursor(), original = readFileSync(join(h.records[0].path, 'package.json'))
  for (const kind of ['regression_fix', 'scoped_change', 'verification_followup']) {
    const response = await post(h.http(), h.input(0, kind)), preview = ProjectRecipePreviewSchema.parse(await response.json())
    assert.equal(response.status, 200); assert.equal(preview.status, 'draft', JSON.stringify(preview.issues))
    assert.equal(preview.authorization, 'none'); assert.deepEqual(preview.fields.scope.allowedPaths, ['src/'])
    assert.equal(preview.fields.projectId, h.records[0].id); assert.equal(preview.fields.profileId, 'profile-fixture-pass')
    assert.doesNotMatch(JSON.stringify(preview), new RegExp(h.root)); assert.equal(h.store.events.cursor(), before)
  }
  assert.deepEqual(readFileSync(join(h.records[0].path, 'package.json')), original)
})
test('current configuration and stable content digests bind independent previews; metadata changes are detected', async t => {
  const h = fixture(t), first = await h.product.read.projectRecipePreview(h.input())
  const second = await h.product.read.projectRecipePreview(h.input())
  assert.equal(first.factsDigest, second.factsDigest); assert.equal(first.catalogDigest, second.catalogDigest)
  assert.deepEqual(first.fields, second.fields)
  const file = join(h.records[0].path, 'package.json'), metadata = JSON.parse(readFileSync(file, 'utf8'))
  writeFileSync(file, JSON.stringify({ ...metadata, description: 'Changed source; do not send an old draft' }))
  const changed = await h.product.read.projectRecipePreview(h.input())
  assert.notEqual(changed.factsDigest, first.factsDigest)
  const foreign = await h.product.read.projectRecipePreview(h.input(1))
  assert.equal(foreign.fields.projectId, h.records[1].id)
})
test('HTTP rejects unauthenticated, injected-root, foreign, malformed and wrong-scope requests', async t => {
  const h = fixture(t), app = h.http(), input = h.input()
  assert.equal((await post(app, input, '', { authorization: '' })).status, 401)
  assert.equal((await post(app, input, '', { origin: 'https://foreign.invalid' })).status, 403)
  for (const body of [{ ...input, root: '/private' }, { ...input, command: 'run' }, { ...input, kind: 'unknown' },
    { ...input, allowedPaths: ['src/', 'src/'] }]) assert.equal((await post(app, body)).status, 400)
  assert.equal((await post(app, { ...input, projectId: 'foreign-project' })).status, 403)
  const child = await (await post(app, { ...input, allowedPaths: ['src/child.ts'] })).json()
  assert.equal(child.status, 'needs_input'); assert.equal(child.fields, null)
  assert.equal((await post(app, input, '?force=true')).status, 400)
  assert.ok((await post(h.http({ startupMode: 'recovery_readonly' }), input)).status >= 400)
})
test('missing roots, unreadable metadata, blocked profile and changing configuration never yield actionable fields', async t => {
  const h = fixture(t), input = h.input(), config = await h.product.read.configuration()
  const reader = (configuration, rootFor) => new ProductProjectRecipes({ configuration: async () => configuration, rootFor })
  assert.equal((await reader(config, () => undefined).preview(input)).status, 'unavailable')
  assert.equal((await reader(config, () => '/missing-private-root').preview(input)).status, 'unavailable')
  const blocked = structuredClone(config); blocked.projects[0].dispatchAllowed = false; blocked.projects[0].blockedReason = 'unsupported_capability'
  assert.equal((await reader(blocked, () => { throw new Error('Blocked project must not read metadata') }).preview(input)).status, 'needs_input')
  let reads = 0
  const changing = new ProductProjectRecipes({ configuration: async () => ++reads === 1 ? config : { ...config, revision: 'f'.repeat(64) }, rootFor: () => h.records[0].path })
  await assert.rejects(changing.preview(input), error => error.error.code === 'conflict')
})
async function until(read, predicate) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('Original product did not reach the expected state')
}
test('two actual previews explicitly enter the original Work/check/currentCandidate/manualaccept chain', { timeout: 60000 }, async t => {
  const h = fixture(t); h.product.start()
  for (const index of [0, 1]) {
    const preview = await h.product.read.projectRecipePreview(h.input(index, index ? 'verification_followup' : 'scoped_change')), fields = preview.fields
    assert.equal(preview.status, 'draft')
    const created = await h.product.application.dispatch({ kind: 'create_work', commandId: `recipe-create-${index}`,
      conversationId: `recipe-chat-${index}`, ...fields }, actor)
    assert.equal(created.status, 'recorded', JSON.stringify(created))
    const ready = await until(async () => (await h.product.application.inspect({ workId: created.workId })).works[0],
      work => work.actions.available.includes('accept_candidate'))
    assert.notEqual(ready.phase, 'delivered')
    const accepted = await h.product.application.dispatch({ kind: 'accept_candidate', commandId: `recipe-accept-${index}`,
      conversationId: `recipe-chat-${index}`, candidate: ready.actions.currentCandidate }, actor)
    assert.equal(accepted.status, 'recorded')
    assert.equal((await h.product.application.inspect({ workId: created.workId })).works[0].phase, 'delivered')
  }
})
