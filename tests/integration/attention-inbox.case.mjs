import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fixture, actor, createCommand, scope } from '../../packages/application/test/helpers.ts'
import { ProductAttention } from '../../apps/coordinator/product/attention.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const now = '2026-11-08T10:00:00.000Z'
const completion = { metadata: () => undefined, current: () => undefined }
const read = (h, options = {}) => new ProductAttention(h.store, h.app, completion, {
  projectIds: () => ['project-atlas', 'project-other'],
  verification: work => ({ protocol: 'work-verification/1', workId: work.work.id, state: 'not_ready', retryAvailable: false }),
  now: () => now, ...options,
})
async function question(h, id, projectId = scope.projectId, conversationId = `conversation-${id}`) {
  const created = await h.app.dispatch({ ...createCommand(`create-${id}`), projectId, conversationId,
    scope: { ...scope, projectId }, goal: `Work ${id}` }, actor)
  const active = await h.start(created.workId)
  const value = { id, version: 1, kind: 'clarification', contract: active.ref.contract,
    scope: { ...scope, projectId }, prompt: `Question ${id}`, nativePayloadRef: `raw-${id}`,
    targets: [{ ...active.ref, attemptId: active.binding.attemptId, fenceEpoch: 1,
      id: `binding-${id}`, connectionEpoch: 1, nativeRequestId: { kind: 'string', value: id },
      nativeMethod: 'tool/input', provenanceRef: `provenance-${id}` }],
    presentation: { kind: 'free_text' }, validity: 'open', openedAt: '2026-11-08T09:00:00.000Z' }
  h.app.questions.open(value)
  return { created, active, value }
}
test('attention reads authorized projects and original conversations without producing effects', async t => {
  const h = fixture(t), one = await question(h, 'question-one'), two = await question(h, 'question-two', 'project-other')
  const cursor = h.store.events.cursor(), reader = read(h), page = await reader.read({})
  assert.equal(page.items.length, 2)
  assert.deepEqual(new Set(page.items.map(item => item.projectId)), new Set(['project-atlas', 'project-other']))
  assert.equal(page.items.find(item => item.questionId === one.value.id).conversationId, 'conversation-question-one')
  assert.ok(page.items.some(item => item.questionId === two.value.id))
  assert.equal(page.ranking, 'waiting_order')
  assert.equal(h.store.events.cursor(), cursor, 'A read cannot enqueue work, answer questions or create receipts')
  await assert.rejects(reader.read({ projectId: 'not-authorized' }), error => error.error.code === 'forbidden')
  const single = await reader.read({ projectId: 'project-other' })
  assert.equal(single.items.length, 1)
  assert.equal(single.items[0].projectId, 'project-other')
})
test('per-work questions are not starved by another project and expiry is separate from business deadline', async t => {
  const h = fixture(t), one = await question(h, 'question-one'), two = await question(h, 'question-two', 'project-other')
  const deadlineQuestion = { ...one.value, id: 'explicit-deadline', openedAt: '2026-11-08T09:01:00.000Z',
    decisionDeadline: '2026-11-08T09:30:00.000Z', expiresAt: '2026-11-08T11:00:00.000Z' }
  h.store.product.questions.insert(deadlineQuestion)
  h.store.product.questions.insert({ ...one.value, id: 'expired-question', expiresAt: '2026-11-08T09:59:00.000Z' })
  for (let i = 0; i < 201; i++) h.store.product.questions.insert({ ...two.value, id: `recent-question-${i}`, openedAt: '2026-11-08T09:59:00.000Z' })
  const page = await read(h).read({})
  assert.ok(page.items.some(item => item.questionId === one.value.id))
  assert.ok(!page.items.some(item => item.questionId === 'expired-question'))
  const item = page.items.find(item => item.questionId === 'explicit-deadline')
  assert.equal(item.deadlineAt, deadlineQuestion.decisionDeadline)
  assert.equal(item.expiresAt, deadlineQuestion.expiresAt)
  assert.equal(page.questionCoverage, 'bounded')
  assert.equal(page.items.find(item => item.questionId === one.value.id).deadlineAt, null)
  const revised = await h.app.dispatch({ commandId: 'revise-question-one', conversationId: 'conversation-question-one', kind: 'revise_work',
    expected: one.value.contract, goal: 'A new contract', scope, criteria: createCommand().criteria }, actor)
  assert.equal(revised.status, 'recorded')
  assert.ok(!(await read(h).read({})).items.some(item => item.questionId === one.value.id))
})
test('work pagination is explicit, and unknown wait ties are stable without inventing deadlines', async t => {
  const h = fixture(t)
  const created = []
  for (let i = 0; i < 3; i++) {
    const receipt = await h.app.dispatch(createCommand(`paused-${i}`), actor)
    const view = (await h.app.inspect({ workId: receipt.workId })).works[0]
    created.push(receipt.workId)
    await h.app.dispatch({ kind: 'pause_dispatch', commandId: `pause-${i}`, conversationId: 'conversation-main',
      expected: view.actions.currentAssignment.contract, expectedHoldRevision: 0 }, actor)
  }
  const reader = read(h), all = await reader.read({})
  assert.deepEqual(all.ranks.map(rank => rank.id), all.items.map(item => item.id).sort((a, b) => a.localeCompare(b)))
  assert.ok(all.items.every(item => item.sinceAt === null && item.deadlineAt === null))
  let cursor, scanned = 0
  const seen = new Set()
  do {
    const page = await reader.read({ limit: 1, ...(cursor ? { cursor } : {}) })
    scanned += page.scannedWorks
    for (const item of page.items) { assert.ok(!seen.has(item.contract.workId)); seen.add(item.contract.workId) }
    assert.equal(page.hasMore, !!page.nextCursor)
    cursor = page.nextCursor
  } while (cursor)
  assert.equal(scanned, 3)
  assert.deepEqual(seen, new Set(created))
  await assert.rejects(reader.read({ cursor: 'not-a-real-cursor' }), error => error.error.code === 'invalid_request')
})
test('optional priority rule cannot omit or fabricate a source item', async t => {
  const h = fixture(t)
  await question(h, 'question-one')
  await assert.rejects(read(h, { ranker: () => [] }).read({}))
  const page = await read(h, { ranker: ({ items }) => items.map(item => ({ id: item.id, reasons: ['waiting_age'] })) }).read({})
  assert.equal(page.ranking, 'deterministic_priority')
})
test('HTTP attention requires local credentials and rejects actor/query injection, including recovery reads', async t => {
  const h = fixture(t)
  await question(h, 'question-one')
  const reader = read(h), options = { application: h.app, principal: actor, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'product', startupMode: 'recovery_readonly', read: { attention: query => reader.read(query) } }
  const http = createLocalHttpApp(options), headers = { authorization: `Bearer ${'a'.repeat(64)}` }
  assert.equal((await http.request('http://127.0.0.1/v1/attention')).status, 401)
  assert.equal((await http.request('http://127.0.0.1/v1/attention?actor=forged', { headers })).status, 400)
  assert.equal((await http.request('http://127.0.0.1/v1/attention?limit=0', { headers })).status, 400)
  assert.equal((await http.request('http://127.0.0.1/v1/attention?projectId=unconfigured', { headers })).status, 403)
  const before = h.store.events.cursor()
  const response = await http.request('http://127.0.0.1/v1/attention?limit=1', { headers })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).items.length, 1)
  assert.equal(h.store.events.cursor(), before)
})
