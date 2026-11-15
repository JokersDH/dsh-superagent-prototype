/**
 * Wave-31 H3 same-run original A receiver join.
 *
 * Produces one original Work/question/answer through the real Application/QuestionBroker/A Store,
 * then exercises a receiver-side fact subject check and durable fact receipt in the SAME Store using
 * the original attempt tuple. Foreign work/attempt/source/version are refused before any write.
 *
 * The actual B `serveRunner` callback join into this original question/answer is NOT_REACHED: B emits
 * runner facts through its own fixture driver, not the original business ingress. This consumer is
 * the runnable original-authority half, not a substitute for B recovery.
 */
import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { produceNormalChain } from '../recovery/normal-chain.mjs'

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
export const JOIN_SOURCE = 'h31-same-store-receiver'

export function verifyFactSubject({ store, fact, workId, attemptId, expectedVersion }) {
  if (store.product.works.get(fact.contract?.workId) === undefined) return { ok: false, reason: 'foreign_work' }
  if (fact.contract.workId !== workId) return { ok: false, reason: 'work_mismatch' }
  if (fact.attemptId !== attemptId) return { ok: false, reason: 'attempt_mismatch' }
  if (fact.ticketId.length === 0 || fact.assignmentId.length === 0) return { ok: false, reason: 'missing_attempt_member' }
  if (fact.source !== JOIN_SOURCE) return { ok: false, reason: 'foreign_source' }
  if (!Number.isSafeInteger(fact.fenceEpoch) || fact.fenceEpoch < 1) return { ok: false, reason: 'invalid_version' }
  if (expectedVersion !== undefined && fact.contract.revision !== expectedVersion) return { ok: false, reason: 'version_mismatch' }
  return { ok: true }
}

export async function runSameStoreReceiver({ root }) {
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const original = await produceNormalChain({ root })
  const store = new ProductStore({ path: join(root, 'state', 'state.sqlite') })
  const fact = {
    ticketId: original.attempt.ticketId, assignmentId: original.attempt.assignmentId,
    attemptId: original.attempt.attemptId, fenceEpoch: original.attempt.fenceEpoch,
    contract: original.attempt.contract, factId: 'fact-h31-receiver-join', source: JOIN_SOURCE,
    kind: 'turn.ended', payloadRef: 'payload-h31-join',
  }
  const counts = { writes: 0, receipts: 0 }
  const subject = verifyFactSubject({ store, fact, workId: original.work.id, attemptId: original.attempt.attemptId })
  if (!subject.ok) throw new Error(`own subject refused: ${subject.reason}`)
  const receipt = store.facts.record(fact.factId, sha256(JSON.stringify(fact)), () => { counts.writes += 1 })
  counts.receipts += 1
  const persisted = store.facts.get(fact.factId)
  const readback = {
    work: store.product.works.get(original.work.id)?.id ?? null,
    question: store.product.questions.get(original.question.id)?.id ?? null,
    questionVersion: store.product.questions.get(original.question.id)?.version ?? null,
    answer: store.answers.get(original.answer.answerId)?.questionId ?? null,
    delivery: store.answers.deliveries(original.answer.answerId)[0]?.status ?? null,
    command: store.commands.get(original.answer.commandId)?.status ?? null,
    receipt: persisted ?? null,
  }
  const foreignWork = verifyFactSubject({ store, fact: { ...fact, contract: { ...fact.contract, workId: 'foreign-work' } }, workId: original.work.id, attemptId: original.attempt.attemptId })
  const foreignAttempt = verifyFactSubject({ store, fact: { ...fact, attemptId: 'attempt-foreign' }, workId: original.work.id, attemptId: original.attempt.attemptId })
  const foreignSource = verifyFactSubject({ store, fact: { ...fact, source: 'foreign-source' }, workId: original.work.id, attemptId: original.attempt.attemptId })
  const foreignVersion = verifyFactSubject({ store, fact: { ...fact, fenceEpoch: 0 }, workId: original.work.id, attemptId: original.attempt.attemptId })
  const checks = {
    ownSubjectAccepted: subject.ok,
    factDurable: persisted?.seq === receipt.seq && receipt.factId === fact.factId && counts.writes === 1,
    originalWorkReadable: readback.work === original.work.id,
    originalQuestionReadable: readback.question === original.question.id && readback.questionVersion >= original.question.version,
    originalAnswerReadable: readback.answer === original.question.id && readback.delivery === 'native_applied',
    originalCommandReadable: readback.command === 'recorded',
    foreignWorkRefused: foreignWork.reason === 'foreign_work',
    foreignAttemptRefused: foreignAttempt.reason === 'attempt_mismatch',
    foreignSourceRefused: foreignSource.reason === 'foreign_source',
    invalidVersionRefused: foreignVersion.reason === 'invalid_version',
    zeroForeignWrites: counts.writes === 1 && counts.receipts === 1,
  }
  store.close()
  return {
    protocol: 'same-store-receiver/1',
    surface: 'original Application/QuestionBroker/A Store public readers + facts receiver subject check',
    modelCalls: 0, vendorTurns: 0, signalsSent: 0,
    original: { workId: original.work.id, questionId: original.question.id, answerId: original.answer.answerId, commandId: original.answer.commandId, attemptId: original.attempt.attemptId, contract: original.attempt.contract },
    counts, readback, checks,
    bCallbackJoin: 'NOT_REACHED: current B serveRunner fixture facts are not ingested as this original question/answer; no B same-run callback join was executed.',
    businessIngressJoin: 'NOT_REACHED: the durable fact above is an original receiver check on the same Store, not the original answer command path.',
  }
}
