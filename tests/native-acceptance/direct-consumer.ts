/**
 * Direct actual-consumer strict check for the recovery transport.
 *
 * This file is not a harness; it exists so `tsconfig.direct.json` compiles the REAL consumer surface
 * (connectRunnerRecovery / serveRunnerRecovery and their error semantics) under strict +
 * exactOptionalPropertyTypes. Root tsconfig only covers src/ and tests/, so a green root typecheck is
 * not evidence for packages/execution.
 */
import {
  RunnerLinkError,
  connectRunnerRecovery,
  type RunnerEndpoint,
} from '../../packages/execution/src/recovery-transport.ts'
import type { AttemptRef, ContractRef } from '../../packages/contracts/src/types.ts'

/** A named server refusal must keep its exact serverError while the base code stays 'refused'. */
export function classifyRefusal(error: unknown): { base: 'refused' | 'auth_failed' | 'unavailable' | 'unknown_outcome'; server: string | null } {
  if (!(error instanceof RunnerLinkError)) return { base: 'unavailable', server: null }
  const server = typeof (error as RunnerLinkError & { serverError?: string | null }).serverError === 'string'
    ? (error as RunnerLinkError & { serverError: string }).serverError
    : null
  switch (error.code) {
    case 'refused': return { base: 'refused', server }
    case 'auth_failed': return { base: 'auth_failed', server }
    case 'unknown_outcome': return { base: 'unknown_outcome', server }
    default: return { base: 'unavailable', server }
  }
}

/** Structural twins of the transport's producer/attempt shapes, so the consumer is checked as a consumer. */
type Attempt = { ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contract: ContractRef }
type Producer = { attempt: Attempt; runnerIdentityRef: string; source: string }

export async function consumeAttach(endpoint: RunnerEndpoint, attempt: Attempt, producer: Producer): Promise<{
  generation: number
  requestType: string | null
  accepted: boolean
}> {
  const client = connectRunnerRecovery(endpoint, { attempt, runnerIdentityRef: producer.runnerIdentityRef, source: producer.source }, 2_000)
  const state: { generation: number } = await client.channelState()
  const page: { generation: number; request: unknown | null } = await client.channelNext('strict-lease', state.generation)
  const routed: { accepted: boolean; generation: number } = await client.channelReply('strict-lease', { v: 1, type: 'write-admission', id: 'strict-intent', allowed: false })
  const request = page.request as { type?: unknown } | null
  return { generation: routed.generation, requestType: typeof request?.type === 'string' ? request.type : null, accepted: routed.accepted }
}
