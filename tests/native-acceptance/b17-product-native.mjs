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
const fakeExecutable = fileURLToPath(new URL('./fixtures/fake-codex-executable.mjs', import.meta.url))

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
  const received = () => existsSync(receiverLog)
    ? readFileSync(receiverLog, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
    : []
  const factKinds = () => { try { return store.db.prepare('SELECT kind FROM fact_receipts').all().map(row => String(row.kind)) } catch { return [] } }

  const criteria = [
    { id: 'criterion-output', kind: 'machine', required: true, description: 'Registered project check passes', checkDefinitionRef: registry.check(record).id },
    { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' },
  ]

  log.begin('B17-PRODUCT-PREPARES', 'the product attempt completes policy preparation', 'controlled_process')
  product.start()
  const created = await command({
    kind: 'create_work',
    projectId: record.id,
    goal: 'Produce the controlled scratch artifact through a prepared native attempt',
    profileId: NATIVE_PROFILE_ID,
    scope: registry.scope(record),
    criteria,
  })
  const prepared = await until(
    async () => ({
      facts: tables().facts, frames: received(),
      topics: store.events.after(0).map(event => `${event.topic}:${JSON.stringify(event.payload).slice(0, 260)}`),
      binding: (() => { try { return store.db.prepare('SELECT state, value FROM runtime_bindings LIMIT 1').get() } catch { return null } })(),
    }),
    value => value.frames.some(frame => frame.kind === 'begin') || value.topics.some(topic => /held|failed/.test(topic)),
  )
  log.evidence({ status: created.status, facts: prepared.facts, frames: prepared.frames.map(f => f.kind), topics: prepared.topics, binding: prepared.binding })
  if (prepared.frames.some(frame => frame.kind === 'begin')) {
    log.pass(`preparation completed and begin was fed: ${prepared.facts} fact receipt(s) recorded, receiver saw ${prepared.frames.filter(f => f.kind === 'begin').length} begin`)
  } else {
    log.fail(`preparation did not reach begin: ${JSON.stringify({ facts: prepared.facts, topics: prepared.topics, binding: prepared.binding })}`)
  }

  log.begin('B17-BEGIN-AFTER-PREPARE', 'begin follows preparation and reaches the Runner receiver', 'controlled_process')
  const began = await until(
    async () => ({ frames: received(), kinds: factKinds(), tables: tables() }),
    value => value.frames.some(frame => frame.kind === 'begin'),
  )
  const begins = began.frames.filter(frame => frame.kind === 'begin')
  log.evidence({ receiverFrames: began.frames.map(f => ({ kind: f.kind, attemptId: f.attemptId, epoch: f.fenceEpoch })), factKinds: began.kinds })
  if (begins.length >= 1) log.pass(`the Runner receiver recorded ${begins.length} begin for attempt ${begins[0].attemptId} at epoch ${begins[0].fenceEpoch}`)
  else log.fail(`no begin reached the receiver: ${JSON.stringify(began.frames)}`)

  log.begin('B17-FACTS-IN-STORE', 'native facts are persisted through the product sink, not memory', 'controlled_process')
  const settled = await until(
    async () => ({ kinds: factKinds(), tables: tables(), frames: received() }),
    value => value.kinds.some(kind => kind !== 'policy.prepared') || value.tables.dispatch >= 1,
  )
  log.evidence({ factKinds: settled.kinds, tables: settled.tables })
  const persisted = settled.kinds.filter(kind => kind !== 'policy.prepared')
  if (persisted.length >= 1 && (settled.tables.facts ?? 0) >= 2) {
    log.pass(`real facts persisted in A's store: ${[...new Set(settled.kinds)].join(', ')} (${settled.tables.facts} rows)`)
  } else {
    log.fail(`facts did not reach the durable store: ${JSON.stringify({ kinds: settled.kinds, tables: settled.tables })}`)
  }

  log.begin('B17-BUSINESS-ROWS', 'work/ticket/assignment/binding/dispatch rows exist and agree', 'controlled_process')
  const final = tables()
  const binding = (() => { try { return store.db.prepare('SELECT attempt_id, fence_epoch, state FROM runtime_bindings LIMIT 1').get() } catch { return null } })()
  log.evidence({ tables: final, binding, receiverAttempt: begins[0]?.attemptId ?? null })
  const required = ['works', 'tickets', 'links', 'facts', 'bindings', 'dispatch']
  const empty = required.filter(name => (final[name] ?? 0) === 0)
  const sameAttempt = binding && begins[0] ? String(binding.attempt_id) === String(begins[0].attemptId) : false
  if (empty.length === 0 && sameAttempt) {
    log.pass(`business rows populated and the binding attempt equals the receiver attempt: ${required.map(n => `${n}=${final[n]}`).join(' ')}`)
  } else {
    log.fail(`business rows incomplete or mismatched: ${JSON.stringify({ empty, sameAttempt, final, binding, receiver: begins[0]?.attemptId })}`)
  }

  log.begin('B17-SCOPE-NOT-NATIVE', 'fake executable lane; installed Codex not executed', 'controlled_process')
  log.evidence({ driver: 'CodexProductDriver (unmodified)', executable: 'B-owned fake app-server process', installedCodexExecuted: false })
  log.notTested('an installed Codex was not executed and no gateway was contacted')
  log.notTested('question/approval, child writer identity, reconnect port, crash windows, stale epoch, recovered delivery and slots are not covered here')
} finally {
  try { await product?.close() } catch {}
  try { store?.close() } catch {}
  delete process.env.PA_RUNNER_RECEIVER_LOG
  rmSync(root, { recursive: true, force: true })
}

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-17 B1/B2 product vertical with fake executable', modelCalls: 0, nativeTurns: 0 }, extra: { scope: 'controlled fake executable; native NOT_TESTED' } },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b17-product-native.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(30)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB17 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
