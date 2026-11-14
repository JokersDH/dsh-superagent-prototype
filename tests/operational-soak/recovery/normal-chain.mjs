/**
 * Legal zero-model normal chain for recovery support.
 *
 * It uses the product's own controlled-fixture profile and the original composition root
 * (`createControlledProduct` -> ProductRuntime/Application/QuestionBroker/A Store). The executor is a
 * fixed local Node script (`FIXTURE_CHECK`); there is no model provider, no vendor CLI, no native
 * profile and no credential. The state root and scratch project are new private directories created
 * by the caller.
 *
 * Output is data, not authorization: Work/Attempt/Question/Answer/native_applied facts for B/main to
 * consume in a legal fixture, plus the exact tuple needed to bind a journal or recovery-port recipe.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'

const PRINCIPAL = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
const ACTOR = { ...PRINCIPAL, source: 'local_cli' }
const SCOPE = { projectId: 'project-scratch', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const CRITERIA = [
  { id: 'criterion-output', kind: 'machine', required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' },
]
const FACT_SOURCE = 'fixture-runner-source-wave26'

async function until(read, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Normal chain timed out: ${JSON.stringify(latest).slice(0, 500)}`)
}

function pickAttempt(target) {
  return {
    ticketId: target.ticketId, assignmentId: target.assignmentId, attemptId: target.attemptId,
    fenceEpoch: target.fenceEpoch, contract: target.contract,
  }
}

export async function produceNormalChain({ root }) {
  const stateRoot = join(root, 'state')
  const scratchProject = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 })
  mkdirSync(scratchProject, { mode: 0o700 })
  const git = (args) => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
  git(['init', '-q'])
  mkdirSync(join(scratchProject, 'src'))
  writeFileSync(join(scratchProject, 'src', '.gitkeep'), '')
  git(['add', 'src/.gitkeep'])
  git(['-c', 'user.name=Recovery Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Recovery fixture base'])

  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  let product
  let seq = 0
  try {
    product = createControlledProduct({
      store, principal: PRINCIPAL, projects: [{ id: SCOPE.projectId, scope: SCOPE }],
      actionSecret: Buffer.alloc(32, 1), stateRoot, scratchProject,
    })
    product.start()
    const command = (value) => product.application.dispatch({ commandId: `recovery-command-${++seq}`, conversationId: 'recovery-conversation', ...value }, ACTOR)
    const created = await command({ kind: 'create_work', projectId: SCOPE.projectId, goal: 'Produce the controlled scratch artifact', profileId: 'profile-fixture-question', scope: SCOPE, criteria: CRITERIA })
    if (created.status !== 'recorded') throw new Error(`create_work was not recorded: ${JSON.stringify(created).slice(0, 300)}`)

    const waiting = await until(() => product.application.inspect({}), (value) => value.questions.length === 1)
    const question = waiting.questions[0]
    const answered = await command({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['allow'] } })
    if (answered.status !== 'recorded') throw new Error(`answer_question was not recorded: ${JSON.stringify(answered).slice(0, 300)}`)
    const ready = await until(async () => (await product.application.inspect({ workId: created.workId })).works[0], (view) => view?.actions.available.includes('accept_candidate'))
    const deliveries = product.application.questions.currentDeliveries(question.id)
    if (deliveries.length === 0 || deliveries[0].status !== 'native_applied')
      throw new Error(`Expected a native_applied answer delivery, got ${JSON.stringify(deliveries)}`)

    const attempt = pickAttempt(question.targets[0])
    const facts = {
      protocol: 'recovery-normal-fixture/1',
      producedAt: new Date().toISOString(),
      executor: 'controlled_fixture',
      modelCalls: 0,
      vendorTurns: 0,
      nativeProfile: null,
      stateRoot: 'state',
      projectRoot: 'project',
      factSource: FACT_SOURCE,
      work: {
        id: created.workId, projectId: SCOPE.projectId, phase: ready.phase,
        contract: ready.contract, currentAssignment: ready.actions.currentAssignment ?? null,
        artifactIds: ready.artifactIds, resourceStatus: ready.resourceStatus,
      },
      attempt,
      question: {
        id: question.id, version: question.version, phaseAtOpen: waiting.works[0]?.phase ?? null,
        target: question.targets[0], openQuestionIds: waiting.openQuestionIds,
      },
      answer: {
        commandId: `recovery-command-${seq}`, status: answered.status,
        answerId: deliveries[0].answerId, targetBindingId: deliveries[0].targetBindingId,
        deliveryStatus: deliveries[0].status,
      },
      deliveries,
      queueDue: store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length,
      eventCount: store.events.after(0).length,
    }
    writeFileSync(join(root, 'normal.json'), `${JSON.stringify(facts, null, 2)}\n`, { mode: 0o600 })
    return facts
  } finally {
    try { await product?.close() } catch { /* keep the primary failure */ }
    try { store.close() } catch { /* keep the primary failure */ }
  }
}
