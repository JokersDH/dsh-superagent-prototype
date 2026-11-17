import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { ProductCompletionHistory } from '../../apps/coordinator/product/completion-history.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const principal = { userId: 'history-user', authorityRef: 'history-authority' }, token = 'a'.repeat(64)
const scope = id => ({ projectId: id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })
async function fixture(t) {
  const root = mkdtempSync('/tmp/pa-completion-history-'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true })
  const store = new ProductStore({ path: join(stateRoot, 'db.sqlite') })
  const product = createControlledProduct({ store, principal, stateRoot, scratchProject: projectRoot, actionSecret: Buffer.alloc(32, 12),
    projects: ['one', 'two'].map(id => ({ id, displayName: id, scope: scope(id) })) })
  t.after(async () => { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  const works = []
  for (const id of ['one', 'two']) {
    const receipt = await product.application.dispatch({ kind: 'create_work', commandId: `create-${id}`, conversationId: `chat-${id}`,
      projectId: id, goal: `History ${id}`, profileId: 'profile-fixture-pass', scope: scope(id),
      criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Output', checkDefinitionRef: FIXTURE_CHECK }] },
    { ...principal, source: 'local_cli' })
    assert.equal(receipt.status, 'recorded')
    works.push((await product.application.inspect({ workId: receipt.workId })).works[0])
  }
  const first = works[0], ticketId = first.links[0]?.ticketId ?? 'history-ticket'
  if (!first.links.length) store.uow.atomic(() => store.product.links.attach({ contract: first.contract, ticketId, role: 'primary', authorityRef: principal.authorityRef }))
  const insert = store.db.prepare(`INSERT INTO completion_verifications
    (id,ticket_id,assignment_id,candidate_generation,contract,artifact_digest,criteria_digest,environment_ref,verifier_identity_ref,results,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
  for (let index = 0; index < 65; index++) insert.run(`history-verification-${String(index).padStart(3, '0')}`, ticketId, 'history-assignment', 1,
    JSON.stringify(first.contract), 'd'.repeat(64), 'c'.repeat(64), 'private-environment', 'private-verifier', '[]', '2026-11-17T00:00:00.000Z')
  const app = (read = product.read, startupMode = 'normal') => createLocalHttpApp({ application: product.application, principal,
    apiToken: token, bootstrapToken: 'b'.repeat(64), mode: 'fixture', startupMode, allowedOrigins: ['http://127.0.0.1:4100'], read })
  const get = (workId, query = 'kind=verifications&limit=10', target = app(), headers = { authorization: `Bearer ${token}` }) =>
    target.request(`http://127.0.0.1/v1/works/${workId}/completion-history?${query}`, { headers })
  return { store, product, works, first, ticketId, insert, app, get }
}

test('actual authorized HTTP continues 65 original metadata records and reads the original contract without writes', async t => {
  const h = await fixture(t), before = h.store.events.cursor(), ids = []
  let cursor
  do {
    const response = await h.get(h.first.work.id, `kind=verifications&limit=10${cursor ? `&cursor=${cursor}` : ''}`)
    assert.equal(response.status, 200)
    const page = await response.json(); assert.equal(page.authorization, 'none'); assert.equal(page.available, 65)
    assert.equal(page.projectId, 'one'); assert.equal(page.currentContract.digest, h.first.contract.digest)
    assert.ok(Buffer.byteLength(JSON.stringify(page)) <= page.maxBytes)
    assert.doesNotMatch(JSON.stringify(page), /private-environment|private-verifier|results|actorRef|argv|rootPath/)
    ids.push(...page.entries.map(row => row.id)); cursor = page.nextCursor
  } while (cursor)
  assert.equal(ids.length, 65); assert.equal(new Set(ids).size, 65)
  const contracts = await (await h.get(h.first.work.id, 'kind=contracts')).json()
  assert.equal(contracts.entries[0].digest, h.first.contract.digest); assert.equal(contracts.entries[0].revision, 1)
  const accepts = await (await h.get(h.first.work.id, 'kind=acceptances')).json()
  assert.equal(accepts.available, 0); assert.equal(accepts.hasMore, false)
  assert.equal(h.store.events.cursor(), before)
})

test('history authenticates, rejects injected/repeated parameters and reads under recovery readonly', async t => {
  const h = await fixture(t)
  assert.equal((await h.get(h.first.work.id, undefined, h.app(), {})).status, 401)
  assert.equal((await h.get(h.first.work.id, undefined, h.app(), { authorization: `Bearer ${token}`, origin: 'https://foreign.invalid' })).status, 403)
  for (const query of ['kind=contracts&kind=verifications', 'kind=attempts', 'kind=contracts&limit=0', 'kind=contracts&limit=21', 'kind=contracts&path=/private'])
    assert.equal((await h.get(h.first.work.id, query)).status, 400)
  assert.equal((await h.get(h.first.work.id, undefined, h.app(h.product.read, 'recovery_readonly'))).status, 200)
})

test('cursor binds exact principal, current scope, work, kind, limit and expiry', async t => {
  const h = await fixture(t), context = { principal, projects: [{ id: 'one', scope: scope('one') }] }
  let now = '2026-11-17T00:00:00.000Z'
  const reader = new ProductCompletionHistory(h.store, h.product.application, () => context, Buffer.alloc(32, 9), () => now)
  const port = h.app({ workCompletionHistory: (id, query) => reader.read(id, query) })
  const first = await (await h.get(h.first.work.id, 'kind=verifications&limit=1', port)).json(), cursor = first.nextCursor
  assert.ok(cursor)
  for (const query of [`kind=contracts&limit=1&cursor=${cursor}`, `kind=verifications&limit=2&cursor=${cursor}`,
    `kind=verifications&limit=1&cursor=${cursor.slice(0, -2)}aa`]) assert.equal((await h.get(h.first.work.id, query, port)).status, 409)
  assert.equal((await h.get(h.works[1].work.id, `kind=verifications&limit=1&cursor=${cursor}`, port)).status, 403)
  context.principal = { ...principal, userId: 'other-user' }
  assert.equal((await h.get(h.first.work.id, `kind=verifications&limit=1&cursor=${cursor}`, port)).status, 409)
  context.principal = principal; context.projects[0].scope = { ...scope('one'), excludedPaths: ['src/private/'] }
  assert.equal((await h.get(h.first.work.id, `kind=verifications&limit=1&cursor=${cursor}`, port)).status, 409)
  context.projects[0].scope = scope('one'); now = '2026-11-17T00:06:00.000Z'
  assert.equal((await h.get(h.first.work.id, `kind=verifications&limit=1&cursor=${cursor}`, port)).status, 409)
})

test('oversized first entry is explicitly blocked, while corrupt or non-progress producer frames are refused', async t => {
  const h = await fixture(t)
  h.insert.run('oversized-verification', h.ticketId, 'history-assignment', 1, JSON.stringify(h.first.contract), 'd'.repeat(64), 'c'.repeat(64),
    'environment', 'verifier', JSON.stringify('x'.repeat(4194304)), '2026-11-18T00:00:00.000Z')
  const blocked = await (await h.get(h.first.work.id)).json()
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.reason, 'entry_too_large'); assert.equal(blocked.returned, 0)
  assert.equal(blocked.hasMore, true); assert.equal(blocked.nextCursor, undefined)
  const read = h.store.workflows.index.completionHistory.bind(h.store.workflows.index)
  h.store.workflows.index.completionHistory = query => ({ ...read({ ...query, kind: 'contracts' }), kind: query.kind, status: 'ok',
    entries: [], returned: 0, hasMore: true, nextCursor: 'never-progress', reason: null })
  assert.equal((await h.get(h.first.work.id)).status, 503)
})
