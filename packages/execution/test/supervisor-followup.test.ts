/**
 * Follow-up review negatives (agent-tasks/g1-followup-review.md), B side:
 * deterministic command identity, ended-epoch reuse, cancellation during an awaited launch,
 * referenced stop lifetime and unobservable process groups.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync } from 'node:child_process'
import { AttemptSupervisor } from '../src/supervisor.ts'
import { canonicalCommandKey } from '../src/supervisor.ts'
import type { AttemptBinding } from '../src/contracts.ts'
import { FakeRunnerHost, InMemoryFactLedger, makeAttemptSpec } from '../../testing/src/index.ts'
// The process host is owned by apps/runner; this test reaches it the way the coordinator will.
import { ProcessHost } from '../../../apps/runner/src/process-host.ts'
import { RunnerCommandSchema } from '../../contracts/src/schemas.ts'

class MemoryBindings {
  readonly #byTicket = new Map<string, AttemptBinding>()
  current(ticketId: string): AttemptBinding | undefined {
    return this.#byTicket.get(ticketId)
  }
  save(binding: AttemptBinding): void {
    this.#byTicket.set(binding.ticketId, binding)
  }
}

function fixture(runner?: FakeRunnerHost) {
  const host = runner ?? new FakeRunnerHost()
  const sup = new AttemptSupervisor({
    runner: host,
    bindings: new MemoryBindings(),
    sink: new InMemoryFactLedger(),
    preparedPolicyRef: 'prepared-1',
    stopDeadlineMs: 500,
  })
  return { sup, runner: host }
}

function input(overrides: { attemptId?: string; fenceEpoch?: number } = {}) {
  const spec = makeAttemptSpec(overrides)
  return {
    ticketId: spec.ticketId,
    assignmentId: spec.assignmentId,
    attemptId: spec.attemptId,
    fenceEpoch: spec.fenceEpoch,
    contract: spec.contract,
    spec,
    initialInputRef: 'input-initial-1',
  }
}

// --- B-COMMAND-DELIMITER ----------------------------------------------------

test('B-COMMAND-DELIMITER: unescaped separators cannot collide', () => {
  const tuple = { attemptId: 'attempt-1', fenceEpoch: 1 }
  const left = AttemptSupervisor.commandId(tuple, { kind: 'answer', nativeBindingRef: 'a:b', answerRef: 'c' })
  const right = AttemptSupervisor.commandId(tuple, { kind: 'answer', nativeBindingRef: 'a', answerRef: 'b:c' })
  assert.notEqual(left, right, `ids collided: ${left}`)
})

test('B-COMMAND-DELIMITER: ids stay within the contract Id charset and length', () => {
  const tuple = { attemptId: 'a'.repeat(80), fenceEpoch: 12 }
  const id = AttemptSupervisor.commandId(tuple, { kind: 'answer', nativeBindingRef: 'x'.repeat(100), answerRef: 'y'.repeat(100) })
  assert.ok(id.length <= 128, `id too long: ${id.length}`)
  assert.match(id, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
})

test('B-COMMAND-DELIMITER: an absent field and an explicit value are distinguished', () => {
  const tuple = { attemptId: 'attempt-1', fenceEpoch: 1 }
  const absent = canonicalCommandKey(tuple, { kind: 'deliver', inputRef: 'i' })
  const present = canonicalCommandKey(tuple, { kind: 'deliver', inputRef: 'i', expectedTurnRef: 'turn-1' })
  assert.notEqual(absent, present, 'an absent field and an explicit value must differ')
  assert.ok(absent.includes('expectedTurnRef=<absent>'), absent)
  // Different kind, same payload text, must still differ.
  assert.notEqual(
    canonicalCommandKey(tuple, { kind: 'deliver', inputRef: 'i' }),
    canonicalCommandKey(tuple, { kind: 'begin', inputRef: 'i', preparedPolicyRef: 'i' }),
  )
})

test('B-COMMAND-DELIMITER: identical logical retries keep one id', () => {
  const tuple = { attemptId: 'attempt-1', fenceEpoch: 1 }
  const a = AttemptSupervisor.commandId(tuple, { kind: 'deliver', inputRef: 'i', expectedTurnRef: 't' })
  const b = AttemptSupervisor.commandId({ attemptId: 'attempt-1', fenceEpoch: 1 }, { kind: 'deliver', inputRef: 'i', expectedTurnRef: 't' })
  assert.equal(a, b)
})

// --- B-COMMAND-EXPECTED-TURN ------------------------------------------------

test('B-COMMAND-EXPECTED-TURN: the same input with a different expected turn gets a new id', async () => {
  const { sup, runner } = fixture()
  await sup.start(input())
  await sup.deliver('ticket-1', 'same-input', 'turn-1')
  await sup.deliver('ticket-1', 'same-input', 'turn-2')
  const deliveries = runner.last()!.commands.filter(command => command.kind === 'deliver')
  assert.equal(deliveries.length, 2)
  assert.notEqual(deliveries[0]!.id, deliveries[1]!.id, 'expectedTurnRef changes the sent bytes and must change the id')
  for (const command of deliveries) assert.equal(RunnerCommandSchema.safeParse(command).success, true)
})

test('B-COMMAND-EXPECTED-TURN: an identical deliver retry keeps its id', async () => {
  const { sup, runner } = fixture()
  await sup.start(input())
  await sup.deliver('ticket-1', 'same-input', 'turn-1')
  await sup.deliver('ticket-1', 'same-input', 'turn-1')
  const deliveries = runner.last()!.commands.filter(command => command.kind === 'deliver')
  assert.equal(deliveries[0]!.id, deliveries[1]!.id)
})

// --- B-ENDED-EPOCH-REUSE ----------------------------------------------------

test('B-ENDED-EPOCH-REUSE: an ended binding cannot be restarted with the same attempt/epoch', async () => {
  const { sup } = fixture()
  await sup.start(input())
  await sup.stop('ticket-1', 'done')
  await assert.rejects(
    () => sup.start(input()),
    error => ['stale_start', 'attempt_id_reused'].includes((error as { reason?: string }).reason ?? ''),
  )
  const state = sup.binding('ticket-1')?.state
  assert.equal(state, 'ended', 'a refused restart must not resurrect the binding')
})

test('B-ENDED-EPOCH-REUSE: a new attempt must still advance the epoch', async () => {
  const { sup } = fixture()
  await sup.start(input())
  await sup.stop('ticket-1', 'done')
  // Reusing the id at a higher epoch is still an id reuse.
  await assert.rejects(
    () => sup.start(input({ attemptId: 'attempt-1', fenceEpoch: 2 })),
    error => (error as { reason?: string }).reason === 'attempt_id_reused',
  )
  // A fresh attempt id at a higher epoch is accepted.
  const next = await sup.start(input({ attemptId: 'attempt-2', fenceEpoch: 2 }))
  assert.equal(next.binding.attemptId, 'attempt-2')
  assert.equal(next.binding.fenceEpoch, 2)
})

test('B-ENDED-EPOCH-REUSE: the epoch high-water mark survives the binding ending', async () => {
  const { sup } = fixture()
  await sup.start(input({ attemptId: 'attempt-1', fenceEpoch: 3 }))
  await sup.stop('ticket-1', 'done')
  await assert.rejects(
    () => sup.start(input({ attemptId: 'attempt-3', fenceEpoch: 2 })),
    error => (error as { reason?: string }).reason === 'stale_start',
  )
})

// --- B-CANCEL-DURING-LAUNCH -------------------------------------------------

test('B-CANCEL-DURING-LAUNCH: a stop while the launch is pending vetoes begin', async () => {
  let release: (value: unknown) => void = () => undefined
  const waiting = new Promise(resolve => {
    release = resolve
  })
  const { sup, runner } = fixture()
  // Override the runner so launch() blocks until released.
  const base = runner as unknown as { launch: (spec: unknown) => Promise<unknown> }
  const realLaunch = base.launch.bind(runner)
  ;(runner as unknown as { launch: (spec: unknown) => Promise<unknown> }).launch = async (spec: unknown) => {
    await waiting
    return realLaunch(spec)
  }

  const starting = sup.start(input())
  await Promise.resolve()
  const stop = await sup.stop('ticket-1', 'cancel-during-launch')
  release(undefined)
  let startRejected = false
  try {
    await starting
  } catch {
    startRejected = true
  }

  assert.equal(startRejected, true, 'a cancelled launch must not report success')
  assert.equal(stop.state, 'stopping')
  const commands = runner.last()?.commands ?? []
  assert.equal(commands.some(command => command.kind === 'begin'), false, 'begin must never be sent after a stop')
})

test('B-CANCEL-DURING-LAUNCH: a stop with no pending launch still behaves as before', async () => {
  const { sup } = fixture()
  await sup.start(input())
  const stopped = await sup.stop('ticket-1', 'user_requested')
  assert.equal(stopped.state, 'ended')
  assert.equal(stopped.quiescence, 'confirmed')
})

// --- stop lifetime + observation -------------------------------------------

test('stopOwned keeps the event loop alive: a tiny process that only awaits a stop exits 0', () => {
  // The child does nothing but spawn one process and await the stop. If the stop's polling timer were
  // unref'd, the child would exit before the stop resolves (exit 13 in the review).
  const program = `
    const { ProcessHost } = await import(${JSON.stringify(new URL('../../../apps/runner/src/process-host.ts', import.meta.url).href)});
    const host = new ProcessHost();
    const resource = await host.spawn({ executable: process.execPath, argv: ['--input-type=module','-e','setInterval(()=>{},1000)'], cwdRef: 'c', environmentRef: 'e' });
    const stopped = await host.stopOwned(resource.resourceRef, 100);
    process.stdout.write('RESULT:' + JSON.stringify({ quiescence: stopped.quiescence }));
  `
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 20_000 })
  const marker = result.indexOf('RESULT:')
  assert.notEqual(marker, -1, `child produced no result: ${result}`)
  const parsed = JSON.parse(result.slice(marker + 'RESULT:'.length).trim())
  assert.equal(parsed.quiescence, 'confirmed', result)
})

test('an unobservable group is indeterminate, never "empty"', async () => {
  // Force the observation itself to fail by pointing PATH at a directory with no `ps` for the host.
  const host = new ProcessHost({
    // Simulate a broken ps: the group leader is alive, but observation must not claim "no members".
    readStartMarker: () => 'marker-stable',
  })
  const originalPath = process.env.PATH
  const resource = await host.spawn({
    executable: process.execPath,
    argv: ['--input-type=module', '-e', 'setInterval(()=>{},1000)'],
    cwdRef: 'c',
    environmentRef: 'e',
  })
  try {
    // Make ps unavailable for the duration of the stop.
    process.env.PATH = '/nonexistent'
    const stopped = await host.stopOwned(resource.resourceRef, 300)
    assert.equal(stopped.quiescence, 'indeterminate', JSON.stringify(stopped.evidenceRefs))
    assert.ok(
      stopped.evidenceRefs.some(ref => ref.startsWith('group-unobservable') || ref.startsWith('still-alive')),
      `expected an explicit observation complaint: ${JSON.stringify(stopped.evidenceRefs)}`,
    )
  } finally {
    process.env.PATH = originalPath
    try {
      process.kill(-resource.identity.groupId, 'SIGKILL')
    } catch {
      // already gone
    }
    await host.stopAll(500)
  }
})
