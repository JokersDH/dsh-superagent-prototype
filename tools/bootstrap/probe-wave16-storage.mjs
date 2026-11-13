import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

if (process.argv.length !== 3) throw new Error('Usage: PA_ADMISSION_REPORT=<output.json> node tools/bootstrap/probe-wave16-storage.mjs <A-root>')
if (!process.env.PA_ADMISSION_REPORT) throw new Error('PA_ADMISSION_REPORT must name an explicit report output')
if (!isAbsolute(process.env.PA_ADMISSION_REPORT)) throw new Error('PA_ADMISSION_REPORT must be absolute')
const candidate = resolve(process.argv[2]), output = resolve(process.env.PA_ADMISSION_REPORT)
if (existsSync(output)) throw new Error(`Report already exists: ${output}`)
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: candidate, encoding: 'utf8' }).trim()
const { ProductStore } = await import(pathToFileURL(join(candidate, 'packages/storage/dist/index.js')).href)
const { WorkflowSnapshots } = await import(pathToFileURL(join(candidate, 'packages/workflows/dist/index.js')).href)
const require = createRequire(join(candidate, 'packages/storage/package.json'))
const Database = require('better-sqlite3')
const root = mkdtempSync(join(tmpdir(), 'pa-wave16-storage-'))
const observations = []
let store
try {
  store = new ProductStore({ path: join(root, 'source.sqlite') })
  store.queue.enqueue('application.execute', 'owned-queue', '{"workId":"original-work"}', 1, 0, '2026-11-13T00:00:00.000Z')
  const snapshots = new WorkflowSnapshots(store), destination = join(root, 'snapshot')
  const created = await snapshots.create({ destination })
  const control = snapshots.verify(destination)
  const effectCount = created.manifest.evidence.families.find(item => item.name === 'effect_queue')?.count
  observations.push({ id: 'NONEMPTY_SNAPSHOT_POSITIVE',
    status: created.status === 'ok' && control.status === 'ok' && effectCount === 1 ? 'PASS' : 'FAIL',
    observed: { created: created.status, verified: control.status, effectCount } })

  for (const mode of ['full-evidence', 'removed-effect-family', 'only-one-family']) {
    const copy = join(root, mode)
    cpSync(destination, copy, { recursive: true })
    const databasePath = join(copy, 'product.sqlite'), database = new Database(databasePath)
    try {
      database.prepare('UPDATE effect SET value = ? WHERE key = ?').run('{"workId":"foreign-work"}', 'owned-queue')
    } finally { database.close() }
    const manifestPath = join(copy, 'snapshot.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const bytes = readFileSync(databasePath)
    manifest.database.bytes = bytes.byteLength
    manifest.database.sha256 = createHash('sha256').update(bytes).digest('hex')
    if (mode === 'removed-effect-family') manifest.evidence.families = manifest.evidence.families.filter(item => item.name !== 'effect_queue')
    if (mode === 'only-one-family') manifest.evidence.families = manifest.evidence.families.slice(0, 1)
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    const verified = snapshots.verify(copy)
    observations.push({ id: mode, status: verified.status === 'blocked' ? 'PASS' : 'FAIL',
      observed: { verified: verified.status, familyCount: manifest.evidence.families.length,
        effectFamily: manifest.evidence.families.some(item => item.name === 'effect_queue') } })
  }
} finally {
  try { store?.close() } finally { rmSync(root, { recursive: true, force: true }) }
}

const report = { protocol: 'wave16-a-snapshot-admission/1', candidate, source,
  modelCalls: 0, nativeTurns: 0, observations,
  passed: observations.filter(item => item.status === 'PASS').length,
  failed: observations.filter(item => item.status === 'FAIL').length,
  scope: 'Candidate snapshot verification only; nonempty owned temporary SQLite, no startup authority or user resources' }
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.failed ? 1 : 0
