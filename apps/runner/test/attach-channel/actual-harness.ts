/**
 * wave-31 shared harness: drive the ACTUAL runner service and its authenticated endpoint.
 *
 * Every consumer in this package imports the real `serveRunner`, the real recovery endpoint/client
 * and the real `RunnerAttachChannel` through the service bootstrap — no service-shaped mock stands in
 * for the product path. What remains a fixture is only the *native driver* (a scripted driver that
 * records facts / asks for payloads / requests a native write), which is exactly the seam the Runner
 * documents for controlled tests.
 */
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { TestContext } from 'node:test'
import type { AttemptSpec, CriticalFact, DurableReceipt, Json, RunnerCommand, ServeExit } from '../../../../packages/contracts/src/types.ts'
import type { CriticalFactInput } from '../../../../packages/driver-kit/src/attempt-io.ts'
import { criticalFact } from '../../../../packages/driver-kit/src/attempt-io.ts'
import { makeAttemptSpec, makeCommand } from '../../../../packages/testing/src/index.ts'
import { serveRunner, type RunnerServiceHandle } from '../../src/runner-service.ts'
import { endpointDirectory } from '../../src/recovery-endpoint.ts'
import { connectRunnerRecovery, type RunnerEndpoint } from '../../../../packages/execution/src/recovery-transport.ts'

export type DriverContext = {
  readonly hooks: { beforeNativeWrite(command: RunnerCommand): Promise<void> }
  readonly io: {
    record(fact: CriticalFact): Promise<DurableReceipt>
    payloads: { read(reference: string): Promise<Json>; store(payload: Json, classification: 'critical' | 'diagnostic'): Promise<string> }
  }
  readonly spec: AttemptSpec
}

export type ServiceOptions = {
  /** Scripted driver body. Defaults to an immediate terminal exit. */
  readonly run?: (context: DriverContext) => Promise<ServeExit>
  readonly sink?: { record(fact: CriticalFact): Promise<DurableReceipt> }
  readonly guard?: (command: RunnerCommand) => Promise<void>
  readonly payloads?: { read(reference: string): Promise<Json> }
  readonly recovery?: boolean
  /** Coordinator-side values for payload references the Runner asks for before recording facts. */
  readonly payloadValues?: Record<string, Json>
  readonly spec?: AttemptSpec
  readonly runnerIdentityRef?: string
  readonly source?: string
}

export function until(predicate: () => boolean, timeoutMs = 5000, label = 'condition'): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return (async () => {
    while (Date.now() < deadline) {
      if (predicate()) return
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw new Error(`${label} did not arrive within ${timeoutMs}ms`)
  })()
}

export async function startService(t: TestContext, options: ServiceOptions = {}) {
  const spec = options.spec ?? makeAttemptSpec()
  const root = mkdtempSync(join(tmpdir(), 'pa-i31-'))
  const recoveryRoot = join(root, 'recovery')
  const input = new PassThrough()
  const frames: Array<Record<string, unknown>> = []
  const driverCalls: string[] = []
  const payloadReads: string[] = []
  const run = options.run ?? (async () => ({ reason: 'terminal', evidenceRefs: ['fixture'] }))
  const source = options.source ?? 'fake-driver'
  const runnerIdentityRef = options.runnerIdentityRef ?? 'i31-runner'
  const producer = {
    attempt: {
      ticketId: spec.ticketId,
      assignmentId: spec.assignmentId,
      attemptId: spec.attemptId,
      fenceEpoch: spec.fenceEpoch,
      contract: spec.contract,
    },
    runnerIdentityRef,
    source,
  }

  const serving = serveRunner({
    input,
    write: frame => frames.push({ ...frame } as Record<string, unknown>),
    payloads: { read: async reference => {
      payloadReads.push(reference)
      return options.payloads ? options.payloads.read(reference) : null
    } },
    createDriver: (_spec, hooks) => ({
      inspect: async () => {
        throw new Error('fixture driver has no inspection')
      },
      reconcile: async () => {
        throw new Error('fixture driver has no reconcile')
      },
      serve: async (_attempt, io) => {
        driverCalls.push('serve')
        return run({ hooks, io, spec })
      },
    }),
    ...(options.sink ? { sink: options.sink } : {}),
    ...(options.guard ? { beforeNativeWrite: options.guard } : {}),
    ...(options.recovery ? { recoveryRoot } : {}),
  })

  t.after(async () => {
    try {
      input.end()
    } catch {
      // already ended
    }
    const service: RunnerServiceHandle | undefined = await serving.catch(() => undefined)
    await service?.shutdown().catch(() => undefined)
    rmSync(root, { recursive: true, force: true })
  })

  // `serveRunner`'s loop only returns after its input ends, so a consumer observes completion through
  // the real `exited` frame; the handle is awaited by cleanup instead.
  const done = (async () => {
    await until(() => frames.some(frame => frame.type === 'exited'), 8000, 'service exit frame')
    const exit = frames.find(frame => frame.type === 'exited')?.exit
    return (exit as { reason: string; evidenceRefs: string[] } | undefined) ?? { reason: 'unknown', evidenceRefs: [] }
  })()
  void done.catch(() => undefined)
  const send = (frame: Record<string, unknown>): void => {
    input.write(Buffer.from(JSON.stringify({ v: 1, ...frame }) + '\n'))
  }
  const boot = (): void => {
    send({
      type: 'bootstrap',
      id: 'bootstrap',
      spec,
      payloadRoot: join(root, 'payloads'),
      journalPath: join(root, 'journal'),
      producer: { source, runnerIdentityRef },
    })
  }
  const command = (value: RunnerCommand): void => {
    send({ type: 'command', id: value.id, command: value })
  }

  // The Runner fetches a fact's immutable payload from the coordinator before recording it, so the
  // harness plays that side for the values the test declared. Missing references stay unanswered on
  // purpose: a test that expects a missing payload must observe the timeout itself.
  const answeredPayloads = new Set<string>()
  const payloadTimer = setInterval(() => {
    for (const frame of frames) {
      if (frame.type !== 'payload-read') continue
      const requestId = String(frame.requestId ?? frame.id)
      if (answeredPayloads.has(requestId)) continue
      const reference = String(frame.reference ?? '')
      if (!(reference in (options.payloadValues ?? {}))) continue
      answeredPayloads.add(requestId)
      send({ type: 'payload', id: requestId, requestId, value: (options.payloadValues ?? {})[reference] })
    }
  }, 10)
  payloadTimer.unref?.()
  t.after(() => clearInterval(payloadTimer))

  const waitEndpoint = async (): Promise<RunnerEndpoint> => {
    const directory = endpointDirectory(recoveryRoot, spec.attemptId)
    const socketPath = `${directory}/runner.sock`
    await until(() => {
      try {
        lstatSync(socketPath)
        return true
      } catch {
        return false
      }
    }, 5000, 'recovery socket')
    const stat = lstatSync(socketPath)
    return { socketPath, credentialPath: `${directory}/runner.credential`, socketIdentity: { dev: stat.dev, ino: stat.ino } }
  }

  const connect = async (leaseId: string, expectedGeneration = 0) => {
    const endpoint = await waitEndpoint()
    const client = connectRunnerRecovery(endpoint, producer, 3000)
    const bound = await client.channelNext!(leaseId, expectedGeneration)
    return { client, leaseId, bound }
  }

  return {
    root,
    spec,
    producer,
    frames,
    driverCalls,
    payloadReads,
    done,
    send,
    /** Close the input side only (EOF), without a protocol shutdown frame. */
    inputEnd: () => {
      try {
        input.end()
      } catch {
        // already ended
      }
    },
    boot,
    command,
    waitEndpoint,
    connect,
    fact: (input: Omit<CriticalFactInput, 'source'>) => criticalFact(spec, { source, ...input }),
    answer: (id = 'cmd-answer') => makeCommand('answer', { id }),
    begin: (preparedPolicyRef: string) => makeCommand('begin', { id: 'cmd-begin', inputRef: 'input-1', preparedPolicyRef }),
    waitFrame: (predicate: (frame: Record<string, unknown>) => boolean, label = 'frame') => until(() => frames.some(predicate), 5000, label),
    framesOf: (type: string) => frames.filter(frame => frame.type === type),
  }
}

export type StartedService = Awaited<ReturnType<typeof startService>>
