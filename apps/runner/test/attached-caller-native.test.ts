/**
 * Wave-33: the attached caller's native-write wrapper must be fail-closed.
 *
 * Only an explicit awaited `{allowed:true}` authorizes. A void return, a denial, a thrown guard, or a
 * missing guard becomes `allowed:false`; none of these may become a cached boolean or a permission.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachRunningAttempt, resolveNativeDecision } from '../../../packages/execution/src/attached-attempt.ts'
import { makeCommand } from '../../../packages/testing/src/index.ts'

const intent = { id: 'intent-1', command: makeCommand('answer', { nativeBindingRef: 'binding-1', answerRef: 'answer-1' }) }

test('an explicit allowed decision is the only authorization', async () => {
  assert.deepEqual(await resolveNativeDecision(async () => ({ allowed: true }), intent), { allowed: true })
})

test('a denial, a void return, a throw and a missing guard all refuse', async () => {
  assert.deepEqual(await resolveNativeDecision(async () => ({ allowed: false, reason: 'denied' }), intent), { allowed: false, reason: 'denied' })
  assert.deepEqual(await resolveNativeDecision(async () => undefined as never, intent), { allowed: false, reason: 'denied' })
  const thrown = await resolveNativeDecision(async () => { throw new Error('guard unavailable') }, intent)
  assert.equal(thrown.allowed, false)
  assert.ok(thrown.reason?.startsWith('guard_threw:'))
  assert.deepEqual(await resolveNativeDecision(undefined, intent), { allowed: false, reason: 'no_native_guard' })
})

test('the guard is awaited, not treated as a cached boolean', async () => {
  let calls = 0
  const guard = async () => { calls += 1; return calls === 1 ? { allowed: true } : { allowed: false } }
  assert.equal((await resolveNativeDecision(guard, intent)).allowed, true)
  assert.equal((await resolveNativeDecision(guard, intent)).allowed, false)
  assert.equal(calls, 2)
})

test('attaching to the original handle requires both its port and its shared callbacks', () => {
  const callbacks = { fact: async () => ({ factId: 'f', persisted: true, seq: 1 }) }
  assert.throws(() => attachRunningAttempt({ attemptId: 'attempt-1', attachCallbacks: callbacks }, 'lease-1'), /attachPort/)
  assert.throws(() => attachRunningAttempt({ attemptId: 'attempt-1', attachPort: { registration: { socketPath: '/tmp/x', credentialPath: '/tmp/x.c', socketIdentity: { dev: 1, ino: 2 } }, producer: {} } }, 'lease-1'), /attachCallbacks/)
  assert.throws(() => attachRunningAttempt({ attemptId: 'attempt-other', attachPort: { registration: { socketPath: '/tmp/x', credentialPath: '/tmp/x.c', socketIdentity: { dev: 1, ino: 2 } }, producer: { attempt: { attemptId: 'attempt-1' } } }, attachCallbacks: callbacks }, 'lease-1'), /does not belong/)
  assert.throws(() => attachRunningAttempt({ attemptId: '', attachPort: { registration: { socketPath: '/tmp/x', credentialPath: '/tmp/x.c', socketIdentity: { dev: 1, ino: 2 } }, producer: {} }, attachCallbacks: callbacks }, 'lease-1'), /attempt identity/)
})
