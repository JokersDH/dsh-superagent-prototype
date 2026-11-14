/** Wave-25 A2: the runtime expectation parser refuses unknown, malformed and incomplete input. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDataSubjectExpectation } from '../src/index.ts'

const valid = {
  sourceSha: 'a'.repeat(40), snapshotFormat: 1 as const, dataRoot: '/tmp/state',
  ticketId: 'ticket-one', assignmentId: 'assignment-one', attemptId: 'attempt-one', fenceEpoch: 1,
  contract: { workId: 'work-one', revision: 1, digest: 'b'.repeat(64) },
  questionId: 'question-one', answerId: 'answer-one',
  requiredCommandIds: ['command-one'], requiredDispatch: [{ commandId: 'command-one', target: 'target-one' }],
  requiredDeliveryTargets: ['target-one'],
}

test('an independent expectation is parsed strictly and every incomplete or foreign variant is refused', () => {
  const parsed = parseDataSubjectExpectation(structuredClone(valid))
  assert.equal(parsed.ticketId, 'ticket-one'); assert.equal(parsed.snapshotFormat, 1)
  assert.deepEqual(parsed.requiredDispatch, [{ commandId: 'command-one', target: 'target-one' }])
  const invalid: [string, unknown][] = [
    ['unknown top-level field', { ...valid, extra: true }],
    ['unknown contract field', { ...valid, contract: { ...valid.contract, extra: true } }],
    ['snapshot format three', { ...valid, snapshotFormat: 3 }],
    ['bad source sha', { ...valid, sourceSha: 'not-a-sha' }],
    ['bad ticket id', { ...valid, ticketId: 'bad id!' }],
    ['zero epoch', { ...valid, fenceEpoch: 0 }],
    ['bad contract digest', { ...valid, contract: { ...valid.contract, digest: 'c'.repeat(63) } }],
    ['empty commands', { ...valid, requiredCommandIds: [] }],
    ['empty delivery targets', { ...valid, requiredDeliveryTargets: [] }],
    ['empty dispatch', { ...valid, requiredDispatch: [] }],
    ['dispatch unknown field', { ...valid, requiredDispatch: [{ commandId: 'command-one', target: 'target-one', extra: 1 }] }],
    ['unknown limit', { ...valid, limits: { maxCommands: 1, extra: 2 } }],
    ['not an object', 'expectation'],
  ]
  for (const [name, value] of invalid) {
    assert.throws(() => parseDataSubjectExpectation(value), Error, name)
  }
  console.log('WAVE25_EXPECTATION_REFUSALS', JSON.stringify({ accepted: 'strict', refused: invalid.map(([name]) => name) }))
})
