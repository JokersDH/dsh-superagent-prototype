/** WP-07 Codex app-server protocol: lossless ids, connection epochs, identity chain. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import { CodexConnection, CodexProtocolError, idKey, idToWire, losslessId, parseLossless } from '../src/protocol.ts'

const frame = (value: unknown) => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')

test('integer and string request ids stay distinct', () => {
  const asInteger = losslessId(43)
  const asString = losslessId('43')
  assert.equal(idKey(asInteger), 'integer:43')
  assert.equal(idKey(asString), 'string:43')
  assert.notEqual(idKey(asInteger), idKey(asString))
})

test('a raw string id is preserved verbatim', () => {
  assert.deepEqual(losslessId('req-abc'), { kind: 'string', value: 'req-abc' })
})

test('an id beyond the safe integer range is not rounded', () => {
  const big = '9007199254740993' // 2^53 + 1
  // JSON.rawJSON preserves the integer token, including its numeric type.
  assert.equal(JSON.stringify({ id: idToWire({ kind: 'integer', decimal: big }) }), `{"id":${big}}`)
  assert.equal(idToWire({ kind: 'integer', decimal: '43' }), 43)
})

test('parseLossless keeps ordinary JSON structure', () => {
  assert.deepEqual(parseLossless('{"a":[1,2,{"b":null}],"c":true}'), { a: [1, 2, { b: null }], c: true })
  assert.throws(() => parseLossless('{"a":}'), CodexProtocolError)
  assert.throws(() => parseLossless('{"a":1} extra'), CodexProtocolError)
})

test('initialize then initialized move the connection to initialized', async () => {
  const sent: unknown[] = []
  const connection = new CodexConnection((bytes) => sent.push(JSON.parse(Buffer.from(bytes).toString('utf8').trim())))
  const pending = connection.initialize({ name: 'p', version: '1' })
  const request = sent[0] as { id: number; method: string }
  assert.equal(request.method, 'initialize')
  connection.receive(frame({ jsonrpc: '2.0', id: request.id, result: { userAgent: 'codex/0.164.0' } }))
  await pending
  assert.equal(connection.state, 'initialized')
  assert.equal((sent[1] as { method: string }).method, 'initialized')
})

test('a response settles only the request that produced it', async () => {
  const sent: Array<{ id: number; method: string }> = []
  const connection = new CodexConnection((bytes) => sent.push(JSON.parse(Buffer.from(bytes).toString('utf8').trim())))
  const initialized = connection.initialize({ name: 'p', version: '1' })
  connection.receive(frame({ jsonrpc: '2.0', id: sent[0]!.id, result: {} }))
  await initialized
  await new Promise((resolve) => setTimeout(resolve, 10))

  const first = connection.request('thread/start', {})
  const second = connection.request('thread/list', {})
  const startFrame = sent.find((item) => item.method === 'thread/start')!
  const listFrame = sent.find((item) => item.method === 'thread/list')!
  assert.ok(startFrame.id !== listFrame.id, 'each request gets its own id')
  // Answer the second first: each promise still resolves with its own result.
  connection.receive(frame({ jsonrpc: '2.0', id: listFrame.id, result: { threads: [] } }))
  connection.receive(frame({ jsonrpc: '2.0', id: startFrame.id, result: { thread: { id: 't1' } } }))
  assert.deepEqual(await second, { threads: [] })
  assert.deepEqual(await first, { thread: { id: 't1' } })
})

test('an error response rejects with the native code', async () => {
  const sent: Array<{ id: number }> = []
  const connection = new CodexConnection((bytes) => sent.push(JSON.parse(Buffer.from(bytes).toString('utf8').trim())))
  const pending = connection.request('turn/start', {})
  connection.receive(frame({ jsonrpc: '2.0', id: sent[0]!.id, error: { code: -32000, message: 'boom' } }))
  await assert.rejects(pending, /-32000: boom/)
})

test('a reply from a closed connection can never satisfy a new one', async () => {
  const sentA: Array<{ id: number }> = []
  const first = new CodexConnection((bytes) => sentA.push(JSON.parse(Buffer.from(bytes).toString('utf8').trim())))
  const pending = first.request('thread/start', {})
  first.close('reconnect')
  // The outstanding request fails with the close reason; it can never be satisfied later.
  await assert.rejects(pending, /reconnect/)
  assert.equal(first.state, 'closed')

  const sentB: Array<{ id: number }> = []
  const second = new CodexConnection((bytes) => sentB.push(JSON.parse(Buffer.from(bytes).toString('utf8').trim())))
  const pendingB = second.request('thread/start', {})
  // A stale reply addressed to the old connection's id must not reach the new request.
  second.receive(frame({ jsonrpc: '2.0', id: sentA[0]!.id, result: { thread: { id: 'stale' } } }))
  second.receive(frame({ jsonrpc: '2.0', id: sentB[0]!.id, result: { thread: { id: 'fresh' } } }))
  assert.deepEqual(await pendingB, { thread: { id: 'fresh' } })
})

test('a closed connection refuses new work', () => {
  const connection = new CodexConnection(() => undefined)
  connection.close()
  assert.throws(() => connection.request('thread/start'), CodexProtocolError)
  assert.throws(() => connection.notify('initialized'), CodexProtocolError)
})

test('notifications are recorded for the driver to interpret', () => {
  const connection = new CodexConnection(() => undefined)
  connection.receive(frame({ jsonrpc: '2.0', method: 'item/started', params: { item: { id: 'i1', type: 'command' } } }))
  connection.receive(
    frame({ jsonrpc: '2.0', method: 'turn/completed', params: { turn: { id: 't1', status: 'completed' } } }),
  )
  assert.deepEqual(
    connection.receivedNotifications().map((item) => item.method),
    ['item/started', 'turn/completed'],
  )
})
test('framing preserves numeric int64 ids and matching resolved request ids across chunks', () => {
  const sent: string[] = []
  const connection = new CodexConnection((bytes) => sent.push(Buffer.from(bytes).toString('utf8')))
  const request = '{"id":9223372036854775807,"method":"item/commandExecution/requestApproval","params":{}}\n'
  connection.receive(Buffer.from(request.slice(0, 20)))
  connection.receive(Buffer.from(request.slice(20)))
  const event = connection.drainNotifications()[0]!
  const id = losslessId(event.id)
  assert.deepEqual(id, { kind: 'integer', decimal: '9223372036854775807' })
  connection.trackServerRequest(id)
  connection.replyToServerRequest(connection.claimServerRequest(id), { decision: 'accept' })
  assert.match(sent[0]!, /"id":9223372036854775807,/)
  connection.receive(Buffer.from('{"method":"serverRequest/resolved","params":{"requestId":9223372036854775807}}\n'))
  assert.deepEqual(losslessId((connection.drainNotifications()[0]!.params as { requestId: unknown }).requestId), id)
})
test('native object ids and out-of-range integer replies are refused', () => {
  assert.throws(() => losslessId({ kind: 'integer', decimal: '43' }), CodexProtocolError)
  assert.throws(() => idToWire({ kind: 'integer', decimal: '9223372036854775808' }), CodexProtocolError)
})
test('malformed native responses fail immediately instead of settling an empty result', async () => {
  const sent: { id: number }[] = []
  const connection = new CodexConnection((bytes) => sent.push(JSON.parse(Buffer.from(bytes).toString('utf8'))))
  const pending = connection.request('thread/start', {})
  assert.throws(() => connection.receive(frame({ id: sent[0]!.id })), CodexProtocolError)
  connection.close('invalid-response')
  await assert.rejects(pending, /invalid-response/)
})
