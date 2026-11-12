import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { RecoveryIntentCommitter } from '../../apps/coordinator/product/recovery-intents.ts'

const candidate = resolve(process.argv[2] ?? '')
if (!process.argv[2] || process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave13-storage.mjs <A-root>')
const { ProductStore } = await import(pathToFileURL(join(candidate, 'packages/storage/dist/index.js')).href)
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim()
const principal = { userId: 'wave13-user', authorityRef: 'wave13-authority' }, at = '2026-11-12T00:00:00.000Z'
const intent = { protocol: 'recovery-activation-intent/1', activationId: 'activation', commandId: 'command', planId: 'plan', planDigest: 'b'.repeat(64),
  source: { stateId: 'source', stateRoot: '/tmp/wave13-source', markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
  target: { generationId: 'generation', stateRoot: '/tmp/wave13-target', configurationDigest: 'e'.repeat(64) },
  principal, machineDigest: 'f'.repeat(64), resourcePolicyDigest: 'a'.repeat(64), createdAt: at, expiresAt: '2026-11-12T00:05:00.000Z' }
const cases = []
async function check(id, change, setup) {
  const root = mkdtempSync('/tmp/pa-wave13-source-'), store = new ProductStore({ path: join(root, 'state.sqlite') })
  try {
    setup?.(store)
    const committed = new RecoveryIntentCommitter(store, store.workflows.recoveryActivations, principal, () => {}, () => at)
      .commit(intent, { ...principal, source: 'local_ui' })
    const query = { ignoreCommitted: committed }, before = store.workflows.recoverySource.inspect(query)
    change(store, committed)
    let after, rejected = false
    try { after = store.workflows.recoverySource.inspect(query) } catch { rejected = true }
    const changed = before.sourceFingerprint !== after?.sourceFingerprint
    const safe = rejected || after?.coverage !== 'complete' || changed
    cases.push({ id, status: safe ? 'PASS' : 'FAIL', observation: { rejected, coverage: after?.coverage,
      fingerprintChanged: changed, ignoredConfirmation: after?.ignoredConfirmation } })
  } finally { store.close(); rmSync(root, { recursive: true, force: true }) }
}
await check('NORMAL_BUSINESS_ROW_POSITIVE_CONTROL', store => {
  store.product.works.insert({ id: 'normal-work', projectId: 'project', conversationId: 'conversation', title: 'Normal visible change', createdAt: at })
})
await check('NEGATIVE_ROWID_MUST_NOT_DISAPPEAR_FROM_A_COMPLETE_SOURCE', store => {
  const work = store.product.works.get('negative-work')
  store.db.prepare('UPDATE works SET value = ? WHERE id = ?').run(JSON.stringify({ ...work, title: 'A changed logical row' }), 'negative-work')
}, store => {
  store.product.works.insert({ id: 'negative-work', projectId: 'project', conversationId: 'conversation', title: 'A real logical row', createdAt: at })
  store.db.prepare('UPDATE works SET rowid = -2 WHERE id = ?').run('negative-work')
})
await check('IGNORED_ACTIVATION_INDEX_MUST_MATCH_ITS_IMMUTABLE_BODY', store => {
  store.db.prepare('UPDATE recovery_activations SET target_json = ? WHERE activation_id = ?')
    .run(JSON.stringify({ ...intent.target, stateRoot: '/tmp/unconfirmed-target' }), intent.activationId)
})
await check('IGNORED_COMMAND_EVENT_MUST_RETAIN_ITS_ORIGINAL_RECORDED_BODY', (store, committed) => {
  store.db.prepare('UPDATE event_log SET payload = ? WHERE seq = ?').run(JSON.stringify({ status: 'rejected' }), committed.sourceReceipt.seq)
})
const report = { protocol: 'wave13-a-admission/1', candidate, source, cases,
  passed: cases.filter(value => value.status === 'PASS').length, failed: cases.filter(value => value.status === 'FAIL').length,
  realModelTurns: 0, nativeTurnStarts: 0, scope: 'candidate logical recovery source only; isolated temporary SQLite; no startup authority' }
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave13-admission/storage.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
