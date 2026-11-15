/**
 * Wave-29 B2: a fact sink is NOT a native-write permission.
 *
 * The in-process responder used to answer `allowed: !businessClosed`, i.e. a live sink with zero guard
 * calls was enough to authorise a native answer write. These cases pin the corrected semantics: the
 * fresh guard is mandatory, a missing/denying/throwing guard produces ZERO native writes, a granted
 * guard permits exactly that intent, and every intent uses its own correlation id while keeping the
 * original business command id.
 */
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { serveRunner } from '../src/runner-service.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'

type Guard = (command: { id: string }) => Promise<void>

async function fixture(t: TestContext, options: { guard?: Guard; attempts?: number } = {}) {
  const root = mkdtempSync('/tmp/pa-sink-admit-')
  const input = new PassThrough()
  const frames: Record<string, unknown>[] = []
  const invocations: string[] = []
  let nativeWrites = 0
  const attempts = options.attempts ?? 1
  const sink = { record: async (fact: { factId: string }) => ({ factId: fact.factId, persisted: true as const, seq: 1 }) }
  const serving = serveRunner({
    input,
    sink,
    write: frame => frames.push({ ...frame }),
    payloads: { read: async () => null },
    eagerPrepare: true,
    ...(options.guard ? { beforeNativeWrite: options.guard as never } : {}),
    createDriver: (_spec, hooks) => ({
      inspect: async () => { throw new Error('fixture') },
      reconcile: async () => { throw new Error('fixture') },
      serve: async () => {
        for (let index = 0; index < attempts; index += 1) {
          invocations.push(`intent-${index}`)
          try {
            await hooks.beforeNativeWrite(makeCommand('answer'))
            nativeWrites += 1
          } catch { /* denial keeps a REAL zero write */ }
        }
        return { reason: 'terminal', evidenceRefs: ['fixture'] }
      },
    }),
  })
  input.write(Buffer.from(JSON.stringify({ v: 1, type: 'bootstrap', id: 'bootstrap', spec: makeAttemptSpec(), payloadRoot: join(root, 'payloads'), journalPath: join(root, 'journal'), producer: { source: 'fixture', runnerIdentityRef: 'sink-runner' } }) + '\n'))
  t.after(async () => {
    try { input.end() } catch {}
    const service = await serving.catch(() => null)
    await service?.shutdown().catch(() => undefined)
    rmSync(root, { recursive: true, force: true })
  })
  // serveRunner resolves only when the input side ends, so the fixture returns the live handle and the
  // attempt result separately; a test ends the input after the native side has settled.
  const handleDone = (async () => (await serving).done)()
  void handleDone.catch(() => undefined)
  return {
    frames,
    invocations,
    input,
    get nativeWrites() { return nativeWrites },
    get done() { return handleDone },
  }
}

test('a sink without a fresh guard performs zero native writes', { timeout: 5000 }, async t => {
  const h = await fixture(t)
  await new Promise(resolve => setTimeout(resolve, 150))
  h.input.end()
  await h.done
  assert.equal(h.nativeWrites, 0, 'a live fact sink must not authorise a native write')
})

test('a denying guard performs zero native writes and fails the intent', { timeout: 5000 }, async t => {
  const h = await fixture(t, { guard: async () => { throw new Error('no live admission') } })
  await new Promise(resolve => setTimeout(resolve, 150))
  h.input.end()
  await h.done
  assert.equal(h.nativeWrites, 0)
})

test('a granted guard permits exactly that intent, and each intent gets its own correlation id', { timeout: 5000 }, async t => {
  let guardCalls = 0
  const h = await fixture(t, { guard: async (command) => { guardCalls += 1; assert.equal(command.id, 'cmd-answer') }, attempts: 2 })
  await new Promise(resolve => setTimeout(resolve, 200))
  h.input.end()
  await h.done
  assert.equal(guardCalls, 2, 'the fresh guard is asked for every intent, never reused')
  assert.equal(h.nativeWrites, 2)
})
