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
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { install: { type: 'string' }, business: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-same-store-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave22-same-store-dual/1', status: 'FAIL', steps: [], nativeTurns: 0, vendorSends: 0,
  limitations: ['Controlled local fake endpoint only; no real vendor/model/native turn.', 'The retained B state is copied before mutation; the original evidence state is not modified.'] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, allow = [0], env) => { const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 240_000, env }); let json = null; try { json = JSON.parse(r.stdout) } catch {} if (!allow.includes(r.status)) throw new Error(`command failed ${r.status} [${args.join(' ')}]: ${r.stdout.slice(0, 400)} ${r.stderr.slice(0, 200)}`); return { status: r.status, json } }
const freePort = () => new Promise((r) => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const waitHealth = async (port, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(700) }); if (res.ok) return await res.json() } catch {} await new Promise((r) => setTimeout(r, 150)) } return null }
let fake = null, fakeURL = '', fakeRequests = []
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
  const seedAuth = { authorization: `Bearer ${readFileSync(join(seedState, 'api.key'), 'utf8').trim()}` }
  const sget = async (path) => { const res = await fetch(`http://127.0.0.1:${seedApi}${path}`, { headers: seedAuth }); return { status: res.status, body: await res.json() } }
  const spost = async (path, body) => { const res = await fetch(`http://127.0.0.1:${seedApi}${path}`, { method: 'POST', headers: { ...seedAuth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
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
  step('same-store-seed', 'PASS', { projectId: project.id, sourceMessageId: source.id, candidates: candidates.body.candidates.length, fakeRequests: fakeRequests.length, nativeTurns: 0, vendorSends: 0 })

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
  const preparedReview = run(cli, ['review-restored', '--json', '--state', reviewState, '--project', project.id, '--allow-path', '.', '--out', reviewPath], [0], env)
  if (preparedReview.json?.status !== 'prepared') throw new Error('same-package review preparation failed')
  const rConsole = await freePort(); let rApi = await freePort(); if (rApi === rConsole) rApi = await freePort()
  const rOut = openSync(join(root, 'review.out.log'), 'w', 0o600), rErr = openSync(join(root, 'review.err.log'), 'w', 0o600)
  const reviewDaemon = spawn(cli, ['start', '--discussion-only', '--review-restored-scope', reviewPath, '--port', String(rConsole), '--api-port', String(rApi), ...reviewArgs], { cwd: install, env, stdio: ['ignore', rOut, rErr], detached: true })
  reviewDaemon.unref(); closeSync(rOut); closeSync(rErr)
  const reviewHealth = await waitHealth(rApi)
  if (reviewHealth === null) throw new Error(`review not healthy: ${readFileSync(join(root, 'review.err.log'), 'utf8').slice(0, 500)}`)
  const rAuth = { authorization: `Bearer ${readFileSync(join(reviewState, 'api.key'), 'utf8').trim()}` }
  const rget = async (path) => { const res = await fetch(`http://127.0.0.1:${rApi}${path}`, { headers: rAuth }); return { status: res.status, body: await res.json() } }
  const rpost = async (path, body) => { const res = await fetch(`http://127.0.0.1:${rApi}${path}`, { method: 'POST', headers: { ...rAuth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
  const inspect = await rget('/v1/recovery/inspect')
  const snapshot = await rget('/v1/snapshot')
  if (snapshot.status !== 200 || (snapshot.body.works ?? []).length < 1) throw new Error('same-store review lacks real Work')
  const afterCandidates = await rget(`/v1/messages/${encodeURIComponent(source.id)}/candidates`)
  if (afterCandidates.status !== 200 || afterCandidates.body.status !== 'candidates') throw new Error('same-store review candidates missing')
  const afterSources = await rget(`/v1/messages/${encodeURIComponent(source.id)}/context/sources`)
  if (afterSources.status !== 200) throw new Error('same-store review sources missing')
  const scoped = await rget(`/v1/messages/${encodeURIComponent(source.id)}/context/sources?scopeReview=1`)
  const scopedOptIn = scoped.status === 200 && scoped.body.scopeReview?.protocol === 'context-scope-review/1'
  if (!scopedOptIn) step('scope-review-optional', 'NOT_TESTED', { status: scoped.status, reason: 'installed optional diagnostics not observed' })
  else step('scope-review-optional', 'PASS', { protocol: scoped.body.scopeReview.protocol, reasons: scoped.body.scopeReview.reasons?.length ?? 0, withheld: scoped.body.scopeReview.withheld ?? null })
  const businessRefusal = await rpost('/v1/assistant/suggestions', { enabled: false })
  if (businessRefusal.status !== 422 || businessRefusal.body.error?.code !== 'unsupported_capability') throw new Error('reviewed business mutation not refused')
  const storage = await import(pathToFileURL(join(install, 'app/packages/storage/dist/index.js')).href)
  const v1 = storage.readWorkflowEvidence(join(reviewState, 'state.sqlite'), 1)
  const v2 = storage.readWorkflowEvidence(join(reviewState, 'state.sqlite'), 2)
  if (v1.families.length !== 13 || v2.families.length !== 21) throw new Error('dual-format family counts changed')
  if (fakeRequests.length > 1) throw new Error('reviewed startup/read called the fake model again')
  const stop = run(cli, ['stop', '--json', ...reviewArgs], [0], env)
  if (stop.json?.status !== 'STOPPED') throw new Error('review stop failed')
  step('same-store-second-root-personal-review', 'PASS', { markerState: inspect.body.state, works: (snapshot.body.works ?? []).length, candidates: afterCandidates.body.candidates.length,
    sources: 200, scopeReviewOptIn: scopedOptIn, businessRefused: true, workflowV1Families: v1.families.length, workflowV2Families: v2.families.length, fakeRequests: fakeRequests.length, nativeTurns: reviewHealth.nativeTurns ?? 0 })
  evidence.status = 'PASS'
  evidence.build = { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema }
} catch (error) { evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error) }
finally { try { fake?.close() } catch {} rmSync(root, { recursive: true, force: true }) }
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
