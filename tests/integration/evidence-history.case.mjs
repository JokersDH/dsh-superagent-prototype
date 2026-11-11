import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductEvidenceHistory } from '../../apps/coordinator/product/evidence-history.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { actor, createCommand, fixture, scope } from '../../packages/application/test/helpers.ts'

async function setup(t) {
  const h = fixture(t), created = await h.app.dispatch(createCommand('history-work'), actor)
  for (let revision = 1; revision <= 4; revision++) {
    const contract = (await h.app.inspect({ workId: created.workId })).works[0].contract
    await h.app.dispatch({ kind: 'revise_work', commandId: `history-revision-${revision}`, conversationId: 'conversation-main',
      expected: { workId: contract.workId, revision: contract.revision, digest: contract.digest }, goal: `Revision ${revision}`,
      scope, criteria: createCommand().criteria }, actor)
  }
  let now = '2026-11-11T00:00:00.000Z'
  const projects = [scope.projectId]
  const make = () => new ProductEvidenceHistory(h.store, h.app, () => projects, Buffer.alloc(32, 13), () => now)
  let history = make()
  return { get store() { return h.store }, get app() { return h.app }, get history() { return history }, workId: created.workId, projects,
    setNow: value => { now = value }, reopen: () => { h.reopen(); history = make() } }
}

test('real scoped pages are readonly, stable across ties and reopen, and enumerate the observed window', async t => {
  const h = await setup(t), before = h.store.events.cursor(), first = await h.history.read(h.workId, { limit: 2 })
  assert.equal(first.hasMore, true)
  assert.equal(first.window, 'caller_limit')
  assert.equal(first.entries.length, 2)
  h.reopen()
  let page = first, entries = [...first.entries]
  for (let guard = 0; page.nextCursor && guard < 30; guard++) {
    page = await h.history.read(h.workId, { limit: 2, cursor: page.nextCursor })
    entries.push(...page.entries)
  }
  assert.equal(page.hasMore, false)
  assert.equal(page.window, 'complete')
  assert.deepEqual(entries, h.store.workflows.index.timeline({ workId: h.workId, projectIds: h.projects, limit: 500 }).entries)
  assert.equal(h.store.events.cursor(), before)
  assert.equal(new Set(entries.map(value => JSON.stringify([value.at, value.kind, value.sourceRef]))).size, entries.length)
})

test('cursor tampering, another work, changed grant set, expired continuation and new contract all refuse', async t => {
  const h = await setup(t), first = await h.history.read(h.workId, { limit: 1 })
  const forged = first.nextCursor.slice(0, -1) + (first.nextCursor.at(-1) === 'a' ? 'b' : 'a')
  await assert.rejects(h.history.read(h.workId, { cursor: forged }), error => error.error.code === 'conflict')
  const other = await h.app.dispatch(createCommand('other-history-work'), actor)
  await assert.rejects(h.history.read(other.workId, { cursor: first.nextCursor }), error => error.error.code === 'conflict')
  h.projects.push('project-other')
  await assert.rejects(h.history.read(h.workId, { cursor: first.nextCursor }), error => error.error.code === 'conflict')
  h.projects.pop(); h.setNow('2026-11-11T00:06:00.000Z')
  await assert.rejects(h.history.read(h.workId, { cursor: first.nextCursor }), error => error.error.code === 'conflict')
  h.setNow('2026-11-11T00:00:00.000Z')
  const contract = (await h.app.inspect({ workId: h.workId })).works[0].contract
  await h.app.dispatch({ kind: 'revise_work', commandId: 'after-cursor', conversationId: 'conversation-main', expected: {
    workId: h.workId, revision: contract.revision, digest: contract.digest }, goal: 'After cursor', scope, criteria: createCommand().criteria }, actor)
  await assert.rejects(h.history.read(h.workId, { cursor: first.nextCursor }), error => error.error.code === 'conflict')
})

test('actual source cap stays distinct from caller pagination and cannot claim complete', async t => {
  const h = await setup(t), contract = (await h.app.inspect({ workId: h.workId })).works[0].contract
  h.store.uow.atomic(() => {
    for (let index = 0; index < 205; index++) h.store.workflows.routingEvidence.outcomes.put({ protocol: 'execution-outcome/1',
      id: `historical-outcome-${index}`, projectId: scope.projectId,
      attempt: { ticketId: `ticket-${index}`, assignmentId: `assignment-${index}`, contract: { workId: h.workId, revision: contract.revision, digest: contract.digest }, attemptId: `attempt-${index}`, fenceEpoch: 1 },
      profileRef: { profileId: 'profile', revision: 1, identityDigest: 'a'.repeat(64) }, acceptance: 'unknown', evidenceRefs: [],
      layer: 'operator_note', usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: '2026-11-11T00:00:00.000Z' })
  })
  let page = await h.history.read(h.workId, { limit: 100 })
  assert.equal(page.window, 'caller_limit')
  assert.deepEqual(page.sourcesCapped, ['outcomes'])
  for (let guard = 0; page.nextCursor && guard < 10; guard++) page = await h.history.read(h.workId, { limit: 100, cursor: page.nextCursor })
  assert.equal(page.window, 'storage_cap')
  assert.equal(page.hasMore, false)
  assert.deepEqual(page.sourcesCapped, ['outcomes'])
})

test('HTTP history is authenticated and query-bounded, including restored readonly startup', async t => {
  const h = await setup(t), headers = { authorization: `Bearer ${'b'.repeat(64)}` }
  const foreign = await h.app.dispatch({ ...createCommand('foreign-history'), projectId: 'project-other', scope: { ...scope, projectId: 'project-other' } }, actor)
  const before = h.store.events.cursor()
  const api = createLocalHttpApp({ application: h.app, principal: actor, apiToken: 'b'.repeat(64), bootstrapToken: 'a'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', startupMode: 'recovery_readonly',
    read: { workEvidenceHistory: (id, query) => h.history.read(id, query) } })
  const url = `/v1/works/${h.workId}/evidence/history`
  assert.equal((await api.request(url)).status, 401)
  assert.equal((await api.request(`${url}?limit=2`, { headers })).status, 200)
  for (const query of ['limit=101', 'limit=-1', 'actor=forged', 'projectId=foreign'])
    assert.equal((await api.request(`${url}?${query}`, { headers })).status, 400)
  assert.equal((await api.request('/v1/works/missing-work/evidence/history', { headers })).status, 400)
  assert.equal((await api.request(`/v1/works/${foreign.workId}/evidence/history`, { headers })).status, 403)
  assert.equal(h.store.events.cursor(), before)
})
