import { z } from 'zod'
import { AttemptRefSchema, CriticalFactSchema, DurableReceiptSchema, IdSchema, JsonSchema, RunnerCommandSchema } from './schemas.ts'
import type { CriticalFact, DurableReceipt, Json, RunnerCommand } from './types.ts'

/** Same registered producer tuple as execution.RuntimeProducer; this is not a new execution identity. */
export const CoordinatorChannelProducerSchema = z.strictObject({
  attempt: AttemptRefSchema, runnerIdentityRef: IdSchema, source: IdSchema,
})
export type CoordinatorChannelProducer = z.infer<typeof CoordinatorChannelProducerSchema>

/** Existing v1 bridge shapes only. Binding/generation is held by a local authenticated lease. */
export const CoordinatorChannelRequestSchema = z.discriminatedUnion('type', [
  z.strictObject({ v: z.literal(1), type: z.literal('fact'), id: IdSchema, fact: CriticalFactSchema }),
  z.strictObject({ v: z.literal(1), type: z.literal('payload-read'), id: IdSchema, requestId: IdSchema, reference: IdSchema }),
  z.strictObject({ v: z.literal(1), type: z.literal('native-write-intent'), id: IdSchema,
    command: RunnerCommandSchema.refine(value => value.kind === 'answer', 'Only the existing answer hook requests native write admission') }),
]).superRefine((value, context) => {
  if ((value.type === 'fact' && value.id !== value.fact.factId) || (value.type === 'payload-read' && value.id !== value.requestId))
    context.addIssue({ code: 'custom', message: 'Bridge request correlation must match its original fact or payload request' })
})
export const CoordinatorChannelReplySchema = z.discriminatedUnion('type', [
  z.strictObject({ v: z.literal(1), type: z.literal('receipt'), id: IdSchema, factId: IdSchema, receipt: DurableReceiptSchema }),
  z.strictObject({ v: z.literal(1), type: z.literal('ack-failed'), id: IdSchema, factId: IdSchema, reason: z.string().min(1).max(160) }),
  z.strictObject({ v: z.literal(1), type: z.literal('payload'), id: IdSchema, requestId: IdSchema, value: JsonSchema }),
  z.strictObject({ v: z.literal(1), type: z.literal('write-admission'), id: IdSchema, allowed: z.boolean() }),
]).superRefine((value, context) => {
  if ((value.type === 'receipt' && (value.id !== value.factId || value.receipt.factId !== value.factId)) ||
    (value.type === 'ack-failed' && value.id !== value.factId) || (value.type === 'payload' && value.id !== value.requestId))
    context.addIssue({ code: 'custom', message: 'Bridge reply must acknowledge the exact original request' })
})
export type CoordinatorChannelRequest = z.infer<typeof CoordinatorChannelRequestSchema>
export type CoordinatorChannelReply = z.infer<typeof CoordinatorChannelReplySchema>

export const CoordinatorChannelLimitsSchema = z.strictObject({
  maxPendingFacts: z.number().int().min(1).max(1024), maxPendingPayloads: z.number().int().min(1).max(128),
  maxPendingWrites: z.number().int().min(1).max(128), maxPendingBytes: z.number().int().min(1).max(16 * 1024 * 1024),
  maxPayloadBytes: z.number().int().min(1).max(8 * 1024 * 1024), requestTimeoutMs: z.number().int().min(1).max(300000),
  maxSettledRequests: z.number().int().min(1).max(65536),
})
export type CoordinatorChannelLimits = z.infer<typeof CoordinatorChannelLimitsSchema>

export function sameCoordinatorChannelProducer(left: unknown, right: unknown): boolean {
  const a = CoordinatorChannelProducerSchema.safeParse(left), b = CoordinatorChannelProducerSchema.safeParse(right)
  if (!a.success || !b.success) return false
  return a.data.source === b.data.source && a.data.runnerIdentityRef === b.data.runnerIdentityRef &&
    sameAttempt(a.data.attempt, b.data.attempt)
}
function sameAttempt(a: CoordinatorChannelProducer['attempt'], b: CoordinatorChannelProducer['attempt']): boolean {
  return a.ticketId === b.ticketId && a.assignmentId === b.assignmentId && a.attemptId === b.attemptId && a.fenceEpoch === b.fenceEpoch &&
    a.contract.workId === b.contract.workId && a.contract.revision === b.contract.revision && a.contract.digest === b.contract.digest
}
export function parseCoordinatorChannelRequest(value: unknown, producer: CoordinatorChannelProducer): CoordinatorChannelRequest {
  const request = CoordinatorChannelRequestSchema.parse(value), owner = CoordinatorChannelProducerSchema.parse(producer)
  if ((request.type === 'fact' && (!sameAttempt(request.fact, owner.attempt) || request.fact.source !== owner.source)) ||
    (request.type === 'native-write-intent' && !sameAttempt(request.command, owner.attempt)))
    throw new TypeError('Coordinator request does not match the registered producer')
  return request
}

export type CoordinatorChannelFailure = 'identity_mismatch' | 'stale_connection' | 'closed' | 'timeout' | 'capacity' | 'protocol_error' | 'indeterminate'
export interface CoordinatorChannelOptions {
  readonly producer: CoordinatorChannelProducer
  readonly limits: CoordinatorChannelLimits
  readonly now?: () => number
  /** Relative delay; return a cancellation function. Default implementation uses a bounded timer. */
  readonly schedule?: (delayMs: number, callback: () => void) => () => void
}
export interface CoordinatorChannelLease {
  readonly connectionId: string
  readonly generation: number
  /** Parsed reply settles only this active lease's exact pending operation; old/unknown replies return false. */
  receive(reply: unknown): boolean
  /** Detach this lease only. An old lease cannot close a replacement or the attempt. */
  close(reason?: string): void
}
export interface CoordinatorChannel {
  /** Caller supplies the authenticated original producer. CAS generation0 is the first binding. */
  bind(input: { readonly producer: CoordinatorChannelProducer; readonly connectionId: string; readonly expectedGeneration: number;
    readonly send: (request: CoordinatorChannelRequest) => void | Promise<void> }): CoordinatorChannelLease
  recordFact(fact: CriticalFact): Promise<DurableReceipt>
  readPayload(reference: string): Promise<Json>
  beforeNativeWrite(command: RunnerCommand): Promise<void>
  /** Close pending I/O only; B retains admission, process, journal and execution lifecycle ownership. */
  close(reason?: string): void
  inspect(): { readonly state: 'unbound' | 'bound' | 'closed'; readonly generation: number;
    readonly pendingFacts: number; readonly pendingPayloads: number; readonly pendingWrites: number; readonly pendingBytes: number }
}
