import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectRunnerRecovery } from '../../apps/coordinator/runner-link.ts'
import { confirmOwnedQuiescence } from '../../apps/coordinator/resource-barrier.ts'
import { openRecoveryFixture } from './recovery-fixture.mjs'
import { binding, producer } from './runtime-ingress-fixture.ts'

const [directory, mode] = process.argv.slice(2)
// Test-only trusted launcher registry. Product persistence remains a storage-owner follow-up.
const { endpoint, resourceRef } = JSON.parse(readFileSync(join(directory, 'launcher.json'), 'utf8'))
const h = openRecoveryFixture(directory, { ...binding, resources: [{ ref: resourceRef, ownership: 'spawned_process' }] })
const client = connectRunnerRecovery(endpoint, producer)
if (mode === 'hold') {
  process.on('message', () => {})
  const proof = await client.inspect()
  process.send({ state: proof.inspection.state, resourceRef: proof.inspection.resources[0].ref })
  // The test SIGKILLs this coordinator while the independent Runner keeps working.
} else {
  try {
    const proof = await client.cancel({ ...producer.attempt, id: 'recovery-cancel', kind: 'cancel' })
    const receipt = confirmOwnedQuiescence(h.store, proof)
    process.send({ receipt, state: proof.inspection.state, bindingState: h.store.bindings.binding(binding.attemptId).state })
  } finally {
    h.close()
    process.disconnect()
  }
}
