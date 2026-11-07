/**
 * Executable assertions over the same probe code paths that produce the evidence files.
 * Run with the release runtime to validate the proposed combination:
 *
 *   .cache/runtimes/node-v24.22.2-darwin-arm64/bin/node --test test/probes.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { makeTempDir } from '../src/lib/util.mjs'
import { MIN_SQLITE, run as runEnv } from '../src/probes/env.mjs'
import { run as runTx } from '../src/probes/tx.mjs'
import { run as runBackup } from '../src/probes/backup.mjs'
import { run as runCrash } from '../src/probes/crash.mjs'
import { atLeast } from '../src/lib/util.mjs'

const failures = result => result.checks.filter(item => item.status === 'FAIL').map(item => `${item.id}: ${item.detail}`)
const assertProbe = (result, label) => assert.equal(result.ok, true, `${label} failed:\n${failures(result).join('\n')}`)

test('native binding loads and meets the SQLite admission', async () => {
  const result = await runEnv()
  assertProbe(result, 'env')
  assert.ok(atLeast(result.facts.sqlite.version, MIN_SQLITE), `sqlite ${result.facts.sqlite.version} < ${MIN_SQLITE}`)
  assert.equal(result.facts.binding.hostPrebuildPresent, true, 'host prebuild missing from the installed package')
  assert.equal(result.facts.binding.localBuildDirectoryPresent, false, 'a node-gyp build directory exists; prebuild was not used')
  assert.equal(result.facts.binding.version, '13.0.3')
})

test('transaction semantics: WAL, foreign keys, unique, rollback, nested savepoint, breakpoint', async () => {
  const dir = await makeTempDir('g0b-test-tx-')
  const result = await runTx({ dir })
  assertProbe(result, 'tx')
  assert.equal(result.facts.pragmas.journalMode, 'wal')
  assert.equal(result.facts.committed.effect, 1)
  assert.deepEqual(result.facts.rolledBackAtBreakpoint, { ticket: 0, effect: 0, receipt: 0 })
})

test('backup and restore into a new directory stays consistent', async () => {
  const dir = await makeTempDir('g0b-test-backup-')
  const result = await runBackup({ dir })
  assertProbe(result, 'backup')
  assert.equal(result.facts.restored.integrity, 'ok')
  assert.equal(result.facts.restored.foreignKeyViolations, 0)
  assert.ok(result.facts.restored.parents >= 200)
})

test('a committed write survives SIGKILL and an open transaction does not', async () => {
  const dir = await makeTempDir('g0b-test-crash-')
  const result = await runCrash({ dir })
  assertProbe(result, 'crash')
  assert.equal(result.facts.committedCase.recoveredRows.length, 1)
  assert.equal(result.facts.uncommittedCase.recoveredRows.length, 0)
})
