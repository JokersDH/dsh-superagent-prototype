/**
 * wave-36: a coherent typed client for the authenticated attach channel.
 *
 * `connectRunnerRecovery()` returns a client whose runtime arity is `(leaseId, generation)` for
 * `channelNext`/`channelReply`, while the server-side `RecoveryRunnerPort` documented in the same file
 * takes `(producer, leaseId, generation)`. Passing the producer where the lease belongs is a silent
 * type confusion (`invalid_lease` at the server). This adapter names the real shapes once so callers
 * cannot swap them, and adds nothing else: no transport, no retry, no state.
 */
import type { RunnerCommand } from '../../../../packages/contracts/src/types.ts'
import type { RuntimeProducer } from '../../../../packages/execution/src/contracts.ts'
import {
  connectRunnerRecovery,
  type RunnerEndpoint,
  type RunnerInspection,
  type RunnerState,
} from '../../../../packages/execution/src/recovery-transport.ts'

/** The client reports the full inspection; callers of control need only the state projection. */
function stateOf(inspection: RunnerInspection): RunnerState {
  return {
    state: inspection.state,
    admission: inspection.admission,
    coverage: inspection.coverage,
    resources: inspection.resources,
    evidence: inspection.evidence,
  }
}

export type AttachPage = { readonly generation: number; readonly request: unknown }
export type AttachReplyResult = { readonly accepted: boolean; readonly generation: number }
export type AttachFactsPage = { readonly frames: readonly unknown[]; readonly next: number; readonly done: boolean }
export type AttachPayloadChunk = { readonly total: number; readonly digest: string; readonly base64: string; readonly offset: number; readonly length: number }

/** The client contract. `producer` is fixed at connect time; it is never an argument here. */
export type AttachClient = {
  state(): Promise<{ generation: number }>
  next(leaseId: string, expectedGeneration: number): Promise<AttachPage | null>
  reply(leaseId: string, reply: unknown): Promise<AttachReplyResult>
  inspect(): Promise<RunnerState>
  cancel(command: Extract<RunnerCommand, { kind: 'cancel' }>): Promise<RunnerState>
  command(command: RunnerCommand): Promise<RunnerState>
  facts(since: number, maxBytes: number): Promise<AttachFactsPage>
  payload(ref: string, offset: number, length: number): Promise<AttachPayloadChunk>
}

/**
 * Open the client for one authenticated endpoint/producer. Fails closed when the Runner does not
 * expose the attach channel, so a caller never degrades to a partial control path silently.
 */
export function openAttachClient(endpoint: RunnerEndpoint, producer: RuntimeProducer, timeoutMs = 3000): AttachClient {
  const client = connectRunnerRecovery(endpoint, producer, timeoutMs)
  if (!client.channelState || !client.channelNext || !client.channelReply)
    throw new Error('runner does not expose the attach channel')
  return {
    state: () => client.channelState!(),
    next: (leaseId, expectedGeneration) => client.channelNext!(leaseId, expectedGeneration),
    reply: (leaseId, reply) => client.channelReply!(leaseId, reply),
    inspect: async () => stateOf((await client.inspect!()).inspection),
    cancel: async command => stateOf((await client.cancel!(command)).inspection),
    command: async command => stateOf((await client.command!(command)).inspection),
    facts: async (since, maxBytes) => {
      const page = await client.facts!(since, maxBytes)
      return { frames: page.frames, next: page.next, done: page.done }
    },
    payload: (ref, offset, length) => client.payload!(ref, offset, length),
  }
}
