import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ApplicationFault, createProductApplication } from '@personal-agent/application'
import { actor, createCommand, fixture, scope } from './helpers.ts'

test('preflight is read-only and outside UOW; opaque command snapshots cannot be forged or moved', async t => {
  const h = fixture(t)
  let preflights = 0
  const app = createProductApplication({ store: h.store, principal: actor, projects: [{ id: scope.projectId, scope }],
    profileIds: ['profile-codex-local'], registeredChecks: ['check:unit'], actionSecret: Buffer.alloc(32, 1), nativeFence: () => 'unknown',
    projectPreflight: async () => { assert.equal(h.store.uow.nesting, 0); preflights++ } })
  const input = structuredClone(createCommand('prepared-work')), prepared = await app.prepareCommand(input, actor)
  assert.equal(preflights, 1)
  assert.equal(h.store.events.cursor(), 0)
  assert.equal(h.store.commands.get(input.commandId), undefined)
  assert.throws(() => app.commitPrepared(prepared), /caller UnitOfWork/)
  assert.throws(() => h.store.uow.atomic(() => app.commitPrepared({ ...prepared })), /another application or was copied/)
  assert.throws(() => h.store.uow.atomic(() => h.app.commitPrepared(prepared)), /another application or was copied/)
  input.goal = 'Mutated after prepare'
  input.scope = { ...input.scope, allowedPaths: [...input.scope.allowedPaths, 'unconfirmed/'] }
  const receipt = h.store.uow.atomic(() => app.commitPrepared(prepared))
  assert.equal(receipt.status, 'recorded')
  const view = (await app.inspect({ workId: receipt.workId! })).works[0]!
  assert.equal(view.contract.goal, 'Implement the requested change')
  assert.deepEqual(view.contract.scope.allowedPaths, ['src/'])
  assert.deepEqual(h.store.uow.atomic(() => app.commitPrepared(prepared)), receipt)
  assert.equal(h.store.domain.tickets.list().length, 1)
})

test('caller rollback includes core, queue, receipts and participant changes', async t => {
  const h = fixture(t), command = createCommand('outer-rollback'), prepared = await h.app.prepareCommand(command, actor)
  assert.throws(() => h.store.uow.atomic(() => {
    h.store.commands.record('participant', 'a'.repeat(64), () => ({ confirmed: true }))
    assert.equal(h.app.commitPrepared(prepared).status, 'recorded')
    throw new Error('participant failed')
  }), /participant failed/)
  assert.equal(h.store.commands.get('participant'), undefined)
  assert.equal(h.store.commands.get(command.commandId), undefined)
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.equal(h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 20).length, 0)
  assert.equal(h.store.events.cursor(), 0)
  const receipt = h.store.uow.atomic(() => h.app.commitPrepared(prepared))
  h.reopen()
  assert.deepEqual(await h.app.dispatch(command, actor), receipt)
})

test('commit rechecks current policy and a composer can roll back its participant on rejection', async t => {
  const h = fixture(t)
  let allowed = true
  const app = createProductApplication({ store: h.store, principal: actor, projects: [{ id: scope.projectId, scope }],
    profileIds: ['profile-codex-local'], registeredChecks: ['check:unit'], actionSecret: Buffer.alloc(32, 1), nativeFence: () => 'unknown',
    projectGrant: () => { if (!allowed) throw new ApplicationFault('forbidden', 'Grant changed') } })
  const prepared = await app.prepareCommand(createCommand('changed-grant'), actor)
  allowed = false
  assert.throws(() => h.store.uow.atomic(() => {
    h.store.commands.record('participant', 'a'.repeat(64), () => ({ confirmed: true }))
    const receipt = app.commitPrepared(prepared)
    if (receipt.status === 'rejected') throw new ApplicationFault(receipt.error.code, receipt.error.message)
  }), /Grant changed/)
  assert.equal(h.store.commands.get('participant'), undefined)
  assert.equal(h.store.commands.get(prepared.commandId), undefined)
  assert.equal(h.store.product.works.listByProject(scope.projectId).length, 0)
})

test('expired handles reject without effects, while committed receipt replay remains stable', async t => {
  const h = fixture(t), command = createCommand('expired'), prepared = await h.app.prepareCommand(command, actor)
  h.setNow('2026-11-08T10:06:00.000Z')
  const receipt = h.store.uow.atomic(() => h.app.commitPrepared(prepared))
  assert.equal(receipt.status, 'rejected')
  if (receipt.status === 'rejected') assert.equal(receipt.error.code, 'stale_contract')
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.deepEqual(h.store.uow.atomic(() => h.app.commitPrepared(prepared)), receipt)
  let nested: ReturnType<typeof h.app.prepareCommand> | undefined
  h.store.uow.atomic(() => { nested = h.app.prepareCommand(createCommand('nested-prepare'), actor) })
  await assert.rejects(nested!, /outer commit/)
})
