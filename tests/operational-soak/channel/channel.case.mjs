/**
 * Wave-27 channel consumer controls: legal CoordinatorChannel frames, actual B bridge callbacks
 * (fact ACK sink, payload reader, native-write guard), refused negatives, and the explicit
 * NOT_REACHED attach-channel/SIGKILL boundary.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

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

test('produces legal frames and actual three-consumer evidence', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-channel-'))
  const out = join(root, 'run')
  try {
    const produced = await run(PRODUCE, ['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.vendorTurns, 0)
    assert.equal(report.signalsSent, 0)
    assert.equal(report.frames.negatives.every((entry) => entry.refused && entry.sends === 0 && entry.executes === 0), true)
    assert.equal(report.frames.replyNegatives.every((entry) => entry.refused), true)
    assert.equal(report.consumers.allow.counts.factFrames, 3)
    assert.equal(report.consumers.allow.counts.receiptsSent, 2)
    assert.equal(report.consumers.allow.counts.ackFailedSent, 1)
    assert.equal(report.consumers.allow.observed.duplicateReceiptSameSeq, true)
    assert.equal(report.consumers.allow.counts.payloadReadsResolved, 1)
    assert.equal(report.consumers.allow.observed.payload.kind, 'coordinator-payload/1')
    assert.equal(report.consumers.allow.counts.writeIntentFrames, 1)
    assert.equal(report.consumers.allow.observed.admittedWrite, true)
    assert.equal(report.consumers.deny.counts.writeIntentFrames, 1)
    assert.equal(report.consumers.deny.counts.writeDenied, 1)
    assert.equal(report.consumers.deny.observed.admittedWrite, false)
    assert.match(report.consumers.deny.observed.writeDeniedReason, /refused/)
    assert.ok(report.surfaces.notReached.some((entry) => entry.includes('attach-channel')))
    assert.ok(report.surfaces.notReached.some((entry) => entry.includes('same-Runner dual client')))
    assert.ok(report.surfaces.notReached.some((entry) => entry.includes('SIGKILL')))

    const read = await run(READ, ['--run', out])
    assert.equal(read.status, 0, read.stderr)
    assert.match(read.stdout, /channel-read: OK/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a tampered negative that becomes legal is detected by the reader', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-channel-tamper-'))
  const out = join(root, 'run')
  try {
    const produced = await run(PRODUCE, ['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const framesPath = join(out, 'frames.json')
    const frames = JSON.parse(readFileSync(framesPath, 'utf8'))
    const wrongSource = frames.negatives.find((entry) => entry.name === 'wrong_source')
    wrongSource.value.fact.source = frames.producer.source
    writeFileSync(framesPath, `${JSON.stringify(frames, null, 2)}\n`)
    const read = await run(READ, ['--run', out])
    assert.equal(read.status, 1)
    assert.match(read.stdout, /DIFF/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('generation/CAS/late/close/capacity are recorded as contract scenarios, not simulated', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-channel-contract-'))
  const out = join(root, 'run')
  try {
    const produced = await run(PRODUCE, ['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    const ids = report.frames.contractScenarios.map((entry) => entry.id)
    for (const id of ['first_bind', 'second_bind', 'cas_conflict', 'negative_generation', 'old_lease_reply', 'old_lease_close', 'late_reply', 'capacity_facts', 'capacity_bytes', 'close_pending', 'indeterminate_write'])
      assert.ok(ids.includes(id), `missing contract scenario ${id}`)
    assert.equal(report.surfaces.contractOnly.includes('CoordinatorChannel'), true)
    const serialized = readFileSync(join(out, 'report.json'), 'utf8')
    assert.ok(!serialized.includes(process.env.HOME ?? '/Users/'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
