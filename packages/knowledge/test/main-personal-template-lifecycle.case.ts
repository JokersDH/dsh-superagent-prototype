import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { ensureStarterProject, NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const principal = { userId: 'wave31-template-user', authorityRef: 'wave31-template-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 30000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`template lifecycle timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

test('project template previews stay data-only while apply, edit and settings change keep the original form authoritative', { timeout: 180000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave31-template-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const registry = new NativeProjectRegistry(stateRoot)
  const paths = [join(root, 'project-a'), join(root, 'project-b')]
  const records = paths.map((path, index) => {
    ensureStarterProject(path)
    const record = registry.prepare({ path, displayName: `wave31-template-${index}`, check: 'node_test' })
    registry.save(record)
    return record
  })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createProductRuntime({
    store, stateRoot, scratchProject: paths[0]!, projectRegistry: registry,
    projects: records.map((record) => ({ id: record.id, displayName: record.displayName,
      scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } })),
    principal, actionSecret: Buffer.alloc(32, 13),
  })
  t.after(async () => { await product.close().catch(() => undefined); store.close(); rmSync(root, { recursive: true, force: true }) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
  product.start()
  const works = async () => ((await (await app.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works
  const baseline = await works()
  const previewOf = async (record: typeof records[number]) => (await (await app.request(`/v1/projects/${record.id}/recipes/preview`, {
    method: 'POST', headers, body: JSON.stringify({ projectId: record.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }),
  })).json()) as Record<string, any>

  const first = await previewOf(records[0]!)
  assert.equal(first.status, 'draft', JSON.stringify(first.issues))
  assert.equal(first.authorization, 'none')
  assert.equal(JSON.stringify(first).includes('node --test'), false)
  const refs = (first.fields.criteria as { checkDefinitionRef?: string }[]).map((criterion) => criterion.checkDefinitionRef)
  assert.equal(refs.includes(FIXTURE_CHECK), true)

  // Abandoning the preview creates no Work and no execution side effect.
  assert.equal((await works()).length, baseline.length)

  // Apply with an edited goal: the original create_work command still owns the identity and checks.
  const created = (await product.application.dispatch({ kind: 'create_work', commandId: 'w31-template-create-a',
    conversationId: 'w31-template-chat-a', ...first.fields, goal: `${String(first.fields.goal)}（人工补充：仅改错误码）` }, actor)) as unknown as { workId: string }
  const work = await until(async () => (await product.application.inspect({ workId: created.workId })).works[0],
    (value) => value !== undefined && value.actions.available.includes('accept_candidate'))
  if (!work!.actions.currentCandidate) throw new Error('template Work has no candidate')
  await product.application.dispatch({ kind: 'accept_candidate', commandId: 'w31-template-accept-a',
    conversationId: 'w31-template-chat-a', candidate: work!.actions.currentCandidate }, actor)
  const delivered = (await (await app.request(`/v1/works/${created.workId}`, { headers })).json()) as Record<string, any>
  assert.equal(delivered.phase, 'delivered')
  assert.equal(String(delivered.work.title).includes('人工补充'), true)

  // A settings revision invalidates the earlier preview; a stale draft is data, not an authorization token.
  const second = await previewOf(records[1]!)
  assert.equal(second.status, 'draft')
  const createdB = (await product.application.dispatch({ kind: 'create_work', commandId: 'w31-template-create-b',
    conversationId: 'w31-template-chat-b', ...second.fields }, actor)) as unknown as { workId: string }
  const workB = await until(async () => (await product.application.inspect({ workId: createdB.workId })).works[0],
    (value) => value !== undefined && value.actions.available.includes('accept_candidate'))
  await product.application.dispatch({ kind: 'accept_candidate', commandId: 'w31-template-accept-b',
    conversationId: 'w31-template-chat-b', candidate: workB!.actions.currentCandidate! }, actor)
  assert.equal((await works()).length, baseline.length + 2)

  // The foreign project path/body mismatch is still refused; no third Work is created by it.
  const cross = await app.request(`/v1/projects/${records[0]!.id}/recipes/preview`, { method: 'POST', headers,
    body: JSON.stringify({ projectId: records[1]!.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }) })
  assert.equal(cross.status, 400)
  assert.equal((await works()).length, baseline.length + 2)

  // A configuration revision bump invalidates the earlier preview; the old revision is data, not a token.
  await product.close()
  const thirdPath = join(root, 'project-c')
  ensureStarterProject(thirdPath)
  const third = registry.prepare({ path: thirdPath, displayName: 'wave31-template-2', check: 'node_test' })
  registry.save(third)
  const store2 = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product2 = createProductRuntime({ store: store2, stateRoot, scratchProject: paths[0]!, projectRegistry: registry,
    projects: [...records, third].map((record) => ({ id: record.id, displayName: record.displayName,
      scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } })),
    principal, actionSecret: Buffer.alloc(32, 13) })
  const app2 = createLocalHttpApp({ application: product2.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product2.read, operations: product2.operations })
  product2.start()
  try {
    const afterConfig = (await (await app2.request(`/v1/projects/${records[1]!.id}/recipes/preview`, { method: 'POST', headers,
      body: JSON.stringify({ projectId: records[1]!.id, kind: 'scoped_change', allowedPaths: ['src/'], profileId: 'profile-fixture-pass' }) })).json()) as Record<string, any>
    assert.equal(afterConfig.status, 'draft')
    assert.notEqual(afterConfig.configurationRevision, second.configurationRevision)
    assert.equal(afterConfig.authorization, 'none')
    const worksAfter = ((await (await app2.request('/v1/snapshot', { headers })).json()) as { works: unknown[] }).works
    assert.equal(worksAfter.length, baseline.length + 2)
  } finally { await product2.close().catch(() => undefined); store2.close() }
})
