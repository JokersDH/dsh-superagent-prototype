import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agent, methods, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type { AgentApp, AgentRequestContext, AnyMessage, JsonRpcId, NewSessionResponse, PromptRequest, PromptResponse,
  RequestPermissionResponse, InitializeRequest } from '@agentclientprotocol/sdk'
import { AcpDriver, AcpV1SettingsSchema, inspectAcpCompatibility, probeAcpHandshake, type AcpPolicyHost,
  type AcpDriverOptions, type AcpByteTransport } from '../src/index.ts'
import type { AttemptIO } from '../../../contracts/src/ports.ts'
import type { AttemptSpec, CriticalFact, Json, PreparedExecutionPolicy, RunnerCommand } from '../../../contracts/src/types.ts'
import { AttemptRefSchema, JsonSchema, PreparedExecutionPolicySchema, RuntimeFactPayloadSchema } from '../../../contracts/src/schemas.ts'
import { makeAttemptSpec, makeCommand } from '../../../testing/src/fixtures.ts'
import { attemptIdentity } from '../../../driver-kit/src/attempt-io.ts'

class Queue<T> implements AsyncIterable<T> {
  values: T[] = []; waiting: Array<(value: IteratorResult<T>) => void> = []; ended = false
  push(value: T) { const waiter = this.waiting.shift(); if (waiter) waiter({ done: false, value }); else this.values.push(value) }
  close() { this.ended = true; for (const waiter of this.waiting.splice(0)) waiter({ done: true, value: undefined as never }) }
  [Symbol.asyncIterator]() { return { next: () => {
    if (this.values.length) return Promise.resolve({ value: this.values.shift()!, done: false })
    if (this.ended) return Promise.resolve({ value: undefined as never, done: true })
    return new Promise<IteratorResult<T>>(resolve => this.waiting.push(resolve))
  } } }
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const fingerprint = 'a'.repeat(64)
async function waitFor(predicate: () => boolean) {
  const end = Date.now() + 3000
  while (!predicate()) { assert.ok(Date.now() < end, 'timed out waiting for controlled ACP observation'); await new Promise(resolve => setTimeout(resolve, 5)) }
}
function sdkPair(app: AgentApp, reusePermissionId = false) {
  const toAgent = new TransformStream<Uint8Array>(), toClient = new TransformStream<Uint8Array>()
  const stream = ndJsonStream(toClient.writable, toAgent.readable)
  let originalPermissionId: JsonRpcId | undefined
  const serverWriter = reusePermissionId ? stream.writable.getWriter() : undefined
  // Standard-wire fixture only: keep the official SDK codec on both ends while a legal peer reuses
  // the same completed request ID. Production never rewrites an incoming or outgoing request ID.
  const server = app.connect(reusePermissionId ? {
    writable: new WritableStream<AnyMessage>({ async write(message) {
      if ('method' in message && message.method === methods.client.session.requestPermission && 'id' in message) {
        assert.equal(originalPermissionId, undefined)
        originalPermissionId = message.id
        await serverWriter!.write({ ...message, id: 'reused-permission' })
      } else await serverWriter!.write(message)
    } }),
    readable: stream.readable.pipeThrough(new TransformStream<AnyMessage, AnyMessage>({ transform(message, controller) {
      if ('id' in message && !('method' in message) && message.id === 'reused-permission' && originalPermissionId !== undefined) {
        const id = originalPermissionId; originalPermissionId = undefined
        controller.enqueue({ ...message, id })
      } else controller.enqueue(message)
    } })),
  } : stream)
  const writer = toAgent.writable.getWriter()
  const transport: AcpByteTransport = { stdout: toClient.readable as unknown as AsyncIterable<Uint8Array>, write: bytes => writer.write(bytes) }
  return { transport, server }
}
function fixture(options: {
  prompt?: (context: AgentRequestContext<PromptRequest>) => Promise<PromptResponse>
  session?: NewSessionResponse
  guard?: AcpDriverOptions['beforeAnswerWrite']
  mutatePolicy?: (policy: PreparedExecutionPolicy) => PreparedExecutionPolicy
  settings?: Record<string, unknown>
  policyHost?: false
  businessOpen?: () => boolean
  reusePermissionId?: boolean
  permissionTitle?: false
  closeInput?: () => Promise<void>
} = {}) {
  const spec: AttemptSpec = { ...makeAttemptSpec(), profile: { ...makeAttemptSpec().profile, driverId: 'acp-v1' } }
  const ref = attemptIdentity(spec), commands = new Queue<RunnerCommand>(), facts: CriticalFact[] = []
  const payloads = new Map<string, Json>(), progress: string[] = [], calls: string[] = []
  let connectCount = 0, beginText = '', preparedRef = '', nativePermissionId: JsonRpcId | undefined
  const pendingPrompt = deferred<PromptResponse>(), permissionResponses: RequestPermissionResponse[] = []
  let initialize: InitializeRequest | undefined
  const app = agent({ name: 'controlled-standard-acp-agent' })
    .onRequest(methods.agent.initialize, ({ params }) => {
      initialize = params; calls.push('initialize')
      return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: {}, authMethods: [], agentInfo: { name: 'controlled', version: '1.0.0' } }
    })
    .onRequest(methods.agent.session.new, () => { calls.push('session/new'); return options.session ?? { sessionId: 'controlled-session-1' } })
    .onRequest(methods.agent.session.prompt, async context => {
      calls.push('session/prompt'); beginText = context.params.prompt[0]?.type === 'text' ? context.params.prompt[0].text : ''
      return options.prompt ? options.prompt(context) : pendingPrompt.promise
    })
    .onNotification(methods.agent.session.cancel, () => { calls.push('session/cancel'); pendingPrompt.resolve({ stopReason: 'cancelled' }) })
  const pair = sdkPair(app, options.reusePermissionId)
  if (options.closeInput) pair.transport.closeInput = options.closeInput
  const policyHost: AcpPolicyHost = {
    async prepare(input) {
      const nativeAppliedSettingsRef = await input.io.payloads.store(JsonSchema.parse({ controlledEnforcer: true, scope: input.settings.scope }), 'critical')
      const policy = PreparedExecutionPolicySchema.parse({ ...ref, requestedPolicyRevision: spec.profile.permissionPolicyRevision,
        nativeAppliedSettingsRef, effectiveConfigFingerprint: fingerprint, enforcement: 'enforced', verification: 'passed', evidenceRef: nativeAppliedSettingsRef })
      return { policy: options.mutatePolicy?.(policy) ?? policy, currentFingerprint: fingerprint }
    },
    async currentFingerprint() { return fingerprint },
  }
  payloads.set(spec.policySnapshotRef, JsonSchema.parse({ kind: 'acp-v1-settings/1', workspacePath: '/controlled/workspace',
    scope: { projectId: 'project-1', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }, timeoutMs: 1200, ...options.settings }))
  payloads.set('controlled-input', { inputId: 'controlled-input', contract: spec.contract, text: 'change controlled source only',
    contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' })
  const io: AttemptIO = {
    commands, runtime: { async spawn() { throw new Error('No OS process may spawn in this controlled test') } } as never,
    publishProgress(update) { progress.push(update.text) },
    payloads: { async read(reference) { const value = payloads.get(reference); assert.ok(value, `Missing payload ${reference}`); return value },
      async store(value) { const id = `controlled-payload-${payloads.size + 1}`; payloads.set(id, value)
        if (typeof value === 'object' && value && !Array.isArray(value) && 'requestedPolicyRevision' in value) preparedRef = id
        return id } },
    async record(fact) { RuntimeFactPayloadSchema.parse(payloads.get(fact.payloadRef)); facts.push(fact); return { factId: fact.factId, persisted: true, seq: facts.length } },
  }
  const driver = new AcpDriver({ connect: async () => { connectCount++; return pair.transport },
    ...(options.policyHost === false ? {} : { policyHost }), beforeAnswerWrite: options.guard ?? (async () => undefined), businessOpen: options.businessOpen })
  const values = (kind: string) => facts.filter(fact => fact.kind === kind).map(fact => RuntimeFactPayloadSchema.parse(payloads.get(fact.payloadRef)).value)
  const permission = async (context: AgentRequestContext<PromptRequest>) => {
    // Official SDK request ID is exposed unchanged in the original native binding.
    const answer = await context.client.request(methods.client.session.requestPermission, { sessionId: context.params.sessionId,
      toolCall: { toolCallId: 'controlled-tool', ...(options.permissionTitle === false ? {} : { title: 'Write controlled file' }) }, options: [
        { optionId: 'native/allow-once', name: 'Allow this write', kind: 'allow_once' },
        { optionId: 'native/allow-always', name: 'Always allow writes', kind: 'allow_always' },
        { optionId: 'native/reject-once', name: 'Reject this write', kind: 'reject_once' },
      ] })
    permissionResponses.push(answer)
    return answer
  }
  return { spec, ref, app, io, commands, facts, payloads, progress, driver, calls, pair, values, permission, permissionResponses,
    get initialize() { return initialize }, get beginText() { return beginText }, get connectCount() { return connectCount },
    get preparedRef() { return preparedRef }, get nativePermissionId() { return nativePermissionId },
    async start() { const work = driver.serve(spec, io); await waitFor(() => !!preparedRef || facts.some(fact => fact.kind === 'runtime.error'))
      return { work, begin: () => commands.push(makeCommand('begin', { ...ref, id: 'controlled-begin', inputRef: 'controlled-input', preparedPolicyRef: preparedRef })) } },
    async answer(patch: Record<string, unknown> = {}, questionIndex = 0, commandId = 'controlled-answer-command') {
      const question = values('question.opened')[questionIndex] as unknown as { id: string; version: number; targets: object[]; presentation: { options: { id: string }[] } }
      const binding = question.targets[0] as Record<string, Json>
      const bindingRef = `binding-${commandId}`, answerRef = `answer-${commandId}`
      payloads.set(bindingRef, JsonSchema.parse(binding))
      payloads.set(answerRef, JsonSchema.parse({ answerId: `record-${commandId}`, questionId: question.id, questionVersion: question.version,
        nativeBinding: binding, answer: { kind: 'choices', optionIds: [question.presentation.options[0].id] }, authorityRef: 'authority-1', ...patch }))
      commands.push(makeCommand('answer', { ...ref, id: commandId, nativeBindingRef: bindingRef, answerRef }))
    },
    stop() { commands.push(makeCommand('cancel', { ...ref, id: 'controlled-cancel' })) },
    resolvePrompt: pendingPrompt.resolve,
    close() { commands.close(); pair.server.close() },
  }
}

test('missing trusted policy host refuses before any connection or OS spawn', async () => {
  const f = fixture({ policyHost: false })
  try { const exit = await f.driver.serve(f.spec, f.io); assert.equal(exit.reason, 'error'); assert.equal(f.connectCount, 0); assert.equal(f.calls.length, 0) }
  finally { f.close() }
})

test('profile policy labels cannot declare enforced verification', () => {
  assert.equal(AcpV1SettingsSchema.safeParse({ kind: 'acp-v1-settings/1', workspacePath: '/controlled', scope: {
    projectId: 'p', allowedPaths: ['.'], excludedPaths: [], externalActions: [] }, enforcement: 'enforced', verification: 'passed' }).success, false)
})

test('original policy gate rejects approval-guarded, unverified or mismatched attempt', async () => {
  for (const mutatePolicy of [
    (policy: PreparedExecutionPolicy) => ({ ...policy, enforcement: 'approval_guarded' as const }),
    (policy: PreparedExecutionPolicy) => ({ ...policy, verification: 'not_tested' as const }),
    (policy: PreparedExecutionPolicy) => ({ ...policy, attemptId: 'wrong-attempt' }),
  ]) {
    const f = fixture({ mutatePolicy })
    try { const exit = await f.driver.serve(f.spec, f.io); assert.equal(exit.reason, 'error'); assert.ok(!f.calls.includes('session/prompt')); assert.equal(f.values('policy.prepared').length, 0) }
    finally { f.close() }
  }
})

test('official SDK stdio pair streams unicode and consumes original payload, no invented capabilities', async () => {
  const text = '中文🙂'.repeat(5000)
  const f = fixture({ prompt: async context => {
    await context.client.notify(methods.client.session.update, { sessionId: context.params.sessionId,
      update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } })
    return { stopReason: 'end_turn' }
  } })
  try {
    const { work, begin } = await f.start(); begin(); const exit = await work
    assert.equal(exit.reason, 'terminal'); assert.equal(f.beginText, 'change controlled source only')
    assert.equal(f.initialize?.clientCapabilities?.fs?.readTextFile, false)
    assert.equal(f.initialize?.clientCapabilities?.fs?.writeTextFile, false)
    assert.equal(f.initialize?.clientCapabilities?.terminal, false)
    let tail = text.slice(-8192)
    if (tail.charCodeAt(0) >= 0xdc00 && tail.charCodeAt(0) <= 0xdfff) tail = tail.slice(1)
    assert.equal(f.progress.at(-1), tail)
    assert.deepEqual(f.values('dispatch.observed').map(value => (value as { delivery: string }).delivery), ['written', 'native_accepted'])
    assert.deepEqual(f.values('turn.ended').map(value => (value as { candidateAvailable: boolean }).candidateAvailable), [true])
  } finally { f.close() }
})

test('refusal or token-limit responses cannot become a successful terminal candidate', async () => {
  for (const stopReason of ['refusal', 'max_tokens', 'max_turn_requests'] as const) {
    const f = fixture({ prompt: async () => ({ stopReason }) })
    try {
      const { work, begin } = await f.start(); begin()
      assert.equal((await work).reason, 'error')
      assert.deepEqual(f.values('turn.ended').map(value => {
        const turn = value as { outcome: string; candidateAvailable: boolean }
        return [turn.outcome, turn.candidateAvailable]
      }), [['failed', false]])
    } finally { f.close() }
  }
})

test('permission preserves original options and request identity; response_written follows actual SDK write', async () => {
  let guardCalls = 0
  const f = fixture({ guard: async command => { guardCalls++; assert.equal(command.id, 'controlled-answer-command') },
    prompt: async context => { await f.permission(context); return { stopReason: 'end_turn' } } })
  try {
    const { work, begin } = await f.start(); begin(); await waitFor(() => f.values('question.opened').length === 1)
    const question = f.values('question.opened')[0] as unknown as { targets: { nativeRequestId: { kind: string; decimal: string } }[]; presentation: { options: { semantic: string }[] } }
    assert.equal(question.targets[0].nativeRequestId.kind, 'integer')
    assert.equal(question.presentation.options[1].semantic, 'native_other', 'always approval must not be disguised as allow_once')
    await f.answer(); assert.equal((await work).reason, 'terminal')
    assert.equal(guardCalls, 1)
    assert.deepEqual(f.permissionResponses, [{ outcome: { outcome: 'selected', optionId: 'native/allow-once' } }])
    assert.deepEqual(f.values('answer.observed').map(value => (value as { status: string }).status), ['response_written'])
    assert.ok(f.values('dispatch.observed').some(value => (value as { commandId: string }).commandId === 'controlled-answer-command'))
  } finally { f.close() }
})

test('terminal waits for normal transport EOF without granting writer quiescence', async () => {
  const closed = deferred<void>()
  let eofEntered = false, returned = false
  const f = fixture({ closeInput: async () => { eofEntered = true; await closed.promise }, prompt: async () => ({ stopReason: 'end_turn' }) })
  try {
    const { work, begin } = await f.start(); begin()
    void work.then(() => { returned = true })
    await waitFor(() => eofEntered)
    assert.equal(returned, false)
    closed.resolve(); assert.equal((await work).reason, 'terminal')
    assert.equal(f.values('writer.observed').length, 0)
  } finally { closed.resolve(); f.close() }
})

test('standard permission with only toolCallId still opens and answers the original native request', async () => {
  const f = fixture({ permissionTitle: false, prompt: async context => { await f.permission(context); return { stopReason: 'end_turn' } } })
  try {
    const { work, begin } = await f.start(); begin(); await waitFor(() => f.values('question.opened').length === 1)
    const question = f.values('question.opened')[0] as unknown as { prompt: string; nativePayloadRef: string }
    assert.match(question.prompt, /controlled-tool/)
    const original = f.payloads.get(question.nativePayloadRef) as { params: { toolCall: object } }
    assert.deepEqual(original.params.toolCall, { toolCallId: 'controlled-tool' })
    await f.answer(); assert.equal((await work).reason, 'terminal')
    assert.deepEqual(f.permissionResponses, [{ outcome: { outcome: 'selected', optionId: 'native/allow-once' } }])
    assert.equal(f.values('answer.observed').length, 1)
  } finally { f.close() }
})

test('stale answer refuses without native selection; cancellation resolves outstanding permission', async () => {
  const f = fixture({ prompt: async context => { await f.permission(context); return { stopReason: 'cancelled' } } })
  try {
    const { work, begin } = await f.start(); begin(); await waitFor(() => f.values('question.opened').length === 1)
    await f.answer({ questionVersion: 2 }); await waitFor(() => f.values('runtime.error').length > 0)
    assert.equal(f.values('answer.observed').length, 0); assert.equal(f.permissionResponses.length, 0)
    f.stop(); assert.equal((await work).reason, 'cancelled')
    assert.deepEqual(f.permissionResponses, [{ outcome: { outcome: 'cancelled' } }])
    assert.equal(f.values('cancel.observed').length, 1)
    assert.equal(f.values('writer.observed').length, 0, 'protocol cancellation is not a physical barrier')
  } finally { f.close() }
})

test('a peer can reuse a completed standard request ID; old targets cannot answer the new permission', async () => {
  const f = fixture({ reusePermissionId: true, prompt: async context => {
    await f.permission(context); await f.permission(context)
    return { stopReason: 'end_turn' }
  } })
  try {
    const { work, begin } = await f.start(); begin(); await waitFor(() => f.values('question.opened').length === 1)
    await f.answer()
    await waitFor(() => f.values('question.opened').length === 2)
    const questions = f.values('question.opened') as unknown as Array<{ id: string; targets: { id: string; nativeRequestId: { kind: string; value: string } }[] }>
    assert.notEqual(questions[0].id, questions[1].id)
    assert.notEqual(questions[0].targets[0].id, questions[1].targets[0].id)
    assert.deepEqual(questions.map(question => question.targets[0].nativeRequestId), [
      { kind: 'string', value: 'reused-permission' }, { kind: 'string', value: 'reused-permission' },
    ])
    await f.answer({}, 0, 'controlled-late-old-answer')
    await waitFor(() => f.values('runtime.error').some(value => (value as { message: string }).message === 'acp-answer-target-mismatch'))
    assert.equal(f.permissionResponses.length, 1)
    await f.answer({}, 1, 'controlled-second-answer')
    assert.equal((await work).reason, 'terminal')
    assert.equal(f.permissionResponses.length, 2)
    assert.equal(f.values('answer.observed').length, 2)
  } finally { f.close() }
})

test('fresh guard refusal writes zero selected permission responses', async () => {
  const f = fixture({ guard: async () => { throw new Error('controlled stale authority') },
    prompt: async context => { await f.permission(context); return { stopReason: 'end_turn' } } })
  try {
    const { work, begin } = await f.start(); begin(); await waitFor(() => f.values('question.opened').length === 1)
    await f.answer(); assert.notEqual((await work).reason, 'terminal')
    assert.equal(f.permissionResponses.filter(value => value.outcome.outcome === 'selected').length, 0)
    assert.equal(f.values('answer.observed').length, 0)
  } finally { f.close() }
})

test('original Runner closure between input read and queued SDK write sends zero prompts', async () => {
  let open = true
  const f = fixture({ businessOpen: () => open })
  const read = f.io.payloads.read
  f.io.payloads.read = async reference => {
    const value = await read(reference)
    if (reference === 'controlled-input') queueMicrotask(() => { open = false })
    return value
  }
  try {
    const { work, begin } = await f.start(); begin()
    assert.notEqual((await work).reason, 'terminal')
    assert.equal(f.calls.filter(item => item === 'session/prompt').length, 0)
  } finally { f.close() }
})

test('refused dispatch fact ACK still cancels the one active native prompt before closing', async () => {
  const f = fixture()
  const record = f.io.record
  f.io.record = async fact => {
    const payload = RuntimeFactPayloadSchema.parse(f.payloads.get(fact.payloadRef))
    if (payload.kind === 'dispatch.observed' && payload.value.delivery === 'written') throw new Error('controlled original fence refusal')
    return record(fact)
  }
  try {
    const { work, begin } = await f.start(); begin()
    assert.notEqual((await work).reason, 'terminal')
    assert.equal(f.calls.filter(item => item === 'session/prompt').length, 1)
    assert.equal(f.calls.filter(item => item === 'session/cancel').length, 1)
    assert.equal(f.values('cancel.observed').length, 0, 'internal cleanup must not invent a user-command receipt')
  } finally { f.close() }
})

test('selected permission cannot cross a Runner stop while the original fresh guard is pending', async () => {
  let open = true
  const entered = deferred<void>(), release = deferred<void>()
  const f = fixture({ businessOpen: () => open, guard: async () => { entered.resolve(); await release.promise },
    prompt: async context => { await f.permission(context); return { stopReason: 'end_turn' } } })
  try {
    const { work, begin } = await f.start(); begin(); await waitFor(() => f.values('question.opened').length === 1)
    await f.answer(); await entered.promise; open = false; f.stop(); release.resolve()
    assert.notEqual((await work).reason, 'terminal')
    assert.equal(f.permissionResponses.filter(value => value.outcome.outcome === 'selected').length, 0)
    assert.equal(f.values('answer.observed').length, 0)
  } finally { release.resolve(); f.close() }
})

test('unsupported deliver and duplicate begin never create a second prompt; cancel stays responsive', async () => {
  const f = fixture()
  try {
    const { work, begin } = await f.start(); begin(); await waitFor(() => f.calls.includes('session/prompt'))
    begin(); f.commands.push(makeCommand('deliver', { ...f.ref, id: 'controlled-deliver', inputRef: 'controlled-input' }))
    await waitFor(() => f.values('runtime.error').length === 2); f.stop()
    assert.equal((await work).reason, 'cancelled')
    assert.equal(f.calls.filter(value => value === 'session/prompt').length, 1)
  } finally { f.close() }
})

test('unadvertised model/config/mode requests refuse before prompt', async () => {
  for (const settings of [{ modeId: 'yolo' }, { configSelections: [{ configId: 'model', value: 'guessed-model' }] }]) {
    const f = fixture({ settings })
    try { assert.equal((await f.driver.serve(f.spec, f.io)).reason, 'error'); assert.ok(!f.calls.includes('session/prompt')) }
    finally { f.close() }
  }
})

test('probe preserves initialize-only observation alongside standard declaration and never grants execution', async () => {
  const f = fixture()
  try {
    const handshake = await probeAcpHandshake({ transport: f.pair.transport, timeoutMs: 1200 })
    assert.deepEqual(f.calls, ['initialize'])
    assert.equal(f.initialize?.clientCapabilities?.fs?.readTextFile, false)
    assert.equal(f.initialize?.clientCapabilities?.terminal, false)
    const result = await inspectAcpCompatibility(f.spec.profile, {
      async inspectExecutable() { return { version: '1.0.0', digest: 'b'.repeat(64), evidenceRef: 'controlled-executable' } },
      async inspectConfig() { return { fingerprint, stability: 'frozen' } },
    }, { handshake: async () => handshake })
    assert.equal(result.verdict.class, 'compatible_unverified'); assert.equal(result.report.readiness, 'inspection_passed')
    assert.equal(result.observedVerdict?.class, 'unknown')
    assert.deepEqual(result.observation?.surface.methods, ['initialize'])
    assert.equal(result.declaration?.origin, 'protocol_declaration')
    assert.equal(result.declaration?.grantsExecution, false)
    assert.equal(result.verdict.nativeTestPassed, false)
    assert.ok(result.report.identity?.sdkVersion === '2.12.0')
  } finally { f.close() }
})

test('reconcile consumes original runtime observation and never promotes a terminal journal', async () => {
  const driver = new AcpDriver(), spec = makeAttemptSpec()
  const report = await driver.reconcile({ ...attemptIdentity(spec), ownership: 'spawned_process', runnerIdentityRef: 'r', connectionEpoch: 1 }, {
    async inspectRuntime() { return { status: 'terminal', writer: 'indeterminate', evidenceRefs: ['controlled-runtime-unknown'] } },
    async readJournal() { throw new Error('journal must not become resource authority') },
  })
  assert.equal(report.writer, 'indeterminate'); assert.equal(report.status, 'terminal')
})
