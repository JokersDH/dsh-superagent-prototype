import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AttemptRunner } from '../src/runner.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/fixtures.ts'
import { attemptIdentity } from '../../../packages/driver-kit/src/attempt-io.ts'

test('coalesced progress reaches the observer and final snapshot without creating critical facts', async () => {
  const spec = makeAttemptSpec(), observed: string[] = []
  const runner = new AttemptRunner({
    payloads: { async read() { return null }, async store() { return 'unused' } },
    factSink: { async record() { throw new Error('Progress must not create a critical fact') } },
    onProgress: update => { observed.push(update.text) }, progressIntervalMs: 1000,
  })
  const result = await runner.launch(spec, {
    async inspect() { throw new Error('unused') }, async reconcile() { throw new Error('unused') },
    async serve(_spec, io) {
      io.publishProgress({ ...attemptIdentity(spec), text: 'first snapshot', observedAt: new Date().toISOString() })
      io.publishProgress({ ...attemptIdentity(spec), text: 'complete snapshot', observedAt: new Date().toISOString() })
      return { reason: 'terminal', evidenceRefs: ['controlled-progress'] }
    },
  })
  assert.equal(result.exit.reason, 'terminal')
  assert.deepEqual(observed, ['complete snapshot'])
  assert.ok(result.journal.diagnostics.some(item => item.kind === 'progress'))
})

test('throwing or rejected progress observers cannot prevent cancellation', async () => {
  for (const onProgress of [() => { throw new Error('display failed') }, async () => { throw new Error('async display failed') }]) {
    const spec = makeAttemptSpec()
    const runner = new AttemptRunner({ payloads: { async read() { return null }, async store() { return 'unused' } },
      factSink: { async record() { throw new Error('not used') } }, onProgress, progressIntervalMs: 0 })
    runner.feed(makeCommand('cancel'))
    const result = await runner.launch(spec, {
      async inspect() { throw new Error('unused') }, async reconcile() { throw new Error('unused') },
      async serve(_spec, io) {
        io.publishProgress({ ...attemptIdentity(spec), text: 'working', observedAt: new Date().toISOString() })
        await new Promise(resolve => setTimeout(resolve, 1))
        for await (const command of io.commands) if (command.kind === 'cancel') return { reason: 'cancelled', evidenceRefs: ['controlled-cancel'] }
        return { reason: 'error', evidenceRefs: ['missing-cancel'] }
      },
    })
    assert.equal(result.exit.reason, 'cancelled')
    await new Promise(resolve => setTimeout(resolve, 1))
  }
})
