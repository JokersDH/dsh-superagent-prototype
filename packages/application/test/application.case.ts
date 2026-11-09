import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ticket } from '@personal-agent/orchestrator-core'
import { completionCriteriaDigest } from '@personal-agent/orchestrator-core'
import { createProductApplication } from '@personal-agent/application'
import { actor, contractRef, createCommand, fixture, scope } from './helpers.ts'

test('mutating startup profile, check or principal objects cannot expand application authority', async (t) => {
  const h = fixture(t)
  const profileIds = ['profile-codex-local'],
    registeredChecks = ['check:unit'],
    principal = { userId: actor.userId, authorityRef: actor.authorityRef }
  const application = createProductApplication({
    store: h.store,
    principal,
    projects: [{ id: scope.projectId, scope }],
    profileIds,
    registeredChecks,
    actionSecret: Buffer.alloc(32, 1),
    nativeFence: () => 'unknown',
  })
  profileIds.push('profile-forged')
  registeredChecks.push('check-forged')
  principal.userId = 'forged-user'
  assert.equal(
    (await application.dispatch({ ...createCommand('forged-profile'), profileId: 'profile-forged' }, actor)).status,
    'rejected',
  )
  assert.equal(
    (
      await application.dispatch(
        {
          ...createCommand('forged-check'),
          criteria: [
            {
              id: 'forged',
              kind: 'machine',
              required: true,
              description: 'Forged check',
              checkDefinitionRef: 'check-forged',
            },
          ],
        },
        actor,
      )
    ).status,
    'rejected',
  )
  await assert.rejects(
    application.dispatch(createCommand('forged-actor'), { ...actor, userId: 'forged-user' }),
    /configured local principal/,
  )
  assert.equal((await application.dispatch(createCommand('original-config'), actor)).status, 'recorded')
})

test('create is one real core lifecycle, persisted product records and queued effects; reopen replays the original receipt', async (t) => {
  const h = fixture(t),
    command = createCommand(),
    receipt = await h.app.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded')
  assert.ok(receipt.workId)
  const snapshot = await h.app.inspect({ conversationId: command.conversationId })
  assert.equal(snapshot.works.length, 1)
  assert.equal(snapshot.works[0]!.phase, 'queued')
  assert.equal(snapshot.conversation!.messages.length, 1)
  assert.equal(h.store.domain.tickets.list().length, 1)
  assert.equal(h.store.queue.dueRows('application.execute', 0, 20).length, 1)
  h.reopen()
  assert.deepEqual(await h.app.dispatch(command, actor), receipt)
  assert.equal(h.store.domain.tickets.list().length, 1)
  assert.equal((await h.app.inspect({ conversationId: command.conversationId })).conversation!.messages.length, 1)
})
test('unauthorized actor, changed command body and unregistered machine checks cannot grant execution', async (t) => {
  const h = fixture(t),
    command = createCommand()
  await assert.rejects(h.app.dispatch(command, { ...actor, userId: 'model' }), /configured local principal/)
  assert.equal(h.store.domain.tickets.list().length, 0)
  const invalid = await h.app.dispatch({ ...command, profileId: 'unknown-profile' }, actor)
  assert.equal(invalid.status, 'rejected')
  assert.equal(h.store.product.works.get('unknown'), undefined)
  assert.equal(h.store.domain.tickets.list().length, 0)
  await assert.rejects(h.app.dispatch(command, actor), /another immutable request/)
  const missing = await h.app.dispatch(
    {
      ...createCommand('bad-check'),
      criteria: [
        { id: 'test', kind: 'machine', description: 'Check', required: true, checkDefinitionRef: 'unregistered' },
      ],
    },
    actor,
  )
  assert.equal(missing.status, 'rejected')
})
test('last receipt failure rolls core, product index, messages, events and queued execution back together', async (t) => {
  const h = fixture(t)
  h.store.db.exec(
    "CREATE TRIGGER fail_app_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, 'receipt failure'); END",
  )
  await assert.rejects(h.app.dispatch(createCommand(), actor), /receipt failure/)
  assert.equal(h.store.domain.tickets.list().length, 0)
  assert.equal(h.store.product.works.listByProject(scope.projectId).length, 0)
  assert.equal(h.store.product.messages.page('conversation-main').messages.length, 0)
  assert.equal(h.store.events.cursor(), 0)
  assert.equal(h.store.queue.dueRows('application.execute', 0, 20).length, 0)
})
test('discussion never creates work; explicit anchored supplement reaches only its original work and invalidates the candidate', async (t) => {
  const h = fixture(t)
  await h.app.dispatch(
    {
      kind: 'chat',
      commandId: 'discussion',
      conversationId: 'conversation-main',
      projectId: scope.projectId,
      text: 'Can we explore this?',
    },
    actor,
  )
  assert.equal(h.store.domain.tickets.list().length, 0)
  const a = await h.app.dispatch(createCommand(), actor),
    b = await h.app.dispatch(createCommand('other-work'), actor)
  const active = await h.start(a.workId!)
  h.app.core.reportAssignment(active.ref.ticketId, active.ref.assignmentId, { state: 'ready', summary: 'Ready' })
  assert.ok(h.app.core.completionCandidate(active.ref.ticketId))
  const beforeB = (await h.app.inspect({ workId: b.workId! })).works[0]!.actions.currentAssignment!
  const inputsB = h.store.domain.tickets.get<Ticket>(beforeB.ticketId)!.inputs.length
  await h.app.dispatch(
    {
      kind: 'chat',
      commandId: 'supplement',
      conversationId: 'conversation-main',
      projectId: scope.projectId,
      anchor: { workId: a.workId! },
      text: 'Also cover this case',
    },
    actor,
  )
  assert.equal(h.app.core.completionCandidate(active.ref.ticketId), undefined)
  assert.equal(h.store.domain.tickets.get<Ticket>(beforeB.ticketId)!.inputs.length, inputsB)
  const wrong = await h.app.dispatch(
    {
      kind: 'chat',
      commandId: 'wrong-project',
      conversationId: 'conversation-main',
      projectId: 'project-other',
      anchor: { workId: a.workId! },
      text: 'Wrong context',
    },
    actor,
  )
  assert.equal(wrong.status, 'rejected')
})
test('stop is logical first and schedules physical reconciliation; late chat cannot resume stopped work', async (t) => {
  const h = fixture(t),
    created = await h.app.dispatch(createCommand(), actor),
    active = await h.start(created.workId!)
  const stopped = await h.app.dispatch(
    { kind: 'stop_work', commandId: 'stop', conversationId: 'conversation-main', workId: created.workId! },
    actor,
  )
  assert.equal(stopped.status, 'recorded')
  assert.equal(h.store.domain.tickets.get<Ticket>(active.ref.ticketId)!.ended!.outcome, 'stopped')
  assert.equal(h.store.bindings.current(active.ref.ticketId)!.state, 'stopping')
  assert.equal((await h.app.inspect({ workId: created.workId! })).works[0]!.phase, 'stopping')
  assert.equal(h.store.queue.dueRows('runtime.reconcile', 0, 20).length, 1)
  const late = await h.app.dispatch(
    {
      kind: 'chat',
      commandId: 'late',
      conversationId: 'conversation-main',
      projectId: scope.projectId,
      anchor: { workId: created.workId! },
      text: 'Old late message',
    },
    actor,
  )
  assert.equal(late.status, 'rejected')
})
test('revision preserves work identity and old records, revokes the previous grant and shows switching while its writer is live', async (t) => {
  const h = fixture(t),
    created = await h.app.dispatch(createCommand(), actor),
    active = await h.start(created.workId!)
  const before = (await h.app.inspect({ workId: created.workId! })).works[0]!
  const changed = await h.app.dispatch(
    {
      kind: 'revise_work',
      commandId: 'revise',
      conversationId: 'conversation-main',
      expected: contractRef(before.contract),
      goal: 'Updated requirement',
      scope,
      criteria: before.contract.criteria,
    },
    actor,
  )
  assert.equal(changed.status, 'recorded')
  assert.equal(changed.workId, created.workId)
  const after = (await h.app.inspect({ workId: created.workId! })).works[0]!
  assert.equal(after.contract.revision, 2)
  assert.equal(after.phase, 'switching')
  assert.equal(h.store.authority.isCurrent(before.contract), false)
  assert.equal(h.store.domain.tickets.get<Ticket>(active.ref.ticketId)!.completion!.retired !== undefined, true)
  assert.equal(h.store.product.contracts.history(created.workId!).length, 2)
  const original = h.store.product.messages.page('conversation-main').messages[0]!
  const late = await h.app.dispatch(
    {
      kind: 'chat',
      commandId: 'reply-old-revision',
      conversationId: 'conversation-main',
      projectId: scope.projectId,
      anchor: { messageId: original.id },
      text: 'Old anchored reply',
    },
    actor,
  )
  assert.equal(late.status, 'rejected')
})
test('pause uses CAS, changes only future dispatch and rejects stale revisions', async (t) => {
  const h = fixture(t),
    created = await h.app.dispatch(createCommand(), actor),
    active = await h.start(created.workId!)
  const view = (await h.app.inspect({ workId: created.workId! })).works[0]!
  const pause = {
    kind: 'pause_dispatch' as const,
    commandId: 'pause',
    conversationId: 'conversation-main',
    expected: contractRef(view.contract),
    expectedHoldRevision: 0,
  }
  assert.equal((await h.app.dispatch(pause, actor)).status, 'recorded')
  assert.equal(h.store.bindings.current(active.ref.ticketId)!.state, 'active')
  assert.equal((await h.app.dispatch({ ...pause, commandId: 'stale-pause' }, actor)).status, 'rejected')
  assert.equal((await h.app.inspect({ workId: created.workId! })).works[0]!.actions.dispatchHold.revision, 1)
})
test('retry action token fences the current assignment and old writers; successful retry invalidates the old token', async (t) => {
  const h = fixture(t),
    created = await h.app.dispatch(createCommand(), actor),
    active = await h.start(created.workId!)
  h.app.core.reportAssignment(active.ref.ticketId, active.ref.assignmentId, { state: 'failed', summary: 'Needs retry' })
  const live = (await h.app.inspect({ workId: created.workId! })).works[0]!
  assert.equal(live.actions.available.includes('retry_assignment'), false)
  h.store.bindings.end(active.binding.attemptId)
  const view = (await h.app.inspect({ workId: created.workId! })).works[0]!
  const retry = {
    kind: 'retry_assignment' as const,
    commandId: 'retry',
    conversationId: 'conversation-main',
    expected: view.actions.currentAssignment!,
    actionToken: view.actions.retryActionToken!,
  }
  assert.equal((await h.app.dispatch(retry, actor)).status, 'recorded')
  assert.equal((await h.app.dispatch({ ...retry, commandId: 'old-token' }, actor)).status, 'rejected')
})
test('only current trusted verification can complete a candidate; machine failure is not overridden by acceptance', async (t) => {
  const h = fixture(t),
    created = await h.app.dispatch(createCommand(), actor),
    active = await h.start(created.workId!)
  h.app.core.reportAssignment(active.ref.ticketId, active.ref.assignmentId, { state: 'ready', summary: 'Ready' })
  const candidate = h.app.core.completionCandidate(active.ref.ticketId)!,
    artifactDigest = 'b'.repeat(64)
  h.store.bindings.end(active.binding.attemptId)
  const verification = {
    ...candidate,
    id: 'verification-1',
    artifactDigest,
    criteriaDigest: completionCriteriaDigest(createCommand().criteria),
    environmentRef: 'env-1',
    verifierIdentityRef: 'trusted-fixture',
    results: [{ criterionId: 'unit', outcome: 'FAIL' as const, evidenceRefs: ['evidence-1'] }],
  }
  const proposal = { ...candidate, artifactDigest, verificationId: verification.id }
  h.reviews.set(verification.id, { proposal, verification, artifactIds: [] })
  const accept = {
    kind: 'accept_candidate' as const,
    commandId: 'accept-fail',
    conversationId: 'conversation-main',
    candidate,
  }
  assert.equal((await h.app.dispatch(accept, actor)).status, 'rejected')
  assert.equal(h.store.domain.tickets.get<Ticket>(active.ref.ticketId)!.ended, undefined)
  h.reviews.set(verification.id, {
    proposal,
    verification: { ...verification, results: [{ ...verification.results[0]!, outcome: 'PASS' }] },
    artifactIds: [],
  })
  assert.equal((await h.app.dispatch({ ...accept, commandId: 'accept-pass' }, actor)).status, 'recorded')
  assert.equal((await h.app.inspect({ workId: created.workId! })).works[0]!.phase, 'delivered')
})
test('stream exposes only public notifications, handles future cursor and closes while idle', async (t) => {
  const h = fixture(t),
    iterator = h.app.changes(0)[Symbol.asyncIterator]()
  h.store.events.append({ topic: 'private.secret', entityRef: 'private', payload: { token: 'never-public' } })
  await h.app.dispatch(createCommand(), actor)
  const first = await iterator.next()
  assert.equal(first.done, false)
  assert.equal(first.value.topic, 'application.work.changed')
  assert.equal(JSON.stringify(first).includes('never-public'), false)
  await iterator.return!()
  assert.equal((await iterator.next()).done, true)
  assert.throws(() => h.app.changes(h.store.events.cursor() + 1), /outside the current history/)
  const idle = h.app.changes(h.store.events.cursor())[Symbol.asyncIterator](),
    pending = idle.next()
  await idle.return!()
  assert.equal((await pending).done, true)
})
test('scope expiry removes execution actions while deterministic stop remains available', async (t) => {
  const h = fixture(t),
    command = createCommand()
  const created = await h.app.dispatch(
    { ...command, scope: { ...scope, expiresAt: '2026-11-08T11:00:00.000Z' } },
    actor,
  )
  h.setNow('2026-11-08T12:00:00.000Z')
  const view = (await h.app.inspect({ workId: created.workId! })).works[0]!
  assert.deepEqual(view.actions.available, ['stop_work'])
  assert.equal(view.phase, 'uncertain')
  const resumed = await h.app.dispatch(
    {
      kind: 'resume_dispatch',
      commandId: 'expired-resume',
      conversationId: 'conversation-main',
      expected: contractRef(view.contract),
      expectedHoldRevision: 0,
    },
    actor,
  )
  assert.equal(resumed.status, 'rejected')
  assert.equal(
    (
      await h.app.dispatch(
        { kind: 'stop_work', commandId: 'expired-stop', conversationId: 'conversation-main', workId: created.workId! },
        actor,
      )
    ).status,
    'recorded',
  )
})
