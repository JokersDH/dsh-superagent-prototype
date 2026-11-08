import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ownedRunnerFixture } from './runner-process.fixture.mjs'
import { openRecoveryFixture } from './recovery-fixture.mjs'
import { binding } from './runtime-ingress-fixture.ts'
import { loadRecoveryRunner } from '../../apps/coordinator/runner-registry.ts'

const worker = fileURLToPath(new URL('./registered-recovery-worker.mjs', import.meta.url))
for (const mode of ['before-control', 'after-control', 'after-barrier']) {
  test(`durable registered recovery after real SIGKILL ${mode} never starts new work or duplicates cancellation`, { timeout: 15_000 }, async t => {
    const { directory, ready, startClient } = await ownedRunnerFixture(t)
    // Use the ProcessHost-issued resource identity in the production binding.
    const h = openRecoveryFixture(directory, { ...binding, resources: [{ ref: ready.resourceRef, ownership: 'spawned_process' }] }); h.close()
    writeFileSync(join(directory, 'launcher.json'), JSON.stringify(ready), { mode: 0o600 })
    const setup = startClient(worker, ['setup'])
    assert.equal((await setup.message).state, 'stopping'); assert.equal((await setup.exit).code, 0, setup.stderr())
    rmSync(join(directory, 'launcher.json'))
    const failing = startClient(worker, [mode], false)
    assert.equal((await failing.exit).signal, 'SIGKILL', failing.stderr())
    const stage = JSON.parse(readFileSync(join(directory, 'recovery-stage.json'), 'utf8'))
    assert.equal(stage.stage, mode); assert.ok(stage.cancelCommandId)
    const afterCrash = openRecoveryFixture(directory)
    let originalBarrier, cursor
    try {
      assert.equal(afterCrash.store.commands.get(stage.cancelCommandId).seq, stage.intentSeq)
      assert.ok(loadRecoveryRunner(afterCrash.store, binding.attemptId))
      assert.equal(afterCrash.store.bindings.binding(binding.attemptId).state, mode === 'after-barrier' ? 'ended' : 'stopping')
      assert.equal(afterCrash.store.domain.tickets.get(binding.ticketId).ended.outcome, 'stopped')
      cursor = afterCrash.store.events.cursor()
      if (mode === 'after-barrier') originalBarrier = afterCrash.store.events.after(0).find(event => event.topic === 'runtime.barrier.confirmed')
    } finally { afterCrash.close() }
    const resumed = startClient(worker, ['resume']), result = await resumed.message
    assert.equal((await resumed.exit).code, 0, resumed.stderr())
    assert.equal(result.status, 'quiescent')
    assert.equal(readFileSync(join(directory, 'starts.log'), 'utf8').trim().split('\n').length, 1)
    assert.equal(readFileSync(join(directory, 'cancels.log'), 'utf8').trim().split('\n').length, 1)
    const reopened = openRecoveryFixture(directory)
    try {
      assert.equal(reopened.store.commands.get(stage.cancelCommandId).seq, stage.intentSeq)
      assert.equal(reopened.store.bindings.binding(binding.attemptId).state, 'ended')
      assert.equal(reopened.store.observations.forAttempt(binding.attemptId).length, 1)
      assert.equal(reopened.store.domain.tickets.get(binding.ticketId).ended.outcome, 'stopped')
      if (originalBarrier) {
        assert.equal(result.barrier.replayed, true)
        assert.equal(result.barrier.result.confirmedEventSeq, originalBarrier.seq)
        assert.equal(reopened.store.events.cursor(), cursor)
      }
    } finally { reopened.close() }
  })
}
