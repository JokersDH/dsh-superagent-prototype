/** Wave-23 A2: independent Node PID reads the original attempt through public stores. */
import { readFileSync } from 'node:fs'
import { ProductStore } from '../../../../packages/storage/dist/index.js'
import { verifyDataManifest } from '../../../../packages/workflows/dist/index.js'

const [databasePath, manifestPath, expectedSource] = process.argv.slice(2)
if (!databasePath || !manifestPath || !expectedSource) throw new Error('Usage: wave23-reader.mjs <db> <manifest> <source-sha>')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const store = new ProductStore({ path: databasePath })
try {
  const verification = await verifyDataManifest(store, manifest, { sourceSha: expectedSource, snapshotFormat: manifest.snapshotFormat })
  const binding = store.bindings.binding(manifest.binding.attemptId)
  const current = store.bindings.current(manifest.binding.ticketId)
  const question = store.product.questions.get(manifest.question.id)
  const answer = store.answers.get(manifest.answer.id)
  const observations = store.observations.forAttempt(manifest.binding.attemptId)
  console.log(JSON.stringify({ pid: process.pid, verification,
    binding: binding ? { attemptId: binding.attemptId, ticketId: binding.ticketId, assignmentId: binding.assignmentId,
      fenceEpoch: binding.fenceEpoch, contract: binding.contract, runnerIdentityRef: binding.runnerIdentityRef } : null,
    currentAttemptId: current?.attemptId ?? null,
    question: question ? { id: question.id, version: question.version, validity: question.validity } : null,
    answer: answer ? { id: manifest.answer.id, questionId: answer.questionId, digest: answer.digest } : null,
    deliveries: store.answers.deliveries(manifest.answer.id).map(value => ({ targetBindingId: value.targetBindingId, status: value.status })),
    observations: observations.map(row => ({ factId: row.factId, kind: row.kind, payloadRef: row.payloadRef, payloadSha256: row.payloadSha256 })),
    dispatch: manifest.dispatch.map(value => store.dispatch.get(value.commandId, value.target)),
    sourceFingerprint: store.workflows.recoverySource.inspect().sourceFingerprint,
  }))
} finally { store.close() }
