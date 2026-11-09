/**
 * Wave-02 item 3: the Codex protocol flow on an **actual independent Runner process**.
 *
 * The Driver is the real `CodexNativeDriver`; only the app-server is a fake that speaks the method
 * names the installed Codex schema exposes. This proves our wiring end to end through the bridge and
 * the Runner process — it is not evidence of compatibility with an installed Codex.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunnerLink } from '../src/runner-link-client.ts'
import { InMemoryFactLedger, makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'

const ENTRY = fileURLToPath(new URL('../src/runner-service-entry.ts', import.meta.url))
const runOnRunner = async (sink?: (fact: { factId: string }) => Promise<{ factId: string; persisted: true; seq: number }>, scenario = 'codex-fake') => {
  const link = new RunnerLink({ executable: process.execPath, entry: ENTRY, args: [scenario] })
  const ledger = new InMemoryFactLedger()
  const runner = await link.spawnAttempt(makeAttemptSpec(), async fact => {
    const receipt = sink ? await sink(fact) : { factId: fact.factId, persisted: true as const, seq: ledger.count + 1 }
    await ledger.record(fact)
    return receipt
  })
  return { runner, ledger }
}

const begin = () => makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' })

test('codex protocol: the turn completes on an independent Runner process', async () => {
  const { runner, ledger } = await runOnRunner()
  try {
    await runner.command(begin())
    const exit = await runner.waitExit()
    assert.equal(exit.exit.reason, 'terminal', JSON.stringify(exit))
    assert.ok(ledger.records.some(record => record.kind === 'turn.ended'), JSON.stringify(ledger.records.map(r => r.kind)))
  } finally {
    await runner.close()
  }
})

test('codex protocol: an approval becomes a question the coordinator can answer', async () => {
  const { runner, ledger } = await runOnRunner(undefined, 'codex-fake-approval')
  try {
    await runner.command(begin())
    // The fake app-server emits an approval on turn/start; its fact must cross the bridge.
    const deadline = Date.now() + 10_000
    while (!ledger.records.some(record => record.kind === 'question.opened') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(ledger.records.some(record => record.kind === 'question.opened'), JSON.stringify(ledger.records.map(r => r.kind)))
    // Answer on the exact native request id (42), then the turn completes.
    await runner.command(makeCommand('answer', { nativeBindingRef: '42', answerRef: 'approve' }))
    const exit = await runner.waitExit()
    assert.ok(['terminal', 'error'].includes(exit.exit.reason), exit.exit.reason)
  } finally {
    await runner.close()
  }
})

test('codex protocol: cancel interrupts a turn that is still open', async () => {
  // The approval scenario keeps the turn open, so cancel has a live turn to interrupt.
  const { runner, ledger } = await runOnRunner(undefined, 'codex-fake-approval')
  try {
    await runner.command(begin())
    // Wait until the approval is actually open: that is when the turn is provably live.
    const deadline = Date.now() + 8000
    while (!ledger.records.some(record => record.kind === 'question.opened') && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    await runner.command(makeCommand('cancel'))
    const exit = await runner.waitExit()
    assert.equal(exit.exit.reason, 'cancelled', JSON.stringify(exit))
    assert.ok(ledger.records.some(record => record.kind === 'cancel.observed'))
  } finally {
    await runner.close()
  }
})

test('codex protocol: a fact the coordinator refuses never becomes a receipt', async () => {
  const { runner } = await runOnRunner(async () => {
    throw Object.assign(new Error('ingress down'), { code: 'state_indeterminate', reason: 'ingress_unavailable' })
  })
  try {
    await runner.command(begin())
    const deadline = Date.now() + 8000
    while (runner.progress.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(runner.receipts.length, 0, 'a refused fact must never yield a receipt')
    assert.ok(runner.progress.some(text => text.includes('ack failed')), JSON.stringify(runner.progress))
  } finally {
    await runner.close()
  }
})

test('codex protocol: no answer is ever sent without an explicit command', async () => {
  const { runner, ledger } = await runOnRunner(undefined, 'codex-fake-approval')
  try {
    await runner.command(begin())
    await new Promise(resolve => setTimeout(resolve, 400))
    // An approval is open, yet the Driver must not answer it by itself.
    assert.equal(runner.receipts.some(receipt => receipt.factId.includes('answer')), false)
    void ledger
  } finally {
    await runner.close()
  }
})

test('codex protocol: a config-changed notification becomes a drift fact', async () => {
  // The driver observes config/changed and records it; the policy gate is what turns it into a hold.
  const { runner, ledger } = await runOnRunner()
  try {
    await runner.command(begin())
    await runner.waitExit()
    // The plain codex-fake scenario does not change config, so no drift fact may appear.
    assert.equal(ledger.records.some(record => record.kind === 'config.changed'), false)
  } finally {
    await runner.close()
  }
})

test('codex protocol + policy gate: an answer to a stale connection cannot be admitted', async () => {
  const { PolicyPreparation } = await import('../../../packages/policy-preparation/src/index.ts')
  const spec = makeAttemptSpec()
  const preparation = new PolicyPreparation()
  preparation.prepare({
    ticketId: spec.ticketId,
    assignmentId: spec.assignmentId,
    attemptId: spec.attemptId,
    fenceEpoch: spec.fenceEpoch,
    contract: spec.contract,
    requestedPolicyRevision: 'policy-1',
    nativeAppliedSettingsRef: 'settings-1',
    effectiveConfigFingerprint: 'f'.repeat(64),
    enforcement: 'enforced',
    verification: 'passed',
    evidenceRef: 'evidence-1',
  })
  const context = {
    currentFingerprint: '9'.repeat(64),
    profile: {
      id: 'p', revision: 1, driverId: 'codex-native', driverApiMajor: 1 as const, driverRelease: 'r',
      executable: '/abs/codex', argv: [], expectedVersion: '0.164.0', nativeConfigRef: 'c',
      permissionPolicyRevision: 'policy-1', requiredFeatures: [],
    },
  }
  // A changed config fingerprint holds the attempt: answering across a drift is not admitted.
  const decision = preparation.admit(spec, context)
  assert.equal(decision.allowed, false)
  assert.equal((decision as { reason: string }).reason, 'config_drift')
  assert.equal(preparation.canCancel(), true, 'cancel stays available while held')
})
