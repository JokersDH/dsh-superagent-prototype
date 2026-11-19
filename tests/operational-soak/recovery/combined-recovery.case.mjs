import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCombined } from './combined-recovery2.mjs'

// Baseline for the remaining main gap: recovery/check/accept/artifacts and UNKNOWN retention pass,
// but the queued 3rd/5th original Work does not progress after the delivered target's own binding
// ends. If main fixes release, this test must be updated rather than silently passing.
test('combined same-run recovery + 2/4 capacity: delivery/UNKNOWN, original slot release and queued Work progression', { timeout: 90000 }, async () => {
  for (const capacity of [2, 4]) {
    const root = mkdtempSync(join(tmpdir(), `trial-combined-${capacity}-`))
    try {
      const report = await runCombined(capacity, root)
      const required = ['oneRunnerPerCapacityWork', 'targetReceiverBeginOnce', 'targetReceiverAnswerOnce', 'fillerNoAnswer', 'targetDelivered', 'targetQuestionAnswered', 'targetBindingEnded', 'fillerUnknownRetained', 'machineCheckPassed', 'candidateAssignmentMatches', 'exactCurrentCandidateEvidence', 'acceptanceRecorded', 'exactArtifactsReadable', 'nextWorkProgressed', 'noNewWork', 'nativeEffectOnlyTarget', 'commandRecorded']
      const failed = required.filter((key) => report.checks[key] !== true)
      assert.deepEqual(failed, [], `${capacity}: ${JSON.stringify({ failed, checks: report.checks })}`)
      assert.equal(report.successor.phase, 'delivered')
      assert.equal(report.readback.targetBinding, 'ended')
      assert.ok(['active', 'stopping'].includes(report.readback.fillerBinding))
      assert.equal(report.successor.held, 'held')
      assert.equal(report.checks.nextWorkProgressed, true)
      assert.equal(report.gap, null)
      assert.equal(report.successor.nextWorkId, report.original.nextWorkId)
      assert.equal(report.receiver.targetBegin, 1)
      assert.equal(report.receiver.targetAnswer, 1)
      assert.equal(report.receiver.fillerBegin, 1)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
})
