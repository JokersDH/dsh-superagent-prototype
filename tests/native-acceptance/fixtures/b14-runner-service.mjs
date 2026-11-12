#!/usr/bin/env node
/**
 * B14 independent Runner service fixture (wave-14 B1).
 *
 * A Runner that OUTLIVES the coordinator. It owns a real child process, serves the existing
 * authenticated recovery socket, and counts every receiver invocation it actually served. The counts
 * are the evidence that a recovered coordinator did not duplicate work: counting them inside the
 * Runner means the number comes from the receiver, not from the caller's own bookkeeping.
 *
 * The owner writer pid and the epoch fence are published through the inspection so a fresh
 * coordinator can prove it is talking to the same living writer and that an old epoch is refused.
 *
 * Usage: node b14-runner-service.mjs <sceneDir>
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveRunnerRecovery } from '../../../apps/coordinator/runner-link.ts'
import { producer } from '../../integration/runtime-ingress-fixture.ts'

const sceneDir = process.argv[2]
if (!sceneDir) throw new Error('usage: <sceneDir>')

const countersPath = join(sceneDir, 'receivers.json')
const statePath = join(sceneDir, 'writer-state.json')
const counters = { inspect: 0, cancel: 0, answer: 0, begin: 0 }
const state = { epoch: Number(readFileSync(join(sceneDir, 'epoch'), 'utf8')), admission: 'open', writer: 'active', terminated: false }

const persist = () => {
  writeFileSync(countersPath, `${JSON.stringify(counters)}\n`)
  writeFileSync(statePath, `${JSON.stringify({ ...state, pid: process.pid })}\n`)
}
persist()

/** Every control command is fenced by epoch: an old epoch must not reach the live writer. */
function fence(command, kind) {
  // The receiver may be handed the command body directly or wrapped in an attempt envelope, so read
  // the epoch from wherever it actually is rather than assuming one shape.
  const epoch = command?.fenceEpoch ?? command?.attempt?.fenceEpoch ?? command?.command?.fenceEpoch
  if (Number(epoch) !== state.epoch) throw new Error(`stale_epoch: ${kind} carried epoch ${String(epoch)} but the writer is at ${state.epoch}`)
}

const service = await serveRunnerRecovery(
  { socketPath: join(sceneDir, 'runner.sock'), credentialPath: join(sceneDir, 'runner.key') },
  producer,
  {
    async inspect() {
      counters.inspect += 1
      persist()
      return {
        state: state.terminated ? 'terminated' : 'serving',
        admission: state.admission,
        coverage: 'complete_owned_resources',
        evidence: [`receiver-inspect#${counters.inspect}`, `runner-pid:${process.pid}`],
        resources: [{ ref: `writer-${process.pid}`, ownership: 'spawned_process', writer: state.writer, evidence: [`inspect#${counters.inspect}`] }],
      }
    },
    async cancel(command) {
      fence(command, 'cancel')
      counters.cancel += 1
      appendFileSync(join(sceneDir, 'cancel.log'), `cancel#${counters.cancel}\n`)
      state.admission = 'closed'
      state.writer = 'quiescent'
      state.terminated = true
      persist()
      return {
        state: 'terminated',
        admission: 'closed',
        coverage: 'complete_owned_resources',
        evidence: [`receiver-cancel#${counters.cancel}`, `runner-pid:${process.pid}`],
        resources: [{ ref: `writer-${process.pid}`, ownership: 'spawned_process', writer: 'quiescent', evidence: [`cancel#${counters.cancel}`] }],
      }
    },
  },
)

// Report readiness with the counters path so the driver can read them without guessing.
process.send?.({ ready: true, endpoint: service.endpoint, countersPath, statePath, pid: process.pid })
process.once('message', message => { if (message === 'shutdown') void service.close().then(() => process.exit(0)) })
