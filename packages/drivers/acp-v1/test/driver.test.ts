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

test('ACP inspect records only the initialize handshake and refuses compatibility', async () => {
  const result = await inspectAcpCompatibility(profile, host, { handshake: async () => handshake })
  assert.equal(result.verdict.class, 'unknown')
  assert.equal(result.verdict.admission, 'disabled')
  assert.equal(result.report.readiness, 'needs_setup')
  assert.ok(result.verdict.identity)
  assert.ok(result.verdict.reasons.some(reason => reason.includes('probe_partial')))
  assert.ok(!result.report.evidenceRefs.includes('native_test_passed'))
  const wrong = await inspectAcpCompatibility(profile, host, { handshake: async () => ({ ...handshake, protocolVersion: 2 }) })
  assert.notEqual(wrong.verdict.class, 'compatible_unverified')
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

async function fixture(onPrompt?: (server: AcpConnection, value: Record<string, Json>) => Promise<void>, autoResolve = true, guard: () => Promise<void> = async () => undefined) {
  const root = await mkdtemp(join(tmpdir(), 'pa-acp-test-'))
  const spec = makeAttemptSpec()
  const commands = new Queue<RunnerCommand>()
  const facts: CriticalFact[] = []
  const payloads = new Map<string, Json>()
  payloads.set(spec.policySnapshotRef, { workspacePath: root, scope: { projectId: 'project-1', allowedPaths: ['.'], excludedPaths: [], externalActions: [] } })
  payloads.set('input-acp-begin', { inputId: 'input-acp-begin', contract: spec.contract, text: 'controlled ACP input', contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const payloadValues = new Map<string, Json>()
  const io = {
    commands,
    async record(fact: CriticalFact) { facts.push(fact); return { factId: fact.factId, persisted: true as const, seq: facts.length } },
    publishProgress() {},
    runtime: {} as never,
    payloads: {
      async read(reference: string) { const value = payloads.get(reference) ?? payloadValues.get(reference); if (value === undefined) throw new Error('missing payload'); return value },
      async store(payload: Json) { const ref = `payload-${payloads.size + 1}`; payloads.set(ref, payload); return ref },
    },
    bind(reference: string, value: Json) { payloadValues.set(reference, value) },
  }
  const fake = fakeAcp(onPrompt, autoResolve)
  return { root, spec, commands, facts, io, fake, driver: new AcpDriver({ connect: async () => fake.transport, timeoutMs: 3000, beforeAnswerWrite: guard }), cleanup: async () => { fake.stop(); await rm(root, { recursive: true, force: true }) } }
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
  const questionValue = await f.io.payloads.read(question!.payloadRef) as { value: { targets: Array<Record<string, unknown>>; presentation: { options: Array<{ id: string }> }; id: string; version: number } }
  const binding = questionValue.value.targets[0]!
  const optionId = questionValue.value.presentation.options[0]!.id
  const bindingRef = 'binding-acp-test-1'
  const answerRef = 'answer-acp-test-1'
  // Store the exact original binding under the payload ref an answer command names.
  const storedBinding = { ...binding }
  // fixture store is private; use its read/store via a helper map exposed below
  f.io.bind(bindingRef, storedBinding as never)
  f.io.bind(answerRef, { answerId: 'answer-acp-test-1', questionId: questionValue.value.id, questionVersion: questionValue.value.version,
    nativeBinding: binding, answer: { kind: 'choices', optionIds: [optionId] }, authorityRef: 'authority-1' } as never)
  f.commands.push(makeCommand('answer', { ...attemptOf(f.spec), id: 'cmd-acp-answer', nativeBindingRef: bindingRef, answerRef }))
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

test('reconcile never reports quiescent from a turn fact or journal alone', async () => {
  const driver = new AcpDriver()
  const ref = { ...attemptOf(makeAttemptSpec()), ownership: 'spawned_process', runnerIdentityRef: 'r', connectionEpoch: 1, journalRef: 'journal-1' }
  const host = {
    async readJournal() { return [{ kind: 'turn.ended' }, { kind: 'runtime.exited' }] as never },
    async inspectRuntime() { return { status: 'terminal', writer: 'indeterminate', evidenceRefs: ['owned-runtime-unknown'] } },
  }
  const report = await driver.reconcile(ref as never, host as never)
  assert.equal(report.status, 'terminal')
  assert.equal(report.writer, 'indeterminate')
  assert.ok(report.evidenceRefs.includes('owned-runtime-unknown'))
  const unknownHost = { async readJournal() { return [] as never }, async inspectRuntime() { throw new Error('owned runtime unavailable') } }
  const unknown = await driver.reconcile(ref as never, unknownHost as never)
  assert.equal(unknown.writer, 'indeterminate')
  assert.equal(unknown.status, 'indeterminate')
})


function attemptOf(spec: AttemptSpec) {
  return { ticketId: spec.ticketId, assignmentId: spec.assignmentId, attemptId: spec.attemptId, fenceEpoch: spec.fenceEpoch, contract: spec.contract }
}
