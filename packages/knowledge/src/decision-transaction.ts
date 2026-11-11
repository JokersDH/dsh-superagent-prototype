import { UserDecisionSchema } from '@personal-agent/contracts'
import type { Scope, UserDecision } from '@personal-agent/contracts'
import { DecisionError } from './errors.ts'
import { AssistantDecisionStore, type SyncDecisionAppend } from './assistant-decision-store.ts'
import { snapshot } from './snapshot.ts'
import type { DecisionActor, DecisionRecord, DecisionSource, RecordDecisionInput, RevokeResult } from './types.ts'

/** Synchronous message provenance for main's transaction; it must read persisted trusted-user messages only. */
export interface DecisionSourceSyncPort {
  getMessage(messageId: string): DecisionSource | undefined
}

export interface PreparedDecision {
  readonly decision: UserDecision
  readonly projectId: string
  readonly actorRef: string
  readonly sourceMessageId: string
  readonly sourceConversationId: string
  readonly sourceTextDigest: string
  readonly recordedAt: string
}

export interface DecisionTransactionOptions {
  readonly now?: () => Date
  readonly maxContentChars?: number
}

export interface CommitDecisionInput {
  readonly now?: Date
  readonly barrier?: () => { readonly ok: boolean; readonly detail?: string }
}

/** Read-only UI/command plan for revoking a decision at its currently observed version. */
export interface PreparedRevocation {
  readonly decisionId: string
  readonly expectedVersion: number
  readonly currentVersion: number
  readonly actorRef: string
  readonly projectId: string
  readonly status: 'active' | 'revoked' | 'superseded' | 'expired'
}

function scopeWithin(scope: Scope, grant: Scope): boolean {
  return (
    scope.projectId === grant.projectId &&
    scope.allowedPaths.every((path) => grant.allowedPaths.includes(path)) &&
    grant.excludedPaths.every((path) => scope.excludedPaths.includes(path)) &&
    scope.externalActions.every((action) => grant.externalActions.includes(action)) &&
    (!grant.expiresAt || (!!scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(grant.expiresAt)))
  )
}

/**
 * Read-only prepare + synchronous commit/revoke for main's UnitOfWork.
 *
 * `prepare` performs no persistence. `commit`/`revoke` are synchronous, re-check the trusted actor,
 * project/grant/scope, current source digest/conversation and supersession state, then write through
 * A's synchronous AssistantStatePort. Main writes its receipt/event in the same transaction; any
 * failure rolls the whole UnitOfWork back.
 */
export class DecisionTransactionService {
  private readonly store: AssistantDecisionStore
  private readonly sources: DecisionSourceSyncPort
  private readonly now: () => Date
  private readonly maxContentChars: number

  constructor(store: AssistantDecisionStore, sources: DecisionSourceSyncPort, options: DecisionTransactionOptions = {}) {
    this.store = store
    this.sources = sources
    this.now = options.now ?? (() => new Date())
    this.maxContentChars = options.maxContentChars ?? 16384
  }

  /** No persistence, no effect: validation and an immutable candidate only. */
  prepare(input: RecordDecisionInput, actor: DecisionActor): PreparedDecision {
    const now = this.now()
    if (input.scope.projectId !== actor.projectId) {
      throw new DecisionError('cross_project', 'Decision scope belongs to another project')
    }
    if (input.scope.expiresAt && Date.parse(input.scope.expiresAt) <= now.getTime()) {
      throw new DecisionError('invalid_scope', 'Decision scope is already expired')
    }
    if (actor.grantScope && !scopeWithin(input.scope, actor.grantScope)) {
      throw new DecisionError('scope_escalation', 'Decision scope exceeds the current authorization')
    }
    const source = this.sources.getMessage(input.sourceMessageId)
    if (!source) throw new DecisionError('source_missing', 'Decision source message does not exist')
    if (source.projectId !== input.scope.projectId) {
      throw new DecisionError('source_project_mismatch', 'Decision source belongs to another project')
    }
    if (source.role !== 'user' || source.provenance !== 'trusted_user') {
      throw new DecisionError('not_explicit_user_confirmation', 'Only an explicit user message can become a decision')
    }
    if (source.questionKind === 'permission' || source.questionKind === 'authentication') {
      throw new DecisionError('authorization_not_shareable', 'Permission and authentication answers cannot become shared decisions')
    }
    const content = input.content.trim()
    if (content.length === 0 || content.length > this.maxContentChars || content.includes('\0')) {
      throw new DecisionError('invalid_content', 'Decision content is empty, too large or contains NUL')
    }
    if (input.supersedes !== undefined) this.assertSupersession(input.supersedes, input.scope)
    const decision: UserDecision = UserDecisionSchema.parse({
      id: input.decisionId,
      version: 1,
      content,
      scope: input.scope,
      authorityRef: actor.actorRef,
      ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
    })
    return snapshot({
      decision,
      projectId: input.scope.projectId,
      actorRef: actor.actorRef,
      sourceMessageId: source.messageId,
      sourceConversationId: source.conversationId,
      sourceTextDigest: source.textDigest,
      recordedAt: now.toISOString(),
    })
  }

  /** Synchronous; joins main's existing transaction. */
  commit(prepared: PreparedDecision, actor: DecisionActor, input: CommitDecisionInput = {}): SyncDecisionAppend {
    if (actor.actorRef !== prepared.actorRef) {
      throw new DecisionError('actor_mismatch', 'Decision owner does not match the prepared candidate')
    }
    if (actor.projectId !== prepared.projectId) {
      throw new DecisionError('cross_project', 'Decision project does not match the prepared candidate')
    }
    if (actor.grantScope && !scopeWithin(prepared.decision.scope, actor.grantScope)) {
      throw new DecisionError('scope_escalation', 'Current authorization no longer covers the decision scope')
    }
    const source = this.sources.getMessage(prepared.sourceMessageId)
    if (
      !source ||
      source.projectId !== prepared.projectId ||
      source.conversationId !== prepared.sourceConversationId ||
      source.textDigest !== prepared.sourceTextDigest ||
      source.role !== 'user' ||
      source.provenance !== 'trusted_user' ||
      source.questionKind === 'permission' ||
      source.questionKind === 'authentication'
    ) {
      throw new DecisionError('source_stale', 'Decision source is missing or changed; re-prepare the decision')
    }
    if (prepared.decision.supersedes !== undefined) {
      this.assertSupersession(prepared.decision.supersedes, prepared.decision.scope)
    }
    const barrier = input.barrier?.()
    if (barrier && !barrier.ok) {
      throw new DecisionError('barrier_blocked', 'Physical barrier is not quiescent', {
        detail: barrier.detail ?? 'not_quiescent',
      })
    }
    return this.store.appendSync({
      decision: prepared.decision,
      sourceMessageId: prepared.sourceMessageId,
      sourceConversationId: prepared.sourceConversationId,
      sourceTextDigest: prepared.sourceTextDigest,
      actorRef: prepared.actorRef,
      recordedAt: prepared.recordedAt,
    })
  }

  /** No-write revocation plan; the caller confirms before the synchronous commit. */
  prepareRevocation(decisionId: string, expectedVersion: number, actor: DecisionActor): PreparedRevocation {
    const current = this.store.getSync(decisionId)
    if (!current) throw new DecisionError('not_found', 'Decision does not exist')
    if (current.decision.scope.projectId !== actor.projectId) {
      throw new DecisionError('cross_project', 'Decision belongs to another project')
    }
    if (current.actorRef !== actor.actorRef) {
      throw new DecisionError('actor_mismatch', 'Decision owner does not match the revoking actor')
    }
    if (current.decision.version !== expectedVersion) {
      throw new DecisionError('conflict', 'Expected decision version is stale')
    }
    return snapshot({
      decisionId,
      expectedVersion,
      currentVersion: current.decision.version,
      actorRef: current.actorRef,
      projectId: current.decision.scope.projectId,
      status: current.status,
    })
  }

  /** Synchronous revocation commit for the confirmed plan; CAS prevents stale UI actions. */
  commitRevocation(prepared: PreparedRevocation, actor: DecisionActor, input: { now?: Date } = {}): RevokeResult {
    if (prepared.actorRef !== actor.actorRef || prepared.projectId !== actor.projectId) {
      throw new DecisionError('actor_mismatch', 'Revocation plan belongs to another actor or project')
    }
    return this.revoke(prepared.decisionId, prepared.expectedVersion, actor, input)
  }

  /** Synchronous CAS revocation in main's transaction. */
  revoke(decisionId: string, expectedVersion: number, actor: DecisionActor, input: { now?: Date } = {}): RevokeResult {
    const current = this.store.getSync(decisionId)
    if (!current) throw new DecisionError('not_found', 'Decision does not exist')
    if (current.decision.scope.projectId !== actor.projectId) {
      throw new DecisionError('cross_project', 'Decision belongs to another project')
    }
    const now = input.now ?? this.now()
    return this.store.revokeSync({
      decisionId,
      expectedVersion,
      revokedAt: now.toISOString(),
      actorRef: actor.actorRef,
    })
  }

  /** Current source validity for an existing decision, without async I/O. */
  sourceState(decisionId: string): 'current' | 'missing' | 'stale' | 'unknown' {
    const record = this.store.getSync(decisionId)
    if (!record) return 'unknown'
    const source = this.sources.getMessage(record.sourceMessageId)
    if (!source) return 'missing'
    if (
      source.projectId !== record.decision.scope.projectId ||
      source.conversationId !== record.sourceConversationId ||
      source.textDigest !== record.sourceTextDigest ||
      source.role !== 'user' ||
      source.provenance !== 'trusted_user' ||
      source.questionKind === 'permission' ||
      source.questionKind === 'authentication'
    ) {
      return 'stale'
    }
    return 'current'
  }

  private assertSupersession(supersedes: string, scope: Scope): void {
    const previous = this.store.getSync(supersedes)
    if (!previous) throw new DecisionError('supersede_missing', 'Superseded decision does not exist')
    if (previous.decision.scope.projectId !== scope.projectId) {
      throw new DecisionError('cross_project', 'A decision cannot supersede another project')
    }
    if (previous.status !== 'active') {
      throw new DecisionError('supersede_inactive', `Superseded decision is ${previous.status}`)
    }
    if (!scopeWithin(previous.decision.scope, scope)) {
      throw new DecisionError('scope_escalation', 'Replacement decision must cover the previous scope')
    }
  }
}
