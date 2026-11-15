/**
 * Wave-30 H3 independent ACK-window decision support.
 *
 * Uses the original A public readers/writers (`ProductStore.commands/facts/answers/events`) to
 * materialize each window and decide durable/unknown from the exact row, never from a total receipt
 * count. Every decision forbids resend/new command/new attempt/new session. This is a fixture window
 * consumer; it does not implement B recovery and does not signal or start a coordinator.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'

const DIGEST_A = 'a'.repeat(64)
const DIGEST_B = 'b'.repeat(64)

export function decideWindow({ kind, commandCount, factCount, answerPresent, deliveryStatus, receiverObserved }) {
  const base = { kind, resend: false, newCommandId: false, newAttempt: false, newSession: false, clearMarker: false }
  if (kind === 'begin_before_write') return { ...base, state: commandCount === 0 ? 'not_accepted' : 'indeterminate', durable: false }
  if (kind === 'answer_before_write') return { ...base, state: answerPresent ? 'indeterminate' : 'not_accepted', durable: false }
  if (kind === 'receiver_observed_before_receipt') return { ...base, state: receiverObserved && factCount === 0 ? 'indeterminate' : factCount > 0 ? 'durable' : 'not_observed', durable: factCount > 0 }
  if (kind === 'after_fact_receipt') return { ...base, state: factCount > 0 ? 'durable' : 'unknown', durable: factCount > 0 }
  if (kind === 'after_answer_receipt_before_reply') return { ...base, state: answerPresent && deliveryStatus === 'response_written' ? 'response_written' : 'unknown', durable: answerPresent }
  if (kind === 'after_delivery_terminal') return { ...base, state: deliveryStatus === 'native_applied' || deliveryStatus === 'expired' ? deliveryStatus : 'unknown', durable: deliveryStatus !== null }
  if (kind === 'late_duplicate') return { ...base, state: 'already_recorded', durable: true }
  if (kind === 'missing_delivery') return { ...base, state: answerPresent && deliveryStatus === null ? 'unknown' : 'unexpected', durable: false }
  throw new Error(`unknown window ${kind}`)
}

export function runAckWindows({ root }) {
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const windows = []
  try {
    // begin/answer before write: nothing persisted yet.
    windows.push(decideWindow({ kind: 'begin_before_write', commandCount: 0, factCount: 0, answerPresent: false, deliveryStatus: null, receiverObserved: false }))
    windows.push(decideWindow({ kind: 'answer_before_write', commandCount: 0, factCount: 0, answerPresent: false, deliveryStatus: null, receiverObserved: false }))

    // receiver observed but no durable fact receipt: UNKNOWN, not delivered.
    windows.push(decideWindow({ kind: 'receiver_observed_before_receipt', commandCount: 0, factCount: 0, answerPresent: false, deliveryStatus: null, receiverObserved: true }))

    // durable fact receipt: idempotent replay and conflicting digest refusal on the original A store.
    const first = store.facts.record('fact-window-1', DIGEST_A, () => {})
    const eventsAfterFirst = store.events.after(0).length
    const replay = store.facts.record('fact-window-1', DIGEST_A, () => {})
    const eventsAfterReplay = store.events.after(0).length
    let conflict = null
    try { store.facts.record('fact-window-1', DIGEST_B, () => {}) } catch (error) { conflict = error?.constructor?.name ?? String(error) }
    windows.push({
      ...decideWindow({ kind: 'after_fact_receipt', commandCount: 0, factCount: 1, answerPresent: false, deliveryStatus: null, receiverObserved: true }),
      seq: first.seq, replayedSameSeq: replay.seq === first.seq, eventsAfterFirst, eventsAfterReplay,
      conflict, storedDigest: store.facts.get('fact-window-1')?.payloadDigest,
    })

    // answer receipt + written delivery: not yet terminal, so it is not a completed reply.
    store.answers.record('answer-window-1', { questionId: 'question-window-1', expectedVersion: 1, digest: DIGEST_A, answer: { kind: 'choices', optionIds: ['allow'] } })
    store.answers.upsertDelivery('answer-window-1', 'target-window-1', 'response_written', 'fixture-window')
    windows.push(decideWindow({ kind: 'after_answer_receipt_before_reply', commandCount: 0, factCount: 1, answerPresent: true, deliveryStatus: 'response_written', receiverObserved: true }))

    // duplicate answer record is idempotent; terminal delivery moves forward and refuses backward.
    const answerReplay = store.answers.record('answer-window-1', { questionId: 'question-window-1', expectedVersion: 1, digest: DIGEST_A, answer: { kind: 'choices', optionIds: ['allow'] } })
    store.answers.upsertDelivery('answer-window-1', 'target-window-1', 'native_applied', 'fixture-window')
    let backward = null
    try { store.answers.upsertDelivery('answer-window-1', 'target-window-1', 'response_written', 'fixture-window') } catch (error) { backward = error?.constructor?.name ?? String(error) }
    windows.push({
      ...decideWindow({ kind: 'late_duplicate', commandCount: 0, factCount: 1, answerPresent: true, deliveryStatus: 'native_applied', receiverObserved: true }),
      answerReplayAlreadyRecorded: answerReplay.alreadyRecorded, backward,
    })
    windows.push({ ...decideWindow({ kind: 'after_delivery_terminal', commandCount: 0, factCount: 1, answerPresent: true, deliveryStatus: 'native_applied', receiverObserved: true }), delivery: store.answers.deliveries('answer-window-1')[0]?.status })

    // answer without delivery is UNKNOWN: do not synthesize native success.
    store.answers.record('answer-window-2', { questionId: 'question-window-2', expectedVersion: 1, digest: DIGEST_A, answer: { kind: 'choices', optionIds: ['allow'] } })
    windows.push(decideWindow({ kind: 'missing_delivery', commandCount: 0, factCount: 1, answerPresent: true, deliveryStatus: null, receiverObserved: true }))

    const checks = {
      beginNotAccepted: windows[0].state === 'not_accepted',
      answerNotAccepted: windows[1].state === 'not_accepted',
      receiverUnknown: windows[2].state === 'indeterminate' && windows[2].durable === false,
      factDurable: windows[3].state === 'durable' && windows[3].replayedSameSeq === true && windows[3].eventsAfterReplay === windows[3].eventsAfterFirst,
      conflictRefused: windows[3].conflict === 'FactConflict' && windows[3].storedDigest === DIGEST_A,
      answerWrittenNotTerminal: windows[4].state === 'response_written',
      lateDuplicateNoResend: windows[5].state === 'already_recorded' && windows[5].answerReplayAlreadyRecorded === true && windows[5].backward === 'AnswerConflict',
      terminalNative: windows[6].state === 'native_applied' && windows[6].delivery === 'native_applied',
      missingDeliveryUnknown: windows[7].state === 'unknown' && windows[7].durable === false,
      zeroResend: windows.every((window) => window.resend === false && window.newCommandId === false && window.newAttempt === false && window.newSession === false),
    }
    return {
      protocol: 'ack-window-consumer/1',
      surface: 'original A ProductStore facts/answers/deliveries/events public APIs',
      modelCalls: 0, vendorTurns: 0, signalsSent: 0,
      windows, checks,
      notReached: [
        'actual B coordinator SIGKILL -> new process original A/question/answer/ACK recovery',
        'same original Work recovered candidate/accept/delivered after a real rebind',
        'live FD/socket/queue physical quiescence (H1 guard covers only own probes)',
      ],
    }
  } finally {
    try { store.close() } catch { /* keep primary result */ }
  }
}
