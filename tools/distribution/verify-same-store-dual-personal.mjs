#!/usr/bin/env node
/**
 * Wave-22 D4: one real Store containing B normal Work/Broker/Q&A/native_applied plus SDK/context
 * candidates, snapshotted to a second root and reviewed through explicit personal readonly.
 * Zero vendor/native turns; the local fake endpoint only serves the controlled context send.
 */
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { cleanupBornResources, waitBornRecord } from './lib/live-cleanup.mjs'

const { values } = parseArgs({ options: { install: { type: 'string' }, business: { type: 'string' }, fault: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-same-store-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave22-same-store-dual/1', status: 'FAIL', steps: [], nativeTurns: 0, vendorSends: 0,
  limitations: ['Controlled local fake endpoint only; no real vendor/model/native turn.', 'The retained B state is copied before mutation; the original evidence state is not modified.'] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, allow = [0], env) => { const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 240_000, env }); let json = null; try { json = JSON.parse(r.stdout) } catch {} if (!allow.includes(r.status)) throw new Error(`command failed ${r.status} [${args.join(' ')}]: ${r.stdout.slice(0, 400)} ${r.stderr.slice(0, 200)}`); return { status: r.status, json } }
const freePort = () => new Promise((r) => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const waitHealth = async (port, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(700) }); if (res.ok) return await res.json() } catch {} await new Promise((r) => setTimeout(r, 150)) } return null }
let fake = null, fakeURL = '', fakeRequests = []
let seedEvidence = null, reviewEvidence = null
const fault = (name) => { if (values.fault === name) throw new Error(`injected_fault:${name}`) }
const startFake = (port) => new Promise((resolveServer) => {
  fake = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end('{}'); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    let body = {}; try { body = JSON.parse(raw) } catch {}
    fakeRequests.push({ body })
    const system = [...(body.messages ?? [])].reverse().find((m) => m.role === 'system' && typeof m.content === 'string' && m.content.trim().startsWith('{'))
    let context = null; try { context = JSON.parse(system.content).requestContext } catch {}
    const projectId = context?.projectId ?? 'fallback-project', sourceMessageId = context?.sourceMessageId ?? 'fallback-message'
    const scope = context?.scope ?? { projectId, allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
    const args = JSON.stringify({ text: 'Same-store fixture reply.', suggestions: [
      { kind: 'propose_work', goal: 'Inspect the current behavior and propose the smallest safe next step.', projectId, sourceMessageId },
      { kind: 'propose_decision', content: 'Keep the current behavior until an explicit user decision changes it.', scope, sourceMessageId },
    ] })
    const chunks = [
      { id: 'chatcmpl-w22', object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture-model', choices: [{ index: 0, delta: { content: 'Same-store fixture reply.' }, finish_reason: null }] },
      { id: 'chatcmpl-w22', object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_w22', type: 'function', function: { name: 'assistant_reply', arguments: '' } }] }, finish_reason: null }] },
      { id: 'chatcmpl-w22', object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] },
      { id: 'chatcmpl-w22', object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    res.end('data: [DONE]\n\n')
  })
  fake.listen(port, '127.0.0.1', () => resolveServer())
})

try {
  if (!values.install || !values.business) throw new Error('--install and --business are required')
  const install = resolve(values.install), business = resolve(values.business)
  const cli = join(install, 'bin/pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const seedState = join(root, 'seed-state')
  cpSync(business, seedState, { recursive: true, errorOnExist: true })
  chmodSync(seedState, 0o700)
  const businessProjects = JSON.parse(readFileSync(join(seedState, 'native-projects.json'), 'utf8')).projects
  const businessProjectId = businessProjects[0]?.id
  const runRoot = join(root, 'run')
  const roots = Object.fromEntries(['config', 'cache', 'logs', 'workspace'].map((k) => [k, join(runRoot, k)]))
  for (const p of Object.values(roots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const fakePort = await freePort(); fakeURL = `http://127.0.0.1:${fakePort}/v1`; await startFake(fakePort)
  const modelPath = join(roots.config, 'model.json')
  writeFileSync(modelPath, JSON.stringify({ baseURL: fakeURL, apiKey: 'wave22-fixture-key', model: 'fixture-model', allowedModels: ['fixture-model'], allowInsecureHttp: true }), { mode: 0o600 })
  const env = { ...process.env, PA_MODEL_CONFIG: modelPath }
  const seedArgs = ['--install', install, '--config-root', roots.config, '--data-root', seedState, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  const first = run(cli, ['first-run', '--json', ...seedArgs], [0], env)
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error('seed first-run failed')
  const seedConsole = await freePort(); let seedApi = await freePort(); if (seedApi === seedConsole) seedApi = await freePort()
  const seedOut = openSync(join(root, 'seed.out.log'), 'w', 0o600), seedErr = openSync(join(root, 'seed.err.log'), 'w', 0o600)
  const seedDaemon = spawn(cli, ['start', '--discussion-only', '--port', String(seedConsole), '--api-port', String(seedApi), ...seedArgs], { cwd: install, env, stdio: ['ignore', seedOut, seedErr], detached: true })
  seedDaemon.unref(); closeSync(seedOut); closeSync(seedErr)
  const seedHealth = await waitHealth(seedApi)
  if (seedHealth === null) throw new Error(`seed personal not healthy: ${readFileSync(join(root, 'seed.err.log'), 'utf8').slice(0, 500)}`)
  seedEvidence = { record: await waitBornRecord(roots.config), args: seedArgs }
  fault('after-seed-start')
  const seedAuth = { authorization: `Bearer ${readFileSync(join(seedState, 'api.key'), 'utf8').trim()}` }
  const sget = async (path) => { const res = await fetch(`http://127.0.0.1:${seedApi}${path}`, { headers: seedAuth }); return { status: res.status, body: await res.json() } }
  const spost = async (path, body) => { const res = await fetch(`http://127.0.0.1:${seedApi}${path}`, { method: 'POST', headers: { ...seedAuth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
  const suggestionsOn = await spost('/v1/assistant/suggestions', { enabled: true })
  if (suggestionsOn.status !== 200 || suggestionsOn.body.suggestionsEnabled !== true) throw new Error('could not enable suggestions')
  const projectDir = join(root, 'project'); mkdirSync(projectDir, { mode: 0o700 })
  writeFileSync(join(projectDir, 'README.md'), '# wave22 same store\n', { mode: 0o600 })
  const git = (...args) => { const r = spawnSync('git', ['-c', 'user.email=wave22@fixture.invalid', '-c', 'user.name=wave22', ...args], { cwd: projectDir, encoding: 'utf8' }); if (r.status !== 0) throw new Error('git failed') }
  git('init', '-q'); git('add', 'README.md'); git('commit', '-q', '-m', 'wave22 same store')
  const registered = await spost('/v1/projects', { path: projectDir, displayName: 'Wave22 same store', check: 'node_test' })
  if (registered.status !== 200) throw new Error(`project registration ${registered.status}`)
  const project = registered.body.projects.find((p) => p.path === projectDir) ?? registered.body.projects.at(-1)
  const conversationId = 'wave22-same-store-conversation'
  const created = await spost('/v1/conversations/commands', { commandId: 'wave22-create', conversationId, kind: 'create_conversation', projectId: project.id, title: 'Wave22 same store' })
  if (created.status !== 200 || created.body.status !== 'recorded') throw new Error('conversation create failed')
  const prepared = await spost('/v1/assistant/context/prepare', { commandId: 'wave22-context', text: 'Show the current behavior and propose one safe next step.',
    context: { projectId: project.id, conversationId, selections: ['conversation', 'project'], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } } })
  if (prepared.status !== 200) throw new Error(`context prepare ${prepared.status}`)
  const sent = await spost('/v1/assistant/context/send', { commandId: prepared.body.commandId ?? 'wave22-context', token: prepared.body.token })
  if (sent.status !== 200 || sent.body.status !== 'recorded') throw new Error('context send failed')
  let source = null, candidates = null
  for (let i = 0; i < 120; i++) {
    const messages = await sget(`/v1/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`)
    source = (messages.body?.messages ?? []).find((m) => m.role === 'user' && String(m.text).includes('current behavior'))
    if (source) { candidates = await sget(`/v1/messages/${encodeURIComponent(source.id)}/candidates`); if (candidates.body?.status === 'candidates') break }
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!source || candidates?.body?.status !== 'candidates' || candidates.body.candidates.length < 2) throw new Error(`same-store candidates missing: ${JSON.stringify(candidates?.body).slice(0, 400)}`)
  if (seedHealth.nativeTurns > 0 || seedHealth.vendorSends > 0) throw new Error('seed personal started native/vendor execution')
  const seedStop = run(cli, ['stop', '--json', ...seedArgs], [0], env)
  if (seedStop.json?.status !== 'STOPPED') throw new Error('seed stop failed')
  seedEvidence = null
  const storageSeed = await import(pathToFileURL(join(install, 'app/packages/storage/dist/index.js')).href)
  const workflowsSeed = await import(pathToFileURL(join(install, 'app/packages/workflows/dist/index.js')).href)
  const seedStore = new storageSeed.ProductStore({ path: join(seedState, 'state.sqlite') })
  const origin = (() => {
    const works = seedStore.product.works.listByProject(businessProjectId, { limit: 20 })
    const questions = seedStore.db.prepare('SELECT id, work_id, version FROM user_questions ORDER BY id LIMIT 100').all()
    const links = works.flatMap((work) => seedStore.product.links.listByWork(work.id))
    const answers = seedStore.db.prepare('SELECT answer_id, question_id, answer_digest FROM answers ORDER BY answer_id LIMIT 50').all()
    const deliveries = seedStore.db.prepare("SELECT answer_id, status FROM answer_deliveries WHERE status = 'native_applied' ORDER BY answer_id LIMIT 50").all()
    const attempts = seedStore.db.prepare('SELECT attempt_id, ticket_id FROM runtime_bindings ORDER BY attempt_id LIMIT 50').all()
    return { attempts: attempts.map((row) => ({ attemptId: String(row.attempt_id), ticketId: String(row.ticket_id) })), works: works.map((work) => ({ id: work.id, revision: work.revision, status: work.status ?? null })), questions: questions.map((question) => ({ id: String(question.id), workId: String(question.work_id), version: Number(question.version) })),
      tickets: links.map((link) => ({ ticketId: link.ticketId ?? link.id ?? null, workId: link.workId ?? null })), answers: answers.map((row) => ({ answerId: String(row.answer_id), questionId: String(row.question_id), digest: String(row.answer_digest) })), nativeApplied: deliveries.map((row) => ({ answerId: String(row.answer_id), status: String(row.status) })) }
  })()
  if (origin.works.length < 1 || origin.questions.length < 1 || origin.answers.length < 1 || origin.nativeApplied.length < 1) throw new Error(`origin business identities incomplete: ${JSON.stringify({ works: origin.works.length, questions: origin.questions.length, answers: origin.answers.length, nativeApplied: origin.nativeApplied.length })}`)
  const snapshots = new workflowsSeed.WorkflowSnapshots(seedStore)
  const snapV1 = join(root, 'snapshot-v1'), snapV2 = join(root, 'snapshot-v2')
  const createdV1 = await snapshots.create({ destination: snapV1, formatVersion: 1 })
  const createdV2 = await snapshots.create({ destination: snapV2, formatVersion: 2 })
  if (createdV1.status !== 'ok' || createdV1.manifest.protocol !== 'workflow-snapshot/1' || createdV1.manifest.evidence.families.length !== 13) throw new Error(`v1 snapshot create failed: ${JSON.stringify({ status: createdV1.status, message: createdV1.message, protocol: createdV1.manifest?.protocol, familySetVersion: createdV1.manifest?.evidence?.familySetVersion, missing: createdV1.manifest?.missing, corrupt: createdV1.manifest?.corrupt })})`)
  if (createdV2.status !== 'ok' || createdV2.manifest.protocol !== 'workflow-snapshot/2' || createdV2.manifest.evidence.familySetVersion !== 2) throw new Error('v2 snapshot create failed')
  const verifyV1 = snapshots.verify(snapV1), verifyV2 = snapshots.verify(snapV2)
  if (verifyV1.status !== 'ok' || verifyV2.status !== 'ok') throw new Error('snapshot verify failed')
  seedStore.close()
  step('same-store-seed', 'PASS', { projectId: project.id, sourceMessageId: source.id, candidates: candidates.body.candidates.length, fakeRequests: fakeRequests.length, nativeTurns: 0, vendorSends: 0,
    origin, snapshots: { v1: createdV1.manifest.protocol, v1Families: createdV1.manifest.evidence.families.length, v1Digest: createdV1.manifest.evidence.digest, v2: createdV2.manifest.protocol, v2Families: createdV2.manifest.evidence.families.length, v2Digest: createdV2.manifest.evidence.digest } })

  const bundle = join(root, 'same-store.pab')
  const backup = run(cli, ['backup', '--json', '--out', bundle, ...seedArgs], [0], env)
  if (!['READY', 'CREATED'].includes(backup.json?.status)) throw new Error('same-store backup failed')
  const reviewRoot = join(root, 'reviewed')
  const reviewRoots = Object.fromEntries(['config', 'cache', 'logs', 'workspace'].map((k) => [k, join(reviewRoot, k)]))
  for (const p of Object.values(reviewRoots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const reviewState = join(reviewRoot, 'state')
  const reviewArgs = ['--install', install, '--config-root', reviewRoots.config, '--data-root', reviewState, '--cache-root', reviewRoots.cache, '--logs-root', reviewRoots.logs, '--workspace-root', reviewRoots.workspace]
  const restored = run(cli, ['restore', '--json', '--bundle', bundle, '--to', reviewState, ...seedArgs], [0], env)
  if (restored.json?.status !== 'RESTORED') throw new Error('same-store restore failed')
  const reviewFirst = run(cli, ['first-run', '--json', ...reviewArgs], [0], env)
  if (!['READY', 'OK'].includes(reviewFirst.json?.status)) throw new Error('review first-run failed')
  const reviewPath = join(root, 'review.json')
  const preparedReview = run(cli, ['review-restored', '--json', '--state', reviewState, '--project', project.id, '--project', businessProjectId, '--allow-path', '.', '--out', reviewPath], [0], env)
  if (preparedReview.json?.status !== 'prepared') throw new Error('same-package review preparation failed')
  const rConsole = await freePort(); let rApi = await freePort(); if (rApi === rConsole) rApi = await freePort()
  const rOut = openSync(join(root, 'review.out.log'), 'w', 0o600), rErr = openSync(join(root, 'review.err.log'), 'w', 0o600)
  const reviewDaemon = spawn(cli, ['start', '--discussion-only', '--review-restored-scope', reviewPath, '--port', String(rConsole), '--api-port', String(rApi), ...reviewArgs], { cwd: install, env, stdio: ['ignore', rOut, rErr], detached: true })
  reviewDaemon.unref(); closeSync(rOut); closeSync(rErr)
  const reviewHealth = await waitHealth(rApi)
  if (reviewHealth === null) throw new Error(`review not healthy: ${readFileSync(join(root, 'review.err.log'), 'utf8').slice(0, 500)}`)
  reviewEvidence = { record: await waitBornRecord(reviewRoots.config), args: reviewArgs }
  fault('after-review-start')
  const rAuth = { authorization: `Bearer ${readFileSync(join(reviewState, 'api.key'), 'utf8').trim()}` }
  const rget = async (path) => { const res = await fetch(`http://127.0.0.1:${rApi}${path}`, { headers: rAuth }); return { status: res.status, body: await res.json() } }
  const rpost = async (path, body) => { const res = await fetch(`http://127.0.0.1:${rApi}${path}`, { method: 'POST', headers: { ...rAuth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
  const inspect = await rget('/v1/recovery/inspect')
  const snapshot = await rget('/v1/snapshot')
  if (snapshot.status !== 200 || (snapshot.body.works ?? []).length < 1) throw new Error('same-store review lacks real Work')
  fault('assert-fail')
  fault('candidate-read-fail')
  const afterCandidates = await rget(`/v1/messages/${encodeURIComponent(source.id)}/candidates`)
  if (afterCandidates.status !== 200 || afterCandidates.body.status !== 'candidates') throw new Error('same-store review candidates missing')
  const afterSources = await rget(`/v1/messages/${encodeURIComponent(source.id)}/context/sources`)
  if (afterSources.status !== 200) throw new Error('same-store review sources missing')
  const scoped = await rget(`/v1/messages/${encodeURIComponent(source.id)}/context/sources?scopeReview=1`)
  const scopedOptIn = scoped.status === 200 && scoped.body.scopeReview?.protocol === 'context-scope-review/1'
  if (!scopedOptIn) step('scope-review-optional', 'NOT_TESTED', { status: scoped.status, reason: 'installed optional diagnostics not observed' })
  else step('scope-review-optional', 'PASS', { protocol: scoped.body.scopeReview.protocol, reasons: scoped.body.scopeReview.reasons?.length ?? 0, withheld: scoped.body.scopeReview.withheld ?? null })
  const historyAfter = await rget(`/v1/conversations/${encodeURIComponent(conversationId)}/messages?limit=50`)
  if (historyAfter.status !== 200) throw new Error('same-store review history not readable')
  const businessRefusal = await rpost('/v1/assistant/suggestions', { enabled: false })
  if (businessRefusal.status !== 422 || businessRefusal.body.error?.code !== 'unsupported_capability') throw new Error('reviewed business mutation not refused')
  const storage = await import(pathToFileURL(join(install, 'app/packages/storage/dist/index.js')).href)
  const v1 = storage.readWorkflowEvidence(join(reviewState, 'state.sqlite'), 1)
  const v2 = storage.readWorkflowEvidence(join(reviewState, 'state.sqlite'), 2)
  if (v1.families.length !== 13 || v2.families.length !== 21) throw new Error('dual-format family counts changed')
  const restoredDbSha = createHash('sha256').update(readFileSync(join(reviewState, 'state.sqlite'))).digest('hex')
  if (restoredDbSha !== createdV1.manifest.database.sha256 || restoredDbSha !== createdV2.manifest.database.sha256) throw new Error('restored database bytes differ from the actual v1/v2 snapshot databases')
  const reviewStore = new storage.ProductStore({ path: join(reviewState, 'state.sqlite') })
  const restoredBusiness = (() => {
    const works = reviewStore.product.works.listByProject(businessProjectId, { limit: 20 })
    const questions = reviewStore.db.prepare('SELECT id, work_id FROM user_questions ORDER BY id LIMIT 100').all()
    const links = works.flatMap((work) => reviewStore.product.links.listByWork(work.id))
    const answers = reviewStore.db.prepare('SELECT answer_id, question_id, answer_digest FROM answers ORDER BY answer_id LIMIT 50').all()
    const deliveries = reviewStore.db.prepare("SELECT answer_id, status FROM answer_deliveries WHERE status = 'native_applied' ORDER BY answer_id LIMIT 50").all()
    const attempts = reviewStore.db.prepare('SELECT attempt_id, ticket_id FROM runtime_bindings ORDER BY attempt_id LIMIT 50').all()
    return { attempts: attempts.map((row) => ({ attemptId: String(row.attempt_id), ticketId: String(row.ticket_id) })), works: works.map((work) => ({ id: work.id })), questions: questions.map((question) => ({ id: String(question.id), workId: String(question.work_id) })),
      tickets: links.map((link) => ({ ticketId: link.ticketId ?? link.id ?? null })), answers: answers.map((row) => ({ answerId: String(row.answer_id), questionId: String(row.question_id), digest: String(row.answer_digest) })), nativeApplied: deliveries.map((row) => ({ answerId: String(row.answer_id), status: String(row.status) })) }
  })()
  reviewStore.close()
  const missing = { works: origin.works.filter((item) => !restoredBusiness.works.some((value) => value.id === item.id)).map((item) => item.id),
    questions: origin.questions.filter((item) => !restoredBusiness.questions.some((value) => value.id === item.id && value.workId === item.workId)).map((item) => item.id),
    answers: origin.answers.filter((item) => !restoredBusiness.answers.some((value) => value.answerId === item.answerId && value.digest === item.digest)).map((item) => item.answerId),
    nativeApplied: origin.nativeApplied.filter((item) => !restoredBusiness.nativeApplied.some((value) => value.answerId === item.answerId && value.status === item.status)).map((item) => item.answerId),
    attempts: origin.attempts.filter((item) => !restoredBusiness.attempts.some((value) => value.attemptId === item.attemptId && value.ticketId === item.ticketId)).map((item) => item.attemptId) }
  if (Object.values(missing).some((list) => list.length > 0)) throw new Error(`restored original IDs/digests differ: ${JSON.stringify(missing)}`)
  if (fakeRequests.length > 1) throw new Error('reviewed startup/read called the fake model again')
  const stop = run(cli, ['stop', '--json', ...reviewArgs], [0], env)
  if (stop.json?.status !== 'STOPPED') throw new Error('review stop failed')
  reviewEvidence = null
  step('same-store-second-root-personal-review', 'PASS', { markerState: inspect.body.state, works: (snapshot.body.works ?? []).length, candidates: afterCandidates.body.candidates.length,
    sources: 200, scopeReviewOptIn: scopedOptIn, businessRefused: true, originalWork: origin.works.length, originalQuestions: origin.questions.length, originalAnswers: origin.answers.length, originalAttempts: origin.attempts.length, nativeApplied: origin.nativeApplied.length, historyAfterConsent: historyAfter.status, snapshotsV1V2: true, snapshotBytesRestored: true, originalIdsPreserved: true, workflowV1Families: v1.families.length, workflowV2Families: v2.families.length, fakeRequests: fakeRequests.length, nativeTurns: reviewHealth.nativeTurns ?? 0 })
  evidence.status = 'PASS'
  evidence.build = { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema }
} catch (error) { evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error) }
finally {
  try { fake?.close() } catch {}
  const cleanups = []
  for (const entry of [reviewEvidence, seedEvidence].filter(Boolean)) {
    if (!entry.record) { cleanups.push({ status: 'UNKNOWN', unknown: [{ reason: 'record_never_observed' }], retained: true }); continue }
    cleanups.push(await cleanupBornResources({ cli: join(values.install, 'bin/pa'), install: resolve(values.install), roots: { config: entry.record.configRoot, data: entry.record.state }, records: [entry.record], args: entry.args, env: process.env }))
  }
  evidence.cleanup = cleanups
  const retained = cleanups.some((item) => item.retained)
  if (retained) evidence.retainedRoot = root
  else rmSync(root, { recursive: true, force: true })
}
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
