import { DigestSchema, IdSchema, PersistedProposalSchema } from '@personal-agent/contracts'
import type { ContractRef, PersistedProposal, ReasonerProposal, Scope } from '@personal-agent/contracts'
import { AssistantStateConflict } from './assistant-state-memory.ts'
import type { AssistantStatePort } from '@personal-agent/contracts'
import { ProposalError } from './errors.ts'
import { parseStructuredOutput, proposalDigest, proposalIntent, validateProposalBindings } from './parser.ts'
import { snapshot } from './snapshot.ts'
import type { ProposalIntent, ProposalTrustedContext } from './types.ts'
import { planProposalCommand } from './command-plan.ts'
import type { CommandPlan, CommandPlanInput } from './command-plan.ts'
import type { UserCommand } from '@personal-agent/contracts'

const DEFAULT_TTL_MS = 15 * 60 * 1000

export interface PrepareProposalInput {
  readonly proposalId: string
  readonly payload: unknown
  readonly trusted: ProposalTrustedContext
  readonly conversationId: string
  readonly sourceTextDigest: string
  readonly now?: Date
  readonly ttlMs?: number
}

/** A read-only candidate produced by prepare. It is not persisted or confirmed. */
export interface PreparedProposal {
  readonly proposalId: string
  readonly projectId: string
  readonly conversationId: string
  readonly sourceMessageId: string
  readonly sourceTextDigest: string
  readonly actorRef: string
  readonly grantId: string
  readonly grantScope: Scope
  readonly contract?: ContractRef
  readonly payload: ReasonerProposal
  readonly payloadDigest: string
  readonly createdAt: string
  readonly expiresAt: string
  readonly version: 1
}

export interface CommitProposalInput {
  readonly expectedVersion: number
  readonly expectedDigest: string
  readonly actorRef: string
  /** Main-owned deterministic command id written in the same UnitOfWork as the confirmation. */
  readonly effectCommandId: string
  /** Main's current source digest / grant / scope / contract / resource revalidation. */
  readonly revalidate?: (prepared: PreparedProposal) => { readonly ok: boolean; readonly code?: string; readonly detail?: string }
  readonly barrier?: () => { readonly ok: boolean; readonly detail?: string }
  readonly now?: Date
}

export interface CommitProposalResult {
  readonly record: PersistedProposal
  readonly intent: ProposalIntent
  readonly replayed: boolean
}

export interface ConfirmWithCommandInput extends CommitProposalInput {
  /** Caller-confirmed scope/criteria/profile (create_work) or the full new contract (revise_work). */
  readonly plan: CommandPlanInput
}

export interface ConfirmWithCommandResult {
  readonly record: PersistedProposal
  readonly intent: ProposalIntent
  /** The existing business command main must dispatch in the same UnitOfWork; null for a reply. */
  readonly command: UserCommand | null
  readonly replayed: boolean
}

export interface AssistantProposalServiceOptions {
  readonly now?: () => Date
  readonly defaultTtlMs?: number
}

/**
 * Persisted proposal workflow over the shared AssistantStatePort.
 *
 * `prepare` is async but read-only. `persistPending` / `commit` / `reject` / `expire` / `supersede`
 * are synchronous and join main's existing UnitOfWork; every state change is versioned and CAS-checked,
 * and a confirmed record names the main-owned effect command in the same transaction.
 */
export class AssistantProposalService {
  private readonly port: AssistantStatePort
  private readonly now: () => Date
  private readonly defaultTtlMs: number

  constructor(port: AssistantStatePort, options: AssistantProposalServiceOptions = {}) {
    this.port = port
    this.now = options.now ?? (() => new Date())
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS
  }

  async prepare(input: PrepareProposalInput): Promise<PreparedProposal> {
    const parsed = parseStructuredOutput(input.payload)
    if (!parsed.ok) {
      throw new ProposalError('invalid_proposal', `Proposal payload is ${parsed.reason}`, {
        ...(parsed.issues === undefined ? {} : { issues: parsed.issues }),
      })
    }
    validateProposalBindings(parsed.proposal, input.trusted)
    const now = input.now ?? this.now()
    const expiresAt = input.trusted.expiresAt ?? new Date(now.getTime() + (input.ttlMs ?? this.defaultTtlMs)).toISOString()
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) {
      throw new ProposalError('invalid_expiry', 'Proposal expiry is not in the future')
    }
    const payload = snapshot(parsed.proposal)
    return snapshot({
      proposalId: IdSchema.parse(input.proposalId),
      projectId: IdSchema.parse(input.trusted.projectId),
      conversationId: IdSchema.parse(input.conversationId),
      sourceMessageId: IdSchema.parse(input.trusted.sourceMessageId),
      sourceTextDigest: DigestSchema.parse(input.sourceTextDigest),
      actorRef: IdSchema.parse(input.trusted.actorRef),
      grantId: IdSchema.parse(input.trusted.grant.grantId),
      grantScope: input.trusted.grant.scope,
      ...(input.trusted.contract === undefined ? {} : { contract: input.trusted.contract }),
      payload,
      payloadDigest: proposalDigest(payload),
      createdAt: now.toISOString(),
      expiresAt,
      version: 1,
    })
  }

  /** Persists the pending candidate (version 1) in main's transaction. No confirmation or effect. */
  persistPending(prepared: PreparedProposal): PersistedProposal {
    const record = PersistedProposalSchema.parse({
      proposalId: prepared.proposalId,
      version: 1,
      state: 'pending',
      projectId: prepared.projectId,
      conversationId: prepared.conversationId,
      sourceMessageId: prepared.sourceMessageId,
      sourceTextDigest: prepared.sourceTextDigest,
      actorRef: prepared.actorRef,
      grantId: prepared.grantId,
      grantScope: prepared.grantScope,
      ...(prepared.contract === undefined ? {} : { contract: prepared.contract }),
      payload: prepared.payload,
      payloadDigest: prepared.payloadDigest,
      createdAt: prepared.createdAt,
      expiresAt: prepared.expiresAt,
      updatedAt: prepared.createdAt,
    })
    return this.port.proposals.put(record, 0).record
  }

  commit(prepared: PreparedProposal, input: CommitProposalInput): CommitProposalResult {
    if (input.actorRef !== prepared.actorRef) {
      throw new ProposalError('forbidden', 'Confirmation actor does not own this proposal')
    }
    const now = input.now ?? this.now()
    const existing = this.port.proposals.get(prepared.proposalId)
    if (existing?.state === 'confirmed') {
      if (existing.effectCommandId !== input.effectCommandId) {
        throw new ProposalError('conflict', 'A confirmed proposal already named another effect command')
      }
      if (existing.payloadDigest !== prepared.payloadDigest || existing.actorRef !== prepared.actorRef) {
        throw new ProposalError('conflict', 'A confirmed proposal cannot be replayed with another payload or actor')
      }
      return { record: existing, intent: snapshot(proposalIntent(existing.payload)), replayed: true }
    }
    if (!existing) {
      throw new ProposalError('not_found', 'Pending proposal was not persisted in the current transaction')
    }
    if (existing.state !== 'pending') {
      throw new ProposalError('proposal_not_pending', `Proposal is ${existing.state}`)
    }
    if (input.expectedVersion !== existing.version || input.expectedVersion !== prepared.version) {
      throw new ProposalError('proposal_stale', 'Expected proposal version is stale')
    }
    if (input.expectedDigest !== prepared.payloadDigest || existing.payloadDigest !== prepared.payloadDigest) {
      throw new ProposalError('proposal_mutated', 'Proposal payload changed after review')
    }
    if (existing.sourceMessageId !== prepared.sourceMessageId || existing.sourceTextDigest !== prepared.sourceTextDigest) {
      throw new ProposalError('source_mismatch', 'Proposal source changed after review')
    }
    if (Date.parse(existing.expiresAt) <= now.getTime()) {
      const expired = PersistedProposalSchema.parse({
        ...existing,
        version: existing.version + 1,
        state: 'expired',
        updatedAt: now.toISOString(),
      })
      this.port.proposals.put(expired, existing.version)
      throw new ProposalError('proposal_expired', 'Proposal has expired')
    }
    const current = input.revalidate?.(prepared)
    if (current && !current.ok) {
      throw new ProposalError('stale_authorization', 'Current authorization is no longer valid', {
        detail: current.detail ?? current.code ?? 'stale',
      })
    }
    const barrier = input.barrier?.()
    if (barrier && !barrier.ok) {
      throw new ProposalError('barrier_blocked', 'Physical barrier is not quiescent', {
        detail: barrier.detail ?? 'not_quiescent',
      })
    }
    const confirmed = PersistedProposalSchema.parse({
      ...existing,
      version: existing.version + 1,
      state: 'confirmed',
      updatedAt: now.toISOString(),
      effectCommandId: IdSchema.parse(input.effectCommandId),
    })
    const stored = this.port.proposals.put(confirmed, existing.version)
    return {
      record: stored.record,
      intent: snapshot(proposalIntent(stored.record.payload)),
      replayed: stored.replayed,
    }
  }

  /**
   * Single synchronous confirmation entry for main: confirms the proposal (versioned, CAS, no
   * pre-confirm effect) and returns the exact existing `UserCommand` to dispatch in the same
   * UnitOfWork. Nothing is executed here.
   *
   * - `needs_user_input` (missing scope/criteria/profile or a complete revision) throws before any
   *   write, so an under-specified proposal never becomes confirmed;
   * - a `reply` intent confirms nothing and returns `command: null`;
   * - the same effect command replays idempotently; another command id conflicts.
   */
  confirmWithCommand(prepared: PreparedProposal, input: ConfirmWithCommandInput): ConfirmWithCommandResult {
    // The effect command and the dispatched command must be the same identity, and the plan must
    // stay on the prepared conversation. Both are checked before any confirmed write.
    if (input.plan.commandId !== input.effectCommandId) {
      throw new ProposalError('plan_mismatch', 'Plan command id must equal the effect command id', {
        planCommandId: input.plan.commandId,
        effectCommandId: input.effectCommandId,
      })
    }
    if (input.plan.conversationId !== prepared.conversationId) {
      throw new ProposalError('plan_mismatch', 'Plan belongs to another conversation than the prepared proposal', {
        planConversationId: input.plan.conversationId,
        preparedConversationId: prepared.conversationId,
      })
    }
    const planned = planProposalCommand(this.intentOf(prepared), input.plan)
    if (planned.kind === 'needs_user_input') {
      throw new ProposalError('needs_user_input', 'Proposal needs explicit user input before it can execute', {
        intent: planned.intent,
        missing: planned.missing,
      })
    }
    const committed = this.commit(prepared, input)
    if (planned.kind === 'no_effect') {
      return { record: committed.record, intent: committed.intent, command: null, replayed: committed.replayed }
    }
    return {
      record: committed.record,
      intent: committed.intent,
      command: snapshot(planned.command),
      replayed: committed.replayed,
    }
  }

  /** Pure intent projection used by `confirmWithCommand`; it never reads or writes state. */
  private intentOf(prepared: PreparedProposal): ProposalIntent {
    const existing = this.port.proposals.get(prepared.proposalId)
    if (existing?.state === 'confirmed') {
      const confirmed = this.confirmationIntent(existing)
      if (confirmed) return confirmed
    }
    return snapshot(proposalIntent(prepared.payload))
  }

  reject(
    prepared: PreparedProposal,
    input: { readonly actorRef: string; readonly reason: string; readonly now?: Date },
  ): PersistedProposal {
    const existing = this.requirePending(prepared, input.actorRef)
    const now = input.now ?? this.now()
    // The shared persisted proposal has no rejection-reason field; the reason stays caller-side audit.
    void input.reason
    const rejected = PersistedProposalSchema.parse({
      ...existing,
      version: existing.version + 1,
      state: 'rejected',
      updatedAt: now.toISOString(),
    })
    return this.port.proposals.put(rejected, existing.version).record
  }

  expire(prepared: PreparedProposal, now: Date = this.now()): PersistedProposal {
    const existing = this.requirePending(prepared, prepared.actorRef)
    const expired = PersistedProposalSchema.parse({
      ...existing,
      version: existing.version + 1,
      state: 'expired',
      updatedAt: now.toISOString(),
    })
    return this.port.proposals.put(expired, existing.version).record
  }

  supersede(prepared: PreparedProposal, byProposalId: string, actorRef: string): PersistedProposal {
    if (actorRef !== prepared.actorRef) {
      throw new ProposalError('forbidden', 'Supersession actor does not own this proposal')
    }
    const existing = this.requirePending(prepared, actorRef)
    if (!this.port.proposals.get(byProposalId)) {
      throw new ProposalError('not_found', 'Replacement proposal does not exist')
    }
    const superseded = PersistedProposalSchema.parse({
      ...existing,
      version: existing.version + 1,
      state: 'superseded',
      updatedAt: this.now().toISOString(),
      supersededBy: IdSchema.parse(byProposalId),
    })
    return this.port.proposals.put(superseded, existing.version).record
  }

  confirmationIntent(record: PersistedProposal): ProposalIntent | undefined {
    if (record.state !== 'confirmed') return undefined
    return snapshot(proposalIntent(record.payload))
  }

  private requirePending(prepared: PreparedProposal, actorRef: string): PersistedProposal {
    if (actorRef !== prepared.actorRef) {
      throw new ProposalError('forbidden', 'Actor does not own this proposal')
    }
    const existing = this.port.proposals.get(prepared.proposalId)
    if (!existing) throw new ProposalError('not_found', 'Pending proposal was not persisted')
    if (existing.state !== 'pending') throw new ProposalError('proposal_not_pending', `Proposal is ${existing.state}`)
    if (existing.version !== prepared.version || existing.payloadDigest !== prepared.payloadDigest) {
      throw new ProposalError('proposal_stale', 'Stored pending proposal does not match the prepared candidate')
    }
    return existing
  }
}

