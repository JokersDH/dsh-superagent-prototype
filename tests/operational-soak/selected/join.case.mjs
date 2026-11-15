import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSameStoreReceiver } from './same-store-join2.mjs'

test('same original Store receiver join keeps original IDs and refuses foreign subjects before write', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-join-'))
  try {
    const report = await runSameStoreReceiver({ root })
    const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true)
    assert.deepEqual(failed, [], JSON.stringify(failed))
    assert.equal(report.counts.writes, 1)
    assert.equal(report.counts.receipts, 1)
    assert.match(report.original.workId, /^[a-f0-9]+$/)
    assert.match(report.original.questionId, /^[a-f0-9]+$/)
    assert.match(report.original.attemptId, /^attempt-/)
    assert.equal(report.readback.delivery, 'native_applied')
    assert.match(report.bCallbackJoin, /^NOT_REACHED/)
    assert.match(report.businessIngressJoin, /^NOT_REACHED/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
