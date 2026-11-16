import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { CoordinatorChannelRequest } from '../../../packages/contracts/src/coordinator-channel.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/index.ts'
import { connectRunnerRecovery, RunnerLinkError, verifiedRunnerInspection } from '../../../packages/execution/src/recovery-transport.ts'
import { endpointDirectory } from '../src/recovery-endpoint.ts'
import { serveRunner } from '../src/runner-service.ts'

type Kind = CoordinatorChannelRequest['type']
type Outcome = { state: 'pending' } | { state: 'resolved'; value: unknown } | { state: 'rejected'; code: string }

async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 1500
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Terminal lease condition did not settle')
}

async function fixture(t: TestContext, kind: Kind) {
  const root = mkdtempSync('/tmp/pa-terminal-lease-')
  const input = new PassThrough()
  const spec = makeAttemptSpec()
  const frames: Record<string, unknown>[] = []
  const producer = {
    attempt: {
      ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId,
      fenceEpoch: spec.fenceEpoch, contract: spec.contract,
    },
    source: 'terminal-lease-test',
    runnerIdentityRef: 'terminal-lease-runner',
  }
  const payload = { message: 'original immutable payload' }
  let outcome: Outcome = { state: 'pending' }
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let leaseId = ''
  let generation = 0
  let currentRequest: CoordinatorChannelRequest | undefined
  const serving = serveRunner({
    input,
    write: frame => frames.push({ ...frame }),
    recoveryRoot: join(root, 'recovery'),
    payloads: { read: async () => { throw new Error('No hidden payload fallback') } },
    createDriver: (_attempt, hooks) => ({
      inspect: async () => { throw new Error('No process inspection in this fixture') },
      reconcile: async () => { throw new Error('No native reconciliation in this fixture') },
      serve: async (_attempt, io) => {
        try {
          let value: unknown
          if (kind === 'fact') {
            const payloadRef = await io.payloads.store({
              kind: 'turn.ended',
              value: { nativeTurnRef: 'terminal-turn', outcome: 'completed', candidateAvailable: false, evidenceRefs: [] },
            }, 'critical')
            value = await io.record({
              ...producer.attempt,
              source: producer.source,
              factId: 'terminal-fact',
              kind: 'turn.ended',
              payloadRef,
            })
          } else if (kind === 'payload-read') {
            value = await io.payloads.read('payload:terminal-original')
          } else {
            value = await hooks.beforeNativeWrite(makeCommand('answer'))
          }
          outcome = { state: 'resolved', value }
        } catch (error) {
          outcome = { state: 'rejected', code: (error as { code?: string }).code ?? 'rejected' }
        }
        await held
        return { reason: 'terminal', evidenceRefs: ['in-process-only'] }
      },
    }),
  })
  const send = (frame: Record<string, unknown>): void => {
    input.write(Buffer.from(JSON.stringify({ v: 1, ...frame }) + '\n'))
  }
  send({
    type: 'bootstrap', id: 'bootstrap', spec,
    payloadRoot: join(root, 'payloads'), journalPath: join(root, 'journal'),
    producer: { source: producer.source, runnerIdentityRef: producer.runnerIdentityRef },
  })
  await until(() => frames.some(frame => frame.type === 'ready'))
  const directory = endpointDirectory(join(root, 'recovery'), spec.attemptId)
  const socketPath = join(directory, 'runner.sock')
  const stat = lstatSync(socketPath)
  const client = connectRunnerRecovery({
    socketPath, credentialPath: join(directory, 'runner.credential'),
    socketIdentity: { dev: stat.dev, ino: stat.ino },
  }, producer, 1000)
  const reply = (connectionId: string, request: CoordinatorChannelRequest) => {
    const frame = request.type === 'fact'
      ? { v: 1, type: 'receipt', id: request.id, factId: request.fact.factId, receipt: { factId: request.fact.factId, persisted: true, seq: 1 } }
      : request.type === 'payload-read'
        ? { v: 1, type: 'payload', id: request.requestId, requestId: request.requestId, value: payload }
        : { v: 1, type: 'write-admission', id: request.id, allowed: true }
    return client.channelReply(connectionId, frame)
  }
  t.after(async () => {
    // A failing pre-fix assertion must not leave the controlled callback waiting for its deadline.
    if (currentRequest) await reply(leaseId, currentRequest).catch(() => undefined)
    release()
    if (!input.writableEnded) send({ type: 'shutdown', id: 'cleanup' })
    input.end()
    const handle = await serving
    await handle.shutdown()
    await handle.done
    rmSync(root, { recursive: true, force: true })
  })
  return {
    client, frames, payload, send, release,
    async detachInput() { input.end(); return serving },
    get outcome(): Outcome { return outcome },
    get generation() { return generation },
    async bind(connectionId: string) {
      const state = await client.channelState()
      const page = await client.channelNext(connectionId, state.generation)
      leaseId = connectionId
      generation = page.generation
      return page
    },
    begin() { send({ type: 'command', id: 'begin', command: makeCommand('begin') }) },
    async request() {
      await until(async () => {
        const page = await client.channelNext(leaseId, generation)
        if (page.request) currentRequest = page.request as CoordinatorChannelRequest
        return currentRequest !== undefined
      })
      assert.equal(currentRequest!.type, kind)
      return currentRequest!
    },
    reply,
  }
}

for (const kind of ['fact', 'payload-read', 'native-write-intent'] as const) {
  test(`terminal shutdown revokes remote ${kind} and refuses late settlement or rebind`, { timeout: 5000 }, async t => {
    const h = await fixture(t, kind)
    await h.bind('remote-owner')
    h.begin()
    const request = await h.request()
    assert.equal(h.outcome.state, 'pending')
    h.send({ type: 'shutdown', id: 'terminal-shutdown' })
    await until(async () => verifiedRunnerInspection(await h.client.inspect()).value.state !== 'serving')

    await assert.rejects(
      () => h.reply('remote-owner', request),
      error => error instanceof RunnerLinkError && 'serverError' in error && error.serverError === 'stale_lease',
    )
    await until(() => h.outcome.state !== 'pending')
    assert.deepEqual(h.outcome, { state: 'rejected', code: kind === 'native-write-intent' ? 'indeterminate' : 'closed' })
    assert.equal(h.frames.some(frame => frame.type === 'receipt'), false)
    await assert.rejects(
      () => h.client.channelNext('replacement-after-terminal', h.generation),
      error => error instanceof RunnerLinkError && 'serverError' in error && error.serverError === 'stale_connection',
    )
    const state = await h.client.channelState()
    assert.equal(state.generation, h.generation, 'refused terminal rebind must not change generation')
  })

  test(`a current nonterminal remote lease can still settle ${kind}`, { timeout: 5000 }, async t => {
    const h = await fixture(t, kind)
    await h.bind('current-owner')
    h.begin()
    const request = await h.request()
    assert.equal((await h.reply('current-owner', request)).accepted, true)
    await until(() => h.outcome.state === 'resolved')
    if (kind === 'payload-read') assert.deepEqual(h.outcome, { state: 'resolved', value: h.payload })
  })
}

for (const kind of ['fact', 'payload-read'] as const) {
  test(`nonterminal takeover preserves the original pending ${kind}`, { timeout: 5000 }, async t => {
    const h = await fixture(t, kind)
    await h.bind('departing-owner')
    h.begin()
    const original = await h.request()
    const successor = await h.bind('successor-owner')
    assert.deepEqual(successor.request, original)
    await assert.rejects(
      () => h.reply('departing-owner', original),
      error => error instanceof RunnerLinkError && 'serverError' in error && error.serverError === 'stale_lease',
    )
    assert.equal(h.outcome.state, 'pending')
    assert.equal((await h.reply('successor-owner', original)).accepted, true)
    await until(() => h.outcome.state === 'resolved')
  })
}

test('natural terminal completion also refuses a new callback lease', { timeout: 5000 }, async t => {
  const h = await fixture(t, 'fact')
  await h.bind('finishing-owner')
  h.begin()
  const request = await h.request()
  assert.equal((await h.reply('finishing-owner', request)).accepted, true)
  await until(() => h.outcome.state === 'resolved')
  h.release()
  await until(() => h.frames.some(frame => frame.type === 'exited'))
  await assert.rejects(
    () => h.client.channelNext('new-owner-after-exit', h.generation),
    error => error instanceof RunnerLinkError && 'serverError' in error && error.serverError === 'stale_connection',
  )
})

test('input detachment while the attempt runs still permits a legitimate successor', { timeout: 5000 }, async t => {
  const h = await fixture(t, 'fact')
  await h.bind('owner-before-detach')
  h.begin()
  const original = await h.request()
  const handle = await h.detachInput()
  const successor = await h.bind('owner-after-detach')
  assert.deepEqual(successor.request, original)
  assert.equal(h.outcome.state, 'pending')
  assert.equal((await h.reply('owner-after-detach', original)).accepted, true)
  await until(() => h.outcome.state === 'resolved')
  h.release()
  assert.equal((await handle.done).reason, 'terminal')
})
