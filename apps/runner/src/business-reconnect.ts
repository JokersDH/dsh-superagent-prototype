/**
 * B-owned business reconnect wrapper (wave-20).
 *
 * Wave-19 shipped a first cut that a review correctly refused. Three defects, all fixed here:
 *
 * 1. A foreign `source` cancel reached the receiver before the identity error. The wrapper now runs the
 *    authenticated inspection first; the server checks the bound producer (including source and
 *    runnerIdentityRef) and refuses, so no cancel is ever written for a foreign producer.
 * 2. The registered socket inode was discarded and the path re-pinned from a fresh lstat, so a
 *    replacement socket at the same path was accepted. The registered dev/ino is now passed through
 *    verbatim; the transport's own pin rejects a changed inode.
 * 3. The refusal union used two different spellings for one condition, which fails strict consumers.
 *    There is now one name: `epoch_not_current`.
 *
 * What this is NOT: authenticated inspect plus cancel is not a business resume. There is no business
 * stream, session, fact sink or Broker attach here, and `sent` is not proof of fresh quiescence - the
 * proof returned alongside it is an inspection snapshot, which the caller must re-read.
 *
 * The caller keeps every guard: the product's before-write callback still runs, unsuppressed, before
 * any cancel leaves. This file opens no socket and creates no credential; it consumes the endpoint
 * that A registered for the attempt.
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

type CancelCommand = Extract<RunnerCommand, { kind: 'cancel' }>

export type BusinessReconnectOptions = {
  /** Runner state root, used only when no registered endpoint is supplied. */
  stateRoot: string
  binding: BusinessBinding
  /** What the caller believes is current. A mismatch is refused locally, never reconciled by guessing. */
  expected: { ticketId: string; attemptId: string; fenceEpoch: number }
  /**
   * The endpoint A registered for this attempt, including its pinned socketIdentity. This is the only
   * endpoint the wrapper will use; it never scans for sockets or recomputes the inode.
   */
  endpoint?: { socketPath: string; credentialPath: string; socketIdentity: { dev: number; ino: number } }
  /** Preserved product guard: runs immediately before any cancel is written. */
  beforeWrite: (command: CancelCommand) => Promise<void>
  /** Ids the Runner already recorded. A recorded command is never resent. */
  alreadyRecorded: (commandId: string) => boolean
  timeoutMs?: number
}

export type ReconnectRefusal =
  | { refused: 'identity_mismatch'; detail: string }
  | { refused: 'epoch_not_current'; detail: string }
  | { refused: 'already_recorded'; detail: string }

export type CancelOutcome =
  /** `sent` records that the transport accepted the cancel; `proof` is the inspection it preceded. */
  | { sent: true; kind: 'cancel'; proof: VerifiedRunnerInspection }
  | ReconnectRefusal

export type BusinessReconnect = {
  /** Authenticated inspection bound to this exact attempt. Refuses before any side effect. */
  inspect(): Promise<VerifiedRunnerInspection>
  cancel(command: CancelCommand): Promise<CancelOutcome>
  close(): void
}

const refusing = (refusal: ReconnectRefusal): BusinessReconnect => ({
  async inspect() {
    throw new Error(`business reconnect refused (${refusal.refused}): ${refusal.detail}`)
  },
  async cancel() {
    return refusal
  },
  close() {},
})

/**
 * Resolves the endpoint to use. An explicitly registered endpoint wins and is used verbatim, inode
 * included. Only when the caller has none does the wrapper derive the conventional path - and even
 * then it pins whatever inode it finds, which is exactly why a caller with a registration must pass it.
 */
function resolveEndpoint(options: BusinessReconnectOptions): { socketPath: string; credentialPath: string; socketIdentity?: { dev: number; ino: number } } {
  if (options.endpoint) return options.endpoint
  const directory = endpointDirectory(options.stateRoot, options.binding.attemptId)
  const socketPath = `${directory}/${SOCKET_FILE}`
  const stat = lstatSync(socketPath)
  if (!stat.isSocket()) throw new Error(`derived runner endpoint is not a socket: ${socketPath}`)
  return { socketPath, credentialPath: `${directory}/${CREDENTIAL_FILE}`, socketIdentity: { dev: stat.dev, ino: stat.ino } }
}

export async function reconnectBusinessRunner(options: BusinessReconnectOptions): Promise<BusinessReconnect> {
  const { binding, expected } = options

  const identityProblem =
    expected.ticketId !== binding.ticketId
      ? `expected ticket ${expected.ticketId} but the binding carries ${binding.ticketId}`
      : expected.attemptId !== binding.attemptId
        ? `expected attempt ${expected.attemptId} but the binding carries ${binding.attemptId}`
        : null
  if (identityProblem) return refusing({ refused: 'identity_mismatch', detail: identityProblem })
  // Continuing at an epoch other than the durable one is writing into history, in either direction.
  if (expected.fenceEpoch !== binding.fenceEpoch) {
    return refusing({
      refused: 'epoch_not_current',
      detail: `expected epoch ${expected.fenceEpoch} but the current binding is epoch ${binding.fenceEpoch}`,
    })
  }

  const endpoint = resolveEndpoint(options)
  const client = connectRunnerRecovery(
    endpoint,
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
      // Authenticated identity first: a foreign producer, a replaced socket or a wrong principal is
      // refused by the server before this wrapper writes anything. Moving this after the guard would
      // let a foreign cancel reach the receiver, which is the defect this ordering exists to prevent.
      const proof = await client.inspect()
      await options.beforeWrite(command)
      await client.cancel(command)
      return { sent: true, kind: 'cancel', proof }
    },
    close: () => {},
  }
}

/**
 * Builds the registered endpoint for an attempt from A's immutable registration, so a caller never
 * scans for sockets or invents a credential path. `loadRecoveryRunner` is imported lazily to keep this
 * module free of a coordinator dependency at load time.
 */
export async function registeredEndpointFor(store: unknown, attemptId: string) {
  const registry = await import('../../coordinator/runner-registry.ts')
  const registration = registry.loadRecoveryRunner(store as Parameters<typeof registry.loadRecoveryRunner>[0], attemptId)
  if (!registration) throw new Error(`no Runner registration for attempt ${attemptId}`)
  return {
    endpoint: registration.body.endpoint,
    producer: registration.body.producer,
    registrationDigest: registration.digest,
  }
}

/** True when a rebuilt binding really describes the same work/revision/digest as the stored contract. */
export const bindingMatchesContract = (binding: BusinessBinding, contract: AttemptSpec['contract']) =>
  binding.contract.workId === contract.workId &&
  binding.contract.revision === contract.revision &&
  binding.contract.digest === contract.digest
