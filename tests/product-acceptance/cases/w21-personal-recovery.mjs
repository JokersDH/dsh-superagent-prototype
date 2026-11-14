import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact } from '../lib/frozen-package.mjs'
import { stopOwned as stopOwnedInstance } from '../lib/packaged-instance.mjs'

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

/**
 * Removes a record only when *every* recorded pid is provably dead, so a live api/console child can
 * never lose its record. An unreadable record is retained, not deleted.
 */
function clearDeadRecord(config) {
  const path = join(config, 'instance.json')
  if (!existsSync(path)) return
  let record
  try { record = JSON.parse(readFileSync(path, 'utf8')) } catch { return }
  const alive = pid => { if (!Number.isSafeInteger(pid)) return false; try { process.kill(pid, 0); return true } catch { return false } }
  const pids = [record.pid, record.apiPid, record.consolePid].filter(Number.isSafeInteger)
  if (pids.length > 0 && pids.every(pid => !alive(pid))) rmSync(path, { force: true })
}

function startPackage(install, { state, config, reviewFile, port, apiPort, mockFile, fixture = false, timeoutMs = 90_000 }) {
  clearDeadRecord(config)
  const args = ['start', '--json', '--port', String(port), '--api-port', String(apiPort), '--discussion-only']
  if (fixture) args.push('--fixture')
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

/**
 * Stops this probe-owned instance through the packaged `pa stop` boundary. A refusal or timeout keeps
 * the record and the process; nothing is force-killed by path similarity and no record is deleted.
 */
async function stopOwned(install, { state, config, mockFile, birth = null }) {
  return stopOwnedInstance({ install, config, state, own: dirname(install) }, { mockFile, birth, equivalentProof: true })
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


/** Public readiness schema keys, mirrored from the packaged contracts and validated independently. */
const READINESS_KEYS = ['protocol', 'observedAt', 'configurationRevision', 'mode', 'startupMode', 'discussion',
  'execution', 'development', 'projects', 'profiles', 'capabilities', 'authorization']
const READINESS_ENUM = {
  mode: ['fixture', 'product', 'personal'],
  startupMode: ['normal', 'recovery_readonly'],
  discussion: ['configuration_present', 'not_configured', 'provider_error', 'unknown'],
  development: ['configuration_present', 'needs_project', 'blocked', 'fixture_only', 'readonly', 'unknown'],
}
const countOk = value => Number.isSafeInteger(value) && value >= 0 && value <= 128
/** Independent structural and semantic check of GET /v1/readiness, not a reuse of the package parser. */
function readinessBodyIssues(body) {
  const issues = []
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return ['body_not_object']
  const keys = Object.keys(body).sort()
  if (JSON.stringify(keys) !== JSON.stringify([...READINESS_KEYS].sort())) issues.push(`keys:${keys.join(',')}`)
  if (body.protocol !== 'trial-readiness/1') issues.push('protocol')
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(String(body.observedAt ?? ''))) issues.push('observedAt')
  if (!/^[a-f0-9]{64}$/u.test(String(body.configurationRevision ?? ''))) issues.push('revision')
  for (const key of ['mode', 'startupMode', 'discussion', 'development'])
    if (!READINESS_ENUM[key].includes(body[key])) issues.push(key)
  const execution = body.execution
  const executionOk = execution?.state === 'unknown'
    ? Object.keys(execution).length === 1
    : execution?.state === 'unavailable' && typeof execution.reason === 'string' && execution.reason.length > 0
    || execution?.state === 'available' && ['native', 'controlled_fixture'].includes(execution.kind)
  if (!executionOk) issues.push('execution')
  for (const group of ['projects', 'profiles', 'capabilities']) {
    if (body[group] === null || typeof body[group] !== 'object') { issues.push(group); continue }
  }
  for (const key of ['development', 'discussion', 'dispatchable']) if (!countOk(body.projects?.[key])) issues.push(`projects.${key}`)
  for (const key of ['native', 'controlled', 'admittedNative', 'admittedControlled']) if (!countOk(body.profiles?.[key])) issues.push(`profiles.${key}`)
  for (const key of ['contextHistory', 'contextSources', 'decisions', 'proposals']) if (typeof body.capabilities?.[key] !== 'boolean') issues.push(`capabilities.${key}`)
  if (body.authorization !== 'none') issues.push('authorization')
  if (!issues.length) {
    if (body.profiles.admittedNative > body.profiles.native || body.profiles.admittedControlled > body.profiles.controlled) issues.push('admitted_over_total')
    if (body.projects.development + body.projects.discussion > 128 || body.projects.dispatchable > body.projects.development) issues.push('project_counts')
    if (body.startupMode === 'recovery_readonly' && (body.development !== 'readonly' || body.execution.state !== 'unavailable' ||
      body.execution.reason !== 'recovery_readonly' || body.projects.dispatchable !== 0 || body.profiles.admittedNative !== 0 ||
      body.profiles.admittedControlled !== 0 || body.capabilities.decisions || body.capabilities.proposals)) issues.push('readonly_invariants')
    if (body.development === 'configuration_present' && (body.mode === 'fixture' || body.startupMode !== 'normal' ||
      body.execution.state !== 'available' || body.execution.kind !== 'native' || !body.profiles.admittedNative || !body.projects.dispatchable)) issues.push('configuration_present_invariants')
  }
  return issues
}

async function fetchJson(url, { headers = {}, method = 'GET', body } = {}) {
  const response = await fetch(url, { headers, method, body, signal: AbortSignal.timeout(8_000) })
  let parsed = null
  try { parsed = await response.json() } catch { /* empty */ }
  return { status: response.status, body: parsed }
}

function gitProject(own, name) {
  const dir = join(own, name)
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'index.mjs'), 'export const ready = true\n')
  const git = args => execFileSync('git', args, { cwd: dir, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture',
    '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'W26 readiness project'])
  return dir
}

/** Starts one packaged instance, reads readiness with the real bearer and returns its observations. */
async function readinessProbe(observed, { reviewFile = null, fixture = false, mutate = false, fresh = false } = {}) {
  const { install, mock } = observed
  let config = observed.config, restored = observed.restored
  if (fresh) {
    config = join(observed.own, `w26-${fixture ? 'fixture' : 'personal'}-config`)
    restored = join(observed.own, `w26-${fixture ? 'fixture' : 'personal'}-state`)
    const first = launcher(install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: config, PA_DATA_ROOT: restored, PA_MODEL_CONFIG: mock.file } })
    if (first.status !== 0) return { status: 'FIRST_RUN_FAILED', firstRun: first.status, stderr: first.stderr }
  }
  const own = { status: null, mode: null, startupMode: null, readiness: null, configuration: null, negatives: {}, health: null }
  const [consolePort, apiPort] = [await freePort(), await freePort()]
  const started = startPackage(install, { state: restored, config, reviewFile, fixture, port: consolePort, apiPort, mockFile: mock.file })
  const value = await started.value
  own.status = value.status; own.code = value.code ?? null
  own.mode = value.instance?.mode ?? null; own.startupMode = value.instance?.startupMode ?? null
  if (value.status !== 'RUNNING' || !value.instance?.apiURL) return own
  const key = readFileSync(join(restored, 'api.key'), 'utf8').trim()
  const base = `http://127.0.0.1:${apiPort}`
  const auth = { authorization: `Bearer ${key}` }
  try {
    own.readiness = await fetchJson(`${base}/v1/readiness`, { headers: auth })
    own.issues = own.readiness.status === 200 ? readinessBodyIssues(own.readiness.body) : []
    const configuration = await fetchJson(`${base}/v1/configuration`, { headers: auth })
    own.configuration = configuration.status === 200 ? {
      revision: configuration.body.revision,
      projects: (configuration.body.projects ?? []).map(project => ({ discussionOnly: project.discussionOnly === true, dispatchAllowed: project.dispatchAllowed === true })),
      profiles: (configuration.body.profiles ?? []).map(profile => ({ kind: profile.kind, dispatchAllowed: profile.dispatchAllowed === true })),
      contextHistoryAvailable: configuration.body.contextHistoryAvailable === true,
      contextSourcesAvailable: configuration.body.contextSourcesAvailable === true,
      decisionsAvailable: configuration.body.decisionsAvailable === true,
      proposalsAvailable: configuration.body.proposalsAvailable === true,
    } : { status: configuration.status }
    own.health = (await fetchJson(`${base}/v1/health`)).body
    own.negatives.invalidBearer = (await fetchJson(`${base}/v1/readiness`, { headers: { authorization: 'Bearer 0'.repeat(32) } })).status
    own.negatives.noBearer = (await fetchJson(`${base}/v1/readiness`)).status
    const badQuery = await fetchJson(`${base}/v1/readiness?scope=1`, { headers: auth })
    own.negatives.badQuery = badQuery.status
    own.negatives.badQueryCode = badQuery.body?.error?.code ?? badQuery.body?.code ?? null
    const missingRoute = await fetchJson(`${base}/v1/readiness-not-a-route`, { headers: auth })
    own.negatives.missingRoute = missingRoute.status
    if (mutate) {
      const project = gitProject(observed.own, `w26-ready-${process.pid}-${Date.now()}`)
      const registered = await fetchJson(`${base}/v1/projects`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ path: project, displayName: 'W26 readiness project', check: 'node_test' }) })
      own.registration = registered.status
      own.after = await fetchJson(`${base}/v1/readiness`, { headers: auth })
    }
  } finally {
    await stopOwned(install, { state: restored, config, mockFile: mock.file })
  }
  return own
}

const isSubstantiveFinding = finding => finding !== null && typeof finding.code === 'string' && finding.code.length > 0 &&
  Array.isArray(finding.failures) && finding.failures.length > 0 && typeof finding.expected === 'string' && typeof finding.observed === 'string' && finding.expected !== finding.observed

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
            state: plainBody.state ?? null, bindingSourceCount: Array.isArray(plainBody.binding?.sources) ? plainBody.binding.sources.length : 0,
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
    cases.push(await runCase({ ...define('E7-READINESS', 'The packaged product serves GET /v1/readiness with its public schema, truthful normal/readonly/fixture facts and accurate refusals'), evidence: {} },
      async ({ assert, evidence }) => {
        const appSource = readFileSync(join(observed.install, 'app/apps/coordinator/http/app.ts'), 'utf8')
        assert('READINESS_ROUTE_PACKAGED', /app\.get\('\/v1\/readiness'/u.test(appSource), 'the packaged HTTP entry has no readiness route')
        const reviewFile = join(observed.own, 'w26-readiness-review.json')
        const prepared = packagePrepare(observed.install, { state: observed.restored, project: observed.projectId, allow: ['src/'], output: reviewFile })
        assert('READINESS_REVIEW_PREPARED', prepared.status === 0 && prepared.json?.status === 'prepared', JSON.stringify(prepared).slice(0, 300))
        const normal = await readinessProbe(observed, { fresh: true, mutate: true })
        const readonly = reviewFile && existsSync(reviewFile) ? await readinessProbe(observed, { reviewFile }) : { status: 'SKIPPED' }
        const fixture = await readinessProbe(observed, { fixture: true, fresh: true })
        evidence.readiness = { subject: frozenArtifactSubject(target), mode: 'personal', normal, readonly, fixture,
          mockRequests: observed.mock.requests.length, providerBefore: observed.modelRequests,
          consumer: consumerEntry(observed.install, target), packageCapability: packageCapability(observed.install, target) }

        assert('READINESS_NORMAL_START', normal.status === 'RUNNING' && normal.mode === 'personal' && normal.startupMode === 'normal', JSON.stringify({ status: normal.status, mode: normal.mode, startupMode: normal.startupMode }))
        assert('READINESS_AUTH_200', normal.readiness?.status === 200, JSON.stringify(normal.readiness).slice(0, 300))
        assert('READINESS_SCHEMA_VALID', normal.issues?.length === 0, JSON.stringify(normal.issues ?? normal.readiness).slice(0, 400))
        assert('READINESS_AUTHORIZATION_NONE', normal.readiness?.body?.authorization === 'none', String(normal.readiness?.body?.authorization))
        assert('READINESS_REVISION_BOUND', normal.readiness?.body?.configurationRevision === normal.configuration?.revision,
          JSON.stringify({ readiness: normal.readiness?.body?.configurationRevision, configuration: normal.configuration?.revision }))
        if (normal.configuration?.projects) {
          const projects = normal.configuration.projects
          const development = projects.filter(project => !project.discussionOnly).length
          const discussion = projects.length - development
          const profiles = normal.configuration.profiles
          const body = normal.readiness.body
          assert('READINESS_PROJECT_COUNTS', body.projects.development === development && body.projects.discussion === discussion,
            JSON.stringify({ expected: { development, discussion }, actual: body.projects }))
          assert('READINESS_PROFILE_COUNTS', body.profiles.native === profiles.filter(item => item.kind === 'native').length &&
            body.profiles.controlled === profiles.filter(item => item.kind === 'controlled_fixture').length &&
            body.profiles.admittedNative === profiles.filter(item => item.kind === 'native' && item.dispatchAllowed).length,
            JSON.stringify({ actual: body.profiles, profiles }))
          assert('READINESS_CAPABILITIES_BOUND', body.capabilities.contextHistory === normal.configuration.contextHistoryAvailable &&
            body.capabilities.contextSources === normal.configuration.contextSourcesAvailable &&
            body.capabilities.decisions === normal.configuration.decisionsAvailable &&
            body.capabilities.proposals === normal.configuration.proposalsAvailable, JSON.stringify({ body: body.capabilities, configuration: normal.configuration }))
        }
        assert('READINESS_AUTH_REFUSED', normal.negatives.invalidBearer === 401, String(normal.negatives.invalidBearer))
        assert('READINESS_QUERY_REFUSED', normal.negatives.badQuery === 400 && normal.negatives.badQueryCode === 'invalid_request',
          JSON.stringify({ status: normal.negatives.badQuery, code: normal.negatives.badQueryCode }))
        assert('READINESS_UNKNOWN_ROUTE_REFUSED', normal.negatives.missingRoute === 404, String(normal.negatives.missingRoute))
        assert('READINESS_NO_STALE_REVISION', normal.registration === 200 && normal.after?.status === 200 &&
          normal.after.body.configurationRevision !== normal.readiness.body.configurationRevision &&
          normal.after.body.projects.development === normal.readiness.body.projects.development + 1 &&
          Date.parse(normal.after.body.observedAt) > Date.parse(normal.readiness.body.observedAt),
          JSON.stringify({ registration: normal.registration, before: normal.readiness?.body, after: normal.after?.body }).slice(0, 500))
        assert('READINESS_READONLY_FACTS', readonly.status === 'RUNNING' && readonly.startupMode === 'recovery_readonly' &&
          readonly.readiness?.status === 200 && readonly.issues?.length === 0 &&
          readonly.readiness.body.mode === 'personal' && readonly.readiness.body.development === 'readonly' &&
          readonly.readiness.body.execution?.state === 'unavailable' && readonly.readiness.body.execution?.reason === 'recovery_readonly' &&
          readonly.readiness.body.projects.dispatchable === 0 && readonly.readiness.body.profiles.admittedNative === 0 &&
          readonly.readiness.body.profiles.admittedControlled === 0 && readonly.readiness.body.capabilities.decisions === false &&
          readonly.readiness.body.capabilities.proposals === false,
          JSON.stringify({ status: readonly.status, body: readonly.readiness?.body, issues: readonly.issues }).slice(0, 500))
        assert('READINESS_FIXTURE_FACTS', fixture.status === 'RUNNING' && fixture.mode === 'fixture' &&
          fixture.readiness?.status === 200 && fixture.issues?.length === 0 &&
          fixture.readiness.body.mode === 'fixture' && fixture.readiness.body.development === 'fixture_only' &&
          fixture.readiness.body.authorization === 'none',
          JSON.stringify({ status: fixture.status, body: fixture.readiness?.body, issues: fixture.issues }).slice(0, 500))
        assert('READINESS_NO_SEND', observed.mock.requests.length === observed.modelRequests,
          JSON.stringify({ before: observed.modelRequests, after: observed.mock.requests.length }))
      }))
  }

  if (observed) {
    cases.push(await runCase({ ...define('E8-PACKAGED-STOP-CONSISTENCY', 'The packaged launcher can stop the restored discussion-only instance it recorded, and a refusal is a recorded product finding'),
      evidence: {} }, async ({ assert, evidence }) => {
      const { install, restored, config, mock } = observed
      const [port, apiPort] = [await freePort(), await freePort()]
      const started = startPackage(install, { state: restored, config, port, apiPort, mockFile: mock.file })
      const value = await started.value
      const health = value.status === 'RUNNING' && value.instance?.apiURL
        ? await fetch(`${value.instance.apiURL}/v1/health`, { signal: AbortSignal.timeout(5_000) }).then(r => r.json()).catch(() => null) : null
      const record = (() => { try { return JSON.parse(readFileSync(join(config, 'instance.json'), 'utf8')) } catch { return null } })()
      const direct = value.status === 'RUNNING'
        ? spawnSync(join(install, 'bin/pa'), ['stop', '--json'], { cwd: join(install, '..'), encoding: 'utf8', timeout: 40_000,
          env: { ...process.env, PA_NODE: process.execPath, PA_CONFIG_ROOT: config, PA_DATA_ROOT: restored } })
        : null
      const stopJson = parseJson(direct?.stdout) ?? null
      const cleaned = await stopOwned(install, { state: restored, config, mockFile: mock.file })
      const finding = stopJson?.status === 'BLOCKED' ? { owner: 'main/D packaged launcher', code: stopJson.code,
        failures: stopJson.detail?.failures ?? [], expected: stopJson.detail?.checks?.find(c => c.id === 'runtime_mode')?.detail?.expected ?? record?.mode ?? null,
        observed: stopJson.detail?.checks?.find(c => c.id === 'runtime_mode')?.detail?.observed ?? health?.mode ?? null,
        argv: record?.launcherArgv ?? null, healthMode: health?.mode ?? null, healthStartupMode: health?.startupMode ?? null,
        recordMode: record?.mode ?? null, command: 'pa start --discussion-only (restored state, no review file) then pa stop --json',
        exit: direct?.status ?? null, reproducible: true } : null
      evidence.packagedStop = { subject: frozenArtifactSubject(target), status: value.status, healthMode: health?.mode ?? null, healthStartupMode: health?.startupMode ?? null,
        recordMode: record?.mode ?? null, stopStatus: stopJson?.status ?? null, stopCode: stopJson?.code ?? null,
        finding, cleaned: { clean: cleaned.clean, package: cleaned.packageStop?.json?.status ?? null, refusal: cleaned.packageRefusal ?? null,
          recordRemoved: cleaned.recordRemoved ?? null, signals: cleaned.signals, reason: cleaned.reason ?? null } }
      assert('STOP_CASE_STARTED', value.status === 'RUNNING' && record !== null, JSON.stringify(value).slice(0, 300))
      assert('STOP_REPORTED', direct !== null && (stopJson?.status === 'STOPPED' || stopJson?.status === 'STOPPED_ORPHAN' || stopJson?.status === 'BLOCKED'),
        JSON.stringify({ stop: stopJson, stderr: String(direct?.stderr ?? '').slice(-300) }))
      assert('STOP_OUTCOME_RECORDED', stopJson?.status !== 'BLOCKED' || finding?.code === 'instance_identity_mismatch',
        JSON.stringify(stopJson))
      assert('STOP_CLEANED_WITH_PROOF', cleaned.clean === true, JSON.stringify({ reason: cleaned.reason, refusal: cleaned.packageRefusal }))
      if (stopJson?.status === 'BLOCKED') {
        assert('STOP_FINDING_FIELDS', isSubstantiveFinding(finding), JSON.stringify(finding))
        assert('STOP_FINDING_PROVEN_CLEANUP', (cleaned.signals ?? []).length > 0 && cleaned.signals.every(item => item.ok === true) &&
          cleaned.recordRemoved === true, JSON.stringify(cleaned.signals))
      }
    }))
  }

  if (observed) {
    const consoleDir = join(observed.install, 'app/apps/console/dist')
    const marker = (() => {
      try {
        for (const name of readdirSync(join(consoleDir, 'assets'))) {
          if (!name.endsWith('.js')) continue
          const text = readFileSync(join(consoleDir, 'assets', name), 'utf8')
          if (text.includes('查看范围说明')) return name
        }
      } catch (error) { mark(`marker probe failed: ${error?.message}`) }
      return ''
    })()
    cases.push(notTested({ ...define('E6-SOURCE-UI', 'The installed console shows source scope states and the explicit scope-review action on the packaged UI bytes'), evidence: {} },
      marker
        ? 'NOT_REACHED: the scope-review marker exists in this package and its backend ?scopeReview=1 plain/narrow responses are measured, but the independent browser expansion of a restored message scope has not been recorded. Navigation and the trial workbench are separately browser-verified in E3-TRIAL-WORKBENCH-UI.'
        : 'NOT_REACHED: the frozen target package console does not contain the 0062 scope-review UI marker (main 4b); only the backend ?scopeReview=1 projection is present and tested. A package frozen with that UI is required for the user-facing assertion.'))
  }

  if (observed && !process.env.PA_E_KEEP) {
    try { rmSync(observed.own, { recursive: true, force: true }) } catch { /* best effort */ }
  }
  if (observed && process.env.PA_E_KEEP) mark(`kept ${observed.own}`)
  return { cases, artifacts: {} }
}
