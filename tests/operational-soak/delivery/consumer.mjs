/**
 * Original ProductCompletion/candidate/accept/slot consumer.
 *
 * It uses the same admitted controlled-fixture ProductRuntime/QuestionBroker/A Store/Verifier path as
 * the main product-execution test: original Work/contract/question/answer/native_applied, registered
 * machine check, currentCandidate, explicit accept_candidate and delivered artifacts. It also observes
 * 2 and 4 concurrent works to record attempt/queue/resource facts; the native 2/4 slot resource set is
 * NOT_REACHED because this fixture has no slot-cap configuration.
 *
 * Zero model/vendor/native: the executor is the fixed local Node check; no signals are sent.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'

const PRINCIPAL = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
const ACTOR = { ...PRINCIPAL, source: 'local_cli' }
const SCOPE = { projectId: 'project-scratch', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const CRITERIA = [
  { id: 'criterion-output', kind: 'machine', required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
]

async function until(read, predicate, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Delivery consumer timed out: ${JSON.stringify(latest).slice(0, 500)}`)
}

function prepareProject(root) {
  const stateRoot = join(root, 'state')
  const scratchProject = join(root, 'project')
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  mkdirSync(scratchProject, { recursive: true, mode: 0o700 })
  const git = (args) => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
  git(['init', '-q'])
  mkdirSync(join(scratchProject, 'src'))
  writeFileSync(join(scratchProject, 'src', '.gitkeep'), '')
  git(['add', 'src/.gitkeep'])
  git(['-c', 'user.name=Delivery Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Delivery fixture base'])
  return { stateRoot, scratchProject }
}

function framesOf(stateRoot) {
  try {
    return readdirSync(join(stateRoot, 'receipts')).flatMap((file) =>
      readFileSync(join(stateRoot, 'receipts', file), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)))
  } catch { return [] }
}

function makeRuntime({ root, human }) {
  const { stateRoot, scratchProject } = prepareProject(root)
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createControlledProduct({ store, principal: PRINCIPAL, projects: [{ id: SCOPE.projectId, scope: SCOPE }], actionSecret: Buffer.alloc(32, 1), stateRoot, scratchProject })
  let seq = 0
  const command = (value) => product.application.dispatch({ commandId: `delivery-command-${++seq}`, conversationId: 'delivery-conversation', ...value }, ACTOR)
  return {
    root, stateRoot, scratchProject, store, product, command,
    criteria: human ? [...CRITERIA, { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' }] : CRITERIA,
    async close() { try { await product.close() } finally { store.close() } },
  }
}

async function createAndAnswer(h, { human, accept }) {
  h.product.start()
  const created = await h.command({ kind: 'create_work', projectId: SCOPE.projectId, goal: 'Produce the controlled scratch artifact', profileId: 'profile-fixture-question', scope: SCOPE, criteria: h.criteria })
  if (created.status !== 'recorded') throw new Error(`create_work not recorded: ${JSON.stringify(created).slice(0, 300)}`)
  let question = null
  let answerBody = null
  let answerReceipt = null
  if (human) {
    const waiting = await until(() => h.product.application.inspect({}), (value) => value.questions.some((entry) => entry.contract.workId === created.workId))
    question = waiting.questions.find((entry) => entry.contract.workId === created.workId)
    answerBody = { commandId: 'delivery-answer-normal', conversationId: 'delivery-conversation', kind: 'answer_question', questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['allow'] } }
    const answered = await h.product.application.dispatch(answerBody, ACTOR)
    if (answered.status !== 'recorded') throw new Error(`answer not recorded: ${JSON.stringify(answered).slice(0, 300)}`)
    answerReceipt = answered
  }
  const ready = await until(
    async () => (await h.product.application.inspect({ workId: created.workId })).works[0],
    (view) => human ? view?.actions.available.includes('accept_candidate') : view?.phase === 'delivered',
  )
  const deliveries = question === null ? [] : h.product.application.questions.currentDeliveries(question.id)
  let accepted = null
  let wrongCandidate = null
  let delivered = ready
  if (accept) {
    const candidate = ready.actions.currentCandidate
    wrongCandidate = await h.command({ kind: 'accept_candidate', candidate: { ...candidate, candidateGeneration: candidate.candidateGeneration + 1 } })
    accepted = await h.command({ kind: 'accept_candidate', candidate })
    delivered = await until(
      async () => (await h.product.application.inspect({ workId: created.workId })).works[0],
      (view) => view?.phase === 'delivered',
    )
  }
  let answerReplay = null
  let answerConflict = null
  if (answerBody !== null) {
    answerReplay = await h.product.application.dispatch(answerBody, ACTOR)
    answerConflict = await h.product.application.dispatch({ ...answerBody, commandId: 'delivery-answer-conflict', expectedVersion: answerBody.expectedVersion + 1 }, ACTOR)
  }
  return { created, question, ready, accepted, wrongCandidate, delivered, deliveries, answerReceipt, answerReplay, answerConflict }
}

export async function runDeliveryConsumer({ root }) {
  const report = {
    protocol: 'delivery-consumer/1',
    surface: 'original controlled ProductRuntime/Application/QuestionBroker/A Store/Verifier/ProductCompletion',
    executor: 'controlled_fixture (fixed local Node check)',
    modelCalls: 0, vendorTurns: 0, signalsSent: 0,
    normal: null, doubleAccept: null, slots: {},
    notReached: [
      'native vendor execution / native compatibility',
      'recovered Work candidate/accept after a real B/I channel rebind',
      'native 2/4 slot resource set (no slot-cap configuration in this fixture)',
    ],
  }
  const roots = []
  try {
    // 1. full normal human acceptance: question -> answer -> candidate -> manual accept -> delivered.
    const normalRoot = join(root, 'normal')
    roots.push(normalRoot)
    const h = makeRuntime({ root: normalRoot, human: true })
    try {
      const result = await createAndAnswer(h, { human: true, accept: true })
      report.normal = {
        workId: result.created.workId,
        workViewId: result.ready.work.id,
        phaseBeforeAccept: result.ready.phase,
        phaseAfterAccept: result.delivered.phase,
        questionId: result.question.id,
        questionVersion: result.question.version,
        targetAttemptId: result.question.targets[0].attemptId,
        answerDelivery: result.deliveries[0]?.status ?? null,
        currentCandidate: result.ready.actions.currentCandidate,
        acceptedStatus: result.accepted.status,
        wrongCandidateStatus: result.wrongCandidate.status,
        wrongCandidateError: result.wrongCandidate.error?.code ?? null,
        artifactIds: result.delivered.artifactIds,
        artifactCount: result.delivered.artifactIds.length,
        resourceStatus: result.delivered.resourceStatus,
        beginFrames: framesOf(h.stateRoot).filter((frame) => frame.type === 'begin').length,
        answerFrames: framesOf(h.stateRoot).filter((frame) => frame.type === 'answer').length,
        queueDue: h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length,
        answerReceiptStatus: result.answerReceipt?.status ?? null,
        answerReplaySame: JSON.stringify(result.answerReplay) === JSON.stringify(result.answerReceipt),
        answerConflictStatus: result.answerConflict?.status ?? null,
        answerConflictError: result.answerConflict?.error?.code ?? null,
      }
    } finally { await h.close() }
  } finally {
    for (const path of roots) { /* fixture material stays under the caller's output root */ void path }
  }

  // 2. duplicate accept is idempotent (same original command returns the same recorded receipt).
  {
    const doubleRoot = join(root, 'double-accept')
    const h = makeRuntime({ root: doubleRoot, human: true })
    try {
      const result = await createAndAnswer(h, { human: true, accept: false })
      const candidate = result.ready.actions.currentCandidate
      const commandId = 'delivery-double-accept'
      const first = await h.product.application.dispatch({ commandId, conversationId: 'delivery-conversation', kind: 'accept_candidate', candidate }, ACTOR)
      const second = await h.product.application.dispatch({ commandId, conversationId: 'delivery-conversation', kind: 'accept_candidate', candidate }, ACTOR)
      report.doubleAccept = { first: first.status, second: second.status, sameReceipt: JSON.stringify(first) === JSON.stringify(second) }
    } finally { await h.close() }
    rmSync(doubleRoot, { recursive: true, force: true })
  }

  // 2b. begin replay: the same create_work command id returns the same original Work, not a second one.
  {
    const beginRoot = join(root, 'begin-replay')
    const h = makeRuntime({ root: beginRoot, human: false })
    try {
      h.product.start()
      const commandId = 'delivery-begin-replay'
      const body = { commandId, conversationId: 'delivery-conversation', kind: 'create_work', projectId: SCOPE.projectId, goal: 'Begin replay fixture', profileId: 'profile-fixture-pass', scope: SCOPE, criteria: CRITERIA }
      const first = await h.product.application.dispatch(body, ACTOR)
      const second = await h.product.application.dispatch(body, ACTOR)
      const works = (await h.product.application.inspect({})).works
      report.beginReplay = { first: first.status, second: second.status, sameReceipt: JSON.stringify(first) === JSON.stringify(second), workCount: works.length, sameWork: first.workId === second.workId }
    } finally { await h.close() }
    rmSync(beginRoot, { recursive: true, force: true })
  }

  // 3. 2 and 4 concurrent controlled works: attempt frames, queue, resource state per WorkView.work.id.
  for (const count of [2, 4]) {
    const slotRoot = join(root, `slots-${count}`)
    const h = makeRuntime({ root: slotRoot, human: false })
    try {
      h.product.start()
      const works = []
      for (let index = 0; index < count; index += 1) {
        const created = await h.command({ kind: 'create_work', projectId: SCOPE.projectId, goal: `Controlled slot work ${index}`, profileId: 'profile-fixture-pass', scope: SCOPE, criteria: CRITERIA })
        works.push(created.workId)
      }
      const delivered = []
      for (const workId of works) {
        const ready = await until(async () => (await h.product.application.inspect({ workId })).works[0], (view) => view?.actions.available.includes('accept_candidate'))
        const accepted = await h.command({ kind: 'accept_candidate', candidate: ready.actions.currentCandidate })
        if (accepted.status !== 'recorded') throw new Error(`slot accept not recorded: ${JSON.stringify(accepted).slice(0, 200)}`)
        delivered.push(await until(async () => (await h.product.application.inspect({ workId })).works[0], (view) => view?.phase === 'delivered'))
      }
      const beginFrames = framesOf(h.stateRoot).filter((frame) => frame.type === 'begin')
      report.slots[count] = {
        works: works.length,
        delivered: delivered.filter((view) => view.phase === 'delivered').length,
        workViewIdsMatch: delivered.every((view, index) => view.work.id === works[index]),
        artifactCounts: delivered.map((view) => view.artifactIds.length),
        resourceStatuses: delivered.map((view) => view.resourceStatus),
        beginFrames: beginFrames.length,
        uniqueAttemptIds: null,
        queueDue: h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length,
        slotCapObserved: 'not_configurable_in_fixture',
        attemptIdentityNote: 'begin frame count is observed; the receipt projection carries no attemptId, so unique attempt identity is unknown',
      }
    } finally { await h.close() }
    rmSync(slotRoot, { recursive: true, force: true })
  }

  report.checks = {
    normalAnswered: report.normal?.answerDelivery === 'native_applied',
    normalCandidate: report.normal?.currentCandidate !== null && report.normal?.currentCandidate !== undefined,
    normalAccepted: report.normal?.acceptedStatus === 'recorded',
    wrongCandidateRefused: report.normal?.wrongCandidateStatus === 'rejected',
    delivered: report.normal?.phaseAfterAccept === 'delivered' && report.normal.artifactCount > 0,
    workViewIdentity: report.normal?.workViewId === report.normal?.workId,
    duplicateAcceptIdempotent: report.doubleAccept?.first === 'recorded' && report.doubleAccept?.second === 'recorded' && report.doubleAccept?.sameReceipt === true,
    slots2: report.slots['2']?.delivered === 2 && report.slots['2']?.workViewIdsMatch === true,
    slots4: report.slots['4']?.delivered === 4 && report.slots['4']?.workViewIdsMatch === true,
    answerReplayIdempotent: report.normal?.answerReplaySame === true,
    answerConflictRejected: report.normal?.answerConflictStatus === 'rejected',
    beginReplayIdempotent: report.beginReplay?.first === 'recorded' && report.beginReplay?.sameWork === true && report.beginReplay?.workCount === 1,
  }
  return report
}
