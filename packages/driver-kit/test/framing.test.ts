import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Buffer } from 'node:buffer'
import { FramingError, JsonLineDecoder, decodeJsonLines, encodeFrame } from '../src/index.ts'

const encoder = (value: unknown): Buffer => Buffer.from(`${JSON.stringify(value)}\n`, 'utf8')

test('reassembles a frame split across chunks, including UTF-8 split mid-sequence', () => {
  const decoder = new JsonLineDecoder()
  const line = encoder({ text: 'héllo · 世界' })
  const frames = []
  // Three-byte chunks guarantee multi-byte code points are cut across pushes.
  for (let offset = 0; offset < line.length; offset += 3) {
    frames.push(...decoder.push(line.subarray(offset, Math.min(offset + 3, line.length))))
  }
  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0]?.value, { text: 'héllo · 世界' })
  assert.equal(decoder.end().frames, 1)
})

test('decodes several frames from one chunk, accepts CRLF and ignores blank lines', () => {
  const decoder = new JsonLineDecoder()
  const chunk = Buffer.concat([
    Buffer.from('{"a":1}\r\n'),
    Buffer.from('\n'),
    Buffer.from('   \n'),
    Buffer.from('{"b":2}\n'),
  ])
  const frames = decoder.push(chunk)
  assert.deepEqual(frames.map(frame => frame.value), [{ a: 1 }, { b: 2 }])
  assert.deepEqual(frames.map(frame => frame.seq), [1, 2])
  assert.equal(decoder.stats().blankLines, 2)
})

test('invalid UTF-8 fails with a stable protocol_error reason', () => {
  const decoder = new JsonLineDecoder()
  const invalid = Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0xc3, 0x28, 0x7d, 0x0a])
  assert.throws(
    () => decoder.push(invalid),
    error => error instanceof FramingError && error.code === 'protocol_error' && error.reason === 'invalid_utf8',
  )
})

test('invalid JSON fails with a stable protocol_error reason', () => {
  const decoder = new JsonLineDecoder()
  assert.throws(
    () => decoder.push(Buffer.from('{not json}\n')),
    error => error instanceof FramingError && error.reason === 'invalid_json',
  )
})

test('an oversized frame fails instead of growing the buffer', () => {
  const decoder = new JsonLineDecoder({ maxFrameBytes: 16 })
  assert.throws(
    () => decoder.push(Buffer.from('{"abcdefghijklmnopqrst":1}\n')),
    error =>
      error instanceof FramingError &&
      error.reason === 'frame_too_large' &&
      (error.detail as { limit: number }).limit === 16,
  )
})

test('a never-terminated frame fails at the buffer limit', () => {
  const decoder = new JsonLineDecoder({ maxFrameBytes: 64, maxBufferedBytes: 32 })
  assert.throws(
    () => decoder.push(Buffer.from('x'.repeat(40))),
    error => error instanceof FramingError && error.reason === 'buffer_limit',
  )
})

test('a trailing partial frame at EOF is reported, not silently dropped', () => {
  const decoder = new JsonLineDecoder()
  decoder.push(Buffer.from('{"a":1}\n{"b":'))
  assert.throws(() => decoder.end(), error => error instanceof FramingError && error.reason === 'trailing_partial_frame')
})

test('encodeFrame refuses a value above the size bound', () => {
  assert.throws(
    () => encodeFrame({ text: 'x'.repeat(64) }, { maxFrameBytes: 32 }),
    error => error instanceof FramingError && error.reason === 'frame_too_large',
  )
})

test('decodeJsonLines works over an arbitrary byte stream', async () => {
  async function* chunks() {
    yield Buffer.from('{"a":')
    yield Buffer.from('1}\n{"ok":true}\n')
  }
  const values = []
  for await (const frame of decodeJsonLines(chunks())) values.push(frame.value)
  assert.deepEqual(values, [{ a: 1 }, { ok: true }])
})
