import type { ReasonerProposal, Scope } from '@personal-agent/contracts'
import { ProposalError } from './errors.ts'
import { parseStructuredOutput, proposalDigest, sameContract, scopeWithin } from './parser.ts'
import type {
  ConfirmResult,
  ProposalIntent,
  ProposalRecord,
  ProposalTrustedContext,
} from './types.ts'

const DEFAULT_TTL_MS = 15 * 60 * 1000

export interface CreateProposalInput {
  readonly proposalId: string
  readonly payload: unknown
  readonly trusted: ProposalTrustedContext
}

export interface ConfirmProposalInput {
  readonly expectedVersion: number
  readonly expectedDigest: string
  readonly actorRef: string
  /** Main's deterministic physical-barrier check; a failed barrier cannot be confirmed. */
  readonly barrier?: () => { readonly ok: boolean; readonly detail?: string }
  readonly now?: Date
}

function validateBindings(payload: ReasonerProposal, trusted: ProposalTrustedContext): void {
  if (trusted.grant.scope.projectId !== trusted.projectId) {
    throw new ProposalError('cross_project', 'Authorization grant belongs to another project')
  }
  if (payload.kind === 'reply') return
  if (payload.sourceMessageId !== trusted.sourceMessageId) {
    throw new ProposalError('source_mismatch', 'Proposal is bound to another source message')
  }
  if (payload.kind === 'propose_work') {
    if (payload.projectId !== trusted.projectId) {
      throw new ProposalError('cross_project', 'Proposal targets another project')
    }
    return
  }
  if (payload.kind === 'propose_revision') {
    if (!trusted.contract || !sameContract(payload.expected, trusted.contract)) {
      throw new ProposalError('contract_stale', 'Proposal does not reference the current contract')
    }
    return
  }
  if (payload.scope.projectId !== trusted.projectId) {
    throw new ProposalError('cross_project', 'Decision scope targets another project')
  }
  if (!scopeWithin(payload.scope, trusted.grant.scope)) {
    throw new ProposalError('scope_escalation', 'Decision scope exceeds the current authorization')
  }
}

function buildIntent(record: ProposalRecord): ProposalIntent {
  const payload = record.payload
  switch (payload.kind) {
    case 'reply':
      return Object.freeze({ kind: 'reply' as const, text: payload.text, sourceRefs: Object.freeze([...payload.sourceRefs]) })
    case 'propose_work':
      return Object.freeze({
        kind: 'create_work' as const,
        projectId: payload.projectId,
        goal: payload.goal,
        sourceMessageId: payload.sourceMessageId,
      })
    case 'propose_revision':
      return Object.freeze({
        kind: 'revise_work' as const,
        expected: Object.freeze({ ...payload.expected }),
        rationale: payload.rationale,
        sourceMessageId: payload.sourceMessageId,
      })
    case 'propose_decision':
      return Object.freeze({
        kind: 'record_decision' as const,
        content: payload.content,
        scope: Object.freeze({ ...payload.scope }) as Scope,
        sourceMessageId: payload.sourceMessageId,
      })
  }
}

/**
 * In-memory proposal state machine. It produces a `ProposalIntent` only after explicit confirmation;
 * it has no executor, no scheduler and no command builder, so a pending proposal cannot act.
 */
export class ProposalRegistry {
  private readonly records = new Map<string, ProposalRecord>()
  private readonly now: () => Date
  private readonly defaultTtlMs: number

  constructor(options: { readonly now?: () => Date; readonly defaultTtlMs?: number } = {}) {
    this.now = options.now ?? (() => new Date())
    this.defaultTtlMs = options.defaultTtlMs ?? DEFAULT_TTL_MS
  }

  create(input: CreateProposalInput): ProposalRecord {
    const parsed = parseStructuredOutput(input.payload)
    if (!parsed.ok) {
      throw new ProposalError('invalid_proposal', `Proposal payload is ${parsed.reason}`, {
        ...(parsed.issues === undefined ? {} : { issues: parsed.issues }),
      })
    }
    validateBindings(parsed.proposal, input.trusted)
    const now = this.now()
    const expiresAt = input.trusted.expiresAt ?? new Date(now.getTime() + this.defaultTtlMs).toISOString()
    if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now.getTime()) {
      throw new ProposalError('invalid_expiry', 'Proposal expiry is not in the future')
    }
    const payloadDigest = proposalDigest(parsed.proposal)
    const existing = this.records.get(input.proposalId)
    if (existing) {
      if (
        existing.payloadDigest === payloadDigest &&
        existing.projectId === input.trusted.projectId &&
        existing.actorRef === input.trusted.actorRef &&
        existing.grantId === input.trusted.grant.grantId &&
        existing.sourceMessageId === input.trusted.sourceMessageId
      ) {
        return existing
      }
      throw new ProposalError('conflict', 'Proposal id was reused with a different payload or binding')
    }
    const record: ProposalRecord = {
      proposalId: input.proposalId,
      sourceMessageId: input.trusted.sourceMessageId,
      projectId: input.trusted.projectId,
      actorRef: input.trusted.actorRef,
      grantId: input.trusted.grant.grantId,
      grantScope: input.trusted.grant.scope,
      ...(input.trusted.contract === undefined ? {} : { contract: input.trusted.contract }),
      createdAt: now.toISOString(),
      expiresAt,
      version: 1,
      payload: parsed.proposal,
      payloadDigest,
      state: 'pending',
    }
    this.records.set(record.proposalId, record)
    return record
  }

  get(proposalId: string): ProposalRecord | undefined {
    return this.records.get(proposalId)
  }

  list(): readonly ProposalRecord[] {
    return [...this.records.values()].sort(
      (left, right) => left.createdAt.localeCompare(right.createdAt) || left.proposalId.localeCompare(right.proposalId),
    )
  }

  confirm(proposalId: string, input: ConfirmProposalInput): ConfirmResult {
    const record = this.records.get(proposalId)
    if (!record) throw new ProposalError('not_found', 'Proposal does not exist')
    const now = input.now ?? this.now()
    if (record.state === 'confirmed') {
      if (input.expectedVersion === record.version && input.expectedDigest === record.payloadDigest && record.intent) {
        return { status: 'already_confirmed', record, intent: record.intent, idempotent: true }
      }
      throw new ProposalError('conflict', 'Proposal was already confirmed with another version or payload')
    }
    if (record.state !== 'pending') {
      throw new ProposalError('proposal_not_pending', `Proposal is ${record.state}`)
    }
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      this.records.set(proposalId, { ...record, state: 'expired' })
      throw new ProposalError('proposal_expired', 'Proposal has expired')
    }
    if (input.actorRef !== record.actorRef) {
      throw new ProposalError('forbidden', 'Confirmation actor does not own this proposal')
    }
    if (input.expectedVersion !== record.version) {
      throw new ProposalError('proposal_stale', 'Expected proposal version is stale')
    }
    if (input.expectedDigest !== record.payloadDigest) {
      throw new ProposalError('proposal_mutated', 'Proposal payload changed after review')
    }
    const barrier = input.barrier?.()
    if (barrier && !barrier.ok) {
      throw new ProposalError('barrier_blocked', 'Physical barrier is not quiescent', {
        detail: barrier.detail ?? 'not_quiescent',
      })
    }
    const intent = buildIntent(record)
    const confirmed: ProposalRecord = {
      ...record,
      state: 'confirmed',
      confirmedAt: now.toISOString(),
      confirmedBy: input.actorRef,
      intent,
    }
    this.records.set(proposalId, confirmed)
    return { status: 'confirmed', record: confirmed, intent, idempotent: false }
  }

  reject(proposalId: string, input: { readonly expectedVersion: number; readonly reason: string; readonly now?: Date }): ProposalRecord {
    const record = this.records.get(proposalId)
    if (!record) throw new ProposalError('not_found', 'Proposal does not exist')
    if (record.state !== 'pending') throw new ProposalError('proposal_not_pending', `Proposal is ${record.state}`)
    if (input.expectedVersion !== record.version) throw new ProposalError('proposal_stale', 'Expected proposal version is stale')
    const now = input.now ?? this.now()
    const rejected: ProposalRecord = {
      ...record,
      state: 'rejected',
      rejectedAt: now.toISOString(),
      rejectionReason: input.reason,
    }
    this.records.set(proposalId, rejected)
    return rejected
  }

  supersede(proposalId: string, byProposalId: string): ProposalRecord {
    const record = this.records.get(proposalId)
    if (!record) throw new ProposalError('not_found', 'Proposal does not exist')
    if (record.state !== 'pending') throw new ProposalError('proposal_not_pending', `Proposal is ${record.state}`)
    if (!this.records.has(byProposalId)) throw new ProposalError('not_found', 'Replacement proposal does not exist')
    const superseded: ProposalRecord = { ...record, state: 'superseded', supersededBy: byProposalId }
    this.records.set(proposalId, superseded)
    return superseded
  }

  /** Sweeps pending proposals whose validity elapsed; expired proposals cannot be confirmed later. */
  expire(now: Date = this.now()): readonly ProposalRecord[] {
    const expired: ProposalRecord[] = []
    for (const record of this.records.values()) {
      if (record.state !== 'pending') continue
      if (Date.parse(record.expiresAt) > now.getTime()) continue
      const next: ProposalRecord = { ...record, state: 'expired' }
      this.records.set(record.proposalId, next)
      expired.push(next)
    }
    return expired
  }
}
