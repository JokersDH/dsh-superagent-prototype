import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, cpSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 4 || !process.argv[2] || !process.argv[3])
  throw new Error('Usage: PA_ADMISSION_REPORT=/absolute/new.json node tools/bootstrap/probe-wave17-context.mjs <A-root> <C-root>')
const output = process.env.PA_ADMISSION_REPORT
if (!output || !isAbsolute(output)) throw new Error('PA_ADMISSION_REPORT must name a new absolute report path')
try {
  lstatSync(output)
  throw new Error('Refusing to overwrite an existing report')
} catch (error) { if (error.code !== 'ENOENT') throw error }

const a = resolve(process.argv[2]), c = resolve(process.argv[3])
const head = root => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim()
const sources = { A: head(a), C: head(c) }
const { ProductStore } = await import(pathToFileURL(join(a, 'packages/storage/dist/index.js')).href)
const { WorkflowSnapshots } = await import(pathToFileURL(join(a, 'packages/workflows/dist/index.js')).href)
const { reviewVerifiedReplyCandidates } = await import(pathToFileURL(join(c, 'packages/proposals/src/index.ts')).href)
const Database = createRequire(join(a, 'packages/storage/package.json'))('better-sqlite3')
const observations = [], root = mkdtempSync(join(tmpdir(), 'pa-wave17-context-'))
let store
try {
  store = new ProductStore({ path: join(root, 'source.sqlite') })
  store.queue.enqueue('application.execute', 'owned-queue', '{"workId":"original"}', 1, 0, '2026-11-13T00:00:00.000Z')
  const queueRows = store.db.prepare('SELECT COUNT(*) AS n FROM effect').get().n
  const replyRows = store.db.prepare('SELECT COUNT(*) AS n FROM assistant_reply_results').get().n
  const snapshots = new WorkflowSnapshots(store), original = join(root, 'original')
  const created = await snapshots.create({ destination: original }), valid = snapshots.verify(original)
  const evidence = created.manifest.evidence
  observations.push({ owner: 'A', id: 'NONEMPTY_V2_POSITIVE',
    status: created.status === 'ok' && valid.status === 'ok' && created.manifest.protocol === 'workflow-snapshot/2' &&
      evidence.protocol === 'workflow-evidence/2' && evidence.familySetVersion === 2 && queueRows === 1 && replyRows === 0 ? 'PASS' : 'FAIL',
    observed: { protocol: created.manifest.protocol, evidenceProtocol: evidence.protocol,
      familySetVersion: evidence.familySetVersion, familyCount: evidence.families.length, queueRows, replyRows, verified: valid.status } })

  for (const mode of ['full-v2-tampered-queue', 'mixed-version-tampered-queue', 'missing-empty-required-table']) {
    const copy = join(root, mode)
    cpSync(original, copy, { recursive: true })
    const databasePath = join(copy, 'product.sqlite'), database = new Database(databasePath)
    try {
      if (mode === 'missing-empty-required-table') database.exec('DROP TABLE assistant_reply_results')
      else database.prepare('UPDATE effect SET value = ? WHERE key = ?').run('{"workId":"changed"}', 'owned-queue')
    } finally { database.close() }
    const manifestPath = join(copy, 'snapshot.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const bytes = readFileSync(databasePath)
    manifest.database.bytes = bytes.byteLength
    manifest.database.sha256 = createHash('sha256').update(bytes).digest('hex')
    if (mode === 'mixed-version-tampered-queue') {
      manifest.protocol = 'workflow-snapshot/1'
      delete manifest.evidence.familySetVersion
      manifest.evidence.families = manifest.evidence.families.filter(family => family.name !== 'effect_queue')
    }
    writeFileSync(manifestPath, JSON.stringify(manifest))
    let verified
    try { verified = snapshots.verify(copy).status } catch { verified = 'rejected' }
    observations.push({ owner: 'A', id: mode, status: verified === 'ok' ? 'FAIL' : 'PASS', observed: {
      protocol: manifest.protocol, evidenceProtocol: manifest.evidence.protocol,
      familySetVersion: manifest.evidence.familySetVersion ?? null, familyCount: manifest.evidence.families.length, verified } })
  }
} finally {
  try { store?.close() } finally { rmSync(root, { recursive: true, force: true }) }
}

const projectId = 'project-1', conversationId = 'conversation-1', sourceMessageId = 'source-1'
const principal = { userId: 'user-1', authorityRef: 'authority-1' }
const bindings = { projectId, conversationId, sourceMessageId, principal, grantId: 'grant-1',
  grantScope: { projectId, allowedPaths: ['src'], excludedPaths: [], externalActions: [] } }
const body = { protocol: 'assistant-reply-body/1', projectId, conversationId, sourceMessageId,
  replyMessageId: 'reply-1', model: 'mock', text: 'Ordinary reply', suggestions: [
    { kind: 'propose_work', projectId, sourceMessageId, goal: 'Add an idempotency test' } ] }
const identity = { requestId: 'request-1', replyMessageId: 'reply-1', projectId, conversationId, sourceMessageId, model: 'mock', principal }
const modes = [
  ['TYPED_NONEMPTY_POSITIVE', { verifiedBy: 'main-completed-reply', body, identity }, 'candidates'],
  ['OUTER_GETTER_REFUSAL_CONTROL', Object.defineProperty({}, 'verifiedBy', { get() { throw new Error('outer getter') } }), 'invalid_body'],
  ['NESTED_BODY_GETTER_REFUSAL', { verifiedBy: 'main-completed-reply',
    body: Object.defineProperty({ ...body }, 'replyMessageId', { get() { throw new Error('nested body getter') } }), identity }, 'invalid_body'],
  ['NESTED_PRINCIPAL_GETTER_REFUSAL', { verifiedBy: 'main-completed-reply', body,
    identity: Object.defineProperty({ ...identity }, 'principal', { get() { throw new Error('nested principal getter') } }) }, 'invalid_body'],
]
for (const [id, input, expected] of modes) {
  try {
    const result = reviewVerifiedReplyCandidates(input, bindings)
    observations.push({ owner: 'C', id, status: result.status === expected ? 'PASS' : 'FAIL',
      observed: { status: result.status, candidates: result.candidates.length }, expected })
  } catch (error) {
    observations.push({ owner: 'C', id, status: 'FAIL', observed: { exception: error.name, message: error.message }, expected })
  }
}

const report = { protocol: 'wave17-ac-boundary-observations/1', candidates: { A: a, C: c }, sources,
  modelCalls: 0, nativeTurns: 0, observations,
  passed: observations.filter(item => item.status === 'PASS').length,
  failed: observations.filter(item => item.status === 'FAIL').length,
  scope: 'Snapshot data completeness and private-wrapper robustness only; no main source-confirmation or startup authority verdict' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
const fd = openSync(output, 'wx', 0o600)
try { writeFileSync(fd, JSON.stringify(report, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
