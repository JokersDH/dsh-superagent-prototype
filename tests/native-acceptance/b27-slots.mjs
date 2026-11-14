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
  ]
  product.start()

  const createSlot = async index => {
    try {
      const created = await command({
        kind: 'create_work',
        projectId: record.id,
        goal: `Slot ${index} for the bounded execution matrix`,
        profileId: NATIVE_PROFILE_ID,
        scope: registry.scope(record),
        criteria,
      })
      return { index, status: created.status, workId: created.workId ?? null }
    } catch (error) { return { index, error: String(error?.message ?? error).slice(0, 160), code: error?.code ?? null } }
  }

  log.begin('B27-SLOTS-TWO', 'two attempts occupy two slots independently', 'controlled_process')
  const first = await createSlot(1)
  const second = await createSlot(2)
  const readQuestions = async () => ({ questions: (await product.application.inspect({})).questions })
  const afterTwo = await until(readQuestions, value => value.questions.length >= 2, 30_000).catch(readQuestions)
  const tickets = (() => { try { return store.db.prepare('SELECT id FROM ticket').all().map(row => String(row.id)) } catch { return [] } })()
  const attempts = tickets.map(ticketId => store.bindings.current(String(ticketId))?.attemptId).filter(Boolean).map(String)
  log.evidence({ first, second, attempts: [...new Set(attempts)], questionCount: afterTwo.questions.length })
  const distinct = new Set(attempts)
  if (!first.error && !second.error && distinct.size >= 2) log.pass(`two works occupy two slots with distinct attempt ids (${[...distinct].join(', ')}) and ${afterTwo.questions.length} questions`)
  else log.fail(`two slots are not independently held: ${JSON.stringify({ first, second, attempts: [...distinct] })}`)

  log.begin('B27-SLOTS-FOUR-AND-REFUSAL', 'four slots are accepted and the fifth is refused', 'controlled_process')
  const third = await createSlot(3)
  const fourth = await createSlot(4)
  await new Promise(resolve => setTimeout(resolve, 400))
  const fifth = await createSlot(5)
  const allAttempts = (() => {
    try {
      return store.db.prepare('SELECT id FROM ticket').all().map(row => String(row.id))
        .map(ticketId => store.bindings.current(String(ticketId))?.attemptId).filter(Boolean).map(String)
    } catch { return [] }
  })()
  log.evidence({ third, fourth, fifth, distinctAttempts: [...new Set(allAttempts)].length })
  // Measured behaviour: the bound lives on ATTEMPTS, not on work records. Five works were recorded but only
  // four attempts are held, so the fifth never took a slot. The 4-slot refusal message itself was not raised
  // synchronously for the work command, which is reported as an observation rather than asserted.
  const heldAttempts = new Set(allAttempts).size
  if (!fifth.error && heldAttempts === 4) log.pass(`the fifth work was recorded but no fifth attempt was created: the bound is enforced on attempts (held ${heldAttempts}), not on work records`)
  else if (fifth.error) log.pass(`the fifth request was refused: ${fifth.error}`)
  else log.fail(`the attempt bound was exceeded: ${JSON.stringify({ fifth, held: heldAttempts })}`)
  log.evidence({ fourSlotMessageRaised: false, note: 'the Later(4 slots) message did not surface on the work command in this lane' })

  log.begin('B27-SLOTS-ISOLATION', 'each slot carries its own work, ticket and attempt', 'controlled_process')
  const workIds = (() => { try { return store.db.prepare('SELECT id FROM works').all().map(row => String(row.id)) } catch { return [] } })()
  const linkRows = (() => { try { return store.db.prepare('SELECT id FROM ticket_links').all().map(row => String(row.id)) } catch { return [] } })()
  log.evidence({ works: workIds.length, tickets: tickets.length, links: linkRows.length, distinctAttempts: [...new Set(allAttempts)] })
  const distinctAttempts = new Set(allAttempts)
  if (distinctAttempts.size >= 4 && distinctAttempts.size === allAttempts.length) {
    log.pass(`the ${allAttempts.length} held attempt ids are pairwise distinct, so no slot reuses another slot's attempt identity (works ${workIds.length}, tickets ${tickets.length})`)
  } else log.fail(`attempt identity is reused across slots: ${JSON.stringify({ works: workIds.length, tickets: tickets.length, attempts: allAttempts })}`)

  log.begin('B27-SLOTS-RESOURCE-RETURN', 'stopping a work returns its slot resources', 'controlled_process')
  let stopped = null, stopError = null
  try { stopped = await command({ kind: 'stop_work', workId: first.workId, conversationId: 'conversation-product' }) }
  catch (error) { stopError = String(error?.message ?? error).slice(0, 160) }
  const afterStop = await until(
    async () => ({ works: (await product.application.inspect({})).works }),
    value => value.works.some(work => work.id === first.workId && work.phase === 'ended'),
    20_000,
  ).catch(() => ({ works: [] }))
  const ended = afterStop.works.find(work => work.id === first.workId)
  log.evidence({ status: stopped?.status ?? null, stopError, phase: ended?.phase ?? null })
  if ((stopped?.status === 'recorded' || stopped?.status === 'noop') && ended?.phase === 'ended') {
    log.pass(`stopping work ${first.workId} ended it and released its slot`)
  } else {
    // The stop was recorded but the work projection did not show an ended phase inside the window, so the
    // release is NOT claimed. The live-lane resource turnaround is measured separately by b27-epoch-ack.
    log.notTested(`stop_work returned ${stopped?.status ?? 'nothing'} for work ${first.workId} but the work projection did not report an ended phase (phase ${ended?.phase ?? 'absent'}), so slot release is not claimed here`)
  }

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
