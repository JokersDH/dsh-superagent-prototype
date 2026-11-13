/**
 * Independent per-attempt Runner service (wave-02 B2).
 *
 * One process, one attempt. Lifecycle:
 *
 *   spawn -> bootstrap (strict spec) -> ready -> commands -> exited
 *
 * Rules implemented here (WP-03 §3–4, RFC WP-16 §4):
 * - bootstrap is the only way to learn the `AttemptSpec`; a malformed spec or a protocol-version
 *   mismatch refuses the process before any native writer exists;
 * - `begin` is accepted at most once, and only after `ready`; a prepared-policy mismatch refuses it
 *   without touching the native side;
 * - critical facts go through the in-process `AttemptRunner` (spool -> sink -> validated receipt);
 *   the Runner never opens a product database;
 * - recovery cannot create business work: only `command` frames from the (authenticated, in-process)
 *   coordinator are forwarded, and there is no route that starts a new attempt.
 *
 * The transport is a pair of streams (tests use child-process stdio, the coordinator may use a
 * socket); this module does not define a second socket protocol.
 */
import { fileURLToPath } from 'node:url'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentDriverV1, AttemptIO } from '../../../packages/contracts/src/ports.ts'
import type { AttemptSpec, CriticalFact, DurableReceipt, Json, RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { JsonLineDecoder, encodeFrame } from '../../../packages/driver-kit/src/index.ts'
import { FileCriticalJournal } from './file-journal.ts'
import { AttemptArtifactManifest } from './artifact-manifest.ts'
import { serveRecoveryEndpoint, endpointDirectory, type RecoveryEndpoint } from './recovery-endpoint.ts'
import { ProcessHost } from './process-host.ts'
import { RunnerPayloadStore, LocalPayloadMissing } from './payload-store.ts'
import { AttemptRunner } from './runner.ts'
import {
  RUNNER_BRIDGE_PROTOCOL,
  parseBridgeFrame,
  toBridgeFailure,
  type BridgeFrame,
} from './bridge-protocol.ts'

export type RunnerServiceOptions = {
  /** Decoded upstream frames (coordinator -> runner). */
  input: AsyncIterable<Uint8Array>
  /** Downstream sink (runner -> coordinator). */
  write: (frame: BridgeFrame | Record<string, unknown>) => void
  /** Driver for this attempt; injected so tests use a fake and integration a real one. */
  createDriver: (spec: AttemptSpec, hooks: { beforeNativeWrite(command: RunnerCommand): Promise<void> }) => AgentDriverV1
  /** Native metadata/policy preparation may run before the first business begin. */
  eagerPrepare?: boolean
  /** Trusted host preparation runs inside this Runner before the native driver may spawn. */
  prepare?: (spec: AttemptSpec, context: { io: AttemptIO; processHost: ProcessHost; signal: AbortSignal }) => Promise<void>
  /** Payload store the coordinator owns; the Runner only asks for references. */
  payloads: { read(reference: string): Promise<Json> }
  /**
   * FactSink backed by the coordinator's authoritative ingress. When omitted, facts are forwarded
   * over the bridge as `fact` frames and the coordinator's `receipt` reply is the only ACK.
   */
  sink?: { record(fact: CriticalFact): Promise<DurableReceipt> }
  processHost?: ProcessHost
  now?: () => number
  /** When set, publish an authenticated recovery endpoint for this attempt. */
  recoveryRoot?: string
}

export type RunnerServiceHandle = {
  /** Resolves with the served exit once the attempt ends. */
  done: Promise<{ reason: string; evidenceRefs: string[] }>
  /** Stop the owned process group and end the service. */
  shutdown(): Promise<void>
}

/** Run the service over already-decoded streams. Returns when the attempt ends or shutdown arrives. */
export async function serveRunner(options: RunnerServiceOptions): Promise<RunnerServiceHandle> {
  const decoder = new JsonLineDecoder({ maxFrameBytes: 8 * 1024 * 1024, maxBufferedBytes: 16 * 1024 * 1024 })
  const write = (frame: Record<string, unknown>): void => options.write({ v: RUNNER_BRIDGE_PROTOCOL, ...frame } as BridgeFrame)
  const queue: BridgeFrame[] = []
  let wake: (() => void) | undefined
  let finished = false

  const notify = (): void => {
    const current = wake
    wake = undefined
    current?.()
  }

  // Socket pump: decode frames and queue them for the state machine.
  const pumping = (async () => {
    try {
      for await (const chunk of options.input) {
        for (const frame of decoder.push(chunk as Uint8Array)) {
          queue.push(parseBridgeFrame(frame.value))
          notify()
        }
      }
      decoder.end()
    } catch (error) {
      write({ type: 'error', id: 'protocol', ...toBridgeFailure(error) })
    } finally {
      finished = true
      notify()
    }
  })()

  const next = async (): Promise<BridgeFrame | undefined> => {
    for (;;) {
      const frame = queue.shift()
      if (frame) return frame
      if (finished) return undefined
      await new Promise<void>(resolve => {
        wake = resolve
      })
    }
  }

  // --- state machine --------------------------------------------------------
  let spec: AttemptSpec | undefined
  let runner: AttemptRunner | undefined
  let journal: FileCriticalJournal | undefined
  let running: Promise<unknown> | undefined
  let began = false
  let payloadRoot = ''
  let localPayloads: RunnerPayloadStore | undefined
  let recoveryEndpoint: RecoveryEndpoint | undefined
  const artifacts = new AttemptArtifactManifest()
  let closed = false
  let businessClosed = false
  let physicallyStopped = false
  const preparation = new AbortController()
  const processHost = options.processHost ?? new ProcessHost()
  const closeAdmission = () => {
    preparation.abort()
    businessClosed = true; processHost.closeAdmission(); runner?.closeAdmission()
    for (const waiters of [factWaiters, payloadWaiters, writeWaiters]) {
      for (const waiter of waiters.values()) waiter.reject(new Error('Attempt admission is closed'))
      waiters.clear()
    }
  }
  const stopPhysical = async () => {
    closeAdmission()
    const stopped = await runner?.stopPhysical(2000)
    physicallyStopped = stopped?.quiescence === 'confirmed' && processHost.inventory().every(item => item.writer === 'quiescent')
  }
  const receipts = new Map<string, DurableReceipt>()
  /** Facts awaiting the coordinator's authoritative receipt. */
  const factWaiters = new Map<string, { resolve: (value: DurableReceipt) => void; reject: (error: Error) => void }>()
  const readLocal = async (reference: string): Promise<Json> => {
    if (!localPayloads) throw new LocalPayloadMissing('Payload store is not ready')
    return localPayloads.read(reference)
  }
  /** Outstanding payload reads the coordinator owes us, keyed by request id. */
  const payloadWaiters = new Map<string, { resolve: (value: Json) => void; reject: (error: Error) => void }>()
  const writeWaiters = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  const hooks = { beforeNativeWrite: (command: RunnerCommand) => new Promise<void>((resolve, reject) => {
    if (businessClosed || command.kind !== 'answer') { reject(new Error('Native write admission is closed')); return }
    writeWaiters.set(command.id, { resolve, reject })
    write({ type: 'native-write-intent', id: command.id, command })
  }) }
  let payloadSeq = 0

  const finish = (): void => {
    closed = true
    notify()
  }
  const launch = () => {
    if (!spec || !runner || running) throw new Error('Attempt driver cannot be launched twice')
    const driver = options.createDriver(spec, hooks)
    running = runner.launch(spec, {
      inspect: (profile, host) => driver.inspect(profile, host),
      reconcile: (ref, host) => driver.reconcile(ref, host),
      serve: async (attempt, io) => {
        await options.prepare?.(attempt, { io, processHost, signal: preparation.signal })
        if (preparation.signal.aborted || businessClosed) throw new Error('Attempt closed during host preparation')
        return driver.serve(attempt, io)
      },
    })
    void running.then(async result => {
      await stopPhysical()
      write({ type: 'exited', id: spec!.attemptId, exit: (result as { exit: unknown }).exit })
      finish()
    }).catch(async error => {
      await stopPhysical()
      write({ type: 'error', id: spec!.attemptId, ...toBridgeFailure(error) })
      write({ type: 'exited', id: spec!.attemptId, exit: { reason: 'error', evidenceRefs: ['runner-preparation-or-driver-failed'] } })
      finish()
    })
  }

  try {
    for (;;) {
      const frame = await next()
      if (!frame) break
      if (closed) break

      // Artifact registration is an upstream extension handled before the typed dispatch.
      if ((frame as { type: string }).type === 'artifact') {
        const incoming = frame as unknown as { id: string; path?: string; content?: string }
        try {
          const entry = artifacts.register({
            path: String(incoming.path ?? 'unknown'),
            bytes: Buffer.from(String(incoming.content ?? ''), 'utf8'),
          })
          write({ type: 'artifact-registered', id: incoming.id, requestId: incoming.id, ref: entry.ref, digest: entry.digest } as never)
        } catch (error) {
          write({ type: 'error', id: incoming.id, ...toBridgeFailure(error) })
        }
        continue
      }

      switch (frame.type) {
        case 'bootstrap': {
          if (spec) {
            write({ type: 'error', id: frame.id, code: 'protocol_error', reason: 'duplicate_bootstrap', message: 'Bootstrap was already accepted' })
            break
          }
          // The bootstrap fixes the attempt identity; nothing else may introduce one.
          spec = frame.spec
          payloadRoot = frame.payloadRoot
          await mkdir(payloadRoot, { recursive: true })
          localPayloads = new RunnerPayloadStore(payloadRoot)
          journal = new FileCriticalJournal({ path: frame.journalPath })
          const recovery = await journal.open()
          runner = new AttemptRunner({
            payloads: {
              read: reference => {
                // Ask the coordinator for the immutable payload; the Runner has no store of its own.
                // Local first: a reference this Runner wrote, or one the coordinator supplies.
                return readLocal(reference).catch((error) => {
                  if (!(error instanceof LocalPayloadMissing)) throw error
                  const requestId = `payload-${++payloadSeq}`
                  return new Promise((resolve, reject) => {
                    payloadWaiters.set(requestId, { resolve, reject })
                    write({ type: 'payload-read', id: requestId, requestId, reference } as never)
                  })
                })
              },
              // The Runner keeps a bounded local payload area next to its journal so a fact can be
              // replayed with its original reference; the coordinator copies into its immutable
              // store when it acknowledges the fact.
              store: async (payload: Json, classification: 'critical' | 'diagnostic') => {
                return localPayloads!.write(payload, classification)
              },
            },
            factSink: {
              record: async (fact: CriticalFact) => {
                if (businessClosed) throw new Error('Attempt fact channel is closed')
                const receipt = options.sink
                  ? await options.sink.record(fact)
                  : await new Promise<DurableReceipt>((resolve, reject) => {
                      factWaiters.set(fact.factId, { resolve, reject })
                      write({ type: 'fact', id: fact.factId, fact } as never)
                    })
                receipts.set(fact.factId, receipt)
                write({ type: 'receipt', id: fact.factId, factId: fact.factId, receipt })
                return receipt
              },
            },
            processHost,
            spool: journal,
          })
          if (options.recoveryRoot) {
            recoveryEndpoint = await serveRecoveryEndpoint({
              directory: endpointDirectory(options.recoveryRoot, spec.attemptId),
              spec,
              runnerIdentityRef: frame.producer.runnerIdentityRef,
              source: frame.producer.source,
              resources: () => processHost.inventory(),
              state: () => physicallyStopped ? 'terminated' : businessClosed ? 'unknown' : 'serving',
              cancel: async command => {
                // Cancel closes admission first (the endpoint does that) and then stops owned work.
                await stopPhysical()
                void command
              },
            })
          }
          write({
            type: 'ready',
            id: frame.id,
            attemptId: spec.attemptId,
            pid: process.pid,
            journalPath: journal.path,
            protocol: RUNNER_BRIDGE_PROTOCOL,
          })
          if (options.eagerPrepare) launch()
          // A previously interrupted attempt may have facts that were never acknowledged.
          if (recovery.entries.length > 0) {
            write({ type: 'progress', id: 'recovery', text: `recovered ${recovery.entries.length} spooled facts`, observedAt: new Date().toISOString() })
          }
          break
        }

        case 'command': {
          if (!spec || !runner) {
            write({ type: 'error', id: frame.id, code: 'state_indeterminate', reason: 'not_bootstrapped', message: 'Commands require a bootstrap first' })
            break
          }
          const command: RunnerCommand = frame.command
          // Optional receiver log (wave-16 B1). Off by default and inert when unset; when a path is
          // supplied, every command the Runner ACTUALLY received is appended before any admission
          // check. This is the only honest source for "receiver begin count": the caller's own
          // bookkeeping cannot prove the frame arrived at the writer's process.
          if (process.env.PA_RUNNER_RECEIVER_LOG) {
            await appendFile(
              process.env.PA_RUNNER_RECEIVER_LOG,
              `${JSON.stringify({ kind: command.kind, id: command.id, attemptId: command.attemptId, fenceEpoch: command.fenceEpoch, at: new Date().toISOString() })}\n`,
            ).catch(() => undefined)
          }
          if (businessClosed) {
            write({ type: 'error', id: frame.id, code: 'state_indeterminate', reason: 'admission_closed', message: 'Attempt admission is closed' })
            break
          }
          if (command.kind === 'begin') {
            if (began) {
              write({ type: 'error', id: frame.id, code: 'protocol_error', reason: 'duplicate_begin', message: 'begin is accepted at most once per attempt' })
              break
            }
            began = true
            // Queue begin *before* launching: launch() takes ownership of the command queue, and
            // feeding afterwards races the runner's single-attempt guard.
            try {
              runner.feed(command)
            } catch (error) {
              write({ type: 'error', id: frame.id, ...toBridgeFailure(error) })
              break
            }
            if (!running) launch()
            break
          }
          try {
            runner.feed(command)
          } catch (error) {
            write({ type: 'error', id: frame.id, ...toBridgeFailure(error) })
          }
          break
        }

        case 'receipt': {
          const waiter = factWaiters.get(frame.factId)
          if (waiter) {
            factWaiters.delete(frame.factId)
            waiter.resolve(frame.receipt)
          }
          break
        }

        case 'payload': {
          const waiter = payloadWaiters.get(frame.requestId)
          if (waiter) {
            payloadWaiters.delete(frame.requestId)
            waiter.resolve(frame.value as Json)
          }
          break
        }
        case 'write-admission': {
          const waiter = writeWaiters.get(frame.id)
          if (waiter) { writeWaiters.delete(frame.id); if (frame.allowed && !businessClosed) waiter.resolve(); else waiter.reject(new Error('Coordinator refused native write')) }
          break
        }

        case 'ack-failed': {
          // The coordinator could not persist the fact: keep it spooled and fail the in-flight
          // acknowledge so the Driver sees a real error instead of waiting forever.
          const waiter = factWaiters.get(frame.factId)
          if (waiter) {
            factWaiters.delete(frame.factId)
            waiter.reject(
              Object.assign(new Error(`ingress refused fact ${frame.factId}: ${frame.reason}`), {
                code: 'state_indeterminate',
                reason: 'ingress_unavailable',
              }),
            )
          }
          write({ type: 'progress', id: frame.id, text: `ack failed for ${frame.factId}: ${frame.reason}`, observedAt: new Date().toISOString() })
          break
        }

        case 'shutdown': {
          closeAdmission()
          finish()
          break
        }

        default:
          write({ type: 'error', id: 'protocol', code: 'protocol_error', reason: 'unknown_frame', message: `Unknown frame: ${(frame as { type: string }).type}` })
      }
    }
  } finally {
    await pumping.catch(() => undefined)
  }

  const shutdown = async (): Promise<void> => {
    closeAdmission()
    finish()
    await recoveryEndpoint?.close().catch(() => undefined)
    await stopPhysical().catch(() => undefined)
    journal?.close()
  }

  const done = (async () => {
    if (running) {
      try {
        const result = (await running) as { exit: { reason: string; evidenceRefs: string[] } }
        return result.exit
      } catch {
        return { reason: 'error', evidenceRefs: [] as string[] }
      }
    }
    return { reason: 'cancelled', evidenceRefs: [] as string[] }
  })()
  void done.catch(() => undefined)

  return { done, shutdown }
}

/** Entry point used by a spawned Runner process: stdio as the transport. */
export async function mainRunnerService(createOptions: () => Promise<Omit<RunnerServiceOptions, 'input' | 'write'>>): Promise<void> {
  const options = await createOptions()
  const write = (frame: Record<string, unknown> | BridgeFrame): void => {
    process.stdout.write(encodeFrame(frame))
  }
  const input = (async function* (): AsyncGenerator<Uint8Array> {
    for await (const chunk of process.stdin) yield chunk as Uint8Array
  })()
  const handle = await serveRunner({ ...options, input, write })
  const exit = await handle.done
  await handle.shutdown()
  process.stdout.write(encodeFrame({ v: RUNNER_BRIDGE_PROTOCOL, type: 'exited', id: 'final', exit }))
}

export const BRIDGE_SERVICE_ENTRY = fileURLToPath(new URL('./runner-service-entry.ts', import.meta.url))
