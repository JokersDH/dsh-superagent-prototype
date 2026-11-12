import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RecoveryIntentCommitter } from '../../apps/coordinator/product/recovery-intents.ts'

const candidate = resolve(process.argv[2] ?? '')
if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave12-storage.mjs <A-root>')
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const { ProductStore } = await import(pathToFileURL(join(candidate, 'packages/storage/dist/index.js')).href)
const git = (...args) => execFileSync('git', args, { cwd: candidate, encoding: 'utf8' }).trim()
const source = git('rev-parse', 'HEAD'), cases = []
const principal = { userId: 'wave12-user', authorityRef: 'wave12-authority' }
const at = '2026-11-12T00:00:00.000Z', expiresAt = '2026-11-12T00:05:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const intent = index => ({ protocol: 'recovery-activation-intent/1', activationId: `activation-${index}`,
  commandId: `command-${index}`, planId: `plan-${index}`, planDigest: 'b'.repeat(64),
  source: { stateId: 'source', stateRoot: '/tmp/wave12-source', markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
  target: { generationId: `generation-${index}`, stateRoot: `/tmp/wave12-target-${index}`, configurationDigest: 'e'.repeat(64) },
  principal, machineDigest: 'f'.repeat(64), resourcePolicyDigest: 'a'.repeat(64), createdAt: at, expiresAt })
const commit = store => new RecoveryIntentCommitter(store, store.workflows.recoveryActivations, principal, () => {}, () => at)
  .commit(intent(0), { ...principal, source: 'local_ui' })
async function check(id, run) {
  const root = mkdtempSync('/tmp/pa-wave12-a-'), store = new ProductStore({ path: join(root, 'state.sqlite') })
  try { cases.push({ id, status: 'PASS', observation: await run(store) }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message, observation: error.observation }) }
  finally { store.close(); rmSync(root, { recursive: true, force: true }) }
}
function observed(condition, message, observation) {
  if (!condition) throw Object.assign(new Error(message), { observation })
}
await check('EXACT_OWN_CONFIRMATION_POSITIVE_CONTROL', store => {
  const before = store.workflows.recoverySource.inspect(), committed = commit(store)
  const after = store.workflows.recoverySource.inspect({ ignoreCommitted: committed })
  assert.equal(before.coverage, 'complete'); assert.equal(after.coverage, 'complete')
  assert.equal(after.sourceFingerprint, before.sourceFingerprint)
  return { productSchema: after.productSchema, fingerprintUnchanged: true }
})
await check('EXCLUDED_ROW_MUST_NOT_HIDE_A_TAIL_BEYOND_FAMILY_CAP', store => {
  const committed = commit(store)
  for (let index = 1; index <= 5; index++) store.workflows.recoveryActivations.put(intent(index))
  const query = { ignoreCommitted: committed, maxRowsPerFamily: 5 }
  const before = store.workflows.recoverySource.inspect(query)
  store.workflows.recoveryActivations.put(intent(6))
  const after = store.workflows.recoverySource.inspect(query)
  const observation = { beforeCoverage: before.coverage, afterCoverage: after.coverage,
    actualNonExcludedRows: 6, cap: 5, reported: after.families.find(value => value.name === 'recovery_activations'),
    fingerprintUnchanged: before.sourceFingerprint === after.sourceFingerprint }
  observed(after.coverage !== 'complete' || before.sourceFingerprint !== after.sourceFingerprint,
    'Adding a non-excluded activation beyond the scan tail must be visible or bounded', observation)
  return observation
})
await check('EXCLUSION_MUST_NOT_HIDE_A_SECOND_IDENTICAL_INTENT_EVENT', store => {
  const committed = commit(store), before = store.workflows.recoverySource.inspect({ ignoreCommitted: committed })
  store.events.append({ topic: 'application.recovery.intent', entityRef: committed.intent.activationId, payload: committed.intent })
  const after = store.workflows.recoverySource.inspect({ ignoreCommitted: committed })
  const observation = { coverage: after.coverage, fingerprintUnchanged: before.sourceFingerprint === after.sourceFingerprint,
    observedCursorChanged: after.observedEventCursor !== before.observedEventCursor }
  observed(after.coverage !== 'complete' || before.sourceFingerprint !== after.sourceFingerprint,
    'Only the original exact intent event may be ignored; a later same-body event is another change', observation)
  return observation
})
await check('DERIVED_WORK_INDEX_MUST_AGREE_WITH_IMMUTABLE_BINDING', store => {
  const artifact = store.artifacts.write(Buffer.from('bounded bundle'))
  store.artifacts.insert(artifact)
  store.workflows.assistant.contextBindings.put({ protocol: 'assistant-context-binding/1', commandId: 'context-command',
    messageId: 'context-message', requestId: 'context-request', projectId: scope.projectId, conversationId: 'conversation-1',
    userTextDigest: 'a'.repeat(64), principal, purpose: 'conversation_discussion', scope,
    contract: { workId: 'actual-work', revision: 1, digest: 'b'.repeat(64) }, selections: ['work'],
    bundleRef: artifact.id, bundleDigest: artifact.digest, sources: [{ sourceId: 'actual-work', kind: 'work',
      sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), truncated: false }], confirmedAt: at, expiresAt })
  store.db.prepare('UPDATE assistant_context_bindings SET work_id = ? WHERE message_id = ?').run('foreign-work', 'context-message')
  let rejected = false, page
  try { page = store.workflows.assistant.contextHistory.page({ projectIds: [scope.projectId], workId: 'foreign-work' }) }
  catch { rejected = true }
  const observation = { rejected, queryWorkId: 'foreign-work', returnedWorkIds: page?.records.map(value => value.contract?.workId) }
  observed(rejected || !page.records.length, 'A corrupted derived work_id must not return another work as matching history', observation)
  return observation
})
const report = { protocol: 'wave12-a-admission/1', source, candidate, sourceStable: source === git('rev-parse', 'HEAD'),
  cases, counts: { pass: cases.filter(value => value.status === 'PASS').length, fail: cases.filter(value => value.status === 'FAIL').length },
  realModelTurns: 0, nativeTurnStarts: 0, scope: 'new logical source and raw history only; no startup authority; temp SQLite only' }
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave12-admission/storage.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.counts.fail ? 1 : 0
