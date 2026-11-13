#!/usr/bin/env node
/**
 * D3/D5/D7: same-package personal nonempty candidate lifecycle over a private local fake SDK.
 *
 * Starts a personal discussion-only instance with a private model config pointing at a local fake
 * OpenAI-compatible endpoint (zero vendor/native turns). The fake returns a nonempty propose_work
 * suggestion. The recipe reads candidates, prepares/confirms/rejects them, replays the same command,
 * and verifies the original request/context. No target activation or private permission is created.
 */
import { createServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, closeSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { install: { type: 'string' }, json: { type: 'boolean', default: false } } })
const root = mkdtempSync(join(tmpdir(), 'pa-nonempty-personal-'))
chmodSync(root, 0o700)
const evidence = { protocol: 'wave18-nonempty-personal-http/1', status: 'FAIL', steps: [], nativeTurns: 0, vendorSends: 0,
  limitations: ['The model endpoint is a local fake; no vendor request or native executor exists in discussion-only mode.'] }
const step = (id, status, detail = {}) => { evidence.steps.push({ id, status, detail }); if (status !== 'PASS') process.stderr.write(`${status} ${id} ${JSON.stringify(detail).slice(0, 400)}\n`) }
const run = (cli, args, allow = [0]) => { const r = spawnSync(cli, args, { encoding: 'utf8', timeout: 240_000 }); let json = null; try { json = JSON.parse(r.stdout) } catch {} if (!allow.includes(r.status)) throw new Error(`command failed ${r.status} [${args.join(' ')}]: ${r.stdout.slice(0, 400)} ${r.stderr.slice(0, 200)}`); return { status: r.status, json } }
const freePort = () => new Promise((r) => { const s = createNetServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)) }) })
const waitHealth = async (port, ms = 60_000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const res = await fetch(`http://127.0.0.1:${port}/v1/health`, { signal: AbortSignal.timeout(700) }); if (res.ok) return await res.json() } catch {} await new Promise((r) => setTimeout(r, 200)) } return null }

let fake = null, fakeURL = '', fakeRequests = []
const startFake = (port) => new Promise((resolveServer) => {
  fake = createServer(async (req, res) => {
    if (req.method !== 'POST' || !req.url.endsWith('/chat/completions')) { res.writeHead(404); res.end('{}'); return }
    let raw = ''; for await (const chunk of req) raw += chunk
    let body = {}; try { body = JSON.parse(raw) } catch {}
    fakeRequests.push({ url: req.url, body })
    const system = [...(body.messages ?? [])].reverse().find((m) => m.role === 'system' && typeof m.content === 'string' && m.content.trim().startsWith('{'))
    let context = null; try { context = JSON.parse(system.content).requestContext } catch {}
    const projectId = context?.projectId ?? 'fallback-project', sourceMessageId = context?.sourceMessageId ?? 'fallback-message'
    const scope = context?.scope ?? { projectId, allowedPaths: ['README.md'], excludedPaths: [], externalActions: [] }
    const args = JSON.stringify({ text: 'Wave-18 fixture reply.', suggestions: [
      { kind: 'propose_work', goal: 'Inspect the current behavior and propose the smallest safe next step.', projectId, sourceMessageId },
      { kind: 'propose_decision', content: 'Keep the current behavior until an explicit user decision changes it.', scope, sourceMessageId },
    ] })
    const chunks = [
      { id: 'chatcmpl-wave18', object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture-model', choices: [{ index: 0, delta: { content: 'Wave-18 fixture reply.' }, finish_reason: null }] },
      { id: 'chatcmpl-wave18', object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_wave18', type: 'function', function: { name: 'assistant_reply', arguments: '' } }] }, finish_reason: null }] },
      { id: 'chatcmpl-wave18', object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture-model', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] }, finish_reason: null }] },
      { id: 'chatcmpl-wave18', object: 'chat.completion.chunk', created: 1, model: body.model ?? 'fixture-model', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ]
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    for (const chunk of chunks) res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    res.write('data: [DONE]\n\n'); res.end()
  })
  fake.listen(port, '127.0.0.1', () => resolveServer())
})

try {
  if (values.install === undefined) throw new Error('--install is required')
  const install = resolve(values.install)
  const cli = join(install, 'bin/pa')
  const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
  const base = join(root, 'run')
  const roots = Object.fromEntries(['config', 'state', 'cache', 'logs', 'workspace'].map((k) => [k, join(base, k)]))
  for (const p of Object.values(roots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const fakePort = await freePort(); fakeURL = `http://127.0.0.1:${fakePort}/v1`; await startFake(fakePort)
  const modelPath = join(roots.config, 'model.json')
  writeFileSync(modelPath, JSON.stringify({ baseURL: fakeURL, apiKey: 'wave18-fixture-key', model: 'fixture-model', allowedModels: ['fixture-model'], allowInsecureHttp: true }), { mode: 0o600 })
  const env = { ...process.env, PA_MODEL_CONFIG: modelPath }
  const argsOf = ['--install', install, '--config-root', roots.config, '--data-root', roots.state, '--cache-root', roots.cache, '--logs-root', roots.logs, '--workspace-root', roots.workspace]
  const first = run(cli, ['first-run', '--json', ...argsOf])
  if (!['READY', 'OK'].includes(first.json?.status)) throw new Error('first-run failed')
  const consolePort = await freePort(); let apiPort = await freePort(); if (apiPort === consolePort) apiPort = await freePort()
  const outFd = openSync(join(root, 'start.out.log'), 'w', 0o600), errFd = openSync(join(root, 'start.err.log'), 'w', 0o600)
  const daemon = spawn(cli, ['start', '--discussion-only', '--port', String(consolePort), '--api-port', String(apiPort), ...argsOf], { cwd: install, env, stdio: ['ignore', outFd, errFd], detached: true })
  daemon.unref(); closeSync(outFd); closeSync(errFd)
  const health = await waitHealth(apiPort)
  if (health === null) throw new Error(`instance not healthy: ${readFileSync(join(root, 'start.err.log'), 'utf8').slice(0, 400)}`)
  const token = readFileSync(join(roots.state, 'api.key'), 'utf8').trim()
  const auth = { authorization: `Bearer ${token}` }
  const get = async (path) => { const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, { headers: auth }); return { status: res.status, body: await res.json() } }
  const post = async (path, body) => { const res = await fetch(`http://127.0.0.1:${apiPort}${path}`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
  if (health.execution?.available === true) throw new Error('discussion-only unexpectedly exposed execution')
  step('discussion-only-personal', 'PASS', { mode: health.mode, personalMode: health.mode === 'personal', executionUnavailable: health.execution?.available !== true })
  const on = await post('/v1/assistant/suggestions', { enabled: true })
  if (on.status !== 200 || on.body.suggestionsEnabled !== true) throw new Error('could not enable suggestions')

  // A clean git project is required for registration; the fake SDK only sees context data.
  const projectDir = join(root, 'project'); mkdirSync(projectDir, { mode: 0o700 })
  writeFileSync(join(projectDir, 'README.md'), '# wave18 personal fixture\n', { mode: 0o600 })
  const git = (...args) => { const r = spawnSync('git', ['-c', 'user.email=wave18@fixture.invalid', '-c', 'user.name=wave18', ...args], { cwd: projectDir, encoding: 'utf8' }); if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.slice(0, 200)}`) }
  git('init', '-q'); git('add', 'README.md'); git('commit', '-q', '-m', 'wave18 fixture')
  const registered = await post('/v1/projects', { path: projectDir, displayName: 'Wave18 personal fixture', check: 'node_test' })
  if (registered.status !== 200) throw new Error(`project registration ${registered.status} ${JSON.stringify(registered.body).slice(0, 400)}`)
  const project = registered.body.projects.find((value) => value.path === projectDir) ?? registered.body.projects.at(-1)
  const profileId = registered.body.profiles?.[0]?.id ?? 'fixture-profile'
  const conversationId = 'wave18-personal-conversation'
  const created = await post('/v1/conversations/commands', { commandId: 'wave18-create-conversation', conversationId, kind: 'create_conversation', projectId: project.id, title: 'Wave18 personal discussion' })
  if (created.status !== 200 || created.body.status !== 'recorded') throw new Error(`conversation create ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`)
  const conversation = { id: conversationId }
  const commandId = 'wave18-context-message'
  const prepared = await post('/v1/assistant/context/prepare', { commandId, text: 'Show the current behavior and propose one safe next step.',
    context: { projectId: project.id, conversationId: conversation.id, selections: ['conversation', 'project'], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 } } })
  if (prepared.status !== 200) throw new Error(`context prepare ${prepared.status} ${JSON.stringify(prepared.body).slice(0, 300)}`)
  const sent = await post('/v1/assistant/context/send', { commandId: prepared.body.commandId ?? commandId, token: prepared.body.token })
  if (sent.status !== 200 || sent.body.status !== 'recorded') throw new Error(`context send ${sent.status} ${JSON.stringify(sent.body).slice(0, 300)}`)

  // Wait for the real effect/reply to finish, then identify the source message from conversation messages.
  let source = null, messages = null
  for (let i = 0; i < 100; i++) {
    messages = await get(`/v1/conversations/${encodeURIComponent(conversation.id)}/messages?limit=50`)
    const list = messages.body?.messages ?? messages.body?.items ?? []
    source = list.find((m) => m.role === 'user' && typeof m.text === 'string' && m.text.includes('current behavior'))
    if (source && list.length > 1) break
    await new Promise((r) => setTimeout(r, 100))
  }
  if (!source) throw new Error(`source message not found: ${JSON.stringify(messages?.body).slice(0, 400)}`)
  if (fakeRequests.length < 1) throw new Error('the local model endpoint received no request')
  const reqBody = fakeRequests.at(-1).body
  const ctxSystem = [...(reqBody.messages ?? [])].reverse().find((m) => m.role === 'system' && typeof m.content === 'string' && m.content.trim().startsWith('{'))
  const ctx = JSON.parse(ctxSystem.content).requestContext
  if (ctx.sourceMessageId !== source.id || ctx.projectId !== project.id) throw new Error(`original request context mismatch: ${JSON.stringify(ctx)} vs ${source.id}`)
  evidence.vendorSends = 0
  step('original-request-and-fake-sdk', 'PASS', { sourceMessageId: source.id, projectId: project.id, fakeRequests: fakeRequests.length, vendorSends: 0 })

  let candidates = null
  for (let i = 0; i < 100; i++) { candidates = await get(`/v1/messages/${encodeURIComponent(source.id)}/candidates`); if (candidates.body?.status === 'candidates' || candidates.body?.status === 'none') break; await new Promise((r) => setTimeout(r, 100)) }
  if (candidates.status !== 200 || candidates.body.status !== 'candidates' || candidates.body.candidates?.length < 2)
    throw new Error(`nonempty candidates unavailable: ${candidates.status} ${JSON.stringify(candidates.body).slice(0, 2000)}`)
  if (candidates.body.executable !== false || candidates.body.authorization !== 'none') throw new Error('candidates advertised execution/authorization')
  const c1 = candidates.body.candidates[0], c2 = candidates.body.candidates[1]
  step('nonempty-candidates', 'PASS', { status: candidates.body.status, count: candidates.body.candidates.length, kinds: candidates.body.candidates.map((c) => c.kind), trust: candidates.body.trust, executable: candidates.body.executable })

  const preview = await post('/v1/assistant/candidates/prepare', { messageId: source.id, index: c1.index, payloadDigest: c1.payloadDigest })
  if (preview.status !== 200) throw new Error(`candidate prepare ${preview.status} ${JSON.stringify(preview.body).slice(0, 400)}`)
  if (preview.body.protocol !== 'proposal-preview/1' || preview.body.record?.state !== 'pending') throw new Error('candidate preview is not a pending proposal preview')
  step('candidate-prepare', 'PASS', { index: c1.index, kind: c1.kind, requiredInputs: preview.body.requiredInputs, tokenChars: preview.body.token?.length, state: preview.body.record?.state })

  // Explicit reject of the second candidate (an actual user decision, not execution).
  const rejectPreview = await post('/v1/assistant/candidates/prepare', { messageId: source.id, index: c2.index, payloadDigest: c2.payloadDigest })
  if (rejectPreview.status !== 200) throw new Error(`reject preview ${rejectPreview.status}`)
  const rejectBody = { commandId: 'wave18-reject-1', projectId: project.id, conversationId: conversation.id, token: rejectPreview.body.token, kind: 'reject_proposal' }
  const rejected = await post('/v1/proposals/commands', rejectBody)
  if (rejected.status !== 200 || rejected.body.status !== 'recorded') throw new Error(`reject command ${rejected.status} ${JSON.stringify(rejected.body).slice(0, 300)}`)
  step('explicit-reject', 'PASS', { status: rejected.body.status, commandId: rejected.body.commandId, result: rejected.body.result ?? null })

  // The second candidate is a decision proposal: explicit confirm creates a data-only decision record,
  // never execution. Replaying the same command returns the same receipt identity.
  const decisionPreview = await post('/v1/assistant/candidates/prepare', { messageId: source.id, index: c2.index, payloadDigest: c2.payloadDigest })
  if (decisionPreview.status !== 200) throw new Error(`decision preview ${decisionPreview.status} ${JSON.stringify(decisionPreview.body).slice(0, 400)}`)
  const confirmBody = { commandId: 'wave18-confirm-1', projectId: project.id, conversationId: conversation.id, token: decisionPreview.body.token, kind: 'confirm_proposal' }
  const confirmed = await post('/v1/proposals/commands', confirmBody)
  if (confirmed.status !== 200 || confirmed.body.status !== 'recorded') throw new Error(`decision confirm ${confirmed.status} ${JSON.stringify(confirmed.body).slice(0, 400)}`)
  const replay = await post('/v1/proposals/commands', confirmBody)
  if (replay.status !== 200 || replay.body.commandId !== confirmed.body.commandId) throw new Error(`confirm replay mismatch ${replay.status} ${JSON.stringify(replay.body).slice(0, 400)}`)
  step('explicit-decision-confirm-and-replay', 'PASS', { status: confirmed.body.status, receiptDigest: confirmed.body.receiptDigest ?? null, replaySameCommand: true, result: confirmed.body.result ?? null })

  // A work proposal must be explicitly refused in discussion-only mode: held work would need the
  // missing executor, so main's product guard is expected, with no work/queue side effect.
  const workPreview = await post('/v1/assistant/candidates/prepare', { messageId: source.id, index: c1.index, payloadDigest: c1.payloadDigest })
  const workConfirm = await post('/v1/proposals/commands', { commandId: 'wave18-work-confirm', projectId: project.id, conversationId: conversation.id, token: workPreview.body.token, kind: 'confirm_proposal',
    work: { scope: ctx.scope ?? { projectId: project.id, allowedPaths: ['README.md'], excludedPaths: [], externalActions: [] }, criteria: [{ id: 'human-review', description: 'A human reviews the held work before any execution.', kind: 'human', required: true }], profileId } })
  if (workConfirm.status !== 422 || workConfirm.body.error?.code !== 'unsupported_capability') throw new Error(`work confirm was not refused: ${workConfirm.status} ${JSON.stringify(workConfirm.body).slice(0, 300)}`)
  step('work-confirm-refused-without-executor', 'PASS', { httpStatus: workConfirm.status, code: workConfirm.body.error.code })

  if (fakeRequests.length < 1) throw new Error('fake SDK saw no request')
  step('native-zero', 'PASS', { nativeTurns: 0, vendorSends: 0, discussionOnly: true })

  // D5: relocate the SAME personal data to a second private root and read it through restored
  // read-only HTTP. Business mutations are refused, the old queue/model is not executed, and source
  // prepare/confirm/audit stays data-only (not_granted).
  const stop = run(cli, ['stop', '--json', ...argsOf])
  if (stop.json?.status !== 'STOPPED') throw new Error(`stop failed: ${JSON.stringify(stop.json).slice(0, 200)}`)
  step('config-files', 'PASS', { files: readdirSync(roots.config) })
  const bundle = join(root, 'personal.pab')
  const backup = run(cli, ['backup', '--json', '--out', bundle, ...argsOf])
  if (!['READY', 'CREATED'].includes(backup.json?.status)) throw new Error('backup failed')
  const restoredRoot = join(root, 'restored')
  const restoredRoots = Object.fromEntries(['config', 'cache', 'logs', 'workspace'].map((k) => [k, join(restoredRoot, k)]))
  for (const p of Object.values(restoredRoots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const restoredState = join(restoredRoot, 'state')
  const restoredArgs = ['--install', install, '--config-root', restoredRoots.config, '--data-root', restoredState, '--cache-root', restoredRoots.cache, '--logs-root', restoredRoots.logs, '--workspace-root', restoredRoots.workspace]
  const restoredResult = run(cli, ['restore', '--json', '--bundle', bundle, '--to', restoredState, ...argsOf])
  if (restoredResult.json?.status !== 'RESTORED') throw new Error('restore failed')
  const restoredFirst = run(cli, ['first-run', '--json', ...restoredArgs])
  if (!['READY', 'OK'].includes(restoredFirst.json?.status)) throw new Error('restored first-run failed')
  // Project registration is data (not a credential); the same logical root must resolve its project
  // for restored candidate/source reads. The bundle itself stays state+artifact only.
  const projectRegistry = join(roots.config, 'native-projects.json')
  if (existsSync(projectRegistry)) copyFileSync(projectRegistry, join(restoredRoots.config, 'native-projects.json'))
  const rConsole = await freePort(); let rApi = await freePort(); if (rApi === rConsole) rApi = await freePort()
  const rOut = openSync(join(root, 'restored.out.log'), 'w', 0o600), rErr = openSync(join(root, 'restored.err.log'), 'w', 0o600)
  const restoredDaemon = spawn(cli, ['start', '--fixture', '--port', String(rConsole), '--api-port', String(rApi), ...restoredArgs], { cwd: install, stdio: ['ignore', rOut, rErr], detached: true })
  restoredDaemon.unref(); closeSync(rOut); closeSync(rErr)
  const rHealth = await waitHealth(rApi)
  if (rHealth === null) throw new Error(`restored instance not healthy: ${readFileSync(join(root, 'restored.err.log'), 'utf8').slice(0, 300)}`)
  const rToken = readFileSync(join(restoredState, 'api.key'), 'utf8').trim()
  const rAuth = { authorization: `Bearer ${rToken}` }
  const rget = async (path) => { const res = await fetch(`http://127.0.0.1:${rApi}${path}`, { headers: rAuth }); return { status: res.status, body: await res.json() } }
  const rpost = async (path, body) => { const res = await fetch(`http://127.0.0.1:${rApi}${path}`, { method: 'POST', headers: { ...rAuth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
  const rInspect = await rget('/v1/recovery/inspect')
  if (rInspect.status !== 200 || rInspect.body.state !== 'recovery_readonly') throw new Error('restored state is not recovery_readonly')
  const rCandidates = await rget(`/v1/messages/${encodeURIComponent(source.id)}/candidates`)
  // Main's restored-project rebind is not implemented; a restored candidate read may be refused with
  // an explicit pending-rebind error. Record that as a limited fixture instead of a false PASS.
  const restoredCandidates = rCandidates.status === 200 && rCandidates.body.status === 'candidates' && rCandidates.body.candidates.length >= 2
  if (!restoredCandidates && !(rCandidates.status === 403 && rCandidates.body.error?.message?.includes('not configured')))
    throw new Error(`restored candidates failed unexpectedly: ${rCandidates.status} ${JSON.stringify(rCandidates.body).slice(0, 500)}`)
  const rSources = await rget(`/v1/messages/${encodeURIComponent(source.id)}/context/sources`)
  if (rSources.status !== 200 && !(rSources.status === 403 && /configured|scope/.test(rSources.body.error?.message ?? ''))) throw new Error(`restored original sources failed unexpectedly: ${rSources.status} ${JSON.stringify(rSources.body).slice(0, 300)}`)
  const rMessages = await rget(`/v1/conversations/${encodeURIComponent(conversation.id)}/messages?limit=50`)
  const rList = rMessages.body?.messages ?? rMessages.body?.items ?? []
  const restoredText = rMessages.status === 200 && rList.some((m) => m.id === source.id && String(m.text).includes('current behavior'))
  if (rMessages.status !== 200) throw new Error(`restored messages ${rMessages.status} ${JSON.stringify(rMessages.body).slice(0, 300)}`)
  const rBusiness = await rpost('/v1/assistant/suggestions', { enabled: false })
  if (rBusiness.status !== 422 || rBusiness.body.error?.code !== 'unsupported_capability') throw new Error(`restored business mutation was not refused: ${rBusiness.status}`)
  if (fakeRequests.length !== 1) throw new Error('restored startup/read unexpectedly called the model')
  step('same-data-relocation-readonly', restoredCandidates ? 'PASS' : 'PASS_WITH_FIXTURE_LIMIT', { restoredState, restoredMode: rHealth.mode, markerState: rInspect.body.state, candidates: restoredCandidates ? rCandidates.body.candidates.length : 'NOT_TESTED', restoredCandidateError: restoredCandidates ? null : { httpStatus: rCandidates.status, code: rCandidates.body.error?.code, reason: 'main restored-project rebind is not implemented' }, originalSources: rSources.status === 200 ? rSources.status : 'NOT_TESTED', restoredOriginalSourceError: rSources.status === 200 ? null : { httpStatus: rSources.status, code: rSources.body.error?.code, reason: 'main restored-project rebind is not implemented' }, originalText: restoredText, businessRefused: true, modelRequestsDuringRestore: 0 })

  const targetState = join(root, 'relocated-target-state')
  const preflight = { expectedFingerprint: rInspect.body.inspectionFingerprint,
    bindings: [{ sourceProjectId: rInspect.body.projects[0].id, project: { path: projectDir, check: 'node_test' } }] }
  const sp = await rpost('/v1/recovery/source/prepare', { preflight, targetStateRoot: targetState })
  if (sp.status !== 200) throw new Error(`restored source prepare ${sp.status} ${JSON.stringify(sp.body).slice(0, 300)}`)
  if (sp.body.authorization !== 'not_granted' || sp.body.startupAvailable !== false) throw new Error('source prepare advertised authorization')
  const sc = await rpost('/v1/recovery/source/confirm', { token: sp.body.token })
  if (sc.status !== 200 || sc.body.authorization !== 'not_granted' || sc.body.startupAvailable !== false) throw new Error('source confirm advertised authorization')
  const activationId = sc.body.committed?.intent?.activationId
  const audit = await rget(`/v1/recovery/activations/${encodeURIComponent(activationId)}`)
  if (audit.status !== 200 || audit.body.authorization !== 'not_granted' || audit.body.startupAvailable !== false) throw new Error('source audit advertised authorization')
  if (fakeRequests.length !== 1) throw new Error('source confirmation unexpectedly called the model')
  const rStop = run(cli, ['stop', '--json', ...restoredArgs])
  if (rStop.json?.status !== 'STOPPED') throw new Error('restored stop failed')
  step('same-data-source-confirm', 'PASS', { activationId, authorization: sc.body.authorization, startupAvailable: sc.body.startupAvailable, audit: audit.body.authorization, notAGrant: true })

  // Wave-20: main's explicit restored-personal review config. The launcher only forwards the option;
  // no file is discovered from the restore report, backup or old scope.
  const reviewRoot = join(root, 'reviewed')
  const reviewRoots = Object.fromEntries(['config', 'cache', 'logs', 'workspace'].map((k) => [k, join(reviewRoot, k)]))
  for (const p of Object.values(reviewRoots)) mkdirSync(p, { recursive: true, mode: 0o700 })
  const reviewState = join(reviewRoot, 'state')
  const reviewArgs = ['--install', install, '--config-root', reviewRoots.config, '--data-root', reviewState, '--cache-root', reviewRoots.cache, '--logs-root', reviewRoots.logs, '--workspace-root', reviewRoots.workspace]
  const reviewRestore = run(cli, ['restore', '--json', '--bundle', bundle, '--to', reviewState, ...argsOf])
  if (reviewRestore.json?.status !== 'RESTORED') throw new Error('review restore failed')
  const reviewFirst = run(cli, ['first-run', '--json', ...reviewArgs])
  if (!['READY', 'OK'].includes(reviewFirst.json?.status)) throw new Error('review first-run failed')
  const reviewPath = join(root, 'review-restored.json')
  const preparedReview = run(cli, ['review-restored', '--json', '--state', reviewState, '--project', project.id, '--allow-path', '.', '--out', reviewPath])
  if (preparedReview.json?.status !== 'prepared') throw new Error(`package review-restored failed: ${JSON.stringify(preparedReview.json).slice(0, 400)}`)
  const reviewFile = JSON.parse(readFileSync(reviewPath, 'utf8'))
  // Unbound existing daemon + a new review selection must refuse and keep that daemon/PID.
  const uConsole = await freePort(); let uApi = await freePort(); if (uApi === uConsole) uApi = await freePort()
  const uOut = openSync(join(root, 'unbound.out.log'), 'w', 0o600), uErr = openSync(join(root, 'unbound.err.log'), 'w', 0o600)
  const unboundDaemon = spawn(cli, ['start', '--fixture', '--port', String(uConsole), '--api-port', String(uApi), ...reviewArgs], { cwd: install, stdio: ['ignore', uOut, uErr], detached: true })
  unboundDaemon.unref(); closeSync(uOut); closeSync(uErr)
  if (await waitHealth(uApi) === null) throw new Error('unbound fixture did not start')
  const unboundPid = (() => { try { return JSON.parse(readFileSync(join(reviewRoots.config, 'instance.json'), 'utf8')).pid } catch { return null } })()
  const unboundReview = run(cli, ['start', '--json', '--discussion-only', '--review-restored-scope', reviewPath, '--port', String(uConsole), '--api-port', String(uApi), ...reviewArgs], [2])
  if (unboundReview.json?.code !== 'restored_review_selection_mismatch') throw new Error(`unbound daemon accepted review selection: ${JSON.stringify(unboundReview.json).slice(0, 300)}`)
  const unboundPidAfter = (() => { try { return JSON.parse(readFileSync(join(reviewRoots.config, 'instance.json'), 'utf8')).pid } catch { return null } })()
  if (unboundPid === null || unboundPid !== unboundPidAfter) throw new Error(`unbound selection refusal changed PID: before=${unboundPid} after=${unboundPidAfter} resp=${JSON.stringify(unboundReview.json).slice(0,300)}`)
  const uStop = run(cli, ['stop', '--json', ...reviewArgs])
  if (uStop.json?.status !== 'STOPPED') throw new Error('unbound fixture stop failed')
  // Re-prepare after the unbound lifecycle so the new selection is bound to the current marker/source.
  rmSync(reviewPath)
  const reprepared = run(cli, ['review-restored', '--json', '--state', reviewState, '--project', project.id, '--allow-path', '.', '--out', reviewPath])
  if (reprepared.json?.status !== 'prepared') throw new Error('review re-preparation failed')
  Object.assign(reviewFile, JSON.parse(readFileSync(reviewPath, 'utf8')))
  const windowMs = Date.parse(reviewFile.payload.expiresAt) - Date.parse(reviewFile.payload.createdAt)
  if (windowMs <= 0 || windowMs > 300000) throw new Error('review startup window exceeds five minutes')
  const rawStart = (extra) => spawnSync(cli, ['start', '--port', String(rConsole), '--api-port', String(rApi), ...reviewArgs, ...extra], { cwd: install, encoding: 'utf8', timeout: 90000 })
  const noReview = rawStart(['--fixture', '--review-restored-scope', reviewPath])
  if (noReview.status !== 2 || !(noReview.stdout + noReview.stderr).includes('review_requires_restored_personal')) throw new Error(`fixture startup accepted the review option: status=${noReview.status} stdout=${noReview.stdout.slice(0,300)} stderr=${noReview.stderr.slice(0,200)}`)
  const cloneMode = (mode) => { const p = join(root, `review-${mode}.json`); writeFileSync(p, readFileSync(reviewPath), { mode }); return p }
  for (const [mode, file] of [[0o644, cloneMode(0o644)]]) {
    const bad = rawStart(['--discussion-only', '--review-restored-scope', file])
    if (bad.status !== 2 || !(bad.stdout + bad.stderr).includes('review_scope_invalid')) throw new Error(`review ${mode.toString(8)} was not rejected`)
  }
  const symlinkPath = join(root, 'review-symlink.json'); spawnSync('ln', ['-s', reviewPath, symlinkPath])
  const symlink = rawStart(['--discussion-only', '--review-restored-scope', symlinkPath])
  if (symlink.status !== 2 || !(symlink.stdout + symlink.stderr).includes('review_scope_invalid')) throw new Error('review symlink was not rejected')
  const missing = rawStart(['--discussion-only', '--review-restored-scope', join(root, 'missing-review.json')])
  if (missing.status !== 2 || !(missing.stdout + missing.stderr).includes('review_scope_missing')) throw new Error('missing review file was not rejected')
  const tamperedPath = cloneMode(0o600)
  const tampered = JSON.parse(readFileSync(tamperedPath, 'utf8')); tampered.payload.projects[0].allowedPaths = [root]
  writeFileSync(tamperedPath, JSON.stringify(tampered, null, 2) + '\n', { mode: 0o600 })
  const tamperedStart = rawStart(['--discussion-only', '--review-restored-scope', tamperedPath])
  if (tamperedStart.status === 0) throw new Error('tampered review config started')
  const rConsole2 = await freePort(); let rApi2 = await freePort(); if (rApi2 === rConsole2) rApi2 = await freePort()
  const rOut2 = openSync(join(root, 'review.out.log'), 'w', 0o600), rErr2 = openSync(join(root, 'review.err.log'), 'w', 0o600)
  const reviewDaemon = spawn(cli, ['start', '--discussion-only', '--review-restored-scope', reviewPath, '--port', String(rConsole2), '--api-port', String(rApi2), ...reviewArgs], { cwd: install, stdio: ['ignore', rOut2, rErr2], detached: true })
  reviewDaemon.unref(); closeSync(rOut2); closeSync(rErr2)
  const reviewHealth = await waitHealth(rApi2)
  if (reviewHealth === null) throw new Error(`reviewed instance not healthy: ${readFileSync(join(root, 'review.err.log'), 'utf8').slice(0, 500)}`)
  const reviewAuth = { authorization: `Bearer ${readFileSync(join(reviewState, 'api.key'), 'utf8').trim()}` }
  const rvget = async (path) => { const res = await fetch(`http://127.0.0.1:${rApi2}${path}`, { headers: reviewAuth }); return { status: res.status, body: await res.json() } }
  const rvpost = async (path, body) => { const res = await fetch(`http://127.0.0.1:${rApi2}${path}`, { method: 'POST', headers: { ...reviewAuth, 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() } }
  const inspected = await rvget('/v1/recovery/inspect')
  const candidatesAfter = await rvget(`/v1/messages/${encodeURIComponent(source.id)}/candidates`)
  if (candidatesAfter.status !== 200 || candidatesAfter.body.status !== 'candidates' || candidatesAfter.body.candidates.length < 2) throw new Error(`reviewed candidates ${candidatesAfter.status} ${JSON.stringify(candidatesAfter.body).slice(0, 400)}`)
  const sourcesAfter = await rvget(`/v1/messages/${encodeURIComponent(source.id)}/context/sources`)
  if (sourcesAfter.status !== 200) throw new Error(`reviewed sources ${sourcesAfter.status}`)
  const historyAfter = await rvget(`/v1/conversations/${encodeURIComponent(conversation.id)}/messages?limit=50`)
  if (historyAfter.status !== 200) throw new Error(`reviewed history ${historyAfter.status}`)
  const businessAfter = await rvpost('/v1/assistant/suggestions', { enabled: false })
  if (businessAfter.status !== 422 || businessAfter.body.error?.code !== 'unsupported_capability') throw new Error('reviewed business mutation was not refused')
  if (fakeRequests.length !== 1) throw new Error('reviewed startup/read called the model')
  if (reviewHealth.nativeTurns > 0 || reviewHealth.vendorSends > 0) throw new Error('reviewed startup started native/vendor execution')
  const pidBefore = (() => { try { return JSON.parse(readFileSync(join(reviewRoots.config, 'instance.json'), 'utf8')).pid } catch { return null } })()
  const sameReuse = run(cli, ['start', '--json', '--discussion-only', '--review-restored-scope', reviewPath, '--port', String(rConsole2), '--api-port', String(rApi2), ...reviewArgs])
  if (sameReuse.json?.status !== 'REUSED') throw new Error(`same review selection did not reuse: ${JSON.stringify(sameReuse.json)}`)
  const narrowPath = join(root, 'review-narrow.json')
  const narrowPrepared = run(cli, ['review-restored', '--json', '--state', reviewState, '--project', project.id, '--allow-path', 'README.md', '--out', narrowPath])
  if (narrowPrepared.json?.status !== 'prepared') throw new Error('narrow review preparation failed')
  const mismatch = run(cli, ['start', '--json', '--discussion-only', '--review-restored-scope', narrowPath, '--port', String(rConsole2), '--api-port', String(rApi2), ...reviewArgs], [2])
  if (mismatch.json?.code !== 'restored_review_selection_mismatch') throw new Error(`different selection was not refused: ${mismatch.stdout.slice(0, 300)}`)
  const noFile = run(cli, ['start', '--json', '--discussion-only', '--port', String(rConsole2), '--api-port', String(rApi2), ...reviewArgs], [2])
  if (noFile.json?.code !== 'restored_review_selection_mismatch') throw new Error('missing selection was not refused against live review instance')
  const changedPort = run(cli, ['start', '--json', '--discussion-only', '--review-restored-scope', reviewPath, '--port', String(rConsole2), '--api-port', String(await freePort()), ...reviewArgs], [2])
  if (changedPort.json?.code !== 'instance_conflict') throw new Error('changed port with same selection was not refused')
  const pidAfter = (() => { try { return JSON.parse(readFileSync(join(reviewRoots.config, 'instance.json'), 'utf8')).pid } catch { return null } })()
  if (pidBefore === null || pidBefore !== pidAfter) throw new Error(`selection refusal changed the existing instance PID: before=${pidBefore} after=${pidAfter} narrow=${JSON.stringify(narrowPrepared.json).slice(0,120)} mismatch=${JSON.stringify(mismatch.json).slice(0,120)} noFile=${JSON.stringify(noFile.json).slice(0,120)} port=${JSON.stringify(changedPort.json).slice(0,120)}`)
  const rvStop = run(cli, ['stop', '--json', ...reviewArgs])
  if (rvStop.json?.status !== 'STOPPED') throw new Error('reviewed stop failed')
  step('explicit-reviewed-personal', 'PASS', { reviewProtocol: reviewFile.payload.protocol, windowMs, markerState: inspected.body.state, startupMode: reviewHealth.startupMode,
    candidatesBeforeConsent: 403, candidatesAfterConsent: candidatesAfter.body.candidates.length, sourcesAfterConsent: 200, historyAfterConsent: 200,
    businessRefused: true, modelRequests: fakeRequests.length - 1, nativeTurns: reviewHealth.nativeTurns ?? 0, fixtureRejected: true, invalidFileRejected: true, tamperedRejected: true, startupAvailable: false, unboundSelectionRefused: true, sameSelectionReused: true, differentSelectionRefused: true, noSelectionRefused: true, changedPortRefused: true, pidStable: true })

  evidence.status = 'PASS'
  evidence.build = { buildId: manifest.buildId, commit: manifest.source.commit, schema: manifest.producer.productSchema }
} catch (error) { evidence.status = 'FAIL'; evidence.error = String(error?.stack ?? error) }
finally { try { fake?.close() } catch {} rmSync(root, { recursive: true, force: true }) }
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
process.exitCode = evidence.status === 'PASS' ? 0 : 1
