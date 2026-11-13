import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  CommandReceiptSchema, DigestSchema, IdSchema, PersistedProposalSchema,
  ProposalCommandSchema, ProposalPrepareSchema, ProposalPreviewSchema, ScopeSchema, TimestampSchema, TrustedActorSchema,
  AssistantCandidatePrepareSchema, AssistantCandidatesSchema,
} from '@personal-agent/contracts'
import type { AppError, AssistantCandidatePrepare, AssistantCandidates, CommandReceipt, PersistedProposal, PreparedUserCommand, ProposalCommand, ProposalPrepare, ProposalPreview, Scope, TrustedActor } from '@personal-agent/contracts'
import { ApplicationFault } from '@personal-agent/application'
import type { ProductApplication } from '@personal-agent/application'
import { AssistantProposalService, planProposalCommand, proposalDigest, ProposalError, proposalIntent, reviewReplyCandidates } from '@personal-agent/proposals'
import type { CommandPlan, PreparedProposal } from '@personal-agent/proposals'
import { canonicalDigest, WorkflowConflict } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { key } from '@personal-agent/orchestrator-core'
import type { ProductDecisions } from './decisions.ts'
import type { CompletedAssistantReplies } from './assistant-reply-results.ts'

const digest = (value: unknown) => canonicalDigest(JSON.parse(JSON.stringify(value)))
const ReplyOriginSchema = z.strictObject({ requestId: IdSchema, replyMessageId: IdSchema, index: z.number().int().min(0).max(7),
  payloadDigest: DigestSchema, requestDigest: DigestSchema, artifactDigest: DigestSchema, sourceTextDigest: DigestSchema })
type ReplyOrigin = z.infer<typeof ReplyOriginSchema>
const SignedSchema = z.strictObject({ version: z.literal(1), userId: IdSchema, authorityRef: IdSchema, grantDigest: DigestSchema,
  record: PersistedProposalSchema.refine(value => value.state === 'pending' && value.version === 1), expiresAt: TimestampSchema,
  replyOrigin: ReplyOriginSchema.optional() })
type Signed = z.infer<typeof SignedSchema>
const asPrepared = (record: PersistedProposal): PreparedProposal => ({
  proposalId: record.proposalId, projectId: record.projectId, conversationId: record.conversationId,
  sourceMessageId: record.sourceMessageId, sourceTextDigest: record.sourceTextDigest, actorRef: record.actorRef,
  grantId: record.grantId, grantScope: record.grantScope, ...(record.contract ? { contract: record.contract } : {}),
  payload: record.payload, payloadDigest: record.payloadDigest, createdAt: record.createdAt, expiresAt: record.expiresAt, version: 1,
})

/** Structured suggestions stay inert until one explicit, authenticated, atomic confirmation. */
export class ProductProposals {
  private readonly store: ProductStore
  private readonly application: ProductApplication
  private readonly decisions: ProductDecisions
  private readonly principal: { userId: string; authorityRef: string }
  private readonly projects: () => readonly { id: string; scope: Scope }[]
  private readonly secret: Buffer
  private readonly now: () => string
  private readonly service: AssistantProposalService
  private readonly completed: CompletedAssistantReplies | undefined
  constructor(store: ProductStore, application: ProductApplication, decisions: ProductDecisions,
    principal: { userId: string; authorityRef: string }, projects: () => readonly { id: string; scope: Scope }[],
    secret: Uint8Array, now = () => new Date().toISOString(), completed?: CompletedAssistantReplies) {
    if (secret.byteLength < 32) throw new TypeError('Proposal previews require a private signing key')
    this.store = store; this.application = application; this.decisions = decisions; this.principal = structuredClone(principal)
    this.projects = projects; this.secret = Buffer.from(secret); this.now = now
    this.completed = completed
    this.service = new AssistantProposalService(store.workflows.assistant, { now: () => new Date(this.now()) })
  }
  private actor(input: TrustedActor) {
    const actor = TrustedActorSchema.parse(input)
    if (actor.userId !== this.principal.userId || actor.authorityRef !== this.principal.authorityRef || actor.source === 'explicit_rule')
      throw new ApplicationFault('forbidden', 'Proposals require the authenticated local user', 'none')
    return actor
  }
  private project(id: string) {
    const project = this.projects().find(value => value.id === id)
    if (!project) throw new ApplicationFault('forbidden', 'Proposal project is not configured', 'none')
    const scope = ScopeSchema.parse(project.scope)
    if (scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(this.now()))
      throw new ApplicationFault('stale_contract', 'Proposal project authorization expired')
    return { id: project.id, scope }
  }
  private source(id: string, projectId: string, conversationId: string) {
    const source = this.store.workflows.index.sourceMessage(id, this.projects().map(project => project.id))
    if (!source || source.projectId !== projectId || source.conversationId !== conversationId ||
      source.role !== 'user' || source.provenance !== 'trusted_user')
      throw new ApplicationFault('forbidden', 'Proposal source is not the original trusted user message', 'none')
    return source
  }
  private validate(record: PreparedProposal) {
    const project = this.project(record.projectId)
    if (digest(project.scope) !== digest(record.grantScope) || record.grantId !== key('proposal-grant', project.id, digest(project.scope)))
      throw new ApplicationFault('stale_contract', 'Proposal authorization changed; prepare again')
    if (this.source(record.sourceMessageId, project.id, record.conversationId).textDigest !== record.sourceTextDigest)
      throw new ApplicationFault('conflict', 'Proposal source changed; prepare again')
    if (record.payload.kind === 'propose_revision') {
      const ref = record.payload.expected, work = this.store.product.works.get(ref.workId)
      if (!work || work.projectId !== project.id || work.conversationId !== record.conversationId || !this.store.authority.isCurrent(ref))
        throw new ApplicationFault('stale_contract', 'Proposal does not target the current authorized work')
    }
  }
  private signature(body: string) { return createHmac('sha256', this.secret).update(`proposal-preview/1:${body}`).digest('base64url') }
  private failure(error: unknown): AppError | undefined {
    if (error instanceof ApplicationFault) return error.error
    if (error instanceof WorkflowConflict || error instanceof ProposalError)
      return { code: 'conflict', message: 'Proposal state, input or source changed; prepare again', retry: 'user_action' }
    return undefined
  }
  private replySource(messageId: string) {
    const message = this.store.product.messages.getById(IdSchema.parse(messageId))
    if (!message?.projectId || message.anchor) throw new ApplicationFault('forbidden', 'Candidate source is not an ordinary configured user message', 'none')
    const project = this.project(message.projectId), source = this.source(message.id, project.id, message.conversationId)
    const verified = this.completed?.readVerified(key('assistant-request', message.id))
    return { project, source, verified }
  }
  replyCandidates(messageId: string): AssistantCandidates {
    const { project, source, verified } = this.replySource(messageId)
    const candidates: AssistantCandidates['candidates'][number][] = [], rejected: AssistantCandidates['rejected'][number][] = []
    if (verified && verified.inference.sourceTextDigest) for (const [index, payload] of verified.body.suggestions.entries()) {
      const target = payload.kind === 'propose_revision' ? this.store.product.works.get(payload.expected.workId) : undefined
      const current = target && target.projectId === project.id && target.conversationId === source.conversationId &&
        payload.kind === 'propose_revision' && this.store.authority.isCurrent(payload.expected) ? payload.expected : undefined
      const review = reviewReplyCandidates({ ...verified.body, suggestions: [payload] }, {
        projectId: project.id, conversationId: source.conversationId, sourceMessageId: source.id,
        grantId: key('proposal-grant', project.id, digest(project.scope)), grantScope: project.scope,
        ...(current ? { currentContract: current } : {}),
      })
      const candidate = review.candidates[0]
      if (candidate && candidate.kind !== 'reply') candidates.push({ index, kind: candidate.kind,
        summary: candidate.summary, payloadDigest: candidate.payloadDigest,
        requiredInputs: candidate.plan.kind === 'needs_user_input' ? ProposalPreviewSchema.shape.requiredInputs.parse(candidate.plan.missing) : [] })
      else if (review.rejected[0]) rejected.push({ index, reason: review.rejected[0].reason.slice(0, 100) })
    }
    return AssistantCandidatesSchema.parse({ protocol: 'assistant-candidates/1', messageId: source.id,
      replyMessageId: key('assistant-reply', source.id), projectId: project.id, conversationId: source.conversationId,
      status: !verified || !verified.inference.sourceTextDigest ? 'unavailable' : candidates.length ? 'candidates' : 'none',
      candidates, rejected, trust: 'untrusted_data', authorization: 'none', executable: false })
  }
  private validateReplyOrigin(record: Pick<PersistedProposal, 'payloadDigest' | 'sourceMessageId' | 'sourceTextDigest' | 'projectId' | 'conversationId'>, origin: ReplyOrigin) {
    const verified = this.completed?.readVerified(origin.requestId), payload = verified?.body.suggestions[origin.index]
    if (!verified || !payload || payload.kind === 'reply' ||
      verified.body.sourceMessageId !== record.sourceMessageId || verified.body.projectId !== record.projectId ||
      verified.body.conversationId !== record.conversationId || verified.body.replyMessageId !== origin.replyMessageId ||
      verified.result.requestDigest !== origin.requestDigest || verified.result.artifactDigest !== origin.artifactDigest ||
      verified.inference.sourceTextDigest !== origin.sourceTextDigest || origin.sourceTextDigest !== record.sourceTextDigest || proposalDigest(payload) !== origin.payloadDigest ||
      record.payloadDigest !== origin.payloadDigest)
      throw new ApplicationFault('verification_failed', 'The original reply candidate changed or cannot be verified', 'none')
  }
  async prepareReplyCandidate(input: AssistantCandidatePrepare, inputActor: TrustedActor): Promise<ProposalPreview> {
    const value = AssistantCandidatePrepareSchema.parse(input), actor = this.actor(inputActor)
    const { project, source, verified } = this.replySource(value.messageId)
    const candidate = this.replyCandidates(value.messageId).candidates.find(candidate => candidate.index === value.index)
    const payload = verified?.body.suggestions[value.index]
    if (!verified?.inference.sourceTextDigest || !candidate || !payload || payload.kind === 'reply' ||
      candidate.payloadDigest !== value.payloadDigest || proposalDigest(payload) !== value.payloadDigest)
      throw new ApplicationFault('conflict', 'Candidate identity or current authorization changed; review again')
    const origin = ReplyOriginSchema.parse({ requestId: verified.result.requestId, replyMessageId: verified.body.replyMessageId,
      index: value.index, payloadDigest: value.payloadDigest, requestDigest: verified.result.requestDigest,
      artifactDigest: verified.result.artifactDigest, sourceTextDigest: verified.inference.sourceTextDigest })
    return this.prepareBound({ projectId: project.id, conversationId: source.conversationId, sourceMessageId: source.id, payload }, actor, origin)
  }
  async prepare(input: ProposalPrepare, inputActor: TrustedActor): Promise<ProposalPreview> {
    return this.prepareBound(input, inputActor)
  }
  private async prepareBound(input: ProposalPrepare, inputActor: TrustedActor, replyOrigin?: ReplyOrigin): Promise<ProposalPreview> {
    const value = ProposalPrepareSchema.parse(input), actor = this.actor(inputActor)
    if (this.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Proposal preparation runs outside transactions')
    const project = this.project(value.projectId), source = this.source(value.sourceMessageId, project.id, value.conversationId)
    const expiresAt = new Date(Math.min(Date.parse(this.now()) + 300000,
      project.scope.expiresAt ? Date.parse(project.scope.expiresAt) : Infinity)).toISOString()
    const prepared = await this.service.prepare({ proposalId: `proposal-${randomUUID()}`, payload: value.payload,
      conversationId: value.conversationId, sourceTextDigest: source.textDigest,
      trusted: { actorRef: actor.authorityRef, projectId: project.id, sourceMessageId: source.id,
        grant: { grantId: key('proposal-grant', project.id, digest(project.scope)), scope: project.scope }, expiresAt,
        ...(value.payload.kind === 'propose_revision' ? { contract: value.payload.expected } : {}) } }).catch(error => {
      const failure = this.failure(error)
      if (failure) throw new ApplicationFault(failure.code, failure.message, failure.retry)
      throw error
    })
    this.validate(prepared)
    if (replyOrigin) this.validateReplyOrigin(prepared, replyOrigin)
    const record = PersistedProposalSchema.parse({ ...prepared, state: 'pending', updatedAt: prepared.createdAt })
    const plan = planProposalCommand(proposalIntent(record.payload), { commandId: 'proposal-preview', conversationId: record.conversationId })
    const signed = SignedSchema.parse({ version: 1, userId: actor.userId, authorityRef: actor.authorityRef,
      grantDigest: digest(project.scope), record, expiresAt, ...(replyOrigin ? { replyOrigin } : {}) })
    const body = Buffer.from(JSON.stringify(signed)).toString('base64url')
    return ProposalPreviewSchema.parse({ protocol: 'proposal-preview/1', record, expiresAt,
      requiredInputs: plan.kind === 'needs_user_input' ? plan.missing : [], token: `${body}.${this.signature(body)}` })
  }
  private decode(command: ProposalCommand, actor: TrustedActor): Signed {
    const [body, signature] = command.token.split('.') as [string, string]
    const expected = Buffer.from(this.signature(body)), actual = Buffer.from(signature)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
      throw new ApplicationFault('forbidden', 'Proposal preview signature is invalid', 'none')
    let signed: Signed
    try { signed = SignedSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))) }
    catch { throw new ApplicationFault('forbidden', 'Proposal preview is invalid', 'none') }
    if (signed.userId !== actor.userId || signed.authorityRef !== actor.authorityRef || signed.record.actorRef !== actor.authorityRef ||
      signed.record.projectId !== command.projectId || signed.record.conversationId !== command.conversationId)
      throw new ApplicationFault('forbidden', 'Proposal preview belongs to another user or scope', 'none')
    if (Date.parse(signed.expiresAt) <= Date.parse(this.now()) || signed.grantDigest !== digest(this.project(command.projectId).scope))
      throw new ApplicationFault('stale_contract', 'Proposal preview or grant expired or changed')
    if (signed.replyOrigin) this.validateReplyOrigin(signed.record, signed.replyOrigin)
    return signed
  }
  async dispatch(input: ProposalCommand, inputActor: TrustedActor): Promise<CommandReceipt> {
    const command = ProposalCommandSchema.parse(input), actor = this.actor(inputActor)
    if (this.store.uow.nesting) throw new ApplicationFault('invalid_request', 'Proposal dispatch owns the outer transaction')
    const payloadDigest = digest({ command, actor })
    const replay = () => {
      const prior = this.store.commands.get(command.commandId)
      if (!prior) return undefined
      if (prior.payloadDigest !== payloadDigest) throw new ApplicationFault('conflict', 'Command ID already names another immutable request')
      return CommandReceiptSchema.parse({ ...(prior.result as object), commandId: command.commandId, seq: prior.seq })
    }
    const prior = replay()
    if (prior) return prior
    let signed: Signed | undefined, plan: CommandPlan | undefined, applicationCommand: PreparedUserCommand | undefined, preflightError: AppError | undefined
    const effectCommandId = key('proposal-effect', command.commandId)
    try {
      signed = this.decode(command, actor)
      const prepared = asPrepared(signed.record)
      this.validate(prepared)
      if (command.kind === 'confirm_proposal') {
        if ((prepared.payload.kind !== 'propose_work' && command.work) || (prepared.payload.kind !== 'propose_revision' && command.revision))
          throw new ApplicationFault('invalid_request', 'Confirmation inputs do not match the proposal kind')
        plan = planProposalCommand(proposalIntent(prepared.payload), { commandId: effectCommandId, conversationId: command.conversationId,
          ...(command.work ? { work: command.work } : {}), ...(command.revision ? { revision: command.revision } : {}) })
        if (plan.kind !== 'command') throw new ApplicationFault('invalid_request', 'Proposal requires explicit scope, criteria, profile or revision input')
        if (plan.command.kind !== 'record_decision') applicationCommand = await this.application.prepareCommand(plan.command, actor)
      }
    } catch (error) { preflightError = this.failure(error); if (!preflightError) throw error }
    return this.store.uow.atomic(() => {
      const repeated = replay()
      if (repeated) return repeated
      let result: Omit<Extract<CommandReceipt, { status: 'recorded' }>, 'commandId' | 'seq'> |
        Omit<Extract<CommandReceipt, { status: 'rejected' }>, 'commandId' | 'seq'>
      try { result = this.store.uow.atomic(() => {
        if (preflightError) throw new ApplicationFault(preflightError.code, preflightError.message, preflightError.retry)
        const current = this.decode(command, actor), prepared = asPrepared(current.record)
        this.validate(prepared)
        this.service.persistPending(prepared)
        let effect: CommandReceipt | undefined
        if (command.kind === 'reject_proposal') this.service.reject(prepared, { actorRef: actor.authorityRef, reason: 'explicit_rejection' })
        else {
          this.service.commit(prepared, { actorRef: actor.authorityRef, expectedVersion: 1, expectedDigest: prepared.payloadDigest, effectCommandId,
            revalidate: () => { this.validate(prepared); return { ok: true } } })
          if (plan?.kind !== 'command') throw new ApplicationFault('invalid_request', 'Proposal command was not prepared')
          if (plan.command.kind === 'record_decision') {
            const preview = this.decisions.prepare({ projectId: command.projectId, conversationId: command.conversationId,
              sourceMessageId: plan.command.sourceMessageId, scope: plan.command.scope, content: plan.command.content }, actor)
            effect = this.decisions.commitInTransaction({ kind: 'record_decision', commandId: effectCommandId, projectId: command.projectId,
              conversationId: command.conversationId, token: preview.token }, actor)
          } else effect = this.application.commitPrepared(applicationCommand!)
          if (effect.status === 'rejected') throw new ApplicationFault(effect.error.code, effect.error.message, effect.error.retry)
        }
        this.store.events.append({ topic: 'application.proposal.changed', entityRef: prepared.proposalId,
          payload: { proposalId: prepared.proposalId, projectId: prepared.projectId, conversationId: prepared.conversationId,
            state: command.kind === 'confirm_proposal' ? 'confirmed' : 'rejected', ...(effect ? { effectCommandId } : {}) } })
        return { status: 'recorded' as const, ...(effect?.workId ? { workId: effect.workId } : {}),
          ...(effect?.entityRefs ? { entityRefs: effect.entityRefs } : {}) }
      }) } catch (error) {
        const failure = this.failure(error)
        if (!failure) throw error
        result = { status: 'rejected', error: failure }
      }
      const receipt = this.store.commands.record(command.commandId, payloadDigest, () => result, result.status)
      return CommandReceiptSchema.parse({ ...receipt.result, commandId: command.commandId, seq: receipt.seq })
    })
  }
}
