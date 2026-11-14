/**
 * I18 — interface compatibility: the module is the shared interface, not a private dialect.
 *
 * The frozen contract identity and the v1 bridge protocol are asserted unchanged. This is a guard
 * against the channel quietly growing its own wire version, schema or identity while it consolidates
 * the three waiter maps.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { CONTRACT_IDENTITY } from '../../../../packages/contracts/src/identity.ts'
import {
  CoordinatorChannelLimitsSchema,
  CoordinatorChannelProducerSchema,
  CoordinatorChannelReplySchema,
  CoordinatorChannelRequestSchema,
} from '../../../../packages/contracts/src/coordinator-channel.ts'
import { RUNNER_BRIDGE_PROTOCOL } from '../../src/bridge-protocol.ts'
import * as entry from '../../src/attach-channel/index.ts'
import { makeCommand } from '../../../../packages/testing/src/index.ts'
import { factOf, LIMITS, makeHarness, PRODUCER } from './fixtures.ts'

test('the entry exports the shared contract schemas and one implementation, not a fork', () => {
  assert.equal(entry.CoordinatorChannelRequestSchema, CoordinatorChannelRequestSchema)
  assert.equal(entry.CoordinatorChannelReplySchema, CoordinatorChannelReplySchema)
  assert.equal(entry.CoordinatorChannelProducerSchema, CoordinatorChannelProducerSchema)
  assert.equal(entry.CoordinatorChannelLimitsSchema, CoordinatorChannelLimitsSchema)
  assert.equal(typeof entry.CoordinatorChannelModule, 'function')
  assert.equal(typeof entry.sameCoordinatorChannelProducer, 'function')
})

test('the frozen contract identity and v1 bridge protocol are untouched', () => {
  assert.equal(CONTRACT_IDENTITY.schemaHash, '74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d')
  assert.equal(RUNNER_BRIDGE_PROTOCOL, 1)
  const manifest = JSON.parse(readFileSync(new URL('../../../../packages/contracts/generated/coordinator-channel.manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.runtimeContractSchemaHash, CONTRACT_IDENTITY.schemaHash)
})

test('the module emits exactly the existing v1 request frames', async () => {
  const h = makeHarness()
  h.channel.recordFact(factOf({ factId: 'fact-wire' }))
  h.channel.readPayload('payload-wire')
  h.channel.beforeNativeWrite(makeCommand('answer', { id: 'cmd-wire' }))

  const frames = h.frames
  assert.deepEqual(frames.map(frame => [frame.v, frame.type, frame.id]), [
    [1, 'fact', 'fact-wire'],
    [1, 'payload-read', 'payload-1'],
    [1, 'native-write-intent', 'cmd-wire'],
  ])
  // Every frame is a valid shared-contract request and is frozen before it reaches the transport.
  for (const frame of frames) {
    assert.equal(CoordinatorChannelRequestSchema.safeParse(frame).success, true)
    assert.ok(Object.isFrozen(frame))
  }
})

test('a caller that typechecks against the shared interface needs no private surface', () => {
  const h = makeHarness()
  const usage = (channel: import('../../../../packages/contracts/src/coordinator-channel.ts').CoordinatorChannel): string => {
    const state = channel.inspect()
    channel.close('done')
    return state.state
  }
  assert.equal(usage(h.channel), 'bound')
  assert.equal(h.channel.inspect().state, 'closed')
  // The shared options type is exactly what the constructor accepts.
  const options: import('../../../../packages/contracts/src/coordinator-channel.ts').CoordinatorChannelOptions = {
    producer: PRODUCER,
    limits: LIMITS,
    now: h.clock.now,
    schedule: h.clock.schedule,
  }
  assert.equal(new entry.CoordinatorChannelModule(options).inspect().state, 'unbound')
})
