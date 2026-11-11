import assert from 'node:assert/strict'
import { test } from 'node:test'
import { admitSend, consumeSendToken, isIssuedToken } from '../src/send-admission.ts'

/** A complete, satisfiable request. E's grant is used to prove the path is not B-specific. */
function request(overrides = {}) {
  return {
    grant: {
      grantId: 'wave05-independent-review-pilot-01',
      owner: 'E',
      limit: 24,
      scope: 'bounded native review pilot',
      ledgerPath: '/tmp/ledger.json',
    },
    gates: {
      model_identity: { satisfied: true, evidence: { model: 'gpt-6.1-sol', modelProvider: 'OpenAI' } },
      cost_bound: { satisfied: true, evidence: { bound: 'test fixture' } },
      isolation: { satisfied: true, evidence: { mechanism: 'seatbelt' } },
      reservation: { satisfied: true },
    },
    hook: { reserve: async () => ({ admitted: true, reservationId: 'r-1' }) },
    caseRef: 'case-1',
    turn: 1,
    ...overrides,
  }
}

const fakeTransport = (behaviour = {}) => {
  const calls = []
  return {
    calls,
    async startTurn({ input, identity }) {
      calls.push({ input, identity })
      if (behaviour.throw) throw new Error('transport exploded')
      return { turnId: 'turn-1', sent: true }
    },
  }
}

test('no grant identity is refused rather than defaulted to a role grant', () => {
  // The original defect: admission always audited B's grant. Nothing may default now.
  const result = admitSend(request({ grant: undefined }))
  assert.equal(result.verdict, 'REFUSED')
  assert.match(result.refusal.problems.join(' '), /never defaults to a role-owned grant/)
})

test('a partial grant identity is refused with every missing field named', () => {
  const result = admitSend(request({ grant: { grantId: 'x' } }))
  assert.equal(result.verdict, 'REFUSED')
  const problems = result.refusal.problems.join(' ')
  assert.match(problems, /owner is required/)
  assert.match(problems, /limit must be a positive integer/)
  assert.match(problems, /ledgerPath is required/)
})

test("E's grant is admitted on the same path as B's", () => {
  // Same function, same gates, different grant: this is what makes it one chain rather than two.
  const result = admitSend(request())
  assert.equal(result.verdict, 'ADMITTED')
  assert.equal(result.token.owner, 'E')
  assert.equal(result.token.grantId, 'wave05-independent-review-pilot-01')
  assert.equal(isIssuedToken(result.token), true)
})

test('a refused result carries no token and nothing executable', () => {
  const result = admitSend(request({ gates: { ...request().gates, cost_bound: { satisfied: false, reason: 'no price surface' } } }))
  assert.equal(result.verdict, 'REFUSED')
  assert.equal(result.token, null)
  assert.equal(result.launch, null)
  assert.equal(result.consumable, false)
  // No function of any kind may hang off a refusal.
  assert.equal(typeof result.consumable, 'boolean')
})

test('an absent gate is refused, not treated as passed', () => {
  const gates = request().gates
  delete gates.cost_bound
  const result = admitSend(request({ gates }))
  assert.equal(result.verdict, 'REFUSED')
  assert.match(result.refusal.problems.join(' '), /was not supplied, so it cannot be treated as passed/)
})

test('a gate without an explicit boolean is refused', () => {
  const result = admitSend(request({ gates: { ...request().gates, isolation: { evidence: { mechanism: 'x' } } } }))
  assert.equal(result.verdict, 'REFUSED')
  assert.match(result.refusal.problems.join(' '), /did not state satisfied as a boolean/)
})

test('model identity cannot be claimed without values', () => {
  const result = admitSend(
    request({ gates: { ...request().gates, model_identity: { satisfied: true, evidence: { model: '', modelProvider: '' } } } }),
  )
  assert.equal(result.verdict, 'REFUSED')
  assert.match(result.refusal.problems.join(' '), /no model\/provider values were supplied/)
})

test('a missing reservation hook is refused', () => {
  const result = admitSend(request({ hook: undefined }))
  assert.equal(result.verdict, 'REFUSED')
  assert.match(result.refusal.problems.join(' '), /must reserve before it is sent/)
})

test('a string descriptor cannot authorise a send', () => {
  const transport = fakeTransport()
  return consumeSendToken('{"verdict":"ADMITTED","grantId":"x"}', { transport, hook: { reserve: async () => ({ admitted: true }) } }).then(result => {
    assert.equal(result.sent, false)
    assert.match(result.reason, /string descriptor is not authority/)
    assert.equal(transport.calls.length, 0)
  })
})

test('a forged lookalike token cannot authorise a send', () => {
  const admitted = admitSend(request())
  assert.equal(admitted.verdict, 'ADMITTED')
  // Structurally identical, but not the issued object.
  const forged = { ...admitted.token }
  const transport = fakeTransport()
  return consumeSendToken(forged, { transport, hook: { reserve: async () => ({ admitted: true }) } }).then(result => {
    assert.equal(result.sent, false)
    assert.match(result.reason, /was not issued by admitSend/)
    assert.equal(transport.calls.length, 0)
  })
})

test('the issued token does authorise exactly one send through the owned transport', async () => {
  const admitted = admitSend(request())
  let reserved = 0
  const transport = fakeTransport()
  const result = await consumeSendToken(admitted.token, {
    transport,
    hook: { reserve: async () => { reserved += 1; return { admitted: true, reservationId: 'r-1' } } },
    input: 'review this',
  })
  assert.equal(result.sent, true)
  assert.equal(reserved, 1)
  assert.equal(transport.calls.length, 1)
  assert.equal(transport.calls[0].identity.grantId, 'wave05-independent-review-pilot-01')
})

test('a reservation refusal stops the send before the transport is touched', async () => {
  const admitted = admitSend(request())
  const transport = fakeTransport()
  const result = await consumeSendToken(admitted.token, {
    transport,
    hook: { reserve: async () => ({ admitted: false, reason: 'remainder is UNKNOWN' }) },
    input: 'review this',
  })
  assert.equal(result.sent, false)
  assert.match(result.reason, /remainder is UNKNOWN/)
  assert.equal(transport.calls.length, 0, 'the transport must not be called when the reservation refuses')
})

test('a throwing reservation also stops the send before the transport', async () => {
  const admitted = admitSend(request())
  const transport = fakeTransport()
  const result = await consumeSendToken(admitted.token, {
    transport,
    hook: { reserve: async () => { throw new Error('ledger unavailable') } },
    input: 'x',
  })
  assert.equal(result.sent, false)
  assert.match(result.reason, /ledger unavailable/)
  assert.equal(transport.calls.length, 0)
})

test('a token without the owned transport sends nothing', async () => {
  const admitted = admitSend(request())
  const result = await consumeSendToken(admitted.token, { transport: null, hook: { reserve: async () => ({ admitted: true }) } })
  assert.equal(result.sent, false)
  assert.match(result.reason, /does not open a second wire/)
})

test('refusing admission never invokes the hook or the transport', async () => {
  let reserved = 0
  const result = admitSend(
    request({ gates: { ...request().gates, reservation: { satisfied: false, reason: 'unknown remainder' } }, hook: { reserve: async () => { reserved += 1; return { admitted: true } } } }),
  )
  assert.equal(result.verdict, 'REFUSED')
  assert.equal(reserved, 0)
  assert.equal(result.token, null)
})

test('the fake send count stays zero for every refusal path', async () => {
  // B4 requires proving refusal with zero sends; this counts across all refusal shapes at once.
  const transport = fakeTransport()
  const refusals = [
    request({ grant: undefined }),
    request({ grant: { grantId: 'x' } }),
    request({ hook: undefined }),
    request({ gates: {} }),
  ]
  let sends = 0
  for (const each of refusals) {
    const admitted = admitSend(each)
    assert.equal(admitted.verdict, 'REFUSED')
    const attempted = await consumeSendToken(admitted.token, { transport, hook: { reserve: async () => ({ admitted: true }) }, input: 'x' })
    assert.equal(attempted.sent, false)
  }
  sends += transport.calls.length
  assert.equal(sends, 0)
})
