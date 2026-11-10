import type { KnowledgeSourceView, Scope, UserDecision } from '@personal-agent/contracts'

export type DecisionStatus = 'active' | 'revoked' | 'superseded' | 'expired'

export interface DecisionSource {
  readonly messageId: string
  readonly conversationId: string
  readonly projectId: string
  readonly role: 'user' | 'assistant' | 'system'
  readonly provenance: 'trusted_user' | 'reasoner_reply' | 'question_answer_display' | 'application_notice'
  readonly createdAt: string
  readonly textDigest: string
  readonly title?: string
  /** Present only when the source message displays a question answer; native authorization is not shareable. */
  readonly questionKind?: 'clarification' | 'permission' | 'authentication' | 'review'
}

export interface DecisionRecord {
  readonly decision: UserDecision
  readonly status: DecisionStatus
  readonly recordedAt: string
  readonly actorRef: string
  readonly sourceMessageId: string
  readonly sourceConversationId: string
  readonly sourceTextDigest: string
}

export interface AppendDecisionInput {
  readonly decision: UserDecision
  readonly sourceMessageId: string
  readonly sourceConversationId: string
  readonly sourceTextDigest: string
  readonly actorRef: string
  readonly recordedAt: string
}

export interface RevokeDecisionInput {
  readonly decisionId: string
  readonly expectedVersion: number
  readonly revokedAt: string
  readonly actorRef: string
}

export interface DecisionQuery {
  readonly projectId: string
  readonly status?: DecisionStatus | 'all'
  readonly cursor?: string
  readonly limit?: number
}

export interface DecisionPage {
  readonly decisions: readonly DecisionRecord[]
  readonly nextCursor?: string
}

export interface RevokeResult {
  readonly record: DecisionRecord
  readonly idempotent: boolean
}

/**
 * Persistence port owned by storage. Implementations must keep the append-only revision history, use
 * CAS on the expected version and never create a second database or writer.
 */
export interface DecisionStorePort {
  append(input: AppendDecisionInput): Promise<{ readonly record: DecisionRecord; readonly idempotent: boolean }>
  get(decisionId: string): Promise<DecisionRecord | undefined>
  list(query: DecisionQuery): Promise<DecisionPage>
  revoke(input: RevokeDecisionInput): Promise<RevokeResult>
}

/** Read-only message provenance port; main supplies it from persisted conversation messages. */
export interface DecisionSourcePort {
  getMessage(messageId: string): Promise<DecisionSource | undefined>
}

export interface DecisionActor {
  readonly actorRef: string
  readonly projectId: string
  /** Current authorization; when present, a recorded scope must stay inside it. */
  readonly grantScope?: Scope
}

export interface RecordDecisionInput {
  readonly decisionId: string
  readonly content: string
  readonly scope: Scope
  readonly sourceMessageId: string
  /** Only an explicit user decision may replace another explicit decision of the same project. */
  readonly supersedes?: string
}

export interface RecordDecisionResult {
  readonly record: DecisionRecord
  readonly idempotent: boolean
}

export type PromotionClassification =
  | 'agent_deviation'
  | 'temporary_environment'
  | 'one_off_goal_change'
  | 'requires_explicit_decision'
  | 'not_eligible'

export interface AutomaticPromotionVerdict {
  readonly eligible: false
  readonly reason: 'automatic_promotion_out_of_scope'
  readonly classification: PromotionClassification
}

export type KnowledgeSourceProjection = KnowledgeSourceView
