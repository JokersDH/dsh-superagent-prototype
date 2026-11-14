import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'

/**
 * Second-root and source-confirmation acceptance on the *installed* frozen package.
 *
 * The instance is built only from the tar named by `install-artifact.json`, seeded through the
 * package's own HTTP entry, backed up/restored by the package's own launcher, and then started in
 * main's `recovery_readonly` composition. Every assertion is about bytes in that package: a source
 * fixture result cannot stand in for it.
 */
const sha = value => createHash('sha256').update(value).digest('hex')
const stripUndefined = value => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))

function freePort() {
  return new Promise(resolvePort => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolvePort(port))
    })
  })
}

function launcher(install, args, { env = {}, timeoutMs = 60_000 } = {}) {
  const result = spawnSync(join(install, 'bin/pa'), args, {
    cwd: join(install, '..'), encoding: 'utf8', timeout: timeoutMs,
    env: stripUndefined({ ...process.env, PA_NODE: process.execPath, PA_CONFIG_ROOT: undefined, PA_DATA_ROOT: undefined, ...env }),
  })
  let json
  const text = String(result.stdout).trim()
  try { json = JSON.parse(text) } catch {
    try { json = JSON.parse(text.split('\n').filter(Boolean).at(-1)) } catch { json = undefined }
  }
  return { status: result.status, json, stdout: String(result.stdout).slice(-400), stderr: String(result.stderr).slice(-400) }
}

function start(install, { port, apiPort, env = {} }) {
  const child = spawn(join(install, 'bin/pa'), ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort)], {
    cwd: join(install, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: stripUndefined({ ...process.env, PA_NODE: process.execPath, PA_CONFIG_ROOT: undefined, PA_DATA_ROOT: undefined, ...env }),
  })
  let buffer = '', stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const attempt = new Promise(resolveAttempt => {
    const finish = value => resolveAttempt({ ...value, child })
    child.once('error', error => finish({ status: 'BLOCKED', code: 'spawn_failed', detail: error.message }))
    child.stdout.on('data', chunk => {
      buffer += chunk
      const line = buffer.split('\n').find(item => item.trim().startsWith('{'))
      if (line === undefined) return
      try {
        const value = JSON.parse(line)
        finish({ status: value.status, instance: value.instance, code: value.code, detail: value.detail })
      } catch { /* buffering */ }
    })
    child.once('exit', code => {
      let final
      try { final = JSON.parse(buffer.trim().split('\n').filter(Boolean).at(-1)) } catch { final = undefined }
      finish({ status: final?.status ?? (code === 0 ? 'EXITED' : 'BLOCKED'), instance: final?.instance, code: final?.code, exitCode: code })
    })
  })
  return { child, attempt, stderr: () => stderr }
}

function killOwned(install) {
  const recordPath = join(install, 'var/config/instance.json')
  if (!existsSync(recordPath)) return
  try {
    const record = JSON.parse(readFileSync(recordPath, 'utf8'))
    for (const pid of [record.pid, record.apiPid]) {
      if (!Number.isSafeInteger(pid)) continue
      try {
        const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
        if (command.includes(install)) process.kill(pid, 'SIGKILL')
      } catch { /* gone */ }
    }
  } catch { /* no record */ }
}

/** Seeds ordinary chat, a delivered Work with an answered question, context, and one confirmed decision candidate. */
async function seed(client, { project, projectDir, conversationId }) {
  const projectId = project.id
  const work = await client.dispatch({
    commandId: `w18-seed-work-${Date.now()}`, conversationId, kind: 'create_work', projectId,
    // The question profile exercises the real Broker question/answer path, not only a passing work.
    profileId: project.profileIds.includes('profile-fixture-question') ? 'profile-fixture-question'
      : (project.profileIds.find(id => id.endsWith('-pass')) ?? project.defaultProfileId),
    goal: '第十八轮安装物：生成并接受一个受控候选，作为第二根恢复的真实数据。',
    scope: project.scope, criteria: project.defaultCriteria.filter(item => item.required),
  })
  const workId = work.receipt.workId
  let view, answered = 0
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    view = await client.work(workId)
    if (view.actions.available.includes('accept_candidate') || ['delivered', 'ended', 'uncertain'].includes(view.phase)) break
    if ((view.openQuestionIds ?? []).length > 0) {
      const snapshot = await client.snapshot({ workId })
      const question = snapshot.questions[0]
      const choice = question?.presentation?.options?.[0]?.id
      if (question && choice) {
        await client.dispatch({ commandId: `w18-seed-answer-${++answered}`, conversationId, kind: 'answer_question',
          questionId: question.id, expectedVersion: question.version, answer: { kind: 'choices', optionIds: [choice] } })
      }
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
  }
  if (view.actions.available.includes('accept_candidate')) {
    await client.dispatch({ commandId: `w18-seed-accept-${Date.now()}`, conversationId, kind: 'accept_candidate', candidate: view.actions.currentCandidate })
    const deliveredBy = Date.now() + 20_000
    while (Date.now() < deliveredBy) {
      const next = await client.work(workId)
      if (['delivered', 'ended', 'uncertain'].includes(next.phase)) { view = next; break }
      await new Promise(resolveDelay => setTimeout(resolveDelay, 200))
    }
  }
  const text = '第十八轮第二根原始上下文消息。'
  const prepared = await client.request('/v1/assistant/context/prepare', { method: 'POST', body: {
    commandId: 'w18-seed-context', text, context: { projectId, conversationId,
      selections: ['project', 'conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 4096 } } } })
  if (prepared.status !== 200) return { workId, view, answered, prepared: prepared.status }
  const sent = await client.request('/v1/assistant/context/send', { method: 'POST', body: { commandId: 'w18-seed-context', token: prepared.body.token } })
  let page, user, reply
  for (let index = 0; index < 120; index += 1) {
    page = await client.conversation(conversationId)
    user = page.messages.find(item => item.role === 'user' && item.text === text)
    const at = user ? page.messages.indexOf(user) : -1
    if (at >= 0) {
      reply = page.messages.slice(at + 1).find(item => item.provenance === 'reasoner_reply')
      if (reply) break
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 150))
  }
  let candidate = { status: null, confirm: null, count: 0 }
  if (user) {
    const list = await client.request(`/v1/messages/${user.id}/candidates`)
    candidate.status = list.body?.status ?? null
    candidate.count = list.body?.candidates?.length ?? 0
    const decision = (list.body?.candidates ?? []).find(item => item.kind === 'propose_decision')
    if (decision) {
      const preview = await client.request('/v1/assistant/candidates/prepare', { method: 'POST',
        body: { messageId: user.id, index: decision.index, payloadDigest: decision.payloadDigest } })
      if (preview.status === 200) {
        const confirmed = await client.request('/v1/proposals/commands', { method: 'POST', body: {
          kind: 'confirm_proposal', commandId: 'w18-seed-decision', projectId, conversationId, token: preview.body.token } })
        candidate.confirm = confirmed.body?.status ?? null
      }
      candidate.prepare = preview.status
    }
  }
  return { workId, view, answered, user, reply, candidate, text, prepared: prepared.status, send: sent.status, sentStatus: sent.body?.status ?? null }
}

async function provision(target) {
  const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w18-recovery-')))
  const install = join(own, 'install'), projectDir = join(own, 'project')
  mkdirSync(install, { recursive: true }); mkdirSync(projectDir, { recursive: true })
  const git = args => execFileSync('git', args, { cwd: projectDir, stdio: 'pipe' })
  writeFileSync(join(projectDir, 'index.mjs'), 'export const ok = true\n')
  git(['init', '-q']); git(['add', 'index.mjs'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'W18 second root source'])
  const mock = await candidateModel({ reply: context => ({ text: '已整理为一项决定。', suggestions: [
    { kind: 'propose_decision', content: '第二根保留原始错误码。', scope: context.scope, sourceMessageId: context.sourceMessageId },
  ] }) })
  let firstStarted, restoredStarted
  try {
    spawnSync('tar', ['-xzf', target.tarPath, '-C', install, '--strip-components=1'])
    const firstRun = launcher(install, ['first-run', '--json'], { env: { PA_MODEL_CONFIG: mock.file } })
    if (firstRun.status !== 0) throw new Error(`first-run ${firstRun.status}: ${firstRun.stderr}`)
    const [port, apiPort] = [await freePort(), await freePort()]
    firstStarted = start(install, { port, apiPort, env: { PA_MODEL_CONFIG: mock.file } })
    const running = await firstStarted.attempt
    if (running.status !== 'RUNNING' || !running.instance?.apiURL) throw new Error(`first start ${running.status}/${running.code ?? 'none'}`)
    const state = running.instance.state
    const client = new LocalProductClient({ baseURL: running.instance.apiURL, stateDir: state, timeoutMs: 25_000 })
    const configuration = await client.configuration()
    const project = configuration.projects.find(item => item.dispatchAllowed) ?? configuration.projects[0]
    const original = await seed(client, { project, projectDir, conversationId: 'conv-w18' })
    if (original.candidate?.confirm !== 'recorded') throw new Error(`candidate confirm ${original.candidate?.confirm} (status ${original.candidate?.status})`)
    const modelRequestsAfterSeed = mock.requests.length
    const stop = launcher(install, ['stop', '--json'], { env: { PA_MODEL_CONFIG: mock.file }, timeoutMs: 30_000 })
    const bundle = join(own, 'w18-rich.pab')
    const backup = launcher(install, ['backup', '--out', bundle, '--json'], { env: { PA_MODEL_CONFIG: mock.file }, timeoutMs: 90_000 })
    if (backup.status !== 0 || backup.json?.status !== 'CREATED') throw new Error(`backup ${backup.status}: ${backup.stderr}`)
    const verify = launcher(install, ['verify-backup', '--bundle', bundle, '--json'], { timeoutMs: 90_000 })
    const restoredRoot = join(own, 'restored-root')
    const restore = launcher(install, ['restore', '--bundle', bundle, '--to', restoredRoot, '--json'], { timeoutMs: 90_000 })
    if (restore.status !== 0 || restore.json?.status !== 'RESTORED') throw new Error(`restore ${restore.status}: ${restore.stderr}`)
    const marker = join(restoredRoot, 'restore-report.json')
    const format = await packagedFormatEvidence(install, restoredRoot, marker, own)
    const beforeDb = snapshotDb(join(restoredRoot, 'state.sqlite'))
    const [rp, rap] = [await freePort(), await freePort()]
    restoredStarted = start(install, { port: rp, apiPort: rap, env: { PA_DATA_ROOT: restoredRoot, PA_MODEL_CONFIG: mock.file } })
    const readOnly = await restoredStarted.attempt
    if (readOnly.status !== 'RUNNING' || readOnly.instance?.startupMode !== 'recovery_readonly')
      throw new Error(`restored start ${readOnly.status}/${readOnly.instance?.startupMode ?? 'none'}/${readOnly.code ?? 'none'}`)
    const ro = new LocalProductClient({ baseURL: readOnly.instance.apiURL, stateDir: restoredRoot, timeoutMs: 20_000 })
    const roConfiguration = await ro.configuration()
    const page = await ro.conversation('conv-w18')
    const originalMessage = page.messages.find(item => item.role === 'user' && item.text === original.text)
    const replyMessage = page.messages.find(item => item.provenance === 'reasoner_reply')
    const work = await ro.work(original.workId)
    const workSnapshot = await ro.snapshot({ workId: original.workId })
    const audit = originalMessage ? await ro.request(`/v1/messages/${originalMessage.id}/context`) : { status: 0, body: null }
    const history = await ro.request(`/v1/context/history?projectId=${encodeURIComponent(project.id)}&conversationId=conv-w18&limit=5`)
    const sources = originalMessage ? await ro.request(`/v1/messages/${originalMessage.id}/context/sources`) : { status: 0, body: null }
    const candidates = originalMessage ? await ro.request(`/v1/messages/${originalMessage.id}/candidates`) : { status: 0, body: null }
    const business = await ro.request('/v1/conversations/commands', { method: 'POST', body: {
      commandId: `w18-readonly-${Date.now()}`, conversationId: 'conv-w18', kind: 'chat', text: '恢复只读期间不应执行' } })
      .catch(error => ({ status: error.status, body: error.body }))
    const modelRequestsAfterReads = mock.requests.length
    const inspection = await ro.request('/v1/recovery/inspect')
    const fingerprint = inspection.body?.inspectionFingerprint ?? inspection.body?.fingerprint ?? null
    const targetRoot = join(own, 'source-target')
    const prepare = await ro.request('/v1/recovery/source/prepare', { method: 'POST', body: {
      preflight: { expectedFingerprint: fingerprint, bindings: [{ sourceProjectId: roConfiguration.projects[0].id,
        project: { path: projectDir, check: 'node_test' } }] }, targetStateRoot: targetRoot } })
    const targetCreated = existsSync(targetRoot)
    const queueBefore = snapshotDb(join(restoredRoot, 'state.sqlite')).effectRows
    const markerBefore = readFileSync(marker)
    const confirm = prepare.status === 200 ? await ro.request('/v1/recovery/source/confirm', { method: 'POST', body: { token: prepare.body.token } }) : { status: 0 }
    const activationId = confirm.body?.committed?.intent?.activationId ?? confirm.body?.intent?.activationId ?? null
    const auditActivation = activationId ? await ro.request(`/v1/recovery/activations/${activationId}`) : { status: 0, body: null }
    const queueAfter = snapshotDb(join(restoredRoot, 'state.sqlite')).effectRows
    const markerAfter = readFileSync(marker)
    const replay = prepare.status === 200 ? await ro.request('/v1/recovery/source/confirm', { method: 'POST', body: { token: prepare.body.token } }) : { status: 0 }
    const concurrent = await Promise.all([...Array(4)].map(() => ro.request('/v1/conversations/conv-w18')))
    const repeated = []
    for (let index = 0; index < 2; index += 1)
      repeated.push(await ro.request('/v1/recovery/source/confirm', { method: 'POST', body: { token: prepare.body?.token } }))
    const afterDb = snapshotDb(join(restoredRoot, 'state.sqlite'))
    const stress = {
      concurrent: concurrent.map(item => item.status),
      repeatedEqual: repeated.every(item => JSON.stringify(item.body) === JSON.stringify(confirm.body)),
      queueReturned: JSON.stringify(snapshotDb(join(restoredRoot, 'state.sqlite')).effectRows) === JSON.stringify(queueBefore),
      providerUnchanged: mock.requests.length === modelRequestsAfterReads,
      countsStable: afterDb.bindings === beforeDb.bindings && afterDb.results === beforeDb.results && afterDb.messages === beforeDb.messages,
    }
    launcher(install, ['stop', '--json'], { env: { PA_DATA_ROOT: restoredRoot, PA_MODEL_CONFIG: mock.file }, timeoutMs: 25_000 })
    // Original token across a process reopen: same receipt, no re-preflight and no new authorization.
    const [rp2, rap2] = [await freePort(), await freePort()]
    const reopened = start(install, { port: rp2, apiPort: rap2, env: { PA_DATA_ROOT: restoredRoot, PA_MODEL_CONFIG: mock.file } })
    const reopenedRun = await reopened.attempt
    let reopenedReplay = { status: 0, body: null }
    if (reopenedRun.status === 'RUNNING') {
      const client2 = new LocalProductClient({ baseURL: reopenedRun.instance.apiURL, stateDir: restoredRoot, timeoutMs: 20_000 })
      reopenedReplay = await client2.request('/v1/recovery/source/confirm', { method: 'POST', body: { token: prepare.body?.token } })
      launcher(install, ['stop', '--json'], { env: { PA_DATA_ROOT: restoredRoot, PA_MODEL_CONFIG: mock.file }, timeoutMs: 25_000 })
    }
    return {
      install, own, marker, bundle, target, state, restoredRoot, format,
      firstRun: firstRun.json?.status ?? null, stop: stop.json?.status ?? null,
      backup: { status: backup.json?.status, counts: backup.json?.counts, sha256: backup.json?.archiveSha256, bytes: existsSync(bundle) ? readFileSync(bundle).length : 0 },
      verify: verify.json?.status ?? null, restore: restore.json?.status ?? null,
      startupMode: readOnly.instance?.startupMode ?? null, health: readOnly.instance ? 'RUNNING' : null,
      original, beforeDb, afterDb,
      readOnly: {
        originalBodyEqual: originalMessage?.text === original.text,
        messages: page.messages.length,
        reply: replyMessage?.text ?? null,
        workPhase: work?.phase ?? null, workArtifacts: work?.artifactIds?.length ?? 0,
        questionsVisible: workSnapshot?.questions?.length ?? 0,
        audit: audit.status, auditBindings: audit.body?.bindings?.length ?? null,
        history: history.status, historyRows: history.body?.entries?.length ?? history.body?.history?.length ?? null,
        sources: sources.status, sourceRows: sources.body?.sources?.length ?? null,
        candidates: candidates.status, candidateStatus: candidates.body?.status ?? null, candidateCount: candidates.body?.candidates?.length ?? 0,
        business: business.status, businessCode: business.body?.error?.code ?? business.body?.code ?? null,
        modelRequestsBefore: modelRequestsAfterSeed, modelRequestsAfter: modelRequestsAfterReads,
        effectRows: queueAfter.length, effectRowsBefore: queueBefore.length,
      },
      stress,
      source: {
        inspection: inspection.status, fingerprint: !!fingerprint,
        prepare: prepare.status, authorization: prepare.body?.authorization ?? null, startupAvailable: prepare.body?.startupAvailable ?? null,
        targetCreated, confirm: confirm.status, activationId,
        audit: auditActivation.status, auditEqual: JSON.stringify(auditActivation.body) === JSON.stringify(confirm.body),
        queueHeld: JSON.stringify(queueBefore) === JSON.stringify(queueAfter),
        markerUnchanged: Buffer.compare(markerBefore, markerAfter) === 0,
        replay: replay.status, replayEqual: JSON.stringify(replay.body) === JSON.stringify(confirm.body),
        reopened: reopenedRun.status, reopenedReplay: reopenedReplay.status, reopenedEqual: JSON.stringify(reopenedReplay.body) === JSON.stringify(confirm.body),
      },
      modelRequests: mock.requests.length,
    }
  } finally {
    try { killOwned(install) } catch { /* best effort */ }
    try { if (firstStarted) launcher(install, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
    try { if (restoredStarted) launcher(install, ['stop', '--json'], { env: { PA_DATA_ROOT: join(own, 'restored-root') }, timeoutMs: 20_000 }) } catch { /* best effort */ }
    try { firstStarted?.child?.kill('SIGKILL') } catch { /* gone */ }
    try { restoredStarted?.child?.kill('SIGKILL') } catch { /* gone */ }
    await mock.close().catch(() => {})
    rmSync(own, { recursive: true, force: true })
  }
}


/**
 * Reads the snapshot/evidence support of the frozen package itself. The package's own dist and
 * source bytes decide which workflow format exists; a later main source tree cannot lend v2 to it.
 */
async function packagedFormatEvidence(install, restoredRoot, marker, workRoot) {
  const read = relative => readFileSync(join(install, 'app', relative), 'utf8')
  const snapshotSource = read('packages/workflows/src/snapshot.ts')
  const backupSource = read('packages/storage/src/backup.ts')
  const storage = await import(pathToFileURL(join(install, 'app/packages/storage/dist/index.js')).href)
  const workflows = await import(pathToFileURL(join(install, 'app/packages/workflows/dist/index.js')).href)
  const work = mkdtempSync(join(workRoot, 'format-'))
  const dbPath = join(work, 'state.sqlite')
  copyFileSync(join(restoredRoot, 'state.sqlite'), dbPath)
  for (const suffix of ['-wal', '-shm']) {
    if (existsSync(join(restoredRoot, `state.sqlite${suffix}`))) copyFileSync(join(restoredRoot, `state.sqlite${suffix}`), `${dbPath}${suffix}`)
  }
  if (existsSync(join(restoredRoot, 'artifacts'))) cpSync(join(restoredRoot, 'artifacts'), join(work, 'artifacts'), { recursive: true })
  const dbBefore = sha(readFileSync(dbPath))
  const supportsV2 = /formatVersion/u.test(snapshotSource) && /familySetVersion/u.test(backupSource)
  const format = { work }
  try {
    const store = new storage.ProductStore({ path: dbPath })
    try {
      const snaps = new workflows.WorkflowSnapshots(store)
      const v1 = await snaps.create({ destination: join(work, 'v1') })
      const v1Verify = snaps.verify(join(work, 'v1'))
      format.v1 = { status: v1.status, protocol: v1.manifest.protocol, evidenceProtocol: v1.manifest.evidence.protocol,
        families: v1.manifest.evidence.families.length, familySetVersion: v1.manifest.evidence.familySetVersion ?? null,
        verified: v1Verify.status, digest: v1.manifest.evidence.digest }
      if (supportsV2) {
        const v2 = await snaps.create({ destination: join(work, 'v2'), formatVersion: 2 })
        const v2Verify = snaps.verify(join(work, 'v2'))
        format.v2 = { status: v2.status, protocol: v2.manifest.protocol, evidenceProtocol: v2.manifest.evidence.protocol,
          families: v2.manifest.evidence.families.length, familySetVersion: v2.manifest.evidence.familySetVersion ?? null,
          verified: v2Verify.status, digest: v2.manifest.evidence.digest }
      } else {
        const legacy = storage.readWorkflowEvidence(dbPath, 2)
        format.v2 = { unsupported: true, protocol: legacy.protocol, families: legacy.families?.length ?? 0 }
      }
      let invalidError = null
      const invalidDir = join(work, 'invalid-3')
      try { await snaps.create({ destination: invalidDir, formatVersion: 3 }) } catch (error) { invalidError = String(error?.message ?? error).slice(0, 200) }
      format.invalid3 = { rejected: invalidError !== null, destinationCreated: existsSync(invalidDir), error: invalidError }
      format.dbUnchanged = sha(readFileSync(dbPath)) === dbBefore
      format.dbBytes = statSync(dbPath).size
    } finally { store.close() }
  } finally { rmSync(work, { recursive: true, force: true }) }
  const restoreProtocol = existsSync(marker) ? JSON.parse(readFileSync(marker, 'utf8')).protocol ?? null : null
  const installManifest = existsSync(join(install, 'install.json'))
    ? JSON.parse(readFileSync(join(install, 'install.json'), 'utf8')) : null
  const installProtocol = installManifest ? `${installManifest.format ?? 'unknown'}/${installManifest.formatVersion ?? '?'}` : null
  return {
    snapshotProtocols: [...new Set(snapshotSource.match(/workflow-snapshot\/\d/g) ?? [])].sort(),
    evidenceProtocols: [...new Set(backupSource.match(/workflow-evidence\/\d/g) ?? [])].sort(),
    hasFormatVersion: /formatVersion/u.test(snapshotSource),
    hasFamilySetVersion: /familySetVersion/u.test(backupSource),
    supportsV2,
    readSignature: (backupSource.match(/export function readWorkflowEvidence\([^)]*\)/) ?? [null])[0],
    ...format,
    portability: { installArtifact: installProtocol, restoreReport: restoreProtocol },
    packageCapabilities: { source: spec.sourceCommit, buildId: spec.buildId, tarSha256: spec.tarSha256,
      digestSupported: /restoredReviewDigest/u.test(read('apps/launcher/lib/start.mjs')) && /restoredReviewDigest/u.test(read('apps/coordinator/product/demo.ts')) },
  }
}

function snapshotDb(path) {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const count = table => {
      try { return Number(db.prepare(`SELECT count(*) AS c FROM ${table}`).get()?.c ?? 0) } catch { return null }
    }
    return {
      bindings: count('assistant_context_bindings'), results: count('assistant_reply_results'),
      messages: count('conversation_messages'), decisions: count('assistant_decision_versions'),
      works: count('works'), questions: count('user_questions'), artifacts: count('artifacts'),
      effectRows: (() => { try { return db.prepare('SELECT * FROM effect ORDER BY rowid').all().map(row => ({ ...row })) } catch { return [] } })(),
    }
  } finally { db.close() }
}

const define = (id, title) => ({ id, title, layer: LAYERS.INSTALLED, limitations: [
  'Second root and source confirmation executed only through the frozen install package on darwin/arm64 Node 24.21.x ABI 137.',
  'Loopback candidate mock; no vendor model/native send. Restored state is read-only with the original queues held.',
] })

export async function runInstalledRecovery() {
  const cases = []
  const target = loadFrozenArtifact('target', DEFAULT_FROZEN_DIRS.target)
  let observed, failure
  try { observed = await provision(target) } catch (error) { failure = String(error?.message ?? error).slice(0, 400) }

  cases.push(await runCase({ ...define('E7-SECOND-ROOT-READONLY', 'A non-empty installed snapshot restores to a second readonly root that reads candidates/context/history/work and rejects business writes without a provider resend'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('SECOND_ROOT_PROVISIONED', observed !== undefined, failure ?? 'no observation')
      if (!observed) return
      const { readOnly: r, beforeDb, afterDb } = observed
      assert('SECOND_ROOT_MARKER', observed.restore === 'RESTORED' && observed.verify === 'VERIFIED', JSON.stringify({ restore: observed.restore, verify: observed.verify }))
      assert('SECOND_ROOT_READONLY', observed.startupMode === 'recovery_readonly', String(observed.startupMode))
      assert('SECOND_ROOT_ORIGINAL_BODY', r.originalBodyEqual === true && r.messages >= 3, JSON.stringify({ equal: r.originalBodyEqual, messages: r.messages }))
      assert('SECOND_ROOT_WORK_HELD', r.workPhase === 'delivered' && r.workArtifacts >= 1, JSON.stringify({ phase: r.workPhase, artifacts: r.workArtifacts }))
      // The answered question is no longer open, so the open-question HTTP view is empty by design;
      // the Q&A rows themselves must be present in the restored store.
      assert('SECOND_ROOT_QA', (beforeDb.questions ?? 0) >= 1, JSON.stringify({ rows: beforeDb.questions, openVisible: r.questionsVisible }))
      assert('SECOND_ROOT_CANDIDATES', r.candidates === 200 && r.candidateStatus === 'candidates' && r.candidateCount >= 1, JSON.stringify({ status: r.candidates, value: r.candidateStatus, count: r.candidateCount }))
      assert('SECOND_ROOT_CONTEXT_READ', r.audit === 200 && r.history === 200 && r.sources === 200 && (r.historyRows ?? 0) >= 1, JSON.stringify({ audit: r.audit, history: r.history, sources: r.sources, rows: r.historyRows }))
      assert('SECOND_ROOT_BUSINESS_REJECTED', r.business === 422, JSON.stringify({ status: r.business, code: r.businessCode }))
      assert('SECOND_ROOT_QUEUES_HELD', r.effectRowsBefore === r.effectRows, JSON.stringify({ before: r.effectRowsBefore, after: r.effectRows }))
      assert('SECOND_ROOT_NO_RESEND', r.modelRequestsAfter === r.modelRequestsBefore, JSON.stringify({ before: r.modelRequestsBefore, after: r.modelRequestsAfter }))
      assert('SECOND_ROOT_DATA', beforeDb.bindings >= 1 && beforeDb.results >= 1 && afterDb.bindings === beforeDb.bindings &&
        afterDb.results === beforeDb.results && afterDb.messages === beforeDb.messages && afterDb.decisions === beforeDb.decisions,
        JSON.stringify({ before: { ...beforeDb, effectRows: beforeDb.effectRows.length }, after: { ...afterDb, effectRows: afterDb.effectRows.length } }))
      evidence.secondRoot = { subject: frozenArtifactSubject(target), mode: 'recovery_readonly',
        probeScope: 'fixture+recovery_readonly', personalRebinding: 'main_readonly_binding_entry_absent',
        businessData: { producer: 'installed fixture executor through the real App/Effects/queue',
          workPhase: observed.readOnly.workPhase, workArtifacts: observed.readOnly.workArtifacts,
          questionsAnswered: observed.original.answered, candidateConfirmed: observed.original.candidate?.confirm,
          nativeApplied: false,
          boundary: 'not B normal native producer; B normal Q&A/physical stop stays its own controlled scope' },
        bundle: observed.backup, verify: observed.verify, restore: observed.restore,
        before: { ...beforeDb, effectRows: beforeDb.effectRows.length }, after: { ...afterDb, effectRows: afterDb.effectRows.length }, readOnly: r,
        protocol: { producer: 'installed/1', note: 'the installed package produced and verified its own v1 bundle; A new-v2 cross-version import is a separate main/A scope' } }
    }))

  cases.push(await runCase({ ...define('E6-INSTALLED-SOURCE-CONFIRM', 'Source prepare/confirm/audit runs inside the same installed readonly package, records one fact and replays across a process reopen'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('INSTALLED_SOURCE_PROVISIONED', observed !== undefined, failure ?? 'no observation')
      if (!observed) return
      const s = observed.source
      assert('INSTALLED_SOURCE_PREPARE', s.prepare === 200 && s.authorization === 'not_granted' && s.startupAvailable === false, JSON.stringify({ status: s.prepare, authorization: s.authorization, startupAvailable: s.startupAvailable }))
      assert('INSTALLED_SOURCE_NO_TARGET', s.targetCreated === false, String(s.targetCreated))
      assert('INSTALLED_SOURCE_CONFIRM', s.confirm === 200 && typeof s.activationId === 'string', JSON.stringify({ status: s.confirm, activationId: s.activationId }))
      assert('INSTALLED_SOURCE_AUDIT', s.audit === 200 && s.auditEqual === true, JSON.stringify({ status: s.audit, equal: s.auditEqual }))
      assert('INSTALLED_SOURCE_QUEUE_HELD', s.queueHeld === true, String(s.queueHeld))
      assert('INSTALLED_SOURCE_MARKER_UNCHANGED', s.markerUnchanged === true, String(s.markerUnchanged))
      assert('INSTALLED_SOURCE_REPLAY', s.replay === 200 && s.replayEqual === true, JSON.stringify({ status: s.replay, equal: s.replayEqual }))
      assert('INSTALLED_SOURCE_REOPEN', s.reopened === 'RUNNING' && s.reopenedReplay === 200 && s.reopenedEqual === true, JSON.stringify({ reopen: s.reopened, status: s.reopenedReplay, equal: s.reopenedEqual }))
      assert('INSTALLED_SOURCE_NO_PROVIDER', observed.readOnly.modelRequestsAfter === observed.readOnly.modelRequestsBefore, JSON.stringify({ before: observed.readOnly.modelRequestsBefore, after: observed.readOnly.modelRequestsAfter }))
      evidence.installedSourceConfirm = { subject: frozenArtifactSubject(target), mode: 'recovery_readonly', prepare: { status: s.prepare, authorization: s.authorization, startupAvailable: s.startupAvailable, targetCreated: s.targetCreated },
        confirm: { status: s.confirm, activationId: s.activationId, auditEqual: s.auditEqual }, queueHeld: s.queueHeld, markerUnchanged: s.markerUnchanged,
        replay: { status: s.replay, equal: s.replayEqual }, reopened: { status: s.reopened, replay: s.reopenedReplay, equal: s.reopenedEqual },
        providerRequests: observed.readOnly.modelRequestsAfter }
    }))

  cases.push(await runCase({ ...define('E5-WORKFLOW-FORMATS', 'The frozen package itself declares which workflow snapshot/evidence format it can produce and verify'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('FORMAT_PROVISIONED', observed?.format !== undefined, failure ?? 'no observation')
      if (!observed?.format) return
      const format = observed.format
      assert('FORMAT_V1_DEFAULT', format.v1?.status === 'ok' && format.v1?.protocol === 'workflow-snapshot/1' &&
        format.v1?.evidenceProtocol === 'workflow-evidence/1' && format.v1?.families === 13 && format.v1?.familySetVersion === null &&
        format.v1?.verified === 'ok' && /^[a-f0-9]{64}$/u.test(String(format.v1?.digest ?? '')), JSON.stringify(format.v1))
      if (format.supportsV2) {
        assert('FORMAT_V2_EXPLICIT', format.v2?.status === 'ok' && format.v2?.protocol === 'workflow-snapshot/2' &&
          format.v2?.evidenceProtocol === 'workflow-evidence/2' && format.v2?.families === 21 && format.v2?.familySetVersion === 2 &&
          format.v2?.verified === 'ok' && /^[a-f0-9]{64}$/u.test(String(format.v2?.digest ?? '')), JSON.stringify(format.v2))
        assert('FORMAT_V2_DISTINCT', format.v2?.digest !== format.v1?.digest, JSON.stringify({ v1: format.v1?.digest, v2: format.v2?.digest }))
        assert('FORMAT_INVALID_VERSION_REFUSED', format.invalid3?.rejected === true && format.invalid3?.destinationCreated === false,
          JSON.stringify(format.invalid3))
        assert('FORMAT_SOURCE_DB_UNCHANGED', format.dbUnchanged === true, String(format.dbUnchanged))
        assert('FORMAT_PROTOCOL_PAIR', format.snapshotProtocols.includes('workflow-snapshot/1') && format.snapshotProtocols.includes('workflow-snapshot/2') &&
          format.evidenceProtocols.includes('workflow-evidence/1') && format.evidenceProtocols.includes('workflow-evidence/2'), JSON.stringify({ snapshot: format.snapshotProtocols, evidence: format.evidenceProtocols }))
      } else {
        // Old v1-only bytes keep their measured scope; the case never invents v2 for them.
        assert('FORMAT_V1_ONLY_OLD_SCOPE', format.v2?.unsupported === true && format.v2?.families === 13 &&
          !format.snapshotProtocols.includes('workflow-snapshot/2'), JSON.stringify(format.v2))
      }
      assert('FORMAT_PROTOCOL_SEPARATION', format.portability?.installArtifact === 'pa-install/1' &&
        format.portability?.restoreReport === 'personal-restore/1' &&
        !format.snapshotProtocols.includes(format.portability.restoreReport), JSON.stringify(format.portability))
      evidence.workflowFormats = { subject: frozenArtifactSubject(target), mode: 'installed_bytes',
        capability: format.supportsV2 ? 'default1+explicit2' : 'v1-only',
        snapshotProtocols: format.snapshotProtocols, evidenceProtocols: format.evidenceProtocols,
        hasFormatVersion: format.hasFormatVersion, hasFamilySetVersion: format.hasFamilySetVersion, readSignature: format.readSignature,
        v1: format.v1, v2: format.v2, invalid3: format.invalid3 ?? null, dbUnchanged: format.dbUnchanged ?? null, dbBytes: format.dbBytes ?? null,
        portability: format.portability, packageCapabilities: format.packageCapabilities ?? null,
        explicitV2: format.supportsV2 ? 'verified: workflow-snapshot/2 with 21 families and familySetVersion 2'
          : 'NOT_REACHED for this frozen package: no versioned snapshot code, v1-only scope kept' }
    }))

  cases.push(await runCase({ ...define('E9-INSTALLED-STABILITY', 'Bounded concurrent reads, repeated confirmation and a service reopen on the second root return every request/queue/resource to baseline'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('INSTALLED_STABILITY_PROVISIONED', observed !== undefined, failure ?? 'no observation')
      if (!observed) return
      const s = observed.stress
      assert('INSTALLED_STABILITY_CONCURRENT', s.concurrent.length === 4 && s.concurrent.every(status => status === 200), JSON.stringify(s.concurrent))
      assert('INSTALLED_STABILITY_REPEATED', s.repeatedEqual === true && observed.source.replayEqual === true, JSON.stringify({ repeated: s.repeatedEqual, replay: observed.source.replayEqual }))
      assert('INSTALLED_STABILITY_QUEUE', s.queueReturned === true && s.countsStable === true, JSON.stringify({ queue: s.queueReturned, counts: s.countsStable }))
      assert('INSTALLED_STABILITY_NO_RESEND', s.providerUnchanged === true, String(s.providerUnchanged))
      assert('INSTALLED_STABILITY_REOPEN', observed.source.reopened === 'RUNNING' && observed.source.reopenedEqual === true, JSON.stringify({ status: observed.source.reopened, equal: observed.source.reopenedEqual }))
      evidence.installedStability = { subject: frozenArtifactSubject(target), mode: 'recovery_readonly',
        concurrent: s.concurrent, repeatedEqual: s.repeatedEqual, queueReturned: s.queueReturned, countsStable: s.countsStable,
        providerUnchanged: s.providerUnchanged, reopened: observed.source.reopened, reopenedEqual: observed.source.reopenedEqual }
    }))

  return { cases, artifacts: {} }
}
