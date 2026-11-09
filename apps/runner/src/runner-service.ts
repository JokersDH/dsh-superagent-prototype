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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentDriverV1 } from '../../../packages/contracts/src/ports.ts'
import type { AttemptSpec, CriticalFact, DurableReceipt, Json, RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { JsonLineDecoder, encodeFrame } from '../../../packages/driver-kit/src/index.ts'
import { FileCriticalJournal } from './file-journal.ts'
import { AttemptArtifactManifest } from './artifact-manifest.ts'
import { serveRecoveryEndpoint, endpointDirectory, type RecoveryEndpoint } from './recovery-endpoint.ts'
import { ProcessHost } from './process-host.ts'
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
  createDriver: (spec: AttemptSpec) => AgentDriverV1
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
  let localPayloadSeq = 0
  let recoveryEndpoint: RecoveryEndpoint | undefined
  const artifacts = new AttemptArtifactManifest()
  let closed = false
  const receipts = new Map<string, DurableReceipt>()
  /** Facts awaiting the coordinator's authoritative receipt. */
  const factWaiters = new Map<string, { resolve: (value: DurableReceipt) => void; reject: (error: Error) => void }>()
  const readLocal = async (reference: string): Promise<Json> => {
    const text = await readFile(join(payloadRoot, `${reference}.json`), 'utf8')
    return (JSON.parse(text) as { payload: Json }).payload
  }
  /** Outstanding payload reads the coordinator owes us, keyed by request id. */
  const payloadWaiters = new Map<string, { resolve: (value: Json) => void; reject: (error: Error) => void }>()
  let payloadSeq = 0

  const finish = (): void => {
    closed = true
    notify()
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
          journal = new FileCriticalJournal({ path: frame.journalPath })
          const recovery = await journal.open()
          runner = new AttemptRunner({
            payloads: {
              read: reference => {
                // Ask the coordinator for the immutable payload; the Runner has no store of its own.
                // Local first: a reference this Runner wrote, or one the coordinator supplies.
                return readLocal(reference).catch(() => {
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
                const reference = `payload-${String(++localPayloadSeq).padStart(6, '0')}`
                const file = join(payloadRoot, `${reference}.json`)
                await writeFile(file, JSON.stringify({ classification, payload }), 'utf8')
                return reference
              },
            },
            factSink: {
              record: async (fact: CriticalFact) => {
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
            processHost: options.processHost ?? new ProcessHost(),
            spool: journal,
          })
          if (options.recoveryRoot) {
            const processHost = options.processHost ?? new ProcessHost()
            recoveryEndpoint = await serveRecoveryEndpoint({
              directory: endpointDirectory(options.recoveryRoot, spec.attemptId),
              spec,
              runnerIdentityRef: `runner-${spec.attemptId}`,
              source: 'attempt-runner',
              resources: () =>
                (processHost as unknown as { resources?: () => Array<{ ref: string }> }).resources?.().map(item => ({
                  ref: item.ref,
                  ownership: 'spawned_process' as const,
                  writer: 'active' as const,
                  evidence: ['spawn-observed'],
                })) ?? [],
              state: () => (running === undefined ? 'serving' : 'terminated'),
              cancel: async command => {
                // Cancel closes admission first (the endpoint does that) and then stops owned work.
                await runner?.stopPhysical(2000).catch(() => undefined)
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
            running = runner.launch(spec, options.createDriver(spec))
            void running
              .then(result => {
                const exit = (result as { exit: { reason: string; evidenceRefs: string[] } }).exit
                write({ type: 'exited', id: spec?.attemptId ?? 'attempt', exit: exit as never })
                finish()
              })
              .catch(error => {
                write({ type: 'error', id: frame.id, ...toBridgeFailure(error) })
                finish()
              })
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
    finish()
    await recoveryEndpoint?.close().catch(() => undefined)
    await runner?.stopPhysical(2000).catch(() => undefined)
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
