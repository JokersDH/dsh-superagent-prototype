import { openSync, writeSync, fsyncSync, closeSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openRecoveryFixture } from './recovery-fixture.mjs'
import { binding, producer } from './runtime-ingress-fixture.ts'
import { connectRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { registerRecoveryRunner } from '../../apps/coordinator/runner-registry.ts'
import { reconcileRegisteredRunner } from '../../apps/coordinator/reconcile-runner.ts'

const [directory, mode] = process.argv.slice(2)
const h = openRecoveryFixture(directory)
function crash(stage) {
  const intent = h.store.events.after(0).find(event => event.topic === 'runtime.recovery.cancel-requested')
  const fd = openSync(join(directory, 'recovery-stage.json'), 'w', 0o600)
  try { writeSync(fd, JSON.stringify({ stage, cancelCommandId: intent?.payload.commandId, intentSeq: intent ? h.store.commands.get(intent.payload.commandId).seq : undefined })); fsyncSync(fd) }
  finally { closeSync(fd) }
  process.kill(process.pid, 'SIGKILL')
  throw new Error('Crash fixture must not continue')
}
if (mode === 'setup') {
  const { endpoint, resourceRef } = JSON.parse(readFileSync(join(directory, 'launcher.json'), 'utf8'))
  // Only the launch path has this endpoint handoff; every later worker uses the database registration.
  if (!h.store.bindings.binding(binding.attemptId).resources.some(resource => resource.ref === resourceRef)) throw new Error('Launcher resource must already be registered')
  await registerRecoveryRunner(h.store, await connectRunnerRecovery(endpoint, producer).inspect())
  h.store.uow.atomic(() => {
    h.core.stopTicket(binding.ticketId, 'fixture user stop')
    h.store.bindings.record({ ...h.store.bindings.binding(binding.attemptId), state: 'stopping' })
  })
  process.send({ state: 'stopping' }); h.close(); process.disconnect()
} else {
  if (mode === 'before-control' || mode === 'after-barrier') {
    const record = h.store.commands.record.bind(h.store.commands)
    h.store.commands.record = (...args) => {
      const receipt = record(...args)
      if ((mode === 'before-control' && receipt.result?.kind === 'runner-cancel-intent/1') || (mode === 'after-barrier' && receipt.result?.scope === 'registered_owned_resources_only')) h.store.uow.afterCommit(() => crash(mode))
      return receipt
    }
  }
  if (mode === 'after-control') {
    const write = h.store.payloads.write.bind(h.store.payloads)
    h.store.payloads.write = value => { if (value.protocol === 'runner-owned-quiescence/1') crash(mode); return write(value) }
  }
  try { process.send(await reconcileRegisteredRunner(h.store, binding.attemptId)) }
  finally { h.close(); process.disconnect() }
}
