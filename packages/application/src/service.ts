import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  AppErrorSchema,
  CommandReceiptSchema,
  ContractRefSchema,
  InspectQuerySchema,
  SnapshotSchema,
  TrustedActorSchema,
  UserCommandSchema,
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
  scope: Scope
}
export interface CompletionReviewPort {
  verifier: CompletionVerifier
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
  now?: () => string
}
export interface ProductApplication extends ApplicationService {
  readonly core: Engine
  readonly questions: QuestionBroker
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
    const text = String(error)
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
  private readonly projects: readonly ProjectConfiguration[]
  private readonly actionSecret: Buffer
  private readonly options: ApplicationOptions
  constructor(options: ApplicationOptions) {
    this.options = options
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
    if (
      !command.criteria.some((item) => item.kind === 'machine' && item.required) ||
      command.criteria.some(
        (item) =>
          item.kind === 'machine' && item.required && !this.options.registeredChecks.includes(item.checkDefinitionRef),
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
        result = this.store.uow.atomic(() => ({ status: 'recorded' as const, ...this.execute(command, actor) }))
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
      this.options.completion!.accept(
        review.proposal,
        actor,
        current.contract.criteria.filter((item) => item.kind === 'human' && item.required).map((item) => item.id),
        acceptanceId,
      )
      this.core.confirmCompletion({ ...review.proposal, humanAcceptanceRef: acceptanceId })
      this.emit(workId)
      return { workId }
    }
    throw new ApplicationFault('unsupported_capability', 'Command is not implemented')
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
      const questions = this.store.product.questions
        .listOpen({ limit: 200 })
        .filter(
          (question) =>
            visible.has(question.contract.workId) &&
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
    const review = candidate && this.options.completion?.current(candidate)
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
    if (open.length) phase = 'needs_user'
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
