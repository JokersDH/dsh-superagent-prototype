import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { WorkflowSnapshots } from '../../packages/workflows/dist/index.js'
import { localCredentials } from '../../apps/coordinator/http/local-state.ts'
import { loadRestoredReview, prepareRestoredReview, restoredReviewIdentity } from '../../apps/coordinator/product/restored-review.ts'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { candidateModel } from './fixtures/assistant-candidate-model.mjs'
import { availablePort, waitUntil } from './fixtures/personal-startup.mjs'

const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }, actor = { ...principal, source: 'local_cli' }
const projectId = 'historical-payment-project', scope = { projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] }
test('review health identity is bounded and only accepted for a restored personal process', async () => {
  const base = { application: {}, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64), mode: 'personal', allowedOrigins: [] }
  assert.throws(() => createLocalHttpApp({ ...base, restoredReviewDigest: 'a'.repeat(64) }), /restored personal/)
  assert.throws(() => createLocalHttpApp({ ...base, mode: 'fixture', startupMode: 'recovery_readonly', restoredReviewDigest: 'a'.repeat(64) }), /restored personal/)
  assert.throws(() => createLocalHttpApp({ ...base, startupMode: 'recovery_readonly', restoredReviewDigest: 'private-path-or-payload' }))
  const app = createLocalHttpApp({ ...base, startupMode: 'recovery_readonly', restoredReviewDigest: 'a'.repeat(64) })
  assert.deepEqual(await (await app.request('http://127.0.0.1/v1/health')).json(), { status: 'ok', mode: 'personal',
    startupMode: 'recovery_readonly', restoredReviewDigest: 'a'.repeat(64) })
})
function simple(t) {
  const root = mkdtempSync('/tmp/pa-restored-review-'), state = join(root, 'state')
  mkdirSync(state, { mode: 0o700 })
  const store = new ProductStore({ path: join(state, 'state.sqlite') }), secret = Buffer.alloc(32, 91), file = join(root, 'review.json')
  store.product.messages.append({ id: 'historical-source', projectId, conversationId: 'historical-conversation', role: 'user',
    provenance: 'trusted_user', text: '保留原错误码', sourceRefs: [], createdAt: '2026-11-13T00:00:00.000Z' })
  const marker = join(state, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'personal-restore/1', targetPath: state,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const now = '2026-11-13T00:00:00.000Z'
  const selection = [{ projectId, allowedPaths: ['src/'], excludedPaths: ['.git'] }]
  const consent = prepareRestoredReview(store, state, principal, selection, secret, now)
  writeFileSync(file, JSON.stringify(consent), { mode: 0o600 })
  t.after(() => { store.close(); rmSync(root, { recursive: true, force: true }) })
  return { root, state, store, secret, file, marker, now, consent, selection }
}
test('explicit startup selection binds current source, local principal and exact read-only paths without DB changes', t => {
  const h = simple(t), source = h.store.workflows.recoverySource.inspect().sourceFingerprint, cursor = h.store.events.cursor()
  const projects = loadRestoredReview(h.file, h.store, h.state, principal, h.secret, h.now)
  assert.deepEqual(projects, [{ id: projectId, displayName: projectId, scope, discussionOnly: true }])
  assert.equal(h.consent.payload.access, 'historical_data_read_only'); assert.equal(h.consent.payload.startupAvailable, false)
  assert.equal(h.store.events.cursor(), cursor); assert.equal(h.store.workflows.recoverySource.inspect().sourceFingerprint, source)
})
for (const [name, mutate] of [
  ['source changes', h => h.store.queue.enqueue('application.execute', 'changed', '{}', 1, 0, h.now)],
  ['marker changes', h => writeFileSync(h.marker, 'changed restore marker')],
  ['signature changes', h => { h.consent.signature = '0'.repeat(64); writeFileSync(h.file, JSON.stringify(h.consent)) }],
  ['requested scope changes', h => { h.consent.payload.projects[0].allowedPaths = ['.']; writeFileSync(h.file, JSON.stringify(h.consent)) }],
  ['unsafe file permissions', h => chmodSync(h.file, 0o644)],
  ['symlink input', h => { const link = join(h.root, 'link.json'); symlinkSync(h.file, link); h.file = link }],
  ['FIFO input', h => { const fifo = join(h.root, 'input.fifo'); execFileSync('mkfifo', [fifo]); h.file = fifo }],
]) test(`startup refuses ${name}`, t => {
  const h = simple(t); mutate(h)
  assert.throws(() => loadRestoredReview(h.file, h.store, h.state, principal, h.secret, h.now), error => error.error?.code === 'forbidden')
})
test('expired, foreign principal, root and current local key cannot replay startup consent', t => {
  const h = simple(t)
  for (const [state, owner, key, now] of [
    [h.state, principal, h.secret, '2026-11-13T00:06:00.000Z'],
    [h.state, { ...principal, userId: 'foreign' }, h.secret, h.now],
    [h.root, principal, h.secret, h.now],
    [h.state, principal, Buffer.alloc(32, 92), h.now],
  ]) assert.throws(() => loadRestoredReview(h.file, h.store, state, owner, key, now), error => error.error?.code === 'forbidden')
})
test('unknown projects, unsafe paths and execution claims cannot enter an explicit review selection', t => {
  const h = simple(t)
  for (const selection of [
    [{ ...h.selection[0], projectId: 'unknown-project' }],
    [{ ...h.selection[0], allowedPaths: ['../outside'] }],
    [{ ...h.selection[0], externalActions: ['deploy'] }],
    [{ ...h.selection[0], executable: true }],
  ]) assert.throws(() => prepareRestoredReview(h.store, h.state, principal, selection, h.secret, h.now))
})
test('actual personal startup reviews only explicitly rebound historical data; queues/model/native remain disabled', { timeout: 30000 }, async t => {
  const root = mkdtempSync('/tmp/pa-personal-review-flow-'), source = join(root, 'source'), restored = join(root, 'restored'), scratch = join(root, 'project')
  mkdirSync(source, { mode: 0o700 }); mkdirSync(restored, { mode: 0o700 }); mkdirSync(scratch)
  const model = await candidateModel(), original = new ProductStore({ path: join(source, 'state.sqlite') })
  let runtime, child
  let output = ''
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const done = once(child, 'exit'), timer = setTimeout(() => child.kill('SIGKILL'), 6000)
    child.kill('SIGTERM'); try { await done } finally { clearTimeout(timer) }
  }
  t.after(async () => { await stop(); await runtime?.close(); original.close(); await model.close(); rmSync(root, { recursive: true, force: true }) })
  runtime = createProductRuntime({ store: original, stateRoot: source, scratchProject: scratch, principal,
    projects: [{ id: projectId, scope }], executionUnavailable: 'operator_disabled', assistantProvider: model.provider, actionSecret: Buffer.alloc(32, 93) })
  runtime.start()
  const commandId = 'historical-chat', conversationId = 'historical-conversation'
  await runtime.application.dispatch({ kind: 'chat', commandId, projectId, conversationId, text: '把保留错误码整理成决定建议。' }, actor)
  const message = await waitUntil(() => original.product.messages.page(conversationId, { limit: 100 }).messages.find(value => value.role === 'assistant'))
  const sourceMessageId = message.sourceRefs[0]
  const preparedContext = await runtime.operations.assistantContextPrepare({ commandId: 'historical-context-chat', text: '按原错误码约束再核对一次。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } } }, actor)
  await runtime.operations.assistantContextSend({ commandId: preparedContext.commandId, token: preparedContext.token }, actor)
  await waitUntil(() => original.product.messages.page(conversationId, { limit: 100 }).messages.filter(value => value.role === 'assistant').length === 2)
  await runtime.close(); runtime = undefined
  original.queue.enqueue('application.execute', 'held-historical', '{}', 1, 0, new Date().toISOString())
  const snapshot = await new WorkflowSnapshots(original).create({ destination: join(root, 'snapshot') })
  assert.equal(snapshot.status, 'ok'); copyFileSync(join(snapshot.destination, 'product.sqlite'), join(restored, 'state.sqlite'))
  cpSync(join(snapshot.destination, 'artifacts'), join(restored, 'artifacts'), { recursive: true })
  writeFileSync(join(restored, 'restore-report.json'), JSON.stringify({ protocol: 'personal-restore/1', targetPath: restored,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const credential = localCredentials(restored), port = await availablePort(), consolePort = await availablePort(), api = `http://127.0.0.1:${port}`
  const headers = { authorization: `Bearer ${credential('api.key')}` }
  const start = async (file, standard = false) => {
    const args = standard ? ['tools/dev/start.mjs', '--state', restored, '--port', String(consolePort), '--api-port', String(port), '--discussion-only']
      : ['apps/coordinator/product/demo.ts', '--state', restored, '--port', String(port), '--discussion-only', '--assistant']
    child = spawn(process.execPath, [...args, ...(file ? ['--review-restored-scope', file] : [])],
      { cwd: resolve('.'), env: { ...process.env, PA_MODEL_CONFIG: model.file }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', bytes => { output += bytes }); child.stderr.on('data', bytes => { output += bytes })
    await waitUntil(async () => {
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(output.slice(-2000))
      try { return (await fetch(`${api}/v1/health`)).ok && (!standard || existsSync(join(restored, 'workbench.json'))) } catch { return false }
    })
  }
  await start()
  assert.equal((await fetch(`${api}/v1/messages/${sourceMessageId}/candidates`, { headers })).status, 403)
  await stop()
  const file = join(root, 'explicit-startup-review.json')
  const prepared = JSON.parse(execFileSync(process.execPath, ['tools/dev/review-restored.mjs', '--state', restored, '--project', projectId,
    '--allow-path', 'src/', '--output', file], { encoding: 'utf8' }))
  assert.equal(prepared.startupAvailable, false); assert.equal(existsSync(file), true)
  assert.throws(() => execFileSync(process.execPath, ['tools/dev/review-restored.mjs', '--state', restored, '--project', projectId,
    '--allow-path', 'src/', '--output', file], { stdio: 'pipe' }))
  const differentFile = join(root, 'different-selection.json')
  execFileSync(process.execPath, ['tools/dev/review-restored.mjs', '--state', restored, '--project', projectId,
    '--allow-path', 'src/narrow/', '--output', differentFile], { stdio: 'pipe' })
  await start(file, true)
  const health = await (await fetch(`${api}/v1/health`)).json()
  assert.equal(health.mode, 'personal'); assert.equal(health.startupMode, 'recovery_readonly')
  assert.equal(health.restoredReviewDigest, restoredReviewIdentity(file))
  const record = JSON.parse(readFileSync(join(restored, 'workbench.json'), 'utf8'))
  assert.equal(record.restoredReviewDigest, health.restoredReviewDigest)
  const reuseArgs = ['tools/dev/start.mjs', '--state', restored, '--discussion-only']
  const reused = execFileSync(process.execPath, [...reuseArgs, '--review-restored-scope', file], { encoding: 'utf8', timeout: 10000 })
  assert.match(reused, new RegExp(`127\\.0\\.0\\.1:${consolePort}`))
  for (const extra of [[], ['--review-restored-scope', differentFile], ['--restart', '--review-restored-scope', file]])
    assert.throws(() => execFileSync(process.execPath, [...reuseArgs, ...extra], { stdio: 'pipe', timeout: 10000 }), error => error.status === 1)
  for (const extra of [['--port', String(await availablePort())], ['--require-login']])
    assert.throws(() => execFileSync(process.execPath, [...reuseArgs, '--review-restored-scope', differentFile, ...extra], { stdio: 'pipe', timeout: 10000 }),
      error => error.status === 1 && String(error.stderr).includes('只读恢复选择与本次请求不同') && !String(error.stdout).includes('Scope:'))
  assert.equal(JSON.parse(readFileSync(join(restored, 'workbench.json'), 'utf8')).pid, record.pid)
  assert.equal(child.exitCode, null)
  const config = await (await fetch(`${api}/v1/configuration`, { headers })).json(), selected = config.projects.find(value => value.id === projectId)
  assert.ok(selected); assert.equal(selected.dispatchAllowed, false); assert.deepEqual(selected.profileIds, []); assert.deepEqual(selected.scope, scope)
  const response = await fetch(`${api}/v1/messages/${sourceMessageId}/candidates`, { headers }), candidates = await response.json()
  assert.equal(response.status, 200, JSON.stringify(candidates)); assert.equal(candidates.candidates.length, 1)
  assert.equal(candidates.executable, false); assert.equal(candidates.authorization, 'none')
  const snapshotResponse = await fetch(`${api}/v1/snapshot?conversationId=${conversationId}`, { headers })
  assert.equal(snapshotResponse.status, 200)
  const historyResponse = await fetch(`${api}/v1/context/history?projectId=${projectId}`, { headers }), history = await historyResponse.json()
  assert.equal(historyResponse.status, 200, JSON.stringify(history)); assert.equal(history.entries.length, 1)
  const sourcesResponse = await fetch(`${api}/v1/messages/${history.entries[0].messageId}/context/sources`, { headers })
  assert.equal(sourcesResponse.status, 200, await sourcesResponse.clone().text())
  const sources = await sourcesResponse.json()
  assert.equal(sources.state, 'verified'); assert.ok(sources.sources.some(value => JSON.stringify(value).includes('保留')))
  const refusal = await fetch(`${api}/v1/assistant/candidates/prepare`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ messageId: sourceMessageId, index: 0, payloadDigest: candidates.candidates[0].payloadDigest }) })
  assert.equal(refusal.status, 422)
  assert.equal(model.requests.length, 2)
  await stop()
  const check = new ProductStore({ path: join(restored, 'state.sqlite') })
  try { assert.equal(check.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length, 1); assert.equal(check.product.works.listByProject(projectId).length, 0) }
  finally { check.close() }
})
