import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { serveRunner } from '../src/runner-service.ts'
import { RunnerPayloadStore } from '../src/payload-store.ts'
import { endpointDirectory } from '../src/recovery-endpoint.ts'
import { connectRunnerRecovery, verifiedRunnerInspection } from '../../../packages/execution/src/recovery-transport.ts'
import { AcpDriver, type AcpPolicyHost } from '../../../packages/drivers/acp-v1/src/index.ts'
import { createControlledAcpAgent } from '../../../packages/drivers/acp-v1/test/controlled-agent.ts'
import { makeAttemptSpec, makeCommand } from '../../../packages/testing/src/fixtures.ts'
import { attemptIdentity } from '../../../packages/driver-kit/src/attempt-io.ts'
import { JsonSchema, RuntimeFactPayloadSchema } from '../../../packages/contracts/src/schemas.ts'
import type { CriticalFact, Json } from '../../../packages/contracts/src/types.ts'

async function until(predicate: () => boolean) {
  const end = Date.now() + 4000
  while (!predicate()) { assert.ok(Date.now() < end, 'controlled original Runner timed out'); await new Promise(resolve => setTimeout(resolve, 5)) }
}

for (const action of ['allow', 'reject', 'cancel', 'endpoint-cancel'] as const) test(`original Runner carries standard ACP ${action}, command receipts and progress`, { timeout: 8000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pa-original-acp-runner-')), workspace = join(root, 'workspace')
  await mkdir(workspace)
  const spec = makeAttemptSpec({ profile: { ...makeAttemptSpec().profile, driverId: 'acp-v1' } }), ref = attemptIdentity(spec)
  const input = new PassThrough(), facts: CriticalFact[] = [], frames: Record<string, unknown>[] = []
  const local = new RunnerPayloadStore(join(root, 'payloads')), external = new Map<string, Json>()
  let preparedRef = '', guards = 0
  const payload = (fact: CriticalFact) => RuntimeFactPayloadSchema.parse(local.read(fact.payloadRef))
  const fixture = createControlledAcpAgent({ permission: true, hold: action === 'cancel' || action === 'endpoint-cancel' })
  const policyHost: AcpPolicyHost = {
    async prepare({ spec, io }) {
      const evidenceRef = await io.payloads.store({ controlledNativePolicy: true }, 'critical')
      return { policy: { ...attemptIdentity(spec), requestedPolicyRevision: spec.profile.permissionPolicyRevision,
        nativeAppliedSettingsRef: evidenceRef, effectiveConfigFingerprint: 'a'.repeat(64), enforcement: 'enforced', verification: 'passed', evidenceRef }, currentFingerprint: 'a'.repeat(64) }
    }, async currentFingerprint() { return 'a'.repeat(64) },
  }
  spec.policySnapshotRef = local.write({ kind: 'acp-v1-settings/1', workspacePath: workspace,
    scope: { projectId: 'project-1', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }, timeoutMs: 2000 }, 'critical')
  const inputRef = local.write({ inputId: 'runner-input', contract: spec.contract, text: 'Use the original authorized payload',
    contextRefs: [], sourceMessageRefs: [], provenance: 'authorized_work_input' }, 'critical')
  const send = (frame: object) => input.write(Buffer.from(JSON.stringify({ v: 1, ...frame }) + '\n'))
  const serving = serveRunner({
    input, eagerPrepare: true, write: frame => frames.push({ ...frame }),
    ...(action === 'endpoint-cancel' ? { recoveryRoot: join(root, 'recovery') } : {}),
    payloads: { async read(reference) { const value = external.get(reference); return value ?? local.read(reference) } },
    createDriver: (_spec, hooks) => new AcpDriver({ connect: fixture.connect, policyHost, beforeAnswerWrite: hooks.beforeNativeWrite, businessOpen: hooks.isBusinessOpen }),
    beforeNativeWrite: async command => { assert.equal(command.id, 'runner-answer'); guards++ },
    sink: { async record(fact) { const value = payload(fact); facts.push(fact)
      if (value.kind === 'policy.prepared') preparedRef = local.write(JsonSchema.parse(value.value), 'critical')
      return { factId: fact.factId, persisted: true, seq: facts.length } } },
  })
  send({ type: 'bootstrap', id: 'bootstrap', spec, payloadRoot: join(root, 'payloads'), journalPath: join(root, 'critical.journal'),
    producer: { source: 'acp-v1', runnerIdentityRef: 'controlled-acp-runner' } })
  try {
    await until(() => !!preparedRef && frames.some(frame => frame.type === 'ready'))
    send({ type: 'command', id: 'runner-begin', command: makeCommand('begin', { ...ref, id: 'runner-begin', inputRef, preparedPolicyRef: preparedRef }) })
    await until(() => facts.some(fact => fact.kind === 'question.opened'))
    const opened = payload(facts.find(fact => fact.kind === 'question.opened')!)
    assert.equal(opened.kind, 'question.opened')
    if (opened.kind !== 'question.opened') throw new Error('unreachable')
    if (action === 'endpoint-cancel') {
      const directory = endpointDirectory(join(root, 'recovery'), spec.attemptId), socketPath = join(directory, 'runner.sock'), stat = lstatSync(socketPath)
      const client = connectRunnerRecovery({ socketPath, credentialPath: join(directory, 'runner.credential'), socketIdentity: { dev: stat.dev, ino: stat.ino } },
        { attempt: ref, source: 'acp-v1', runnerIdentityRef: 'controlled-acp-runner' })
      const inspection = verifiedRunnerInspection(await client.cancel(makeCommand('cancel', { ...ref, id: 'runner-endpoint-cancel' }))).value
      assert.equal(inspection.coverage, 'complete_owned_resources')
      assert.equal(fixture.observations.cancellations.length, 1, 'standard cancellation must reach the peer before physical stop')
    } else if (action === 'cancel') send({ type: 'command', id: 'runner-cancel', command: makeCommand('cancel', { ...ref, id: 'runner-cancel' }) })
    else {
      const question = opened.value, binding = question.targets[0]!
      assert.equal(question.presentation.kind, 'choices')
      if (question.presentation.kind !== 'choices') throw new Error('unreachable')
      const nativeBindingRef = local.write(JsonSchema.parse(binding), 'critical')
      const answerRef = local.write(JsonSchema.parse({ answerId: 'runner-answer-record', questionId: question.id, questionVersion: question.version,
        nativeBinding: binding, answer: { kind: 'choices', optionIds: [question.presentation.options[action === 'allow' ? 0 : 1]!.id] }, authorityRef: 'authority-1' }), 'critical')
      send({ type: 'command', id: 'runner-answer', command: makeCommand('answer', { ...ref, id: 'runner-answer', nativeBindingRef, answerRef }) })
    }
    await until(() => frames.some(frame => frame.type === 'exited'))
    input.end()
    const service = await serving, result = await service.done
    if (action !== 'endpoint-cancel') assert.equal(result.reason, action === 'cancel' ? 'cancelled' : action === 'reject' ? 'error' : 'terminal')
    const dispatches = facts.map(payload).filter(value => value.kind === 'dispatch.observed').map(value => value.value)
    if (action !== 'endpoint-cancel') {
      assert.ok(dispatches.some(value => value.commandId === 'runner-begin' && value.delivery === 'native_accepted'))
      assert.ok(dispatches.some(value => value.commandId === (action === 'cancel' ? 'runner-cancel' : 'runner-answer') && value.delivery === 'written'))
    }
    assert.ok(frames.some(frame => frame.type === 'progress' && typeof frame.text === 'string' && frame.text.includes('受控工作')))
    assert.equal(guards, action === 'cancel' || action === 'endpoint-cancel' ? 0 : 1)
    if (action === 'allow') assert.equal(await readFile(join(workspace, 'src/product-output.txt'), 'utf8'), 'approved product output\n')
    else await assert.rejects(readFile(join(workspace, 'src/product-output.txt')))
    assert.equal(fixture.observations.prompts.length, 1)
    await service.shutdown()
  } finally { input.end(); fixture.close(); const service = await serving.catch(() => undefined); await service?.shutdown(); await rm(root, { recursive: true, force: true }) }
})
