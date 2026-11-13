import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 4 || !process.argv[2] || !process.argv[3])
  throw new Error('Usage: PA_ADMISSION_REPORT=/absolute/new.json node tools/bootstrap/probe-wave18-context.mjs <old-main-root> <A-root>')
const output = process.env.PA_ADMISSION_REPORT
if (!output || !isAbsolute(output)) throw new Error('PA_ADMISSION_REPORT must name a new absolute report path')
try {
  lstatSync(output)
  throw new Error('Refusing to overwrite an existing report')
} catch (error) { if (error.code !== 'ENOENT') throw error }

const oldMain = resolve(process.argv[2]), candidate = resolve(process.argv[3])
const paths = ['packages/storage/src/backup.ts', 'packages/storage/dist/backup.js',
  'packages/workflows/src/snapshot.ts', 'packages/workflows/dist/snapshot.js']
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const identify = root => ({
  root,
  head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 10000 }).trim(),
  trackedStatus: execFileSync('git', ['status', '--porcelain', '--', ...paths.filter(path => path.includes('/src/'))],
    { cwd: root, encoding: 'utf8', timeout: 10000 }).trim(),
  files: Object.fromEntries(paths.map(path => [path, hash(join(root, path))])),
})
const sources = { producer: identify(oldMain), A: identify(candidate) }
const { ProductStore, readWorkflowEvidence: originalEvidence } = await import(pathToFileURL(join(oldMain, 'packages/storage/dist/index.js')).href)
const { WorkflowSnapshots: OriginalSnapshots } = await import(pathToFileURL(join(oldMain, 'packages/workflows/dist/snapshot.js')).href)
const { readWorkflowEvidence: candidateEvidence } = await import(pathToFileURL(join(candidate, 'packages/storage/dist/index.js')).href)
const { WorkflowSnapshots: CandidateSnapshots } = await import(pathToFileURL(join(candidate, 'packages/workflows/dist/snapshot.js')).href)

const root = mkdtempSync(join(tmpdir(), 'pa-wave18-legacy-')), observations = []
let store
try {
  store = new ProductStore({ path: join(root, 'state.sqlite') })
  const original = new OriginalSnapshots(store), verifier = new CandidateSnapshots(store)
  const emptyPath = join(root, 'empty-v1'), empty = await original.create({ destination: emptyPath })
  const emptyOriginal = original.verify(emptyPath).status, emptyCandidate = verifier.verify(emptyPath).status
  observations.push({ id: 'GENUINE_EMPTY_V1_CONTROL',
    status: empty.status === 'ok' && empty.manifest.protocol === 'workflow-snapshot/1' &&
      empty.manifest.evidence.protocol === 'workflow-evidence/1' && emptyOriginal === 'ok' && emptyCandidate === 'ok' ? 'PASS' : 'FAIL',
    originalCreated: empty.status, originalProtocol: empty.manifest.protocol, evidenceProtocol: empty.manifest.evidence.protocol,
    originalVerified: emptyOriginal, candidateVerified: emptyCandidate })

  const bundle = store.artifacts.write(Buffer.from('{"bounded":true}'))
  store.artifacts.insert(bundle)
  store.workflows.assistant.contextBindings.put({ protocol: 'assistant-context-binding/1',
    commandId: 'legacy-command', messageId: 'legacy-message', requestId: 'legacy-request',
    projectId: 'legacy-project', conversationId: 'legacy-conversation', userTextDigest: 'a'.repeat(64),
    principal: { userId: 'legacy-user', authorityRef: 'legacy-authority' }, purpose: 'conversation_discussion',
    scope: { projectId: 'legacy-project', allowedPaths: ['src'], excludedPaths: [], externalActions: [] },
    contract: { workId: 'legacy-work', revision: 1, digest: 'b'.repeat(64) }, selections: ['work'],
    bundleRef: bundle.id, bundleDigest: bundle.digest,
    sources: [{ sourceId: 'legacy-work', kind: 'contract', sourceDigest: 'c'.repeat(64), previewDigest: 'd'.repeat(64), truncated: false }],
    confirmedAt: '2026-11-13T00:00:00.000Z', expiresAt: '2026-11-13T00:04:00.000Z' })
  const nonemptyPath = join(root, 'binding-v1'), nonempty = await original.create({ destination: nonemptyPath })
  const databasePath = join(nonemptyPath, 'product.sqlite')
  const oldBindingFamily = originalEvidence(databasePath).families.find(item => item.name === 'assistant_context_bindings')
  const candidateBindingFamily = candidateEvidence(databasePath).families.find(item => item.name === 'assistant_context_bindings')
  const originalVerified = original.verify(nonemptyPath).status, candidateVerified = verifier.verify(nonemptyPath).status
  const derivedWorkId = store.db.prepare('SELECT work_id FROM assistant_context_bindings WHERE message_id = ?').get('legacy-message').work_id
  observations.push({ id: 'GENUINE_NONEMPTY_BINDING_V1',
    status: nonempty.status === 'ok' && nonempty.manifest.protocol === 'workflow-snapshot/1' &&
      nonempty.manifest.evidence.protocol === 'workflow-evidence/1' && oldBindingFamily?.count === 1 &&
      originalVerified === 'ok' && candidateVerified === 'ok' ? 'PASS' : 'FAIL',
    originalCreated: nonempty.status, originalProtocol: nonempty.manifest.protocol, evidenceProtocol: nonempty.manifest.evidence.protocol,
    originalVerified, candidateVerified, oldBindingFamily, candidateBindingFamily, derivedWorkId })
} finally {
  try { store?.close() } finally { rmSync(root, { recursive: true, force: true }) }
}

const producerFilesStable = paths.every(path => sources.producer.files[path] === hash(join(oldMain, path)))
const candidateFilesStable = paths.every(path => sources.A.files[path] === hash(join(candidate, path)))
const report = { protocol: 'wave18-v1-binding-compatibility/1', sources,
  producerFilesStable, candidateFilesStable, modelCalls: 0, nativeTurns: 0, observations,
  passed: observations.filter(item => item.status === 'PASS').length,
  failed: observations.filter(item => item.status === 'FAIL').length,
  scope: 'Genuine old-producer v1 snapshots and nonempty context-binding digest compatibility only; no format relabeling, model send or startup authority' }
mkdirSync(dirname(output), { recursive: true, mode: 0o700 })
const fd = openSync(output, 'wx', 0o600)
try { writeFileSync(fd, JSON.stringify(report, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed || !producerFilesStable || !candidateFilesStable ? 1 : 0
