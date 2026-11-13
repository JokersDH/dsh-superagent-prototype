import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import { runCase, LAYERS } from '../lib/status.mjs'

const principal = { userId: 'w17-source-confirm', authorityRef: 'w17-source-confirm-authority' }
const projectId = 'w17-source-project'
const headers = { authorization: `Bearer ${'a'.repeat(64)}`, 'content-type': 'application/json' }
const define = (id, title) => ({ id, title, layer: LAYERS.CONTROLLED, limitations: [
  'Recovery read-only runtime with a trusted read-only executor fixture; no target activation, no model/native send.',
] })

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pa-w17-source-')), stateRoot = join(root, 'source'), project = join(root, 'project')
  mkdirSync(stateRoot, { mode: 0o700 }); mkdirSync(project)
  writeFileSync(join(project, 'index.mjs'), 'export const ok = true\n')
  const git = args => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'W17 source fixture'])
  const marker = join(stateRoot, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'personal-restore/1', targetPath: stateRoot,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  let at = '2026-11-13T04:00:00.000Z', profileRevision = 1
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  store.queue.enqueue('application.execute', 'w17-held-work', '{"workId":"historical"}', 1, 0, at)
  const product = createProductRuntime({ store, stateRoot, scratchProject: project, principal,
    projects: [{ id: projectId, scope: { projectId, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] } }],
    actionSecret: Buffer.alloc(32, 81), startupMode: 'recovery_readonly', now: () => at,
    recoveryExecutor: () => ({ id: 'w17-readonly-executor', revision: profileRevision, executable: process.execPath, expectedVersion: process.version }) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
    mode: 'personal', startupMode: 'recovery_readonly', allowedOrigins: ['http://127.0.0.1:5173'], read: product.read, operations: product.operations })
  const request = async (path, body) => {
    const response = await app.request(`http://127.0.0.1${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
    let value; try { value = await response.json() } catch { value = undefined }
    return { status: response.status, body: value }
  }
  const prepareBody = async () => ({ preflight: { expectedFingerprint: (await product.read.recovery()).inspectionFingerprint,
    bindings: [{ sourceProjectId: projectId, project: { path: project, check: 'node_test' } }] }, targetStateRoot: join(root, 'new-empty-target') })
  return { root, stateRoot, marker, store, product, app, request, prepareBody,
    setTime: value => { at = value }, changeProfile: () => { profileRevision++ },
    async close() { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) } }
}

export async function runSourceConfirm() {
  const cases = []
  cases.push(await runCase({ ...define('E4-SOURCE-CONFIRM', 'Source prepare/confirm is read-only, records one fact/receipt and leaves held queue untouched'), evidence: {} },
    async ({ assert, evidence }) => {
      const h = await fixture()
      try {
        const before = { fingerprint: h.store.workflows.recoverySource.inspect().sourceFingerprint,
          queue: h.store.db.prepare('SELECT * FROM effect').all(), cursor: h.store.events.cursor(), marker: readFileSync(h.marker) }
        const prepared = await h.request('/v1/recovery/source/prepare', await h.prepareBody())
        assert('SOURCE_PREPARE', prepared.status === 200 && prepared.body?.authorization === 'not_granted' && prepared.body?.startupAvailable === false, JSON.stringify(prepared.body)?.slice(0, 300))
        assert('SOURCE_PREPARE_NO_WRITE', h.store.events.cursor() === before.cursor && !existsSync(prepared.body.intent.target.stateRoot), JSON.stringify({ cursor: h.store.events.cursor() }))
        const confirmed = await h.request('/v1/recovery/source/confirm', { token: prepared.body.token })
        assert('SOURCE_CONFIRM', confirmed.status === 200 && confirmed.body?.authorization === 'not_granted' && confirmed.body?.committed?.intent?.activationId === prepared.body.intent.activationId, JSON.stringify(confirmed.body)?.slice(0, 300))
        const audit = await h.app.request(`http://127.0.0.1/v1/recovery/activations/${prepared.body.intent.activationId}`, { headers })
        assert('SOURCE_AUDIT', audit.status === 200 && JSON.stringify(await audit.json()) === JSON.stringify(confirmed.body), String(audit.status))
        assert('SOURCE_NO_TARGET', !existsSync(prepared.body.intent.target.stateRoot), prepared.body.intent.target.stateRoot)
        assert('SOURCE_QUEUE_HELD', JSON.stringify(h.store.db.prepare('SELECT * FROM effect').all()) === JSON.stringify(before.queue), 'queue changed')
        assert('SOURCE_MARKER_UNCHANGED', JSON.stringify(readFileSync(h.marker)) === JSON.stringify(before.marker), 'marker changed')
        const normalized = h.store.workflows.recoverySource.inspect({ ignoreCommitted: confirmed.body.committed })
        assert('SOURCE_FINGERPRINT_STABLE', normalized.coverage === 'complete' && normalized.sourceFingerprint === before.fingerprint, JSON.stringify(normalized)?.slice(0, 300))
        const replay = await h.request('/v1/recovery/source/confirm', { token: prepared.body.token })
        assert('SOURCE_REPLAY', replay.status === 200 && JSON.stringify(replay.body) === JSON.stringify(confirmed.body), JSON.stringify(replay.body)?.slice(0, 200))
        evidence.sourceConfirm = { activationId: prepared.body.intent.activationId, authorization: confirmed.body.authorization,
          startupAvailable: confirmed.body.startupAvailable, queueHeld: true, markerUnchanged: true, replay: true }
      } finally { await h.close() }
    }))
  cases.push(await runCase({ ...define('E4-SOURCE-CONFIRM-REFUSAL', 'Expired or changed source confirmation writes no fact/receipt and no target'), evidence: {} },
    async ({ assert, evidence }) => {
      const h = await fixture()
      try {
        const prepared = await h.request('/v1/recovery/source/prepare', await h.prepareBody())
        assert('REFUSAL_PREPARE', prepared.status === 200, JSON.stringify(prepared.body)?.slice(0, 200))
        h.setTime('2026-11-13T04:06:00.000Z'); h.changeProfile()
        const cursor = h.store.events.cursor()
        const refused = await h.request('/v1/recovery/source/confirm', { token: prepared.body.token })
        assert('REFUSAL_CONFIRM', refused.status !== 200, JSON.stringify(refused.body)?.slice(0, 300))
        assert('REFUSAL_NO_WRITE', h.store.events.cursor() === cursor && h.store.workflows.recoveryActivations.get(prepared.body.intent.activationId) === undefined, JSON.stringify({ cursor: h.store.events.cursor() }))
        assert('REFUSAL_NO_TARGET', !existsSync(prepared.body.intent.target.stateRoot), prepared.body.intent.target.stateRoot)
        evidence.sourceConfirmRefusal = { status: refused.status, code: refused.body?.error?.code ?? null, activation: false, target: false }
      } finally { await h.close() }
    }))
  return { cases, artifacts: {} }
}
