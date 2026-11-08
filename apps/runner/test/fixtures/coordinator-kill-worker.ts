/**
 * Coordinator SIGKILL survival proof (wave-02 B2, checkpoint §"Pending Integration" item 2).
 *
 * The Runner is a *separate* process. Killing the coordinator must:
 *   1. leave the Runner process and its owned native process group alive (no orphan launch);
 *   2. keep unacknowledged critical facts durable in the Runner's journal;
 *   3. let a new coordinator reconnect to a **new** Runner and replay only facts, never a begin;
 *   4. leave the old Runner's process group attributable and killable.
 *
 * This file is the worker for `coordinator-kill.test.ts`: the test spawns it as the "coordinator",
 * then SIGKILLs it. The worker spawns the Runner and prints what it knows before dying.
 */
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { encodeFrame } from '../../../../packages/driver-kit/src/index.ts'
import { makeAttemptSpec, makeCommand } from '../../../../packages/testing/src/index.ts'

const [stateFile, runnerEntry, scenario] = process.argv.slice(2)
if (!stateFile || !runnerEntry) {
  process.stderr.write('usage: coordinator-kill-worker.mjs <stateFile> <runnerEntry> [scenario]\n')
  process.exit(2)
}

const runner = spawn(process.execPath, [runnerEntry, scenario ?? 'waiting-user'], { stdio: ['pipe', 'pipe', 'pipe'] })
const spec = makeAttemptSpec()

const write = (value: unknown): void => {
  runner.stdin.write(encodeFrame(value))
}

// Report what the coordinator knows *before* it dies; the test reads this file afterwards.
const state: { coordinatorPid: number; runnerPid: number | undefined; attemptId: string; frames: string[]; stderr?: string } = {
  coordinatorPid: process.pid,
  runnerPid: runner.pid,
  attemptId: spec.attemptId,
  frames: [],
}
const persist = (): void => {
  writeFileSync(stateFile, JSON.stringify(state, null, 2))
}
persist()

write({
  v: 1,
  type: 'bootstrap',
  id: 'bootstrap',
  spec,
  payloadRoot: stateFile.replace(/[^/]+$/, 'payloads'),
  journalPath: stateFile.replace(/[^/]+$/, 'critical.journal'),
  producer: { source: 'coordinator-kill-worker', runnerIdentityRef: `runner-${spec.attemptId}` },
})

const lines = createInterface({ input: runner.stdout })
lines.on('line', line => {
  let frame: Record<string, unknown>
  try {
    frame = JSON.parse(line) as Record<string, unknown>
  } catch {
    return
  }
  state.frames.push(String(frame.type))
  if (frame.type === 'ready') {
    // Begin, then die: the runner and its native child must outlive us.
    write({ v: 1, type: 'command', id: 'c1', command: makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }) })
    persist()
  }
  if (frame.type === 'fact') {
    // Deliberately never acknowledge: the fact must survive in the Runner journal.
    persist()
  }
  if (frame.type === 'payload-read') {
    write({ v: 1, type: 'payload', id: String(frame.requestId), requestId: String(frame.requestId), value: { kind: 'turn.ended', value: { nativeTurnRef: 'turn-1', outcome: 'completed', candidateAvailable: false, evidenceRefs: ['e'] } } })
    return
  }
  persist()
})

runner.stderr.on('data', chunk => {
  state.stderr = `${state.stderr ?? ''}${String(chunk)}`.slice(0, 4096)
  persist()
})

// Stay alive until the test kills us.
setInterval(() => persist(), 100)
