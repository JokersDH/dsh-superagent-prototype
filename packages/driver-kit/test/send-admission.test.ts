import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SENDER_OWNER, admitSend, consumeSendToken, inspectToken } from '../src/send-admission.ts'

/** A complete, satisfiable request. */
function makeParts(overrides = {}) {
  const sent = []
  const transport = {
    async startTurn({ input, identity }) {
      sent.push({ input, identity })
      return { turnId: `turn-${sent.length}`, sent: true }
    },
  }
  const reserved = []
  const hook = {
    async reserve(request) {
      reserved.push(request)
      return { admitted: true, reservationId: `res-${reserved.length}` }
    },
  }
  const request = {
    grant: { grantId: 'wave05-independent-review-pilot-01', owner: 'E', limit: 24, ledgerPath: '/tmp/ledger.json', scope: 'pilot' },
    gates: {
      model_identity: { satisfied: true, evidence: { model: 'gpt-6.1-sol', modelProvider: 'OpenAI' } },
      cost_bound: { satisfied: true, reason: 'supplied by caller' },
      isolation: { satisfied: true, reason: 'seatbelt' },
      reservation: { satisfied: true },
    },
    hook,
    transport,
    caseRef: 'case-1',
    turn: 1,
    subject: 'frozen-subject-digest',
    profile: { id: 'profile-1', revision: 2 },
    hostPolicy: { mechanism: 'seatbelt' },
    ...overrides,
  }
  return { request, transport, hook, sent, reserved }
}

// ===============================================================================================
// one-use semantics
// ===============================================================================================

test('one token permits exactly one send', async () => {
  const { request, transport, hook, sent } = makeParts()
  const admitted = admitSend(request)
  assert.equal(admitted.verdict, 'ADMITTED')
  const first = await consumeSendToken(admitted.token, { transport, hook, input: 'review this' })
  assert.equal(first.sent, true)
  const second = await consumeSendToken(admitted.token, { transport, hook, input: 'review this again' })
  assert.equal(second.sent, false)
  assert.match(second.reason, /already been consumed/)
  assert.equal(sent.length, 1)
})

test('concurrent consumption sends at most once', async () => {
  // The defect: two overlapping consumes both awaited the reservation and both sent.
  const { request, transport, hook, sent } = makeParts()
  const admitted = admitSend(request)
  const [a, b] = await Promise.all([
    consumeSendToken(admitted.token, { transport, hook, input: 'first' }),
    consumeSendToken(admitted.token, { transport, hook, input: 'second' }),
  ])
  assert.equal([a, b].filter(result => result.sent).length, 1)
  assert.equal(sent.length, 1)
})

test('a slow reservation still cannot admit a concurrent second send', async () => {
  let releases
  const slowHook = {
    async reserve() {
      await new Promise(resolve => { releases = resolve })
      return { admitted: true, reservationId: 'res-slow' }
    },
  }
  const { request, transport, sent } = makeParts({ hook: slowHook })
  const admitted = admitSend(request)
  const first = consumeSendToken(admitted.token, { transport, hook: slowHook, input: 'slow' })
  // While the first is parked inside the reservation, the token is already claimed.
  const concurrent = await consumeSendToken(admitted.token, { transport, hook: slowHook, input: 'concurrent' })
  assert.equal(concurrent.sent, false)
  assert.match(concurrent.reason, /already been consumed/)
  releases()
  const settled = await first
  assert.equal(settled.sent, true)
  assert.equal(sent.length, 1)
})

test('a refused reservation consumes the token and does not refund it', async () => {
  const refusing = { async reserve() { return { admitted: false, reason: 'remainder is UNKNOWN' } } }
  const { request, transport, sent } = makeParts({ hook: refusing })
  const admitted = admitSend(request)
  const first = await consumeSendToken(admitted.token, { transport, hook: refusing, input: 'x' })
  assert.equal(first.sent, false)
  assert.match(first.reason, /remainder is UNKNOWN/)
  const retry = await consumeSendToken(admitted.token, { transport, hook: refusing, input: 'x' })
  assert.equal(retry.sent, false)
  assert.match(retry.reason, /already been consumed/)
  assert.equal(sent.length, 0)
})

test('a throwing reservation consumes the token instead of granting a free retry', async () => {
  const throwing = { async reserve() { throw new Error('ledger unavailable') } }
  const { request, transport, sent } = makeParts({ hook: throwing })
  const admitted = admitSend(request)
  const first = await consumeSendToken(admitted.token, { transport, hook: throwing, input: 'x' })
  assert.equal(first.sent, false)
  assert.match(first.reason, /ledger unavailable/)
  const retry = await consumeSendToken(admitted.token, { transport, hook: throwing, input: 'x' })
  assert.equal(retry.sent, false)
  assert.match(retry.reason, /already been consumed/)
  assert.equal(sent.length, 0)
})

// ===============================================================================================
// transport and hook binding
// ===============================================================================================

test('a substituted transport is refused', async () => {
  // The defect: a token issued for the owned transport could be spent through any other one.
  const { request, transport, hook, sent } = makeParts()
  const admitted = admitSend(request)
  const other = {
    async startTurn() {
      sent.push({ substituted: true })
      return { turnId: 'substituted' }
    },
  }
  const result = await consumeSendToken(admitted.token, { transport: other, hook, input: 'x' })
  assert.equal(result.sent, false)
  assert.match(result.reason, /differs from the one bound at issuance/)
  assert.equal(sent.length, 0)
})

test('a substituted hook is refused', async () => {
  const { request, transport, hook, sent } = makeParts()
  const admitted = admitSend(request)
  const otherHook = { async reserve() { return { admitted: true } } }
  const result = await consumeSendToken(admitted.token, { transport, hook: otherHook, input: 'x' })
  assert.equal(result.sent, false)
  assert.match(result.reason, /reservation hook differs/)
  assert.equal(sent.length, 0)
})

test('a transport must exist at issue time, not only at consume time', () => {
  const { request } = makeParts({ transport: undefined })
  const admitted = admitSend(request)
  assert.equal(admitted.verdict, 'REFUSED')
  assert.match(admitted.refusal.problems.join(' '), /transport must be bound before a token exists/)
})

// ===============================================================================================
// no second implementation, no raw command
// ===============================================================================================

test('a caller cannot supply an entry, command or second transport', () => {
  for (const key of ['entry', 'command', 'argv', 'cli', 'spawn', 'transportOverride', 'hookOverride']) {
    const admitted = admitSend(makeParts({ [key]: { command: 'codex exec' } }).request)
    assert.equal(admitted.verdict, 'REFUSED', `request key "${key}" was accepted`)
    assert.match(admitted.refusal.problems.join(' '), /this sender owns the transport and hook/)
  }
})

test('naming the sender as the grant owner requires that grant to pass its own audit', () => {
  // Without this, a caller could ride this role's own grant to impersonate its implementation.
  const spoof = admitSend(makeParts({ grant: { grantId: 'wave03-b-native', owner: SENDER_OWNER, limit: 4, ledgerPath: '/tmp/ledger.json' } }).request)
  assert.equal(spoof.verdict, 'REFUSED')
  assert.match(spoof.refusal.problems.join(' '), /grant spoofing refused/)

  // The same request is admissible when the audit actually permits it.
  const permitted = admitSend(
    makeParts({
      grant: { grantId: 'wave03-b-native', owner: SENDER_OWNER, limit: 4, ledgerPath: '/tmp/ledger.json' },
      audit: () => ({ allowed: true, reason: 'verified remainder' }),
    }).request,
  )
  assert.equal(permitted.verdict, 'ADMITTED')
})

test("another owner's grant does not route through the sender audit", () => {
  const admitted = admitSend(makeParts().request)
  assert.equal(admitted.verdict, 'ADMITTED')
  assert.equal(admitted.token.owner, 'E')
})

// ===============================================================================================
// gates and plain JSON
// ===============================================================================================

test('an empty gates object is refused rather than admitting', () => {
  const admitted = admitSend(makeParts({ gates: {} }).request)
  assert.equal(admitted.verdict, 'REFUSED')
  assert.equal(admitted.refusal.problems.filter(problem => /was not supplied/.test(problem)).length, 4)
})

test('a gate claiming satisfied without model values is refused', () => {
  const admitted = admitSend(
    makeParts({ gates: { ...makeParts().request.gates, model_identity: { satisfied: true, evidence: {} } } }).request,
  )
  assert.equal(admitted.verdict, 'REFUSED')
  assert.match(admitted.refusal.problems.join(' '), /no model\/provider values/)
})

test('a refused admission carries no token and nothing executable', () => {
  const admitted = admitSend(makeParts({ hook: undefined }).request)
  assert.equal(admitted.verdict, 'REFUSED')
  assert.equal(admitted.token, null)
  assert.equal(admitted.launch, null)
  assert.equal(admitted.consumable, false)
})

// ===============================================================================================
// descriptor and forgery
// ===============================================================================================

test('a string descriptor is refused', async () => {
  const { transport, hook, sent } = makeParts()
  const result = await consumeSendToken('{"verdict":"ADMITTED"}', { transport, hook, input: 'x' })
  assert.equal(result.sent, false)
  assert.match(result.reason, /string descriptor is not authority/)
  assert.equal(sent.length, 0)
})

test('a forged lookalike token is refused', async () => {
  const { request, transport, hook, sent } = makeParts()
  const admitted = admitSend(request)
  const forged = { ...admitted.token }
  const result = await consumeSendToken(forged, { transport, hook, input: 'x' })
  assert.equal(result.sent, false)
  assert.match(result.reason, /not issued by admitSend/)
  assert.equal(sent.length, 0)
  // The genuine token still works, so the refusal was about forgery rather than global breakage.
  const genuine = await consumeSendToken(admitted.token, { transport, hook, input: 'x' })
  assert.equal(genuine.sent, true)
})

// ===============================================================================================
// binding content
// ===============================================================================================

test('the token binds the grant, subject, profile and host policy', () => {
  const { request } = makeParts()
  const admitted = admitSend(request)
  assert.equal(admitted.token.digests.subject, admitted.token.digests.subject)
  assert.match(admitted.token.digests.grant, /^[a-f0-9]{64}$/)
  assert.match(admitted.token.digests.subject, /^[a-f0-9]{64}$/)
  assert.match(admitted.token.digests.profile, /^[a-f0-9]{64}$/)
  assert.match(admitted.token.digests.hostPolicy, /^[a-f0-9]{64}$/)
  assert.match(admitted.token.digest, /^[a-f0-9]{64}$/)
})

test('a different grant or subject produces a different token digest', () => {
  const a = admitSend(makeParts().request)
  const b = admitSend(makeParts({ subject: 'a-different-subject' }).request)
  const c = admitSend(
    makeParts({ grant: { grantId: 'other-grant', owner: 'E', limit: 5, ledgerPath: '/tmp/ledger.json' } }).request,
  )
  assert.notEqual(a.token.digests.subject, b.token.digests.subject)
  assert.notEqual(a.token.digests.grant, c.token.digests.grant)
})

test('the reservation receives the bound identity so settlement can match it', async () => {
  const { request, transport, hook, reserved } = makeParts()
  const admitted = admitSend(request)
  await consumeSendToken(admitted.token, { transport, hook, input: 'x' })
  assert.equal(reserved.length, 1)
  assert.equal(reserved[0].grantId, 'wave05-independent-review-pilot-01')
  assert.equal(reserved[0].tokenDigest, admitted.token.digest)
  assert.match(reserved[0].subjectDigest, /^[a-f0-9]{64}$/)
})

test('token state is inspectable for assertions but never authorises by itself', async () => {
  const { request, transport, hook } = makeParts()
  const admitted = admitSend(request)
  assert.deepEqual(inspectToken(admitted.token), { issued: true, claimed: false })
  await consumeSendToken(admitted.token, { transport, hook, input: 'x' })
  assert.deepEqual(inspectToken(admitted.token), { issued: true, claimed: true })
  assert.deepEqual(inspectToken({}), { issued: false, claimed: false })
  assert.equal(inspectToken(admitted.token).claimed, true)
})

test('the fake send count stays zero across every refusal shape', async () => {
  const parts = makeParts()
  let sends = 0
  const counting = { async startTurn() { sends += 1; return { sent: true } } }
  const refusals = [
    admitSend({ ...makeParts().request, grant: undefined }),
    admitSend({ ...makeParts().request, gates: {} }),
    admitSend({ ...makeParts().request, hook: undefined }),
  ]
  for (const admitted of refusals) {
    assert.equal(admitted.verdict, 'REFUSED')
    await consumeSendToken(admitted.token, { transport: counting, hook: parts.hook, input: 'x' })
  }
  assert.equal(sends, 0)
  assert.equal(parts.sent.length, 0)
})
