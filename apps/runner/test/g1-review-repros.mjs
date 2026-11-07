/**
 * WP-03 review reproduction (agent-tasks/g1-agent-b-review.md).
 *
 * Equivalent to the main agent's `tools/bootstrap/review-g1-repros.mjs` B-* cases, but written
 * against this branch's current Supervisor/Runner API. The A-* storage cases belong to WP-02 and
 * are not reproduced here. Run with the repository root as the working directory:
 *
 *   node apps/runner/test/g1-review-repros.mjs
 *
 * Exits non-zero and prints the failing invariant when any case regresses.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { AttemptSupervisor } from '../../../packages/execution/src/supervisor.ts'
import { ProcessHost } from '../src/process-host.ts'
import { makeAttemptSpec } from '../../../packages/testing/src/fixtures.ts'
import { RunnerCommandSchema } from '../../../packages/contracts/src/schemas.ts'

const cases = []
const record = (id, passesInvariant, observed) => cases.push({ id, passesInvariant, observed })

const spec = makeAttemptSpec()
const bindings = new Map()
const commands = []
const attempt = {
  attemptId: spec.attemptId,
  feed: async command => {
    commands.push(command)
  },
  waitExit: async () => ({ reason: 'terminal', evidenceRefs: [] }),
  stop: async () => ({ quiescence: 'confirmed', evidenceRefs: ['fixture'] }),
}
const supervisorOptions = {
  bindings: { current: id => bindings.get(id), save: value => bindings.set(value.ticketId, value) },
  runner: { launch: async () => attempt },
  sink: { record: async fact => ({ factId: fact.factId, persisted: true, seq: 1 }) },
  preparedPolicyRef: 'prepared-1',
}

const supervisor = new AttemptSupervisor(supervisorOptions)
await supervisor.start({
  ...spec,
  spec,
  initialInputRef: 'execution-input-1',
})

// B-FROZEN-COMMAND: every command parses with the frozen schema, and begin uses an input, not policy.
const beginOk = RunnerCommandSchema.safeParse(commands[0]).success
record('B-FROZEN-COMMAND', beginOk && commands[0].inputRef !== spec.policySnapshotRef, {
  frozenSchemaValid: beginOk,
  hasContract: commands[0].contract !== undefined,
  inputRef: commands[0].inputRef,
  policySnapshotRef: spec.policySnapshotRef,
})

// B-ASSIGNMENT-FENCE: same attempt/epoch with a wrong assignment or contract must be refused.
const wrongAssignment = supervisor.fence({ ...spec, assignmentId: 'wrong-assignment' })
const wrongContract = supervisor.fence({ ...spec, contract: { ...spec.contract, revision: spec.contract.revision + 1 } })
record('B-ASSIGNMENT-FENCE', !wrongAssignment.accepted && !wrongContract.accepted, { wrongAssignment, wrongContract })

// B-COMMAND-IDENTITY: two different deliveries must not share an id.
await supervisor.deliver(spec.ticketId, 'input-1')
await supervisor.deliver(spec.ticketId, 'input-2')
const deliveryIds = commands.filter(command => command.kind === 'deliver').map(command => command.id)
record('B-COMMAND-IDENTITY', new Set(deliveryIds).size === deliveryIds.length, { deliveryIds })

// B-UNKNOWN-STOP: an unknown writer stays unknown across repeated stops.
const orphanBindings = new Map()
const orphan = new AttemptSupervisor({
  bindings: { current: id => orphanBindings.get(id), save: value => orphanBindings.set(value.ticketId, value) },
  runner: { launch: async () => ({ ...attempt, feed: async () => undefined }) },
  sink: { record: async () => ({ factId: 'f', persisted: true, seq: 1 }) },
  preparedPolicyRef: 'prepared-1',
})
const first = await orphan.stop(spec.ticketId, 'recover')
const second = await orphan.stop(spec.ticketId, 'recover')
record('B-UNKNOWN-STOP', first.state === 'stopping' && second.quiescence !== 'confirmed', { first, second })

// B-PROCESS-GROUP: a same-group descendant that ignores SIGTERM must not leave the parent's exit
// looking like quiescence.
const host = new ProcessHost()
let resource
try {
  const descendant = 'process.on("SIGTERM",()=>{});process.stdout.write("ready\\n");setInterval(()=>{},1000);'
  const parent = `import {spawn} from 'node:child_process';const c=spawn(process.execPath,['-e',${JSON.stringify(descendant)}],{stdio:['ignore','pipe','ignore']});c.stdout.once('data',()=>process.stdout.write(JSON.stringify({pid:c.pid})+'\\n'));setInterval(()=>{},1000);`
  resource = await host.spawn({
    executable: process.execPath,
    argv: ['--input-type=module', '-e', parent],
    cwdRef: 'fixture',
    environmentRef: 'fixture',
  })
  const ready = (async () => {
    let text = ''
    for await (const chunk of resource.stdout) {
      text += new TextDecoder().decode(chunk)
      if (text.includes('\n')) return JSON.parse(text.split('\n')[0])
    }
    throw new Error('no descendant readiness')
  })()
  const descendantInfo = await Promise.race([
    ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('descendant readiness timeout')), 5000)),
  ])
  const stopped = await host.stopOwned(resource.resourceRef, 100)
  let state = 'missing'
  try {
    state = execFileSync('ps', ['-o', 'stat=', '-p', String(descendantInfo.pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    // exited
  }
  const active = state !== 'missing' && !state.startsWith('Z')
  record('B-PROCESS-GROUP', !(stopped.quiescence === 'confirmed' && active), {
    stop: stopped.quiescence,
    descendantState: state,
    descendantStillActive: active,
  })
} finally {
  if (resource) {
    try {
      process.kill(-resource.identity.groupId, 'SIGKILL')
    } catch {
      // own group already gone
    }
  }
  await host.stopAll(100)
}

const report = {
  status: cases.every(item => item.passesInvariant) ? 'PASS' : 'FAIL',
  runtimeCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  node: process.version,
  platform: process.platform,
  cases,
}
console.log(JSON.stringify(report, null, 2))
assert.ok(cases.every(item => item.passesInvariant), 'A reviewed invariant regressed')
