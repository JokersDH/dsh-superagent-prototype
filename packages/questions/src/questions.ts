import { z } from 'zod'
import {
  AnswerDeliverySchema,
  AppErrorSchema,
  IdSchema,
  NativeDispatchSchema,
  QuestionAnswerSchema,
  TrustedActorSchema,
  UserQuestionSchema,
} from '@personal-agent/contracts'
import type {
  AnswerDelivery,
  AppError,
  AssignmentRef,
  NativeAnswerPayload,
  NativeQuestionBinding,
  NativeDispatch,
  QuestionAnswer,
  TrustedActor,
  UserQuestion,
} from '@personal-agent/contracts'
import { key } from '@personal-agent/orchestrator-core'
import { canonicalDigest } from '@personal-agent/storage'
import type { ProductStore } from '@personal-agent/storage'
import { answerMatches } from './validation.ts'

export const ANSWER_EFFECT = 'question.answer'
export type QuestionStore = Pick<
  ProductStore,
  'uow' | 'product' | 'answers' | 'queue' | 'events' | 'dispatch' | 'commands'
>
export interface QuestionOptions {
  admit(question: UserQuestion): boolean
  authorize(question: UserQuestion, actor: TrustedActor): boolean
  current(target: NativeQuestionBinding): 'current' | 'stale' | 'unknown'
  invalidate(ref: AssignmentRef): void
  now?: () => string
  deliveryTimeoutMs?: number
}
export type AnswerResult = { answerId: string; deferred: boolean; deliveries: readonly AnswerDelivery[] }
export interface AnswerTransport {
  /** Finish preparation before beforeWrite; call it synchronously immediately before the first external write. */
  send(commandId: string, payload: NativeAnswerPayload, beforeWrite: () => void): Promise<NativeDispatch>
}
export class QuestionFault extends Error {
  readonly error: AppError
  constructor(code: AppError['code'], message: string, retry: AppError['retry'] = 'user_action') {
    super(message)
    this.error = AppErrorSchema.parse({ code, message, retry })
  }
}
export class DeliveryUnknown extends Error {}
export class DeliveryDeferred extends Error {}
const LedgerSchema = z.strictObject({
  kind: z.literal('question-answer/1'),
  question: UserQuestionSchema,
  answer: QuestionAnswerSchema,
  actor: TrustedActorSchema,
  deferred: z.boolean(),
})
const EvidenceSchema = z.strictObject({ kind: z.literal('answer-evidence/1'), refs: z.array(IdSchema).max(1024) })
const hash = (value: unknown): string => canonicalDigest(JSON.parse(JSON.stringify(value)))
const refOf = (target: NativeQuestionBinding): AssignmentRef => ({
  ticketId: target.ticketId,
  assignmentId: target.assignmentId,
  contract: target.contract,
})

export class QuestionBroker {
  private readonly store: QuestionStore
  private readonly options: QuestionOptions
  constructor(store: QuestionStore, options: QuestionOptions) {
    const timeout = options.deliveryTimeoutMs ?? 3000
    if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > 60_000)
      throw new RangeError('Invalid answer delivery deadline')
    this.store = store
    this.options = options
  }
  private now(): string {
    return this.options.now?.() ?? new Date().toISOString()
  }
  private expired(question: UserQuestion): boolean {
    return [question.expiresAt, question.scope.expiresAt].some(
      (value) => !!value && Date.parse(value) <= Date.parse(this.now()),
    )
  }
  private invalidateTargets(question: UserQuestion): void {
    const seen = new Set<string>()
    for (const target of question.targets) {
      const ref = refOf(target),
        id = hash(ref)
      if (!seen.has(id)) {
        seen.add(id)
        this.options.invalidate(ref)
      }
    }
  }
  private event(topic: string, question: UserQuestion, payload: object): void {
    this.store.events.append({
      topic: `application.${topic}`,
      entityRef: question.id,
      payload: { questionId: question.id, workId: question.contract.workId, ...payload },
    })
  }
  private active(question: UserQuestion): void {
    if (question.validity !== 'open' || this.expired(question))
      throw new QuestionFault('question_expired', 'Question is no longer open')
    if (question.targets.some((target) => this.options.current(target) !== 'current'))
      throw new QuestionFault('stale_binding', 'Question targets require current native bindings', 'reconcile')
  }
  open(input: UserQuestion): UserQuestion {
    const question = UserQuestionSchema.parse(input)
    return this.store.uow.atomic(() => {
      if (!this.options.admit(question))
        throw new QuestionFault('forbidden', 'Question is outside its current contract', 'none')
      this.active(question)
      const existing = this.store.product.questions.get(question.id)
      if (existing && hash(existing) === hash(question)) return existing
      if (
        (!existing || existing.validity !== 'open') &&
        this.store.product.questions.listOpen({ limit: 200 }).length >= 200
      )
        throw new QuestionFault('budget_exceeded', 'The open-question limit is reached', 'reconcile')
      if (existing) {
        if (question.version <= existing.version)
          throw new QuestionFault('conflict', 'Question identity already has another version')
        this.store.product.questions.replaceExpected(question, {
          version: existing.version,
          validity: existing.validity,
        })
      } else this.store.product.questions.insert(question)
      this.invalidateTargets(question)
      this.event('question.changed', question, { version: question.version, validity: 'open' })
      return question
    })
  }
  get(id: string): UserQuestion | undefined {
    return this.store.product.questions.get(IdSchema.parse(id))
  }
  deliveries(answerId: string): readonly AnswerDelivery[] {
    return this.store.answers.deliveries(IdSchema.parse(answerId)).map((delivery) => {
      const ref = delivery.evidenceRefs[0]
      if (!ref) return delivery
      const evidence = EvidenceSchema.parse(this.store.commands.get(ref)?.result)
      return AnswerDeliverySchema.parse({ ...delivery, evidenceRefs: evidence.refs })
    })
  }
  currentDeliveries(questionId: string): readonly AnswerDelivery[] {
    const question = this.get(questionId)
    if (!question || question.validity !== 'answered') return []
    const claim = this.store.commands.get(key('question-answer-claim', question.id, String(question.version - 1)))
    const value = claim?.result as { questionId?: unknown; version?: unknown; answerId?: unknown } | undefined
    if (
      !value ||
      value.questionId !== question.id ||
      value.version !== question.version - 1 ||
      typeof value.answerId !== 'string'
    )
      throw new QuestionFault('storage_unavailable', 'Question answer index is missing', 'none')
    return this.deliveries(value.answerId)
  }
  expire(id: string): boolean {
    return this.store.uow.atomic(() => {
      const question = this.get(id)
      if (!question || question.validity !== 'open' || !this.expired(question)) return false
      this.store.product.questions.replaceExpected(
        { ...question, version: question.version + 1, validity: 'expired' },
        { version: question.version, validity: 'open' },
      )
      this.event('question.changed', question, { version: question.version + 1, validity: 'expired' })
      return true
    })
  }
  answer(input: {
    answerId: string
    questionId: string
    expectedVersion: number
    answer: QuestionAnswer
    actor: TrustedActor
  }): AnswerResult {
    const answerId = IdSchema.parse(input.answerId),
      questionId = IdSchema.parse(input.questionId)
    const answer = QuestionAnswerSchema.parse(input.answer),
      actor = TrustedActorSchema.parse(input.actor)
    const digest = hash({ questionId, expectedVersion: input.expectedVersion, answer, actor })
    return this.store.uow.atomic(() => {
      const prior = this.store.answers.get(answerId)
      if (prior) {
        if (prior.digest !== digest)
          throw new QuestionFault('conflict', 'Answer ID already names another immutable request')
        const ledger = LedgerSchema.parse(prior.answer)
        return { answerId, deferred: ledger.deferred, deliveries: this.deliveries(answerId) }
      }
      const question = this.get(questionId)
      if (!question) throw new QuestionFault('invalid_request', 'Unknown question')
      if (!this.options.authorize(question, actor))
        throw new QuestionFault('forbidden', 'Question is outside the current authorization', 'none')
      if (question.version !== input.expectedVersion)
        throw new QuestionFault('stale_binding', 'Question version changed')
      this.active(question)
      if (!answerMatches(question, answer))
        throw new QuestionFault('invalid_request', 'Answer does not match the original question presentation')
      const deferred = answer.kind === 'defer' || (answer.kind === 'url_action' && answer.action === 'open')
      this.store.answers.record(answerId, {
        questionId,
        expectedVersion: question.version,
        digest,
        answer: { kind: 'question-answer/1', question, answer, actor, deferred },
      })
      if (!deferred) {
        const claim = { questionId, version: question.version, answerId }
        this.store.commands.record(
          key('question-answer-claim', questionId, String(question.version)),
          hash(claim),
          () => claim,
        )
        for (const target of question.targets) {
          this.store.answers.upsertDelivery(answerId, target.id, 'local_recorded')
          const payload = { answerId, targetBindingId: target.id }
          this.store.queue.enqueue(
            ANSWER_EFFECT,
            key('answer-target', answerId, target.id),
            JSON.stringify(payload),
            this.store.queue.maxSeq() + 1,
            0,
            this.now(),
          )
        }
        this.invalidateTargets(question)
        this.store.product.questions.replaceExpected(
          { ...question, version: question.version + 1, validity: 'answered' },
          { version: question.version, validity: 'open' },
        )
      }
      this.event('answer.changed', question, { answerId, deferred })
      return { answerId, deferred, deliveries: this.deliveries(answerId) }
    })
  }
  reuse(input: {
    sourceAnswerId: string
    answerId: string
    questionId: string
    expectedVersion: number
    actor: TrustedActor
  }): AnswerResult {
    return this.store.uow.atomic(() => {
      const prior = this.store.answers.get(IdSchema.parse(input.sourceAnswerId)),
        target = this.get(input.questionId)
      if (!prior || !target) throw new QuestionFault('invalid_request', 'Unknown reusable answer or question')
      const source = LedgerSchema.parse(prior.answer),
        current = this.get(source.question.id)
      const a = source.question,
        b = target
      if (
        source.deferred ||
        a.kind !== 'clarification' ||
        b.kind !== 'clarification' ||
        !a.decisionKey ||
        a.decisionKey !== b.decisionKey ||
        a.version !== b.version ||
        hash(a.contract) !== hash(b.contract) ||
        hash(a.scope) !== hash(b.scope) ||
        hash(a.presentation) !== hash(b.presentation) ||
        a.prompt !== b.prompt ||
        this.expired(a) ||
        current?.validity !== 'answered' ||
        current.version !== a.version + 1 ||
        source.actor.userId !== input.actor.userId ||
        source.actor.authorityRef !== input.actor.authorityRef ||
        source.actor.source !== input.actor.source ||
        !this.options.authorize(a, input.actor)
      )
        throw new QuestionFault('forbidden', 'Answer reuse requires an identical current business decision', 'none')
      return this.answer({
        answerId: input.answerId,
        questionId: input.questionId,
        expectedVersion: input.expectedVersion,
        actor: input.actor,
        answer: source.answer,
      })
    })
  }
  private ledger(answerId: string, targetId: string) {
    const row = this.store.answers.get(IdSchema.parse(answerId))
    if (!row) throw new QuestionFault('invalid_request', 'Unknown recorded answer')
    const ledger = LedgerSchema.parse(row.answer),
      target = ledger.question.targets.find((item) => item.id === targetId)
    if (!target || ledger.deferred) throw new QuestionFault('invalid_request', 'Unknown answer target')
    return { ledger, target }
  }
  private eligible(answerId: string, targetId: string): boolean {
    const { ledger, target } = this.ledger(answerId, targetId),
      current = this.get(ledger.question.id)
    return (
      !!current &&
      current.validity === 'answered' &&
      current.version === ledger.question.version + 1 &&
      !this.expired(ledger.question) &&
      hash(current.targets) === hash(ledger.question.targets) &&
      this.options.authorize(ledger.question, ledger.actor) &&
      this.options.current(target) === 'current'
    )
  }
  private setDelivery(
    answerId: string,
    targetId: string,
    status: AnswerDelivery['status'],
    evidenceRefs: readonly string[] = [],
  ): AnswerDelivery {
    const existing = this.deliveries(answerId).find((item) => item.targetBindingId === targetId)
    if (
      existing &&
      (existing.status === 'native_applied' ||
        existing.status === 'expired' ||
        (existing.status === 'indeterminate' && status === 'response_written') ||
        (existing.status === status && hash(existing.evidenceRefs) === hash(evidenceRefs)))
    )
      return existing
    const evidence = evidenceRefs.length
      ? EvidenceSchema.parse({ kind: 'answer-evidence/1', refs: evidenceRefs })
      : undefined
    const evidenceRef = evidence ? `answer-evidence:${key(answerId, targetId, status, hash(evidence))}` : undefined
    if (evidence && evidenceRef) this.store.commands.record(evidenceRef, hash(evidence), () => evidence)
    this.store.answers.upsertDelivery(answerId, targetId, status, evidenceRef)
    const { ledger } = this.ledger(answerId, targetId)
    const delivery = this.deliveries(answerId).find((item) => item.targetBindingId === targetId)!
    this.event('delivery.changed', ledger.question, { answerId, delivery })
    return delivery
  }
  async deliver(answerId: string, targetId: string, transport: AnswerTransport): Promise<AnswerDelivery> {
    if (this.store.uow.nesting)
      throw new QuestionFault('invalid_request', 'Native delivery must run outside a database transaction', 'none')
    const { ledger, target } = this.ledger(answerId, targetId),
      commandId = key('native-answer', answerId, targetId)
    const existing = this.deliveries(answerId).find((item) => item.targetBindingId === targetId)
    if (!existing) throw new QuestionFault('invalid_request', 'Answer has no delivery intent')
    if (existing.status === 'native_applied' || existing.status === 'expired' || existing.status === 'response_written')
      return existing
    const early = this.store.uow.atomic(() => {
      if (!this.eligible(answerId, targetId)) return this.setDelivery(answerId, targetId, 'expired')
      const verdict = this.store.dispatch.beginSend(commandId, targetId)
      if (!verdict.proceed) {
        if (verdict.state === 'native_accepted') return existing
        this.store.dispatch.markIndeterminate(commandId, targetId, 'An earlier answer write requires reconciliation')
        return this.setDelivery(answerId, targetId, 'indeterminate')
      }
      return undefined
    })
    if (early) {
      if (early.status === 'indeterminate') throw new DeliveryUnknown('An earlier answer write requires reconciliation')
      return early
    }
    let wrote = false,
      settled = false
    const beforeWrite = () => {
      if (settled) throw new DeliveryUnknown('Answer transport attempted a late write after its deadline')
      if (wrote) throw new Error('Answer transport called beforeWrite more than once')
      this.store.uow.atomic(() => {
        if (!this.eligible(answerId, targetId))
          throw new QuestionFault('stale_binding', 'Native target changed before answer write')
        const verdict = this.store.dispatch.beginSend(commandId, targetId)
        if (!verdict.proceed) throw new DeliveryUnknown('Concurrent answer write requires reconciliation')
        this.store.dispatch.markWritten(commandId, targetId)
      })
      wrote = true
    }
    const payload: NativeAnswerPayload = {
      answerId,
      questionId: ledger.question.id,
      questionVersion: ledger.question.version,
      nativeBinding: target,
      answer: ledger.answer,
      authorityRef: ledger.actor.authorityRef,
    }
    let receipt: NativeDispatch
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([
        Promise.resolve().then(() => transport.send(commandId, structuredClone(payload), beforeWrite)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new DeliveryUnknown('Answer transport deadline exceeded')),
            this.options.deliveryTimeoutMs ?? 3000,
          )
        }),
      ])
      settled = true
      receipt = NativeDispatchSchema.parse(response)
      if (receipt.commandId !== commandId || (receipt.delivery !== 'not_sent' && !wrote))
        throw new Error('Answer transport returned an invalid write receipt')
    } catch (error) {
      settled = true
      if (!wrote && error instanceof QuestionFault)
        return this.store.uow.atomic(() => this.setDelivery(answerId, targetId, 'expired'))
      this.store.uow.atomic(() => {
        this.store.dispatch.markIndeterminate(commandId, targetId, 'Answer write outcome is unknown')
        this.setDelivery(answerId, targetId, 'indeterminate')
      })
      throw new DeliveryUnknown('Answer write outcome is unknown')
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (receipt.delivery === 'not_sent' && !wrote && receipt.retry === 'same_key_safe' && receipt.evidenceRefs.length)
      throw new DeliveryDeferred('Answer was not written; the same intent may retry')
    const result = this.store.uow.atomic(() => {
      if (receipt.delivery === 'native_accepted')
        this.store.dispatch.markAccepted(commandId, targetId, receipt.nativeRef)
      if (!this.eligible(answerId, targetId))
        return this.setDelivery(answerId, targetId, 'expired', receipt.evidenceRefs)
      if (receipt.delivery === 'indeterminate' || receipt.delivery === 'not_sent') {
        this.store.dispatch.markIndeterminate(commandId, targetId, 'Answer needs native reconciliation')
        return this.setDelivery(answerId, targetId, 'indeterminate', receipt.evidenceRefs)
      }
      return this.setDelivery(answerId, targetId, 'response_written', receipt.evidenceRefs)
    })
    if (result.status === 'indeterminate') throw new DeliveryUnknown('Answer needs native reconciliation')
    return result
  }
  observe(input: AnswerDelivery, binding: NativeQuestionBinding): AnswerDelivery {
    const delivery = AnswerDeliverySchema.parse(input)
    return this.store.uow.atomic(() => {
      const { target } = this.ledger(delivery.answerId, delivery.targetBindingId)
      if (hash(target) !== hash(binding))
        throw new QuestionFault('stale_binding', 'Answer observation names another native binding')
      if (delivery.status === 'native_applied' && !delivery.evidenceRefs.length)
        throw new QuestionFault('invalid_request', 'Native consumption needs evidence')
      const dispatch = this.store.dispatch.get(key('native-answer', delivery.answerId, target.id), target.id)
      if (delivery.status === 'native_applied' && (!dispatch || dispatch.delivery === 'not_sent'))
        throw new QuestionFault('stale_binding', 'Native consumption has no matching write intent')
      return this.setDelivery(delivery.answerId, target.id, delivery.status, delivery.evidenceRefs)
    })
  }
}
