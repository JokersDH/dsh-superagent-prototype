import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { once } from 'node:events'
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { ProductStore, canonicalDigest } from '@personal-agent/storage'
import { WorkflowSnapshots } from '@personal-agent/workflows'
import { key } from '@personal-agent/orchestrator-core'
import { explainRestoredReviewScope } from '@personal-agent/context'
import { localCredentials } from '../../../apps/coordinator/http/local-state.ts'
import { loadRestoredReview, prepareRestoredReview, restoredReviewIdentity } from '../../../apps/coordinator/product/restored-review.ts'
import { createControlledProduct, createProductRuntime, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../apps/coordinator/http/app.ts'
import type { Scope } from '@personal-agent/contracts'

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))
const reviewTool = join(repoRoot, 'tools/dev/review-restored.mjs')
const demoEntry = join(repoRoot, 'apps/coordinator/product/demo.ts')
const startTool = join(repoRoot, 'tools/dev/start.mjs')
const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'dual-format-project'
const conversationId = 'dual-format-conversation'
const runtimeScope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const reviewScope = { projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] }
const criteria = [
  { id: 'criterion-output', kind: 'machine' as const, required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
]

async function loadModel() {
  // @ts-expect-error - main-owned fixture has no type declarations.
  const module = (await import('../../../tests/integration/fixtures/assistant-candidate-model.mjs')) as unknown as {
    candidateModel(options?: { reply?: (context: Record<string, unknown>) => unknown }): Promise<{
      root: string; file: string; requests: unknown[]; provider: unknown; close(): Promise<void>
    }>
  }
  return module.candidateModel
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((done) => server.close(() => done()))
  return port
}

async function until<T>(read: () => Promise<T> | T, predicate: (value: T) => boolean, timeout = 60000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T
  for (;;) {
    latest = await read()
    if (predicate(latest)) return latest
    if (Date.now() > deadline) throw new Error(`Wave21 condition timed out: ${JSON.stringify(latest)}`)
    await new Promise((done) => setTimeout(done, 50))
  }
}

const forbidden = (error: unknown) => (error as { error?: { code?: string } }).error?.code === 'forbidden'

const signConsent = (payload: unknown, secret: Uint8Array) =>
  createHmac('sha256', secret).update(`restored-personal-review/1:${canonicalDigest(JSON.parse(JSON.stringify(payload)))}`).digest('hex')

function seedDrift(root: string, project: string, suffix: string, seed: number) {
  const state = join(root, 'state')
  mkdirSync(state, { recursive: true, mode: 0o700 })
  const store = new ProductStore({ path: join(state, 'state.sqlite') })
  store.product.messages.append({
    id: `drift-${suffix}`, projectId: project, conversationId: `drift-conversation-${suffix}`, role: 'user',
    provenance: 'trusted_user', text: '保留原错误码', sourceRefs: [], createdAt: '2026-11-13T00:00:00.000Z',
  })
  const marker = join(state, 'restore-report.json')
  writeFileSync(marker, JSON.stringify({ protocol: 'personal-restore/1', targetPath: state,
    database: { integrity: 'ok', foreignKeyViolations: 0, productSchema: 18 }, evidence: { status: 'verified' } }), { mode: 0o600 })
  const secret = Buffer.alloc(32, seed), now = new Date().toISOString()
  const consent = prepareRestoredReview(store, state, principal, [{ projectId: project, allowedPaths: ['src/'], excludedPaths: ['.git'] }], secret, now)
  const valid = join(root, 'valid.json')
  writeFileSync(valid, JSON.stringify(consent), { mode: 0o600 })
  return { root, state, store, marker, secret, now, consent, valid }
}

function writePackage(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value), { mode: 0o600 })
  return path
}

test('v1 and v2 snapshots both reach actual personal review, with a legal narrow scope and explicit refusal causes', { timeout: 300000 }, async (t) => {
  const model = await loadModel().then((factory) => factory())
  const root = mkdtempSync(join(tmpdir(), 'pa-wave21-dual-'))
  const source = join(root, 'source')
  const restoredV1 = join(root, 'restored-v1')
  const restoredV2 = join(root, 'restored-v2')
  const scratch = join(root, 'project')
  mkdirSync(source, { mode: 0o700 })
  mkdirSync(restoredV1, { mode: 0o700 })
  mkdirSync(restoredV2, { mode: 0o700 })
  mkdirSync(join(scratch, 'src'), { recursive: true })
  mkdirSync(join(source, 'receipts'), { recursive: true })
  writeFileSync(join(scratch, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: scratch, stdio: 'pipe' })
  git(['init', '-q'])
  git(['add', 'src/.gitkeep'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Wave21 fixture'])

  const original = new ProductStore({ path: join(source, 'state.sqlite'), artifactsRoot: source })
  const controlled = createControlledProduct({
    store: original, principal, projects: [{ id: projectId, scope: runtimeScope }], actionSecret: Buffer.alloc(32, 111),
    stateRoot: source, scratchProject: scratch, assistantProvider: model.provider as never,
  })
  controlled.start()
  const cleanups: (() => void | Promise<void>)[] = []
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) await cleanup()
    rmSync(root, { recursive: true, force: true })
  })

  // Real Work/Ticket/Broker Q&A/native_applied through the controlled product.
  const created = await controlled.application.dispatch({
    commandId: 'dual-work', conversationId, kind: 'create_work', projectId,
    goal: 'Produce the controlled scratch artifact', profileId: 'profile-fixture-question', scope: runtimeScope,
    criteria: [...criteria, { id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' }],
  } as never, actor)
  const workId = (created as { workId: string }).workId
  const question = (await until(() => controlled.application.inspect({ workId }), (value) => value.questions.length >= 1)).questions[0]!
  await controlled.application.dispatch({
    commandId: 'dual-answer', conversationId, kind: 'answer_question',
    questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: ['allow'] },
  } as never, actor)
  const ready = await until(
    async () => (await controlled.application.inspect({ workId })).works[0],
    (value) => value !== undefined && value.actions.available.includes('accept_candidate'),
  )
  assert.equal(controlled.application.questions.currentDeliveries(question.id)[0]?.status, 'native_applied')
  await controlled.application.dispatch({ commandId: 'dual-accept', conversationId, kind: 'accept_candidate', candidate: ready!.actions.currentCandidate } as never, actor)
  const display = original.product.messages.page(conversationId).messages.find((message) => message.provenance === 'question_answer_display')
  assert.ok(display)
  await controlled.close()

  // Real SDK candidate, confirmed proposal receipt and frozen selected-context binding.
  const viewer = createProductRuntime({
    store: original, principal, projects: [{ id: projectId, scope: reviewScope }], actionSecret: Buffer.alloc(32, 111),
    stateRoot: source, scratchProject: scratch, assistantProvider: model.provider as never, executionUnavailable: 'operator_disabled',
  })
  viewer.start()
  await viewer.application.dispatch({ commandId: 'dual-chat', conversationId, kind: 'chat', projectId, text: '把保留错误码整理成决定建议。' }, actor)
  await viewer.execution.effects.idle('application.assistant.reply')
  const sourceMessageId = key('message', 'dual-chat')
  const preparedContext = await viewer.operations.assistantContextPrepare({
    commandId: 'dual-context', text: '按原错误码约束再核对一次。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } },
  }, actor)
  await viewer.operations.assistantContextSend({ commandId: preparedContext.commandId, token: preparedContext.token }, actor)
  await viewer.execution.effects.idle('application.assistant.reply')
  const contextMessageId = key('message', 'dual-context')
  const sourceApp = createLocalHttpApp({
    application: viewer.application, principal, apiToken: 'e'.repeat(64), bootstrapToken: 'f'.repeat(64),
    allowedOrigins: ['http://127.0.0.1:5173'], mode: 'fixture', read: viewer.read, operations: viewer.operations,
  })
  const sourceHeaders = { authorization: `Bearer ${'e'.repeat(64)}`, 'content-type': 'application/json' }
  const reviewed = await (await sourceApp.request(`/v1/messages/${encodeURIComponent(sourceMessageId)}/candidates`, { headers: sourceHeaders })).json()
  const reviewedCandidate = (reviewed.candidates as { index: number; payloadDigest: string }[])[0]!
  const preview = await (await sourceApp.request('/v1/assistant/candidates/prepare', {
    method: 'POST', headers: sourceHeaders, body: JSON.stringify({ messageId: sourceMessageId, index: reviewedCandidate.index, payloadDigest: reviewedCandidate.payloadDigest }),
  })).json()
  const confirmed = await (await sourceApp.request('/v1/proposals/commands', {
    method: 'POST', headers: sourceHeaders,
    body: JSON.stringify({ kind: 'confirm_proposal', commandId: 'dual-confirm', projectId, conversationId, token: (preview as { token: string }).token }),
  })).json()
  assert.equal(confirmed.status, 'recorded')
  const frozen = await (await sourceApp.request(`/v1/messages/${encodeURIComponent(contextMessageId)}/context`, { headers: sourceHeaders })).json()
  const frozenDigest = frozen.bundleDigest as string
  const bindingScope = frozen.scope as Scope
  const frozenSourceIds = (frozen.sources as { sourceId: string }[]).map((entry) => entry.sourceId)
  assert.deepEqual(bindingScope, reviewScope)
  assert.ok(frozenSourceIds.length > 0)
  const modelCalls = model.requests.length
  assert.equal(modelCalls, 2)
  await viewer.close()
  cleanups.push(() => model.close())
  cleanups.push(() => original.close())

  // One real store, default v1 and explicit v2 snapshots, each verified with its own family set.
  original.queue.enqueue('application.execute', 'held-dual', '{}', 1, 0, new Date().toISOString())
  const snapshots = new WorkflowSnapshots(original)
  const v1 = await snapshots.create({ destination: join(root, 'snapshot-v1') })
  const v2 = await snapshots.create({ destination: join(root, 'snapshot-v2'), formatVersion: 2 })
  assert.equal(v1.status, 'ok')
  assert.equal(v1.manifest.protocol, 'workflow-snapshot/1')
  assert.equal(v1.manifest.evidence.protocol, 'workflow-evidence/1')
  assert.equal(snapshots.verify(v1.destination).status, 'ok')
  assert.equal(v2.status, 'ok')
  assert.equal(v2.manifest.protocol, 'workflow-snapshot/2')
  assert.equal(v2.manifest.evidence.protocol, 'workflow-evidence/2')
  assert.equal((v2.manifest.evidence as { familySetVersion?: number }).familySetVersion, 2)
  assert.equal(snapshots.verify(v2.destination).status, 'ok')
  assert.notEqual((v1.manifest.evidence as { familySetVersion?: number }).familySetVersion, 2)

  const restore = (snapshot: { destination: string; manifest: { database: { integrity: string; foreignKeyViolations: number; productSchema: number } } }, target: string) => {
    copyFileSync(join(snapshot.destination, 'product.sqlite'), join(target, 'state.sqlite'))
    cpSync(join(snapshot.destination, 'artifacts'), join(target, 'artifacts'), { recursive: true })
    writeFileSync(join(target, 'restore-report.json'), JSON.stringify({ protocol: 'personal-restore/1', targetPath: target,
      database: { ...snapshot.manifest.database }, evidence: { status: 'verified' } }), { mode: 0o600 })
  }
  restore(v1, restoredV1)
  restore(v2, restoredV2)

  const credential1 = localCredentials(restoredV1)
  const credential2 = localCredentials(restoredV2)
  const apiKey1 = credential1('api.key'), apiKey2 = credential2('api.key')
  const headers1 = { authorization: `Bearer ${apiKey1}`, 'content-type': 'application/json' }
  const headers2 = { authorization: `Bearer ${apiKey2}`, 'content-type': 'application/json' }
  const review = (state: string, project: string, output: string, allowed: string[], excluded: string[] = []) => {
    execFileSync(process.execPath, [reviewTool, '--state', state, '--project', project,
      ...allowed.flatMap((path) => ['--allow-path', path]), ...excluded.flatMap((path) => ['--exclude-path', path]), '--output', output], { encoding: 'utf8' })
    return output
  }
  const wide1 = review(restoredV1, projectId, join(root, 'wide-v1.json'), ['src/'])
  const narrow1 = review(restoredV1, projectId, join(root, 'narrow-v1.json'), ['src/narrow/'])

  // v1 through the standard pnpm start entry: identity digest, same-file reuse and refused differences.
  const apiPort = await availablePort(), consolePort = await availablePort()
  const api = `http://127.0.0.1:${apiPort}`
  let child: ReturnType<typeof spawn> | undefined
  let output = ''
  const stop = async () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const done = once(child, 'exit')
    const timer = setTimeout(() => child!.kill('SIGKILL'), 10000)
    child.kill('SIGTERM')
    try { await done } finally { clearTimeout(timer) }
    child = undefined
  }
  cleanups.push(stop)
  const spawnEntry = async (entry: string, args: string[], ready: string) => {
    output = ''
    child = spawn(process.execPath, [entry, ...args], {
      cwd: repoRoot, env: { ...process.env, PA_MODEL_CONFIG: model.file }, stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout!.on('data', (bytes) => { output += bytes })
    child.stderr!.on('data', (bytes) => { output += bytes })
    await until(async () => {
      if (child!.exitCode !== null || child!.signalCode !== null) throw new Error(output.slice(-4000))
      try { return (await fetch(`${ready}/v1/health`)).ok } catch { return false }
    }, (healthy) => healthy)
  }
  const standardArgs = ['--state', restoredV1, '--port', String(consolePort), '--api-port', String(apiPort), '--discussion-only', '--review-restored-scope', wide1]
  await spawnEntry(startTool, standardArgs, api)
  await until(() => existsSync(join(restoredV1, 'workbench.json')), (present) => present, 90000)
  const health1 = await (await fetch(`${api}/v1/health`)).json()
  assert.equal(health1.mode, 'personal')
  assert.equal(health1.startupMode, 'recovery_readonly')
  assert.equal(health1.restoredReviewDigest, restoredReviewIdentity(wide1))
  const record = JSON.parse(readFileSync(join(restoredV1, 'workbench.json'), 'utf8'))
  assert.equal(record.restoredReviewDigest, health1.restoredReviewDigest)
  const reused = execFileSync(process.execPath, [startTool, '--state', restoredV1, '--discussion-only', '--review-restored-scope', wide1], { encoding: 'utf8', timeout: 20000 })
  assert.match(reused, new RegExp(`127\\.0\\.0\\.1:${consolePort}`))
  assert.equal(JSON.parse(readFileSync(join(restoredV1, 'workbench.json'), 'utf8')).pid, record.pid)
  for (const extra of [[], ['--review-restored-scope', narrow1], ['--restart', '--review-restored-scope', wide1]])
    assert.throws(() => execFileSync(process.execPath, [startTool, '--state', restoredV1, '--discussion-only', ...extra], { stdio: 'pipe', timeout: 20000 }), (error) => (error as { status?: number }).status === 1)
  for (const extra of [['--port', String(await availablePort())], ['--require-login']])
    assert.throws(() => execFileSync(process.execPath, [startTool, '--state', restoredV1, '--discussion-only', '--review-restored-scope', narrow1, ...extra], { stdio: 'pipe', timeout: 20000 }),
      (error) => (error as { status?: number }).status === 1 && String((error as { stderr?: string }).stderr).includes('只读恢复选择与本次请求不同') && !String((error as { stdout?: string }).stdout).includes('Scope:'))
  assert.equal(JSON.parse(readFileSync(join(restoredV1, 'workbench.json'), 'utf8')).pid, record.pid)
  assert.equal(child!.exitCode, null)

  // The selected v1 project is read-only and carries the original candidate/context identity.
  const config1 = await (await fetch(`${api}/v1/configuration`, { headers: headers1 })).json()
  const selected1 = config1.projects.find((project: { id: string }) => project.id === projectId)
  assert.ok(selected1)
  assert.equal(selected1.dispatchAllowed, false)
  assert.deepEqual(selected1.profileIds, [])
  assert.deepEqual(selected1.scope, reviewScope)
  const candidates1 = await (await fetch(`${api}/v1/messages/${sourceMessageId}/candidates`, { headers: headers1 })).json()
  assert.equal((candidates1.candidates as { payloadDigest: string }[])[0]!.payloadDigest, reviewedCandidate.payloadDigest)
  assert.equal(candidates1.executable, false)
  assert.equal(candidates1.authorization, 'none')
  const history1 = await (await fetch(`${api}/v1/context/history?projectId=${projectId}`, { headers: headers1 })).json()
  assert.equal(history1.entries.length, 1)
  const sources1 = await (await fetch(`${api}/v1/messages/${contextMessageId}/context/sources`, { headers: headers1 })).json()
  assert.equal(sources1.state, 'verified')
  assert.ok((sources1.sources as { content: string }[]).some((source) => source.content.includes('保留')))
  assert.ok(JSON.stringify(sources1).length < 64 * 1024)
  assert.ok(JSON.stringify(candidates1).length < 64 * 1024)
  const audit1 = await (await fetch(`${api}/v1/messages/${contextMessageId}/context`, { headers: headers1 })).json()
  assert.equal(audit1.bundleDigest, frozenDigest)
  const work1 = await (await fetch(`${api}/v1/works/${workId}`, { headers: headers1 })).json()
  assert.equal(work1.phase, 'delivered')
  const deliveries1 = await (await fetch(`${api}/v1/questions/${question.id}/deliveries`, { headers: headers1 })).json()
  assert.equal((deliveries1 as { status: string }[])[0]?.status, 'native_applied')
  for (const [path, body] of [
    ['/v1/assistant/candidates/prepare', { messageId: sourceMessageId, index: reviewedCandidate.index, payloadDigest: reviewedCandidate.payloadDigest }],
    ['/v1/proposals/commands', { kind: 'confirm_proposal', commandId: 'dual-confirm', projectId, conversationId, token: (preview as { token: string }).token }],
    ['/v1/commands', { kind: 'chat', commandId: 'dual-review-chat', projectId, conversationId, text: 'x' }],
    ['/v1/commands', { kind: 'answer_question', commandId: 'dual-review-answer', conversationId, questionId: question.id, expectedVersion: 2, answer: { kind: 'choices', optionIds: ['allow'] } }],
    ['/v1/context/preview', { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 4, maxBytes: 4096, maxTokens: 2048 } }],
    ['/v1/assistant/context/send', { commandId: 'dual-context', token: preparedContext.token }],
  ] as const) {
    const refused = await fetch(`${api}${path}`, { method: 'POST', headers: headers1, body: JSON.stringify(body) })
    assert.equal(refused.status, 422, `${path} ${await refused.clone().text()}`)
  }
  // Source facts stay not_granted and never become a target or private permission.
  const inspection = await (await fetch(`${api}/v1/recovery/inspect`, { headers: headers1 })).json()
  const sourcePrepared = await (await fetch(`${api}/v1/recovery/source/prepare`, { method: 'POST', headers: headers1,
    body: JSON.stringify({ preflight: { expectedFingerprint: inspection.inspectionFingerprint,
      bindings: [{ sourceProjectId: projectId, project: { path: scratch, check: 'node_test' } }] }, targetStateRoot: join(root, 'dual-target') }) })).json() as
    { authorization: string; startupAvailable: boolean; token: string; intent: { activationId: string; target: { stateRoot: string } } }
  assert.equal(sourcePrepared.authorization, 'not_granted')
  assert.equal(sourcePrepared.startupAvailable, false)
  const sourceConfirmed = await (await fetch(`${api}/v1/recovery/source/confirm`, { method: 'POST', headers: headers1, body: JSON.stringify({ token: sourcePrepared.token }) })).json()
  assert.deepEqual(sourceConfirmed, await (await fetch(`${api}/v1/recovery/activations/${sourcePrepared.intent.activationId}`, { headers: headers1 })).json())
  assert.equal(existsSync(sourcePrepared.intent.target.stateRoot), false)
  assert.equal(model.requests.length, modelCalls)
  await stop()

  // A legal but narrower selection explains the withheld frozen sources instead of showing them as sufficient.
  // A startup writes its own audit rows, so every fresh consent is prepared from the current source.
  const narrowFresh = review(restoredV1, projectId, join(root, 'narrow-v1-fresh.json'), ['src/narrow/'])
  await spawnEntry(demoEntry, ['--state', restoredV1, '--port', String(apiPort), '--discussion-only', '--assistant', '--review-restored-scope', narrowFresh], api)
  const narrowConfig = await (await fetch(`${api}/v1/configuration`, { headers: headers1 })).json()
  const narrowScope = narrowConfig.projects.find((project: { id: string }) => project.id === projectId)!.scope as Scope
  assert.deepEqual(narrowScope, { projectId, allowedPaths: ['src/narrow/'], excludedPaths: ['.git'], externalActions: [] })
  const narrowCandidates = await (await fetch(`${api}/v1/messages/${sourceMessageId}/candidates`, { headers: headers1 })).json()
  // The original candidate proposed the wider review scope, so a narrower selection truthfully refuses
  // to present it as readable instead of upgrading its scope.
  assert.deepEqual(narrowCandidates.candidates, [])
  assert.equal((narrowCandidates.rejected as { reason: string }[])[0]?.reason, 'scope_escalation')
  assert.equal(narrowCandidates.executable, false)
  const narrowHistory = await (await fetch(`${api}/v1/context/history?projectId=${projectId}`, { headers: headers1 })).json()
  assert.equal(narrowHistory.entries.length, 1)
  const narrowSources = await (await fetch(`${api}/v1/messages/${contextMessageId}/context/sources`, { headers: headers1 })).json()
  assert.equal(narrowSources.state, 'scope_changed')
  assert.deepEqual(narrowSources.sources, [])
  assert.deepEqual((await (await fetch(`${api}/v1/questions/${question.id}/deliveries`, { headers: headers1 })).json()).map((entry: { status: string }) => entry.status), ['native_applied'])
  const narrowExplanation = explainRestoredReviewScope({ bindingScope, selection: narrowScope, sourcesState: narrowSources.state,
    frozenSourceIds, readableCandidates: (narrowCandidates.candidates as unknown[]).length, readableHistory: narrowHistory.entries.length,
    readableWorks: 1, readableDeliveries: 1 })
  assert.equal(narrowExplanation.state, 'scope_changed')
  assert.equal(narrowExplanation.scopeChanged, true)
  assert.equal(narrowExplanation.partial, true)
  assert.deepEqual(narrowExplanation.reasons, ['selection_narrowed'])
  assert.deepEqual(narrowExplanation.withheldSourceIds, frozenSourceIds)
  assert.equal(narrowExplanation.authorization, 'none')
  for (const [path, body] of [
    ['/v1/assistant/candidates/prepare', { messageId: sourceMessageId, index: reviewedCandidate.index, payloadDigest: reviewedCandidate.payloadDigest }],
    ['/v1/commands', { kind: 'chat', commandId: 'narrow-chat', projectId, conversationId, text: 'x' }],
  ] as const) assert.equal((await fetch(`${api}${path}`, { method: 'POST', headers: headers1, body: JSON.stringify(body) })).status, 422)
  await stop()

  // Adding an exclusion is legal and reported, never treated as a widened grant.
  const exclusionFresh = review(restoredV1, projectId, join(root, 'exclusion-v1-fresh.json'), ['src/'], ['.git', 'src/secret/'])
  await spawnEntry(demoEntry, ['--state', restoredV1, '--port', String(apiPort), '--discussion-only', '--assistant', '--review-restored-scope', exclusionFresh], api)
  const exclusionSources = await (await fetch(`${api}/v1/messages/${contextMessageId}/context/sources`, { headers: headers1 })).json()
  assert.equal(exclusionSources.state, 'scope_changed')
  const exclusionScope = (await (await fetch(`${api}/v1/configuration`, { headers: headers1 })).json()).projects
    .find((project: { id: string }) => project.id === projectId)!.scope as Scope
  const exclusionExplanation = explainRestoredReviewScope({ bindingScope, selection: exclusionScope, sourcesState: exclusionSources.state,
    frozenSourceIds, readableCandidates: 1, readableHistory: 1, readableWorks: 1, readableDeliveries: 1 })
  assert.equal(exclusionExplanation.partial, true)
  assert.deepEqual(exclusionExplanation.reasons, ['exclusion_added'])
  await stop()

  // The explicit v2 snapshot reaches the same actual personal review with its own root and file.
  const wide2 = review(restoredV2, projectId, join(root, 'wide-v2.json'), ['src/'])
  await spawnEntry(demoEntry, ['--state', restoredV2, '--port', String(apiPort), '--discussion-only', '--assistant', '--review-restored-scope', wide2], api)
  const health2 = await (await fetch(`${api}/v1/health`)).json()
  assert.equal(health2.mode, 'personal')
  assert.equal(health2.startupMode, 'recovery_readonly')
  assert.equal(health2.restoredReviewDigest, restoredReviewIdentity(wide2))
  const candidates2 = await (await fetch(`${api}/v1/messages/${sourceMessageId}/candidates`, { headers: headers2 })).json()
  assert.equal((candidates2.candidates as { payloadDigest: string }[])[0]!.payloadDigest, reviewedCandidate.payloadDigest)
  const sources2 = await (await fetch(`${api}/v1/messages/${contextMessageId}/context/sources`, { headers: headers2 })).json()
  assert.equal(sources2.state, 'verified')
  assert.ok((sources2.sources as { content: string }[]).some((source) => source.content.includes('保留')))
  assert.ok(JSON.stringify(sources2).length < 64 * 1024)
  assert.equal((await (await fetch(`${api}/v1/questions/${question.id}/deliveries`, { headers: headers2 })).json())[0].status, 'native_applied')
  assert.equal((await (await fetch(`${api}/v1/works/${workId}`, { headers: headers2 })).json()).phase, 'delivered')
  assert.equal((await fetch(`${api}/v1/assistant/candidates/prepare`, { method: 'POST', headers: headers2,
    body: JSON.stringify({ messageId: sourceMessageId, index: reviewedCandidate.index, payloadDigest: reviewedCandidate.payloadDigest }) })).status, 422)
  assert.equal(model.requests.length, modelCalls)
  await stop()

  const after1 = new ProductStore({ path: join(restoredV1, 'state.sqlite') })
  const after2 = new ProductStore({ path: join(restoredV2, 'state.sqlite') })
  try {
    for (const store of [after1, after2]) {
      assert.equal(store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length, 1)
      assert.equal(store.product.works.listByProject(projectId).length, 1)
    }
  } finally { after1.close(); after2.close() }
})

test('each rejection starts from its own valid signed selection and maps to exactly one changed binding', () => {
  const root = mkdtempSync(join(tmpdir(), 'pa-wave21-drift-'))
  try {
    let seed = 200
    const cases: [string, (entry: ReturnType<typeof seedDrift>, file: string) => { file?: string; now?: string }][] = [
      ['source changes', (entry, file) => {
        entry.store.queue.enqueue('application.execute', `drift-queue-${seed}`, '{}', 1, 0, entry.now)
        return { file }
      }],
      ['marker changes', (entry, file) => {
        writeFileSync(entry.marker, 'changed restore marker')
        return { file }
      }],
      ['signature changes', (entry, file) => ({ file: writePackage(file, { ...entry.consent, signature: '0'.repeat(64) }) })],
      ['state root changes', (entry, file) => {
        const payload = { ...entry.consent.payload, stateRoot: entry.root }
        return { file: writePackage(file, { payload, signature: signConsent(payload, entry.secret) }) }
      }],
      ['machine/host changes', (entry, file) => {
        const payload = { ...entry.consent.payload, machineDigest: '1'.repeat(64) }
        return { file: writePackage(file, { payload, signature: signConsent(payload, entry.secret) }) }
      }],
      ['principal changes', (entry, file) => {
        const payload = { ...entry.consent.payload, principal: { userId: 'foreign', authorityRef: 'foreign' } }
        return { file: writePackage(file, { payload, signature: signConsent(payload, entry.secret) }) }
      }],
      ['requested scope changes without a new signature', (entry, file) => {
        const payload = { ...entry.consent.payload, projects: [{ ...entry.consent.payload.projects[0]!, allowedPaths: ['.'] }] }
        return { file: writePackage(file, { payload, signature: entry.consent.signature }) }
      }],
      ['expires', (entry, file) => ({ file, now: new Date(Date.now() + 10 * 60 * 1000).toISOString() })],
      ['file permissions change', (entry, file) => { chmodSync(file, 0o644); return { file } }],
      ['becomes a symlink', (entry, file) => { const link = `${file}.link`; symlinkSync(file, link); return { file: link } }],
      ['becomes a FIFO', (entry, file) => { const fifo = `${file}.fifo`; execFileSync('mkfifo', [fifo]); return { file: fifo } }],
      ['is missing', (entry, file) => ({ file: `${file}.missing` })],
    ]
    for (const [label, mutate] of cases) {
      seed += 1
      const entry = seedDrift(join(root, `case-${seed}`), projectId, String(seed), seed)
      const file = join(entry.root, 'case.json')
      writePackage(file, entry.consent)
      // Every case has its own valid positive control before the single targeted change.
      assert.deepEqual(loadRestoredReview(file, entry.store, entry.state, principal, entry.secret, entry.now),
        [{ id: projectId, displayName: projectId, scope: reviewScope, discussionOnly: true }], label)
      const changed = mutate(entry, file)
      assert.throws(() => loadRestoredReview(changed.file!, entry.store, entry.state, principal, entry.secret, changed.now ?? entry.now), forbidden, label)
      entry.store.close()
    }
    // A valid signature cannot make an unknown project, unsafe path or execution claim selectable.
    const entry = seedDrift(join(root, 'claims'), projectId, 'claims', 999)
    for (const selection of [
      [{ projectId: 'unknown-project', allowedPaths: ['src/'] }],
      [{ projectId, allowedPaths: ['../outside'] }],
      [{ projectId, allowedPaths: ['src/'], externalActions: ['deploy'] }],
      [{ projectId, allowedPaths: ['src/'], executable: true }],
    ]) assert.throws(() => prepareRestoredReview(entry.store, entry.state, principal, selection as never, entry.secret, entry.now), JSON.stringify(selection))
    entry.store.close()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
