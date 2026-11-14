/**
 * Wave-27 legal protocol frames for the published CoordinatorChannel interface (0068).
 *
 * These are data fixtures and a validator, not an implementation of I's module: I owns
 * `apps/runner/src/attach-channel/`. B/I can feed these frames into the real module once it exists;
 * the negatives below must be refused by `parseCoordinatorChannelRequest`/the shared schemas with no
 * send or execute. Generation/CAS/late/close/capacity expectations are recorded as contract
 * scenarios and remain NOT_REACHED until the module is published.
 */
import {
  CoordinatorChannelLimitsSchema,
  CoordinatorChannelReplySchema,
  CoordinatorChannelRequestSchema,
  parseCoordinatorChannelRequest,
  sameCoordinatorChannelProducer,
} from '../../../packages/contracts/src/coordinator-channel.ts'
import { makeAttemptSpec, makeCommand, makeFact } from '../../../packages/testing/src/index.ts'

export const SOURCE = 'fixture-channel-source-wave27'
export const RUNNER_IDENTITY = 'fixture-runner-identity-wave27'
export const MAX_SAFE = Number.MAX_SAFE_INTEGER

export function legalProducer(spec = makeAttemptSpec()) {
  return {
    attempt: { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract },
    runnerIdentityRef: RUNNER_IDENTITY,
    source: SOURCE,
  }
}

export function legalFact(spec = makeAttemptSpec(), overrides = {}) {
  return makeFact('turn.ended', 'payload-1', {
    ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch,
    contract: spec.contract, source: SOURCE, ...overrides,
  })
}

export function legalRequests(spec = makeAttemptSpec()) {
  const fact = legalFact(spec)
  return {
    fact: { v: 1, type: 'fact', id: fact.factId, fact },
    payload: { v: 1, type: 'payload-read', id: 'payload-request-1', requestId: 'payload-request-1', reference: 'payload-ref-1' },
    write: { v: 1, type: 'native-write-intent', id: makeCommand('answer').id, command: makeCommand('answer', { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }) },
  }
}

export function legalReplies(spec = makeAttemptSpec()) {
  const fact = legalFact(spec)
  return {
    receipt: { v: 1, type: 'receipt', id: fact.factId, factId: fact.factId, receipt: { factId: fact.factId, persisted: true, seq: 1 } },
    ackFailed: { v: 1, type: 'ack-failed', id: fact.factId, factId: fact.factId, reason: 'fixture_refused' },
    payload: { v: 1, type: 'payload', id: 'payload-request-1', requestId: 'payload-request-1', value: { kind: 'fixture-payload', nested: { ok: true } } },
    admission: { v: 1, type: 'write-admission', id: makeCommand('answer').id, allowed: true },
  }
}

export function contractScenarios() {
  return [
    { id: 'first_bind', expectedGeneration: 0, resultGeneration: 1, outcome: 'bound' },
    { id: 'second_bind', expectedGeneration: 1, resultGeneration: 2, outcome: 'bound' },
    { id: 'cas_conflict', expectedGeneration: 0, currentGeneration: 2, outcome: 'stale_connection' },
    { id: 'negative_generation', expectedGeneration: -1, outcome: 'protocol_error' },
    { id: 'unsafe_generation', expectedGeneration: MAX_SAFE + 1, outcome: 'protocol_error' },
    { id: 'old_lease_reply', connection: 'A', replyTo: 'B', outcome: false },
    { id: 'old_lease_close', connection: 'A', outcome: 'new_connection_and_attempt_remain_open' },
    { id: 'late_reply', deliveredAfter: 'timeout', outcome: 'timeout' },
    { id: 'capacity_facts', limit: 'maxPendingFacts', outcome: 'capacity' },
    { id: 'capacity_bytes', limit: 'maxPendingBytes', outcome: 'capacity' },
    { id: 'close_pending', outcome: 'closed' },
    { id: 'indeterminate_write', outcome: 'indeterminate' },
  ]
}

/** Validate the legal frames and derive the bounded negatives. Every negative expects zero sends. */
export function validateFrames(spec = makeAttemptSpec()) {
  const producer = legalProducer(spec)
  const requests = legalRequests(spec)
  const replies = legalReplies(spec)
  const positives = []
  for (const [name, value] of Object.entries(requests)) {
    const parsed = parseCoordinatorChannelRequest(value, producer)
    positives.push({ name, type: parsed.type, ok: true })
  }
  for (const [name, value] of Object.entries(replies)) {
    const parsed = CoordinatorChannelReplySchema.safeParse(value)
    positives.push({ name, type: parsed.success ? parsed.data.type : null, ok: parsed.success })
  }
  if (!sameCoordinatorChannelProducer(producer, structuredClone(producer))) throw new Error('Legal producer must equal itself')

  const foreignAttempt = structuredClone(producer); foreignAttempt.attempt.attemptId = 'attempt-foreign'
  const negatives = [
    { name: 'wrong_source', value: { ...requests.fact, fact: { ...requests.fact.fact, source: 'foreign-source' } }, producer, expect: 'identity_mismatch' },
    { name: 'wrong_attempt', value: { ...requests.write, command: { ...requests.write.command, attemptId: 'attempt-foreign' } }, producer, expect: 'identity_mismatch' },
    { name: 'fact_correlation_mismatch', value: { ...requests.fact, id: 'other-id' }, producer, expect: 'protocol_error' },
    { name: 'payload_correlation_mismatch', value: { ...requests.payload, id: 'other-id' }, producer, expect: 'protocol_error' },
    { name: 'wrong_protocol', value: { ...requests.fact, v: 2 }, producer, expect: 'protocol_error' },
    { name: 'missing_id', value: { v: 1, type: 'fact', fact: requests.fact.fact }, producer, expect: 'protocol_error' },
    { name: 'extra_field', value: { ...requests.fact, extra: true }, producer, expect: 'protocol_error' },
    { name: 'begin_write_intent', value: { v: 1, type: 'native-write-intent', id: makeCommand('begin').id, command: makeCommand('begin') }, producer, expect: 'protocol_error' },
    { name: 'foreign_producer', value: requests.fact, producer: foreignAttempt, expect: 'identity_mismatch' },
  ]
  const results = negatives.map((entry) => {
    let refused = false
    try { parseCoordinatorChannelRequest(entry.value, entry.producer) } catch { refused = true }
    return { name: entry.name, expected: entry.expect, refused, value: entry.value, producer: entry.producer, sends: 0, executes: 0 }
  })

  const replyNegatives = [
    { name: 'reply_fact_mismatch', value: { ...replies.receipt, id: 'other-id', factId: 'other-id' } },
    { name: 'receipt_fact_mismatch', value: { ...replies.receipt, receipt: { ...replies.receipt.receipt, factId: 'other-fact' } } },
    { name: 'receipt_not_persisted', value: { ...replies.receipt, receipt: { ...replies.receipt.receipt, persisted: false } } },
    { name: 'payload_correlation_mismatch', value: { ...replies.payload, id: 'other' } },
    { name: 'ack_mismatch', value: { ...replies.ackFailed, id: 'other-request', factId: 'other-fact' } },
  ].map((entry) => ({ name: entry.name, refused: CoordinatorChannelReplySchema.safeParse(entry.value).success === false, value: entry.value, sends: 0, executes: 0 }))

  const limits = CoordinatorChannelLimitsSchema.parse({
    maxPendingFacts: 64, maxPendingPayloads: 16, maxPendingWrites: 8, maxPendingBytes: 1024 * 1024,
    maxPayloadBytes: 256 * 1024, requestTimeoutMs: 5000, maxSettledRequests: 256,
  })
  return {
    protocol: 'channel-frames/1', producer, requests, replies, positives, negatives: results, replyNegatives, limits,
    contractScenarios: contractScenarios(),
    contractSurface: 'NOT_REACHED (I attach-channel implementation not present in this checkout)',
    allNegativesRefused: [...results, ...replyNegatives].every((entry) => entry.refused),
    sends: 0, executes: 0,
  }
}
