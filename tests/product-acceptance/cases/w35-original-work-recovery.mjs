import { notTested } from '../lib/status.mjs'

/**
 * Wave-35 E8: original Work recovery consumer.
 *
 * main 23d5a98e publishes the original NativeProductAttempt callbacks, but no product consumer resumes
 * an original Work from an actual fault through the original Broker/queue. A callback source or a
 * channel slot is not a recovered positive; this stays an explicit gap with the exact inputs needed.
 */
const INPUTS = [
  'published original attachRunnerAttempt consumer in main wired to a real recovered attempt',
  'original Work/Ticket/Assignment/epoch/contract identities for the faulted run',
  'B/I quarantined terminal lease and unknown-send disposition (no resend) with original command receipts',
  'original QuestionBroker answer/check/candidate/manual-accept path for the same Work',
  'original scheduler slot return for the 2/4 resources with full birth/identity facts',
]
const NEGATIVES = [
  'an unknown native send is reconciled before any retry, never resent with a new identity',
  'a foreign epoch/source or a late fact cannot write into the current attempt',
  'a terminal lease cannot be re-used without a fresh original authorization',
  'a new Work/Ticket cannot substitute for the original Work ids',
]
export async function runOriginalWorkRecovery() {
  return {
    cases: [notTested({ id: 'E8-ORIGINAL-WORK-RECOVERY',
      title: 'An original faulted Work resumes through the original Store/Broker/question/candidate/accept path',
      layer: 'installed', evidence: { originalWorkRecovery: {
        status: 'NOT_REACHED', reason: 'no product consumer resumes an original Work from a fault',
        sourcePresent: 'main 23d5a98e original callbacks/port source only',
        missingInputs: INPUTS, plannedNegatives: NEGATIVES,
        notSubstitutes: 'callbacks source, channel module slots, receipt-only coordinator, JSON registry or a new normal work',
      } } }, `NOT_TESTED: no published main/B/I consumer rescues an original faulted Work into the original Broker/queue. Required inputs: ${INPUTS.join('; ')}. Planned negatives: ${NEGATIVES.join('; ')}. A callback source, channel slot or receipt-only row is not a recovered positive; this remains an explicit gap and does not block installed/data/support work.`)],
    artifacts: {},
  }
}
