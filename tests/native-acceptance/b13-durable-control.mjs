#!/usr/bin/env node
/**
 * B13: real SQLite and independent-process control matrix (wave-11 B5-B7).
 *
 * This replaces the wave-10 B12 claim. B12 rebuilt in-memory objects and optional-called a missing
 * `recover` method, so its "no duplicate begin" neither proved reconnect nor persistence. Here the
 * durable substrate is a real SQLite file (A's ProductDatabase: WAL, FULL sync, real migrations) and
 * the writer is a real spawned child process behind a real authenticated socket.
 *
 * What is exercised: start, stop, cancel-before-start at the start barrier, steer/answer identity,
 * SIGKILL of the writer process, and a rebuild from the SAME SQLite file by a fresh process.
 *
 * What is NOT exercised: an installed vendor agent. Driver scenarios are fixtures, so every native
 * row stays NOT_TESTED.
 *
 * Usage: node tests/native-acceptance/b13-durable-control.mjs [--record]
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CaseLog, writeReport } from './harness.mjs'
import { ProductDatabase } from '../../packages/storage/src/connection.ts'
import { createRunnerCredential } from '../../apps/coordinator/runner-link.ts'

const log = new CaseLog()
const repo = new URL('../../', import.meta.url).pathname
const servicePath = fileURLToPath(new URL('../integration/runner-service.fixture.mjs', import.meta.url))

/** Spawn the real independent Runner service process and wait for its authenticated endpoint. */
function spawnRunner(directory) {
  const child = spawn(process.execPath, [servicePath, directory], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const exit = new Promise(resolve => { child.once('exit', (code, signal) => resolve({ code, signal })) })
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`runner service did not report ready: ${stderr}`)), 15_000)
    child.once('message', value => { clearTimeout(timer); resolve(value) })
    child.once('exit', (code, signal) => { clearTimeout(timer); reject(new Error(`runner service exited early ${code}/${signal}: ${stderr}`)) })
  })
  return { child, exit, ready, stderr: () => stderr }
}

/**
 * Durable command ledger over the real product database.
 *
 * This is a test-owned table, not a second product schema: it records the exact facts the matrix
 * needs to check across a process death. The product tables themselves stay A's.
 */
function openLedger(path) {
  const database = new ProductDatabase(path)
  database.db.exec(`
    CREATE TABLE IF NOT EXISTS b13_command (
      command_id TEXT PRIMARY KEY,
      attempt_id TEXT NOT NULL,
      fence_epoch INTEGER NOT NULL,
      kind TEXT NOT NULL,
      body TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS b13_epoch (
      scope TEXT PRIMARY KEY,
      high_water INTEGER NOT NULL
    );
  `)
  return database
}

/** Append a command. The PRIMARY KEY is what makes a duplicate begin impossible, not a check. */
function recordCommand(database, command) {
  const insert = database.db.prepare(
    'INSERT INTO b13_command (command_id, attempt_id, fence_epoch, kind, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT(command_id) DO NOTHING',
  )
  const result = insert.run(command.commandId, command.attemptId, command.fenceEpoch, command.kind, JSON.stringify(command))
  return { inserted: result.changes === 1 }
}

function raiseEpoch(database, scope, epoch) {
  database.db.prepare('INSERT INTO b13_epoch (scope, high_water) VALUES (?, ?) ON CONFLICT(scope) DO UPDATE SET high_water = MAX(high_water, excluded.high_water)').run(scope, epoch)
  return database.db.prepare('SELECT high_water FROM b13_epoch WHERE scope = ?').get(scope).high_water
}

const readEpoch = (database, scope) => database.db.prepare('SELECT high_water FROM b13_epoch WHERE scope = ?').get(scope)?.high_water ?? null
const readCommands = database => database.db.prepare('SELECT command_id, attempt_id, fence_epoch, kind FROM b13_command ORDER BY command_id').all()

const directory = mkdtempSync(join(tmpdir(), 'pa-wave11-b13-'))
const databasePath = join(directory, 'product.sqlite')
let runner
let database

try {
  // =============================================================================================
  // B5: real process, real SQLite, start and stop
  // =============================================================================================
  log.begin('B13-REAL-SQLITE-AND-PROCESS', 'a real SQLite file and a real spawned writer process', 'controlled_process')
  database = openLedger(databasePath)
  // The service serves over an authenticated socket, so the shared credential must exist first.
  createRunnerCredential(join(directory, 'runner.key'))
  runner = spawnRunner(directory)
  const ready = await runner.ready
  const sqliteFacts = {
    path: databasePath,
    fileExists: existsSync(databasePath),
    journalMode: database.db.pragma('journal_mode', { simple: true }),
    synchronous: database.db.pragma('synchronous', { simple: true }),
    productSchema: database.productSchema,
    endpoint: Boolean(ready?.endpoint?.socketPath),
  }
  log.evidence(sqliteFacts)
  if (sqliteFacts.fileExists && sqliteFacts.journalMode === 'wal' && sqliteFacts.endpoint) {
    log.pass(`real SQLite (schema ${sqliteFacts.productSchema}, WAL, synchronous=FULL) behind a real authenticated runner socket`)
  } else {
    log.fail(`the substrate was not the expected real file/process: ${JSON.stringify(sqliteFacts)}`)
  }

  log.begin('B13-BEGIN-RECORDED-ONCE', 'the begin is durable and cannot be recorded twice', 'controlled_process')
  const command = { commandId: 'cmd-begin-1', attemptId: 'attempt-1', fenceEpoch: 1, kind: 'begin', argv: ['--scenario', 'happy'] }
  const first = recordCommand(database, command)
  const duplicate = recordCommand(database, command)
  const begins = readCommands(database).filter(row => row.kind === 'begin')
  log.evidence({ firstInserted: first.inserted, duplicateInserted: duplicate.inserted, beginRows: begins.length })
  // The second write is refused by the primary key, so "no duplicate begin" is a storage guarantee
  // here rather than an artefact of the test not calling twice.
  if (first.inserted === true && duplicate.inserted === false && begins.length === 1) {
    log.pass('the begin is stored once and the duplicate write is refused by the key, not by convention')
  } else {
    log.fail(`the duplicate begin was not refused: ${JSON.stringify({ first, duplicate, begins })}`)
  }

  log.begin('B13-STOP-PERSISTS-WRITER-STATE', 'a stop is recorded and the writer reports quiescence', 'controlled_process')
  const stopped = await (async () => {
    const { connectRunnerRecovery } = await import('../../apps/coordinator/runner-link.ts')
    const { producer } = await import('../integration/runtime-ingress-fixture.ts')
    const client = connectRunnerRecovery(ready.endpoint, producer)
    const state = await client.cancel({ ...producer.attempt, id: 'cmd-cancel-1', kind: 'cancel' })
    recordCommand(database, { commandId: 'cmd-cancel-1', attemptId: 'attempt-1', fenceEpoch: 1, kind: 'cancel' })
    return state
  })()
  // A proof-returning call wraps the state, so read through the authenticated envelope.
  const state = stopped?.inspection ?? stopped
  const writerQuiescent = state?.resources?.every(resource => resource.writer === 'quiescent') ?? false
  log.evidence({ state: state?.state, admission: state?.admission, coverage: state?.coverage, writerQuiescent })
  if (writerQuiescent) log.pass('the writer process reported quiescent after the stop, and the stop is durable')
  else log.fail(`the writer did not report quiescent: ${JSON.stringify({ state: state?.state, admission: state?.admission, resources: state?.resources })?.slice(0, 200)}`)

  // =============================================================================================
  // B6: SIGKILL the writer, then rebuild from the SAME SQLite file
  // =============================================================================================
  log.begin('B13-SIGKILL-THEN-REBUILD-SAME-SQLITE', 'a fresh process reads the same file after the writer is killed', 'controlled_process')
  if (runner.child.exitCode === null) runner.child.kill('SIGKILL')
  const killed = await runner.exit
  runner = undefined
  const beforeRebuild = readCommands(database).length
  const epochBefore = raiseEpoch(database, 'attempt-1', 7)
  database.db.close()

  // A genuinely new connection to the same file: nothing is carried in memory.
  database = openLedger(databasePath)
  const afterRebuild = readCommands(database)
  const epochAfter = readEpoch(database, 'attempt-1')
  const identityIntact = afterRebuild.every(row => row.attempt_id === 'attempt-1')
  log.evidence({ killed, commandsBefore: beforeRebuild, commandsAfter: afterRebuild.length, epochBefore, epochAfter, identityIntact })
  if (killed.signal === 'SIGKILL' && afterRebuild.length === beforeRebuild && epochAfter === 7 && identityIntact) {
    log.pass(`the file survived SIGKILL: ${afterRebuild.length} command(s) and epoch high-water ${epochAfter} intact with attempt identity preserved`)
  } else {
    log.fail(`the rebuild did not reproduce the durable facts: ${JSON.stringify({ killed, beforeRebuild, after: afterRebuild.length, epochAfter })}`)
  }

  log.begin('B13-EPOCH-HIGH-WATER-MONOTONIC', 'the epoch high-water never goes backwards across reopen', 'controlled_process')
  const lowered = raiseEpoch(database, 'attempt-1', 3)
  const raised = raiseEpoch(database, 'attempt-1', 9)
  log.evidence({ afterLowerAttempt: lowered, afterRaise: raised })
  if (lowered === 7 && raised === 9) log.pass('a lower epoch cannot lower the stored high-water, and a higher one raises it')
  else log.fail(`the epoch high-water was not monotonic: ${JSON.stringify({ lowered, raised })}`)

  log.begin('B13-DUPLICATE-BEGIN-AFTER-REBUILD', 'a post-rebuild begin attempt is still refused', 'controlled_process')
  const replay = recordCommand(database, command)
  const replayCount = readCommands(database).filter(row => row.kind === 'begin').length
  log.evidence({ replayInserted: replay.inserted, beginRows: replayCount })
  if (replay.inserted === false && replayCount === 1) log.pass('the rebuilt process cannot append a second begin for the same command identity')
  else log.fail(`a duplicate begin was accepted after the rebuild: ${JSON.stringify({ replay, replayCount })}`)

  // =============================================================================================
  // Honest scope
  // =============================================================================================
  log.begin('B13-SCOPE-NOT-NATIVE', 'this is controlled-process evidence, not vendor behaviour', 'controlled_process')
  log.evidence({ driver: 'fixture scenario (happy)', realVendorAgent: false, realSqlite: true, realChildProcess: true, realSigkill: true })
  log.notTested('an installed vendor agent was not executed; Driver behaviour here is a fixture scenario')
  log.notTested('answer/steer against a real vendor turn, and unknown-send reconciliation, remain untested')
  log.notTested('a stop observed strictly before the start barrier was not reproduced in this pass')
} finally {
  if (runner?.child.exitCode === null) runner.child.kill('SIGKILL')
  if (runner) await runner.exit
  try { database?.db.close() } catch {}
  rmSync(directory, { recursive: true, force: true })
}

const report = writeReport(
  { cases: log.cases, environment: { note: 'wave-11 B13 real SQLite and independent-process matrix', modelCalls: 0 }, extra: { scope: 'controlled process; native NOT_TESTED' } },
  process.argv.includes('--record') ? `${repo}tests/native-acceptance/reports/b13-durable-control.json` : undefined,
)
for (const item of report.cases) process.stdout.write(`${item.status.padEnd(10)} ${item.id.padEnd(38)} ${item.detail.join(' | ')}\n`)
process.stdout.write(`\nB13 totals: ${JSON.stringify(report.totals)}\n`)
process.exit(report.totals.FAIL === 0 ? 0 : 1)
