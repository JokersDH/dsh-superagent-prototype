/**
 * wave-31 I11 — public interface and legacy-call compatibility.
 *
 * Runtime checks that the emitted frames stay on the frozen v1 envelope, that invalid versions and
 * envelopes are refused with a typed base code, and that the exported failure union is what consumers
 * can widen. Compile-level compatibility of the actual main/B consumers is the `tsc` command recorded
 * in the status file, not a test.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as entry from '../../src/attach-channel/index.ts'
import { CoordinatorChannelError } from '../../src/attach-channel/errors.ts'
import { toAttachFailure, type AttachFailureCode } from '../../src/attach-channel/refusals.ts'
import { startService } from './actual-harness.ts'

test('I11: the published entry exposes one implementation plus the shared contract surface', () => {
  assert.equal(typeof entry.CoordinatorChannelModule, 'function')
  assert.equal(typeof entry.RunnerAttachChannel, 'function')
  assert.equal(typeof entry.createCoordinatorSinkResponder, 'function')
  assert.equal(typeof entry.toAttachFailure, 'function')
  assert.equal(typeof entry.CoordinatorChannelRequestSchema.safeParse, 'function')
  // A consumer can type a union with the channel codes without any cast.
  const codes: AttachFailureCode[] = ['stale_connection', 'identity_mismatch', 'closed', 'timeout', 'capacity', 'protocol_error', 'indeterminate', 'native_write_denied']
  for (const code of codes) assert.equal(toAttachFailure(new CoordinatorChannelError(code === 'native_write_denied' ? 'protocol_error' : code, 'x')).code.length > 0, true)
})

test('I11: an unsupported protocol version is refused before any work', { timeout: 20000 }, async t => {
  const h = await startService(t, { run: async () => ({ reason: 'terminal', evidenceRefs: ['version'] }) })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.send({ v: 2, type: 'command', id: 'cmd-x', command: { kind: 'cancel', id: 'cmd-x' } })
  await h.waitFrame(frame => frame.type === 'error', 'version refusal')
  const error = h.framesOf('error')[0] as { code?: string; reason?: string }
  assert.equal(error.code, 'protocol_error')
  assert.notEqual(error.reason, undefined)
})

test('I11: an envelope without a frame id is refused with a typed base code', { timeout: 20000 }, async t => {
  const h = await startService(t, {
    recovery: true,
    run: async ({ io }) => {
      await new Promise(resolve => setTimeout(resolve, 300))
      void io
      return { reason: 'terminal', evidenceRefs: ['envelope'] }
    },
  })
  h.boot()
  await h.waitFrame(frame => frame.type === 'ready', 'ready')
  h.send({ type: 'progress', text: 'no id' })
  await h.waitFrame(frame => frame.type === 'error', 'envelope refusal')
  const error = h.framesOf('error')[0] as { code?: string; reason?: string }
  assert.equal(error.code, 'protocol_error')
  assert.equal(error.reason, 'unexpected_error')
  // A decode failure ends the input pump; the observation channel still serves the real lease so a
  // successor can read state, and nothing was settled or approved.
  const state = await h.connect('lease-after-bad', 1)
  assert.equal(state.bound.generation >= 2, true)
})

test('I11: the module-level failure surface keeps denial separate from channel faults', () => {
  const denial = toAttachFailure(new entry.NativeWriteDenied('cmd-x'))
  assert.equal(denial.code, 'native_write_denied')
  const refusal = toAttachFailure(new CoordinatorChannelError('stale_connection', 'generation_mismatch'))
  assert.equal(refusal.code, 'stale_connection')
  assert.equal(refusal.reason, 'generation_mismatch')
})
