import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { serveRunner } from '../src/runner-service.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'

async function fixture(t: TestContext) {
  const root = mkdtempSync('/tmp/pa-write-admit-'),
    input = new PassThrough()
  const frames: Record<string, unknown>[] = []
  let nativeWrites = 0
  const serving = serveRunner({
    input,
    write: (frame) => frames.push({ ...frame }),
    payloads: { read: async () => null },
    eagerPrepare: true,
    createDriver: (_spec, hooks) => ({
      inspect: async () => {
        throw new Error('fixture')
      },
      reconcile: async () => {
        throw new Error('fixture')
      },
      serve: async () => {
        await hooks.beforeNativeWrite(makeCommand('answer'))
        nativeWrites++
        return { reason: 'terminal', evidenceRefs: ['fixture'] }
      },
    }),
  })
  const send = (frame: unknown) => input.write(Buffer.from(JSON.stringify({ v: 1, ...(frame as object) }) + '\n'))
  send({
    type: 'bootstrap',
    id: 'bootstrap',
    spec: makeAttemptSpec(),
    payloadRoot: join(root, 'payloads'),
    journalPath: join(root, 'journal'),
    producer: { source: 'fixture', runnerIdentityRef: 'fixture-runner' },
  })
  const deadline = Date.now() + 2000
  while (!frames.some((frame) => frame.type === 'native-write-intent') && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5))
  assert.ok(frames.some((frame) => frame.type === 'native-write-intent'))
  t.after(async () => {
    input.end()
    const service = await serving
    await service.shutdown()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    send,
    input,
    serving,
    get nativeWrites() {
      return nativeWrites
    },
  }
}
test('native write waits for the coordinator admission of that command', { timeout: 3000 }, async (t) => {
  const h = await fixture(t)
  assert.equal(h.nativeWrites, 0)
  h.send({ type: 'write-admission', id: 'unrelated-command', allowed: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(h.nativeWrites, 0)
  h.send({ type: 'write-admission', id: 'cmd-answer', allowed: true })
  h.input.end()
  const handle = await h.serving
  assert.equal((await handle.done).reason, 'terminal')
  assert.equal(h.nativeWrites, 1)
})
test('a refused native write never reaches the native side', { timeout: 3000 }, async (t) => {
  const h = await fixture(t)
  h.send({ type: 'write-admission', id: 'cmd-answer', allowed: false })
  h.input.end()
  const handle = await h.serving
  assert.equal((await handle.done).reason, 'error')
  assert.equal(h.nativeWrites, 0)
})
test('shutdown closes a pending write gate and cannot be reopened by a late approval', { timeout: 3000 }, async (t) => {
  const h = await fixture(t)
  h.send({ type: 'shutdown', id: 'shutdown' })
  h.send({ type: 'write-admission', id: 'cmd-answer', allowed: true })
  h.input.end()
  const handle = await h.serving
  assert.equal((await handle.done).reason, 'error')
  assert.equal(h.nativeWrites, 0)
})
