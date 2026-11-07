import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { connectRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { ownedRunnerFixture } from './runner-process.fixture.mjs'
import { openRecoveryFixture } from './recovery-fixture.mjs'
import { binding, producer } from './runtime-ingress-fixture.ts'

const clientPath = fileURLToPath(new URL('./runner-client.fixture.mjs', import.meta.url))
const lines = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).length : 0

test('after real coordinator SIGKILL, a new process reconnects to the same live Runner and records owned-resource quiescence', { timeout: 15_000 }, async t => {
  const { directory, ready, startClient } = await ownedRunnerFixture(t), endpoint = ready.endpoint
  assert.ok(ready.processIdentity.startMarker)
  writeFileSync(join(directory, 'launcher.json'), JSON.stringify(ready), { mode: 0o600 })
  const first = startClient(clientPath, ['hold'])
  assert.deepEqual(await first.message, { state: 'serving', resourceRef: ready.resourceRef })
  first.child.kill('SIGKILL')
  assert.equal((await first.exit).signal, 'SIGKILL')
  const before = lines(join(directory, 'ticks.log'))
  for (let i = 0; i < 100 && lines(join(directory, 'ticks.log')) <= before; i++) await delay(10)
  assert.ok(lines(join(directory, 'ticks.log')) > before, 'Owned work must survive the coordinator process')
  process.kill(ready.processIdentity.pid, 0)
  assert.equal((await connectRunnerRecovery(endpoint, producer).inspect()).inspection.state, 'serving')
  const second = startClient(clientPath, ['cancel'])
  const resumed = await second.message
  assert.equal((await second.exit).code, 0, second.stderr())
  assert.equal(resumed.bindingState, 'ended')
  assert.equal(resumed.state, 'terminated')
  assert.equal(resumed.receipt.result.scope, 'registered_owned_resources_only')
  assert.equal(lines(join(directory, 'starts.log')), 1)
  assert.equal(lines(join(directory, 'cancels.log')), 1)
  assert.throws(() => process.kill(ready.processIdentity.pid, 0), error => error.code === 'ESRCH')
  const h = openRecoveryFixture(directory)
  try {
    assert.equal(h.store.bindings.binding(binding.attemptId).state, 'ended')
    assert.equal(h.store.observations.summarize(binding.attemptId).resources[0].quiescence, 'observed_quiescent')
    assert.equal(h.store.domain.tickets.get(binding.ticketId).ended, undefined)
    assert.equal(h.store.facts.get(resumed.receipt.result.writerFactId).seq > 0, true)
  } finally { h.close() }
})
