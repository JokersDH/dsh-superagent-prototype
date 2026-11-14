/**
 * Public-store datareader for one recovery fixture run. It re-reads the facts through A's public
 * ProductStore collections (`product.works`, `product.questions`, `answers`, `commands`, `events`) —
 * no hand-written SQL, no new table and no receipt-only service — and binds them to `normal.json`.
 * The state root is an owned fixture created by this tool, never a personal state directory.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { readJournalFacts } from './journal.mjs'

function sameAttempt(left, right) {
  return ['ticketId', 'assignmentId', 'attemptId', 'fenceEpoch'].every((field) => String(left?.[field]) === String(right?.[field]))
    && left?.contract?.workId === right?.contract?.workId && left?.contract?.revision === right?.contract?.revision && left?.contract?.digest === right?.contract?.digest
}

export function readChainFacts({ root }) {
  const facts = JSON.parse(readFileSync(join(root, 'normal.json'), 'utf8'))
  const store = new ProductStore({ path: join(root, 'state', 'state.sqlite') })
  try {
    const work = store.product.works.get(facts.work.id)
    const question = store.product.questions.get(facts.question.id)
    const deliveries = store.answers.deliveries(facts.answer.answerId)
    const answerRecord = store.answers.get(facts.answer.answerId)
    const receipt = store.commands.get(facts.answer.commandId)
    const journalPath = join(root, 'journal', 'critical.ndjson')
    const journal = readJournalFacts({ journalPath, expectedSource: facts.factSource, expectedAttempt: facts.attempt })
    const foreign = readJournalFacts({ journalPath, expectedSource: 'foreign-source-wave26', expectedAttempt: facts.attempt })
    const checks = {
      workPresent: work !== undefined,
      workContractMatches: work !== undefined && work.id === facts.work.id && JSON.stringify(work.projectId) === JSON.stringify(facts.work.projectId),
      questionPresent: question !== undefined,
      questionAttemptMatches: question !== undefined && sameAttempt(question.targets?.[0], facts.attempt),
      answerRecorded: answerRecord !== undefined && answerRecord.questionId === facts.question.id,
      answerReceiptRecorded: receipt !== undefined && receipt.status === 'recorded',
      deliveryNativeApplied: deliveries.some((delivery) => delivery.answerId === facts.answer.answerId && delivery.status === 'native_applied'),
      journalAccepted: journal.ok === true && journal.entries === 5,
      foreignSourceRefused: foreign.ok === false && foreign.code === 'foreign_source',
      zeroSends: journal.sends === 0 && foreign.sends === 0,
      zeroModel: facts.modelCalls === 0 && facts.vendorTurns === 0,
    }
    return {
      protocol: 'recovery-chain-read/1',
      ok: Object.values(checks).every(Boolean),
      checks,
      subject: {
        workId: facts.work.id, projectId: facts.work.projectId, phase: facts.work.phase,
        contract: facts.work.contract, attempt: facts.attempt,
        questionId: facts.question.id, answerId: facts.answer.answerId, deliveryStatus: facts.answer.deliveryStatus,
      },
      observed: {
        workPresent: work !== undefined, questionVersion: question?.version ?? null,
        deliveries, receiptStatus: receipt?.status ?? null, journal, foreign,
        eventCount: store.events.after(0).length, queueDue: store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length,
      },
      mode: 'owned_fixture_public_store',
      sends: 0, executes: 0, modelCalls: 0,
    }
  } finally {
    store.close()
  }
}
