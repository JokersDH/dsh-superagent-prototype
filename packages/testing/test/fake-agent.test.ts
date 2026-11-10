import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FakeAgentSession } from '../src/harness.ts'

test('fake agent starts, announces ready and accepts begin', async () => {
  const session = await FakeAgentSession.start({ scenario: 'happy' })
  try {
    const ready = await session.waitForFrame(frame => frame.type === 'ready')
    assert.equal(ready.scenario, 'happy')
    assert.equal(typeof ready.pid, 'number')

    session.send({ type: 'begin', id: 'cmd-1', preparedPolicyRef: 'prepared-1' })
    const ended = await session.waitForFrame(frame => frame.type === 'turn_ended')
    assert.equal(ended.outcome, 'completed')
    assert.equal(ended.nativeTurnRef, 'turn-1')

    // The receipt side file is an independent witness outside stdout.
    assert.equal(session.receiptFor('begin.accepted')?.preparedPolicyRef, 'prepared-1')
  } finally {
    await session.shutdown()
  }
})

test('fake agent reports a user question and keeps control available afterwards', async () => {
  const session = await FakeAgentSession.start({ scenario: 'waiting-user' })
  try {
    session.send({ type: 'begin', id: 'cmd-1', preparedPolicyRef: 'prepared-1' })
    const question = await session.waitForFrame(frame => frame.type === 'question')
    assert.equal(question.questionId, 'q-1')

    session.send({ type: 'cancel', id: 'cmd-cancel' })
    const cancel = await session.waitForFrame(frame => frame.type === 'cancel_observed')
    assert.equal(cancel.commandId, 'cmd-cancel')
  } finally {
    await session.shutdown()
  }
})

test('fake agent emits a progress burst and a large stderr without blocking stdout', async () => {
  const session = await FakeAgentSession.start({ scenario: 'burst', stderrLimitBytes: 8 * 1024 })
  try {
    session.send({ type: 'begin', id: 'cmd-1', preparedPolicyRef: 'prepared-1' })
    await session.waitForFrame(frame => frame.type === 'turn_ended', 10_000)
    const progress = session.frames.filter(frame => frame.type === 'progress')
    assert.equal(progress.length, 400)
    // stderr is a separate pipe: give it a bounded window to drain before asserting volume.
    const deadline = Date.now() + 3000
    while (session.stderrBytes <= 32 * 1024 && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(session.stderrBytes > 32 * 1024, `stderrBytes=${session.stderrBytes}`)
    // Ring-bounded text: the reader cap is smaller than what the child wrote.
    assert.ok(session.stderrText.length <= 8 * 1024, `stderrText=${session.stderrText.length}`)
  } finally {
    await session.shutdown()
  }
})

test('fake agent survives split frames, CRLF and unknown notifications', async () => {
  const session = await FakeAgentSession.start({ scenario: 'torture' })
  try {
    session.send({ type: 'begin', id: 'cmd-1', preparedPolicyRef: 'prepared-1' })
    await session.waitForFrame(frame => frame.type === 'turn_ended', 5000)
    const texts = session.frames.filter(frame => frame.type === 'progress').map(frame => frame.text)
    assert.ok(texts.includes('split-frame'), `texts=${JSON.stringify(texts)}`)
    assert.ok(texts.includes('crlf'), `texts=${JSON.stringify(texts)}`)
    assert.ok(session.frames.some(frame => frame.type === 'unknown_notification'))
  } finally {
    await session.shutdown()
  }
})

test('fake agent can emit malformed UTF-8, which the reader rejects stably', async () => {
  const session = await FakeAgentSession.start({ scenario: 'malformed-utf8' })
  try {
    session.send({ type: 'begin', id: 'cmd-1', preparedPolicyRef: 'prepared-1' })
    const deadline = Date.now() + 3000
    while (!session.decoderError && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(session.decoderError, 'decoder should reject invalid UTF-8')
    const reason = (session.decoderError as { reason?: string }).reason
    assert.equal(reason, 'invalid_utf8')
  } finally {
    await session.shutdown()
  }
})

test('fake agent can emit an oversized frame, which the reader bounds', async () => {
  // Reader limit below what the child writes: the bound must fail the stream, not buffer it.
  //
  // Which bound fires first is a property of OS pipe chunking, not of the test's subject. The
  // 2 MiB frame ends its line only at the very end, so an early chunk trips `buffer_limit`
  // (128 KiB buffered with no newline yet) and a late chunk trips `frame_too_large`. Both are
  // the reader refusing to buffer an unbounded frame, which is the behaviour under contract.
  // Asserting one specific reason makes this test depend on pipe timing and flake under load.
  const session = await FakeAgentSession.start({ scenario: 'oversize', maxFrameBytes: 64 * 1024, maxBufferedBytes: 128 * 1024 })
  try {
    session.send({ type: 'begin', id: 'cmd-1', preparedPolicyRef: 'prepared-1' })
    const deadline = Date.now() + 5000
    while (!session.decoderError && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    assert.ok(session.decoderError, 'decoder should reject the oversized frame')
    const error = session.decoderError as { code?: string; reason?: string }
    assert.ok(
      ['frame_too_large', 'buffer_limit'].includes(error.reason ?? ''),
      `expected a size bound, got ${error.reason}`,
    )
    // Whatever the branch, the failure must stay a bounded protocol error rather than a crash.
    assert.equal(error.code, 'protocol_error')
    // The `ready` handshake legitimately precedes the payload; what must never appear is a frame
    // decoded from the oversized line itself.
    assert.ok(
      session.frames.every(frame => frame.type === 'ready'),
      `an oversized payload must not decode, got ${JSON.stringify(session.frames.map(frame => frame.type))}`,
    )
  } finally {
    await session.shutdown()
  }
})

test('fake agent exits with a non-zero code after begin when asked', async () => {
  const session = await FakeAgentSession.start({ scenario: 'exit-after-begin' })
  try {
    session.send({ type: 'begin', id: 'cmd-1', preparedPolicyRef: 'prepared-1' })
    const exit = await session.waitForExit(5000)
    assert.equal(exit.code, 7)
  } finally {
    await session.shutdown()
  }
})

test('fake agent can close stdout (EOF) while remaining alive', async () => {
  const session = await FakeAgentSession.start({ scenario: 'eof-after-begin' })
  try {
    session.send({ type: 'begin', id: 'cmd-1', preparedPolicyRef: 'prepared-1' })
    await new Promise(resolve => setTimeout(resolve, 600))
    assert.equal(session.child.exitCode, null, 'process should still be alive after closing stdout')
    assert.equal(session.child.signalCode, null, 'process should not have been signalled')
  } finally {
    session.child.kill('SIGKILL')
    await session.waitForExit(2000).catch(() => undefined)
  }
})
