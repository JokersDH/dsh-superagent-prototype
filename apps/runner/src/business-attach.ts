/**
 * B-owned business attach port (wave-22 milestone 1).
 *
 * The gap this closes is the one every earlier wave left open. Inspect and cancel are control
 * operations; they are not a business resume. This port carries the actual business channel over the
 * SAME authenticated Runner endpoint the control channel already uses:
 *
 * - facts already recorded by the Runner are replayed from its own durable journal, so a second client
 *   recovers the original work without a second ledger;
 * - business commands (begin/answer/cancel) are admitted to the SAME attempt and child;
 * - the caller's Broker before-write callback runs before any command leaves, unsuppressed;
 * - the original attempt, session, contract and fence epoch are re-bound from the caller's own state.
 *
 * What it deliberately does not do: it opens no socket, creates no credential, keeps no receipt table,
 * and never claims that a sent command is quiescence. A returned proof is an inspection snapshot the
 * caller must re-read before it leans on any resource being gone.
 */
import { connectRunnerRecovery } from '../../../packages/execution/src/recovery-transport.ts'
import type { RunnerEndpoint, VerifiedRunnerInspection } from '../../../packages/execution/src/recovery-transport.ts'
import type { AttemptSpec, RunnerCommand } from '../../../packages/contracts/src/types.ts'

export type AttachBinding = {
  ticketId: string
  assignmentId: string
  attemptId: string
  fenceEpoch: number
  contract: AttemptSpec['contract']
  runnerIdentityRef: string
  source: string
}

/** Result of reconciling one command id against the caller's durable state. */
export type AttachReconciliation =
  | { state: 'not_seen' }
  | { state: 'intent_recorded'; detail?: string }
  | { state: 'observed'; detail?: string }
  | { state: 'unknown'; detail: string }

export type BusinessAttachOptions = {
  /** The endpoint A registered for this attempt, including its pinned socketIdentity. */
  endpoint: RunnerEndpoint
  binding: AttachBinding
  /** What the caller believes is current; a mismatch is refused locally before anything is sent. */
  expected: { ticketId: string; attemptId: string; fenceEpoch: number }
  /** Preserved product guard: the Broker's before-write callback, run before any command leaves. */
  beforeCommand: (command: RunnerCommand) => Promise<void>
  /** State-aware reconciliation so a pending intent is not mistaken for an observed delivery. */
  reconcile?: (commandId: string) => AttachReconciliation
  timeoutMs?: number
}

export type AttachRefusal =
  | { refused: 'identity_mismatch'; detail: string }
  | { refused: 'epoch_not_current'; detail: string }
  | { refused: 'already_observed'; detail: string }
  | { refused: 'indeterminate'; detail: string }

export type AttachSendOutcome =
  | { sent: true; kind: RunnerCommand['kind']; proof: VerifiedRunnerInspection }
  | AttachRefusal

export type BusinessAttach = {
  /** Authenticated inspection of the live Runner bound to this exact attempt. */
  inspect(): Promise<VerifiedRunnerInspection>
  /** Facts the Runner already recorded from `since`, read from its own journal. */
  facts(since?: number): Promise<{ frames: unknown[]; next: number }>
  /** Send one original business command, or return a refusal that wrote nothing. */
  send(command: RunnerCommand): Promise<AttachSendOutcome>
  close(): void
}

export async function attachBusinessRunner(options: BusinessAttachOptions): Promise<BusinessAttach> {
  const { binding, expected, endpoint } = options

  const identityProblem =
    expected.ticketId !== binding.ticketId
      ? `expected ticket ${expected.ticketId} but the binding carries ${binding.ticketId}`
      : expected.attemptId !== binding.attemptId
        ? `expected attempt ${expected.attemptId} but the binding carries ${binding.attemptId}`
        : null
  if (identityProblem) return refusingAttach({ refused: 'identity_mismatch', detail: identityProblem })
  if (expected.fenceEpoch !== binding.fenceEpoch) {
    return refusingAttach({
      refused: 'epoch_not_current',
      detail: `expected epoch ${expected.fenceEpoch} but the current binding is epoch ${binding.fenceEpoch}`,
    })
  }
  // A registered endpoint always carries its pinned identity; refusing here keeps a repinned path from
  // ever reaching the transport, which is the defect the wave-20 review found.
  if (!endpoint.socketIdentity || !Number.isSafeInteger(endpoint.socketIdentity.dev)) {
    return refusingAttach({ refused: 'identity_mismatch', detail: 'the attach endpoint has no pinned socket identity' })
  }

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
    facts: (since = 0) => client.facts(since),
    async send(command) {
      const reconciliation: AttachReconciliation = options.reconcile?.(command.id) ?? { state: 'not_seen' }
      if (reconciliation.state === 'observed') {
        return { refused: 'already_observed', detail: `command ${command.id} already has an observed result; it is not resent` }
      }
      if (reconciliation.state === 'unknown') return { refused: 'indeterminate', detail: reconciliation.detail }
      // Authenticated admission first: a foreign producer, replaced socket or wrong principal is refused
      // by the server before this port writes anything.
      await client.inspect()
      // The Broker's own guard, unchanged: it can still refuse the write.
      await options.beforeCommand(command)
      const proof = await client.command(command)
      // `sent` is admission of the command, not proof that the writer is quiescent or the turn ended.
      return { sent: true, kind: command.kind, proof }
    },
    close: () => {},
  }
}

const refusingAttach = (refusal: AttachRefusal): BusinessAttach => ({
  async inspect() {
    throw new Error(`business attach refused (${refusal.refused}): ${refusal.detail}`)
  },
  async facts() {
    return { frames: [], next: 0 }
  },
  async send() {
    return refusal
  },
  close() {},
})
