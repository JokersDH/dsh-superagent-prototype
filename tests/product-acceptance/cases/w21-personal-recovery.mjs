import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'

/**
 * Wave-21 explicit restored-personal review with the *package's own* prepare and startup consumer.
 *
 * The private review file is produced by this package's `apps/coordinator/product/restored-review.ts`
 * (source/dist bytes inside the install), and startup goes through this package's `bin/pa start
 * --discussion-only --review-restored-scope`. No checkout CLI or demo is used for an installed claim.
 */
const sha = value => createHash('sha256').update(value).digest('hex')
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w21] ${message}\n`) }

function freePort() {
  return new Promise(resolvePort => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolvePort(port)) })
  })
}

function parseJson(text) {
  const value = String(text ?? '').trim()
  try { return JSON.parse(value) } catch {
    try { return JSON.parse(value.split('\n').filter(Boolean).at(-1)) } catch { return undefined }
  }
}

function launcher(install, args, { env = {}, timeoutMs = 90_000 } = {}) {
  const result = spawnSync(join(install, 'bin/pa'), args, {
    cwd: join(install, '..'), encoding: 'utf8', timeout: timeoutMs,
    env: { ...process.env, PA_NODE: process.execPath, ...env },
  })
  return { status: result.status, json: parseJson(result.stdout), stderr: String(result.stderr).slice(-500), stdout: String(result.stdout).slice(-500) }
}

/** Removes only a dead instance record in this probe-owned config root (never signals a process). */
function clearDeadRecord(config) {
  const path = join(config, 'instance.json')
  if (!existsSync(path)) return
  let record
  try { record = JSON.parse(readFileSync(path, 'utf8')) } catch { rmSync(path, { force: true }); return }
  const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
  if (!Number.isSafeInteger(record.pid) || !alive(record.pid)) rmSync(path, { force: true })
}

function startPackage(install, { state, config, reviewFile, port, apiPort, mockFile, timeoutMs = 90_000 }) {
  clearDeadRecord(config)
  const args = ['start', '--json', '--port', String(port), '--api-port', String(apiPort), '--discussion-only']
  if (reviewFile) args.push('--review-restored-scope', reviewFile)
  const child = spawn(join(install, 'bin/pa'), args, {
    cwd: join(install, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PA_NODE: process.execPath, PA_MODEL_CONFIG: mockFile, PA_CONFIG_ROOT: config, PA_DATA_ROOT: state },
  })
  child.stdout.on('data', () => {})
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  let buffer = ''
  const value = new Promise(resolve => {
    const timer = setTimeout(() => resolve({ status: 'TIMEOUT' }), timeoutMs)
    let attached = false
    child.stdout.on('data', chunk => {
      buffer += chunk
      const text = buffer.trim()
      if (!text.endsWith('}')) return
      try { const json = JSON.parse(text); clearTimeout(timer); resolve({ ...json, stderr: stderr.slice(-800) }) } catch { /* buffering */ }
    })
    if (!attached) attached = true
    child.once('exit', code => { clearTimeout(timer); resolve({ status: 'EXITED', code, stderr: stderr.slice(-800) }) })
  })
  return { child, value }
}

function stopPackage(install, { state, config, mockFile, timeoutMs = 30_000 }) {
  return launcher(install, ['stop', '--json'], {
    timeoutMs,
    env: { PA_MODEL_CONFIG: mockFile, PA_CONFIG_ROOT: config, PA_DATA_ROOT: state },
  })
}

/** Stops only processes recorded in this probe-owned config root whose argv proves our install/state. */
async function stopOwned(install, { state, config, mockFile }) {
  try { stopPackage(install, { state, config, mockFile }) } catch { /* best effort */ }
  const recordPath = join(config, 'instance.json')
  if (!existsSync(recordPath)) return
  let record
  try { record = JSON.parse(readFileSync(recordPath, 'utf8')) } catch { rmSync(recordPath, { force: true }); return }
  const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
  const owned = []
  for (const pid of [record.pid, record.apiPid, record.consolePid]) {
    if (!Number.isSafeInteger(pid)) continue
    try {
      const command = String(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }))
      if (command.includes(install) && command.includes(state)) owned.push(pid)
    } catch { /* gone */ }
  }
  for (const pid of owned) { try { process.kill(pid, 'SIGTERM') } catch { /* gone */ } }
  await new Promise(resolve => setTimeout(resolve, 500))
  for (const pid of owned) if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
  rmSync(recordPath, { force: true })
}

function messageFacts(state) {
  const db = new DatabaseSync(join(state, 'state.sqlite'), { readOnly: true })
  try {
    const conversations = new Map(db.prepare('SELECT id, project_id FROM conversations').all().map(row => [row.id, row.project_id]))
    const messages = db.prepare('SELECT id, conversation_id, value FROM conversation_messages ORDER BY created_at, rowid').all()
      .map(row => {
        let value = {}
        try { value = JSON.parse(row.value) } catch { /* empty */ }
        return { id: row.id, conversationId: row.conversation_id,
          projectId: value.projectId ?? conversations.get(row.conversation_id) ?? null,
          role: value.role ?? null, text: value.text ?? '', provenance: value.provenance ?? null }
      })
    const queue = db.prepare('SELECT * FROM effect ORDER BY rowid').all().map(row => ({ ...row }))
    return { messages, queue }
  } finally { db.close() }
}

/** Digest support comes from the frozen package bytes for this exact subject, not from the evidence. */
function packageCapability(install, target) {
  const start = readFileSync(join(install, 'app/apps/launcher/lib/start.mjs'), 'utf8')
  const demo = readFileSync(join(install, 'app/apps/coordinator/product/demo.ts'), 'utf8')
  return { source: target.sourceCommit, buildId: target.buildId, tarSha256: target.tarSha256,
    digestSupported: /restoredReviewDigest/u.test(start) && /restoredReviewDigest/u.test(demo) }
}

function consumerEntry(install, target) {
  const files = ['apps/launcher/lib/start.mjs', 'apps/launcher/lib/daemon.mjs',
    'apps/coordinator/product/restored-review.ts', 'apps/coordinator/product/demo.ts']
  return {
    origin: 'package',
    package: { source: target.sourceCommit, buildId: target.buildId, tarSha256: target.tarSha256, tarBytes: target.tarBytes },
    files: files.map(relative => {
      const bytes = readFileSync(join(install, 'app', relative))
      return { path: relative, sha256: sha(bytes), bytes: bytes.byteLength }
    }),
  }
}

function packagePrepare(install, { state, project, allow, output, exclude = ['.git'], timeoutMs = 60_000 }) {
  const args = ['review-restored', '--json', '--state', state, '--project', project,
    ...allow.flatMap(path => ['--allow-path', path]), ...exclude.flatMap(path => ['--exclude-path', path]), '--out', output]
  const result = spawnSync(join(install, 'bin/pa'), args, {
    cwd: join(install, '..'), encoding: 'utf8', timeout: timeoutMs,
    env: { ...process.env, PA_NODE: process.execPath },
  })
  return { status: result.status, json: parseJson(result.stdout), stderr: String(result.stderr).slice(-500), stdout: String(result.stdout).slice(-500) }
}

async function provision(target) {
  const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w21-review-')))
  const install = join(own, 'install')
  mkdirSync(install, { recursive: true })
  const config = join(own, 'config'), seedState = join(own, 'seed-state'), restored = join(own, 'restored')
  const mock = await candidateModel()
  try {
    mark('extract')
    spawnSync('tar', ['-xzf', target.tarPath, '-C', install, '--strip-components=1'])
    const first = launcher(install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: config, PA_DATA_ROOT: seedState, PA_MODEL_CONFIG: mock.file } })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
    const [port, apiPort] = [await freePort(), await freePort()]
    const started = startPackage(install, { state: seedState, config, port, apiPort, mockFile: mock.file })
    const running = await started.value
    mark(`seed start ${running.status}`)
    if (running.status !== 'RUNNING' || !running.instance?.apiURL) throw new Error(`seed start ${running.status}/${running.code ?? 'none'}`)
    const client = new LocalProductClient({ baseURL: running.instance.apiURL, stateDir: running.instance.state, timeoutMs: 20_000 })
    const before = await client.configuration()
    const known = before.projects.map(item => item.id)
    const projectDir = join(own, 'historical-project')
    mkdirSync(join(projectDir, 'src'), { recursive: true })
    writeFileSync(join(projectDir, 'index.mjs'), 'export const ok = true\n')
    const git = args => execFileSync('git', args, { cwd: projectDir, stdio: 'pipe' })
    git(['init', '-q']); git(['add', 'index.mjs'])
    git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'W21 historical project'])
    const registered = await client.request('/v1/projects', { method: 'POST', body: { path: projectDir, displayName: 'W21 历史项目', check: 'node_test' } })
    if (registered.status !== 200) throw new Error(`project registration ${registered.status}`)
    const configuration = await client.configuration()
    const projectId = configuration.projects.map(item => item.id).find(id => !known.includes(id))
    if (!projectId) throw new Error('registered project is absent from the configuration')
    const text = '第二十一轮个人恢复原始上下文。'
    await client.dispatch({ commandId: 'w21-review-seed', conversationId: 'conv-w21-review', projectId, kind: 'chat', text: '第二十一轮恢复来源。' })
    await new Promise(resolve => setTimeout(resolve, 700))
    const prepared = await client.request('/v1/assistant/context/prepare', { method: 'POST', body: {
      commandId: 'w21-review-context', text, context: { projectId, conversationId: 'conv-w21-review',
        selections: ['project', 'conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 4096 } } } })
    if (prepared.status !== 200) throw new Error(`context prepare ${prepared.status}`)
    const sent = await client.request('/v1/assistant/context/send', { method: 'POST', body: { commandId: 'w21-review-context', token: prepared.body.token } })
    if (sent.status !== 200) throw new Error(`context send ${sent.status}`)
    let reply
    for (let index = 0; index < 120 && !reply; index += 1) {
      const page = await client.conversation('conv-w21-review')
      const user = page.messages.find(item => item.role === 'user' && item.text === text)
      const at = user ? page.messages.indexOf(user) : -1
      reply = at >= 0 ? page.messages.slice(at + 1).find(item => item.provenance === 'reasoner_reply') : undefined
      if (!reply) await new Promise(resolve => setTimeout(resolve, 150))
    }
    if (!reply) throw new Error('the restored source has no reply for the context message')
    await stopOwned(install, { state: seedState, config, mockFile: mock.file })
    const bundle = join(own, 'w21-review.pab')
    const backup = launcher(install, ['backup', '--out', bundle, '--json'], { env: { PA_CONFIG_ROOT: config, PA_DATA_ROOT: seedState, PA_MODEL_CONFIG: mock.file } })
    if (backup.status !== 0 || backup.json?.status !== 'CREATED') throw new Error(`backup ${backup.status}: ${backup.stderr}`)
    const verify = launcher(install, ['verify-backup', '--bundle', bundle, '--json'], { env: { PA_CONFIG_ROOT: config, PA_MODEL_CONFIG: mock.file } })
    const restore = launcher(install, ['restore', '--bundle', bundle, '--to', restored, '--json'], { env: { PA_CONFIG_ROOT: config, PA_DATA_ROOT: seedState, PA_MODEL_CONFIG: mock.file } })
    if (restore.status !== 0 || restore.json?.status !== 'RESTORED') throw new Error(`restore ${restore.status}: ${restore.stderr}`)
    const registryPath = join(restored, 'native-projects.json')
    const registry = existsSync(registryPath) ? { present: true, digest: sha(readFileSync(registryPath)) } : { present: false }
    if (registry.present) rmSync(registryPath)
    const facts = messageFacts(restored)
    const user = facts.messages.find(item => item.text === text && item.role === 'user')
    if (!user) throw new Error('restored store has no original user message')
    return { own, install, config, restored, mock, projectId: user.projectId, conversationId: user.conversationId,
      messageId: user.id, text, facts, registry, verify: verify.json?.status ?? null, restore: restore.json?.status ?? null,
      modelRequests: mock.requests.length, target }
  } finally {
    try { await stopOwned(install, { state: seedState, config, mockFile: mock.file }) } catch { /* best effort */ }
  }
}

const define = (id, title) => ({ id, title, layer: LAYERS.INSTALLED, limitations: [
  'The review file is produced by the frozen package internal prepare code and startup uses its bin/pa; no checkout CLI/demo is used for this installed claim.',
  'Loopback mock only; no vendor model/native send. Business writes stay refused and the old queue stays held.',
] })

export async function runPersonalReview() {
  const cases = []
  const target = loadFrozenArtifact('target', DEFAULT_FROZEN_DIRS.target)
  let observed, failure
  try { observed = await provision(target) } catch (error) { failure = String(error?.message ?? error).slice(0, 500) }

  cases.push(await runCase({ ...define('E4-PERSONAL-RESTORED-REVIEW', 'A package-restored personal project is refused unbound and readable after the explicit review file is prepared and started by the same package'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('REVIEW_PROVISIONED', observed !== undefined, failure ?? 'no observation')
      if (!observed) return
      const { install, restored, config, mock, projectId, conversationId, messageId, text } = observed
      const reviewFile = join(observed.own, 'review.json')
      try {
        const [unboundPort, unboundApi] = [await freePort(), await freePort()]
        const unbound = startPackage(install, { state: restored, config, port: unboundPort, apiPort: unboundApi, mockFile: mock.file })
        const unboundValue = await unbound.value
        let unboundStatuses = { status: unboundValue.status }
        try {
          if (unboundValue.status === 'RUNNING' && unboundValue.instance?.apiURL) {
            const key = readFileSync(join(restored, 'api.key'), 'utf8').trim()
            const headers = { authorization: `Bearer ${key}` }
            unboundStatuses = { status: 'RUNNING',
              candidates: (await fetch(`http://127.0.0.1:${unboundApi}/v1/messages/${messageId}/candidates`, { headers, signal: AbortSignal.timeout(5_000) })).status,
              history: (await fetch(`http://127.0.0.1:${unboundApi}/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(conversationId)}`, { headers, signal: AbortSignal.timeout(5_000) })).status }
          }
        } finally { await stopOwned(install, { state: restored, config, mockFile: mock.file }) }

        const prepared = packagePrepare(install, { state: restored, project: projectId, allow: ['src/'], output: reviewFile })
        const fileMode = existsSync(reviewFile) ? (await import('node:fs')).statSync(reviewFile).mode & 0o777 : null
        assert('REVIEW_CLI_PREPARED', prepared.status === 0 && prepared.json?.status === 'prepared' &&
          prepared.json.projects?.includes(projectId) && fileMode === 0o600,
          JSON.stringify({ status: prepared.status, json: prepared.json, mode: fileMode?.toString(8), stderr: prepared.stderr }))

        const [port, apiPort] = [await freePort(), await freePort()]
        const started = startPackage(install, { state: restored, config, reviewFile, port, apiPort, mockFile: mock.file })
        const value = await started.value
        assert('REVIEW_BOUND_START', value.status === 'RUNNING' && !!value.instance?.apiURL, JSON.stringify(value).slice(0, 400))
        const queueBefore = messageFacts(restored).queue
        let details = {}
        try {
          const key = readFileSync(join(restored, 'api.key'), 'utf8').trim()
          const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
          const base = `http://127.0.0.1:${apiPort}`
          const candidates = await fetch(`${base}/v1/messages/${messageId}/candidates`, { headers, signal: AbortSignal.timeout(5_000) })
          const history = await fetch(`${base}/v1/context/history?projectId=${encodeURIComponent(projectId)}&conversationId=${encodeURIComponent(conversationId)}`, { headers, signal: AbortSignal.timeout(5_000) })
          const sources = await fetch(`${base}/v1/messages/${messageId}/context/sources`, { headers, signal: AbortSignal.timeout(5_000) })
          const business = await fetch(`${base}/v1/commands`, { method: 'POST', headers, signal: AbortSignal.timeout(5_000),
            body: JSON.stringify({ kind: 'chat', commandId: 'w21-readonly-must-not-send', conversationId, projectId, text: 'Do not send' }) })
          const page = await (await fetch(`${base}/v1/conversations/${encodeURIComponent(conversationId)}/messages`, { headers, signal: AbortSignal.timeout(5_000) })).json()
          const health = await (await fetch(`${base}/v1/health`, { signal: AbortSignal.timeout(5_000) })).json()
          details = { candidates: candidates.status, history: history.status, sources: sources.status, business: business.status,
            originalBody: page.messages?.some(message => message.role === 'user' && message.text === text) === true,
            health: { status: health.status, mode: health.mode, startupMode: health.startupMode, digest: health.restoredReviewDigest ?? null },
            queueAfter: JSON.stringify(messageFacts(restored).queue), queueBefore: JSON.stringify(queueBefore) }
        } finally { await stopOwned(install, { state: restored, config, mockFile: mock.file }) }
        assert('REVIEW_UNBOUND_REFUSED', unboundStatuses.status === 'RUNNING' && unboundStatuses.candidates === 403 && unboundStatuses.history === 403, JSON.stringify(unboundStatuses))
        assert('REVIEW_BOUND_READS', details.candidates === 200 && details.history === 200 && details.sources === 200 && details.originalBody === true,
          JSON.stringify({ candidates: details.candidates, history: details.history, sources: details.sources, body: details.originalBody }))
        assert('REVIEW_BUSINESS_REFUSED', details.business === 422, String(details.business))
        assert('REVIEW_QUEUE_HELD', details.queueAfter === details.queueBefore, 'queue changed')
        assert('REVIEW_NO_PROVIDER', mock.requests.length === observed.modelRequests, JSON.stringify({ before: observed.modelRequests, after: mock.requests.length }))
        assert('REVIEW_HEALTH_READONLY', details.health.status === 'ok' && details.health.startupMode === 'recovery_readonly', JSON.stringify(details.health))
        const scopeDiagnostics = /scopeReview/u.test(readFileSync(join(install, 'app/apps/coordinator/http/app.ts'), 'utf8'))
          ? 'present' : 'NOT_REACHED_712_absent'
        const entry = consumerEntry(install, target)
        assert('REVIEW_CONSUMER_PACKAGE', entry.origin === 'package' && entry.package.source === target.sourceCommit &&
          entry.package.buildId === target.buildId && entry.files.every(file => /^[a-f0-9]{64}$/u.test(file.sha256)),
          JSON.stringify(entry.package))
        evidence.personalReview = {
          subject: frozenArtifactSubject(target), mode: 'personal', state: 'recovery_readonly', consumerEntry: entry,
          before: unboundStatuses, after: { candidates: details.candidates, history: details.history, sources: details.sources, originalBody: details.originalBody },
          reviewFile: { mode: '600', access: 'historical_data_read_only', startupAvailable: false, projects: 1 },
          business: details.business, queueHeld: true, providerRequests: mock.requests.length, health: details.health,
          healthDigest: details.health.digest, scopeDiagnostics, packageCapability: packageCapability(install, target),
          registry: observed.registry, restore: { verify: observed.verify, restore: observed.restore },
        }
      } finally { rmSync(reviewFile, { force: true }) }
    }))

  cases.push(await runCase({ ...define('E5-RESTORED-REVIEW-REFUSALS', 'Tampered, foreign, unsafe or blocking review inputs are refused by the package consumer without a readable instance'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('REFUSAL_PROVISIONED', observed !== undefined, failure ?? 'no observation')
      if (!observed) return
      const { install, restored, config, mock, projectId } = observed
      const own = observed.own, good = join(own, 'refusal-good.json'), secondRoot = join(own, 'second-root')
      const results = {}
      const refusedStart = async (file, state = restored) => {
        const [port, apiPort] = [await freePort(), await freePort()]
        const run = startPackage(install, { state, config, reviewFile: file, port, apiPort, mockFile: mock.file })
        const value = await run.value
        try { await stopOwned(install, { state, config, mockFile: mock.file }) } catch { /* best effort */ }
        return { status: value.status, code: value.code ?? null, healthy: value.status === 'RUNNING' && !!value.instance?.apiURL }
      }
      const cli = packagePrepare(install, { state: restored, project: projectId, allow: ['src/'], output: good })
      assert('REFUSAL_PREPARE', cli.status === 0, cli.stderr)
      try {
        const original = JSON.parse(readFileSync(good, 'utf8'))
        const writeCase = (name, mutate, mode = 0o600) => {
          const target = join(own, `${name}.json`)
          const value = JSON.parse(JSON.stringify(original)); mutate(value)
          writeFileSync(target, JSON.stringify(value, null, 2), { mode }); chmodSync(target, mode)
          return target
        }
        results.tamperedSignature = await refusedStart(writeCase('tampered', value => { value.signature = `${value.signature.slice(0, -2)}xx` }))
        const bundle = join(own, 'again.pab')
        launcher(install, ['backup', '--out', bundle, '--json'], { env: { PA_CONFIG_ROOT: config, PA_DATA_ROOT: restored, PA_MODEL_CONFIG: mock.file } })
        launcher(install, ['restore', '--bundle', bundle, '--to', secondRoot, '--json'], { env: { PA_CONFIG_ROOT: config, PA_MODEL_CONFIG: mock.file } })
        results.foreignRoot = await refusedStart(good, secondRoot)
        results.publicMode = await refusedStart(writeCase('public', () => {}, 0o644))
        const link = join(own, 'link.json'); symlinkSync(good, link)
        results.symlink = await refusedStart(link)
        const fifo = join(own, 'input.fifo'); execFileSync('mkfifo', [fifo])
        results.fifo = await refusedStart(fifo)
        results.expired = await refusedStart(writeCase('expired', value => { value.payload.expiresAt = '2000-01-01T00:00:00.000Z' }))
        const exists = packagePrepare(install, { state: restored, project: projectId, allow: ['src/'], output: good })
        results.existingOutput = { status: exists.status }
        const unknown = packagePrepare(install, { state: restored, project: 'no-such-project', allow: ['src/'], output: join(own, 'unknown.json') })
        results.unknownProject = { status: unknown.status }
        const unsafe = packagePrepare(install, { state: restored, project: projectId, allow: ['../outside'], output: join(own, 'unsafe.json') })
        results.unsafePath = { status: unsafe.status }

        assert('REFUSAL_TAMPERED', results.tamperedSignature.healthy === false, JSON.stringify(results.tamperedSignature))
        assert('REFUSAL_FOREIGN_ROOT', results.foreignRoot.healthy === false, JSON.stringify(results.foreignRoot))
        assert('REFUSAL_PUBLIC_MODE', results.publicMode.healthy === false, JSON.stringify(results.publicMode))
        assert('REFUSAL_SYMLINK', results.symlink.healthy === false, JSON.stringify(results.symlink))
        assert('REFUSAL_FIFO', results.fifo.healthy === false, JSON.stringify(results.fifo))
        assert('REFUSAL_EXPIRED', results.expired.healthy === false, JSON.stringify(results.expired))
        assert('REFUSAL_EXISTING_OUTPUT', results.existingOutput.status !== 0, JSON.stringify(results.existingOutput))
        assert('REFUSAL_UNKNOWN_PROJECT', results.unknownProject.status !== 0, JSON.stringify(results.unknownProject))
        assert('REFUSAL_UNSAFE_PATH', results.unsafePath.status !== 0, JSON.stringify(results.unsafePath))
        evidence.restoredReviewRefusals = { subject: frozenArtifactSubject(target), mode: 'personal', consumerEntry: consumerEntry(install, target),
          results, notTestedEntry: ['foreign principal/host/key with a valid signature'],
          notTestedReason: 'forging a valid signature would require the probe-owned action key; main module contract covers it, E does not re-sign' }
      } finally { rmSync(good, { force: true }); rmSync(secondRoot, { recursive: true, force: true }) }
    }))

  const diagnosticsSupported = observed
    ? /scopeReview/u.test(readFileSync(join(observed.install, 'app/apps/coordinator/http/app.ts'), 'utf8')) : false
  if (!diagnosticsSupported)
    cases.push(notTested({ ...define('E7-SCOPE-DIAGNOSTICS', 'Optional read-scope diagnostics explain a narrowed review without changing the body or authorization'), evidence: {} },
      'NOT_REACHED: the frozen target package does not contain the optional ?scopeReview=1 implementation (main 712); default response shape and authorization are unchanged.'))
  else
    cases.push(await runCase({ ...define('E7-SCOPE-DIAGNOSTICS', 'Optional read-scope diagnostics explain a narrowed review without changing the body or authorization'), evidence: {} },
      async ({ assert, evidence }) => {
        assert('DIAGNOSTICS_PROVISIONED', observed !== undefined, failure ?? 'no observation')
        if (!observed) return
        const { install, restored, config, mock, projectId, messageId, conversationId } = observed
        const wide = join(observed.own, 'diag-wide.json'), narrow = join(observed.own, 'diag-narrow.json')
        const preparedWide = packagePrepare(install, { state: restored, project: projectId, allow: ['src/'], output: wide })
        assert('DIAGNOSTICS_PREPARE', preparedWide.status === 0, preparedWide.stderr)
        const [port, apiPort] = [await freePort(), await freePort()]
        let outcome = {}
        try {
          const started = startPackage(install, { state: restored, config, reviewFile: wide, port, apiPort, mockFile: mock.file })
          const value = await started.value
          assert('DIAGNOSTICS_START', value.status === 'RUNNING' || value.status === 'REUSED', JSON.stringify(value).slice(0, 300))
          const key = readFileSync(join(restored, 'api.key'), 'utf8').trim()
          const headers = { authorization: `Bearer ${key}` }
          const base = `http://127.0.0.1:${apiPort}`
          const plain = await fetch(`${base}/v1/messages/${messageId}/context/sources`, { headers, signal: AbortSignal.timeout(5_000) })
          const plainBody = await plain.json().catch(() => ({}))
          const optIn = await fetch(`${base}/v1/messages/${messageId}/context/sources?scopeReview=1`, { headers, signal: AbortSignal.timeout(5_000) })
          const optInBody = await optIn.json().catch(() => ({}))
          const duplicate = await fetch(`${base}/v1/messages/${messageId}/context/sources?scopeReview=1&scopeReview=1`, { headers, signal: AbortSignal.timeout(5_000) })
          const unknown = await fetch(`${base}/v1/messages/${messageId}/context/sources?scopeReview=0`, { headers, signal: AbortSignal.timeout(5_000) })
          outcome = { plain: plain.status, plainHasDiagnostic: Object.prototype.hasOwnProperty.call(plainBody, 'scopeReview'),
            optIn: optIn.status, diagnostic: optInBody.scopeReview ?? null, duplicate: duplicate.status, unknown: unknown.status }
        } finally { await stopOwned(install, { state: restored, config, mockFile: mock.file }) }

        let narrowed = {}
        // A restart needs a fresh preparation against the current source, not the earlier file.
        const preparedNarrow = packagePrepare(install, { state: restored, project: projectId, allow: ['src/sub/'], output: narrow })
        assert('DIAGNOSTICS_NARROW_PREPARE', preparedNarrow.status === 0, preparedNarrow.stderr)
        const [narrowPort, narrowApiPort] = [await freePort(), await freePort()]
        try {
          const started = startPackage(install, { state: restored, config, reviewFile: narrow, port: narrowPort, apiPort: narrowApiPort, mockFile: mock.file })
          const value = await started.value
          if (value.status === 'RUNNING' || value.status === 'REUSED') {
            const key = readFileSync(join(restored, 'api.key'), 'utf8').trim()
            const headers = { authorization: `Bearer ${key}` }
            const base = `http://127.0.0.1:${narrowApiPort}`
            const plain = await fetch(`${base}/v1/messages/${messageId}/context/sources`, { headers, signal: AbortSignal.timeout(5_000) })
            const plainBody = await plain.json().catch(() => ({}))
            const optIn = await fetch(`${base}/v1/messages/${messageId}/context/sources?scopeReview=1`, { headers, signal: AbortSignal.timeout(5_000) })
            const optInBody = await optIn.json().catch(() => ({}))
            narrowed = { start: value.status, plain: plain.status, bodyServed: Array.isArray(plainBody.sources) && plainBody.sources.length > 0,
              state: plainBody.state ?? null, bindingSourceCount: Array.isArray(plainBody.binding?.sources) ? plainBody.binding.sources.length : 0,
              optIn: optIn.status, diagnostic: optInBody.scopeReview ?? null }
          } else narrowed = { start: value.status, code: value.code ?? null, detail: value.detail ?? null, stderr: value.stderr ?? null }
        } finally { await stopOwned(install, { state: restored, config, mockFile: mock.file }) }

        const diagnostic = outcome.diagnostic ?? {}
        assert('DIAGNOSTICS_DEFAULT_SHAPE', outcome.plain === 200 && outcome.plainHasDiagnostic === false, JSON.stringify(outcome).slice(0, 300))
        assert('DIAGNOSTICS_OPT_IN', outcome.optIn === 200 && diagnostic.protocol === 'context-scope-review/1' &&
          diagnostic.authorization === 'none' && typeof diagnostic.partial === 'boolean' &&
          (diagnostic.withheldSourceCount === null || Number.isSafeInteger(diagnostic.withheldSourceCount)) &&
          Array.isArray(diagnostic.reasons), JSON.stringify(diagnostic).slice(0, 300))
        assert('DIAGNOSTICS_STRICT_QUERY', [400, 422].includes(outcome.duplicate) && [400, 422].includes(outcome.unknown),
          JSON.stringify({ duplicate: outcome.duplicate, unknown: outcome.unknown }))
        assert('DIAGNOSTICS_NARROW', narrowed.start === 'RUNNING' || narrowed.start === 'REUSED',
          JSON.stringify(narrowed).slice(0, 300))
        assert('DIAGNOSTICS_NARROW_EXPLAINED', narrowed.bodyServed === false && narrowed.diagnostic?.authorization === 'none' &&
          (narrowed.diagnostic?.partial === true || (narrowed.diagnostic?.reasons?.length ?? 0) > 0),
          JSON.stringify(narrowed).slice(0, 400))
        evidence.scopeDiagnostics = { subject: frozenArtifactSubject(target), mode: 'personal', consumerEntry: consumerEntry(install, target),
          plain: outcome, narrow: narrowed }
      }))

  cases.push(await runCase({ ...define('E5-REVIEW-REUSE-CONSISTENCY', 'A live review instance is reused only for the same valid selection and never silently for a different, missing or unbound request'), evidence: {} },
    async ({ assert, evidence }) => {
      assert('REUSE_PROVISIONED', observed !== undefined, failure ?? 'no observation')
      if (!observed) return
      const { install, restored, config, mock, projectId } = observed
      const own = observed.own, first = join(own, 'reuse-first.json'), narrow = join(own, 'reuse-narrow.json'), gone = join(own, 'reuse-gone.json')
      const prepared = packagePrepare(install, { state: restored, project: projectId, allow: ['src/'], output: first })
      const preparedNarrow = packagePrepare(install, { state: restored, project: projectId, allow: ['src/sub/'], output: narrow })
      assert('REUSE_PREPARE', prepared.status === 0 && preparedNarrow.status === 0, JSON.stringify({ first: prepared.stderr, narrow: preparedNarrow.stderr }))
      const [port, apiPort] = [await freePort(), await freePort()]
      const request = async (reviewFile, extra = {}) => {
        const run = startPackage(install, { state: restored, config, reviewFile, port: extra.port ?? port, apiPort: extra.apiPort ?? apiPort, mockFile: mock.file })
        return run.value
      }
      const pidOf = () => {
        try { return JSON.parse(readFileSync(join(config, 'instance.json'), 'utf8')).pid ?? null } catch { return null }
      }
      const outcomes = {}
      try {
        const live = await request(first)
        assert('REUSE_FIRST_START', live.status === 'RUNNING' && !!live.instance?.apiURL, JSON.stringify(live).slice(0, 300))
        const firstPid = pidOf()
        const health = await (await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(5_000) })).json().catch(() => ({}))
        const digest = health.restoredReviewDigest ?? null
        outcomes.sameFile = await request(first)
        const sameDigest = (await (await fetch(`http://127.0.0.1:${apiPort}/v1/health`, { signal: AbortSignal.timeout(5_000) })).json().catch(() => ({}))).restoredReviewDigest ?? null
        outcomes.differentFile = await request(narrow)
        outcomes.missingFile = await request(null)
        outcomes.missingFilePath = await request(gone)
        outcomes.portChange = await request(first, { port: await freePort(), apiPort: await freePort() })
        const pidAfterRefusals = pidOf()
        await stopOwned(install, { state: restored, config, mockFile: mock.file })
        const unboundPort = await freePort(), unboundApi = await freePort()
        const unbound = startPackage(install, { state: restored, config, port: unboundPort, apiPort: unboundApi, mockFile: mock.file })
        const unboundValue = await unbound.value
        const unboundPid = pidOf()
        outcomes.unboundThenSelection = await request(first, { port: unboundPort, apiPort: unboundApi })
        const pidAfterUnbound = pidOf()
        await stopOwned(install, { state: restored, config, mockFile: mock.file })

        evidence.reviewReuse = { subject: frozenArtifactSubject(target), mode: 'personal', consumerEntry: consumerEntry(install, target),
          packageCapability: packageCapability(install, target),
          healthDigest: digest, digestAvailable: typeof digest === 'string', sameDigest,
          processes: { live: live.instance?.processStart ?? null, reused: outcomes.sameFile.instance?.processStart ?? null },
          firstPid, unboundPid, pidAfterRefusals, pidAfterUnbound, outcomes,
          scope: digest === null ? 'the frozen package predates the f856 selection digest; reuse identity is NOT_REACHED for this package' : 'selection digest present' }
        const reusedSame = value => value.status === 'REUSED' && (value.instance?.pid ?? null) === firstPid
        const notSilent = value => value.status !== 'REUSED' && !(value.status === 'RUNNING' && value.reused === true)
        assert('REUSE_SAME_FILE', reusedSame(outcomes.sameFile), JSON.stringify({ value: outcomes.sameFile, pid: firstPid }))
        assert('REUSE_DIGEST_PRESENT', typeof digest === 'string' && /^[a-f0-9]{64}$/u.test(digest), JSON.stringify({ digest }))
        assert('REUSE_DIGEST_UNCHANGED', sameDigest === digest, JSON.stringify({ digest, sameDigest }))
        assert('REUSE_SELECTION_OPERATION', outcomes.sameFile.instance?.mode === 'personal' &&
          outcomes.sameFile.instance?.startupMode === 'recovery_readonly' &&
          outcomes.sameFile.instance?.processStart === live.instance?.processStart,
          JSON.stringify({ live: live.instance?.processStart ?? null, same: outcomes.sameFile.instance?.processStart ?? null }))
        assert('REUSE_DIFFERENT_SELECTION_REFUSED', notSilent(outcomes.differentFile), JSON.stringify(outcomes.differentFile).slice(0, 300))
        assert('REUSE_MISSING_SELECTION_REFUSED', notSilent(outcomes.missingFile), JSON.stringify(outcomes.missingFile).slice(0, 300))
        assert('REUSE_PORT_NOT_SILENT', notSilent(outcomes.portChange), JSON.stringify(outcomes.portChange).slice(0, 300))
        assert('REUSE_UNBOUND_SELECTION_REFUSED', notSilent(outcomes.unboundThenSelection), JSON.stringify(outcomes.unboundThenSelection).slice(0, 300))
        assert('REUSE_PID_STABLE_ON_REFUSAL', pidAfterRefusals === firstPid && pidAfterUnbound === unboundPid,
          JSON.stringify({ firstPid, pidAfterRefusals, unboundPid, pidAfterUnbound }))

      } finally {
        for (const file of [first, narrow]) try { rmSync(file, { force: true }) } catch { /* best effort */ }
        try { await stopOwned(install, { state: restored, config, mockFile: mock.file }) } catch { /* best effort */ }
      }
    }))

  if (observed) {
    const consoleDir = join(observed.install, 'app/apps/console/dist')
    const marker = existsSync(consoleDir)
      ? execFileSync('sh', ['-c', `grep -rl "范围说明\|scope-review" ${JSON.stringify(consoleDir)} 2>/dev/null | head -1`], { encoding: 'utf8' }).trim()
      : ''
    cases.push(notTested({ ...define('E6-SOURCE-UI', 'The installed console shows source scope states and the explicit scope-review action on the packaged UI bytes'), evidence: {} },
      marker
        ? 'NOT_REACHED: a console marker exists in this package, but the independent browser interaction against these exact packaged bytes has not been recorded yet.'
        : 'NOT_REACHED: the frozen target package console does not contain the 0062 scope-review UI marker (main 4b); only the backend ?scopeReview=1 projection is present and tested. A package frozen with that UI is required for the user-facing assertion.'))
  }

  if (observed && !process.env.PA_E_KEEP) {
    try { rmSync(observed.own, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  if (observed && process.env.PA_E_KEEP) mark(`kept ${observed.own}`)
  return { cases, artifacts: {} }
}
