import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  AppErrorSchema,
  CommandReceiptSchema,
  ContractRefSchema,
  InspectQuerySchema,
  SnapshotSchema,
  TrustedActorSchema,
  UserCommandSchema,
  IdSchema,
  ScopeSchema,
  VerificationRetryCommandSchema,
} from '@personal-agent/contracts'
import type {
  AppError,
  ApplicationService,
  AssignmentRef,
  CandidateRef,
  CommandReceipt,
  CompletionProposal,
  ContractRef,
  ContractRevision,
  InspectQuery,
  NativeQuestionBinding,
  Scope,
  Snapshot,
  TicketLink,
  TrustedActor,
  UserCommand,
  Verification,
  WorkRecord,
  WorkView,
  VerificationRetryCommand,
} from '@personal-agent/contracts'
import {
  canRetry,
  completionCriteriaDigest,
  createPersonalEngine,
  key,
  latestAssignment,
  ticketStage,
  UserError,
} from '@personal-agent/orchestrator-core'
import type { CompletionVerifier, Engine, Ticket, Trigger } from '@personal-agent/orchestrator-core'
import { CommandConflict, DispatchConflict, ProductConflict, canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { QuestionBroker, QuestionFault, scopeWithin } from '@personal-agent/questions'
import { bindCoreRepositories } from './core-repositories.ts'
import { ApplicationFault } from './errors.ts'
import { changes } from './events.ts'

export interface ProjectConfiguration {
  id: string
  displayName?: string
  scope: Scope
}
export interface CompletionReviewPort {
  verifier: CompletionVerifier
  /** Read immutable artifact bytes outside the command transaction, then return a synchronous freshness guard. */
  preflight?(candidate: CandidateRef): Promise<() => void>
  current(
    candidate: CandidateRef,
  ): { proposal: CompletionProposal; verification: Verification; artifactIds: readonly string[] } | undefined
  accept(proposal: CompletionProposal, actor: TrustedActor, criterionIds: readonly string[], acceptanceId: string): void
}
export interface ApplicationOptions {
  store: ProductStore
  principal: { userId: string; authorityRef: string }
  projects: readonly ProjectConfiguration[]
  profileIds: readonly string[]
  registeredChecks: readonly string[]
  actionSecret: Uint8Array
  nativeFence(target: NativeQuestionBinding): 'current' | 'stale' | 'unknown'
  completion?: CompletionReviewPort
  assistantReplies?: boolean
  projectPreflight?: (projectId: string) => Promise<void>
  registeredCheck?: (id: string) => boolean
  projectGrant?: (input: { projectId: string; profileId: string; criteria: ContractRevision['criteria']; newWork: boolean }) => void
  verificationRecovery?: {
    retry(candidate: CandidateRef, blockedId: string): void
    blocked?(candidate: CandidateRef): boolean
  }
  now?: () => string
}
export interface ProductApplication extends ApplicationService {
  readonly core: Engine
  readonly questions: QuestionBroker
  registerProject(project: ProjectConfiguration, registeredChecks: readonly string[]): void
  retryVerification(command: VerificationRetryCommand, actor: TrustedActor): Promise<CommandReceipt>
}
const SOURCE = 'personal-local'
const digestOf = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)))
const equal = (a: unknown, b: unknown): boolean => digestOf(a) === digestOf(b)
const refOf = (contract: ContractRevision): ContractRef => ({
  workId: contract.workId,
  revision: contract.revision,
  digest: contract.digest,
})
const expectedFailure = (error: unknown): AppError | undefined => {
  if (error instanceof ApplicationFault || error instanceof QuestionFault) return error.error
  if (error instanceof ProductConflict || error instanceof DispatchConflict || error instanceof CommandConflict)
    return { code: 'conflict', message: 'State changed; reload the current record', retry: 'user_action' }
  if (error instanceof UserError) {
    const text = error.code
    const code: AppError['code'] = /staleCandidate|completionBusy/.test(text)
      ? 'stale_candidate'
      : /staleContract|ticketRetired|mandateRevoked/.test(text)
        ? 'stale_contract'
        : /verification|acceptanceRequired|writerNotQuiescent/.test(text)
          ? 'verification_failed'
          : 'conflict'
    return { code, message: 'The current core state does not permit this operation', retry: 'user_action' }
  }
  return undefined
}

export function createProductApplication(options: ApplicationOptions): ProductApplication {
  if (options.actionSecret.byteLength < 32)
    throw new TypeError('Application action tokens require at least 32 secret bytes')
  return new LocalApplication(options)
}

class LocalApplication implements ProductApplication {
  readonly core: Engine
  readonly questions: QuestionBroker
  private readonly store: ProductStore
  private projects: readonly ProjectConfiguration[]
  private readonly actionSecret: Buffer
  private readonly options: ApplicationOptions
  constructor(options: ApplicationOptions) {
    // Trusted configuration is a startup snapshot; mutating a caller-owned array cannot grant access.
    this.options = {
      ...options,
      principal: structuredClone(options.principal),
      projects: structuredClone(options.projects),
      profileIds: [...options.profileIds],
      registeredChecks: [...options.registeredChecks],
    }
    options = this.options
    this.store = options.store
    this.projects = structuredClone(options.projects)
    this.actionSecret = Buffer.from(options.actionSecret)
    const store = this.store
    this.core = createPersonalEngine({
      repo: bindCoreRepositories(store),
      now: () => this.now(),
      policy: () => ({
        version: 'personal-local/1',
        paused: false,
        evalTimeoutMs: 1000,
        gate: (trigger) => {
          const ref = ContractRefSchema.safeParse(trigger.meta.contract)
          if (
            trigger.source !== SOURCE ||
            !trigger.human ||
            !ref.success ||
            !this.authorizedContract(ref.data) ||
            trigger.actor.id !== options.principal.userId ||
            trigger.meta.authorityRef !== options.principal.authorityRef
          )
            return { admissible: false, reason: 'untrustedLocalSource' }
          return {
            admissible: true,
            strength: 'explicit',
            basis: { via: 'addressed', addressed: 'direct', source: SOURCE, scope: { contract: ref.data } },
          }
        },
        revalidate: (mandate) => {
          const parsed = ContractRefSchema.safeParse(mandate.basis.scope?.contract)
          return mandate.actor.id === options.principal.userId && parsed.success && this.authorizedContract(parsed.data)
        },
        admitsInferred: () => false,
      }),
      scope: {
        scope: (input) =>
          input.source === SOURCE
            ? { listened: true, observed: false }
            : { listened: false, reason: 'untrustedLocalSource' },
      },
      assessor: { request: () => {} },
      executor: {
        start: (ticket, assignment) =>
          this.enqueue('application.execute', key('start', assignment.id), {
            kind: 'start',
            ticketId: ticket.id,
            assignmentId: assignment.id,
            contract: ticket.completion!.contract,
          }),
        deliver: (ticket, assignment) =>
          this.enqueue('application.execute', key('deliver', assignment.id), {
            kind: 'deliver',
            ticketId: ticket.id,
            assignmentId: assignment.id,
            contract: ticket.completion!.contract,
          }),
        stop: (ticket, assignment) => {
          store.queue.cancel('application.execute', key('start', assignment.id))
          store.queue.cancel('application.execute', key('deliver', assignment.id))
          const binding = store.bindings.current(ticket.id)
          if (binding && binding.assignmentId === assignment.id && binding.state !== 'ended') {
            store.bindings.record({ ...binding, state: 'stopping' })
            this.enqueue('runtime.reconcile', binding.attemptId, ticket.id)
          }
        },
      },
      outbox: {
        send: (message) => {
          store.channels.add(message)
        },
        withdraw: (id) => {
          store.channels.withdraw(id)
        },
        status: (id) => store.channels.status(id),
      },
      completionPolicy: (ticket) => {
        const ref = ContractRefSchema.parse(store.domain.triggers.get<Trigger>(ticket.origin.triggerId)!.meta.contract)
        const contract = store.product.contracts.getByRef(ref)
        if (!contract) throw new ApplicationFault('storage_unavailable', 'Core contract is missing', 'none')
        return { mode: 'verified', contract }
      },
      isCurrentContract: (ref) => this.authorizedContract(ref),
      completionVerifier: options.completion?.verifier ?? { resolve: () => undefined },
      emit: (event) => {
        store.events.append({
          topic: `core.${event.type}`,
          entityRef: 'ticketId' in event.data ? event.data.ticketId : SOURCE,
          payload: event,
        })
      },
    })
    this.questions = new QuestionBroker(store, {
      admit: (question) => {
        const contract = store.product.contracts.getByRef(question.contract)
        return !!contract && this.authorizedContract(question.contract) && scopeWithin(question.scope, contract.scope)
      },
      authorize: (question, actor) =>
        this.actorAllowed(actor) &&
        this.authorizedContract(question.contract) &&
        this.project(question.scope.projectId) !== undefined,
      current: (target) => {
        const binding = store.bindings.current(target.ticketId),
          ticket = store.domain.tickets.get<Ticket>(target.ticketId)
        if (
          !binding ||
          binding.attemptId !== target.attemptId ||
          binding.fenceEpoch !== target.fenceEpoch ||
          binding.assignmentId !== target.assignmentId ||
          !equal(binding.contract, target.contract) ||
          binding.state !== 'active' ||
          !ticket ||
          ticket.ended ||
          latestAssignment(ticket)?.id !== target.assignmentId ||
          !this.authorizedContract(target.contract)
        )
          return 'stale'
        return options.nativeFence(target)
      },
      invalidate: (ref) => {
        this.core.invalidateCandidate(ref)
      },
      now: () => this.now(),
    })
  }
  private now(): string {
    return this.options.now?.() ?? new Date().toISOString()
  }
  /** Trusted operator configuration, separate from user/agent execution commands and immutable at each grant. */
  registerProject(project: ProjectConfiguration, registeredChecks: readonly string[]): void {
    if (this.store.uow.nesting) throw new Error('Project configuration must be prepared outside a command transaction')
    const parsed = {
      id: IdSchema.parse(project.id),
      scope: ScopeSchema.parse(project.scope),
      ...(project.displayName ? { displayName: project.displayName } : {}),
    }
    const checks = registeredChecks.map((id) => IdSchema.parse(id))
    if (parsed.scope.projectId !== parsed.id)
      throw new ApplicationFault('invalid_request', 'Project identity differs from its grant')
    const existing = this.project(parsed.id)
    if (existing && !equal(existing, parsed))
      throw new ApplicationFault('conflict', 'An existing project grant cannot be replaced while work may be active')
    if (!existing) this.projects = [...this.projects, structuredClone(parsed)]
    this.options.registeredChecks = [...new Set([...this.options.registeredChecks, ...checks])]
  }
  private authorizedContract(ref: ContractRef): boolean {
    const contract = this.store.product.contracts.getByRef(ref)
    return (
      this.store.authority.isCurrent(ref) &&
      !!contract &&
      (!contract.scope.expiresAt || Date.parse(contract.scope.expiresAt) > Date.parse(this.now()))
    )
  }
  private actorAllowed(actor: TrustedActor): boolean {
    return (
      actor.userId === this.options.principal.userId &&
      actor.authorityRef === this.options.principal.authorityRef &&
      actor.source !== 'explicit_rule'
    )
  }
  private project(id: string): ProjectConfiguration | undefined {
    return this.projects.find((project) => project.id === id)
  }
  private enqueue(kind: string, id: string, value: unknown): void {
    this.store.queue.enqueue(kind, id, JSON.stringify(value), this.store.queue.maxSeq() + 1, 0, this.now())
  }
  private emit(workId: string, extra: object = {}): void {
    this.store.events.append({ topic: 'application.work.changed', entityRef: workId, payload: { workId, ...extra } })
  }
  private current(workId: string): { work: WorkRecord; contract: ContractRevision; link: TicketLink; ticket: Ticket } {
    const work = this.store.product.works.get(workId),
      ref = this.store.authority.current(workId)
    if (!work || !this.project(work.projectId) || !ref)
      throw new ApplicationFault('invalid_request', 'Unknown authorized work')
    const contract = this.store.product.contracts.getByRef(ref),
      link = this.store.product.links.listByRef(ref).find((item) => item.role === 'primary')
    const ticket = link && this.store.domain.tickets.get<Ticket>(link.ticketId)
    if (!contract || !link || !ticket)
      throw new ApplicationFault('storage_unavailable', 'Work has incomplete core links', 'none')
    return { work, contract, link, ticket }
  }
  private expect(ref: ContractRef) {
    const current = this.current(ref.workId)
    if (!equal(refOf(current.contract), ref)) throw new ApplicationFault('stale_contract', 'Work contract changed')
    return current
  }
  private physical(workId: string) {
    return this.store.product.links.listByWork(workId).flatMap((link) => {
      const binding = this.store.bindings.current(link.ticketId)
      return binding ? [{ link, binding }] : []
    })
  }
  private safeForNewWriter(workId: string): boolean {
    return this.store.product.links.listByWork(workId).every((link) => {
      const binding = this.store.bindings.current(link.ticketId),
        ticket = this.store.domain.tickets.get<Ticket>(link.ticketId)
      return binding
        ? binding.state === 'ended'
        : !!ticket && !ticket.assignments.some((item) => item.startedAt || item.state === 'running')
    })
  }
  private token(ticket: Ticket, contract: ContractRef, holdRevision: number): string {
    return createHmac('sha256', this.actionSecret)
      .update(
        JSON.stringify({
          contract,
          assignment: latestAssignment(ticket)?.id,
          generation: ticket.completion?.generation,
          holdRevision,
        }),
      )
      .digest('hex')
  }
  private message(command: UserCommand, text: string, projectId: string, workId?: string): void {
    const anchor =
      command.kind === 'chat' ? { ...command.anchor, ...(workId ? { workId } : {}) } : workId ? { workId } : undefined
    const profileId =
      command.kind === 'create_work'
        ? command.profileId
        : 'selectedProfileId' in command
          ? command.selectedProfileId
          : undefined
    this.store.product.messages.append({
      id: key('message', command.commandId),
      conversationId: command.conversationId,
      role: 'user',
      provenance: 'trusted_user',
      projectId,
      ...(anchor && Object.keys(anchor).length ? { anchor } : {}),
      ...(profileId ? { selectedProfileId: profileId } : {}),
      text,
      sourceRefs: workId ? [key('trigger', command.commandId)] : [],
      createdAt: this.now(),
    })
    const conversation = this.store.workflows.conversations.get(command.conversationId)
    if (conversation?.title === '新对话' && conversation.titleRevision === 1 && conversation.messageCount === 1)
      this.store.workflows.conversations.rename(conversation.id, 1, text.trim().split('\n')[0]!.slice(0, 120))
  }
  private validateScope(scope: Scope): void {
    const project = this.project(scope.projectId)
    if (
      !project ||
      !scopeWithin(scope, project.scope) ||
      (scope.expiresAt && Date.parse(scope.expiresAt) <= Date.parse(this.now()))
    )
      throw new ApplicationFault('forbidden', 'Scope exceeds the configured project grant', 'none')
  }
  private createRevision(
    work: WorkRecord,
    command: Extract<UserCommand, { kind: 'create_work' | 'revise_work' }>,
    actor: TrustedActor,
    revision: number,
    profileId: string,
  ): string {
    this.validateScope(command.scope)
    if (revision > 200) throw new ApplicationFault('budget_exceeded', 'Work revision limit reached', 'none')
    if (!this.options.profileIds.includes(profileId))
      throw new ApplicationFault('unsupported_capability', 'Unknown execution profile')
    this.options.projectGrant?.({ projectId: work.projectId, profileId, criteria: command.criteria, newWork: command.kind === 'create_work' })
    if (
      !command.criteria.some((item) => item.kind === 'machine' && item.required) ||
      command.criteria.some(
        (item) =>
          item.kind === 'machine' && item.required && !(this.options.registeredCheck?.(item.checkDefinitionRef) ?? this.options.registeredChecks.includes(item.checkDefinitionRef)),
      )
    )
      throw new ApplicationFault(
        'unsupported_capability',
        'At least one registered required machine check is necessary',
      )
    const digest = digestOf({ goal: command.goal, scope: command.scope, criteria: command.criteria })
    const contract: ContractRevision = {
      workId: work.id,
      revision,
      digest,
      goal: command.goal,
      scope: command.scope,
      criteria: command.criteria,
      authorityRef: key('grant', command.commandId, actor.authorityRef),
      createdAt: this.now(),
    }
    this.store.product.contracts.append(contract)
    this.store.authority.enable(refOf(contract))
    const trigger: Trigger = {
      id: key('trigger', command.commandId),
      source: SOURCE,
      threads: [{ source: SOURCE, id: `${work.id}.r${revision}` }],
      actor: { source: actor.source, id: actor.userId },
      human: true,
      addressed: 'direct',
      at: this.now(),
      text: command.goal,
      meta: { contract: refOf(contract), profileId, authorityRef: actor.authorityRef },
    }
    this.core.receive(trigger)
    const decision = this.core.decide(trigger.id, {
      kind: 'accept',
      title: work.title,
      scope: work.projectId,
      reason: 'Explicit authorized work command',
    })
    if (!decision.ticketId)
      throw new ApplicationFault('storage_unavailable', 'Core did not create an authorized ticket', 'none')
    this.store.product.links.attach({
      contract: refOf(contract),
      ticketId: decision.ticketId,
      role: 'primary',
      authorityRef: contract.authorityRef,
    })
    return decision.ticketId
  }
  async dispatch(input: UserCommand, inputActor: TrustedActor): Promise<CommandReceipt> {
    const command = UserCommandSchema.parse(input),
      actor = TrustedActorSchema.parse(inputActor)
    if (!this.actorAllowed(actor))
      throw new ApplicationFault('forbidden', 'Caller is not the configured local principal', 'none')
    if (this.store.uow.nesting)
      throw new ApplicationFault('invalid_request', 'Application dispatch owns the outer commit', 'none')
    const digest = digestOf({ command, actor })
    let completionGuard: (() => void) | undefined
    let preflightError: AppError | undefined
    if (command.kind === 'create_work' && !this.store.commands.get(command.commandId)) {
      try {
        await this.options.projectPreflight?.(command.projectId)
      } catch (error) {
        preflightError = expectedFailure(error)
        if (!preflightError) throw error
      }
    }
    if (command.kind === 'accept_candidate' && !this.store.commands.get(command.commandId)) {
      try {
        completionGuard = await this.options.completion?.preflight?.(command.candidate)
      } catch (error) {
        preflightError = expectedFailure(error)
        if (!preflightError) throw error
      }
    }
    return this.store.uow.atomic(() => {
      const prior = this.store.commands.get(command.commandId)
      if (prior) {
        if (prior.payloadDigest !== digest)
          throw new ApplicationFault('conflict', 'Command ID already names another immutable request')
        return CommandReceiptSchema.parse({ ...(prior.result as object), commandId: command.commandId, seq: prior.seq })
      }
      let result:
        | Omit<Extract<CommandReceipt, { status: 'recorded' }>, 'commandId' | 'seq'>
        | Omit<Extract<CommandReceipt, { status: 'rejected' }>, 'commandId' | 'seq'>
      try {
        result = this.store.uow.atomic(() => {
          if (preflightError) return { status: 'rejected' as const, error: preflightError }
          completionGuard?.()
          return { status: 'recorded' as const, ...this.execute(command, actor) }
        })
      } catch (error) {
        const appError = expectedFailure(error)
        if (!appError) throw error
        result = { status: 'rejected', error: AppErrorSchema.parse(appError) }
      }
      const receipt = this.store.commands.record(command.commandId, digest, () => result, result.status)
      return CommandReceiptSchema.parse({ ...receipt.result, commandId: command.commandId, seq: receipt.seq })
    })
  }
  private execute(
    command: UserCommand,
    actor: TrustedActor,
  ): { workId?: string; entityRefs?: { questionId?: string } } {
    if (command.kind === 'create_work') {
      const work: WorkRecord = {
        id: key('work', command.commandId),
        projectId: command.projectId,
        conversationId: command.conversationId,
        title: command.goal.split('\n')[0]!.slice(0, 120),
        createdAt: this.now(),
      }
      this.store.product.works.insert(work)
      this.createRevision(work, command, actor, 1, command.profileId)
      this.message(command, command.goal, work.projectId, work.id)
      this.emit(work.id)
      return { workId: work.id }
    }
    if (command.kind === 'answer_question') {
      const question = this.questions.get(command.questionId)
      if (!question) throw new ApplicationFault('invalid_request', 'Unknown question')
      const current = this.current(question.contract.workId)
      this.checkConversation(current.work, command.conversationId)
      const result = this.questions.answer({
        answerId: key('answer', command.commandId),
        questionId: command.questionId,
        expectedVersion: command.expectedVersion,
        answer: command.answer,
        actor,
      })
      this.store.product.messages.append({
        id: key('answer-display', command.commandId),
        conversationId: command.conversationId,
        projectId: current.work.projectId,
        role: 'user',
        provenance: 'question_answer_display',
        anchor: { questionId: question.id, workId: current.work.id },
        text: result.deferred ? 'Deferred' : 'Answer recorded',
        sourceRefs: [result.answerId],
        createdAt: this.now(),
      })
      this.emit(current.work.id)
      return { workId: current.work.id, entityRefs: { questionId: question.id } }
    }
    if (command.kind === 'chat') return this.chat(command, actor)
    const workId =
      command.kind === 'stop_work'
        ? command.workId
        : command.kind === 'retry_assignment'
          ? command.expected.contract.workId
          : 'expected' in command
            ? command.expected.workId
            : command.kind === 'accept_candidate'
              ? command.candidate.contract.workId
              : undefined
    if (!workId)
      throw new ApplicationFault('unsupported_capability', 'This command is outside the deterministic first release')
    const current = this.current(workId)
    this.checkConversation(current.work, command.conversationId)
    if ('expected' in command)
      this.expect('contract' in command.expected ? command.expected.contract : command.expected)
    if (command.kind === 'stop_work') {
      this.core.stopTicket(current.ticket.id)
      this.emit(workId)
      return { workId }
    }
    if (command.kind === 'pause_dispatch' || command.kind === 'resume_dispatch') {
      if (command.kind === 'resume_dispatch' && !this.authorizedContract(refOf(current.contract)))
        throw new ApplicationFault('stale_contract', 'Expired authorization cannot resume dispatch')
      this.store.product.dispatchControls.compareAndSet(
        workId,
        command.expectedHoldRevision,
        command.kind === 'pause_dispatch',
      )
      this.emit(workId)
      return { workId }
    }
    if (command.kind === 'revise_work' || command.kind === 'continue_work') {
      if (command.kind === 'continue_work' && !current.ticket.ended)
        throw new ApplicationFault('conflict', 'Continue requires an ended ticket')
      const profileId = this.store.domain.triggers.get<Trigger>(current.ticket.origin.triggerId)?.meta.profileId
      if (typeof profileId !== 'string')
        throw new ApplicationFault('storage_unavailable', 'Work profile is missing', 'none')
      this.core.retireTicket(current.ticket.id, 'Explicit contract revision')
      this.store.authority.disable(refOf(current.contract))
      const revisionCommand =
        command.kind === 'revise_work'
          ? command
          : {
              ...command,
              kind: 'revise_work' as const,
              goal: current.contract.goal,
              scope: current.contract.scope,
              criteria: current.contract.criteria,
            }
      this.createRevision(current.work, revisionCommand, actor, current.contract.revision + 1, profileId)
      this.message(command, revisionCommand.goal, current.work.projectId, workId)
      this.emit(workId)
      return { workId }
    }
    if (command.kind === 'retry_assignment') {
      const hold = this.store.product.dispatchControls.get(workId)
      const expected = this.token(current.ticket, refOf(current.contract), hold?.revision ?? 0)
      const supplied = Buffer.from(command.actionToken)
      if (
        latestAssignment(current.ticket)?.id !== command.expected.assignmentId ||
        command.expected.ticketId !== current.ticket.id ||
        supplied.length !== expected.length ||
        !timingSafeEqual(supplied, Buffer.from(expected))
      )
        throw new ApplicationFault('stale_binding', 'Retry context or action token changed')
      if (!this.safeForNewWriter(workId))
        throw new ApplicationFault('writer_indeterminate', 'Previous writer is not proven quiescent', 'reconcile')
      this.core.retryTicket(current.ticket.id)
      this.emit(workId)
      return { workId }
    }
    if (command.kind === 'accept_candidate') {
      const candidate = this.core.completionCandidate(current.ticket.id)
      if (!candidate || !equal(candidate, command.candidate))
        throw new ApplicationFault('stale_candidate', 'Candidate changed')
      if (!this.safeForNewWriter(workId))
        throw new ApplicationFault('writer_indeterminate', 'Current writers are not proven quiescent', 'reconcile')
      const review = this.options.completion?.current(candidate)
      if (!review) throw new ApplicationFault('verification_failed', 'Trusted verification is unavailable')
      const acceptanceId = key('acceptance', command.commandId)
      const humanCriteria = current.contract.criteria
        .filter((item) => item.kind === 'human' && item.required)
        .map((item) => item.id)
      if (humanCriteria.length) this.options.completion!.accept(review.proposal, actor, humanCriteria, acceptanceId)
      this.core.confirmCompletion({
        ...review.proposal,
        ...(humanCriteria.length ? { humanAcceptanceRef: acceptanceId } : {}),
      })
      this.emit(workId)
      return { workId }
    }
    throw new ApplicationFault('unsupported_capability', 'Command is not implemented')
  }
  async retryVerification(input: VerificationRetryCommand, inputActor: TrustedActor): Promise<CommandReceipt> {
    const command = VerificationRetryCommandSchema.parse(input), actor = TrustedActorSchema.parse(inputActor)
    if (!this.actorAllowed(actor))
      throw new ApplicationFault('forbidden', 'Caller is not the configured local principal', 'none')
    if (this.store.uow.nesting)
      throw new ApplicationFault('invalid_request', 'Application dispatch owns the outer commit', 'none')
    const digest = digestOf({ command, actor })
    return this.store.uow.atomic(() => {
      const prior = this.store.commands.get(command.commandId)
      if (prior) {
        if (prior.payloadDigest !== digest)
          throw new ApplicationFault('conflict', 'Command ID already names another immutable request')
        return CommandReceiptSchema.parse({ ...(prior.result as object), commandId: command.commandId, seq: prior.seq })
      }
      let result: { status: 'recorded'; workId: string } | { status: 'rejected'; error: AppError }
      try {
        result = this.store.uow.atomic(() => {
          const { work, ticket } = this.expect(command.candidate.contract)
          this.checkConversation(work, command.conversationId)
          if (!this.authorizedContract(command.candidate.contract))
            throw new ApplicationFault('stale_contract', 'Authorization is no longer current')
          const candidate = this.core.completionCandidate(ticket.id)
          if (ticket.ended || !candidate || !equal(candidate, command.candidate))
            throw new ApplicationFault('stale_candidate', 'Candidate changed')
          if (!this.safeForNewWriter(work.id))
            throw new ApplicationFault('writer_indeterminate', 'Writers are not proven quiescent', 'reconcile')
          if (!this.options.verificationRecovery)
            throw new ApplicationFault('unsupported_capability', 'Verification recovery is not connected')
          this.options.verificationRecovery.retry(command.candidate, command.blockedId)
          this.emit(work.id)
          return { status: 'recorded' as const, workId: work.id }
        })
      } catch (error) {
        const failure = expectedFailure(error)
        if (!failure) throw error
        result = { status: 'rejected', error: AppErrorSchema.parse(failure) }
      }
      const receipt = this.store.commands.record(command.commandId, digest, () => result, result.status)
      return CommandReceiptSchema.parse({ ...receipt.result, commandId: command.commandId, seq: receipt.seq })
    })
  }
  private checkConversation(work: WorkRecord, conversationId: string): void {
    if (work.conversationId !== conversationId)
      throw new ApplicationFault('conflict', 'Work belongs to another conversation')
  }
  private chat(command: Extract<UserCommand, { kind: 'chat' }>, actor: TrustedActor) {
    if (!this.project(command.projectId)) throw new ApplicationFault('forbidden', 'Unknown configured project', 'none')
    let workId = command.anchor?.workId
    if (command.anchor?.questionId)
      throw new ApplicationFault('invalid_request', 'Use the structured question-answer command')
    if (command.anchor?.messageId) {
      const message = this.store.product.messages.getById(command.anchor.messageId)
      if (!message || message.conversationId !== command.conversationId || message.projectId !== command.projectId)
        throw new ApplicationFault('conflict', 'Reply anchor has another send-time context')
      if (message.anchor?.questionId)
        throw new ApplicationFault('invalid_request', 'Question display replies must use a structured answer')
      if (workId && message.anchor?.workId && workId !== message.anchor.workId)
        throw new ApplicationFault('conflict', 'Reply anchors disagree')
      workId ??= message.anchor?.workId
      if (workId) {
        const original = message.sourceRefs.map((ref) => this.store.domain.triggers.get<Trigger>(ref)).find(Boolean)
        if (original && !equal(original.meta.contract, refOf(this.current(workId).contract)))
          throw new ApplicationFault('stale_contract', 'Reply anchor belongs to an older contract')
      }
    }
    if (workId) {
      const current = this.current(workId)
      this.checkConversation(current.work, command.conversationId)
      if (
        current.work.projectId !== command.projectId ||
        current.ticket.ended ||
        !this.authorizedContract(refOf(current.contract))
      )
        throw new ApplicationFault('stale_contract', 'The selected work is not an active target')
      const original = this.store.domain.triggers.get<Trigger>(current.ticket.origin.triggerId)!
      if (command.selectedProfileId && command.selectedProfileId !== original.meta.profileId)
        throw new ApplicationFault('conflict', 'A profile selection cannot change a running work')
      this.core.receive({
        ...original,
        id: key('trigger', command.commandId),
        actor: { source: actor.source, id: actor.userId },
        text: command.text,
        at: this.now(),
      })
      this.emit(workId)
    }
    this.message(command, command.text, command.projectId, workId)
    this.store.events.append({
      topic: 'application.message.appended',
      entityRef: command.conversationId,
      payload: { conversationId: command.conversationId, messageId: key('message', command.commandId) },
    })
    if (this.options.assistantReplies && !workId)
      this.enqueue('application.assistant.reply', command.commandId, {
        messageId: key('message', command.commandId),
        conversationId: command.conversationId,
        projectId: command.projectId,
      })
    return workId ? { workId } : {}
  }
  async inspect(input: InspectQuery): Promise<Snapshot> {
    const query = InspectQuerySchema.parse(input)
    return this.store.uow.atomic(() => {
      const works = query.workId
        ? [this.current(query.workId).work]
        : this.projects
            .flatMap((project) => this.store.product.works.listByProject(project.id, { limit: 200 }))
            .filter((work) => !query.conversationId || work.conversationId === query.conversationId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
            .slice(0, query.limit ?? 200)
      const visible = new Set(works.map((work) => work.id))
      const questions = this.store.product.questions.listOpen({ limit: 200 }).filter(
        (question) =>
          visible.has(question.contract.workId) &&
          this.authorizedContract(question.contract) &&
          question.targets.every((target) => {
            const ticket = this.store.domain.tickets.get<Ticket>(target.ticketId)
            const binding = this.store.bindings.current(target.ticketId)
            return (
              !!ticket &&
              !ticket.ended &&
              latestAssignment(ticket)?.id === target.assignmentId &&
              binding?.state === 'active' &&
              binding.attemptId === target.attemptId &&
              binding.fenceEpoch === target.fenceEpoch
            )
          }) &&
          (!question.expiresAt || Date.parse(question.expiresAt) > Date.parse(this.now())),
      )
      const views = works.map((work) => this.view(work.id, questions))
      return SnapshotSchema.parse({
        cursor: this.store.events.cursor(),
        works: views,
        questions,
        ...(query.conversationId
          ? {
              conversation: this.store.product.messages.page(query.conversationId, {
                ...(query.beforeMessageCursor === undefined ? {} : { before: query.beforeMessageCursor }),
                ...(query.limit === undefined ? {} : { limit: query.limit }),
              }),
            }
          : {}),
      })
    })
  }
  private view(workId: string, questions: Snapshot['questions']): WorkView {
    const { work, contract, ticket } = this.current(workId),
      links = this.store.product.links.listByWork(workId)
    const physical = this.physical(workId),
      busy = physical.filter((item) => item.binding.state !== 'ended')
    const missingProof = !this.safeForNewWriter(workId) && !busy.length
    const resourceStatus = missingProof
      ? ('indeterminate' as const)
      : busy.length
        ? busy.some((item) => item.binding.state === 'stopping')
          ? ('indeterminate' as const)
          : ('active' as const)
        : ('quiescent' as const)
    const activeGrant = this.authorizedContract(refOf(contract))
    const assignment = latestAssignment(ticket),
      candidate = activeGrant && !ticket.ended && !ticket.completion?.retired ? ticket.completion?.candidate : undefined
    const reviewCandidate = candidate ?? ticket.completion?.confirmed?.proposal
    const review = reviewCandidate && this.options.completion?.current(reviewCandidate)
    const hold = this.store.product.dispatchControls.get(workId) ?? { paused: false, revision: 0 }
    const open = questions.filter(
      (question) =>
        question.contract.workId === workId &&
        equal(question.contract, refOf(contract)) &&
        (!question.expiresAt || Date.parse(question.expiresAt) > Date.parse(this.now())),
    )
    const available: WorkView['actions']['available'][number][] = []
    const machinePassed =
      review &&
      review.verification.criteriaDigest === completionCriteriaDigest(contract.criteria) &&
      review.verification.artifactDigest === review.proposal.artifactDigest &&
      contract.criteria.every(
        (criterion) =>
          !criterion.required ||
          criterion.kind !== 'machine' ||
          review.verification.results.some(
            (result) => result.criterionId === criterion.id && result.outcome === 'PASS' && result.evidenceRefs.length,
          ),
      )
    if (!ticket.ended) {
      available.push('stop_work')
      if (activeGrant) available.push(hold.paused ? 'resume_dispatch' : 'pause_dispatch')
      if (activeGrant && canRetry(ticket) && this.safeForNewWriter(workId)) available.push('retry_assignment')
      if (candidate && review && machinePassed && this.safeForNewWriter(workId)) available.push('accept_candidate')
    } else if (activeGrant) available.push('continue_work')
    let phase: WorkView['phase'] = ticket.ended
      ? ticket.ended.outcome === 'completed'
        ? 'delivered'
        : 'ended'
      : assignment?.state === 'pending'
        ? 'queued'
        : 'working'
    if (!ticket.ended && ticketStage(ticket).stage === 'person') phase = 'needs_user'
    if (candidate) phase = review ? 'needs_user' : 'verifying'
    if (candidate && this.options.verificationRecovery?.blocked?.(candidate)) phase = 'needs_user'
    if (open.length && !ticket.ended) phase = 'needs_user'
    if (busy.some((item) => item.link.ticketId !== ticket.id)) phase = 'switching'
    else if (busy.some((item) => item.binding.state === 'stopping')) phase = 'stopping'
    else if (missingProof) phase = 'uncertain'
    if (!activeGrant && !ticket.ended && phase !== 'stopping' && phase !== 'switching') phase = 'uncertain'
    return {
      work,
      contract,
      links,
      phase,
      coreSnapshotRef: `core:${ticket.id}`,
      openQuestionIds: open.map((question) => question.id),
      artifactIds: review ? [...review.artifactIds] : [],
      resourceStatus,
      evidenceRefs: [],
      actions: {
        dispatchHold: hold,
        available,
        ...(assignment
          ? { currentAssignment: { ticketId: ticket.id, assignmentId: assignment.id, contract: refOf(contract) } }
          : {}),
        ...(candidate ? { currentCandidate: candidate } : {}),
        ...(review ? { currentVerificationId: review.verification.id } : {}),
        ...(available.includes('retry_assignment')
          ? { retryActionToken: this.token(ticket, refOf(contract), hold.revision) }
          : {}),
      },
    }
  }
  changes(after: number) {
    return changes(this.store, after)
  }
}
