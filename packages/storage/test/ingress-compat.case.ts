/**
 * Compatibility fixture for the main-owned ingress interface: storage's binding records and
 * payload reader satisfy the public `IngressBinding` / `ImmutablePayloadReader` shapes (no type
 * copies in the package), and the storage canonical digest matches the coordinator's `jsonDigest`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { IngressBinding, ImmutablePayloadReader } from '../../../apps/coordinator/runtime-ingress.ts'
import { jsonDigest } from '../../../apps/coordinator/runtime-ingress.ts'
import { canonicalDigest } from '../src/index.ts'
import { withStore } from './helpers.ts'

const contract = { workId: 'work-1', revision: 1, digest: 'digest-1' }

test('storage bindings and payloads are compatible with the coordinator ingress interface', async () => {
  await withStore(async ({ store }) => {
    const binding: IngressBinding = {
      attemptId: 'attempt-1', ticketId: 'ticket-1', assignmentId: 'assignment-1', fenceEpoch: 1,
      contract, runnerIdentityRef: 'runner-1', source: 'codex', state: 'active',
      resources: [{ ref: 'resource-1', ownership: 'spawned_process' }],
    }
    store.bindings.record(binding)
    store.bindings.setCurrent('ticket-1', 'attempt-1')
    const known: IngressBinding | undefined = store.bindings.binding<IngressBinding>('attempt-1')
    const current: IngressBinding | undefined = store.bindings.current<IngressBinding>('ticket-1')
    assert.deepEqual(known, binding)
    assert.deepEqual(current, binding)
    assert.equal(store.authority.isCurrent(binding.contract), false)
    store.authority.enable(binding.contract)
    assert.equal(store.authority.isCurrent(binding.contract), true)

    const reader: ImmutablePayloadReader = store.payloads
    const written = store.payloads.write({ z: [1, 2], a: 'text' })
    const resolved = await reader.read(written.ref)
    assert.equal(resolved.sha256, written.sha256)
    assert.deepEqual(resolved.value, { z: [1, 2], a: 'text' })
  })
})

test('the storage canonical digest matches the coordinator jsonDigest on representative payloads', () => {
  const samples = [
    { kind: 'turn.ended', value: { nativeTurnRef: 'turn-1' } },
    { lists: [1, 'two', true, null], nested: { b: 2, a: { d: 4, c: 3 } } },
    { text: 'héllo 世界', empty: {}, zero: 0, negative: -1.5 },
    [{ y: 1, x: 2 }, { x: 3 }],
    null,
  ]
  for (const sample of samples) {
    assert.equal(canonicalDigest(sample as never), jsonDigest(sample as never), `digest parity for ${JSON.stringify(sample)}`)
  }
})
