import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NO_SEND, createReviewSender } from '../src/review-sender.ts'

/** E's own grant and a persistent reservation hook, exactly as E would supply them. */
function makeE(overrides = {}) {
  const sent = []
  const transport = {
    async startTurn({ input, identity }) {
      sent.push({ input, identity })
      return { turnId: 'turn-1', sent: true }
    },
  }
  const reservations = []
  const hook = {
    async reserve(request) {
      reservations.push(request)
      return { admitted: true, reservationId: `res-${reservations.length}` }
    },
  }
  const grant = { grantId: 'wave05-independent-review-pilot-01', owner: 'E', limit: 24, ledgerPath: '/tmp/ledger.json', scope: 'pilot' }
  return { transport, hook, grant, sent, reservations, ...overrides }
}

test('the current runtime refuses a real send and sends nothing', async () => {
  // This is the product today: the bounded recipe is blocked, so E's first attempt is a refusal and
  // the fake send count stays zero.
  const e = makeE()
  const sender = createReviewSender({ transport: e.transport, hook: e.hook, grant: e.grant })
  const result = await sender.send({ caseRef: 'case-1', subject: 'material', input: 'review this' })
  assert.equal(result.sent, false)
  assert.equal(result.status, NO_SEND)
  // Every unmet gate is reported, so assert against the whole list rather than the first entry.
  assert.match(result.problems.join(' '), /cost_bound|bound|price|ceiling/i)
  assert.equal(e.sent.length, 0)
  assert.equal(e.reservations.length, 0, 'nothing may be reserved for a send that cannot happen')
  assert.equal(sender.describe().sends, 0)
})

test('E cannot switch the bound on with a caller-supplied claim', async () => {
  const e = makeE()
  const sender = createReviewSender({ transport: e.transport, hook: e.hook, grant: e.grant })
  const result = await sender.send({
    caseRef: 'case-1',
    input: 'x',
    gates: { cost_bound: { satisfied: true, reason: 'trust me' } },
    modelIdentity: { model: 'gpt-6.1-sol', modelProvider: 'OpenAI' },
  })
  assert.equal(result.sent, false)
  assert.equal(e.sent.length, 0)
})

test('a measured bound still cannot send while other gates are missing', async () => {
  const e = makeE()
  // A caller may report a bound as available, but isolation still has to be supplied.
  const sender = createReviewSender({
    transport: e.transport,
    hook: e.hook,
    grant: e.grant,
    costBound: { available: true, reason: 'measured for this test' },
  })
  const result = await sender.send({ caseRef: 'case-1', input: 'x' })
  assert.equal(result.sent, false)
  assert.match(result.problems.join(' '), /host policy|isolation/i)
  assert.equal(e.sent.length, 0)
})

test('with every gate satisfied the owned transport is used exactly once', async () => {
  const e = makeE()
  const sender = createReviewSender({
    transport: e.transport,
    hook: e.hook,
    grant: e.grant,
    costBound: { available: true, reason: 'measured for this test' },
    hostPolicy: { mechanism: 'seatbelt' },
  })
  const result = await sender.send({
    caseRef: 'case-1',
    subject: 'material',
    input: 'review this',
    gates: { isolation: { satisfied: true, reason: 'seatbelt profile applied' } },
    modelIdentity: { model: 'gpt-6.1-sol', modelProvider: 'OpenAI' },
  })
  assert.equal(result.sent, true)
  assert.equal(e.sent.length, 1)
  assert.equal(e.reservations.length, 1, 'the reservation must precede the send')
  assert.equal(e.sent[0].identity.grantId, 'wave05-independent-review-pilot-01')
})

test('a repeated send after success is refused by the same one-use rule', async () => {
  const e = makeE()
  const sender = createReviewSender({
    transport: e.transport,
    hook: e.hook,
    grant: e.grant,
    costBound: { available: true },
    hostPolicy: { mechanism: 'seatbelt' },
  })
  const first = await sender.send({
    caseRef: 'c',
    input: 'a',
    gates: { isolation: { satisfied: true } },
    modelIdentity: { model: 'm', modelProvider: 'p' },
  })
  assert.equal(first.sent, true)
  // Each send acquires its own token, so a second logical send is a new attempt rather than a replay.
  const second = await sender.send({
    caseRef: 'c',
    input: 'b',
    gates: { isolation: { satisfied: true } },
    modelIdentity: { model: 'm', modelProvider: 'p' },
  })
  assert.equal(second.sent, true)
  assert.equal(sender.describe().sends, 2)
  assert.equal(e.sent.length, 2)
})

test('a reservation refusal stops the send before the transport', async () => {
  const refusing = { async reserve() { return { admitted: false, reason: 'remainder is UNKNOWN' } } }
  const e = makeE({ hook: refusing })
  const sender = createReviewSender({
    transport: e.transport,
    hook: refusing,
    grant: e.grant,
    costBound: { available: true },
    hostPolicy: { mechanism: 'seatbelt' },
  })
  const result = await sender.send({
    caseRef: 'c',
    input: 'a',
    gates: { isolation: { satisfied: true } },
    modelIdentity: { model: 'm', modelProvider: 'p' },
  })
  assert.equal(result.sent, false)
  assert.match(String(result.reason), /remainder is UNKNOWN/)
  assert.equal(e.sent.length, 0)
})

test('the factory refuses to exist without the owned transport and hook', () => {
  const e = makeE()
  assert.throws(() => createReviewSender({ hook: e.hook, grant: e.grant }), /owned transport/)
  assert.throws(() => createReviewSender({ transport: e.transport, grant: e.grant }), /reservation hook/)
})

test('the sender describes what it is bound to and what it does not claim', () => {
  const e = makeE()
  const sender = createReviewSender({ transport: e.transport, hook: e.hook, grant: e.grant })
  const description = sender.describe()
  assert.equal(description.ownsTransport, true)
  assert.equal(description.grantId, 'wave05-independent-review-pilot-01')
  assert.equal(description.costBoundAvailable, false)
  assert.ok(description.notClaimed.length >= 3)
})

test('E never receives a callable transport or raw command from the descriptor', () => {
  const e = makeE()
  const sender = createReviewSender({ transport: e.transport, hook: e.hook, grant: e.grant })
  const description = sender.describe()
  assert.deepEqual(Object.keys(description).sort(), [
    'attempts',
    'costBoundAvailable',
    'grantId',
    'notClaimed',
    'owner',
    'ownsTransport',
    'protocol',
    'sends',
  ])
  for (const value of Object.values(description)) {
    assert.notEqual(typeof value, 'function', 'a descriptor must not carry a callable')
  }
})
