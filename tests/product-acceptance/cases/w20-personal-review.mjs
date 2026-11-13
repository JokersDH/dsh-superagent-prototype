import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import {
  chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'

/**
 * Explicit restored-personal review through main's real CLI and personal startup.
 *
 * The restored state is produced by the frozen install package (first-run, personal discussion-only
 * data, backup/restore). The review file is prepared by `tools/dev/review-restored.mjs` and applied by
 * the actual `apps/coordinator/product/demo.ts` personal startup. The fixture+readonly lane is a
 * different scope and is not reported here as personal.
 */
const sha = value => createHash('sha256').update(value).digest('hex')
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w20] ${message}\n`) }

function freePort() {
  return new Promise(resolvePort => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolvePort(port)) })
  })
}

function launcher(install, args, { env = {}, timeoutMs = 90_000 } = {}) {
  const result = spawnSync(join(install, 'bin/pa'), args, {
    cwd: join(install, '..'), encoding: 'utf8', timeout: timeoutMs,
    env: { ...process.env, PA_NODE: process.execPath, ...env },
  })
  let json
  const text = String(result.stdout).trim()
  try { json = JSON.parse(text) } catch {
    try { json = JSON.parse(text.split('\n').filter(Boolean).at(-1)) } catch { json = undefined }
  }
  return { status: result.status, json, stderr: String(result.stderr).slice(-400) }
}

function startPackage(install, { port, apiPort, env = {} }) {
  const child = spawn(join(install, 'bin/pa'), ['start', '--json', '--port', String(port), '--api-port', String(apiPort), '--discussion-only'], {
    cwd: join(install, '..'), stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PA_NODE: process.execPath, ...env },
  })
  let buffer = ''
  const attempt = new Promise(resolveAttempt => {
    child.stdout.on('data', chunk => {
      buffer += chunk
      // The launcher prints one pretty-printed JSON object; parse it only when it is complete.
      const text = buffer.trim()
      if (!text.endsWith('}')) return
      try { resolveAttempt(JSON.parse(text)) } catch { /* still buffering */ }
    })
    child.once('exit', code => resolveAttempt({ status: 'EXITED', code }))
  })
  return { child, attempt }
}

async function startDemo(root, { state, reviewFile, apiPort, mockFile, deadlineMs = 20_000 }) {
  const args = [join(root, 'apps/coordinator/product/demo.ts'), '--port', String(apiPort), '--state', state,
    '--console-origin', 'http://127.0.0.1:5173', '--assistant', '--discussion-only', '--local-access']
  if (reviewFile) args.push('--review-restored-scope', reviewFile)
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, PA_MODEL_CONFIG: mockFile }, stdio: ['ignore', 'pipe', 'pipe'] })
  // Drain stdout so a chatty startup cannot block on a full pipe while we wait for health.
  child.stdout.on('data', () => {})
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const exited = new Promise(resolve => child.once('exit', code => resolve({ exitCode: code })))
  const deadline = Date.now() + deadlineMs
  let healthy = false
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) break
    try { healthy = (await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(400) })).ok } catch { healthy = false }
    if (healthy) break
    await new Promise(resolve => setTimeout(resolve, 60))
  }
  return { child, healthy, exited, stderr: () => stderr.slice(-600), stop: async () => {
    if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGTERM') } catch { /* gone */ } }
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 6_000))])
    if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL') } catch { /* gone */ } }
  } }
}

async function runCli(root, args, { timeoutMs = 60_000 } = {}) {
  const result = spawnSync(process.execPath, [join(root, 'tools/dev/review-restored.mjs'), ...args], { encoding: 'utf8', cwd: root, timeout: timeoutMs })
  let json
  try { json = JSON.parse(String(result.stdout).trim().split('\n').filter(Boolean).at(-1)) } catch { json = undefined }
  return { status: result.status, json, stderr: String(result.stderr).slice(-500), stdout: String(result.stdout).slice(-500) }
}

function messageFacts(state) {
  const db = new DatabaseSync(join(state, 'state.sqlite'), { readOnly: true })
  try {
    const conversations = new Map(db.prepare('SELECT id, project_id FROM conversations').all().map(row => [row.id, row.project_id]))
    const messages = db.prepare('SELECT id, conversation_id, value FROM conversation_messages ORDER BY created_at, rowid').all()
    const parsed = messages.map(row => {
      let value = {}
      try { value = JSON.parse(row.value) } catch { /* keep empty */ }
      return { id: row.id, conversationId: row.conversation_id,
        projectId: value.projectId ?? conversations.get(row.conversation_id) ?? null,
        role: value.role ?? null, text: value.text ?? '', provenance: value.provenance ?? null }
    })
    const queue = db.prepare('SELECT * FROM effect ORDER BY rowid').all().map(row => ({ ...row }))
    return { messages: parsed, queue }
  } finally { db.close() }
}

async function provision(target) {
  const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w20-review-')))
  const install = join(own, 'install')
  mkdirSync(install, { recursive: true })
  const mock = await candidateModel()
  let started
  try {
    mark('extract')
    spawnSync('tar', ['-xzf', target.tarPath, '-C', install, '--strip-components=1'])
    const first = launcher(install, ['first-run', '--json'], { env: { PA_MODEL_CONFIG: mock.file } })
    mark(`first-run ${first.status}`)
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
    const [port, apiPort] = [await freePort(), await freePort()]
    mark('start package')
    started = startPackage(install, { port, apiPort, env: { PA_MODEL_CONFIG: mock.file } })
    const running = await started.attempt
    mark(`package ${running.status}`)
    if (running.status !== 'RUNNING' || !running.instance?.apiURL) throw new Error(`package start ${running.status}/${running.code ?? 'none'}`)
    const state = running.instance.state
    const client = new LocalProductClient({ baseURL: running.instance.apiURL, stateDir: state, timeoutMs: 20_000 })
    const configuration = await client.configuration()
    // Register a private historical project in the personal registry, then write real discussion
    // data under it. A restored root can also carry that registry; E removes it for the unbound
    // control so the explicit review entry is what actually grants the read.
    const projectDir = join(own, 'historical-project')
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'index.mjs'), 'export const ok = true\n')
    const git = args => execFileSync('git', args, { cwd: projectDir, stdio: 'pipe' })
    git(['init', '-q']); git(['add', 'index.mjs'])
    git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'W20 historical project'])
    const known = configuration.projects.map(item => item.id)
    const registered = await client.request('/v1/projects', { method: 'POST', body: { path: projectDir, displayName: 'W20 历史项目', check: 'node_test' } })
    if (registered.status !== 200) throw new Error(`project registration ${registered.status}`)
    const configurationAfter = await client.configuration()
    const projectId = configurationAfter.projects.map(item => item.id).find(id => !known.includes(id))
    if (!projectId) throw new Error('registered project is absent from the configuration')
    const project = { id: projectId }
    // A context message belongs to an existing conversation, so seed one ordinary chat first.
    await client.dispatch({ commandId: 'w20-review-seed', conversationId: 'conv-w20-review', projectId: project.id, kind: 'chat', text: '第二十轮恢复来源。' })
    await new Promise(resolve => setTimeout(resolve, 700))
    const text = '第二十轮个人恢复原始上下文。'
    const prepared = await client.request('/v1/assistant/context/prepare', { method: 'POST', body: {
      commandId: 'w20-review-context', text, context: { projectId: project.id, conversationId: 'conv-w20-review',
        selections: ['project', 'conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 4096 } } } })
    if (prepared.status !== 200) throw new Error(`context prepare ${prepared.status}`)
    const sent = await client.request('/v1/assistant/context/send', { method: 'POST', body: { commandId: 'w20-review-context', token: prepared.body.token } })
    if (sent.status !== 200) throw new Error(`context send ${sent.status}`)
    let reply
    for (let index = 0; index < 120 && !reply; index += 1) {
      const page = await client.conversation('conv-w20-review')
      const user = page.messages.find(item => item.role === 'user' && item.text === text)
      const at = user ? page.messages.indexOf(user) : -1
      reply = at >= 0 ? page.messages.slice(at + 1).find(item => item.provenance === 'reasoner_reply') : undefined
      if (!reply) await new Promise(resolve => setTimeout(resolve, 150))
    }
    if (!reply) throw new Error('the restored source has no reply for the context message')
    launcher(install, ['stop', '--json'], { timeoutMs: 30_000 })
    const bundle = join(own, 'w20-review.pab')
    const backup = launcher(install, ['backup', '--out', bundle, '--json'], { timeoutMs: 90_000 })
    if (backup.status !== 0 || backup.json?.status !== 'CREATED') throw new Error(`backup ${backup.status}: ${backup.stderr}`)
    const verify = launcher(install, ['verify-backup', '--bundle', bundle, '--json'], { timeoutMs: 90_000 })
    const restoredRoot = join(own, 'restored-root')
    const restore = launcher(install, ['restore', '--bundle', bundle, '--to', restoredRoot, '--json'], { timeoutMs: 90_000 })
    if (restore.status !== 0 || restore.json?.status !== 'RESTORED') throw new Error(`restore ${restore.status}: ${restore.stderr}`)
    mark('restored facts')
    const registryPath = join(restoredRoot, 'native-projects.json')
    const registry = existsSync(registryPath) ? { present: true, bytes: readFileSync(registryPath).byteLength, digest: sha(readFileSync(registryPath)) } : { present: false }
    // The unbound control represents a historical project that is not in this root's registry.
    if (registry.present) rmSync(registryPath)
    const facts = messageFacts(restoredRoot)
    const user = facts.messages.find(item => item.text === text && item.role === 'user')
    if (!user) throw new Error('restored store has no original user message')
    mark(`seeded project ${user.projectId}`)
    return { own, install, state, restoredRoot, mock, projectId: user.projectId, conversationId: user.conversationId,
      messageId: user.id, text, facts, verify: verify.json?.status ?? null, restore: restore.json?.status ?? null,
      backup: { status: backup.json?.status, counts: backup.json?.counts }, registry, modelRequests: mock.requests.length }
  } finally {
    try { launcher(install, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
    try { started?.child?.kill('SIGKILL') } catch { /* gone */ }
  }
}

const define = (id, title) => ({ id, title, layer: LAYERS.INSTALLED, limitations: [
  'Restored data comes from the frozen package; main tools/dev/review-restored.mjs and the actual personal demo.ts entry consume it. The frozen package itself predates the 773 entry.',
  'Loopback mock only; no vendor model/native send. Business writes stay refused and the old queue stays held.',
] })

export async function runPersonalReview() {
  const cases = []
  const target = loadFrozenArtifact('target', DEFAULT_FROZEN_DIRS.target)
  let observed, failure
  try { observed = await provision(target) } catch (error) { failure = String(error?.message ?? error).slice(0, 500) }
  const root = process.cwd()

  cases.push(await runCase({ ...define('E4-PERSONAL-RESTORED-REVIEW', 'A restored personal project is refused until the explicit review scope is supplied, then its original data is readable while business writes stay refused'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('REVIEW_PROVISIONED', observed !== undefined, failure ?? 'no observation')
      if (!observed) return
      const { own, restoredRoot, mock, projectId, messageId, text } = observed
      const reviewFile = join(own, 'review.json')
      try {
        // Without the explicit file the restored personal startup exposes no historical project read.
        const [beforePort, beforeApi] = [await freePort(), await freePort()]
        const before = await startDemo(root, { state: restoredRoot, apiPort: beforeApi, mockFile: mock.file })
        let statuses = { healthy: before.healthy }
        try {
          if (before.healthy) {
            const key = readFileSync(join(restoredRoot, 'api.key'), 'utf8').trim()
            const h = { authorization: `Bearer ${key}` }
            const beforeConfiguration = await (await fetch(`http://127.0.0.1:${beforeApi}/v1/configuration`, { headers: h, signal: AbortSignal.timeout(5_000) })).json()
            mark(`before projects ${JSON.stringify(beforeConfiguration.projects?.map(item => item.id))} message ${messageId} project ${projectId}`)
            const candidates = await fetch(`http://127.0.0.1:${beforeApi}/v1/messages/${messageId}/candidates`, { headers: h, signal: AbortSignal.timeout(5_000) })
            const history = await fetch(`http://127.0.0.1:${beforeApi}/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(observed.conversationId)}`, { headers: h, signal: AbortSignal.timeout(5_000) })
            statuses = { ...statuses, candidates: candidates.status, history: history.status }
          }
        } finally { await before.stop() }
        assert('REVIEW_UNBOUND_REFUSED', statuses.healthy === true && statuses.candidates === 403 && statuses.history === 403, JSON.stringify(statuses))

        const cli = await runCli(root, ['--state', restoredRoot, '--project', projectId, '--allow-path', 'src/', '--output', reviewFile])
        assert('REVIEW_CLI_PREPARED', cli.status === 0 && cli.json?.status === 'prepared' && cli.json?.access === 'historical_data_read_only' &&
          cli.json?.startupAvailable === false, JSON.stringify({ status: cli.status, json: cli.json, stderr: cli.stderr }))
        const stat = readFileSync(reviewFile)
        const mode = (await import('node:fs')).statSync(reviewFile).mode & 0o777
        assert('REVIEW_FILE_PRIVATE', mode === 0o600 && stat.byteLength < 131072, JSON.stringify({ mode: mode.toString(8), bytes: stat.byteLength }))

        const [afterPort, afterApi] = [await freePort(), await freePort()]
        const after = await startDemo(root, { state: restoredRoot, reviewFile, apiPort: afterApi, mockFile: mock.file })
        assert('REVIEW_BOUND_START', after.healthy === true, after.stderr())
        const queueBefore = messageFacts(restoredRoot).queue
        try {
          const key = readFileSync(join(restoredRoot, 'api.key'), 'utf8').trim()
          const h = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
          const candidates = await fetch(`http://127.0.0.1:${afterApi}/v1/messages/${messageId}/candidates`, { headers: h, signal: AbortSignal.timeout(5_000) })
          const history = await fetch(`http://127.0.0.1:${afterApi}/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(observed.conversationId)}`, { headers: h, signal: AbortSignal.timeout(5_000) })
          const sources = await fetch(`http://127.0.0.1:${afterApi}/v1/messages/${messageId}/context/sources`, { headers: h, signal: AbortSignal.timeout(5_000) })
          const business = await fetch(`http://127.0.0.1:${afterApi}/v1/commands`, { method: 'POST', headers: h, signal: AbortSignal.timeout(5_000),
            body: JSON.stringify({ kind: 'chat', commandId: 'w20-readonly-must-not-send', conversationId: observed.conversationId, projectId, text: 'Do not send' }) })
          const page = await (await fetch(`http://127.0.0.1:${afterApi}/v1/conversations/${encodeURIComponent(observed.conversationId)}/messages`, { headers: h, signal: AbortSignal.timeout(5_000) })).json()
          const original = page.messages?.some(message => message.role === 'user' && message.text === text)
          const queueAfter = messageFacts(restoredRoot).queue
          assert('REVIEW_BOUND_READS', candidates.status === 200 && history.status === 200 && sources.status === 200,
            JSON.stringify({ candidates: candidates.status, history: history.status, sources: sources.status }))
          assert('REVIEW_ORIGINAL_BODY', original === true, String(original))
          assert('REVIEW_BUSINESS_REFUSED', business.status === 422, String(business.status))
          assert('REVIEW_QUEUE_HELD', JSON.stringify(queueBefore) === JSON.stringify(queueAfter), 'queue changed')
          assert('REVIEW_NO_PROVIDER', mock.requests.length === observed.modelRequests, JSON.stringify({ before: observed.modelRequests, after: mock.requests.length }))
          evidence.personalReview = {
            subject: frozenArtifactSubject(target), mode: 'personal', state: 'recovery_readonly',
            entryOrigin: 'main tools/dev/review-restored.mjs + apps/coordinator/product/demo.ts',
            packageEntry: false, packageEntryNote: 'the frozen package predates the 773 review entry',
            before: statuses, after: { candidates: 200, history: 200, sources: 200, originalBody: original },
            reviewFile: { mode: '600', access: 'historical_data_read_only', startupAvailable: false, projects: 1 },
            business: business.status, queueHeld: true, providerRequests: mock.requests.length,
            restore: { verify: observed.verify, restore: observed.restore, backup: observed.backup },
          }
        } finally { await after.stop() }
      } finally { rmSync(reviewFile, { force: true }) }
    }))

  cases.push(await runCase({ ...define('E5-RESTORED-REVIEW-REFUSALS', 'Tampered, foreign, unsafe or blocking review inputs are refused without starting a readable personal instance'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('REFUSAL_PROVISIONED', observed !== undefined, failure ?? 'no observation')
      if (!observed) return
      const { own, restoredRoot, mock, projectId } = observed
      const good = join(own, 'refusal-good.json'), secondRoot = join(own, 'second-root')
      const results = {}
      const refusedStart = async (file) => {
        const apiPort = await freePort()
        const run = await startDemo(root, { state: restoredRoot, reviewFile: file, apiPort, mockFile: mock.file, deadlineMs: 8_000 })
        const healthy = run.healthy
        await run.stop()
        return { healthy, stderr: run.stderr() }
      }
      const cli = await runCli(root, ['--state', restoredRoot, '--project', projectId, '--allow-path', 'src/', '--output', good])
      assert('REFUSAL_PREPARE', cli.status === 0, cli.stderr)
      try {
        const original = JSON.parse(readFileSync(good, 'utf8'))
        const writeCase = (name, mutate) => {
          const target = join(own, `${name}.json`)
          const value = JSON.parse(JSON.stringify(original)); mutate(value)
          writeFileSync(target, JSON.stringify(value, null, 2), { mode: 0o600 })
          return target
        }
        results.tamperedSignature = await refusedStart(writeCase('tampered', value => { value.signature = `${value.signature.slice(0, -2)}xx` }))
        results.foreignRoot = await refusedStart(good) // started against a different restored root below
        // Re-run the same file against a different restored root: the binding must reject it.
        const bundle = join(own, 'again.pab')
        launcher(observed.install, ['backup', '--out', bundle, '--json'], { timeoutMs: 90_000 })
        launcher(observed.install, ['restore', '--bundle', bundle, '--to', secondRoot, '--json'], { timeoutMs: 90_000 })
        results.foreignRoot = await (async () => {
          const apiPort = await freePort()
          const run = await startDemo(root, { state: secondRoot, reviewFile: good, apiPort, mockFile: mock.file, deadlineMs: 8_000 })
          const healthy = run.healthy; await run.stop(); return { healthy, stderr: run.stderr() }
        })()
        const publicFile = join(own, 'public.json'); writeFileSync(publicFile, JSON.stringify(original), { mode: 0o644 }); chmodSync(publicFile, 0o644)
        results.publicMode = await refusedStart(publicFile)
        const link = join(own, 'link.json'); symlinkSync(good, link)
        results.symlink = await refusedStart(link)
        const fifo = join(own, 'input.fifo'); execFileSync('mkfifo', [fifo])
        results.fifo = await refusedStart(fifo)
        const exists = await runCli(root, ['--state', restoredRoot, '--project', projectId, '--allow-path', 'src/', '--output', good])
        results.existingOutput = { status: exists.status, stderr: exists.stderr }
        const unknown = await runCli(root, ['--state', restoredRoot, '--project', 'no-such-project', '--allow-path', 'src/', '--output', join(own, 'unknown.json')])
        results.unknownProject = { status: unknown.status }
        const unsafe = await runCli(root, ['--state', restoredRoot, '--project', projectId, '--allow-path', '../outside', '--output', join(own, 'unsafe.json')])
        results.unsafePath = { status: unsafe.status }
        const started = await startDemo(root, { state: restoredRoot, reviewFile: writeCase('future', value => { value.payload.expiresAt = '2000-01-01T00:00:00.000Z' }), apiPort: await freePort(), mockFile: mock.file, deadlineMs: 8_000 })
        results.expiredOrTampered = { healthy: started.healthy }; await started.stop()

        assert('REFUSAL_TAMPERED', results.tamperedSignature.healthy === false, JSON.stringify(results.tamperedSignature))
        assert('REFUSAL_FOREIGN_ROOT', results.foreignRoot.healthy === false, JSON.stringify(results.foreignRoot))
        assert('REFUSAL_PUBLIC_MODE', results.publicMode.healthy === false, JSON.stringify(results.publicMode))
        assert('REFUSAL_SYMLINK', results.symlink.healthy === false, JSON.stringify(results.symlink))
        assert('REFUSAL_FIFO', results.fifo.healthy === false, JSON.stringify(results.fifo))
        assert('REFUSAL_EXISTING_OUTPUT', results.existingOutput.status !== 0, JSON.stringify(results.existingOutput))
        assert('REFUSAL_UNKNOWN_PROJECT', results.unknownProject.status !== 0, JSON.stringify(results.unknownProject))
        assert('REFUSAL_UNSAFE_PATH', results.unsafePath.status !== 0, JSON.stringify(results.unsafePath))
        assert('REFUSAL_EXPIRY_OR_TAMPER', results.expiredOrTampered.healthy === false, JSON.stringify(results.expiredOrTampered))
        evidence.restoredReviewRefusals = { subject: frozenArtifactSubject(target), mode: 'personal', entryOrigin: 'main CLI + demo.ts',
          results, notTestedEntry: ['expiry with a valid signature', 'foreign principal/host/key with a valid signature'],
          notTestedReason: 'forging a valid signature would require the probe-owned action key; those refusals are covered by the main module contract, not re-signed here' }
      } finally { rmSync(good, { force: true }); rmSync(secondRoot, { recursive: true, force: true }) }
    }))

  cases.push(notTested({ ...define('E4-PERSONAL-READONLY-REBIND', 'A restored personal project is read through main explicit readonly rebinding with its original text and change refusal'), evidence: {} },
    'NOT_REACHED: main 773 supplies the explicit review CLI and personal startup, which E now exercises in E4-PERSONAL-RESTORED-REVIEW. The frozen target package predates that entry, so a same-package installed entry remains NOT_REACHED until D freezes a package containing 773.'))

  if (observed && !process.env.PA_E_KEEP) {
    try { rmSync(observed.own, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  if (observed && process.env.PA_E_KEEP) mark(`kept ${observed.own}`)
  return { cases, artifacts: {} }
}
