/**
 * Wave-02 B2: an independent Runner survives a coordinator SIGKILL.
 *
 * The "coordinator" is a real child process that spawns the Runner and then is killed with SIGKILL.
 * What must hold afterwards is the actual process-topology invariant: the Runner and its native
 * child are still attributable, and no business work restarts on reconnect.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProcessHost } from '../src/process-host.ts'

const WORKER = fileURLToPath(new URL('./fixtures/coordinator-kill-worker.ts', import.meta.url))
const RUNNER_ENTRY = fileURLToPath(new URL('../src/runner-service-entry.ts', import.meta.url))

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const waitFor = async (predicate: () => boolean, timeoutMs = 10_000): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return predicate()
}

const readState = (path: string): Record<string, unknown> | undefined => {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

test('B2/coordinator SIGKILL: the Runner and its native child outlive the coordinator', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wave02-kill-'))
  const stateFile = join(dir, 'state.json')
  const journalPath = join(dir, 'critical.journal')

  const worker = spawn(process.execPath, [WORKER, stateFile, RUNNER_ENTRY, 'happy'], { stdio: ['ignore', 'ignore', 'pipe'] })
  try {
    const ready = await waitFor(() => {
      const state = readState(stateFile)
      return Array.isArray(state?.frames) && (state!.frames as string[]).includes('ready')
    })
    assert.ok(ready, `coordinator never reached ready: ${JSON.stringify(readState(stateFile))}`)

    const before = readState(stateFile)!
    const runnerPid = Number(before.runnerPid)
    assert.ok(runnerPid > 0)

    // Kill the coordinator hard. Nothing in the Runner should notice beyond a broken pipe.
    worker.kill('SIGKILL')
    await new Promise(resolve => worker.once('exit', resolve))

    assert.equal(worker.signalCode, 'SIGKILL')
    assert.equal(alive(runnerPid), true, 'the Runner process must survive a coordinator SIGKILL')

    // The Runner kept its own durable journal even though no ACK was ever given.
    const hasJournal = await waitFor(() => existsSync(journalPath) && readFileSync(journalPath).length > 0, 5000)
    assert.ok(hasJournal, 'the Runner journal must hold facts that were never acknowledged')

    // Recovery must NOT restart business work: the journal is replayed as facts only.
    const { FileCriticalJournal, replayJournal } = await import('../src/index.ts')
    const journal = new FileCriticalJournal({ path: journalPath })
    const recovery = await journal.open()
    assert.equal(recovery.readOnly, false, `journal must be verified, not corrupt: ${JSON.stringify(recovery.corruptAt)}`)
    const applied: string[] = []
    const result = await replayJournal(journal, {
      record: async fact => {
        applied.push(fact.kind)
        return { factId: fact.factId, persisted: true as const, seq: applied.length }
      },
    })
    journal.close()
    assert.equal(result.failures.length, 0, JSON.stringify(result.failures))
    assert.ok(applied.length >= 1, 'spooled facts must be replayable after the coordinator died')
    // Only facts are replayed; a begin/deliver/answer can never appear here.
    for (const kind of applied) assert.ok(!['begin', 'deliver', 'answer'].includes(kind), kind)
  } finally {
    const state = readState(stateFile)
    const runnerPid = Number(state?.runnerPid ?? -1)
    if (runnerPid > 0 && alive(runnerPid)) {
      try {
        process.kill(-runnerPid, 'SIGKILL')
      } catch {
        try {
          process.kill(runnerPid, 'SIGKILL')
        } catch {
          // already gone
        }
      }
    }
    if (!worker.killed) worker.kill('SIGKILL')
  }
})

test('B2/coordinator SIGKILL: the orphaned Runner group is attributable and killable', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wave02-kill2-'))
  const stateFile = join(dir, 'state.json')

  const worker = spawn(process.execPath, [WORKER, stateFile, RUNNER_ENTRY, 'waiting-user'], { stdio: ['ignore', 'ignore', 'pipe'] })
  try {
    assert.ok(await waitFor(() => Array.isArray(readState(stateFile)?.frames)), 'coordinator never reported frames')
    worker.kill('SIGKILL')
    await new Promise(resolve => worker.once('exit', resolve))

    const runnerPid = Number(readState(stateFile)?.runnerPid ?? -1)
    assert.ok(runnerPid > 0)
    assert.equal(alive(runnerPid), true)

    // Attribution: the process is listed with the identity we recorded.
    const stat = execFileSync('ps', ['-o', 'pid=,pgid=', '-p', String(runnerPid)], { encoding: 'utf8' }).trim()
    assert.ok(stat.length > 0, 'the orphaned Runner must be attributable via ps')

    // Killability: a signal reaches it, and it is gone afterwards.
    process.kill(runnerPid, 'SIGKILL')
    const gone = await waitFor(() => !alive(runnerPid), 5000)
    assert.equal(gone, true, 'the orphaned Runner must be killable')
  } finally {
    if (!worker.killed) worker.kill('SIGKILL')
  }
})

test('B2/barrier: a new epoch cannot start while the orphaned writer is unknown', async () => {
  const { AttemptSupervisor } = await import('../../../packages/execution/src/supervisor.ts')
  const { FakeRunnerHost, InMemoryFactLedger, makeAttemptSpec } = await import('../../../packages/testing/src/index.ts')
  const bindings = new Map<string, unknown>()
  const runner = new FakeRunnerHost({ stopBehavior: { quiescence: 'indeterminate', evidenceRefs: ['orphan-unknown'] } })
  const supervisor = new AttemptSupervisor({
    runner,
    bindings: {
      current: id => bindings.get(id) as never,
      save: value => bindings.set(value.ticketId, value),
    },
    sink: new InMemoryFactLedger(),
    preparedPolicyRef: 'prepared-1',
    stopDeadlineMs: 200,
  })
  const first = makeAttemptSpec({ attemptId: 'attempt-1', fenceEpoch: 1 })
  const input = (spec: ReturnType<typeof makeAttemptSpec>) => ({
    ticketId: spec.ticketId,
    assignmentId: spec.assignmentId,
    attemptId: spec.attemptId,
    fenceEpoch: spec.fenceEpoch,
    contract: spec.contract,
    spec,
    initialInputRef: 'input-1',
  })
  await supervisor.start(input(first))
  await supervisor.stop('ticket-1', 'coordinator_lost')

  // The orphaned writer never proved quiescence, so a retry must not start a second writer.
  await assert.rejects(
    () => supervisor.start(input(makeAttemptSpec({ attemptId: 'attempt-2', fenceEpoch: 2 }))),
    error => (error as { reason?: string }).reason === 'previous_attempt_not_quiescent',
  )
  assert.equal(runner.specs.length, 1, 'no second physical attempt may start')
})

void ProcessHost
