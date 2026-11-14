import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ProductUsageObservation } from '../../apps/coordinator/product/usage-observation.ts'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { UsageObservationSchema } from '../../packages/contracts/dist/index.js'

const at = '2026-11-14T04:00:00.000Z'
const evidence = (id, entries = []) => ({ protocol: 'work-evidence/1', workId: id, projection: 'not_accepted', entries, outcomes: [], truncated: false })
const entry = (id, when = '2026-11-14T03:00:00.000Z') => ({ at: when, kind: 'question.opened', sourceRef: id, detail: { questionId: id } })
const make = (overrides = {}) => new ProductUsageObservation({ projectIds: () => ['one', 'two'], cursor: () => 1,
  listWorks: projects => ({ works: projects.map(id => ({ id: `work-${id}`, projectId: id })), hasMore: false }),
  workEvidence: async id => evidence(id, [entry(id)]), ...overrides }, () => at)

test('scoped public reader composition counts two projects and preserves unknown usage without product writes', async () => {
  const all = await make().read({ timezone: 'Asia/Shanghai' }), one = await make().read({ projectId: 'one' })
  assert.equal(all.status, 'ready'); assert.deepEqual(all.scope.projectIds, ['one', 'two'])
  assert.equal(all.sampleCount, 2)
  assert.equal(all.metrics.find(row => row.id.startsWith('interventions.questions@')).value, '2')
  assert.equal(one.metrics.find(row => row.id.startsWith('interventions.questions@')).value, '1')
  assert.deepEqual(one.scope.projectIds, ['one']); assert.equal(all.authorization, 'none'); assert.equal(all.unknownCount, null)
  assert.doesNotMatch(JSON.stringify(all), /questionId|work-one|work-two|sourceRef/)
})
test('original nested record limit and conflicting work mapping are blocked before G analysis', async () => {
  const duplicate = make({ listWorks: () => ({ works: [{ id: 'w', projectId: 'one' }, { id: 'w', projectId: 'two' }, { id: 'w', projectId: 'one' }], hasMore: false }) })
  await assert.rejects(duplicate.read({}), error => error.error.code === 'storage_unavailable')
  const large = make({ listWorks: () => ({ works: Array.from({ length: 21 }, (_, i) => ({ id: `w-${i}`, projectId: 'one' })), hasMore: false }),
    workEvidence: async id => evidence(id, Array.from({ length: 500 }, (_, i) => entry(`${id}-${i}`))) })
  const view = await large.read({})
  assert.equal(view.coverageState, 'partial'); assert.equal(view.sampleCount, null)
  assert.equal(view.metrics.find(row => row.id.startsWith('interventions.questions@')).value, '9,500')
})
test('missing, truncated, changing and outside-window sources never become a complete total', async () => {
  let reads = 0
  const missing = await make({ workEvidence: async id => { if (++reads === 1) throw new Error('/private/key-secret'); return evidence(id, [entry(id)]) } }).read({})
  assert.equal(missing.coverageState, 'partial'); assert.equal(missing.sampleCount, null); assert.doesNotMatch(JSON.stringify(missing), /key-secret/)
  const truncated = await make({ listWorks: () => ({ works: [{ id: 'w', projectId: 'one' }], hasMore: true }) }).read({})
  assert.equal(truncated.coverageState, 'partial')
  let cursor = 0
  const changed = await make({ cursor: () => ++cursor }).read({})
  assert.equal(changed.coverageState, 'partial')
  const old = await make({ workEvidence: async id => evidence(id, [entry(id, '2026-10-01T00:00:00.000Z')]) }).read({})
  assert.equal(old.status, 'ready'); assert.equal(old.metrics.find(row => row.id.startsWith('interventions.questions@')).value, '0')
})
test('authorization, nested subject, bytes and source scope changes have finite refusals', async () => {
  await assert.rejects(make().read({ projectId: 'foreign' }), error => error.error.code === 'forbidden')
  await assert.rejects(make({ workEvidence: async () => evidence('foreign') }).read({}), error => error.error.code === 'storage_unavailable')
  const huge = await make({ workEvidence: async id => evidence(id, [{ ...entry(id), detail: { text: 'x'.repeat(2100000) } }]) }).read({})
  assert.equal(huge.status, 'insufficient_data'); assert.equal(huge.coverageState, 'partial'); assert.equal(huge.sampleCount, null)
  let calls = 0
  await assert.rejects(make({ projectIds: () => ++calls === 1 ? ['one', 'two'] : ['one'] }).read({}), error => error.error.code === 'forbidden')
  const empty = await make({ projectIds: () => [] }).read({})
  assert.equal(empty.status, 'unavailable'); assert.equal(empty.sampleCount, null)
})
test('an older installed closure without the optional G package returns unavailable before collecting', t => {
  const root = mkdtempSync('/tmp/pa-usage-optional-')
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'node_modules/@personal-agent'), { recursive: true })
  for (const name of ['contracts', 'application']) symlinkSync(fileURLToPath(new URL(`../../packages/${name}/`, import.meta.url)), join(root, `node_modules/@personal-agent/${name}`))
  copyFileSync(fileURLToPath(new URL('../../apps/coordinator/product/usage-observation.ts', import.meta.url)), join(root, 'module.ts'))
  const script = `import { ProductUsageObservation } from ${JSON.stringify(pathToFileURL(join(root, 'module.ts')).href)};
    const value = await new ProductUsageObservation({projectIds:()=>['one'],cursor:()=>0,
      listWorks:()=>{throw new Error('Must not collect')},workEvidence:()=>{throw new Error('Must not read')}}).read({});
    console.log(JSON.stringify(value));`
  const view = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', timeout: 5000 }))
  assert.equal(view.status, 'unavailable'); assert.equal(view.sampleCount, null); assert.equal(view.authorization, 'none')
})
test('a synchronous reader that returns after the deadline cannot create a complete observation', async () => {
  const slow = make({ listWorks: () => ({ works: [{ id: 'w', projectId: 'one' }], hasMore: false }), workEvidence: async id => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2100)
    return evidence(id, [entry(id)])
  } })
  const value = await slow.read({})
  assert.equal(value.coverageState, 'partial'); assert.equal(value.sampleCount, null)
  assert.equal(value.status, 'insufficient_data')
})

const token = 'a'.repeat(64), principal = { userId: 'usage-reader', authorityRef: 'usage-reader-authority' }
const http = (reader = make(), overrides = {}) => createLocalHttpApp({ application: {}, principal, apiToken: token,
  bootstrapToken: 'b'.repeat(64), allowedOrigins: ['http://127.0.0.1:4700'], mode: 'personal',
  read: { usageObservation: query => reader.read(query) }, ...overrides })
const get = (app, suffix = '', headers = { authorization: `Bearer ${token}` }) => app.request(`http://127.0.0.1/v1/insights${suffix}`, { headers })
test('actual HTTP authenticates and validates query and returned scope, including restored readonly', async () => {
  assert.equal((await get(http(), '', {})).status, 401)
  assert.equal((await get(http(), '', { authorization: `Bearer ${token}`, origin: 'https://foreign.invalid' })).status, 403)
  for (const query of ['?grant=true', '?days=999', '?timezone=invalid-zone', '?projectId=one&projectId=two'])
    assert.equal((await get(http(), query)).status, 400, query)
  assert.equal((await get(http(), '?projectId=foreign')).status, 403)
  const response = await get(http(undefined, { startupMode: 'recovery_readonly' }), '?projectId=one&days=30&timezone=Asia%2FShanghai')
  assert.equal(response.status, 200); assert.equal(UsageObservationSchema.parse(await response.json()).authorization, 'none')
  const wrong = http({ read: async () => make().read({ projectId: 'two' }) })
  assert.equal((await get(wrong, '?projectId=one')).status, 503)
})

async function until(read, predicate) {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('Controlled product condition timed out')
}
test('real Product/Broker/SQLite/check/acceptance outcomes feed the same readonly API for two projects', { timeout: 60000 }, async () => {
  const root = mkdtempSync('/tmp/pa-usage-product-'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.keep'), '')
  const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'initial'])
  const store = new ProductStore({ path: join(stateRoot, 'db.sqlite') })
  const scope = id => ({ projectId: id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })
  const product = createControlledProduct({ store, principal, stateRoot, scratchProject: projectRoot, actionSecret: Buffer.alloc(32, 9),
    projects: ['one', 'two'].map(id => ({ id, scope: scope(id) })) })
  try {
    product.start(); let sequence = 0
    for (const id of ['one', 'two']) {
      const send = value => product.application.dispatch({ commandId: `usage-${++sequence}`, conversationId: `chat-${id}`, ...value }, { ...principal, source: 'local_cli' })
      const created = await send({ kind: 'create_work', projectId: id, goal: 'Same bounded goal', profileId: 'profile-fixture-question', scope: scope(id),
        criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Fixed output', checkDefinitionRef: FIXTURE_CHECK },
          { id: 'human', kind: 'human', required: true, description: 'Review output' }] })
      assert.equal(created.status, 'recorded')
      const workId = created.workId
      const snapshot = await until(() => product.application.inspect({ workId }), value => value.questions.length === 1)
      const question = snapshot.questions[0]
      assert.equal((await send({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['allow'] } })).status, 'recorded')
      const work = await until(async () => (await product.application.inspect({ workId })).works[0], value => value.actions.available.includes('accept_candidate'))
      assert.equal((await send({ kind: 'accept_candidate', candidate: work.actions.currentCandidate })).status, 'recorded')
    }
    const app = http(undefined, { application: product.application, read: product.read, operations: product.operations })
    const before = store.events.cursor(), all = await (await get(app)).json()
    assert.equal(all.status, 'ready', JSON.stringify(all))
    assert.equal(all.metrics.find(row => row.id.startsWith('outcomes.accepted@')).value, '2')
    assert.equal(all.metrics.find(row => row.id.startsWith('interventions.answers@')).value, '2')
    assert.equal(all.metrics.find(row => row.id.startsWith('usage.inputTokens@')).value, null)
    assert.equal(all.metrics.find(row => row.id.startsWith('outcomes.count@')).layer, 'controlled')
    const one = await (await get(app, '?projectId=one')).json()
    assert.equal(one.metrics.find(row => row.id.startsWith('outcomes.accepted@')).value, '1')
    const repeat = await (await get(app)).json()
    assert.deepEqual(repeat.metrics, all.metrics); assert.equal(store.events.cursor(), before)
  } finally { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) }
})
