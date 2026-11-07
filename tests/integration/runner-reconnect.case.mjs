import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createRunnerCredential, connectRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { openRecoveryFixture } from './recovery-fixture.mjs'
import { binding, producer } from './runtime-ingress-fixture.ts'

const servicePath = fileURLToPath(new URL('./runner-service.fixture.mjs', import.meta.url))
const clientPath = fileURLToPath(new URL('./runner-client.fixture.mjs', import.meta.url))
function worker(path, args) {
  const child = spawn(process.execPath, [path, ...args], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const exit = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const message = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Fixture timed out: ${stderr}`)) }, 7000)
    child.once('message', value => { clearTimeout(timeout); resolve(value) })
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', (code, signal) => { clearTimeout(timeout); reject(new Error(`Fixture exited before reply: ${code}/${signal} ${stderr}`)) })
  })
  return { child, exit, message, stderr: () => stderr }
}
const lines = path => existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).length : 0

test('after real coordinator SIGKILL, a new process reconnects to the same live Runner and records owned-resource quiescence', { timeout: 15_000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pa-peer-'))
  createRunnerCredential(join(directory, 'runner.key'))
  const service = worker(servicePath, [directory]), clients = []
  let endpoint
  t.after(async () => {
    for (const client of clients) {
      if (client.child.exitCode === null && client.child.signalCode === null) client.child.kill('SIGKILL')
      await client.exit
    }
    if (endpoint) {
      try { await connectRunnerRecovery(endpoint, producer).cancel({ ...producer.attempt, id: 'cleanup-cancel', kind: 'cancel' }) } catch {}
    }
    if (service.child.connected) service.child.send('shutdown')
    const timeout = setTimeout(() => service.child.kill('SIGTERM'), 3000)
    await service.exit
    clearTimeout(timeout)
    rmSync(directory, { recursive: true, force: true })
  })
  const ready = await service.message
  endpoint = ready.endpoint
  assert.ok(ready.processIdentity.startMarker)
  writeFileSync(join(directory, 'launcher.json'), JSON.stringify(ready), { mode: 0o600 })
  const first = worker(clientPath, [directory, 'hold']); clients.push(first)
  assert.deepEqual(await first.message, { state: 'serving', resourceRef: ready.resourceRef })
  first.child.kill('SIGKILL')
  assert.equal((await first.exit).signal, 'SIGKILL')
  const before = lines(join(directory, 'ticks.log'))
  for (let i = 0; i < 100 && lines(join(directory, 'ticks.log')) <= before; i++) await delay(10)
  assert.ok(lines(join(directory, 'ticks.log')) > before, 'Owned work must survive the coordinator process')
  process.kill(ready.processIdentity.pid, 0)
  assert.equal((await connectRunnerRecovery(endpoint, producer).inspect()).inspection.state, 'serving')
  const second = worker(clientPath, [directory, 'cancel']); clients.push(second)
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
