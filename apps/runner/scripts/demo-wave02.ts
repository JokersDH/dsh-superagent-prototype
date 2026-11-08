#!/usr/bin/env node
/**
 * Wave-02 Agent B end-to-end demo (fixture lane).
 *
 * Runs the whole owned stack once, for a human to read or a CI job to assert:
 *
 *   catalog -> profile gate -> independent Runner process -> bridge -> facts -> journal -> replay
 *
 * Every step prints a `PASS`/`FAIL` line with its evidence. This is a **fixture** demonstration: the
 * native agent is the fake one, so it proves the product's own wiring, not vendor compatibility.
 *
 *   node apps/runner/scripts/demo-wave02.ts
 */
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url))

const { buildCatalogEntry, schedulable } = await import('../../../packages/catalog/src/index.ts')
const { CODEX_PROFILE } = await import('../../../packages/catalog/fixtures/draft-profiles.ts')
const { PolicyPreparation } = await import('../../../packages/policy-preparation/src/index.ts')
const { RunnerLink } = await import('../src/runner-link-client.ts')
const { FileCriticalJournal, replayJournal } = await import('../src/index.ts')
const { InMemoryFactLedger, InMemoryPayloadStore, makeAttemptSpec, makeCommand } = await import('../../../packages/testing/src/index.ts')

const results: Array<{ step: string; ok: boolean; detail: string }> = []
const record = (step: string, ok: boolean, detail: string): void => {
  results.push({ step, ok, detail })
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${step.padEnd(34)} ${detail}\n`)
}

const root = mkdtempSync(join(tmpdir(), 'wave02-demo-'))
process.stdout.write(`\nwave-02 Agent B demo (fixture lane)  stateRoot=${root}\n\n`)

// 1. Catalog: probe the draft profile and decide readiness from evidence.
const catalogEntry = buildCatalogEntry({
  profile: CODEX_PROFILE,
  checkedAt: new Date().toISOString(),
  facts: {
    executable: CODEX_PROFILE.executable,
    exists: false, // no Codex installed in this fixture lane
  },
})
record(
  'catalog readiness',
  catalogEntry.readiness === 'missing' && !schedulable(catalogEntry),
  `readiness=${catalogEntry.readiness} schedulable=${schedulable(catalogEntry)}`,
)

// 2. Policy gate: an unprepared or advisory policy must refuse business work.
const preparation = new PolicyPreparation()
const spec = makeAttemptSpec()
const context = {
  currentFingerprint: 'f'.repeat(64),
  profile: { ...CODEX_PROFILE, id: 'profile-fixture' },
}
const unprepared = preparation.admit(spec, context)
record('policy gate (unprepared)', unprepared.allowed === false && (unprepared as { reason: string }).reason === 'not_prepared', `reason=${(unprepared as { reason: string }).reason}`)

preparation.prepare({
  ticketId: spec.ticketId,
  assignmentId: spec.assignmentId,
  attemptId: spec.attemptId,
  fenceEpoch: spec.fenceEpoch,
  contract: spec.contract,
  requestedPolicyRevision: context.profile.permissionPolicyRevision,
  nativeAppliedSettingsRef: 'settings-1',
  effectiveConfigFingerprint: 'f'.repeat(64),
  enforcement: 'enforced',
  verification: 'passed',
  evidenceRef: 'evidence-1',
})
record('policy gate (enforced)', preparation.admit(spec, context).allowed === true, 'enforced + verified + fingerprint match')

preparation.hold('config_drift', 'config changed under the attempt')
const held = preparation.admit(spec, context)
record('policy gate (drift hold)', (held as { reason: string }).reason === 'config_drift' && preparation.canCancel(), 'work refused, cancel still available')
preparation.prepare(preparation.record!) // re-prepare clears the hold

// 3. Independent Runner process, driven over the bridge.
const payloads = new InMemoryPayloadStore()
const ledger = new InMemoryFactLedger()
const link = new RunnerLink({
  executable: process.execPath,
  entry: here('../src/runner-service-entry.ts'),
  args: ['waiting-user'],
  stateRoot: join(root, 'attempt'),
})
const runner = await link.spawnAttempt(spec, async fact => ledger.record(fact))
record('runner ready', runner.pid > 0, `pid=${runner.pid} journal=${runner.journalPath.replace(root, '<root>')}`)

await runner.command(makeCommand('begin', { inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }))
const sawQuestion = await (async () => {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (ledger.records.some(item => item.kind === 'question.opened')) return true
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return false
})()
record('question acknowledged', sawQuestion, `facts=${ledger.records.map(item => item.kind).join(',')}`)

await runner.command(makeCommand('answer', { nativeBindingRef: 'binding-1', answerRef: 'answer-1' }))
await runner.command(makeCommand('cancel'))
const exit = await runner.waitExit()
record('cancel across bridge', exit.exit.reason === 'cancelled', `exit=${exit.exit.reason} receipts=${runner.receipts.length}`)

// 4. Every acknowledged fact reached the coordinator's store, not just the Runner's memory.
record('facts reached coordinator', ledger.records.length >= 2, `coordinator facts=${ledger.records.length}`)

const closeCode = await runner.close()
record('runner cleaned up', closeCode === 0 || closeCode === null, `close=${String(closeCode)}`)

// 5. Journal: a verified snapshot that replays facts only (no begin/deliver/answer).
const journalFile = runner.journalPath
const journalBytes = existsSync(journalFile) ? readFileSync(journalFile).length : 0
const journal = new FileCriticalJournal({ path: journalFile })
const recovery = await journal.open()
const replayed: string[] = []
const replayResult = await replayJournal(journal, {
  record: async fact => {
    replayed.push(fact.kind)
    return { factId: fact.factId, persisted: true as const, seq: replayed.length }
  },
})
journal.close()
record('journal verified', recovery.corruptAt === null && !recovery.readOnly, `bytes=${journalBytes} entries=${recovery.entries.length}`)
record(
  'replay sends facts only',
  replayResult.failures.length === 0 && replayed.every(kind => !['begin', 'deliver', 'answer'].includes(kind)),
  `replayed=${replayed.join(',') || '(none)'} failures=${replayResult.failures.length}`,
)

const failed = results.filter(item => !item.ok)
process.stdout.write(`\n${failed.length === 0 ? 'DEMO PASS' : 'DEMO FAIL'}  ${results.length - failed.length}/${results.length} steps\n`)
process.stdout.write('scope: fixture lane only — no vendor agent, real Codex compatibility NOT_TESTED\n')
process.exit(failed.length === 0 ? 0 : 1)
