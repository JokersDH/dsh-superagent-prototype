/**
 * Minimal Runner-side adapter for the concrete attach channel.
 *
 * This is the shape B's `runner-service` / `RunnerLinkClient` should consume: one channel per
 * attempt, one live lease per authenticated connection, and three ordinary hooks for the Driver.
 * The adapter holds **no** waiter map, timer, generation counter or reply-dedup table of its own;
 * everything of that kind lives inside `CoordinatorChannelModule`.
 *
 * Two routing rules B must preserve, encoded here as `accept`/`drop`:
 *  1. A reply may only be delivered to the lease of the connection that produced it.
 *  2. A dropped connection never settles the replacement's pending work.
 */
import type {
  CoordinatorChannelLease,
  CoordinatorChannelLimits,
  CoordinatorChannelProducer,
  CoordinatorChannelRequest,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import type { CriticalFact, DurableReceipt, Json, RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import { CoordinatorChannelModule } from '../../src/attach-channel/coordinator-channel.ts'

export type AttachTransport = {
  /** Write one already-built v1 request frame on this connection. */
  send(request: CoordinatorChannelRequest): void | Promise<void>
}

export type AttachHooks = {
  readonly factSink: { record(fact: CriticalFact): Promise<DurableReceipt> }
  readonly payloads: { read(reference: string): Promise<Json> }
  readonly beforeNativeWrite: (command: RunnerCommand) => Promise<void>
}

export type AttachOptions = {
  readonly producer: CoordinatorChannelProducer
  readonly limits: CoordinatorChannelLimits
  readonly now?: () => number
  readonly schedule?: (delayMs: number, callback: () => void) => () => void
}

export class RunnerAttachChannel {
  readonly #channel: CoordinatorChannelModule
  readonly #hooks: AttachHooks
  #lease: CoordinatorChannelLease | undefined

  constructor(options: AttachOptions) {
    // A relative `now`/`schedule` pair can be omitted in production (Date.now / bounded timer) and
    // must be supplied together in tests so deadlines are observed deterministically.
    this.#channel = new CoordinatorChannelModule(options)
    this.#hooks = {
      factSink: { record: fact => this.#channel.recordFact(fact) },
      payloads: { read: reference => this.#channel.readPayload(reference) },
      beforeNativeWrite: command => this.#channel.beforeNativeWrite(command),
    }
  }

  get hooks(): AttachHooks {
    return this.#hooks
  }

  get channel(): CoordinatorChannelModule {
    return this.#channel
  }

  /** Bind one authenticated connection. Returns the lease generation B should report. */
  bind(input: { readonly connectionId: string; readonly expectedGeneration: number; readonly transport: AttachTransport }): number {
    const lease = this.#channel.bind({
      producer: this.#channel.producer,
      connectionId: input.connectionId,
      expectedGeneration: input.expectedGeneration,
      send: request => input.transport.send(request),
    })
    this.#lease = lease
    return lease.generation
  }

  /**
   * Deliver one decoded coordinator reply. A frame from a connection that is no longer live is
   * refused here rather than resolved against the current lease.
   */
  accept(connectionId: string, frame: unknown): boolean {
    const lease = this.#lease
    if (!lease || lease.connectionId !== connectionId) return false
    return lease.receive(frame)
  }

  /** The connection went away. Pending writes become indeterminate; facts/payloads keep waiting. */
  drop(connectionId: string, reason?: string): void {
    const lease = this.#lease
    if (!lease || lease.connectionId !== connectionId) return
    this.#lease = undefined
    lease.close(reason)
  }

  close(reason?: string): void {
    this.#lease = undefined
    this.#channel.close(reason)
  }

  inspect(): ReturnType<CoordinatorChannelModule['inspect']> {
    return this.#channel.inspect()
  }
}
