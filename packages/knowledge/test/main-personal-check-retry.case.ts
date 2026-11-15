import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore } from '@personal-agent/storage'
import { createProductRuntime } from '../../../apps/coordinator/product/runtime.ts'
import { ensureStarterProject, NativeProjectRegistry } from '../../../apps/coordinator/product/project-registry.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const tool = join(repoRoot, 'packages/context/tools/wave31-completion-history.mjs')
const aWorktree = process.env.PA_AGENT_A ?? '/Users/hh/Desktop/joker/superagent-agent-a'
const principal = { userId: 'wave31-check-user', authorityRef: 'wave31-check-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const apiToken = 'a'.repeat(64)
const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }

function facts(database: string, workId: string, projectId: string): Record<string, any> {
  const result = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', tool,
    '--a-worktree', aWorktree, '--db', database, '--work', workId, '--project', projectId], { encoding: 'utf8', timeout: 60000 })
  return JSON.parse(result.stdout.trim().split('\n').at(-1)!) as Record<string, any>
}

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 30000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`check flow timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 20))
  }
}

test('a failed machine check never becomes an acceptance and a corrected new Work keeps its own identity', { timeout: 180000 }, async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave31-check-'))
  const stateRoot = join(root, 'state')
  mkdirSync(stateRoot, { mode: 0o700 })
  const registry = new NativeProjectRegistry(stateRoot)
  const paths = [join(root, 'project-a'), join(root, 'project-b')]
  const records = paths.map((path, index) => {
    ensureStarterProject(path)
    const record = registry.prepare({ path, displayName: `wave31-check-${index}`, check: 'node_test' })
    registry.save(record)
    return record
  })
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createProductRuntime({ store, stateRoot, scratchProject: paths[0]!, projectRegistry: registry,
    projects: records.map((record) => ({ id: record.id, displayName: record.displayName,
      scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } })),
    principal, actionSecret: Buffer.alloc(32, 14) })
  t.after(async () => { await product.close().catch(() => undefined); store.close(); rmSync(root, { recursive: true, force: true }) })
  const app = createLocalHttpApp({ application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:4400'], mode: 'fixture', read: product.read, operations: product.operations })
  product.start()
  const scopeFor = (projectId: string) => ({ projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })
  const criteria = [
    { id: 'criterion-output', kind: 'machine' as const, required: true, description: 'Fixed output matches', checkDefinitionRef: 'check-fixture-output' },
    { id: 'criterion-human', kind: 'human' as const, required: true, description: 'Review the output' },
  ]

  // Project A: the real broker question is answered explicitly before the candidate is accepted.
  const createdA = (await product.application.dispatch({ kind: 'create_work', commandId: 'w31-check-a-work',
    conversationId: 'w31-check-a-chat', projectId: records[0]!.id, goal: 'A 项目检查', profileId: 'profile-fixture-question',
    scope: scopeFor(records[0]!.id), criteria }, actor)) as unknown as { workId: string }
  const question = await until(async () => (await product.application.inspect({ workId: createdA.workId })).questions[0],
    (value) => value !== undefined)
  const deliveries = (await (await app.request(`/v1/questions/${question!.id}/deliveries`, { headers })).json()) as Record<string, any>
  assert.equal(Array.isArray(deliveries), true)
  await product.application.dispatch({ kind: 'answer_question', commandId: 'w31-check-a-answer', conversationId: 'w31-check-a-chat',
    questionId: question!.id, expectedVersion: question!.version, answer: { kind: 'choices', optionIds: ['allow'] } }, actor)
  const readyA = await until(async () => (await product.application.inspect({ workId: createdA.workId })).works[0],
    (value) => value !== undefined && value.actions.available.includes('accept_candidate'))
  const deliveriesAfter = await until(async () => (await (await app.request(`/v1/questions/${question!.id}/deliveries`, { headers })).json()) as { status: string }[],
    (value) => value[0]?.status === 'native_applied')
  assert.equal(deliveriesAfter[0]?.status, 'native_applied')
  await product.application.dispatch({ kind: 'accept_candidate', commandId: 'w31-check-a-accept',
    conversationId: 'w31-check-a-chat', candidate: readyA!.actions.currentCandidate! }, actor)
  assert.equal((await product.application.inspect({ workId: createdA.workId })).works[0]?.phase, 'delivered')

  // Project B: the failing check produces no accepted candidate; accepting it is refused.
  const createdB = (await product.application.dispatch({ kind: 'create_work', commandId: 'w31-check-b-work',
    conversationId: 'w31-check-b-chat', projectId: records[1]!.id, goal: 'B 项目检查', profileId: 'profile-fixture-fail',
    scope: scopeFor(records[1]!.id), criteria }, actor)) as unknown as { workId: string }
  const failed = await until(async () => (await product.application.inspect({ workId: createdB.workId })).works[0],
    (value) => value !== undefined && !value.actions.available.includes('accept_candidate') &&
      value.actions.currentCandidate !== undefined)
  const status = await until(async () => (await (await app.request(`/v1/works/${createdB.workId}/verification`, { headers })).json()) as Record<string, any>,
    (value) => value.state === 'finished' || value.state === 'blocked' || value.failure !== undefined)
  assert.equal(status.protocol, 'work-verification/1')
  assert.equal(['finished', 'blocked', 'retry_wait'].includes(status.state), true)
  const acceptAttempt = (await product.application.dispatch({ kind: 'accept_candidate', commandId: 'w31-check-b-accept',
    conversationId: 'w31-check-b-chat', candidate: failed!.actions.currentCandidate! }, actor)) as unknown as
    { status: string; error?: { code?: string } }
  assert.equal(acceptAttempt.status, 'rejected')
  assert.equal(acceptAttempt.error?.code, 'verification_failed')
  const retained = (await product.application.inspect({ workId: createdB.workId })).works[0]
  assert.notEqual(retained?.phase, 'delivered')
  const failedFacts = facts(join(stateRoot, 'state.sqlite'), createdB.workId, records[1]!.id)
  assert.equal(failedFacts.completion.acceptances.length, 0)

  // A corrected new Work with the passing profile has its own identity and acceptance.
  const createdB2 = (await product.application.dispatch({ kind: 'create_work', commandId: 'w31-check-b2-work',
    conversationId: 'w31-check-b-chat', projectId: records[1]!.id, goal: 'B 项目检查（修正）', profileId: 'profile-fixture-pass',
    scope: scopeFor(records[1]!.id), criteria }, actor)) as unknown as { workId: string }
  const readyB2 = await until(async () => (await product.application.inspect({ workId: createdB2.workId })).works[0],
    (value) => value !== undefined && value.actions.available.includes('accept_candidate'))
  await product.application.dispatch({ kind: 'accept_candidate', commandId: 'w31-check-b2-accept',
    conversationId: 'w31-check-b-chat', candidate: readyB2!.actions.currentCandidate! }, actor)
  assert.notEqual(createdB2.workId, createdB.workId)
  const passedFacts = facts(join(stateRoot, 'state.sqlite'), createdB2.workId, records[1]!.id)
  assert.equal(passedFacts.completion.acceptances.length, 1)
  const acceptedA = facts(join(stateRoot, 'state.sqlite'), createdA.workId, records[0]!.id)
  assert.equal(acceptedA.completion.acceptances.length, 1)
  assert.equal((await product.application.inspect({ workId: createdB.workId })).works[0]?.phase !== 'delivered', true)
})
