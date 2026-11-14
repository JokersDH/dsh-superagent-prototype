#!/usr/bin/env node
/**
 * Wave-17 B1/B2: the real product vertical completes the preparation contract and begins.
 *
 * Wave-16 stopped at prepared rows with no begin: the `codex-fake` lane selected CodexNativeDriver,
 * which never emits `policy.prepared`, and it disabled eager preparation, while main's
 * NativeProductAttempt waits for exactly that fact before feeding begin.
 *
 * The fix is on the B side and keeps every main guard: the ORIGINAL CodexProductDriver still runs, and
 * it is given a real B-owned fake executable that answers the version and app-server protocol. So
 * policy.prepared is produced by the driver that actually performs preparation, begin follows, and the
 * facts land in A's store through the product sink. No installed Codex is executed.
 *
 * Usage: node tests/native-acceptance/b17-product-native.mjs [--record]
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { ProductStore } from '../../packages/storage/src/index.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry, ensureStarterProject } from '../../apps/coordinator/product/project-registry.ts'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const fakeExecutable = fileURLToPath(new URL('./fixtures/fake-codex-producer.mjs', import.meta.url))

const principal = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
const actor = { ...principal, source: 'local_cli' }
const NATIVE_PROFILE_ID = 'profile-native-fake'

async function until(read, predicate, timeout = 40_000) {
  const deadline = Date.now() + timeout
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`condition timed out: ${JSON.stringify(latest)?.slice(0, 2500)}`)
}

const root = mkdtempSync(join(tmpdir(), 'pa-w17-b1-'))
const stateRoot = join(root, 'state')
const scratchProject = join(root, 'project')
const receiverLog = join(root, 'receiver.jsonl')
let store
let product
try {
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 })
  ensureStarterProject(scratchProject)
  const registry = new NativeProjectRegistry(stateRoot)
  const record = registry.prepare({ path: scratchProject, displayName: 'B17 scratch', check: 'node_test' })
  registry.save(record)

  // The product's own preparation handshake needs the production driver, which in turn spawns this
  // profile's executable. Pointing it at the B-owned fake keeps every guard intact while executing no
  // installed agent.
  const profile = {
    id: NATIVE_PROFILE_ID,
    revision: 1,
    driverId: 'codex-native',
    driverApiMajor: 1,
    driverRelease: 'fake-executable-lane',
    executable: process.execPath,
    argv: [fakeExecutable],
    expectedVersion: '0.164.0',
    nativeConfigRef: 'native-config-fake',
    permissionPolicyRevision: 'permission-fake-1',
    requiredFeatures: [],
  }

  store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  product = createProductRuntime({
    store,
    principal,
    stateRoot,
    scratchProject,
    actionSecret: Buffer.alloc(32, 1),
    projectRegistry: registry,
    projects: registry.list().map(project => ({ id: project.id, displayName: project.displayName, scope: registry.scope(project) })),
    native: {
      profile,
      projects: registry.list().map(project => ({ id: project.id, path: project.path, check: registry.check(project) })),
      approvalPolicy: 'on-request',
    },
  })
  process.env.PA_RUNNER_RECEIVER_LOG = receiverLog
  const producerLog = join(root, 'producer.jsonl')
  process.env.PA_PRODUCER_LOG = producerLog
  // Keep the turn live after the approval so the stop assertion exercises a real interruption.
  process.env.PA_PRODUCER_HOLD = '1'

  let seq = 0
  const command = value => product.application.dispatch(
    { commandId: `w17-command-${++seq}`, conversationId: 'conversation-product', ...value },
    actor,
  )
  const count = name => { try { return Number(store.db.prepare(`SELECT COUNT(*) AS n FROM ${name}`).get().n) } catch { return null } }
  const tables = () => ({
    works: count('works'), tickets: count('ticket'), links: count('ticket_links'),
    questions: count('user_questions'), deliveries: count('answer_deliveries'),
    facts: count('fact_receipts'), payloads: count('ingress_payloads'),
    bindings: count('runtime_bindings'), dispatch: count('dispatch_receipts'), events: count('event_log'),
  })
  const producerMethods = () => existsSync(producerLog)
    ? readFileSync(producerLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line).method)
    : []
  const received = () => existsSync(receiverLog)
    ? readFileSync(receiverLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : []

  const criteria = [
    { id: 'criterion-output', kind: 'machine', required: true, description: 'Registered project check passes', checkDefinitionRef: registry.check(record).id },
    { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' },
  ]

  log.begin('B27-ACK-SAME-WORK-AND-QUESTION', 'the product lane reaches one Work and a real Broker question', 'controlled_process')
  product.start()
  const created = await command({
    kind: 'create_work',
    projectId: record.id,
    goal: 'Count the begin/answer acknowledgement windows on the original chain',
    profileId: NATIVE_PROFILE_ID,
    scope: registry.scope(record),
    criteria,
  })
  const seen = await until(
    async () => ({ frames: received(), tables: tables(), questions: (await product.application.inspect({})).questions }),
    value => value.questions.length >= 1,
  )
  const question = seen.questions[0]
  const begins = seen.frames.filter(frame => frame.kind === 'begin')
  const attemptId = begins[0]?.attemptId ?? null
  log.evidence({ workId: created.workId, attemptId, questionId: question?.id ?? null, beginFrames: begins.length })
  if (question && begins.length === 1) log.pass(`one Work ${created.workId} reached attempt ${attemptId} with Broker question ${question.id}`)
  else log.fail(`the product lane did not reach one Work and a question: ${JSON.stringify({ question: question?.id ?? null, begins: begins.length })}`)

  log.begin('B27-ACK-BEGIN-RECEIVED-ONCE', 'the writer actually received begin exactly once', 'controlled_process')
  const receivedBegins = received().filter(frame => frame.kind === 'begin')
  log.evidence({ receiverBeginCount: receivedBegins.length, ids: receivedBegins.map(frame => frame.id) })
  if (receivedBegins.length === 1) log.pass(`the receiver log records exactly one begin (${receivedBegins[0].id}) at epoch ${receivedBegins[0].fenceEpoch}`)
  else log.fail(`the receiver recorded ${receivedBegins.length} begins: ${JSON.stringify(receivedBegins)}`)

  log.begin('B27-ACK-ANSWER-WINDOW', 'the answer is written once and received once', 'controlled_process')
  let answered = null, answerError = null
  try {
    answered = await command({
      kind: 'answer_question',
      questionId: question.id,
      expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: [question.presentation?.options?.[0]?.id ?? 'accept'] },
    })
  } catch (error) { answerError = String(error?.message ?? error).slice(0, 200) }
  const afterAnswer = await until(
    async () => ({ frames: received(), tables: tables() }),
    value => value.frames.some(frame => frame.kind === 'answer'),
    15_000,
  ).catch(() => ({ frames: received(), tables: tables() }))
  const answerFrames = afterAnswer.frames.filter(frame => frame.kind === 'answer')
  const receipts = (() => { try { return Number(store.db.prepare('SELECT COUNT(*) AS n FROM fact_receipts').get().n) } catch { return null } })()
  log.evidence({ status: answered?.status ?? null, answerError, receiverAnswerCount: answerFrames.length, answerIds: answerFrames.map(frame => frame.id), receipts })
  if (answered?.status === 'recorded' && answerFrames.length === 1) log.pass(`the answer was recorded and the writer received it exactly once (${answerFrames[0].id}) with ${receipts} durable fact receipt(s)`)
  else log.fail(`the answer window is not counted: ${JSON.stringify({ status: answered?.status ?? null, answerError, count: answerFrames.length })}`)

  log.begin('B27-ACK-NO-RESEND-AFTER-RECEIPT', 'no command is resent once its receipt exists', 'controlled_process')
  const later = received()
  const beginAgain = later.filter(frame => frame.kind === 'begin').length
  const answerAgain = later.filter(frame => frame.kind === 'answer').length
  log.evidence({ beginAgain, answerAgain, totalFrames: later.length })
  if (beginAgain === 1 && answerAgain === 1) log.pass('after the receipts existed the receiver still shows exactly one begin and one answer, so nothing was resent in the bounded window')
  else log.fail(`a command was resent: ${JSON.stringify({ beginAgain, answerAgain })}`)

  log.begin('B27-ACK-SAME-QUESTION-AND-ATTEMPT', 'the question, answer and binding stay on one attempt', 'controlled_process')
  const ticketId = (() => { try { return store.db.prepare('SELECT id FROM ticket LIMIT 1').get().id } catch { return null } })()
  const binding = ticketId ? store.bindings.current(String(ticketId)) : null
  // The pending-question projection empties once the question is answered, so the durable rows are what
  // prove the chain stayed on one question and one attempt.
  const durable = (() => { try { return store.db.prepare('SELECT id FROM user_questions').all().map(row => String(row.id)) } catch { return [] } })()
  const pendingCount = (await product.application.inspect({})).questions.length
  log.evidence({ attemptId, bindingAttempt: binding?.attemptId ?? null, durableQuestions: durable, pendingCount })
  if (String(binding?.attemptId) === String(attemptId) && durable.length === 1 && durable[0] === question.id) {
    log.pass(`the same question ${question.id} and attempt ${attemptId} carry the answer and the binding, with no second question created`)
  } else log.fail(`the chain split: ${JSON.stringify({ attemptId, binding: binding?.attemptId ?? null, durable, pendingCount })}`)

  log.begin('B27-SCOPE-NOT-NATIVE', 'fake executable lane; installed Codex not executed', 'controlled_process')
  log.evidence({ driver: 'CodexProductDriver (unmodified)', executable: 'B-owned fake app-server process', installedCodexExecuted: false })
  log.notTested('an installed Codex was not executed and no gateway was contacted')
  log.notTested('the four ACK windows are counted from the receiver log and durable receipts; the recovery path, current candidate, explicit human accept and 2/4 slots are not covered here')
} finally {
  try { await product?.close() } catch {}
  try { store?.close() } catch {}
  delete process.env.PA_RUNNER_RECEIVER_LOG
  delete process.env.PA_PRODUCER_LOG
  delete process.env.PA_PRODUCER_HOLD
  rmSync(root, { recursive: true, force: true })
}

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-27 ACK window counting on the product lane', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'fake executable lane; native NOT_TESTED' } },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b18-product-normal.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(30)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB27-ack totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
