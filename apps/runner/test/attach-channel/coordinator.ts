/**
 * Test-side coordinator double for the v1 channel frames.
 *
 * It stands in for the product coordinator/app-server: the durable sink, immutable payload store and
 * fresh write guard live on that side in production. The sink here is an *idempotency double*, not
 * A's persisted ingress; nothing in these tests proves real durability.
 */
import type {
  CoordinatorChannelReply,
  CoordinatorChannelRequest,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import { DurableSink, FreshGuard, ImmutablePayloads } from './fixtures.ts'

export class CoordinatorDouble {
  readonly sink = new DurableSink()
  readonly payloads = new ImmutablePayloads()
  readonly guard = new FreshGuard()
  readonly received: CoordinatorChannelRequest[] = []

  /** The transport callback handed to the adapter: record the frame; the test decides when to answer. */
  transport = (request: CoordinatorChannelRequest): void => {
    this.received.push(request)
  }

  async handle(request: CoordinatorChannelRequest): Promise<CoordinatorChannelReply | undefined> {
    switch (request.type) {
      case 'fact': {
        try {
          const receipt = await this.sink.record(request.fact)
          return { v: 1, type: 'receipt', id: request.fact.factId, factId: request.fact.factId, receipt }
        } catch {
          return { v: 1, type: 'ack-failed', id: request.fact.factId, factId: request.fact.factId, reason: 'conflict' }
        }
      }
      case 'payload-read': {
        try {
          const value = await this.payloads.read(request.reference)
          return { v: 1, type: 'payload', id: request.requestId, requestId: request.requestId, value }
        } catch {
          // An unavailable coordinator does not answer; the local pending keeps its deadline.
          return undefined
        }
      }
      case 'native-write-intent': {
        const allowed = await this.guard.check(request.command.id)
        return { v: 1, type: 'write-admission', id: request.id, allowed }
      }
      default:
        return undefined
    }
  }
}
