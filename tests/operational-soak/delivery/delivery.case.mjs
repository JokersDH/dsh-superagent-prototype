/**
 * Original delivery/candidate/accept controls on the admitted controlled fixture path.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const PRODUCE = join(import.meta.dirname, 'produce.mjs')

function run(args) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [PRODUCE, ...args], { env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('close', (code) => resolvePromise({ status: code, stdout, stderr }))
  })
}

test('normal candidate/accept/delivered and 2/4 controlled works', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-delivery-'))
  const out = join(root, 'run')
  try {
    const produced = await run(['--out', out])
    assert.equal(produced.status, 0, produced.stderr)
    const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
    assert.equal(report.ok, true)
    assert.equal(report.modelCalls, 0)
    assert.equal(report.signalsSent, 0)
    const delivery = JSON.parse(readFileSync(join(out, 'delivery.json'), 'utf8'))
    assert.equal(delivery.checks.normalAnswered, true)
    assert.equal(delivery.checks.normalCandidate, true)
    assert.equal(delivery.checks.normalAccepted, true)
    assert.equal(delivery.checks.wrongCandidateRefused, true)
    assert.equal(delivery.checks.delivered, true)
    assert.equal(delivery.checks.workViewIdentity, true)
    assert.equal(delivery.normal.workViewId, delivery.normal.workId)
    assert.equal(delivery.normal.answerDelivery, 'native_applied')
    assert.equal(delivery.normal.currentCandidate.candidateGeneration > 0, true)
    assert.equal(delivery.normal.artifactCount, 4)
    assert.equal(delivery.normal.wrongCandidateError, 'verification_failed')
    assert.equal(delivery.checks.answerReplayIdempotent, true)
    assert.equal(delivery.checks.answerConflictRejected, true)
    assert.equal(delivery.checks.duplicateAcceptIdempotent, true)
    assert.equal(delivery.checks.beginReplayIdempotent, true)
    assert.equal(delivery.beginReplay.workCount, 1)
    assert.equal(delivery.beginReplay.sameWork, true)
    assert.equal(delivery.slots['2'].delivered, 2)
    assert.equal(delivery.slots['2'].beginFrames, 2)
    assert.equal(delivery.slots['4'].delivered, 4)
    assert.equal(delivery.slots['4'].beginFrames, 4)
    assert.equal(delivery.slots['4'].slotCapObserved, 'not_configurable_in_fixture')
    assert.ok(delivery.notReached.some((entry) => entry.includes('native 2/4 slot')))
    assert.ok(!readFileSync(join(out, 'report.json'), 'utf8').includes(process.env.HOME ?? '/Users/'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
