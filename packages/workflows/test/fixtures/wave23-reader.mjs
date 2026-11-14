/** Wave-24 A2: independent Node PID reads the original subject using an independent expectation. */
import { readFileSync } from 'node:fs'
import { ProductStore } from '../../../../packages/storage/dist/index.js'
import { verifyDataManifest } from '../../../../packages/workflows/dist/index.js'

const [databasePath, manifestPath, expectationPath] = process.argv.slice(2)
if (!databasePath || !manifestPath || !expectationPath) throw new Error('Usage: wave23-reader.mjs <db> <manifest> <expectation>')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const expectation = JSON.parse(readFileSync(expectationPath, 'utf8'))
const store = new ProductStore({ path: databasePath })
try {
  const verification = await verifyDataManifest(store, manifest, expectation)
  const binding = store.bindings.binding(expectation.attemptId)
  const current = store.bindings.current(expectation.ticketId)
  const question = store.product.questions.get(expectation.questionId)
  const answer = store.answers.get(expectation.answerId)
  const observations = store.observations.forAttempt(expectation.attemptId)
  console.log(JSON.stringify({ pid: process.pid, verification,
    binding: binding ? { attemptId: binding.attemptId, ticketId: binding.ticketId, assignmentId: binding.assignmentId,
      fenceEpoch: binding.fenceEpoch, contract: binding.contract, runnerIdentityRef: binding.runnerIdentityRef } : null,
    currentAttemptId: current?.attemptId ?? null,
    question: question ? { id: question.id, version: question.version, validity: question.validity } : null,
    answer: answer ? { id: expectation.answerId, questionId: answer.questionId, digest: answer.digest } : null,
    deliveries: store.answers.deliveries(expectation.answerId).map(value => ({ targetBindingId: value.targetBindingId, status: value.status })),
    observations: observations.map(row => ({ factId: row.factId, kind: row.kind, payloadRef: row.payloadRef, payloadSha256: row.payloadSha256 })),
    dispatch: expectation.requiredDispatch.map(value => store.dispatch.get(value.commandId, value.target)),
    sourceFingerprint: store.workflows.recoverySource.inspect().sourceFingerprint,
  }))
} finally { store.close() }
