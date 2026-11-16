/**
 * Wave-31 B2: an attach consumer for an already-registered Runner.
 *
 * Main's ProductExecution owns the original Work/attempt/binding; this module is the B-owned caller it
 * can hand a registration to. It never discovers an endpoint, never creates a Work/attempt/Runner and
 * never originates business commands: it binds the caller-supplied lease, serves the callbacks the
 * Runner asks for through caller handlers (original store ingress / immutable payload / native guard),
 * and exposes the original frame ids it received.
 */
import type { z } from 'zod'
import { CriticalFactSchema, RunnerCommandSchema } from '@personal-agent/contracts'
import { connectRunnerRecovery } from './recovery-transport.ts'
import type { RunnerEndpoint } from './recovery-transport.ts'
import type { RuntimeProducer } from './contracts.ts'

export type AttachedFact = z.infer<typeof CriticalFactSchema>
export type AttachedCommand = z.infer<typeof RunnerCommandSchema>
export type AttachedReceipt = { factId: string; persisted: true; seq: number }
/**
 * The module's payload-read request carries `reference` (the immutable payload ref), never `ref`, and the
 * reply `value` is the ORIGINAL payload itself - not a chunk envelope from a store reader.
 */
export type AttachedPayloadRequest = { requestId: string; reference: string; offset: number; length: number }
export type AttachedNativeIntent = { id: string; command: AttachedCommand }

export type AttachedAttemptCallbacks = {
  /** Durable ingress. Receipts come from the caller's original store; this module never synthesizes one. */
  fact(fact: AttachedFact): Promise<AttachedReceipt>
  /** Original immutable payload store read; the returned value is the payload body itself. */
  payload?(request: AttachedPayloadRequest): Promise<unknown>
  /** Original main/Broker fresh native-write guard. Undefined means every intent is refused. */
  nativeWrite?(intent: AttachedNativeIntent): Promise<{ allowed: boolean; reason?: string }>
}

/**
 * The original host handle main actually publishes: the registered port plus its shared original
 * callbacks. Attaching through this helper guarantees both come from the SAME original attempt, so a
 * caller cannot pair a port with a different store/guard.
 */
export type AttachableRunningAttempt = {
  readonly attemptId: string
  readonly attachPort?: {
    readonly registration: { socketPath: string; credentialPath: string; socketIdentity: { dev: number; ino: number } }
    readonly producer: unknown
  }
  readonly attachCallbacks?: AttachedAttemptCallbacks
}

export type AttachedAttempt = {
  leaseId: string
  generation: number
  served: { facts: number; payloads: number; nativeWrites: number; refused: number; errors: number }
  /** Pull and serve at most one pending request. Returns true when a request was served. */
  pollOnce(): Promise<boolean>
  /** Poll on a bounded interval until stop() or the deadline. */
  run(options?: { pollMs?: number; deadlineMs?: number }): Promise<void>
  stop(): void
  /** Read-only original inspection for the caller (state/resources), never a permission. */
  inspect(): Promise<unknown>
  /**
   * Feed one original business command to the SAME registered attempt through its feed transport. This is
   * admission of an authenticated command, not proof that the native side acted, and it never launches a
   * new attempt. The command keeps its original id.
   */
  feed(command: AttachedCommand): Promise<unknown>
  /** Cancel through the original cancel transport; the caller supplies the original cancel command id. */
  cancel(command: Extract<AttachedCommand, { kind: 'cancel' }>): Promise<unknown>
}

export type AttachAttemptInput = {
  endpoint: RunnerEndpoint
  producer: RuntimeProducer
  /** Explicitly selected lease id by the caller; this module never invents a second owner. */
  leaseId: string
  callbacks: AttachedAttemptCallbacks
  timeoutMs?: number
}

/**
 * Normalize the caller's fresh native guard: only an explicit `{allowed:true}` return authorizes. A void
 * return, a denial, or a thrown guard all become `allowed:false`; the guard is always awaited.
 */
export async function resolveNativeDecision(guard: AttachedAttemptCallbacks['nativeWrite'], intent: AttachedNativeIntent): Promise<{ allowed: boolean; reason?: string }> {
  if (!guard) return { allowed: false, reason: 'no_native_guard' }
  try {
    const decision = await guard(intent)
    return decision && decision.allowed === true ? { allowed: true } : { allowed: false, reason: decision?.reason ?? 'denied' }
  } catch (error) {
    return { allowed: false, reason: `guard_threw:${String((error as { message?: string })?.message ?? error).slice(0, 120)}` }
  }
}

/**
 * Attach to the ORIGINAL RunningAttempt main exposes. The registration, producer and callbacks are all
 * read from that one handle; missing pieces are refused rather than substituted with local defaults.
 */
export function attachRunningAttempt(handle: AttachableRunningAttempt, leaseId: string, options: { timeoutMs?: number } = {}): AttachedAttempt {
  if (!handle?.attachPort) throw new Error('The original Runner has no registered attachPort yet')
  if (!handle.attachCallbacks) throw new Error('The original Runner exposes no shared attachCallbacks')
  if (!handle.attemptId) throw new Error('The original Runner handle has no attempt identity')
  const producerAttempt = (handle.attachPort.producer as { attempt?: { attemptId?: unknown } } | undefined)?.attempt
  if (producerAttempt?.attemptId !== handle.attemptId) throw new Error('The attachPort producer does not belong to this original attempt')
  return attachRunnerAttempt({
    endpoint: handle.attachPort.registration,
    producer: handle.attachPort.producer as AttachAttemptInput['producer'],
    leaseId,
    callbacks: handle.attachCallbacks,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  })
}

export function attachRunnerAttempt(input: AttachAttemptInput): AttachedAttempt {
  const client = connectRunnerRecovery(input.endpoint, input.producer, input.timeoutMs ?? 3000)
  if (!client.channelState || !client.channelNext || !client.channelReply) throw new Error('runner does not expose the attach channel')
  const served = { facts: 0, payloads: 0, nativeWrites: 0, refused: 0, errors: 0 }
  let generation = 0
  let bound = false
  let stopped = false

  const bind = async (): Promise<void> => {
    if (bound) return
    const state = await client.channelState!()
    const page = await client.channelNext!(input.leaseId, state.generation)
    generation = page?.generation ?? state.generation
    bound = true
  }

  const reply = async (request: { type: string; id?: string; requestId?: string; command?: unknown; ref?: string; offset?: number; length?: number }) => {
    if (request.type === 'fact') {
      const fact = CriticalFactSchema.parse((request as { fact?: unknown }).fact)
      const receipt = await input.callbacks.fact(fact)
      // The frame id and the fact id are the originals the Runner sent; no new correlation id is invented.
      const id = (request as { id: string }).id
      await client.channelReply!(input.leaseId, { v: 1, type: 'receipt', id, factId: fact.factId, receipt })
      served.facts += 1
      return
    }
    if (request.type === 'payload-read') {
      const requestId = (request as { requestId: string }).requestId
      if (!input.callbacks.payload) { served.refused += 1; await client.channelReply!(input.leaseId, { v: 1, type: 'payload-refused', id: requestId, requestId, reason: 'no_payload_store' }); return }
      // `reference` is the module's field name; `value` is the original payload body itself.
      const value = await input.callbacks.payload({
        requestId,
        reference: (request as { reference?: string }).reference ?? '',
        offset: Number((request as { offset?: number }).offset ?? 0),
        length: Number((request as { length?: number }).length ?? 0),
      })
      await client.channelReply!(input.leaseId, { v: 1, type: 'payload', id: requestId, requestId, value })
      served.payloads += 1
      return
    }
    if (request.type === 'native-write-intent') {
      const command = RunnerCommandSchema.parse((request as { command?: unknown }).command)
      // The caller's guard is awaited; void/throw/deny never authorize a native write.
      const decision = await resolveNativeDecision(input.callbacks.nativeWrite, { id: (request as { id: string }).id, command })
      await client.channelReply!(input.leaseId, { v: 1, type: 'write-admission', id: (request as { id: string }).id, allowed: decision.allowed })
      served.nativeWrites += 1
      return
    }
    served.refused += 1
  }

  return {
    leaseId: input.leaseId,
    get generation() { return generation },
    served,
    async pollOnce() {
      if (stopped) return false
      await bind()
      const page = await client.channelNext!(input.leaseId, generation)
      if (!page?.request) return false
      try {
        await reply(page.request as never)
      } catch (error) {
        // A callback failure is reported, never silently converted into a synthetic receipt/permission.
        served.errors += 1
        const id = (page.request as { id?: string }).id
        if (id) await client.channelReply!(input.leaseId, { v: 1, type: 'ack-failed', id, factId: id, reason: 'callback_failed' }).catch(() => undefined)
      }
      return true
    },
    async run(options = {}) {
      const deadline = Date.now() + (options.deadlineMs ?? 30_000)
      while (!stopped && Date.now() < deadline) {
        const handled = await this.pollOnce().catch(() => { served.errors += 1; return false })
        if (!handled) await new Promise(resolve => setTimeout(resolve, options.pollMs ?? 25))
      }
    },
    stop() { stopped = true },
    inspect: () => client.inspect(),
    feed: async command => {
      if (!client.command) throw new Error('Runner does not expose the original command feed')
      return client.command(command, input.leaseId)
    },
    cancel: async command => {
      if (!client.cancel) throw new Error('Runner does not expose the original cancel transport')
      return client.cancel(command, input.leaseId)
    },
  }
}
