/** Wave-20 A5: real Work/Q&A/native_applied plus SDK/context through explicit personal readonly CLI. */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '@personal-agent/storage'
import { key } from '../../orchestrator-core/src/core/ids.ts'
import { WorkflowSnapshots } from '../src/index.ts'
import { localCredentials } from '../../../apps/coordinator/http/local-state.ts'
import { createControlledProduct, createProductRuntime, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
// @ts-expect-error main-owned plain-JS fixture without declarations
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
// @ts-expect-error main-owned plain-JS fixture without declarations
import { availablePort, waitUntil } from '../../../tests/integration/fixtures/personal-startup.mjs'

const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'project-scratch', conversationId = 'wave20-personal-conversation'
const repoRoot = join(import.meta.dirname, '../../..')
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] }
const fixtureScope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'wave20-output', kind: 'machine' as const, required: true as const, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'wave20-human', kind: 'human' as const, required: true, description: 'Review output' },
]
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 20000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) {
    latest = await read(); if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`timed out: ${JSON.stringify(latest ?? null)}`)
}

test('explicit personal readonly startup reads real Work/Q&A and SDK data without execution', { timeout: 40000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'wave20-personal-')), source = join(root, 'source'), restored = join(root, 'restored'), project = join(root, 'project')
  mkdirSync(source, { mode: 0o700 }); mkdirSync(restored, { mode: 0o700 }); mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, 'index.mjs'), 'export const ok = true\n'); writeFileSync(join(project, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'personal fixture'])
  const model = await candidateModel(), store = new ProductStore({ path: join(source, 'state.sqlite') })
  let child: any, runtime: any, businessWorkId = '', businessQuestionId = '', businessAnswerId = ''
  const output = { text: '' }
  const stop = async () => { if (!child || child.exitCode !== null || child.signalCode !== null) return
    const done = once(child, 'exit'), timer = setTimeout(() => child.kill('SIGKILL'), 6000)
    child.kill('SIGTERM'); try { await done } finally { clearTimeout(timer) } }
  t.after(async () => { await stop(); await runtime?.close(); store.close(); await model.close(); rmSync(root, { recursive: true, force: true }) })
  const controlled = createControlledProduct({ store, principal, projects: [{ id: projectId, scope: fixtureScope }], actionSecret: Buffer.alloc(32, 94), stateRoot: source, scratchProject: project })
  try {
    controlled.start(); let seq = 0
    const command = (value: any) => controlled.application.dispatch({ commandId: `wave20-business-${++seq}`, conversationId, ...value }, actor)
    const created = await command({ kind: 'create_work', projectId, goal: 'Wave-20 personal business', profileId: 'profile-fixture-question', scope: fixtureScope, criteria })
    assert.equal(created.status, 'recorded'); businessWorkId = created.workId!
    const view = await until(async () => controlled.application.inspect({}), value => value.questions.length === 1)
    businessQuestionId = view.questions[0]!.id
    const answer = await command({ kind: 'answer_question', questionId: businessQuestionId, expectedVersion: view.questions[0]!.version,
      answer: { kind: 'choices', optionIds: ['allow'] } })
    assert.equal(answer.status, 'recorded')
    await until(async () => controlled.application.questions.currentDeliveries(businessQuestionId), value => value[0]?.status === 'native_applied')
    businessAnswerId = (store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(businessQuestionId) as { answer_id: string }).answer_id
  } finally { await controlled.close() }
  runtime = createProductRuntime({ store, stateRoot: source, scratchProject: project, principal, projects: [{ id: projectId, scope: fixtureScope }],
    actionSecret: Buffer.alloc(32, 95), assistantProvider: model.provider })
  runtime.start()
  await runtime.application.dispatch({ kind: 'chat', commandId: 'wave20-chat', projectId, conversationId, text: '整理历史决定。' }, actor)
  await until(async () => store.product.messages.page(conversationId).messages.filter(value => value.role === 'assistant').length === 1, value => value)
  const messageId = store.product.messages.page(conversationId).messages.find(value => value.role === 'assistant')!.sourceRefs[0]!
  const context = await runtime.operations.assistantContextPrepare({ commandId: 'wave20-context', text: '按原约束再核对。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } } }, actor)
  await runtime.operations.assistantContextSend({ commandId: context.commandId, token: context.token }, actor)
  await until(async () => store.product.messages.page(conversationId).messages.filter(value => value.role === 'assistant').length === 2, value => value)
  const contextMessageId = key('message', 'wave20-context')
  await runtime.close(); runtime = undefined
  store.queue.enqueue('application.execute', 'held-personal', '{}', 1, 0, new Date().toISOString())
  const snapshot = await new WorkflowSnapshots(store).create({ destination: join(root, 'snapshot') })
  assert.equal(snapshot.status, 'ok', snapshot.message)
  copyFileSync(join(snapshot.destination, 'product.sqlite'), join(restored, 'state.sqlite'))
  cpSync(join(snapshot.destination, 'artifacts'), join(restored, 'artifacts'), { recursive: true })
  writeFileSync(join(restored, 'restore-report.json'), JSON.stringify({ protocol: 'personal-restore/1', targetPath: restored,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const credential = localCredentials(restored), file = join(root, 'review.json')
  execFileSync(process.execPath, [join(repoRoot, 'tools/dev/review-restored.mjs'), '--state', restored, '--project', projectId, '--allow-path', 'src/', '--output', file], { cwd: repoRoot, stdio: 'pipe' })
  const port = await availablePort(), api = `http://127.0.0.1:${port}`, headers = { authorization: `Bearer ${credential('api.key')}` }
  child = spawn(process.execPath, [join(repoRoot, 'apps/coordinator/product/demo.ts'), '--state', restored, '--port', String(port), '--discussion-only', '--assistant',
    '--review-restored-scope', file], { cwd: repoRoot, env: { ...process.env, PA_MODEL_CONFIG: model.file }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (bytes: Buffer) => { output.text += bytes.toString() }); child.stderr.on('data', (bytes: Buffer) => { output.text += bytes.toString() })
  await waitUntil(async () => { if (child.exitCode !== null || child.signalCode !== null) throw new Error(output.text.slice(-2000));
    try { return (await fetch(`${api}/v1/health`)).ok } catch { return false } })
  const requestsBefore = model.requests.length
  const candidateResponse = await fetch(`${api}/v1/messages/${messageId}/candidates`, { headers })
  assert.equal(candidateResponse.status, 200, await candidateResponse.clone().text())
  assert.equal((await fetch(`${api}/v1/context/history?projectId=${projectId}`, { headers })).status, 200)
  const work = await fetch(`${api}/v1/snapshot?workId=${businessWorkId}`, { headers })
  assert.equal(work.status, 200, await work.clone().text())
  const deliveries = await fetch(`${api}/v1/questions/${businessQuestionId}/deliveries`, { headers })
  assert.equal(deliveries.status, 200, await deliveries.clone().text())
  assert.equal((await deliveries.json())[0].status, 'native_applied')
  const refusal = await fetch(`${api}/v1/commands`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'answer_question', questionId: businessQuestionId, expectedVersion: 1, answer: { kind: 'free_text', text: 'x' } }) })
  assert.equal(refusal.status, 422)
  assert.equal(model.requests.length, requestsBefore)
  await stop()

  // A4: a genuinely signed narrower scope is accepted as a startup selection; reads stay read-only,
  // while the original wider context binding reports scope_changed rather than being forged.
  const narrowFile = join(root, 'narrow-review.json')
  execFileSync(process.execPath, [join(repoRoot, 'tools/dev/review-restored.mjs'), '--state', restored, '--project', projectId,
    '--allow-path', 'src/narrow/', '--exclude-path', 'src/private/', '--output', narrowFile], { cwd: repoRoot, stdio: 'pipe' })
  const narrowPort = await availablePort(), narrowApi = `http://127.0.0.1:${narrowPort}`
  child = spawn(process.execPath, [join(repoRoot, 'apps/coordinator/product/demo.ts'), '--state', restored, '--port', String(narrowPort),
    '--discussion-only', '--assistant', '--review-restored-scope', narrowFile], { cwd: repoRoot,
    env: { ...process.env, PA_MODEL_CONFIG: model.file }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (bytes: Buffer) => { output.text += bytes.toString() }); child.stderr.on('data', (bytes: Buffer) => { output.text += bytes.toString() })
  await waitUntil(async () => { if (child.exitCode !== null || child.signalCode !== null) throw new Error(output.text.slice(-2000));
    try { return (await fetch(`${narrowApi}/v1/health`)).ok } catch { return false } })
  assert.equal((await fetch(`${narrowApi}/v1/context/history?projectId=${projectId}`, { headers })).status, 200)
  const narrowSources = await fetch(`${narrowApi}/v1/messages/${contextMessageId}/context/sources`, { headers })
  assert.equal(narrowSources.status, 200, await narrowSources.clone().text())
  const narrowView = await narrowSources.json()
  assert.equal(narrowView.state, 'scope_changed'); assert.deepEqual(narrowView.sources, [])
  const narrowRefusal = await fetch(`${narrowApi}/v1/commands`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'answer_question', questionId: businessQuestionId, expectedVersion: 1, answer: { kind: 'free_text', text: 'x' } }) })
  assert.equal(narrowRefusal.status, 422)
  assert.equal(model.requests.length, requestsBefore)
  await stop()
  const check = new ProductStore({ path: join(restored, 'state.sqlite') })
  try {
    assert.equal(check.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).filter(row => row.key === 'held-personal').length, 1)
    assert.equal(check.answers.deliveries(businessAnswerId)[0]?.status, 'native_applied')
    assert.equal(check.product.works.get(businessWorkId)?.title, 'Wave-20 personal business')
  } finally { check.close() }
})
