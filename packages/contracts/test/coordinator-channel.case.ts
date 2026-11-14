import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CoordinatorChannelLimitsSchema, CoordinatorChannelProducerSchema, CoordinatorChannelReplySchema, CoordinatorChannelRequestSchema,
  CONTRACT_IDENTITY, parseCoordinatorChannelRequest, sameCoordinatorChannelProducer } from '../src/index.ts'
import { attempt, validFixtures } from './fixtures.ts'

const producer = { attempt, source: 'fixture', runnerIdentityRef: 'runner-1' }
const fact = { ...validFixtures.CriticalFact, source: producer.source }
const request = { v: 1, type: 'fact', id: fact.factId, fact }
test('channel producer matches every original tuple field and source, not merely ticket and epoch', () => {
  assert.equal(sameCoordinatorChannelProducer(producer, structuredClone(producer)), true)
  for (const change of [{ assignmentId: 'foreign' }, { attemptId: 'foreign' }, { fenceEpoch: 2 },
    { contract: { ...attempt.contract, digest: 'b'.repeat(64) } }])
    assert.equal(sameCoordinatorChannelProducer(producer, { ...producer, attempt: { ...attempt, ...change } }), false)
  assert.equal(sameCoordinatorChannelProducer(producer, { ...producer, source: 'foreign' }), false)
  assert.equal(CoordinatorChannelProducerSchema.safeParse({ ...producer, credential: 'private' }).success, false)
})
test('local channel requests retain existing bridge shapes and refuse cross-producer facts or native intent', () => {
  assert.deepEqual(parseCoordinatorChannelRequest(request, producer), request)
  assert.throws(() => parseCoordinatorChannelRequest({ ...request, fact: { ...fact, source: 'foreign' } }, producer))
  assert.throws(() => parseCoordinatorChannelRequest({ ...request, fact: { ...fact, assignmentId: 'foreign' } }, producer))
  assert.equal(CoordinatorChannelRequestSchema.safeParse({ ...request, id: 'wrong' }).success, false)
  assert.equal(CoordinatorChannelRequestSchema.safeParse({ v: 1, type: 'payload-read', id: 'read-1', requestId: 'read-1', reference: 'payload-1' }).success, true)
  const answer = { ...attempt, kind: 'answer' as const, id: 'command-1', nativeBindingRef: 'binding-1', answerRef: 'answer-1' }
  assert.equal(parseCoordinatorChannelRequest({ v: 1, type: 'native-write-intent', id: 'opaque-request-1', command: answer }, producer).type, 'native-write-intent')
  assert.throws(() => parseCoordinatorChannelRequest({ v: 1, type: 'native-write-intent', id: 'write-1', command: { ...answer, fenceEpoch: 2 } }, producer))
})
test('receipts and payload replies bind correlation; an admission reply never carries a reusable grant', () => {
  const receipt = { v: 1, type: 'receipt', id: fact.factId, factId: fact.factId, receipt: { factId: fact.factId, persisted: true, seq: 1 } }
  assert.equal(CoordinatorChannelReplySchema.safeParse(receipt).success, true)
  assert.equal(CoordinatorChannelReplySchema.safeParse({ ...receipt, receipt: { ...receipt.receipt, factId: 'foreign' } }).success, false)
  assert.equal(CoordinatorChannelReplySchema.safeParse({ v: 1, type: 'payload', id: 'p1', requestId: 'p2', value: null }).success, false)
  assert.equal(CoordinatorChannelReplySchema.safeParse({ v: 1, type: 'write-admission', id: 'w1', allowed: true }).success, true)
  assert.equal(CoordinatorChannelReplySchema.safeParse({ v: 1, type: 'write-admission', id: 'w1', allowed: true, grant: 'portable' }).success, false)
})
test('channel limits bound ephemeral waiters and bytes without defining a durable ledger', () => {
  const limits = { maxPendingFacts: 64, maxPendingPayloads: 16, maxPendingWrites: 16, maxPendingBytes: 1048576,
    maxPayloadBytes: 1048576, requestTimeoutMs: 5000, maxSettledRequests: 256 }
  assert.deepEqual(CoordinatorChannelLimitsSchema.parse(limits), limits)
  for (const change of [{ maxPendingWrites: 0 }, { requestTimeoutMs: Infinity }, { maxPendingBytes: 32 * 1024 * 1024 }])
    assert.equal(CoordinatorChannelLimitsSchema.safeParse({ ...limits, ...change }).success, false)
})
test('channel schema is an additive local input and preserves frozen Runner/data identity', () => {
  const manifest = JSON.parse(readFileSync(new URL('../generated/coordinator-channel.manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.runtimeContractSchemaHash, CONTRACT_IDENTITY.schemaHash)
  assert.equal(CONTRACT_IDENTITY.schemaHash, '74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d')
})
