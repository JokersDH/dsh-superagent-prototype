import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runSuccessorReadback } from './successor2.mjs'

test('old process exits and a new process reads the same original Work/question/answer', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-successor-'))
  try {
    const report = await runSuccessorReadback({
      root,
      normalChild: join(import.meta.dirname, 'normal-child.mjs'),
      successorRead: join(import.meta.dirname, 'successor-read.mjs'),
    })
    const failed = Object.entries(report.checks).filter(([, ok]) => ok !== true)
    assert.deepEqual(failed, [], JSON.stringify(failed))
    assert.notEqual(report.producer.pid, report.successor.pid)
    assert.equal(report.successor.readback.delivery, 'native_applied')
    assert.match(report.bRecovery, /^NOT_REACHED/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
