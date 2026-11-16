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
}

export type AttachAttemptInput = {
  endpoint: RunnerEndpoint
  producer: RuntimeProducer
  /** Explicitly selected lease id by the caller; this module never invents a second owner. */
  leaseId: string
  callbacks: AttachedAttemptCallbacks
  timeoutMs?: number
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
      const decision = input.callbacks.nativeWrite ? await input.callbacks.nativeWrite({ id: (request as { id: string }).id, command }) : { allowed: false as const, reason: 'no_native_guard' }
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
  }
}
