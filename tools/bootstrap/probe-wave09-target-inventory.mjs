import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const candidate = process.argv[2]
if (!candidate || ![3, 5].includes(process.argv.length) || (process.argv.length === 5 && process.argv[3] !== '--output'))
  throw new Error('Usage: node tools/bootstrap/probe-wave09-target-inventory.mjs <candidate-root> [--output <report-path>]')
const sourceRoot = resolve(candidate)
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.argv[4] ? resolve(process.argv[4]) : join(repository, 'reports/releases/wave09-integration/recovery-inventory-admission.json')
const sourceFiles = ['packages/storage/src/target-inventory.ts', 'packages/storage/src/migrations.ts']
const sourceHash = path => createHash('sha256').update(fs.readFileSync(join(sourceRoot, path))).digest('hex')
const git = args => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim()
const root = fs.mkdtempSync(join(tmpdir(), 'pa-wave09-inventory-admission-'))
const cases = []
let report
try {
  const sourceCommit = git(['rev-parse', 'HEAD'])
  const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, sourceHash(path)]))
  const sourceWorktreeClean = git(['status', '--porcelain', '--', ...sourceFiles]) === ''
  // Load the candidate's actual TypeScript source and its own SQLite dependency, not stale dist.
  const load = path => import(pathToFileURL(join(sourceRoot, path)).href)
  const { recoveryTargetInventory } = await load(sourceFiles[0])
  const { applyMigrations, PRODUCT_SCHEMA_VERSION } = await load(sourceFiles[1])
  const require = createRequire(pathToFileURL(join(sourceRoot, 'packages/storage/package.json')))
  const Database = require('better-sqlite3')
  const currentTarget = name => {
    const target = join(root, name)
    fs.mkdirSync(target, { mode: 0o700 })
    const db = new Database(join(target, 'state.sqlite'))
    try { applyMigrations(db) } finally { db.close() }
    return target
  }
  const run = (id, action) => {
    try { cases.push({ id, status: 'PASS', ...action() }) }
    catch (error) { cases.push({ id, status: 'FAIL', message: error.message, ...(error.observation ? { observation: error.observation } : {}) }) }
  }
  const requireObservation = (pass, message, observation) => {
    if (pass) return
    const error = new Error(message)
    error.observation = observation
    throw error
  }
  run('CURRENT_EMPTY_SCHEMA_POSITIVE_CONTROL', () => {
    const target = currentTarget('control')
    const before = fs.readFileSync(join(target, 'state.sqlite'))
    const result = recoveryTargetInventory.inspect(target)
    assert.deepEqual(fs.readFileSync(join(target, 'state.sqlite')), before)
    requireObservation(result.completeness === 'complete' && result.integrity === 'ok' && result.issues.length === 0 &&
      result.productSchema === PRODUCT_SCHEMA_VERSION && result.databaseDigest?.length === 64 && result.startupAvailable === false &&
      result.tables.some(table => table.name === 'works' && table.category === 'business' && table.rows === 0),
    'A genuine empty migrated target must inventory completely without modifying it', result)
    return { completeness: result.completeness, tableCount: result.tables.length, issues: result.issues, startupAvailable: result.startupAvailable }
  })
  run('CLAIMED_SCHEMA_WITH_MISSING_BUSINESS_TABLES_REFUSES_COMPLETE', () => {
    const target = join(root, 'missing-tables')
    fs.mkdirSync(target, { mode: 0o700 })
    const db = new Database(join(target, 'state.sqlite'))
    try {
      db.exec('CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
      db.prepare('INSERT INTO schema_meta VALUES (?, ?)').run('product_schema', JSON.stringify(PRODUCT_SCHEMA_VERSION))
    } finally { db.close() }
    const result = recoveryTargetInventory.inspect(target)
    requireObservation(result.completeness !== 'complete' && result.issues.length > 0,
      'The claimed schema has no business tables; it must not be an empty complete target', result)
    return { completeness: result.completeness, issues: result.issues }
  })
  run('UNKNOWN_FTS_PREFIX_TABLE_IS_NOT_TRUSTED_METADATA', () => {
    const target = currentTarget('unknown-prefix')
    const db = new Database(join(target, 'state.sqlite'))
    try {
      db.exec('CREATE TABLE conversation_search_surprise (payload TEXT)')
      db.prepare('INSERT INTO conversation_search_surprise VALUES (?)').run('Legacy business residue')
    } finally { db.close() }
    const result = recoveryTargetInventory.inspect(target)
    const table = result.tables.find(row => row.name === 'conversation_search_surprise')
    requireObservation(result.completeness !== 'complete' && result.issues.includes('unknown_table') && table?.category === 'unknown',
      'An arbitrary table sharing the FTS prefix must be reported as unknown, including its row',
      { completeness: result.completeness, issues: result.issues, table })
    return { completeness: result.completeness, issues: result.issues, table }
  })
  run('RETURNED_DIGEST_BINDS_THE_ACTUALLY_INSPECTED_SNAPSHOT', () => {
    const target = currentTarget('digest-race'), path = join(target, 'state.sqlite')
    const original = fs.lstatSync
    let reads = 0, injected = false, result
    try {
      // Inject a committed metadata change after the old digest read but before copySnapshot's
      // first observation. Both per-operation observations are stable: only their binding is tested.
      fs.lstatSync = function (input, ...args) {
        if (input === path && ++reads === 2) {
          const db = new Database(path)
          try { db.prepare('INSERT INTO schema_meta VALUES (?, ?)').run('probe_snapshot_revision', 'changed') }
          finally { db.close() }
          injected = true
        }
        return original.call(this, input, ...args)
      }
      syncBuiltinESMExports()
      result = recoveryTargetInventory.inspect(target)
    } finally { fs.lstatSync = original; syncBuiltinESMExports() }
    assert.equal(injected, true, 'The race injection must actually execute')
    const stable = recoveryTargetInventory.inspect(target)
    assert.equal(stable.completeness, 'complete', 'The final current-schema DB must remain valid')
    const refused = result.completeness !== 'complete' || result.issues.includes('busy_or_changed') || result.databaseDigest === null
    requireObservation(refused || result.databaseDigest === stable.databaseDigest,
      'Complete inventory digest names bytes other than the inspected snapshot; refuse or bind the same snapshot',
      { injected, completeness: result.completeness, issues: result.issues,
        returnedDigest: result.databaseDigest, stableDigest: stable.databaseDigest })
    return { injected, completeness: result.completeness, issues: result.issues,
      returnedDigest: result.databaseDigest, stableDigest: stable.databaseDigest }
  })
  const pass = cases.length === 4 && cases.every(value => value.status === 'PASS')
  report = {
    status: pass ? 'PASS_RECOVERY_TARGET_INVENTORY_ADMISSION' : 'FAIL_RECOVERY_TARGET_INVENTORY_ADMISSION',
    command: ['node', 'tools/bootstrap/probe-wave09-target-inventory.mjs', sourceRoot, ...(process.argv[4] ? ['--output', output] : [])],
    sourceRoot, sourceCommit, sourceWorktreeClean, sourceHashes, checkedAt: new Date().toISOString(),
    exitCode: pass ? 0 : 1, cases, modelCalls: 0, nativeTurns: 0,
    sourceReferences: {
      tableCompleteness: 'packages/storage/src/target-inventory.ts:183',
      unknownPrefixClassification: 'packages/storage/src/target-inventory.ts:56',
      digestSnapshotBinding: 'packages/storage/src/target-inventory.ts:160',
    },
    limitations: [
      'Loads the candidate TypeScript source and its local SQLite dependency; no production source is edited.',
      'Temporary databases only; no real target materializer, writer process, activation or installation is exercised.',
      'The race uses an injected synchronous filesystem boundary, not a probabilistic concurrent process.',
      'A complete inventory still grants no startup authority and does not prove writer quiescence.',
      'Exact source line references describe the audited candidate and may move after a repair.',
    ],
  }
} catch (error) {
  report = { status: 'ERROR_RECOVERY_TARGET_INVENTORY_PROBE', command: ['node', 'tools/bootstrap/probe-wave09-target-inventory.mjs', sourceRoot, ...(process.argv[4] ? ['--output', output] : [])],
    checkedAt: new Date().toISOString(), exitCode: 2, cases, error: error.message, modelCalls: 0, nativeTurns: 0 }
} finally { fs.rmSync(root, { recursive: true, force: true }) }
fs.mkdirSync(dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
process.exitCode = report.exitCode
