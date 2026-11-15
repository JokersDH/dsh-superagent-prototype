/**
 * Selected-source consumer controls: exact I/B materialization, actual module semantics, the known I
 * fresh-intent defect, wrong-root/hash refusal and post-run byte identity.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { EXPECTED, verifyCommitted, verifyMaterialized } from './source.mjs'

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

test('runs the admitted I and B modules with exact source binding', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-selected-'))
  const out = join(root, 'run')
  try {
    const produced = await run(PRODUCE, ['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const source = JSON.parse(readFileSync(join(out, 'source.json'), 'utf8'))
    assert.equal(source.ok, true)
    assert.equal(source.committed.I.commit, EXPECTED.I.commit)
    assert.equal(source.committed.B.commit, EXPECTED.B.commit)
    assert.ok(Number.isInteger(source.committed.I.dirtyEntries), 'the owner worktree dirty count is recorded')

    const i = JSON.parse(readFileSync(join(out, 'i.json'), 'utf8'))
    assert.equal(i.checks.factReceipt, true)
    assert.equal(i.checks.ackFailed, true)
    assert.equal(i.checks.payload, true)
    assert.equal(i.checks.writeAllow, true)
    assert.equal(i.checks.writeDeny, true)
    assert.equal(i.checks.generation, true)
    assert.equal(i.checks.oldLease, true)
    assert.equal(i.checks.timeout, true)
    assert.equal(i.checks.capacity, true)
    assert.equal(i.checks.close, true)
    assert.equal(i.checks.freshIntentDefectObserved, true)
    const fresh = i.cases.find((entry) => entry.id === 'I-fresh-intent')
    assert.equal(fresh.sameFrameId, true, 'the defect is that both intents reuse command.id')
    assert.equal(fresh.replayAccepted, true)

    const b = JSON.parse(readFileSync(join(out, 'b.json'), 'utf8'))
    assert.equal(Object.values(b.checks).every(Boolean), true)
    assert.equal(b.observations.hasExpectedGenerationCas, false)
    assert.equal(b.observations.leaseRebind.startsWith('implicit'), true)

    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.signalsSent, 0)
    assert.ok(report.notReached.some((entry) => entry.includes('SIGKILL')))

    const read = await run(READ, ['--run', out])
    assert.equal(read.status, 0, read.stderr)
    assert.match(read.stdout, /selected-read: OK/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a wrong root or a changed committed blob is refused before any consumer runs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-selected-wrong-'))
  try {
    const wrong = await run(PRODUCE, ['--out', join(root, 'a'), '--i-root', '/Users/hh/Desktop/joker/superagent-agent-b'])
    assert.equal(wrong.status, 2)
    assert.match(wrong.stderr, /REFUSED selected source/)
    assert.equal(existsSync(join(root, 'a', 'i.json')), false, 'no consumer output after a source refusal')

    const forged = verifyCommitted({ role: 'I', root: '/Users/hh/Desktop/joker/superagent-agent-i', commit: EXPECTED.I.commit, blobs: { 'apps/runner/src/attach-channel/index.ts': 'f'.repeat(40) } })
    assert.equal(forged.ok, false)
    assert.ok(forged.issues.some((issue) => issue.endsWith('blob_mismatch')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('materialized bytes that change after import are detected', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-selected-tamper-'))
  const out = join(root, 'run')
  try {
    const produced = await run(PRODUCE, ['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const target = join(out, 'source', 'B', 'apps/runner/src/business-channel.ts')
    const original = readFileSync(target)
    writeFileSync(target, Buffer.concat([original, Buffer.from('\n// tampered\n')]))
    const check = verifyMaterialized(join(out, 'source', 'B'), EXPECTED.B.materialize)
    assert.equal(check.ok, false)
    assert.ok(check.issues.some((issue) => issue.endsWith('sha256_mismatch')))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
