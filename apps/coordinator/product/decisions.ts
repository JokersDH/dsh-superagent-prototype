import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  CommandReceiptSchema, DecisionCommandSchema, DecisionPageSchema, DecisionPrepareSchema, DecisionPreviewSchema,
  DecisionQuerySchema, DigestSchema, IdSchema, PersistedDecisionSchema, ScopeSchema, TimestampSchema, TrustedActorSchema,
} from '@personal-agent/contracts'
import type { CommandReceipt, DecisionCommand, DecisionPage, DecisionPrepare, DecisionPreview, DecisionQuery, Scope, TrustedActor } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import { AssistantDecisionStore, DecisionConflict, DecisionError, DecisionTransactionService } from '@personal-agent/knowledge'
import type { PreparedDecision } from '@personal-agent/knowledge'
import { canonicalDigest, WorkflowConflict } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const SignedPreviewSchema = z.strictObject({ version: z.literal(1), record: PersistedDecisionSchema,
  userId: IdSchema, authorityRef: IdSchema, grantDigest: DigestSchema, expiresAt: TimestampSchema })
const CursorSchema = z.strictObject({ version: z.literal(1), scopeDigest: DigestSchema, sourceCursor: z.string().min(1).max(1024) })

/** A signed read-only preview is confirmed in the existing command transaction, with no native effects. */
export class ProductDecisions {
  private readonly store: ProductStore
  private readonly principal: { userId: string; authorityRef: string }
  private readonly projects: () => readonly { id: string; scope: Scope }[]
  private readonly secret: Buffer
  private readonly now: () => string
  private readonly decisions: AssistantDecisionStore
  private readonly service: DecisionTransactionService
  constructor(store: ProductStore, principal: { userId: string; authorityRef: string },
    projects: () => readonly { id: string; scope: Scope }[], secret: Uint8Array, now = () => new Date().toISOString()) {
    if (secret.byteLength < 32) throw new TypeError('Decision previews require a private signing key')
    this.store = store; this.principal = structuredClone(principal); this.projects = projects; this.secret = Buffer.from(secret); this.now = now
    this.decisions = new AssistantDecisionStore(store.workflows.assistant)
    this.service = new DecisionTransactionService(this.decisions, { getMessage: id => {
      const source = store.workflows.index.sourceMessage(id, projects().map(project => project.id))
      if (!source?.projectId || source.role !== 'user' || source.provenance !== 'trusted_user') return undefined
      return { messageId: source.id, projectId: source.projectId, conversationId: source.conversationId,
        role: 'user' as const, provenance: 'trusted_user' as const, textDigest: source.textDigest, createdAt: source.createdAt }
    } }, { now: () => new Date(this.now()) })
  }
  private actor(input: TrustedActor) {
    const actor = TrustedActorSchema.parse(input)
    if (actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef || actor.source === 'explicit_rule')
      throw new ApplicationFault('forbidden', 'Decisions require the authenticated local user', 'none')
    return actor
  }
  private project(id: string) {
    const project = this.projects().find(project => project.id === id)
    if (!project) throw new ApplicationFault('forbidden', 'Decision project is not configured', 'none')
    const scope = ScopeSchema.parse(project.scope)
    if (scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(this.now()))
      throw new ApplicationFault('stale_contract', 'Project authorization has expired')
    return { id: project.id, scope }
  }
  private signature(body: string) { return createHmac('sha256', this.secret).update(`decision-preview/1:${body}`).digest('base64url') }
  private fault(error: unknown): never {
    if (error instanceof DecisionConflict || error instanceof WorkflowConflict)
      throw new ApplicationFault('conflict', 'Decision version or recorded body changed')
    if (error instanceof DecisionError)
      throw new ApplicationFault(['actor_mismatch', 'cross_project', 'scope_escalation'].includes(error.code) ? 'forbidden' : 'conflict',
        'Decision source, scope or state changed; prepare again')
    throw error
  }
  prepare(input: DecisionPrepare, inputActor: TrustedActor): DecisionPreview {
    const value = DecisionPrepareSchema.parse(input), actor = this.actor(inputActor)
    try { return this.store.uow.atomic(() => {
      const project = this.project(value.projectId)
      const prepared = this.service.prepare({ decisionId: `decision-${randomUUID()}`, content: value.content, scope: value.scope,
        sourceMessageId: value.sourceMessageId, ...(value.supersedes ? { supersedes: value.supersedes } : {}) },
        { actorRef: actor.authorityRef, projectId: project.id, grantScope: project.scope })
      if (prepared.sourceConversationId !== value.conversationId) throw new ApplicationFault('forbidden', 'Decision source belongs to another conversation', 'none')
      const expiresAt = new Date(Date.parse(this.now()) + 5 * 60 * 1000).toISOString()
      const record = { decision: prepared.decision, sourceMessageId: prepared.sourceMessageId, sourceTextDigest: prepared.sourceTextDigest,
        conversationId: prepared.sourceConversationId, actorRef: prepared.actorRef, recordedAt: prepared.recordedAt }
      const body = Buffer.from(JSON.stringify(SignedPreviewSchema.parse({ version: 1, record, userId: actor.userId,
        authorityRef: actor.authorityRef, grantDigest: digest(project.scope), expiresAt }))).toString('base64url')
      return DecisionPreviewSchema.parse({ protocol: 'decision-preview/1', decision: prepared.decision,
        sourceMessageId: prepared.sourceMessageId, conversationId: value.conversationId, expiresAt, token: `${body}.${this.signature(body)}` })
    }) } catch (error) { return this.fault(error) }
  }
  private decode(token: string, command: DecisionCommand, actor: TrustedActor): PreparedDecision {
    const [body, signed] = token.split('.') as [string, string]
    const expected = Buffer.from(this.signature(body)), actual = Buffer.from(signed)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApplicationFault('forbidden', 'Decision preview signature is invalid', 'none')
    const value = SignedPreviewSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')))
    const project = this.project(command.projectId), record = value.record
    if (value.userId !== actor.userId || value.authorityRef !== actor.authorityRef || record.actorRef !== actor.authorityRef ||
      record.conversationId !== command.conversationId || record.decision.scope.projectId !== command.projectId)
      throw new ApplicationFault('forbidden', 'Decision preview belongs to another identity or scope', 'none')
    if (Date.parse(value.expiresAt) <= Date.parse(this.now()) || value.grantDigest !== digest(project.scope) ||
      (record.decision.scope.expiresAt && Date.parse(record.decision.scope.expiresAt) <= Date.parse(this.now())))
      throw new ApplicationFault('stale_contract', 'Decision preview or authorization changed; prepare again')
    return { decision: record.decision, projectId: command.projectId, actorRef: record.actorRef, sourceMessageId: record.sourceMessageId,
      sourceConversationId: record.conversationId, sourceTextDigest: record.sourceTextDigest, recordedAt: record.recordedAt }
  }
  dispatch(input: DecisionCommand, inputActor: TrustedActor): CommandReceipt {
    const command = DecisionCommandSchema.parse(input), actor = this.actor(inputActor)
    if (this.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Decision dispatch owns the outer transaction')
    const payloadDigest = digest({ command, actor })
    return this.store.uow.atomic(() => {
      const prior = this.store.commands.get(command.commandId)
      if (prior) {
        if (prior.payloadDigest !== payloadDigest) throw new ApplicationFault('conflict', 'Command ID already names another request')
        return CommandReceiptSchema.parse({ ...(prior.result as object), commandId: command.commandId, seq: prior.seq })
      }
      let result: { status: 'recorded' } | { status: 'rejected'; error: ApplicationFault['error'] }
      try { result = this.store.uow.atomic(() => {
        const project = this.project(command.projectId)
        let decisionId: string
        if (command.kind === 'record_decision') {
          const prepared = this.decode(command.token, command, actor)
          this.service.commit(prepared, { actorRef: actor.authorityRef, projectId: project.id, grantScope: project.scope })
          decisionId = prepared.decision.id
        } else {
          const current = this.store.workflows.assistant.decisions.get(command.decisionId)
          if (!current || current.decision.scope.projectId !== project.id || current.conversationId !== command.conversationId ||
            current.actorRef !== actor.authorityRef) throw new ApplicationFault('forbidden', 'Decision does not belong to this scope', 'none')
          this.service.revoke(command.decisionId, command.expectedVersion, { actorRef: actor.authorityRef, projectId: project.id, grantScope: project.scope })
          decisionId = command.decisionId
        }
        this.store.events.append({ topic: 'application.decision.changed', entityRef: decisionId,
          payload: { decisionId, projectId: project.id, conversationId: command.conversationId } })
        return { status: 'recorded' as const }
      }) } catch (error) {
        try { this.fault(error) } catch (fault) {
          if (!(fault instanceof ApplicationFault)) throw fault
          result = { status: 'rejected', error: fault.error }
        }
      }
      const receipt = this.store.commands.record(command.commandId, payloadDigest, () => result, result.status)
      return CommandReceiptSchema.parse({ ...receipt.result, commandId: command.commandId, seq: receipt.seq })
    })
  }
  list(input: DecisionQuery): DecisionPage {
    const query = DecisionQuerySchema.parse(input)
    return this.store.uow.atomic(() => {
      this.project(query.projectId)
      const scopeDigest = digest({ projects: this.projects().map(p => p.id).sort(), projectId: query.projectId })
      let cursor: string | undefined
      if (query.cursor) {
        try { const value = CursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')))
          if (value.scopeDigest !== scopeDigest) throw new Error('Scope mismatch'); cursor = value.sourceCursor
        } catch { throw new ApplicationFault('invalid_request', 'Decision continuation is invalid') }
      }
      const page = this.store.workflows.assistant.decisions.list({ projectId: query.projectId, limit: query.limit ?? 30, ...(cursor ? { cursor } : {}) })
      const decisions = page.records.map(record => {
        const status = this.decisions.getSync(record.decision.id)!.status
        return { record, sourceState: this.service.sourceState(record.decision.id),
          status: record.decision.revokedAt ? 'revoked' : record.decision.scope.expiresAt && Date.parse(record.decision.scope.expiresAt) <= Date.parse(this.now())
            ? 'expired' : status === 'active' ? 'recorded' : status }
      })
      return DecisionPageSchema.parse({ protocol: 'decision-catalog/1', decisions, hasMore: !!page.nextCursor,
        ...(page.nextCursor ? { nextCursor: Buffer.from(JSON.stringify({ version: 1, scopeDigest, sourceCursor: page.nextCursor })).toString('base64url') } : {}) })
    })
  }
}
