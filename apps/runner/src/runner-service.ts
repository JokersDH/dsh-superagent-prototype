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
import { createHash } from 'node:crypto'
import { canonicalJson } from '../../../packages/contracts/src/canonical.ts'
import { runnerResourceManifestDigest } from '../../../packages/execution/src/recovery-transport.ts'
import { FileCriticalJournal } from './file-journal.ts'
import { AttemptArtifactManifest } from './artifact-manifest.ts'
import { serveRecoveryEndpoint, endpointDirectory, type RecoveryEndpoint } from './recovery-endpoint.ts'
// ONE communication implementation: I owns the concrete channel module; this file only adapts it to the
// authenticated transport and keeps business admission/dispatch/lifecycle.
import {
  DEFAULT_LIMITS,
  RunnerAttachChannel,
  isCoordinatorChannelError,
  sameCoordinatorChannelProducer,
} from './attach-channel/index.ts'
import type { CoordinatorChannelProducer, CoordinatorChannelRequest } from './attach-channel/index.ts'
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
  createDriver: (spec: AttemptSpec, hooks: { beforeNativeWrite(command: RunnerCommand): Promise<void>; isBusinessOpen(): boolean;
    ownedRuntime: Pick<ProcessHost, 'originalIdentity' | 'closeInput'> }) => AgentDriverV1
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
  /**
   * Fresh native-write admission for the IN-PROCESS responder. A fact sink (or "not closed") is not a
   * write permission: this guard is the original main/Broker check (current attempt/binding, command
   * digest, live answer admission) and it is asked again for every intent. Missing, denied or thrown
   * guard means zero native write, never "allowed because a sink exists".
   */
  beforeNativeWrite?: (command: RunnerCommand) => Promise<void>
  now?: () => number
  /** When set, publish an authenticated recovery endpoint for this attempt. */
  recoveryRoot?: string
}

export type RunnerServiceHandle = {
  /** Resolves with the served exit once the attempt ends. */
  done: Promise<{ reason: string; evidenceRefs: string[] }>
  /** Stop the owned process group and end the service. */
  shutdown(): Promise<void>
  /**
   * Retain a naturally terminal endpoint until the original coordinator's authenticated postcommit
   * finalize arrives; explicit shutdown / no remote attach / still-running attempts return immediately.
   */
  awaitPostcommitFinalize(): Promise<void>
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
  /** Last generation observed on the channel; readable after terminal close without reviving it. */
  let channelGeneration = 0
  let physicallyStopped = false
  /** A real (non-adapter) callback lease has attached at least once; only then does a terminal barrier wait apply. */
  let remoteAttached = false
  /** The driver ended naturally rather than through an explicit shutdown frame. */
  let naturalTerminal = false
  /** The original coordinator asked for shutdown on stdio; no barrier wait is needed then. */
  let explicitShutdown = false
  let resolvedPostcommit = false
  let finalizeRequested = false
  let finalizedConfirmationId: string | undefined
  let resolvePostcommitFinalize!: () => void
  const postcommitFinalize = new Promise<void>(resolve => { resolvePostcommitFinalize = resolve })
  const preparation = new AbortController()
  const processHost = options.processHost ?? new ProcessHost()
  const closeAdmission = () => {
    preparation.abort()
    businessClosed = true; processHost.closeAdmission(); runner?.closeAdmission()
    // Admission closure alone leaves the channel available for reconnectable control. Terminal
    // finish closes every lease and pending callback, including the current remote connection.
    for (const connectionId of [stdioConnectionId, SINK_CONNECTION_ID]) {
      try { attach?.drop(connectionId, 'Attempt admission is closed') } catch {}
    }
  }
  const stopPhysical = async () => {
    closeAdmission()
    const stopped = await runner?.stopPhysical(2000)
    physicallyStopped = stopped?.quiescence === 'confirmed' && processHost.inventory().every(item => item.writer === 'quiescent')
  }
  const receipts = new Map<string, DurableReceipt>()
  // ONE communication implementation: I's RunnerAttachChannel owns the lease, the kind-namespaced
  // outbound queue, settlement pruning and the bounded deadline. This file only adapts the two
  // authenticated transports (stdio frames, in-process sink) to `next`/`receive`; it keeps NO
  // competing pending store, timer, generation or queue of its own.
  let attach: RunnerAttachChannel | undefined
  let channelProducer: CoordinatorChannelProducer | undefined
  const SINK_CONNECTION_ID = 'sink'
  const stdioConnectionId = `stdio-${process.pid}`
  /** The request each adapter connection has already been handed, so a poll never re-sends it. */
  const dispatched = new Map<string, string>()
  const requestKey = (request: CoordinatorChannelRequest): string =>
    request.type === 'fact' ? `fact:${request.id}` : request.type === 'payload-read' ? `payload:${request.requestId}` : `write:${request.id}`
  /**
   * Adapter pump: hand each ADAPTER connection the next head of ITS OWN queue, once.
   *
   * A remote pull connection is NOT an adapter: its requests are returned by the HTTP `next` handler
   * itself, and nothing about it may ever touch the stdout writer. Pumping it here was the double-send
   * defect - the remote lease's intent was also written to the old stdio socket.
   */
  const pump = (connectionId: string): void => {
    if (!attach) return
    if (connectionId !== stdioConnectionId && connectionId !== SINK_CONNECTION_ID) return
    const page = attach.next(connectionId, channelProducer)
    if (!page.ok || !page.request) return
    const key = requestKey(page.request)
    if (dispatched.get(connectionId) === key) return
    dispatched.set(connectionId, key)
    if (connectionId === SINK_CONNECTION_ID) {
      void routeToSink(page.request)
      return
    }
    const { v: _version, ...frame } = page.request as unknown as Record<string, unknown>
    write(frame)
  }
  const pumpAll = (): void => { pump(stdioConnectionId); if (options.sink) pump(SINK_CONNECTION_ID) }
  /** The in-process responder: each request is answered once, then the module settles it. */
  const routeToSink = async (request: CoordinatorChannelRequest): Promise<void> => {
    const connectionId = SINK_CONNECTION_ID
    const settle = (frame: Record<string, unknown>): void => {
      try { attach?.receive(connectionId, { v: 1, ...frame }, channelProducer) } catch {}
      dispatched.delete(connectionId)
      pump(connectionId)
    }
    try {
      if (request.type === 'fact') {
        const receipt = await options.sink!.record(request.fact)
        settle({ type: 'receipt', id: request.fact.factId, factId: request.fact.factId, receipt })
      } else if (request.type === 'payload-read') {
        const value = await readLocal(request.reference)
        settle({ type: 'payload', id: request.requestId, requestId: request.requestId, value })
      } else {
        // A fact sink is NOT a native-write permission. The fresh original guard is asked every time;
        // missing/deny/throw leaves the driver with allowed:false and zero native effect.
        let allowed = false
        try {
          if (!options.beforeNativeWrite) throw new Error('No fresh native-write guard is injected for the in-process responder')
          await options.beforeNativeWrite(request.command)
          allowed = !businessClosed
        } catch { allowed = false }
        settle({ type: 'write-admission', id: request.id, allowed })
      }
    } catch {
      // Leave the operation to the module's bounded deadline; it owns the exact failure.
      dispatched.delete(connectionId)
    }
  }
  // The pump is a REAL timer while the attempt is live: an unref'd timer would let a promise-only
  // waiter stall, and clearing it on finish is what lets the process exit afterwards.
  const timer = setInterval(pumpAll, 10)
  const channelError = (code: string, reason: string, message = reason): Error =>
    Object.assign(new Error(message), { code, reason })
  const asChannelReply = (frame: object): unknown => ({ v: 1, ...frame })
  /**
   * Control admission is checked BEFORE a feed/cancel reaches any effect: terminal/stopped service,
   * foreign producer and an old callback lease are all refused by name. The business fence still runs
   * afterwards for commands; this only fences the transport-level caller.
   */
  /**
   * Control admission uses I's OWN public currentness: a claimed lease is checked with attach.next,
   * which refuses a never-bound or superseded lease before any effect. No parallel owner cache is kept.
   * A claimed lease is never accepted while unbound (the first-lease hole); an unclaimed business feed is
   * only the original stdio path while no callback lease is bound, while an unclaimed cancel is the
   * original physical stop and is distinct from a claimed-but-stale lease.
   */
  const controlRefusal = (auth: { producer?: unknown; leaseId?: string | null } | undefined, mode: 'command' | 'cancel', allowBusinessClosed = false): { code: string; reason: string } | null => {
    if (closed) return { code: 'stale_connection', reason: 'channel_closed' }
    if (businessClosed && !allowBusinessClosed) return { code: 'stale_connection', reason: 'admission_closed' }
    if (auth?.producer && channelProducer && !sameCoordinatorChannelProducer(auth.producer as never, channelProducer)) return { code: 'identity_mismatch', reason: 'foreign_producer' }
    if (!attach) return { code: 'stale_connection', reason: 'channel_unavailable' }
    if (auth?.leaseId) {
      const check = attach.next(auth.leaseId, (channelProducer ?? auth.producer) as never)
      if (!check.ok) {
        if (check.refused === 'identity_mismatch') return { code: 'identity_mismatch', reason: 'foreign_producer' }
        if (check.refused === 'closed') return { code: 'stale_connection', reason: 'channel_closed' }
        return { code: 'stale_connection', reason: 'stale_lease' }
      }
      return null
    }
    // No lease claimed: the original physical cancel is allowed, while a business feed is the ORIGINAL
    // stdio path only while the stdio adapter itself owns I's channel (or nothing is bound). A remote
    // callback lease currently owning the channel makes a raw no-lease feed ambiguous and is refused.
    if (mode === 'command' && attach.inspect().state === 'bound') {
      const stdio = attach.next(stdioConnectionId, (channelProducer ?? auth?.producer) as never)
      if (!stdio.ok) return { code: 'stale_connection', reason: 'missing_lease' }
    }
    return null
  }
  // A foreign registration is refused before any bind/CAS, so its poll changes nothing (no generation bump).
  const assertChannelProducer = (producer: unknown): void => {
    if (!channelProducer || !sameCoordinatorChannelProducer(producer, channelProducer)) {
      throw channelError('identity_mismatch', 'foreign_producer', 'The attach registration does not match this Runner')
    }
  }
  /** A decoded stdio reply belongs to the stdio connection; the adapter routes or refuses it. */
  const routeStdioReply = (frame: Record<string, unknown>): void => {
    if (!attach) return
    try { attach.receive(stdioConnectionId, { v: 1, ...frame }, channelProducer) } catch {}
    dispatched.delete(stdioConnectionId)
    pump(stdioConnectionId)
  }
  const readLocal = async (reference: string): Promise<Json> => {
    if (!localPayloads) throw new LocalPayloadMissing('Payload store is not ready')
    return localPayloads.read(reference)
  }
  /**
   * The single business-command admission. Both the stdio handler and the authenticated endpoint call
   * this, so begin-once, the prepared policy, admission state and the receiver log cannot be bypassed by
   * whichever channel a caller happens to use.
   */
  const admitCommand = async (command: RunnerCommand, id: string): Promise<{ code: string; reason: string; message: string } | null> => {
    if (!spec || !runner) return { code: 'state_indeterminate', reason: 'not_bootstrapped', message: 'Commands require a bootstrap first' }
    // Optional receiver log (wave-16 B1). Off by default and inert when unset; when a path is supplied,
    // every command the Runner ACTUALLY received is appended before any admission check. This is the
    // only honest source for "receiver begin count": the caller's own bookkeeping cannot prove arrival.
    if (process.env.PA_RUNNER_RECEIVER_LOG) {
      await appendFile(
        process.env.PA_RUNNER_RECEIVER_LOG,
        // The original command body is preserved here so an independent consumer can prove WHICH command
        // the Runner actually received, not merely that some command arrived. The log is opt-in/local and
        // is a diagnostic, never a receipt or Store durability evidence.
        `${JSON.stringify({ receiver: 'runner-service', kind: command.kind, id: command.id, attemptId: command.attemptId, fenceEpoch: command.fenceEpoch, body: command, at: new Date().toISOString() })}\n`,
      ).catch(() => undefined)
    }
    if (businessClosed) return { code: 'state_indeterminate', reason: 'admission_closed', message: 'Attempt admission is closed' }
    if (command.kind === 'begin') {
      if (began) return { code: 'protocol_error', reason: 'duplicate_begin', message: 'begin is accepted at most once per attempt' }
      began = true
      // Queue begin *before* launching: launch() takes ownership of the command queue, and feeding
      // afterwards races the runner's single-attempt guard.
      try {
        runner.feed(command)
      } catch (error) {
        return toBridgeFailure(error)
      }
      if (!running) launch()
      return null
    }
    try {
      runner.feed(command)
      return null
    } catch (error) {
      return toBridgeFailure(error)
    }
    void id
  }

  const hooks = { ownedRuntime: { originalIdentity: (resourceRef: string) => processHost.originalIdentity?.(resourceRef),
    closeInput: (resourceRef: string) => processHost.closeInput(resourceRef) },
    isBusinessOpen: () => !businessClosed && !closed && !preparation.signal.aborted, beforeNativeWrite: async (command: RunnerCommand) => {
    if (!attach || businessClosed || command.kind !== 'answer') throw new Error('Native write admission is closed')
    // Each intent gets a fresh correlation id while the original command id/body stay untouched; the
    // channel never lets an earlier allowed frame approve a later intent.
    return attach.hooks.beforeNativeWrite(command)
  } }

  const finish = (): void => {
    closed = true
    clearInterval(timer)
    attach?.close('Runner service is terminal')
    dispatched.clear()
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
      naturalTerminal = true
      await stopPhysical()
      write({ type: 'exited', id: spec!.attemptId, exit: (result as { exit: unknown }).exit })
      finish()
    }).catch(async error => {
      naturalTerminal = true
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
      // A terminal service may already be closed when the live coordinator finally asks for shutdown:
      // that request still marks the ordinary explicit path and must skip the successor-barrier wait.
      if ((frame as { type?: string }).type === 'shutdown') {
        explicitShutdown = true
        if (closed) break
      }
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
          channelProducer = {
            attempt: {
              ticketId: spec.ticketId,
              assignmentId: spec.assignmentId,
              attemptId: spec.attemptId,
              fenceEpoch: spec.fenceEpoch,
              contract: spec.contract,
            },
            runnerIdentityRef: frame.producer.runnerIdentityRef,
            source: frame.producer.source,
          }
          attach = new RunnerAttachChannel({ producer: channelProducer, limits: DEFAULT_LIMITS })
          if (options.sink) {
            // In-process coordinator (product lane): one explicit connection, pumped into the sink.
            attach.bind({ producer: channelProducer, connectionId: SINK_CONNECTION_ID, expectedGeneration: 0 })
          } else {
            // Stdio coordinator keeps its original frames; the version tag is stripped and every
            // correlation id stays the original one the caller already knows.
            attach.bind({ producer: channelProducer, connectionId: stdioConnectionId, expectedGeneration: 0 })
          }
          runner = new AttemptRunner({
            onProgress: update => write({ type: 'progress', id: update.attemptId, text: update.text, observedAt: update.observedAt }),
            payloads: {
              read: reference => {
                // Ask the coordinator for the immutable payload; the Runner has no store of its own.
                // Local first: a reference this Runner wrote, or one the coordinator supplies.
                return readLocal(reference).catch((error) => {
                  if (!(error instanceof LocalPayloadMissing)) throw error
                  // The adapter decides which live connection is asked; the reference is the original one.
                  if (!attach) return Promise.reject(error)
                  return attach.hooks.payloads.read(reference)
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
                if (!attach || businessClosed) throw new Error('Attempt fact channel is closed')
                // The fact is asked by its ORIGINAL id; a replacement connection can only resend it.
                const receipt = await attach.hooks.factSink.record(fact)
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
              cancel: async (command, auth) => {
                // A natural terminal already ran the physical stop; a no-lease original cancel must still
                // be able to collect that barrier instead of being refused by the closed flag. It never
                // revives business admission or serves a callback.
                if (closed) {
                  if (auth?.leaseId) throw Object.assign(new Error('stale_lease'), { code: 'stale_connection', reason: 'stale_lease' })
                  if (auth?.producer && channelProducer && !sameCoordinatorChannelProducer(auth.producer as never, channelProducer))
                    throw Object.assign(new Error('foreign_producer'), { code: 'identity_mismatch', reason: 'foreign_producer' })
                  // A transient terminal observation may have preceded the original child exit.
                  // Refresh ONLY that original inventory; never signal, reopen or replay business.
                  if (!physicallyStopped) {
                    const observed = await processHost.observeQuiescence()
                    physicallyStopped = observed.quiescence === 'confirmed' && processHost.inventory().every(item => item.writer === 'quiescent')
                  }
                  // A cancel observes/stops and returns the recorded barrier, but it NEVER finalizes the
                  // terminal endpoint: only a postcommit finalize after main's Store commit may do that.
                  return
                }
                // Identity/lease is certified BEFORE the physical stop mutates anything; a foreign cancel
                // is refused here without running stopPhysical. A legitimate stop after admission closed
                // is still allowed, but a terminal service is not revived.
                const fence = controlRefusal(auth, 'cancel', true)
                if (fence) throw Object.assign(new Error(fence.reason), fence)
                // Standard ACP cancellation must reach the original Driver before stdin closes.
                // Business/answers/spawns are revoked immediately; only the original queued cancel
                // gets a bounded drain opportunity. A native reply never replaces the physical barrier.
                if (spec?.profile.driverId === 'acp-v1' && runner && running && !businessClosed) {
                  businessClosed = true
                  preparation.abort()
                  runner.requestCancel(command)
                  await Promise.race([running.catch(() => undefined), new Promise<void>(resolve => setTimeout(resolve, 250))])
                }
                await stopPhysical()
              },
              finalize: async (auth, confirmation) => {
                // Postcommit finalize: the coordinator's original Store has already committed the barrier
                // receipt/event. This only closes the retained terminal endpoint; it grants no stop/business
                // authority, does not restart, and refuses while any owned resource is not quiescent.
                if (auth?.producer && channelProducer && !sameCoordinatorChannelProducer(auth.producer as never, channelProducer))
                  throw Object.assign(new Error('foreign_producer'), { code: 'identity_mismatch', reason: 'foreign_producer' })
                if (!channelProducer) throw Object.assign(new Error('not_registered'), { code: 'identity_mismatch', reason: 'not_registered' })
                const expected = channelProducer.attempt
                const claimed = confirmation?.attempt
                if (!claimed || claimed.ticketId !== expected.ticketId || claimed.assignmentId !== expected.assignmentId ||
                    claimed.attemptId !== expected.attemptId || claimed.fenceEpoch !== expected.fenceEpoch ||
                    canonicalJson(claimed.contract as never) !== canonicalJson(expected.contract as never))
                  throw Object.assign(new Error('wrong_subject'), { code: 'identity_mismatch', reason: 'wrong_subject' })
                if (!closed) throw Object.assign(new Error('terminal_not_reached'), { code: 'terminal_not_reached', reason: 'terminal_not_reached' })
                if (!physicallyStopped) throw Object.assign(new Error('physical_not_stopped'), { code: 'physical_not_stopped', reason: 'physical_not_stopped' })
                const inventory = processHost.inventory()
                if (inventory.some(resource => resource.writer !== 'quiescent'))
                  throw Object.assign(new Error('unknown_resources'), { code: 'unknown_resources', reason: 'unknown_resources' })
                if (runnerResourceManifestDigest(inventory) !== confirmation.resourceManifestDigest)
                  throw Object.assign(new Error('resource_manifest_mismatch'), { code: 'identity_mismatch', reason: 'resource_manifest_mismatch' })
                if (finalizedConfirmationId !== undefined)
                  return finalizedConfirmationId === confirmation.confirmationId
                    ? { finalized: true as const, alreadyFinalized: true }
                    : (() => { throw Object.assign(new Error('confirmation_conflict'), { code: 'protocol_error', reason: 'confirmation_conflict' }) })()
                finalizedConfirmationId = confirmation.confirmationId
                finalizeRequested = true
                if (!resolvedPostcommit) { resolvedPostcommit = true; resolvePostcommitFinalize() }
                return { finalized: true as const, alreadyFinalized: false }
              },
              // Business attach: facts come from this Runner's own durable journal, so a second client
              // recovers the original work instead of trusting its own memory or a second ledger.
              // Paging follows the journal's real immutable seq, never a renumbered array index, and a
              // page is closed by a byte budget rather than by truncating or raising a global limit.
              facts: async (since, maxBytes) => {
                const all = journal!.entries().filter(entry => entry.seq > since)
                const frames: unknown[] = []
                let bytes = 0, next = since, done = true
                for (const entry of all) {
                  const frame = { seq: entry.seq, fact: entry.fact, payload: entry.payload }
                  const size = Buffer.byteLength(JSON.stringify(frame))
                  if (size > maxBytes) {
                    // Too large to inline. Emit a reference page instead of an oversized inline page, so
                    // the caller can discover the ref and fetch the payload in bounded chunks; the page
                    // still advances by the frame's own seq.
                    const payloadBytes = Buffer.from(JSON.stringify(entry.payload), 'utf8')
                    frames.push({
                      seq: entry.seq,
                      fact: { ...entry.fact, payloadRef: entry.fact.payloadRef },
                      payload: null,
                      payloadRef: entry.fact.payloadRef,
                      payloadBytes: payloadBytes.length,
                      payloadDigest: createHash('sha256').update(payloadBytes).digest('hex'),
                    })
                    bytes += Buffer.byteLength(JSON.stringify(frames[frames.length - 1]))
                    next = entry.seq
                    continue
                  }
                  frames.push(frame)
                  bytes += size
                  next = entry.seq
                }
                return { frames, next, done }
              },
              // A frame too large to inline is delivered by reference and read in bounded chunks here,
              // so a legitimate large payload stays readable without widening the transport cap.
              // Read-only generation. It grants nothing: an attaching caller must present this exact
              // generation to CAS, and reading it binds no lease and starts no waiter.
              // Reading the generation is a read, not a rebind: a terminal runner still reports the last
              // generation it owned so a caller can observe refusal without reviving the channel.
              channelState: async producer => {
                assertChannelProducer(producer)
                try { channelGeneration = attach!.inspect().generation } catch {}
                return { generation: channelGeneration }
              },
              // Explicit CAS bind from the authenticated producer, then poll THAT connection's own queue.
              // A caller that already owns the live connection never rebinds: polling is read-only.
              channelNext: async (producer, leaseId, expectedGeneration) => {
                assertChannelProducer(producer)
                if (closed) throw channelError('stale_connection', 'channel_closed', 'Runner service is terminal')
                const current = attach!.next(leaseId, producer as never)
                if (!current.ok && current.refused === 'stale_connection') {
                  try {
                    attach!.bind({ producer: producer as never, connectionId: leaseId, expectedGeneration })
                  } catch (error) {
                    const mapped = error as { code?: string; reason?: string }
                    throw channelError(mapped?.code ?? 'protocol_error', mapped?.reason ?? 'bind_failed')
                  }
                  dispatched.delete(leaseId)
                }
                const page = attach!.next(leaseId, producer as never)
                if (!page.ok) throw channelError(page.refused, page.refused === 'identity_mismatch' ? 'foreign_producer' : 'lease_not_current')
                channelGeneration = page.generation
                remoteAttached = true
                // The page is the delivery for a remote pull connection; never mirror it onto stdio.
                return { generation: page.generation, request: page.request, remainingMs: page.remainingMs }
              },
              channelReply: async (producer, reply, leaseId) => {
                assertChannelProducer(producer)
                // A receipt that arrives after terminal shutdown/attempt closure must never be accepted:
                // the fact is already resolved on the original side, and accepting it would let a late
                // ACK look like a newly-acknowledged callback. Returning accepted:false makes the route
                // answer 409 stale_lease, before the module is touched.
                if (closed || businessClosed) return { accepted: false, generation: channelGeneration }
                const routed = attach!.receive(leaseId, asChannelReply(reply as object), producer as never)
                if (routed.accepted) dispatched.delete(leaseId)
                remoteAttached = true
                channelGeneration = routed.generation
                return { accepted: routed.accepted, generation: routed.generation }
              },
              payload: async (ref, offset, length) => {
                const entry = journal!.entries().find(candidate => candidate.fact.payloadRef === ref)
                if (!entry) throw new Error('Unknown payload reference')
                const bytes = Buffer.from(JSON.stringify(entry.payload), 'utf8')
                const digest = createHash('sha256').update(bytes).digest('hex')
                const slice = bytes.subarray(offset, offset + length)
                return { total: bytes.length, digest, base64: slice.toString('base64') }
              },
              // Business commands are admitted to the SAME attempt and child through the existing feed.
              command: async (command, auth) => {
                const fence = controlRefusal(auth, 'command')
                if (fence) throw Object.assign(new Error(fence.reason), fence)
                const refusal = await admitCommand(command, command.id)
                if (refusal) throw Object.assign(new Error(refusal.message), { code: refusal.code, reason: refusal.reason })
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
          const command: RunnerCommand = frame.command
          const refusal = await admitCommand(command, frame.id)
          if (refusal) {
            write({ type: 'error', id: frame.id, ...refusal })
          }
          break
        }

        case 'receipt': {
          routeStdioReply({ type: 'receipt', id: frame.factId, factId: frame.factId, receipt: frame.receipt })
          break
        }

        case 'payload': {
          routeStdioReply({ type: 'payload', id: frame.requestId, requestId: frame.requestId, value: frame.value as Json })
          break
        }
        case 'write-admission': {
          // Grant only while admission is still open; the module settles the exact pending intent.
          routeStdioReply({ type: 'write-admission', id: frame.id, allowed: frame.allowed && !businessClosed })
          break
        }

        case 'ack-failed': {
          // The coordinator could not persist the fact: keep it spooled and fail the in-flight
          // acknowledge so the Driver sees a real error instead of waiting forever.
          void channelError
          routeStdioReply({ type: 'ack-failed', id: frame.factId, factId: frame.factId, reason: frame.reason })
          write({ type: 'progress', id: frame.id, text: `ack failed for ${frame.factId}: ${frame.reason}`, observedAt: new Date().toISOString() })
          break
        }

        case 'shutdown': {
          explicitShutdown = true
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

  /**
   * Terminal endpoint lifetime: when the driver ended naturally with a remote lease attached and the
   * original coordinator exited before its Store committed the barrier, retain the endpoint until the
   * coordinator's authenticated postcommit finalize arrives. A normal explicit shutdown, no remote
   * attach, or a still-running driver returns immediately.
   */
  const awaitPostcommitFinalize = async (): Promise<void> => {
    if (!recoveryEndpoint || !remoteAttached || !naturalTerminal || explicitShutdown) return
    await postcommitFinalize
    // The finalize response is on the wire before shutdown; this local drain is not proof of persistence.
    await new Promise<void>(resolve => setTimeout(resolve, 50))
  }
  const shutdown = async (): Promise<void> => {
    closeAdmission()
    finish()
    await stopPhysical().catch(() => undefined)
    await recoveryEndpoint?.close().catch(() => undefined)
    journal?.close()
  }
  const handle: RunnerServiceHandle = { done, shutdown, awaitPostcommitFinalize }
  return handle
}

/** Entry point used by a spawned Runner process: stdio as the transport. */
export async function mainRunnerService(createOptions: () => Promise<Omit<RunnerServiceOptions, 'input' | 'write'>>): Promise<void> {
  const options = await createOptions()
  // A surviving Runner may outlive its original coordinator's stdout. A closed/broken stdout must never
  // crash the Runner or be mistaken for business failure: the authenticated recovery endpoint continues
  // to serve the same attempt, and later frames are simply not written to the dead adapter.
  let stdoutBroken = false
  process.stdout.on('error', () => { stdoutBroken = true })
  const write = (frame: Record<string, unknown> | BridgeFrame): void => {
    if (stdoutBroken) return
    try { process.stdout.write(encodeFrame(frame)) } catch { stdoutBroken = true }
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
