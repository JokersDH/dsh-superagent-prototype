import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { makeAttemptSpec } from '../../testing/src/index.ts'
import {
  INVALID_INFERENCES,
  RESOURCE_VERDICTS,
  classifyVerifiedResource,
  describeResourceFacts,
  resourceFactsDigest,
} from '../src/resource-facts.ts'
import {
  connectRunnerRecovery,
  createRunnerCredential,
  serveRunnerRecovery,
  verifiedRunnerInspection,
} from '../src/recovery-transport.ts'

/**
 * Mint a real authenticated proof through the EXISTING trusted factory.
 *
 * There is deliberately no test-only way to manufacture a proof: the registry lives in one WeakMap
 * that only the authenticated client call populates. So the positive control runs a real socket
 * server and a real authenticated client, which is exactly what a production caller does.
 */
/** The attempt tuple shared by the producer and the inspection, so both describe one attempt. */
const SPEC = makeAttemptSpec({ fenceEpoch: 3 })

async function withProof(inspection, run) {
  const root = mkdtempSync(join(tmpdir(), 'pa-w09-proof-'))
  const socketPath = join(root, 'runner.sock')
  const credentialPath = join(root, 'runner.cred')
  createRunnerCredential(credentialPath)
  // RuntimeProducer is the existing production shape: attempt tuple + runner identity + source.
  const spec = SPEC
  const context = {
    attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract },
    runnerIdentityRef: 'runner-1',
    source: 'source-1',
  }
  const served = await serveRunnerRecovery(
    { socketPath, credentialPath },
    context,
    {
      async inspect() {
        return inspection
      },
      async cancel() {
        return inspection
      },
    },
  )
  try {
    // The authenticated client verifies the live socket identity, so observe it rather than guess.
    const stat = statSync(socketPath)
    const endpoint = { socketPath, credentialPath, socketIdentity: { dev: stat.dev, ino: stat.ino } }
    const client = connectRunnerRecovery(endpoint, context)
    const proof = await client.inspect()
    await run(proof, context)
  } finally {
    await served.close()
    rmSync(root, { recursive: true, force: true })
  }
}

/** A fully quiescent authenticated inspection. */
function quiescentInspection(overrides = {}) {
  return {
    protocol: 1,
    attempt: { ticketId: SPEC.ticketId, assignmentId: SPEC.assignmentId, attemptId: SPEC.attemptId, fenceEpoch: SPEC.fenceEpoch },
    runnerIdentityRef: 'runner-1',
    source: 'source-1',
    state: 'terminated',
    admission: 'closed',
    coverage: 'complete_owned_resources',
    evidence: ['endpoint terminated after draining'],
    observedAt: new Date().toISOString(),
    resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'quiescent', evidence: ['process exited with code 0'] }],
    ...overrides,
  }
}

// ===============================================================================================
// B1: ordinary JSON must have no release authority
// ===============================================================================================

test('a plain inspection object is refused, not evaluated', () => {
  const facts = describeResourceFacts(quiescentInspection())
  assert.equal(facts.verdict, 'refused')
  assert.equal(facts.releaseBarrierSatisfied, false)
  assert.ok(facts.invalidInferencesDetected.includes('plain_json'))
})

test('a JSON round-trip of a real proof is refused', async () => {
  // The strongest form of the defect: a genuine proof serialized and parsed back must not work,
  // otherwise anything that can write JSON can release the barrier.
  await withProof(quiescentInspection(), async proof => {
    const clone = JSON.parse(JSON.stringify(proof))
    const facts = describeResourceFacts(clone)
    assert.equal(facts.verdict, 'refused')
    assert.equal(facts.releaseBarrierSatisfied, false)
  })
})

test('the seven ordinary-JSON counterexamples all fail to release the barrier', () => {
  // Each of these was an accepted shortcut in wave-08. None may reach releaseBarrierSatisfied.
  const counterexamples = [
    ['hand-built complete object', quiescentInspection()],
    ['assumed machine', { ...quiescentInspection(), machineId: 'machine-a', observedMachineId: 'machine-a' }],
    ['assumed timeliness', { ...quiescentInspection(), proofRecordedAt: new Date().toISOString() }],
    ['json string', JSON.parse(JSON.stringify(quiescentInspection()))],
    ['structured clone', structuredClone(quiescentInspection())],
    ['wrapped in inspection key', { inspection: quiescentInspection() }],
    ['empty object', {}],
  ]
  const outcomes = counterexamples.map(([label, candidate]) => {
    const facts = describeResourceFacts(candidate)
    return { label, verdict: facts.verdict, released: facts.releaseBarrierSatisfied }
  })
  for (const outcome of outcomes) {
    assert.equal(outcome.released, false, `${outcome.label} released the barrier from ordinary JSON`)
  }
  assert.equal(outcomes.filter(outcome => outcome.verdict === 'refused').length, outcomes.length)
})

test('a real authenticated proof is evaluated, and quiescence releases the barrier', async () => {
  await withProof(quiescentInspection(), async proof => {
    const facts = describeResourceFacts(proof)
    assert.equal(facts.verdict, 'all_verified_quiescent')
    assert.equal(facts.releaseBarrierSatisfied, true)
    assert.equal(facts.counts.total, 1)
    assert.ok(facts.proof.socketIdentity, 'the authenticated socket identity must be reported')
  })
})

test('the reported proof provenance comes from the proof, not from caller fields', async () => {
  await withProof(quiescentInspection(), async proof => {
    const facts = describeResourceFacts(proof)
    assert.equal(facts.proof.runnerIdentityRef, 'runner-1')
    assert.equal(facts.proof.attempt.fenceEpoch, 3)
    assert.equal(facts.proof.state, 'terminated')
    // A caller cannot inject a different machine: there is no machine field to set.
    assert.equal(typeof facts.proof.socketIdentity.ino, 'number')
  })
})

test('requiredAt is validated rather than echoed', async () => {
  const observedAt = new Date(Date.now() - 60_000).toISOString()
  await withProof(quiescentInspection({ observedAt }), async proof => {
    // The proof is fresh, so requiring a past instant is fine.
    const ok = describeResourceFacts(proof, { requiredAt: new Date(Date.now() - 120_000).toISOString() })
    assert.equal(ok.releaseBarrierSatisfied, true)

    // Requiring a future instant cannot be satisfied by an older observation.
    const stale = describeResourceFacts(proof, { requiredAt: new Date(Date.now() + 60_000).toISOString() })
    assert.equal(stale.verdict, 'refused')
    assert.equal(stale.releaseBarrierSatisfied, false)
    assert.equal(stale.reason, 'stale_relative_to_requirement')
    assert.ok(stale.invalidInferencesDetected.includes('stale_proof'))
  })
})

test('an invalid requiredAt is refused instead of skipped', async () => {
  await withProof(quiescentInspection(), async proof => {
    const facts = describeResourceFacts(proof, { requiredAt: 'not-a-timestamp' })
    assert.equal(facts.releaseBarrierSatisfied, false)
    assert.equal(facts.reason, 'stale_relative_to_requirement')
  })
})

test('an expired proof is refused by the existing transport rule', async () => {
  await withProof(quiescentInspection(), async proof => {
    // maxAgeMs of 1ms with a tiny wait exhausts the transport's own freshness window.
    await new Promise(resolve => setTimeout(resolve, 10))
    const facts = describeResourceFacts(proof, { maxAgeMs: 1 })
    assert.equal(facts.verdict, 'refused')
    assert.equal(facts.reason, 'stale_proof')
    assert.equal(facts.releaseBarrierSatisfied, false)
  })
})

// ===============================================================================================
// B2: the barrier semantics on authenticated input
// ===============================================================================================

test('serving is not a release even when every writer is quiescent', async () => {
  await withProof(quiescentInspection({ state: 'serving' }), async proof => {
    const facts = describeResourceFacts(proof)
    assert.equal(facts.releaseBarrierSatisfied, false)
    assert.ok(facts.invalidInferencesDetected.includes('serving'))
  })
})

test('open admission keeps a quiescent writer unresolved', async () => {
  await withProof(quiescentInspection({ admission: 'open' }), async proof => {
    const facts = describeResourceFacts(proof)
    assert.equal(facts.releaseBarrierSatisfied, false)
  })
})

test('partial coverage cannot vouch for a registered resource', async () => {
  await withProof(quiescentInspection({ coverage: 'partial' }), async proof => {
    const facts = describeResourceFacts(proof)
    assert.equal(facts.releaseBarrierSatisfied, false)
    assert.ok(facts.invalidInferencesDetected.includes('partial_coverage'))
  })
})

test('an active writer blocks the barrier', async () => {
  await withProof(
    quiescentInspection({ resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'active', evidence: ['running'] }] }),
    async proof => {
      const facts = describeResourceFacts(proof)
      assert.equal(facts.verdict, 'possibly_active')
      assert.equal(facts.releaseBarrierSatisfied, false)
    },
  )
})

test('an indeterminate writer blocks the barrier', async () => {
  await withProof(
    quiescentInspection({ resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'indeterminate', evidence: [] }] }),
    async proof => {
      const facts = describeResourceFacts(proof)
      assert.equal(facts.verdict, 'unknown')
      assert.equal(facts.releaseBarrierSatisfied, false)
    },
  )
})

test('a quiescent writer without evidence cannot be audited', async () => {
  await withProof(
    quiescentInspection({ resources: [{ ref: 'proc-1', ownership: 'spawned_process', writer: 'quiescent', evidence: [] }] }),
    async proof => {
      const facts = describeResourceFacts(proof)
      assert.equal(facts.releaseBarrierSatisfied, false)
    },
  )
})

test('no registered resources never satisfies the barrier', async () => {
  await withProof(quiescentInspection({ resources: [] }), async proof => {
    const facts = describeResourceFacts(proof)
    assert.equal(facts.verdict, 'no_resources_observed')
    assert.equal(facts.releaseBarrierSatisfied, false)
  })
})

test('one unknown resource keeps the whole set unresolved', async () => {
  await withProof(
    quiescentInspection({
      resources: [
        { ref: 'proc-1', ownership: 'spawned_process', writer: 'quiescent', evidence: ['exited'] },
        { ref: 'proc-2', ownership: 'shared_service_session', writer: 'indeterminate', evidence: [] },
      ],
    }),
    async proof => {
      const facts = describeResourceFacts(proof)
      assert.notEqual(facts.verdict, 'all_verified_quiescent')
      assert.equal(facts.releaseBarrierSatisfied, false)
      assert.equal(facts.counts.unknown, 1)
    },
  )
})

test('classified resources always carry a declared verdict and a reason when unresolved', async () => {
  await withProof(
    quiescentInspection({
      resources: [
        { ref: 'proc-1', ownership: 'spawned_process', writer: 'active', evidence: [] },
        { ref: 'proc-2', ownership: 'spawned_process', writer: 'quiescent', evidence: ['exited'] },
      ],
    }),
    async proof => {
      const facts = describeResourceFacts(proof)
      for (const resource of facts.resources) {
        assert.ok(RESOURCE_VERDICTS.includes(resource.verdict))
        if (resource.verdict !== 'verified_quiescent') assert.ok(resource.reasons.length > 0)
      }
    },
  )
})

test('classifyVerifiedResource refuses a bare resource with no authenticated binding', () => {
  // Exported for reuse, but without a proof it can only refuse: there is no machine to appeal to.
  const result = classifyVerifiedResource({ ref: 'proc-1', writer: 'quiescent', evidence: ['x'] }, quiescentInspection(), null)
  assert.equal(result.verdict, 'unknown')
  assert.ok(result.reasons.includes(INVALID_INFERENCES.plain_json))
})

test('the digest changes with the trusted picture and is a full sha256', async () => {
  await withProof(quiescentInspection(), async proof => {
    const clean = describeResourceFacts(proof)
    assert.match(resourceFactsDigest(clean), /^[a-f0-9]{64}$/)
    const other = describeResourceFacts(proof, { requiredAt: new Date(Date.now() + 60_000).toISOString() })
    assert.notEqual(resourceFactsDigest(clean), resourceFactsDigest(other))
  })
})

test('the barrier always refuses to over-claim', async () => {
  await withProof(quiescentInspection(), async proof => {
    const facts = describeResourceFacts(proof)
    assert.ok(facts.notClaimed.length >= 4)
    assert.match(facts.notClaimed.join(' '), /unobserved writer/)
    assert.match(facts.notClaimed.join(' '), /new generation/)
    assert.match(facts.notClaimed.join(' '), /diagnostic summary/)
  })
})

test('the existing transport still rejects a proof it did not issue', () => {
  // This is the invariant resource-facts relies on; asserting it here keeps the dependency honest.
  assert.throws(() => verifiedRunnerInspection({ inspection: quiescentInspection() }))
})
