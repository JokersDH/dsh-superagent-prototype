import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CommandQueue, DriverError } from '../src/index.ts'
import { makeCommand } from '../../testing/src/fixtures.ts'

test('keeps FIFO order among commands of the same priority', async () => {
  const queue = new CommandQueue()
  queue.push(makeCommand('begin'))
  queue.push(makeCommand('deliver'))
  const iterator = queue[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value?.kind, 'begin')
  assert.equal((await iterator.next()).value?.kind, 'deliver')
  queue.close()
  assert.equal((await iterator.next()).done, true)
})

test('cancel jumps ahead of queued business commands', async () => {
  const queue = new CommandQueue()
  queue.push(makeCommand('begin'))
  queue.push(makeCommand('deliver'))
  queue.push(makeCommand('cancel'))
  const iterator = queue[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value?.kind, 'cancel')
  assert.equal((await iterator.next()).value?.kind, 'begin')
  assert.equal((await iterator.next()).value?.kind, 'deliver')
  queue.close()
})

test('answer outranks business commands but not cancel', async () => {
  const queue = new CommandQueue()
  queue.push(makeCommand('begin'))
  queue.push(makeCommand('answer'))
  queue.push(makeCommand('cancel'))
  const iterator = queue[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value?.kind, 'cancel')
  assert.equal((await iterator.next()).value?.kind, 'answer')
  assert.equal((await iterator.next()).value?.kind, 'begin')
  queue.close()
})

test('a waiting consumer is woken by a later push', async () => {
  const queue = new CommandQueue()
  const iterator = queue[Symbol.asyncIterator]()
  const pending = iterator.next()
  queue.push(makeCommand('cancel'))
  const result = await pending
  assert.equal(result.value?.kind, 'cancel')
  queue.close()
})

test('a full queue fails a push with a stable state_indeterminate error', () => {
  const queue = new CommandQueue({ maxPending: 2 })
  queue.push(makeCommand('begin'))
  queue.push(makeCommand('deliver'))
  assert.throws(
    () => queue.push(makeCommand('cancel')),
    error => error instanceof DriverError && error.code === 'state_indeterminate' && error.reason === 'command_queue_full',
  )
  queue.close()
})

test('close drains pending commands before ending the iterator', async () => {
  const queue = new CommandQueue()
  queue.push(makeCommand('deliver'))
  queue.close('attempt_ended')
  const iterator = queue[Symbol.asyncIterator]()
  assert.equal((await iterator.next()).value?.kind, 'deliver')
  assert.equal((await iterator.next()).done, true)
  assert.throws(() => queue.push(makeCommand('begin')), error => error instanceof DriverError && error.reason === 'command_queue_closed')
})
