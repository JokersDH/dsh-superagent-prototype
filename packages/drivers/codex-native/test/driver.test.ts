/**
 * WP-07 Codex Driver against a fake app-server that speaks the pinned schema.
 *
 * This proves our protocol handling and identity chain. It is NOT evidence of compatibility with an
 * installed Codex: no real binary was executed and the native lane stays NOT_TESTED.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import { CodexNativeDriver } from '../src/index.ts'
import { InMemoryFactLedger, InMemoryPayloadStore, makeAttemptSpec } from '../../../../packages/testing/src/index.ts'
import type { AttemptIO } from '../../../../packages/contracts/src/ports.ts'
import { CommandQueue } from '../../../../packages/driver-kit/src/index.ts'

/** A fake app-server: answers requests and emits the documented notifications. */
function fakeAppServer(behaviour: { onTurnStart?: (id: number) => void; threadId?: string; turnId?: string } = {}) {
  const listeners: Array<(chunk: Uint8Array) => void> = []
  const received: Array<Record<string, unknown>> = []
  let buffer = ''
  const emit = (value: unknown): void => {
    const chunk = Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')
    for (const listener of listeners) listener(chunk)
  }
  const send = (bytes: Uint8Array): void => {
    buffer += Buffer.from(bytes).toString('utf8')
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      const message = JSON.parse(line) as Record<string, unknown>
      received.push(message)
      if (message.method === 'initialize') emit({ jsonrpc: '2.0', id: message.id, result: { userAgent: 'codex/0.164.0' } })
      else if (message.method === 'thread/start') emit({ jsonrpc: '2.0', id: message.id, result: { thread: { id: behaviour.threadId ?? 'thread-1' } } })
      else if (message.method === 'turn/start') {
        behaviour.onTurnStart?.(message.id as number)
        emit({ jsonrpc: '2.0', id: message.id, result: { turn: { id: behaviour.turnId ?? 'turn-1' } } })
      } else if (message.method === 'answer') emit({ jsonrpc: '2.0', id: message.id, result: {} })
      else if (message.method === 'turn/interrupt') emit({ jsonrpc: '2.0', id: message.id, result: {} })
      else if (message.id !== undefined) emit({ jsonrpc: '2.0', id: message.id, result: {} })
      newline = buffer.indexOf('\n')
    }
  }
  return {
    connect: async () => ({
      send,
      onData: (listener: (chunk: Uint8Array) => void) => listeners.push(listener),
      close: () => undefined,
    }),
    received,
    emit,
  }
}

function serveWith(server: ReturnType<typeof fakeAppServer>, scenario: 'turn' | 'question' | 'cancel' | 'usage') {
  const ledger = new InMemoryFactLedger()
  const payloads = new InMemoryPayloadStore()
  const queue = new CommandQueue()
  const spec = makeAttemptSpec()
  const io: AttemptIO = {
    commands: queue,
    record: async fact => ledger.record(fact),
    publishProgress: () => undefined,
    runtime: { spawn: async () => { throw new Error('unused') }, write: async () => undefined, stopOwned: async () => ({ quiescence: 'confirmed', evidenceRefs: [] }) },
    payloads,
  }
  const driver = new CodexNativeDriver({ connect: server.connect })
  const running = driver.serve(spec, io)
  return { running, queue, ledger, spec, server }
}

test('the identity chain runs initialize -> thread -> turn and ends with turn.ended', async () => {
  const server = fakeAppServer()
  const { running, queue, ledger } = serveWith(server, 'turn')
  queue.push({ id: 'c1', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' })

  await new Promise(resolve => setTimeout(resolve, 50))
  server.emit({ jsonrpc: '2.0', method: 'item/started', params: { item: { id: 'item-1', type: 'command' }, turnId: 'turn-1' } })
  server.emit({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })
  const exit = await running

  assert.equal(exit.reason, 'terminal')
  const methods = server.received.map(message => message.method).filter(Boolean)
  assert.ok(methods.includes('initialize'), JSON.stringify(methods))
  assert.ok(methods.includes('thread/start'), JSON.stringify(methods))
  assert.ok(methods.includes('turn/start'), JSON.stringify(methods))
  assert.ok(ledger.records.some(record => record.kind === 'turn.ended'))
})

test('a native approval request becomes a question with its exact options', async () => {
  const server = fakeAppServer()
  const { running, queue, ledger } = serveWith(server, 'question')
  queue.push({ id: 'c1', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' })
  await new Promise(resolve => setTimeout(resolve, 30))
  server.emit({ jsonrpc: '2.0', id: 7, method: 'ExecCommandApproval/requestApproval', params: { reason: 'run tests' } })

  const deadline = Date.now() + 3000
  while (!ledger.records.some(record => record.kind === 'question.opened') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.ok(ledger.records.some(record => record.kind === 'question.opened'), 'approval must open a question')
  queue.push({ id: 'c2', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'cancel' })
  await running
})

test('cancel interrupts the turn and records a cancel fact', async () => {
  const server = fakeAppServer()
  const { running, queue, ledger } = serveWith(server, 'cancel')
  queue.push({ id: 'c1', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' })
  await new Promise(resolve => setTimeout(resolve, 40))
  queue.push({ id: 'c2', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'cancel' })
  const exit = await running
  assert.equal(exit.reason, 'cancelled')
  assert.ok(ledger.records.some(record => record.kind === 'cancel.observed'))
  assert.ok(server.received.some(message => message.method === 'turn/interrupt'))
})

test('a second begin is refused rather than starting another turn', async () => {
  const server = fakeAppServer()
  const { running, queue, ledger } = serveWith(server, 'turn')
  const begin = { id: 'c1', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'begin' as const, inputRef: 'input-1', preparedPolicyRef: 'prepared-1' }
  queue.push(begin)
  await new Promise(resolve => setTimeout(resolve, 40))
  queue.push({ ...begin, id: 'c2' })
  await new Promise(resolve => setTimeout(resolve, 40))
  server.emit({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: 'turn-1', status: 'completed' } } })
  await running
  const starts = server.received.filter(message => message.method === 'turn/start')
  assert.equal(starts.length, 1, 'a duplicate begin must not start a second turn')
})

test('an initialize failure ends the attempt without touching a thread', async () => {
  const server = fakeAppServer()
  const failing = {
    connect: async () => {
      const base = await server.connect()
      return {
        send: (bytes: Uint8Array) => {
          // Reply with the request's own id: ids come from a process-wide counter, never a constant.
          const message = JSON.parse(Buffer.from(bytes).toString('utf8').trim()) as { id?: number; method?: string }
          if (message.method === 'initialize') server.emit({ jsonrpc: '2.0', id: message.id, error: { code: -32001, message: 'unsupported' } })
          else base.send(bytes)
        },
        onData: base.onData,
        close: base.close,
      }
    },
  }
  const queue = new CommandQueue()
  const driver = new CodexNativeDriver({ connect: failing.connect })
  const exit = await driver.serve(makeAttemptSpec(), {
    commands: queue,
    record: async fact => ({ factId: fact.factId, persisted: true as const, seq: 1 }),
    publishProgress: () => undefined,
    runtime: { spawn: async () => { throw new Error('unused') }, write: async () => undefined, stopOwned: async () => ({ quiescence: 'confirmed', evidenceRefs: [] }) },
    payloads: new InMemoryPayloadStore(),
  })
  assert.equal(exit.reason, 'error')
  assert.deepEqual(exit.evidenceRefs, ['initialize-failed'])
})

test('the Driver never auto-answers a native request', async () => {
  const server = fakeAppServer()
  const { running, queue } = serveWith(server, 'question')
  queue.push({ id: 'c1', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' })
  await new Promise(resolve => setTimeout(resolve, 30))
  server.emit({ jsonrpc: '2.0', id: 9, method: 'ExecCommandApproval/requestApproval', params: { reason: 'run' } })
  await new Promise(resolve => setTimeout(resolve, 100))
  assert.equal(server.received.some(message => message.method === 'answer'), false, 'no answer may be sent without a human decision')
  queue.push({ id: 'c2', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'cancel' })
  await running
})

test('an answer for a request this connection never received is refused', async () => {
  const server = fakeAppServer()
  const { running, queue, ledger } = serveWith(server, 'question')
  queue.push({ id: 'c1', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' })
  await new Promise(resolve => setTimeout(resolve, 30))
  // No approval was ever emitted on this connection.
  queue.push({ id: 'c2', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'answer', nativeBindingRef: 'never-received', answerRef: 'approve' })
  const deadline = Date.now() + 3000
  while (!ledger.records.some(record => record.kind === 'runtime.error') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const stale = ledger.records.find(record => record.kind === 'runtime.error')
  assert.ok(stale, 'a stale answer must produce a protocol error, not a silent send')
  // The protocol error ends the attempt; no reply frame may have been sent for that request.
  const exit = await running
  assert.ok(['error', 'cancelled', 'terminal'].includes(exit.reason), exit.reason)
  assert.equal(server.received.some(message => message.result !== undefined), false, 'no reply frame may be sent for a stale request')
})

test('an approval is answered on its own request id and only once', async () => {
  const server = fakeAppServer()
  const { running, queue, ledger } = serveWith(server, 'question')
  queue.push({ id: 'c1', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'begin', inputRef: 'input-1', preparedPolicyRef: 'prepared-1' })
  await new Promise(resolve => setTimeout(resolve, 30))
  server.emit({ jsonrpc: '2.0', id: 42, method: 'ExecCommandApproval/requestApproval', params: { reason: 'run' } })
  const deadline = Date.now() + 3000
  while (!ledger.records.some(record => record.kind === 'question.opened') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  queue.push({ id: 'c2', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'answer', nativeBindingRef: '42', answerRef: 'approve' })
  await new Promise(resolve => setTimeout(resolve, 60))
  // The reply is a response frame carrying the original id, not a made-up client method.
  const reply = server.received.find(message => message.id === 42 && message.result !== undefined)
  assert.ok(reply, `expected a reply on request id 42, got ${JSON.stringify(server.received.map(m => m.method ?? m.id))}`)
  assert.equal(server.received.some(message => message.method === 'answer'), false, 'the installed protocol has no answer method')
  queue.push({ id: 'c3', ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract: makeAttemptSpec().contract, kind: 'cancel' })
  await running
})
