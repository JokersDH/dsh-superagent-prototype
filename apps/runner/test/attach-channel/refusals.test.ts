/**
 * wave-29 I14 — typed refusal surface for consumers.
 *
 * B's transport forwards channel failures into a `RunnerLinkError(code, …)` whose code union is
 * narrower than the channel's refusal set, so the real source fails to compile (TS2345) and invites
 * an unchecked cast. These cases pin the exported failure codes and the bounded, secret-free text a
 * consumer may forward, and prove the union can be widened without a cast.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { refusalFailure, toAttachFailure, type AttachFailureCode } from '../../src/attach-channel/refusals.ts'
import { CoordinatorChannelError, NativeWriteDenied } from '../../src/attach-channel/errors.ts'

test('channel errors map one-to-one, keeping code and stable reason', () => {
  assert.deepEqual(toAttachFailure(new CoordinatorChannelError('timeout', 'request_timeout')), {
    code: 'timeout',
    reason: 'request_timeout',
    message: 'timeout:request_timeout',
  })
  assert.deepEqual(toAttachFailure(new CoordinatorChannelError('stale_connection', 'generation_mismatch', 'bind expected a different generation')), {
    code: 'stale_connection',
    reason: 'generation_mismatch',
    message: 'bind expected a different generation',
  })
})

test('an authoritative denial keeps its own code instead of being reported as a channel fault', () => {
  const failure = toAttachFailure(new NativeWriteDenied('command-denied'))
  assert.equal(failure.code, 'native_write_denied')
  assert.equal(failure.reason, 'native_write_denied')
  assert.match(failure.message, /command-denied/)
})

test('an unknown error never leaks its message, payload or absolute path', () => {
  const secret = '/Users/private/secret-token-42'
  const failure = toAttachFailure(new Error(`exploded while reading ${secret}`))
  assert.equal(failure.code, 'protocol_error')
  assert.equal(failure.reason, 'unexpected_error')
  assert.equal(failure.message, 'unexpected channel failure')
  assert.ok(!failure.message.includes(secret))
})

test('forwarded text is bounded even for our own errors', () => {
  const failure = toAttachFailure(new CoordinatorChannelError('protocol_error', 'long_reason', 'x'.repeat(500)))
  assert.ok(failure.message.length <= 201)
  assert.ok(failure.message.endsWith('…'))
})

test('adapter poll/reply refusals map to the same surface', () => {
  assert.equal(refusalFailure('stale_connection').code, 'stale_connection')
  assert.equal(refusalFailure('identity_mismatch').code, 'identity_mismatch')
  assert.equal(refusalFailure('closed').code, 'closed')
  for (const failure of [refusalFailure('stale_connection'), refusalFailure('identity_mismatch'), refusalFailure('closed')])
    assert.ok(failure.message.length > 0)
})

test('a consumer can widen its own error union with the exported code type, without a cast', () => {
  // This mirrors the mapping B's recovery transport needs: its own union plus the channel's codes.
  type ConsumerCode = 'transport_lost' | 'process_exited' | AttachFailureCode
  const fromChannel: ConsumerCode = toAttachFailure(new CoordinatorChannelError('capacity', 'pending_bytes')).code
  const fromOwnError: ConsumerCode = 'transport_lost'
  assert.equal(fromChannel, 'capacity')
  assert.equal(fromOwnError, 'transport_lost')
  const all: AttachFailureCode[] = ['identity_mismatch', 'stale_connection', 'closed', 'timeout', 'capacity', 'protocol_error', 'indeterminate', 'native_write_denied']
  assert.equal(new Set(all).size, all.length)
})
