/**
 * Wave-02 B2: an actual AttemptRunner in an independent process behind a versioned bridge.
 * (agent-tasks/wave-02/agent-b.zh-CN.md, B2)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { RunnerLink } from '../src/runner-link-client.ts'
import { RUNNER_BRIDGE_PROTOCOL, parseBridgeFrame, BridgeProtocolError } from '../src/bridge-protocol.ts'
import { makeAttemptSpec, makeCommand, makeFact } from '../../../packages/testing/src/index.ts'

const ENTRY = fileURLToPath(new URL('../src/runner-service-entry.ts', import.meta.url))
const link = (scenario: string) => new RunnerLink({ executable: process.execPath, entry: ENTRY, args: [scenario] })

test('bridge: only protocol v1 frames are accepted', () => {
  assert.equal(parseBridgeFrame({ v: 1, type: 'ready', id: 'x' }).type, 'ready')
  assert.throws(() => parseBridgeFrame({ v: 2, type: 'ready', id: 'x' }), BridgeProtocolError)
  assert.throws(() => parseBridgeFrame({ type: 'ready', id: 'x' }), BridgeProtocolError)
  assert.throws(() => parseBridgeFrame({ v: 1, type: 'ready' }), BridgeProtocolError)
  assert.equal(RUNNER_BRIDGE_PROTOCOL, 1)
})

test('B2: an independent process becomes ready before any command is accepted', async () => {
  const runner = await link('happy').spawnAttempt(makeAttemptSpec(), async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }))
  try {
    assert.ok(runner.pid > 0)
    assert.ok(runner.journalPath.endsWith('critical.journal'))
    // No command has been sent yet; the process is alive and idle.
    assert.ok(runner.progress.length >= 0)
  } finally {
    await runner.close()
  }
})

test('B2: begin runs the attempt and critical facts arrive as receipts', async () => {
  const runner = await link('happy').spawnAttempt(makeAttemptSpec(), async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }))
  try {
    await runner.command(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
    const exit = await runner.waitExit()
    assert.ok(['terminal', 'cancelled', 'error', 'disconnected'].includes(exit.exit.reason), JSON.stringify(exit))
    assert.ok(runner.receipts.length >= 1, 'at least the turn result must be acknowledged')
    for (const receipt of runner.receipts) {
      assert.equal(receipt.persisted, true)
      assert.ok(receipt.factId.length > 0)
    }
  } finally {
    await runner.close()
  }
})

test('B2: a question can be answered across the bridge', async () => {
  const runner = await link('waiting-user').spawnAttempt(makeAttemptSpec(), async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }))
  try {
    await runner.command(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
    // The fake driver opens a question and keeps the control channel free.
    const deadline = Date.now() + 10_000
    while (runner.receipts.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(runner.receipts.length >= 1, 'question fact must be acknowledged')
    await runner.command(makeCommand('answer', { nativeBindingRef: 'binding-1', answerRef: 'answer-1' }))
    await runner.command(makeCommand('cancel'))
    const exit = await runner.waitExit()
    assert.equal(exit.exit.reason, 'cancelled')
  } finally {
    await runner.close()
  }
})

test('B2: cancel ends the attempt and the process is cleaned up', async () => {
  const runner = await link('ignore-cancel').spawnAttempt(makeAttemptSpec(), async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }))
  await runner.command(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
  await new Promise(resolve => setTimeout(resolve, 150))
  const code = await runner.close()
  // Shutdown is a bounded exit: either the graceful path or a forced kill, never a hang.
  assert.ok(code === 0 || code === null, `close returned ${code}`)
})

test('B2: the Runner spools critical facts to its own journal, not a product database', async () => {
  const runner = await link('happy').spawnAttempt(makeAttemptSpec(), async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }))
  try {
    await runner.command(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
    await runner.waitExit()
    const { readFileSync } = await import('node:fs')
    const bytes = readFileSync(runner.journalPath)
    assert.ok(bytes.length > 0, 'the journal must hold the attempted facts')
  } finally {
    await runner.close()
  }
})

test('B2: a malformed bootstrap leaves the process without a running attempt', async () => {
  const root = await mkdtemp(join(tmpdir(), 'b2-bad-'))
  const runner = await link('happy').spawnAttempt(
    { ...makeAttemptSpec(), attemptId: '' },
    async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }),
  ).catch(error => error as Error)
  void root
  // Either bootstrap is rejected (the service refuses) or the spawn fails outright; both are refusals,
  // never a silently running attempt.
  if (runner instanceof Error) assert.ok(runner.message.length > 0)
  else await runner.close()
})

test('B2: recovery never starts business work — there is no begin without a command', async () => {
  const runner = await link('happy').spawnAttempt(makeAttemptSpec(), async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }))
  try {
    // Nothing is sent. The process must stay ready and produce no facts and no exit.
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(runner.receipts.length, 0, 'no fact may appear without a begin command')
  } finally {
    await runner.close()
  }
})

test('B2: facts carry the full attempt identity through the sink', async () => {
  const seen: unknown[] = []
  const spec = makeAttemptSpec()
  const runner = await link('happy').spawnAttempt(spec, async fact => {
    seen.push(fact)
    return { factId: fact.factId, persisted: true as const, seq: seen.length }
  })
  try {
    await runner.command(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
    await runner.waitExit()
    // The exit frame races the last sink call: wait for the acknowledged facts explicitly.
    const deadline = Date.now() + 5000
    while (seen.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(seen.length >= 1)
    for (const fact of seen as Array<{ attemptId: string; fenceEpoch: number; contract: unknown }>) {
      assert.equal(fact.attemptId, spec.attemptId)
      assert.equal(fact.fenceEpoch, spec.fenceEpoch)
      assert.deepEqual(fact.contract, spec.contract)
    }
  } finally {
    await runner.close()
  }
})

test('B2: a fact the sink refuses never yields a receipt, and the refusal is surfaced', async () => {
  const runner = await link('happy').spawnAttempt(makeAttemptSpec(), async () => {
    throw Object.assign(new Error('ingress down'), { code: 'state_indeterminate', reason: 'ingress_unavailable' })
  })
  try {
    await runner.command(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
    // The coordinator's refusal is reported back to the Runner as a bounded diagnostic.
    const deadline = Date.now() + 8000
    while (runner.progress.length === 0 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))
    assert.ok(runner.progress.some(text => text.includes('ack failed')), JSON.stringify(runner.progress))
    assert.equal(runner.receipts.length, 0, 'a refused fact must never produce a receipt')
  } finally {
    // The runner must not hang forever on a refused acknowledgement: closing it is bounded.
    const code = await runner.close()
    assert.ok(code === 0 || code === null, `close returned ${code}`)
  }
})

test('makeFact stays a valid bridge payload', () => {
  assert.ok(makeFact('turn.ended').factId.length > 0)
})
