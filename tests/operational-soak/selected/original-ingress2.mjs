/**
 * Wave-30 H2 original-authority readback consumer.
 *
 * Produces one controlled zero-model Work through the product's own composition root
 * (`createControlledProduct` -> Application/QuestionBroker/A Store), then reads the original persisted
 * Work/question/answer/delivery/command-receipt rows back through the public ProductStore API. The
 * fixture executor is a fixed local Node script; there is no model, vendor CLI, native profile,
 * credential or signal. Data is fixture scope, not product recovery or release authority.
 */
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { produceNormalChain } from '../recovery/normal-chain.mjs'

export async function runOriginalIngress({ root }) {
  const produced = await produceNormalChain({ root })
  const store = new ProductStore({ path: join(root, 'state', 'state.sqlite'), artifactsRoot: join(root, 'state', 'artifacts') })
  try {
    const work = store.product.works.get(produced.work.id)
    const question = store.product.questions.get(produced.question.id)
    const answer = store.answers.get(produced.answer.answerId)
    const deliveries = store.answers.deliveries(produced.answer.answerId)
    const command = store.commands.get(produced.answer.commandId)
    const factRows = deliveries.map((delivery) => ({ targetBindingId: delivery.targetBindingId, status: delivery.status }))
    const checks = {
      workPersisted: work !== undefined && work.id === produced.work.id && work.projectId === produced.work.projectId,
      questionPersisted: question !== undefined && question.id === produced.question.id && question.version >= produced.question.version && question.validity === 'answered',
      answerPersisted: answer !== undefined && answer.questionId === produced.question.id && answer.expectedVersion === produced.question.version,
      commandReceipt: command !== undefined && command.status === 'recorded',
      nativeApplied: deliveries.length > 0 && deliveries.every((delivery) => delivery.status === 'native_applied'),
      attemptBound: produced.attempt.attemptId.length > 0 && produced.question.target.attemptId === produced.attempt.attemptId,
      contractStable: produced.work.contract.digest === produced.attempt.contract.digest,
      modelCalls0: produced.modelCalls === 0 && produced.vendorTurns === 0,
    }
    return {
      protocol: 'original-ingress-readback/1',
      surface: 'controlled ProductRuntime/Application/QuestionBroker + original A ProductStore public readers',
      executor: produced.executor,
      modelCalls: produced.modelCalls,
      vendorTurns: produced.vendorTurns,
      workId: produced.work.id,
      questionId: produced.question.id,
      answerId: produced.answer.answerId,
      commandId: produced.answer.commandId,
      attemptId: produced.attempt.attemptId,
      contract: produced.attempt.contract,
      work,
      question: { id: question?.id, version: question?.version, validity: question?.validity },
      answer,
      deliveries: factRows,
      checks,
      // The current B sink writes runner facts through ProductStore.facts, not the business
      // question/answer ingress. Joining B callbacks to this exact answer is not implemented.
      businessIngressJoin: 'NOT_REACHED: current B sink records runner facts; the question/answer rows above come from the original Application/QuestionBroker fixture path.',
    }
  } finally {
    try { store.close() } catch { /* read-only projection; keep primary result */ }
  }
}
