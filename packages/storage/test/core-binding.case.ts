/**
 * RFC-01 resolution: `DomainStore` structurally satisfies the public core `Repositories` port.
 * This is the same adapter shape the composition root publishes (apps/coordinator/main.ts);
 * storage never defines parallel domain types, and saves preserve the complete aggregate JSON,
 * including personal completion, with no unknown-field stripping.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Decision, Repositories, Thread, Ticket, Trigger, TriggerDisposition } from '@personal-agent/orchestrator-core'
import { withStore } from './helpers.ts'

test('DomainStore satisfies the public core Repositories port and preserves completion metadata', async () => {
  await withStore(({ store }) => {
    const repositories: Repositories = {
      atomic: operation => store.uow.atomic(() => operation()),
      triggers: {
        get: id => store.domain.triggers.get<Trigger>(id),
        save: value => store.domain.triggers.save({ ...value }),
        disposition: id => store.domain.triggers.disposition<TriggerDisposition>(id),
        saveDisposition: (id, value) => store.domain.triggers.saveDisposition(id, { ...value }),
      },
      threads: {
        get: key => store.domain.threads.get<Thread>(key),
        save: value => store.domain.threads.save({ ...value }),
        list: () => store.domain.threads.list<Thread>(),
        active: () => store.domain.threads.active<Thread>(),
      },
      tickets: {
        get: id => store.domain.tickets.get<Ticket>(id),
        save: value => store.domain.tickets.save({ ...value }),
        list: () => store.domain.tickets.list<Ticket>(),
        open: () => store.domain.tickets.open<Ticket>(),
        active: () => store.domain.tickets.active<Ticket>(),
      },
      decisions: {
        get: id => store.domain.decisions.get<Decision>(id),
        save: value => store.domain.decisions.save({ ...value }),
        byThread: id => store.domain.decisions.byThread<Decision>(id),
      },
    }

    // A Ticket with personal completion metadata and a future field, written through the core port.
    const ticket = {
      id: 'ticket-1', title: 'Deliver', decisionId: 'decision-1',
      mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'addressed', addressed: 'mention' }, actor: { source: 'chat', id: 'alice' }, scope: 's' },
      channels: [], assignments: [], inputs: [], undelivered: [], createdAt: 'now', updatedAt: 'now',
      origin: { triggerId: 'trigger-1', triggerIds: ['trigger-1'] },
      completion: {
        mode: 'personal', candidateGeneration: 2,
        currentCandidate: { assignmentId: 'a1', attemptId: 'attempt-1', candidateGeneration: 2, contract: { workId: 'w1', revision: 1, digest: 'digest' } },
        verificationRef: 'verification-1', humanAcceptanceRef: 'acceptance-1',
      },
      futureField: { kept: true },
    } as unknown as Ticket
    repositories.tickets.save(ticket)
    assert.deepEqual(repositories.tickets.get('ticket-1'), ticket, 'the core port reads back every field, completion included')

    // The core's transactional method runs a synchronous savepoint through the same connection.
    repositories.atomic(() => {
      repositories.triggers.save({
        id: 'trigger-1', source: 'chat', human: true, at: '2026-11-07T00:00:00Z', text: 'hi', meta: {},
        threads: [{ source: 'chat', id: 'thread-1' }], actor: { source: 'chat', id: 'alice' },
      } as unknown as Trigger)
      repositories.threads.save({ key: 'chat:thread-1', ref: { source: 'chat', id: 'thread-1' }, createdAt: 'now', subscriptions: [], correlated: [], pending: [], meta: {} } as unknown as Thread)
    })
    assert.equal(repositories.triggers.get('trigger-1')?.id, 'trigger-1')
    assert.equal(repositories.threads.get('chat:thread-1')?.key, 'chat:thread-1')
  })
})
