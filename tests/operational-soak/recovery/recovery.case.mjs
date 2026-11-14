/**
 * Recovery-support controls: one legal zero-model package, its public-reader agreement, journal
 * negative refusals, recovery-port faults and the explicit NOT_REACHED business-resume boundary.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { readJournalFacts } from './journal.mjs'

const PRODUCE = join(import.meta.dirname, 'produce.mjs')
const READ = join(import.meta.dirname, 'read.mjs')

function run(cli, args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [cli, ...args], { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolvePromise({ status: code, stdout, stderr }))
  })
}

test('produces a legal zero-model chain, journal and recovery-port recipe', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-recovery-'))
  const out = join(root, 'run')
  try {
    const produced = await run(PRODUCE, ['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    assert.equal(report.modelCalls, 0)
    assert.equal(report.vendorTurns, 0)
    assert.equal(report.executor, 'controlled_fixture')
    assert.equal(report.subject.nativeApplied, true)
    assert.equal(report.subject.deliveryStatus, 'native_applied')
    assert.match(report.subject.workId, /^[a-f0-9]+$/)
    assert.match(report.subject.attempt.attemptId, /^attempt-/)
    assert.equal(report.results.chainRead, true)
    assert.equal(report.results.journal.verdict, 'EXPECTED_REFUSALS')
    assert.equal(report.results.journal.negatives.length, 7)
    assert.ok(report.results.journal.negatives.every((entry) => entry.sends === 0 && entry.executes === 0))
    assert.deepEqual(report.results.recoveryPort.faults.map((fault) => fault.actual), ['auth_failed', 'identity_mismatch', 'identity_mismatch', 'timeout', 'stale_proof'])
    assert.equal(report.results.recoveryPort.faultsOk, true)
    assert.match(report.businessResume, /NOT_REACHED/)
    assert.equal(report.sends, 0)
    assert.equal(report.executes, 0)

    const journal = JSON.parse(readFileSync(join(out, 'journal.json'), 'utf8'))
    assert.equal(journal.summary.expected.entries, 5)
    assert.deepEqual(journal.summary.expected.kinds, ['turn.ended', 'answer.observed', 'candidate.observed', 'runtime.exited', 'usage.observed'])
    assert.equal(journal.summary.sha256.length, 64)

    const read = await run(READ, ['--run', out])
    assert.equal(read.status, 0, read.stderr)
    assert.match(read.stdout, /recovery-read: OK/)
    assert.match(read.stdout, /business resume: NOT_REACHED/)

    // A tampered journal byte is refused by the same reader.
    const journalPath = join(out, 'journal', 'critical.ndjson')
    const bytes = readFileSync(journalPath)
    bytes[bytes.byteLength - 5] = bytes[bytes.byteLength - 5] ^ 0x01
    writeFileSync(journalPath, bytes)
    const tampered = await run(READ, ['--run', out])
    assert.equal(tampered.status, 1)
    assert.match(tampered.stdout, /DIFF/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a foreign journal source is refused with zero sends', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-recovery-foreign-'))
  try {
    const out = join(root, 'run')
    const produced = await run(PRODUCE, ['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const facts = JSON.parse(readFileSync(join(out, 'normal.json'), 'utf8'))
    const journalPath = join(out, 'journal', 'critical.ndjson')
    const accepted = readJournalFacts({ journalPath, expectedSource: facts.factSource, expectedAttempt: facts.attempt })
    assert.equal(accepted.ok, true)
    assert.equal(accepted.entries, 5)
    const refused = readJournalFacts({ journalPath, expectedSource: 'foreign-source-wave26', expectedAttempt: facts.attempt })
    assert.equal(refused.ok, false)
    assert.equal(refused.code, 'foreign_source')
    assert.equal(refused.sends, 0)
    assert.equal(refused.executes, 0)
    const wrongAttempt = readJournalFacts({ journalPath, expectedSource: facts.factSource, expectedAttempt: { ...facts.attempt, attemptId: 'attempt-foreign' } })
    assert.equal(wrongAttempt.ok, false)
    assert.equal(wrongAttempt.code, 'attempt_mismatch')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('prototype extraction is not used as authority: produced state stays in the fixture root', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-recovery-bound-'))
  try {
    const out = join(root, 'run')
    const produced = await run(PRODUCE, ['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    assert.equal(report.root, out)
    assert.equal(report.entries.reader, 'read.json')
    assert.equal(report.businessResume.startsWith('NOT_REACHED'), true)
    // No personal root or credential path is referenced by the fixture material.
    const serialized = readFileSync(join(out, 'report.json'), 'utf8')
    assert.ok(!serialized.includes(process.env.HOME ?? '/Users/'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
