import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runOriginalIngress } from './original-ingress2.mjs'

test('original Application/QuestionBroker/A readback keeps one Work/question/answer/attempt/native_applied fixture', async () => {
  const root = mkdtempSync(join(tmpdir(), 'trial-original-'))
  try {
    const readback = await runOriginalIngress({ root })
    const failed = Object.entries(readback.checks).filter(([, ok]) => ok !== true)
    assert.deepEqual(failed, [], `failed: ${JSON.stringify(failed)}`)
    assert.equal(readback.modelCalls, 0)
    assert.equal(readback.vendorTurns, 0)
    assert.match(readback.workId, /^[a-f0-9]+$/)
    assert.match(readback.questionId, /^[a-f0-9]+$/)
    assert.match(readback.answerId, /^[a-f0-9]+$/)
    assert.match(readback.attemptId, /^attempt-/)
    assert.equal(readback.answer.expectedVersion, 1)
    assert.ok(readback.deliveries.length >= 1)
    assert.ok(readback.deliveries.every((delivery) => delivery.status === 'native_applied'))
    assert.match(readback.businessIngressJoin, /^NOT_REACHED/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
