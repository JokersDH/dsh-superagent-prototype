/**
 * Apply one already-observed Runner result to the original attempt/question/answer/delivery row.
 *
 * This is a data-level sink, not a transport or an authorization decision: the caller must have
 * actually received the native result first. The sink re-reads the complete original tuple in one
 * synchronous UoW, refuses a foreign/expired/changed tuple before writing, and delegates the write
 * to the existing `answers.upsertDelivery` forward-only transition. A replay of the same observed
 * result is a duplicate and does not add rows; `indeterminate` stays `indeterminate` until a later
 * real observation, and no path turns unknown into success.
 */
import type { ProductStore } from '@personal-agent/storage'
import { canonicalJson } from '@personal-agent/contracts/canonical'

export class OriginalResultError extends Error {}

export interface OriginalResultInput {
  readonly protocol: 'original-result/1'
  readonly ticketId: string
  readonly assignmentId: string
  readonly attemptId: string
  readonly fenceEpoch: number
  readonly contract: { readonly workId: string; readonly revision: number; readonly digest: string }
  readonly questionId: string
  readonly answerId: string
  readonly deliveryTargetId: string
  /** Only an actually observed outcome may be written. A command receipt is not a result. */
  readonly status: 'native_applied' | 'indeterminate'
  /** Bounded reference to the returned request/observation; never a credential. */
  readonly evidence?: string
}

export interface OriginalResultOutcome {
  readonly status: 'applied' | 'duplicate' | 'refused'
  readonly delivery: { readonly answerId: string; readonly targetBindingId: string; readonly status: string } | null
  readonly reason?: string
}

const digestJson = (value: unknown): string => canonicalJson(value as never)

export function applyOriginalResult(store: ProductStore, input: OriginalResultInput): OriginalResultOutcome {
  const refuse = (reason: string): OriginalResultOutcome => ({ status: 'refused', delivery: null, reason })
  if (input?.protocol !== 'original-result/1') return refuse('unsupported original-result protocol')
  if (input.status !== 'native_applied' && input.status !== 'indeterminate') return refuse('only an observed native/indeterminate result may be applied')
  if (input.evidence !== undefined && (typeof input.evidence !== 'string' || input.evidence.length > 1024)) return refuse('result evidence is not a bounded string')
  return store.uow.atomic(() => {
    const binding = store.bindings.binding<any>(input.attemptId)
    if (!binding) return refuse('attempt is not the original bound attempt')
    if (binding.ticketId !== input.ticketId || binding.assignmentId !== input.assignmentId || binding.fenceEpoch !== input.fenceEpoch ||
      digestJson(binding.contract) !== digestJson(input.contract)) return refuse('attempt/ticket/assignment/contract/epoch does not match the original subject')
    const current = store.bindings.current<any>(input.ticketId)
    if (!current || current.attemptId !== input.attemptId) return refuse('attempt is not the current one for this ticket')
    const question = store.product.questions.get(input.questionId)
    if (!question) return refuse('question is not part of the original subject')
    const target = question.targets.find((value: any) => value.id !== undefined &&
      value.attemptId === input.attemptId && value.ticketId === input.ticketId && value.assignmentId === input.assignmentId &&
      value.fenceEpoch === input.fenceEpoch && digestJson(value.contract) === digestJson(input.contract))
    if (!target) return refuse('delivery target does not belong to the expected attempt/contract/epoch')
    if (String(target.id) !== input.deliveryTargetId) return refuse('delivery target id does not match the question target')
    const answer = store.answers.get(input.answerId)
    if (!answer) return refuse('answer is not recorded in this store')
    if (answer.questionId !== question.id) return refuse('answer does not belong to the question')
    const existing = store.answers.deliveries(input.answerId).find(row => row.targetBindingId === input.deliveryTargetId)
    if (!existing) return refuse('answer has no delivery row for the target; record the answer first')
    if (existing.status === input.status) return { status: 'duplicate', delivery: existing, reason: 'the same observed result is already persisted' }
    if (existing.status === 'native_applied' || existing.status === 'expired')
      return refuse(`delivery is terminal (${existing.status}); an observed result cannot be re-applied`)
    try {
      store.answers.upsertDelivery(input.answerId, input.deliveryTargetId, input.status, input.evidence)
    } catch (error) {
      return refuse(error instanceof Error ? error.message : String(error))
    }
    const delivery = store.answers.deliveries(input.answerId).find(row => row.targetBindingId === input.deliveryTargetId)
    return delivery ? { status: 'applied', delivery } : refuse('delivery row disappeared after the write')
  })
}
