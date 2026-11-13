/**
 * B-owned business reconnect port (wave-19 B4).
 *
 * The gap this closes: after a coordinator restart the product had no way to reach a Runner that is
 * still serving an attempt. Everything else was a descriptor, an in-memory writer, or a receipt the
 * caller wrote for itself. This port reconnects to the SAME Runner over the authenticated recovery
 * channel and re-binds the ORIGINAL attempt, ticket, assignment, contract, identity and fence epoch
 * taken from the caller's durable state.
 *
 * The recovery channel carries exactly what the Runner serves there - authenticated inspection and
 * cancel - because answers travel over the live attempt bridge, not this socket. Claiming otherwise
 * would be inventing a capability.
 *
 * Constraints kept deliberately:
 * - no second ledger, coordinator or lifecycle: the caller passes its own store readers and the
 *   credential the Runner itself wrote;
 * - the product's before-write guard still runs, unsuppressed, immediately before any cancel leaves;
 * - a foreign or stale identity is refused before the socket is used to write anything;
 * - an id the Runner already recorded is never resent, because an unknown native send must be
 *   reconciled rather than repeated.
 */
import { lstatSync } from 'node:fs'
import { connectRunnerRecovery } from '../../../packages/execution/src/recovery-transport.ts'
import type { VerifiedRunnerInspection } from '../../../packages/execution/src/recovery-transport.ts'
import type { AttemptSpec, RunnerCommand } from '../../../packages/contracts/src/types.ts'
import { CREDENTIAL_FILE, SOCKET_FILE, endpointDirectory } from './recovery-endpoint.ts'

/** What the caller supplies from its own durable state. Nothing here is inferred. */
export type BusinessBinding = {
  ticketId: string
  assignmentId: string
  attemptId: string
  fenceEpoch: number
  contract: AttemptSpec['contract']
  runnerIdentityRef: string
  source: string
}

export type BusinessReconnectOptions = {
  /** Runner state root holding this attempt's recovery socket and credential. */
  stateRoot: string
  binding: BusinessBinding
  /** What the caller believes is current. A mismatch is refused, never reconciled by guessing. */
  expected: { ticketId: string; attemptId: string; fenceEpoch: number }
  /** Product guard, preserved: runs immediately before any cancel is written. */
  beforeWrite: (command: RunnerCommand) => Promise<void>
  /** Ids the Runner already recorded. These are never sent again. */
  alreadyRecorded: (commandId: string) => boolean
  /**
   * The registered endpoint, when the caller discovered it rather than deriving it. Long socket paths
   * are shortened to a hashed directory, so the path cannot always be recomputed from the root; the
   * client still pins the socket inode and the inspection is identity-checked, so a wrong socket is
   * refused rather than trusted.
   */
  endpoint?: { socketPath: string; credentialPath: string }
  timeoutMs?: number
}

export type ReconnectRefusal =
  | { refused: 'identity_mismatch'; detail: string }
  | { refused: 'epoch_not_current'; detail: string }
  | { refused: 'already_recorded'; detail: string }

export type BusinessReconnect = {
  /** Authenticated inspection of the live Runner, bound to this exact attempt. */
  inspect(): Promise<VerifiedRunnerInspection>
  /** Authenticated recovery cancel, or a refusal that wrote nothing. */
  cancel(command: Extract<RunnerCommand, { kind: 'cancel' }>): Promise<{ sent: true; kind: 'cancel' } | ReconnectRefusal>
  close(): void
}

const refusalOf = (refusal: ReconnectRefusal): BusinessReconnect => ({
  async inspect() {
    throw new Error(`business reconnect refused (${refusal.refused}): ${refusal.detail}`)
  },
  async cancel() {
    return refusal
  },
  close() {},
})

/**
 * Connects to a Runner still serving the bound attempt. Identity and epoch are checked before the
 * socket is used, so a mismatched ticket/attempt/epoch cannot write.
 */
export async function reconnectBusinessRunner(options: BusinessReconnectOptions): Promise<BusinessReconnect> {
  const { binding, expected } = options
  const directory = endpointDirectory(options.stateRoot, binding.attemptId)

  const identityProblem =
    expected.ticketId !== binding.ticketId
      ? `expected ticket ${expected.ticketId} but the binding carries ${binding.ticketId}`
      : expected.attemptId !== binding.attemptId
        ? `expected attempt ${expected.attemptId} but the binding carries ${binding.attemptId}`
        : null
  if (identityProblem) return refusalOf({ refused: 'identity_mismatch', detail: identityProblem })
  // Asking to keep writing at an older epoch than the durable one is asking to write into history.
  if (expected.fenceEpoch !== binding.fenceEpoch) {
    return refusalOf({
      refused: 'stale_epoch',
      detail: `expected epoch ${expected.fenceEpoch} but the current binding is epoch ${binding.fenceEpoch}`,
    })
  }

  const socketPath = options.endpoint?.socketPath ?? `${directory}/${SOCKET_FILE}`
  const credentialPath = options.endpoint?.credentialPath ?? `${directory}/${CREDENTIAL_FILE}`
  // The client pins the socket identity, so read it from the real inode rather than trusting a path.
  const stat = lstatSync(socketPath)
  if (!stat.isSocket()) throw new Error(`registered runner socket is not a socket: ${socketPath}`)

  const client = connectRunnerRecovery(
    { socketPath, credentialPath, socketIdentity: { dev: stat.dev, ino: stat.ino } },
    {
      attempt: {
        ticketId: binding.ticketId,
        assignmentId: binding.assignmentId,
        attemptId: binding.attemptId,
        fenceEpoch: binding.fenceEpoch,
        contract: binding.contract,
      },
      runnerIdentityRef: binding.runnerIdentityRef,
      source: binding.source,
    },
    options.timeoutMs ?? 3000,
  )

  return {
    inspect: () => client.inspect(),
    async cancel(command) {
      if (options.alreadyRecorded(command.id)) {
        return { refused: 'already_recorded', detail: `command ${command.id} is already recorded; it is not resent` }
      }
      await options.beforeWrite(command)
      await client.cancel(command)
      return { sent: true, kind: 'cancel' }
    },
    close: () => {},
  }
}

export const bindingMatchesContract = (binding: BusinessBinding, contract: AttemptSpec['contract']) =>
  binding.contract.workId === contract.workId &&
  binding.contract.revision === contract.revision &&
  binding.contract.digest === contract.digest
