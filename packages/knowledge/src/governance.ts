import { createHash } from 'node:crypto'
import { UserDecisionSchema } from '@personal-agent/contracts'
import type { KnowledgePage, KnowledgeSourceView, Scope, UserDecision } from '@personal-agent/contracts'
import { DecisionError } from './errors.ts'
import type {
  AutomaticPromotionVerdict,
  DecisionActor,
  DecisionRecord,
  DecisionSource,
  DecisionSourcePort,
  DecisionStorePort,
  PromotionClassification,
  RecordDecisionInput,
  RecordDecisionResult,
  RevokeResult,
} from './types.ts'

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200
const MAX_LIST_BATCHES = 4

function scopeWithin(scope: Scope, grant: Scope): boolean {
  return (
    scope.projectId === grant.projectId &&
    scope.allowedPaths.every((path) => grant.allowedPaths.includes(path)) &&
    grant.excludedPaths.every((path) => scope.excludedPaths.includes(path)) &&
    scope.externalActions.every((action) => grant.externalActions.includes(action)) &&
    (!grant.expiresAt || (!!scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(grant.expiresAt)))
  )
}

function locationRef(source: DecisionSource): string {
  return `src-${createHash('sha256').update(`${source.conversationId}\0${source.messageId}`).digest('hex').slice(0, 32)}`
}

export interface DecisionGovernanceOptions {
  readonly now?: () => Date
  readonly maxContentChars?: number
}

/**
 * Domain rules for explicit user decisions. It consumes storage through `DecisionStorePort` and
 * message provenance through `DecisionSourcePort`; it creates no database, no migration and no
 * automatic learning. Only a user's explicit, trusted message can become reusable knowledge.
 */
export class DecisionGovernance {
  private readonly store: DecisionStorePort
  private readonly sources: DecisionSourcePort
  private readonly now: () => Date
  private readonly maxContentChars: number

  constructor(store: DecisionStorePort, sources: DecisionSourcePort, options: DecisionGovernanceOptions = {}) {
    this.store = store
    this.sources = sources
    this.now = options.now ?? (() => new Date())
    this.maxContentChars = options.maxContentChars ?? 16384
  }

  async record(input: RecordDecisionInput, actor: DecisionActor): Promise<RecordDecisionResult> {
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
    const source = await this.sources.getMessage(input.sourceMessageId)
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
    if (input.supersedes !== undefined) {
      const previous = await this.store.get(input.supersedes)
      if (!previous) throw new DecisionError('supersede_missing', 'Superseded decision does not exist')
      if (previous.decision.scope.projectId !== input.scope.projectId) {
        throw new DecisionError('cross_project', 'A decision cannot supersede another project')
      }
      if (previous.status !== 'active') {
        throw new DecisionError('supersede_inactive', `Superseded decision is ${previous.status}`)
      }
      if (!scopeWithin(previous.decision.scope, input.scope)) {
        throw new DecisionError('scope_escalation', 'Replacement decision must cover the previous scope')
      }
    }
    const decision: UserDecision = UserDecisionSchema.parse({
      id: input.decisionId,
      version: 1,
      content,
      scope: input.scope,
      authorityRef: actor.actorRef,
      ...(input.supersedes === undefined ? {} : { supersedes: input.supersedes }),
    })
    const result = await this.store.append({
      decision,
      sourceMessageId: input.sourceMessageId,
      actorRef: actor.actorRef,
      recordedAt: now.toISOString(),
    })
    return { record: this.withExpiry(result.record, now), idempotent: result.idempotent }
  }

  async revoke(decisionId: string, expectedVersion: number, actor: DecisionActor): Promise<RevokeResult> {
    const now = this.now()
    const current = await this.store.get(decisionId)
    if (!current) throw new DecisionError('not_found', 'Decision does not exist')
    if (current.decision.scope.projectId !== actor.projectId) {
      throw new DecisionError('cross_project', 'Decision belongs to another project')
    }
    const result = await this.store.revoke({
      decisionId,
      expectedVersion,
      revokedAt: now.toISOString(),
      actorRef: actor.actorRef,
    })
    return { record: this.withExpiry(result.record, now), idempotent: result.idempotent }
  }

  /** Effective, project-scoped knowledge page for the workbench; revoked/expired content is excluded. */
  async page(
    projectId: string,
    options: { readonly cursor?: string; readonly limit?: number; readonly now?: Date } = {},
  ): Promise<KnowledgePage> {
    const now = options.now ?? this.now()
    const limit = Math.min(Math.max(options.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const decisions: UserDecision[] = []
    const sources = new Map<string, KnowledgeSourceView>()
    let cursor = options.cursor
    let exhausted = false
    let nextCursor: string | undefined

    for (let batch = 0; batch < MAX_LIST_BATCHES && decisions.length < limit && !exhausted; batch += 1) {
      const page = await this.store.list({
        projectId,
        status: 'all',
        ...(cursor === undefined ? {} : { cursor }),
        limit,
      })
      for (const record of page.decisions) {
        if (decisions.length >= limit) break
        if (!this.isEffectiveRecord(record, now)) continue
        decisions.push(record.decision)
        const source = await this.sources.getMessage(record.sourceMessageId)
        const view = this.sourceView(record, source)
        sources.set(view.id, view)
      }
      if (!page.nextCursor) exhausted = true
      else cursor = page.nextCursor
      nextCursor = exhausted ? undefined : cursor
      if (decisions.length >= limit) break
    }

    return {
      decisions,
      sources: [...sources.values()],
      ...(nextCursor === undefined ? {} : { nextCursor }),
    }
  }

  /** Flat effective list used to build bounded decision context slices. */
  async listEffective(projectId: string, max = 500, now: Date = this.now()): Promise<readonly DecisionRecord[]> {
    const records: DecisionRecord[] = []
    let cursor: string | undefined
    for (let batch = 0; batch < MAX_LIST_BATCHES && records.length < max; batch += 1) {
      const page = await this.store.list({
        projectId,
        status: 'all',
        ...(cursor === undefined ? {} : { cursor }),
        limit: MAX_PAGE_SIZE,
      })
      for (const record of page.decisions) {
        if (records.length >= max) break
        if (this.isEffectiveRecord(record, now)) records.push(this.withExpiry(record, now))
      }
      if (!page.nextCursor) break
      cursor = page.nextCursor
    }
    return records
  }

  async isEffective(decisionId: string, now: Date = this.now()): Promise<boolean> {
    const record = await this.store.get(decisionId)
    return record !== undefined && this.isEffectiveRecord(record, now)
  }

  /**
   * Automatic promotion is out of scope. This classifier documents why a one-off correction, a
   * temporary environment fix or an agent deviation can never be written as a long-term preference.
   */
  evaluateAutomaticPromotion(input: {
    readonly intervention: import('@personal-agent/contracts').InterventionRecord
    readonly interpretation: import('@personal-agent/contracts').Interpretation
  }): AutomaticPromotionVerdict {
    const labels = new Set(input.interpretation.labels)
    let classification: PromotionClassification = 'not_eligible'
    if (labels.has('execution_violation')) classification = 'agent_deviation'
    else if (labels.has('temporary_environment')) classification = 'temporary_environment'
    else if (labels.has('goal_change')) classification = 'one_off_goal_change'
    else if (labels.has('explicit_preference')) classification = 'requires_explicit_decision'
    return { eligible: false, reason: 'automatic_promotion_out_of_scope', classification }
  }

  private isEffectiveRecord(record: DecisionRecord, now: Date): boolean {
    if (record.status !== 'active') return false
    const expiresAt = record.decision.scope.expiresAt
    return expiresAt === undefined || Date.parse(expiresAt) > now.getTime()
  }

  private withExpiry(record: DecisionRecord, now: Date): DecisionRecord {
    if (this.isEffectiveRecord(record, now)) return record
    if (record.status === 'active') return { ...record, status: 'expired' }
    return record
  }

  private sourceView(record: DecisionRecord, source: DecisionSource | undefined): KnowledgeSourceView {
    if (!source) {
      return {
        id: `missing-${record.decision.id}`,
        title: 'Source message unavailable',
        projectId: record.decision.scope.projectId,
        locationRef: `missing-${record.decision.id}`,
        validity: 'missing',
        evidenceRefs: [],
      }
    }
    return {
      id: source.messageId,
      title: source.title ?? `Conversation message ${source.messageId}`,
      projectId: source.projectId,
      locationRef: locationRef(source),
      validity: 'current',
      evidenceRefs: [],
    }
  }
}
