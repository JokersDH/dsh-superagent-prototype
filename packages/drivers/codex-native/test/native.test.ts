import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { JsonSchema, parseRuntimeFactPayload } from '@personal-agent/contracts'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import type { AttemptIO, Json, RunnerCommand } from '@personal-agent/contracts'
import { CommandQueue, attemptIdentity } from '../../../driver-kit/src/index.ts'
import { makeAttemptSpec } from '../../../testing/src/index.ts'
import { CodexProductDriver } from '../src/native.ts'
import { losslessId, parseLossless } from '../src/protocol.ts'

type Options = {
  earlyTerminal?: boolean
  requestIds?: string[]
  resolvedKey?: 'requestId' | 'id'
  wrongTerminal?: boolean
  rejectWrite?: boolean
  wrongAnswer?: boolean
  foreignCommand?: boolean
  foreignInput?: boolean
  clarification?: boolean
  missingForm?: boolean
  unsafePolicy?: boolean
  foreignNativeThread?: boolean
  terminalStatus?: string
}

async function fixture(t: TestContext, options: Options = {}) {
  const workspace = realpathSync(mkdtempSync('/tmp/pa-native-driver-'))
  const values = new Map<string, Json>()
  const payloads: AttemptIO['payloads'] = {
    store: async (value) => {
      const ref = `payload:${canonicalDigest(value)}`
      values.set(ref, structuredClone(value))
      return ref
    },
    read: async (ref) => {
      const value = values.get(ref)
      if (value === undefined) throw new Error('Unknown immutable payload')
      return structuredClone(value)
    },
  }
  const settings = await payloads.store(
    {
      kind: 'codex-native-settings/1',
      workspacePath: workspace,
      scope: { projectId: 'project-1', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] },
      approvalPolicy: 'on-request',
      timeoutMs: 1000,
    },
    'critical',
  )
  const spec = makeAttemptSpec({ policySnapshotRef: settings })
  const identity = attemptIdentity(spec)
  const inputRef = await payloads.store(
    {
      inputId: 'input-1',
      contract: options.foreignInput ? { ...spec.contract, revision: 2 } : spec.contract,
      text: 'Implement the actual user requirement',
      contextRefs: [],
      sourceMessageRefs: [],
      provenance: 'authorized_work_input',
    },
    'critical',
  )
  const queue = new CommandQueue()
  const stdout = new PassThrough(),
    stderr = new PassThrough()
  let exitChild!: () => void,
    beforeCalls = 0
  const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    exitChild = () => resolve({ code: 0, signal: null })
  })
  const sent: { raw: string; value: Record<string, unknown> }[] = [],
    records: { kind: string; value: Record<string, unknown> }[] = []
  const emit = (value: unknown) => stdout.write(Buffer.from(JSON.stringify(value) + '\n'))
  const raw = (text: string) => stdout.write(Buffer.from(text + '\n'))
  let replied = 0
  const terminal = () =>
    emit({
      method: 'turn/completed',
      params: {
        threadId: options.foreignNativeThread ? 'foreign-thread' : 'thread-1',
        turn: { id: options.wrongTerminal ? 'foreign-turn' : 'turn-1', status: options.terminalStatus ?? 'completed' },
      },
    })
  const io: AttemptIO = {
    commands: queue,
    payloads,
    publishProgress: () => undefined,
    runtime: {
      spawn: async () => ({ resourceRef: 'resource-codex', stdout, stderr, exited }),
      write: async (_ref, bytes) => {
        const text = Buffer.from(bytes).toString('utf8').trim(),
          value = JSON.parse(text)
        sent.push({ raw: text, value })
        if (value.method === 'initialize') emit({ id: value.id, result: {} })
        else if (value.method === 'thread/start')
          emit({
            id: value.id,
            result: {
              thread: { id: 'thread-1' },
              cwd: workspace,
              approvalPolicy: 'on-request',
              model: 'model-fixture',
              sandbox: {
                type: 'workspaceWrite',
                networkAccess: !!options.unsafePolicy,
                writableRoots: [],
                excludeSlashTmp: true,
                excludeTmpdirEnvVar: true,
              },
            },
          })
        else if (value.method === 'turn/start') {
          if (options.earlyTerminal) {
            terminal()
            setTimeout(() => emit({ id: value.id, result: { turn: { id: 'turn-1' } } }), 30)
          } else {
            emit({ id: value.id, result: { turn: { id: 'turn-1' } } })
            if (options.requestIds?.length) {
              for (const id of options.requestIds) {
                if (options.clarification)
                  raw(
                    `{"id":${id},"method":"item/tool/requestUserInput","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"item-1","isBlocking":true,"questions":[{"id":"design-choice","header":"Approach","question":"Choose the approach","options":[{"label":"Alpha"},{"label":"Beta"}]},{"id":"filename","header":"File","question":"Choose the file name"}]}}`,
                  )
                else
                  raw(
                    `{"id":${id},"method":"item/commandExecution/requestApproval","params":{"threadId":"thread-1","turnId":"turn-1","itemId":"item-1","command":"node --test","reason":"Run project tests"}}`,
                  )
              }
            } else terminal()
          }
        } else if (!value.method && 'result' in value) {
          const response = parseLossless(text) as Record<string, unknown>
          const id = losslessId(response.id)
          const wire = id.kind === 'integer' ? id.decimal : JSON.stringify(id.value)
          raw(
            `{"method":"serverRequest/resolved","params":{"threadId":"thread-1","${options.resolvedKey ?? 'requestId'}":${wire}}}`,
          )
          if (++replied === options.requestIds?.length) terminal()
        }
      },
      stopOwned: async () => {
        stdout.end()
        stderr.end()
        exitChild()
        return { quiescence: 'confirmed', evidenceRefs: ['fixture-stopped'] }
      },
    },
    record: async (fact) => {
      const payload = parseRuntimeFactPayload(fact, await payloads.read(fact.payloadRef))
      records.push({ kind: payload.kind, value: payload.value as Record<string, unknown> })
      if (payload.kind === 'policy.prepared') {
        const preparedPolicyRef = await payloads.store(JsonSchema.parse(payload.value), 'critical')
        queue.push({
          ...identity,
          ...(options.foreignCommand ? { attemptId: 'foreign-attempt' } : {}),
          id: 'begin-1',
          kind: 'begin',
          inputRef,
          preparedPolicyRef,
        })
      }
      if (payload.kind === 'question.opened') {
        const binding = payload.value.targets[0]!
        const nativeBindingRef = await payloads.store(JsonSchema.parse(binding), 'critical')
        const answerRef = await payloads.store(
          {
            answerId: `answer-${records.length}`,
            questionId: options.wrongAnswer ? 'foreign-question' : payload.value.id,
            questionVersion: 1,
            nativeBinding: JsonSchema.parse(binding),
            answer: options.clarification
              ? { kind: 'form', values: options.missingForm ? {} : { 'field-0': 'option-1', 'field-1': 'result.mjs' } }
              : { kind: 'choices', optionIds: ['accept'] },
            authorityRef: 'local-human',
          },
          'critical',
        )
        queue.push({ ...identity, id: `answer-command-${records.length}`, kind: 'answer', nativeBindingRef, answerRef })
      }
      return { factId: fact.factId, persisted: true, seq: records.length }
    },
  }
  const driver = new CodexProductDriver({
    beforeAnswerWrite: async () => {
      beforeCalls++
      if (options.rejectWrite) throw new Error('Broker rejected this write')
    },
  })
  t.after(() => {
    queue.close('test-finished', true)
    stdout.destroy()
    stderr.destroy()
    exitChild()
    rmSync(workspace, { recursive: true, force: true })
  })
  return {
    running: driver.serve(spec, io),
    sent,
    records,
    get beforeCalls() {
      return beforeCalls
    },
  }
}

test('native adapter prepares policy before business and sends actual immutable input text', async (t) => {
  const h = await fixture(t)
  assert.equal((await h.running).reason, 'terminal')
  assert.ok(
    h.records.findIndex((record) => record.kind === 'policy.prepared') <
      h.records.findIndex((record) => record.kind === 'dispatch.observed'),
  )
  assert.deepEqual(
    (h.sent.find((frame) => frame.value.method === 'turn/start')!.value.params as { input: unknown }).input,
    [{ type: 'text', text: 'Implement the actual user requirement' }],
  )
})
test('native adapter retains a terminal arriving before the turn-start response', async (t) => {
  const h = await fixture(t, { earlyTerminal: true })
  assert.equal((await h.running).reason, 'terminal')
  assert.equal(h.records.filter((record) => record.kind === 'turn.ended').length, 1)
})
test('native adapter preserves int64 request IDs through framing, answers and resolved observations', async (t) => {
  const h = await fixture(t, { requestIds: ['9223372036854775807'] })
  assert.equal((await h.running).reason, 'terminal')
  const response = h.sent.find((frame) => !frame.value.method && 'result' in frame.value)!
  assert.match(response.raw, /"id":9223372036854775807/)
  assert.equal(
    h.records.filter((record) => record.kind === 'answer.observed' && record.value.status === 'native_applied').length,
    1,
  )
})
test('native adapter keeps an integer and equal-looking string request separate', async (t) => {
  const h = await fixture(t, { requestIds: ['43', '"43"'] })
  assert.equal((await h.running).reason, 'terminal')
  const responses = h.sent.filter((frame) => !frame.value.method && 'result' in frame.value)
  assert.equal(responses.length, 2)
  assert.ok(responses.some((frame) => /"id":43,/.test(frame.raw)))
  assert.ok(responses.some((frame) => /"id":"43",/.test(frame.raw)))
  assert.equal(h.records.filter((record) => record.kind === 'answer.observed').length, 2)
})
test('native adapter cannot write an answer when Broker admission fails', async (t) => {
  const h = await fixture(t, { requestIds: ['7'], rejectWrite: true })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.beforeCalls, 1)
  assert.equal(h.sent.filter((frame) => !frame.value.method && 'result' in frame.value).length, 0)
  assert.equal(h.records.filter((record) => record.kind === 'answer.observed').length, 0)
})
test('native adapter refuses an answer for another question before asking write admission', async (t) => {
  const h = await fixture(t, { requestIds: ['7'], wrongAnswer: true })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.beforeCalls, 0)
  assert.equal(h.sent.filter((frame) => !frame.value.method && 'result' in frame.value).length, 0)
})
test('native adapter refuses a command for another attempt before starting native business', async (t) => {
  const h = await fixture(t, { foreignCommand: true })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.sent.filter((frame) => frame.value.method === 'turn/start').length, 0)
})
test('native adapter refuses immutable input from another contract', async (t) => {
  const h = await fixture(t, { foreignInput: true })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.sent.filter((frame) => frame.value.method === 'turn/start').length, 0)
})
test('native adapter never turns another turn completion into a successful candidate', async (t) => {
  const h = await fixture(t, { wrongTerminal: true })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.records.filter((record) => record.kind === 'turn.ended').length, 0)
})
test('native clarification preserves original choices and field-to-native-question mapping', async (t) => {
  const h = await fixture(t, { requestIds: ['7'], clarification: true })
  assert.equal((await h.running).reason, 'terminal')
  const response = h.sent.find((frame) => !frame.value.method && 'result' in frame.value)!
  assert.deepEqual(response.value.result, {
    answers: { 'design-choice': { answers: ['Beta'] }, filename: { answers: ['result.mjs'] } },
  })
})
test('native clarification refuses missing required values before physical write admission', async (t) => {
  const h = await fixture(t, { requestIds: ['7'], clarification: true, missingForm: true })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.beforeCalls, 0)
})
test('native policy cannot prepare when the native handshake enables network access', async (t) => {
  const h = await fixture(t, { unsafePolicy: true })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.records.filter((record) => record.kind === 'policy.prepared').length, 0)
  assert.equal(h.sent.filter((frame) => frame.value.method === 'turn/start').length, 0)
})
test('native terminal from another thread cannot deliver', async (t) => {
  const h = await fixture(t, { foreignNativeThread: true })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.records.filter((record) => record.kind === 'turn.ended').length, 0)
})
test('an unknown native terminal status is not interpreted as success', async (t) => {
  const h = await fixture(t, { terminalStatus: 'unknown' })
  assert.equal((await h.running).reason, 'error')
  assert.equal(h.records.filter((record) => record.kind === 'turn.ended').length, 0)
})
