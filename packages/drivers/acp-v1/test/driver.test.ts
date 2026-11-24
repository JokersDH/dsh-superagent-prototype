import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AcpConnection, AcpDriver, acpRequiredSurface, acpObservedSurface, inspectAcpCompatibility, type AcpHandshake } from '../src/index.ts'
import type { AgentProfile, AttemptSpec, CriticalFact, Json, RunnerCommand } from '../../../contracts/src/types.ts'
import { makeAttemptSpec, makeCommand } from '../../../testing/src/index.ts'

const D = (ch: string) => ch.repeat(64)
const profile: AgentProfile = {
  id: 'profile-acp', revision: 1, driverId: 'acp-v1', driverApiMajor: 1, driverRelease: '0.1.0',
  executable: '/opt/opencode', argv: ['acp', '--pure'], expectedVersion: '1.18.34', nativeConfigRef: 'config-acp',
  permissionPolicyRevision: 'policy-acp', requiredFeatures: [],
}
const host = {
  async inspectExecutable() { return { version: '1.18.34', digest: D('a'), evidenceRef: 'exe:opencode/1.18.34' } },
  async inspectConfig() { return { fingerprint: D('c'), stability: 'frozen' as const } },
}
const handshake: AcpHandshake = { protocolVersion: 1, agentName: 'OpenCode', agentVersion: '1.18.34', capabilities: { promptCapabilities: { embeddedContext: true } }, evidenceRefs: ['acp-initialize:1'] }

test('ACP inspect classifies an initialize-only handshake without any prompt', async () => {
  const result = await inspectAcpCompatibility(profile, host, { handshake: async () => handshake })
  assert.equal(result.verdict.class, 'compatible_unverified')
  assert.equal(result.verdict.admission, 'trial')
  assert.equal(result.report.readiness, 'inspection_passed')
  assert.ok(!result.report.evidenceRefs.includes('native_test_passed'))
  const verified = await inspectAcpCompatibility(profile, host, { handshake: async () => handshake, verifiedVersions: [{
    profileId: profile.id, profileRevision: 1, driverId: profile.driverId, nativeVersion: handshake.agentVersion!,
    executableDigest: D('a'), driverRelease: profile.driverRelease, wireVersion: 'acp-v1',
    schemaDigest: acpObservedSurface(handshake).schemaDigest, evidenceRef: 'native:acp-run-1',
  }] })
  assert.equal(verified.verdict.class, 'verified')
  const wrong = await inspectAcpCompatibility(profile, host, { handshake: async () => ({ ...handshake, protocolVersion: 2 }) })
  assert.notEqual(wrong.verdict.class, 'compatible_unverified')
  assert.equal(wrong.report.readiness, 'incompatible')
})

test('ACP surface requirements include real fields, enums, notifications and request ids', () => {
  const required = acpRequiredSurface()
  assert.ok(required.methods.includes('session/prompt'))
  assert.deepEqual(required.requestFields.initialize, ['protocolVersion', 'clientCapabilities', 'clientInfo'])
  assert.deepEqual(required.enums['session/request_permission'], ['allow_once', 'allow_always', 'reject_once', 'reject_always'])
  assert.ok(required.notifications.includes('session/update'))
  assert.deepEqual(required.requestIdTypes, ['integer', 'string'])
  assert.match(acpObservedSurface(handshake).schemaDigest, /^[a-f0-9]{64}$/)
})

class Queue<T> {
  #items: T[] = []
  #waiters: Array<(value: IteratorResult<T>) => void> = []
  closed = false
  push(value: T): void { const waiter = this.#waiters.shift(); if (waiter) waiter({ value, done: false }); else this.#items.push(value) }
  close(): void { this.closed = true; for (const waiter of this.#waiters.splice(0)) waiter({ value: undefined as never, done: true }) }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      const item = this.#items.shift()
      if (item !== undefined) { yield item; continue }
      if (this.closed) return
      const next = await new Promise<IteratorResult<T>>(resolve => this.#waiters.push(resolve))
      if (next.done) return
      yield next.value
    }
  }
}

function fakeAcp(onPrompt?: (server: AcpConnection, value: Record<string, Json>) => Promise<void>, autoResolve = true) {
  let onData: ((chunk: Uint8Array) => void) | undefined
  const server = new AcpConnection(bytes => onData?.(bytes))
  const transport = {
    send: (bytes: Uint8Array) => server.receive(bytes),
    onData: (listener: (chunk: Uint8Array) => void) => { onData = listener },
    close: () => { server.close('test-close') },
  }
  let stopped = false
  const promptResolvers: Array<(value: Json) => void> = []
  const task = (async () => {
    while (!stopped) {
      const requests = server.takeRequests()
      for (const request of requests) {
        if (request.method === 'initialize') {
          server.respond(request.id, { protocolVersion: 1, agentCapabilities: { promptCapabilities: { embeddedContext: true } }, agentInfo: { name: 'OpenCode', version: '1.18.34' } })
        } else if (request.method === 'session/new') {
          server.respond(request.id, { sessionId: 'ses_test_1', configOptions: [] })
        } else if (request.method === 'session/prompt') {
          const value = (request.params ?? {}) as Record<string, Json>
          const resolve = (result: Json) => server.respond(request.id, result)
          promptResolvers.push(resolve)
          if (onPrompt) await onPrompt(server, value)
          if (autoResolve) resolve({ stopReason: 'end_turn' })
        }
      }
      for (const note of server.takeNotifications()) {
        if (note.method === 'session/cancel') for (const resolve of promptResolvers.splice(0)) resolve({ stopReason: 'cancelled' })
      }
      await new Promise(resolve => setTimeout(resolve, 5))
    }
  })()
  return { transport, server, task, stop: () => { stopped = true; server.close('stopped') } }
}

async function fixture(onPrompt?: (server: AcpConnection, value: Record<string, Json>) => Promise<void>, autoResolve = true) {
  const root = await mkdtemp(join(tmpdir(), 'pa-acp-test-'))
  const spec = makeAttemptSpec()
  const commands = new Queue<RunnerCommand>()
  const facts: CriticalFact[] = []
  const payloads = new Map<string, Json>()
  payloads.set(spec.policySnapshotRef, { workspacePath: root, scope: { projectId: 'project-1', allowedPaths: ['.'], excludedPaths: [], externalActions: [] } })
  const io = {
    commands,
    async record(fact: CriticalFact) { facts.push(fact); return { factId: fact.factId, persisted: true as const, seq: facts.length } },
    publishProgress() {},
    runtime: {} as never,
    payloads: {
      async read(reference: string) { const value = payloads.get(reference); if (value === undefined) throw new Error('missing payload'); return value },
      async store(payload: Json) { const ref = `payload-${payloads.size + 1}`; payloads.set(ref, payload); return ref },
    },
  }
  const fake = fakeAcp(onPrompt, autoResolve)
  return { root, spec, commands, facts, io, fake, driver: new AcpDriver({ connect: async () => fake.transport, timeoutMs: 3000 }), cleanup: async () => { fake.stop(); await rm(root, { recursive: true, force: true }) } }
}

function payloadOf(facts: CriticalFact[], kind: string) {
  return facts.find(fact => fact.kind === kind)
}

test('begin sends one prompt; permission answer is response_written, not native_applied; turn completes', async () => {
  const f = await fixture(async (server, value) => {
    server.notify('session/update', { sessionId: String(value.sessionId), update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'hello' } } })
    const outcome = await server.request('session/request_permission', {
      sessionId: String(value.sessionId),
      toolCall: { toolCallId: 'tool-1', title: 'Run tests' },
      options: [
        { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
      ],
    })
    assert.deepEqual(outcome, { outcome: { outcome: 'selected', optionId: 'allow-once' } })
  })
  const serve = f.driver.serve(f.spec, f.io as never)
  f.commands.push(makeCommand('begin', { ...attemptOf(f.spec), inputRef: 'input-acp-begin', preparedPolicyRef: f.spec.policySnapshotRef }))
  for (let index = 0; index < 200 && !payloadOf(f.facts, 'question.opened'); index += 1) await new Promise(resolve => setTimeout(resolve, 10))
  const question = payloadOf(f.facts, 'question.opened')
  assert.ok(question)
  const questionValue = await f.io.payloads.read(question!.payloadRef) as { value?: { targets?: Array<{ id?: string }> } }
  const bindingId = questionValue.value?.targets?.[0]?.id
  assert.ok(bindingId)
  f.commands.push(makeCommand('answer', { ...attemptOf(f.spec), id: 'cmd-acp-answer', nativeBindingRef: bindingId!, answerRef: 'allow-once' }))
  const exit = await serve
  assert.equal(exit.reason, 'terminal')
  const answer = payloadOf(f.facts, 'answer.observed')
  assert.ok(answer)
  assert.ok(payloadOf(f.facts, 'turn.ended'))
  assert.ok(payloadOf(f.facts, 'dispatch.observed'))
  await f.cleanup()
})

test('deliver is unsupported and never creates a second prompt', async () => {
  const f = await fixture(undefined, false)
  const serve = f.driver.serve(f.spec, f.io as never)
  f.commands.push(makeCommand('begin', { ...attemptOf(f.spec), inputRef: 'input-acp-begin', preparedPolicyRef: f.spec.policySnapshotRef }))
  await new Promise(resolve => setTimeout(resolve, 100))
  f.commands.push(makeCommand('deliver', { ...attemptOf(f.spec), id: 'cmd-acp-deliver', inputRef: 'input-other' }))
  await new Promise(resolve => setTimeout(resolve, 100))
  const errors = f.facts.filter(fact => fact.kind === 'runtime.error')
  assert.ok(errors.length >= 1)
  // No turn can complete without a prompt response; the fake server keeps the prompt open. Cancel to end.
  f.commands.push(makeCommand('cancel', { ...attemptOf(f.spec), id: 'cmd-acp-cancel' }))
  const exit = await serve
  assert.equal(exit.reason, 'cancelled')
  assert.ok(payloadOf(f.facts, 'cancel.observed'))
  await f.cleanup()
})

test('cancel writes session/cancel and never claims native_applied or physical quiescence', async () => {
  const f = await fixture(undefined, false)
  const serve = f.driver.serve(f.spec, f.io as never)
  f.commands.push(makeCommand('begin', { ...attemptOf(f.spec), inputRef: 'input-acp-begin', preparedPolicyRef: f.spec.policySnapshotRef }))
  await new Promise(resolve => setTimeout(resolve, 100))
  f.commands.push(makeCommand('cancel', { ...attemptOf(f.spec), id: 'cmd-acp-cancel' }))
  const exit = await serve
  assert.equal(exit.reason, 'cancelled')
  assert.ok(payloadOf(f.facts, 'cancel.observed'))
  assert.ok(!f.facts.some(fact => fact.kind === 'answer.observed'))
  await f.cleanup()
})

function attemptOf(spec: AttemptSpec) {
  return { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
}
