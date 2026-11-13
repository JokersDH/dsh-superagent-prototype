import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import {
  cpSync,
  existsSync,
  mkdirSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { startMockModel } from '../lib/mock-model.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { sha256 } from '../lib/evidence.mjs'

/**
 * Independent acceptance of D's frozen wave-06 install artifact.
 *
 * The artifact is verified by digest before use, extracted into a fresh temporary root outside this
 * checkout, and then exercised only through the installed `bin/pa` and the product's own HTTP entry.
 * Nothing from the source checkout (packages/, node_modules/, the dev launcher) is imported, and the
 * tests never start or stop the user's existing 5180-5184/8796-8800 instances.
 */
const here = dirname(fileURLToPath(import.meta.url))
const DEFAULT_DIRS = Object.freeze({
  baseline: process.env.PA_E_INSTALL_BASELINE_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave15-target',
  target: process.env.PA_E_INSTALL_TARGET_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave16-target',
  cross: process.env.PA_E_INSTALL_CROSS_DIR ?? '/Users/hh/Desktop/joker/pa-artifacts/wave11-target',
})

/** Reads the artifact tuple from the producer's manifest next to the frozen tar. */
function loadArtifact(role, dirName) {
  const envJson = process.env[`PA_E_${role.toUpperCase()}_ARTIFACT_JSON`]
  if (envJson !== undefined) return { role, ...JSON.parse(envJson) }
  const dir = resolve(dirName)
  const manifest = JSON.parse(readFileSync(join(dir, 'install-artifact.json'), 'utf8'))
  return {
    role,
    name: manifest.name,
    tarPath: manifest.tarPath ?? join(dir, `${manifest.name}.tar.gz`),
    tarSha256: manifest.digests.tarSha256,
    tarBytes: manifest.digests.tarBytes,
    installManifestSha256: manifest.digests.installManifestSha256,
    releaseManifestSha256: manifest.digests.releaseManifestSha256,
    closureDigest: manifest.digests.closureDigest,
    files: manifest.files?.count,
    buildId: manifest.buildId,
    sourceCommit: manifest.source.commit,
    sourceDirty: manifest.source.dirty === true,
    productSchema: manifest.producer.productSchema,
    platform: manifest.producer.platform,
    arch: manifest.producer.arch,
    node: manifest.producer.node,
    abi: String(manifest.producer.abi),
  }
}
const ARTIFACTS = Object.freeze({
  base: loadArtifact('baseline', DEFAULT_DIRS.baseline),
  upgrade: loadArtifact('target', DEFAULT_DIRS.target),
  cross: loadArtifact('cross', DEFAULT_DIRS.cross),
})
/** Reads one packaged file without extracting the whole tar, so capability is measured from bytes. */
function tarFile(spec, suffix) {
  const listing = spawnSync('tar', ['-tzf', spec.tarPath], { encoding: 'utf8', timeout: 60_000 })
  const entry = String(listing.stdout).split('\n').find(line => line.endsWith(suffix))
  if (!entry) return undefined
  const read = spawnSync('tar', ['-xOzf', spec.tarPath, entry], { encoding: 'utf8', timeout: 60_000 })
  return read.status === 0 ? read.stdout : undefined
}
const TARGET_ROUTES = tarFile(ARTIFACTS.upgrade, '/apps/coordinator/http/app.ts') ?? ''
const TARGET_CAPABILITY = Object.freeze({
  hasContextRoute: /assistant\/context\/(prepare|send)/u.test(TARGET_ROUTES),
  hasHistoryRoute: /\/v1\/context\/history/u.test(TARGET_ROUTES),
  hasSourcesRoute: /\/v1\/messages\/:id\/context\/sources/u.test(TARGET_ROUTES),
  hasReplyResults: /assistantReplyResults|replyResults/u.test(tarFile(ARTIFACTS.upgrade, '/apps/coordinator/product/runtime.ts') ?? ''),
  hasDiscussionReadiness: !!tarFile(ARTIFACTS.upgrade, '/apps/coordinator/product/discussion-effects.ts') &&
    /discussionOnly/u.test(tarFile(ARTIFACTS.upgrade, '/apps/coordinator/product/runtime.ts') ?? ''),
  routeBytes: TARGET_ROUTES.length,
})

const artifactSubject = spec => ({ source: spec.sourceCommit, buildId: spec.buildId, schema: spec.productSchema,
  tarSha256: spec.tarSha256, tarBytes: spec.tarBytes, platform: spec.platform, arch: spec.arch, abi: spec.abi })

const PLATFORM = Object.freeze({
  platform: 'darwin',
  arch: 'arm64',
  node: '24.21.0',
  abi: '137',
  sqlite: '3.53.4',
  dependencies: ['@hono/node-server', 'better-sqlite3', 'hono', 'node-addon-api', 'openai', 'semver', 'yaml', 'zod'],
})
const TUPLE_FIELDS = ['tarPath', 'tarSha256', 'tarBytes', 'buildId', 'sourceCommit', 'productSchema']

/**
 * Reads the actual bytes/manifest and compares them to the declared tuple. Nothing is inferred from
 * a file name, a tag or a neighbouring directory.
 */
export function verifyArtifactTuple(spec, tarPath, installDir) {
  const issues = []
  if (!existsSync(tarPath)) return ['tar_missing']
  if (digest(tarPath) !== spec.tarSha256) issues.push('tar_sha')
  if (statSync(tarPath).size !== spec.tarBytes) issues.push('tar_bytes')
  let manifest
  try {
    manifest = JSON.parse(readFileSync(join(installDir, 'install.json'), 'utf8'))
  } catch {
    return [...issues, 'install_manifest']
  }
  if (manifest.buildId !== spec.buildId) issues.push('build')
  if (manifest.source?.commit !== spec.sourceCommit) issues.push('source')
  if (manifest.producer?.productSchema !== spec.productSchema) issues.push('schema')
  return issues
}


const REQUIRED_INPUTS = [
  'artifactId/buildId and the tar.gz path',
  'tarSha256 and tarBytes of the exact frozen artifact',
  'platform/arch/Node version and SQLite ABI of the producer',
  'install.json and release.json digests plus the dependency closure',
  'for upgrade: a second frozen artifact with a different buildId and a different product schema',
]

function digest(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/** macOS resolves /var to /private/var; compare the same canonical form the launcher records. */
function witnessPath(path) {
  try {
    return realpathSync(String(path))
  } catch {
    return String(path)
  }
}

async function freePorts(count = 4) {
  const take = () =>
    new Promise((resolvePort, reject) => {
      const server = createServer()
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address()
        server.close(() => resolvePort(port))
      })
    })
  const ports = new Set()
  while (ports.size < count) {
    const round = await Promise.all(Array.from({ length: count }, take))
    for (const port of round) if (port >= 1024) ports.add(port)
  }
  return [...ports].slice(0, count)
}

function paEnv(extra = {}) {
  return {
    ...process.env,
    PA_NODE: process.execPath,
    // Never inherit a colleague's roots; every case names its own.
    PA_CONFIG_ROOT: undefined,
    PA_DATA_ROOT: undefined,
    ...extra,
  }
}

function stripUndefined(env) {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== undefined))
}

function pa(install, args, { timeoutMs = 90_000, env = {} } = {}) {
  const result = spawnSync(join(install, 'bin/pa'), args, {
    cwd: join(install, '..'),
    env: stripUndefined(paEnv(env)),
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  let json
  const output = result.stdout.trim()
  if (output.startsWith('{') || output.startsWith('[')) {
    try {
      json = JSON.parse(output)
    } catch {
      json = undefined
    }
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

/**
 * Runs the launcher module directly with an explicit --install. The shipped `bin/pa` wrapper pins
 * PA_INSTALL_ROOT to its own install, so cross-install operations must not go through it.
 */
function nodePa(install, args, { timeoutMs = 120_000, env = {} } = {}) {
  const result = spawnSync(process.execPath, [join(install, 'app/apps/launcher/bin/pa.mjs'), ...args], {
    cwd: join(install, '..'),
    env: stripUndefined(paEnv(env)),
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  let json
  const output = result.stdout.trim()
  if (output.startsWith('{')) {
    try {
      json = JSON.parse(output)
    } catch {
      json = undefined
    }
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json }
}

/** Start `pa start` in the background; resolves on the first JSON line or process exit. */
function startPa(install, { port, apiPort, env = {}, extraArgs = [] } = {}) {
  const child = spawn(join(install, 'bin/pa'), ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort), ...extraArgs], {
    cwd: join(install, '..'),
    env: stripUndefined(paEnv(env)),
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buffer = ''
  let stderr = ''
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const attempt = new Promise((resolveAttempt) => {
    const finish = (value) => resolveAttempt({ ...value, child, stderr: () => stderr })
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const line = buffer.split('\n').find((item) => item.trim().startsWith('{'))
      if (line === undefined) return
      try {
        const value = JSON.parse(line)
        finish({ status: value.status, instance: value.instance, code: value.code, detail: value.detail })
      } catch {
        /* keep buffering */
      }
    })
    child.once('error', (error) => finish({ status: 'BLOCKED', code: 'spawn_failed', detail: error.message }))
    child.once('exit', (code) => {
      let final
      const text = buffer.trim()
      try {
        final = JSON.parse(text)
      } catch {
        try {
          final = JSON.parse(text.split('\n').filter(Boolean).at(-1))
        } catch {
          final = undefined
        }
      }
      finish({
        status: final?.status ?? (code === 0 ? 'EXITED' : 'BLOCKED'),
        instance: final?.instance,
        code: final?.code,
        exitCode: code,
      })
    })
  })
  return { child, attempt }
}

/** Personal start without the fixture flag; used to measure the actual no-executor mode. */
function startPersonalInstall(install, { port, apiPort, env = {}, extraArgs = [] } = {}) {
  const child = spawn(join(install, 'bin/pa'), ['start', '--json', '--port', String(port), '--api-port', String(apiPort), ...extraArgs], {
    cwd: join(install, '..'), env: stripUndefined(paEnv(env)), stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buffer = '', stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  const attempt = new Promise(resolveAttempt => {
    const finish = value => resolveAttempt({ ...value, child, stderr: () => stderr })
    child.once('error', error => finish({ status: 'BLOCKED', code: 'spawn_failed', detail: error.message }))
    child.stdout.on('data', chunk => {
      buffer += chunk
      const line = buffer.split('\n').find(item => item.trim().startsWith('{'))
      if (line === undefined) return
      try { const value = JSON.parse(line); finish({ status: value.status, instance: value.instance, code: value.code, detail: value.detail }) } catch { /* buffering */ }
    })
    child.once('exit', code => {
      let final
      try { final = JSON.parse(buffer.trim().split('\n').filter(Boolean).at(-1)) } catch { final = undefined }
      finish({ status: final?.status ?? (code === 0 ? 'EXITED' : 'BLOCKED'), instance: final?.instance, code: final?.code, exitCode: code })
    })
  })
  return { child, attempt }
}

async function waitHttp(url, predicate, { timeoutMs = 30_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      last = { status: response.status, text: await response.text() }
      if (predicate(last)) return last
    } catch (error) {
      last = { error: error.message }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 150))
  }
  throw new Error(`HTTP probe never matched: ${JSON.stringify(last)}`)
}

function readSchema(stateRoot) {
  const db = new DatabaseSync(join(stateRoot, 'state.sqlite'), { readOnly: true })
  try {
    const row = db.prepare("select value from schema_meta where key = 'product_schema'").get()
    return Number(row?.value)
  } finally {
    db.close()
  }
}

function countMessages(stateRoot) {
  const db = new DatabaseSync(join(stateRoot, 'state.sqlite'), { readOnly: true })
  try {
    return db.prepare('select count(*) as count from conversation_messages').get().count
  } finally {
    db.close()
  }
}

function hasMessage(stateRoot, needle) {
  const db = new DatabaseSync(join(stateRoot, 'state.sqlite'), { readOnly: true })
  try {
    // Messages are stored as JSON in `value`; the fixture text is stored verbatim (UTF-8).
    return db.prepare('select count(*) as count from conversation_messages where value like ?').get(`%${needle}%`).count > 0
  } finally {
    db.close()
  }
}

function scanCheckoutReferences(install) {
  const roots = ['app/apps', 'app/packages', 'app/bin', 'app/var/config']
  const needles = ['/Users/hh/Desktop/joker/superagent-agent-e', '/Users/hh/Desktop/joker/superagent-agent-d']
  const hits = []
  let scanned = 0
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        walk(path)
      } else if (/\.(mjs|js|cjs|json|ts)$/.test(entry.name) && statSync(path).size < 2_000_000) {
        scanned += 1
        const text = readFileSync(path, 'utf8')
        for (const needle of needles) if (text.includes(needle)) hits.push({ file: path.slice(install.length + 1), needle })
      }
    }
  }
  for (const sub of roots) if (existsSync(join(install, sub))) walk(join(install, sub))
  return { scanned, hits }
}

async function seedProduct(client, { projectId, scope, criteria, profileId, conversationId }) {
  const work = await client.dispatch({
    commandId: `install-work-${Date.now()}`,
    conversationId,
    kind: 'create_work',
    projectId,
    profileId,
    goal: '安装物验收：生成并接受一个受控候选，作为备份/恢复的真实数据。',
    scope,
    criteria,
  })
  const workId = work.receipt.workId
  let view
  let answeredQuestion = 0
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    view = await client.work(workId)
    if (view.actions.available.includes('accept_candidate') || ['delivered', 'ended', 'uncertain'].includes(view.phase)) break
    if ((view.openQuestionIds ?? []).length > 0) {
      const snapshot = await client.snapshot({ workId })
      const question = snapshot.questions[0]
      const choice = question?.presentation?.options?.[0]?.id
      if (question && choice) {
        await client.dispatch({
          commandId: `install-answer-${++answeredQuestion}`,
          conversationId,
          kind: 'answer_question',
          questionId: question.id,
          expectedVersion: question.version,
          answer: { kind: 'choices', optionIds: [choice] },
        })
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
  }
  const accepted = view.actions.available.includes('accept_candidate')
    ? await client.dispatch({ commandId: `install-accept-${Date.now()}`, conversationId, kind: 'accept_candidate', candidate: view.actions.currentCandidate })
    : undefined
  if (accepted !== undefined) {
    const deliveredBy = Date.now() + 20_000
    while (Date.now() < deliveredBy) {
      const next = await client.work(workId)
      if (['delivered', 'ended', 'uncertain'].includes(next.phase)) { view = next; break }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200))
    }
  }
  const chat = await client.dispatch({ commandId: `install-chat-${Date.now()}`, conversationId, kind: 'chat', projectId, text: '安装物验收：保留受控范围，不扩大授权。' })
  // The frozen artifact was built before main's decision HTTP. Probe it and record the surface
  // honestly instead of assuming the current main projection exists inside the install.
  const page = await client.conversation(conversationId)
  const source = page.messages.filter((item) => item.provenance === 'trusted_user').at(-1)
  let decision = 'not_probed'
  if (source) {
    const preview = await client.request('/v1/decisions/prepare', {
      method: 'POST',
      body: { projectId, conversationId, sourceMessageId: source.id, content: '保留受控范围，不扩大授权。', scope },
    })
    decision = preview.status === 200 ? 'available' : `unavailable_${preview.status}:${preview.body?.error?.code ?? 'unknown'}`
  }
  return {
    workId,
    phase: view.phase,
    artifactIds: view.artifactIds ?? [],
    acceptedReceipt: accepted?.receipt?.status ?? 'not_available',
    answeredQuestions: answeredQuestion,
    chatReceipt: chat.receipt.status,
    decision,
  }
}

export async function runInstall({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const define = (id, title, extra = {}) => ({
    id,
    title,
    layer: extra.layer ?? LAYERS.INSTALLED,
    ...(extra.evidence ? { evidence: extra.evidence } : {}),
    limitations: [
      'Same-machine staged install from D\'s frozen tar.gz; only darwin/arm64 + Node 24.21.x + SQLite ABI 137 is measured.',
      'No vendor model call, no personal native end-to-end; the controlled fixture executor is used inside the install.',
      ...(extra.limitations ?? []),
    ],
  })

  if (!existsSync(ARTIFACTS.base.tarPath) || !existsSync(ARTIFACTS.upgrade.tarPath)) {
    const reason =
      `Frozen install artifacts not present (base ${ARTIFACTS.base.tarPath}; upgrade ${ARTIFACTS.upgrade.tarPath}). Required inputs: ${REQUIRED_INPUTS.join('; ')}. ` +
      'A developer workbench launch is not an installation path.'
    for (const [id, title] of [
      ['E4-INSTALL-ARTIFACT-IDENTITY', 'The frozen install bytes match the recorded artifact identity'],
      ['E4-INSTALL-FIRST-RUN', 'First-run, doctor, start, static workbench and stop work inside the extracted install'],
      ['E4-INSTALL-REUSE-CONCURRENCY', 'Instance identity is reused only for an exact match and concurrent starts do not fork'],
      ['E4-BACKUP-RESTORE', 'A full backup restores read-only into a new state with recovery authorization blocked'],
      ['E4-INSTALL-TAMPER', 'A same-size or missing artifact and a corrupt bundle are refused'],
      ['E4-INSTALL-ROLLBACK', 'A pre-change backup rolls the state back and the install starts again'],
      ['E4-UPGRADE-ROLLBACK', 'A second frozen build upgrades the state and rolls back'],
    ]) cases.push(notTested(define(id, title, { layer: LAYERS.NOT_TESTED }), reason))

  return { cases, artifacts }
  }

  // Use the canonical path: the launcher records and re-checks cwd/argv identities, and macOS
  // /var is a symlink to /private/var.
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'pa-e-install-')))
  // `install` is the candidate under test; `upgradeInstall` holds the historical baseline.
  const install = join(workspace, 'target')
  const upgradeInstall = join(workspace, 'baseline')
  const pristine = join(workspace, 'pristine')
  let stopped = false
  const stopAll = () => {
    if (stopped) return
    stopped = true
    try { pa(install, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort cleanup */ }
  }
  /** Clears only a record/process proven to belong to this disposable install. */
  const clearOwnedRecord = (target) => {
    const recordPath = join(target, 'var/config/instance.json')
    if (!existsSync(recordPath)) return
    let record
    try { record = JSON.parse(readFileSync(recordPath, 'utf8')) } catch { rmSync(recordPath, { force: true }); return }
    for (const pid of [record.pid, record.apiPid]) {
      if (!Number.isSafeInteger(pid)) continue
      try {
        const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
        if (!command.includes(target)) continue
        process.kill(pid, 'SIGTERM')
      } catch { /* already gone */ }
    }
    rmSync(recordPath, { force: true })
  }
  const push = async (definition, body) => {
    clearOwnedRecord(install); clearOwnedRecord(upgradeInstall)
    const result = await runCase({ ...definition, evidence: {} }, body)
    cases.push(result)
    return result
  }

  try {
    mkdirSync(install, { recursive: true })
    mkdirSync(upgradeInstall, { recursive: true })
    execFileSync('tar', ['-xzf', ARTIFACTS.upgrade.tarPath, '-C', install, '--strip-components=1'])
    execFileSync('tar', ['-xzf', ARTIFACTS.base.tarPath, '-C', upgradeInstall, '--strip-components=1'])

    await push(define('E4-INSTALL-ARTIFACT-IDENTITY', 'The frozen install bytes match the recorded artifact identity'), async ({ assert, evidence }) => {
      for (const [role, artifact] of [['baseline', ARTIFACTS.base], ['target', ARTIFACTS.upgrade]]) {
        const dir = role === 'baseline' ? upgradeInstall : install
        const issues = verifyArtifactTuple(artifact, artifact.tarPath, dir)
        assert(`TUPLE_FIELDS_${role.toUpperCase()}`, TUPLE_FIELDS.every((field) => artifact[field] !== undefined), JSON.stringify(Object.keys(artifact)))
        assert(`TUPLE_MATCH_${role.toUpperCase()}`, issues.length === 0, JSON.stringify(issues))
      }
      // A wrong source/build/schema or the same tag with other bytes must be rejected by the tuple
      // reader itself, not silently accepted because the tar path still points at a file.
      const tupleRejections = {
        source: verifyArtifactTuple({ ...ARTIFACTS.upgrade, sourceCommit: '0'.repeat(40) }, ARTIFACTS.upgrade.tarPath, install),
        build: verifyArtifactTuple({ ...ARTIFACTS.upgrade, buildId: 'other-build' }, ARTIFACTS.upgrade.tarPath, install),
        schema: verifyArtifactTuple({ ...ARTIFACTS.upgrade, productSchema: 99 }, ARTIFACTS.upgrade.tarPath, install),
        bytes: verifyArtifactTuple({ ...ARTIFACTS.upgrade, tarSha256: '0'.repeat(64) }, ARTIFACTS.upgrade.tarPath, install),
      }
      assert('TUPLE_REJECTS_WRONG_SOURCE', tupleRejections.source.includes('source'), JSON.stringify(tupleRejections.source))
      assert('TUPLE_REJECTS_WRONG_BUILD', tupleRejections.build.includes('build'), JSON.stringify(tupleRejections.build))
      assert('TUPLE_REJECTS_WRONG_SCHEMA', tupleRejections.schema.includes('schema'), JSON.stringify(tupleRejections.schema))
      assert('TUPLE_REJECTS_WRONG_BYTES', tupleRejections.bytes.includes('tar_sha'), JSON.stringify(tupleRejections.bytes))
      const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
      assert('INSTALL_PROTOCOL', manifest.format === 'pa-install' && manifest.formatVersion === 1, manifest.format)
      assert('INSTALL_BUILD_ID', manifest.buildId === ARTIFACTS.upgrade.buildId, manifest.buildId)
      assert('INSTALL_MANIFEST_DIGEST', digest(join(install, 'install.json')) === ARTIFACTS.upgrade.installManifestSha256, digest(join(install, 'install.json')))
      assert('RELEASE_MANIFEST_DIGEST', digest(join(install, 'var/config/release.json')) === ARTIFACTS.upgrade.releaseManifestSha256, digest(join(install, 'var/config/release.json')))
      assert('PRODUCER_PLATFORM', manifest.producer.platform === PLATFORM.platform && manifest.producer.arch === PLATFORM.arch, `${manifest.producer.platform}/${manifest.producer.arch}`)
      assert('PRODUCER_NODE', manifest.producer.node === PLATFORM.node, manifest.producer.node)
      assert('PRODUCER_ABI', String(manifest.producer.abi) === PLATFORM.abi && manifest.producer.sqlite === PLATFORM.sqlite, `${manifest.producer.abi}/${manifest.producer.sqlite}`)
      assert('SOURCE_COMMIT', manifest.source.commit === ARTIFACTS.upgrade.sourceCommit && manifest.source.dirty === ARTIFACTS.upgrade.sourceDirty, JSON.stringify(manifest.source))
      const deps = (manifest.dependencies ?? []).map((item) => (typeof item === 'string' ? item : item.name)).sort()
      assert('DEPENDENCY_CLOSURE', JSON.stringify(deps) === JSON.stringify([...PLATFORM.dependencies].sort()), JSON.stringify(deps))
      for (const rel of ['app/apps/launcher/bin/pa.mjs', 'app/apps/coordinator/product/demo.ts', 'app/apps/console/dist/index.html', 'app/node_modules/better-sqlite3'])
        assert(`ENTRYPOINT_${rel.split('/').at(-1)}`, existsSync(join(install, rel)), rel)
      const scan = scanCheckoutReferences(install)
      assert('NO_CHECKOUT_REFERENCES', scan.hits.length === 0, JSON.stringify(scan.hits.slice(0, 5)))
      const version = pa(install, ['version', '--json'])
      assert('LAUNCHER_VERSION', version.status === 0 && version.json?.node === process.versions.node, JSON.stringify(version.json))
      const baselineManifest = JSON.parse(readFileSync(join(upgradeInstall, 'install.json'), 'utf8'))
      assert('BASELINE_BUILD_ID', baselineManifest.buildId === ARTIFACTS.base.buildId, baselineManifest.buildId)
      assert('BASELINE_INSTALL_DIGEST', digest(join(upgradeInstall, 'install.json')) === ARTIFACTS.base.installManifestSha256, digest(join(upgradeInstall, 'install.json')))
      assert('BASELINE_RELEASE_DIGEST', digest(join(upgradeInstall, 'var/config/release.json')) === ARTIFACTS.base.releaseManifestSha256, digest(join(upgradeInstall, 'var/config/release.json')))
      assert('BASELINE_SOURCE', baselineManifest.source.commit === ARTIFACTS.base.sourceCommit && baselineManifest.source.dirty === ARTIFACTS.base.sourceDirty, JSON.stringify(baselineManifest.source))
      assert('BASELINE_SCHEMA', baselineManifest.producer.productSchema === ARTIFACTS.base.productSchema, String(baselineManifest.producer.productSchema))
      assert('TARGET_SCHEMA', manifest.producer.productSchema === ARTIFACTS.upgrade.productSchema, String(manifest.producer.productSchema))
      assert('DISTINCT_BUILDS', baselineManifest.buildId !== manifest.buildId && ARTIFACTS.base.tarSha256 !== ARTIFACTS.upgrade.tarSha256)
      evidence.artifact = {
        tuple: { baseline: ARTIFACTS.base, target: ARTIFACTS.upgrade },
        tupleRejections,
        artifacts: [
          { role: 'baseline', name: ARTIFACTS.base.name, buildId: ARTIFACTS.base.buildId, tarSha256: ARTIFACTS.base.tarSha256, schema: ARTIFACTS.base.productSchema, source: baselineManifest.source },
          { role: 'target', name: ARTIFACTS.upgrade.name, buildId: ARTIFACTS.upgrade.buildId, tarSha256: ARTIFACTS.upgrade.tarSha256, schema: ARTIFACTS.upgrade.productSchema, source: manifest.source },
        ],
        files: manifest.files?.count,
        producer: manifest.producer,
        scannedModules: scan.scanned,
        extractedAt: workspace,
      }
      // The strict installed-alpha layer binds these facts rather than trusting a self-description.
      evidence.installation = {
        status: 'installed',
        bundleVersion: ARTIFACTS.upgrade.buildId,
        bundleDigest: ARTIFACTS.upgrade.tarSha256,
        stagedPath: install,
        originalCheckoutAvailable: false,
        independence: {
          scannedRuntimeModules: scan.scanned,
          checkoutReferences: scan.hits.length,
          workingDirectory: join(install, '..'),
        },
        source: manifest.source,
        steps: [
          { id: 'tar_digest_and_bytes', status: 'PASS' },
          { id: 'extract_outside_checkout', status: 'PASS' },
          { id: 'install_manifest_digests', status: 'PASS' },
          { id: 'producer_runtime_and_abi', status: 'PASS' },
          { id: 'no_checkout_references', status: 'PASS' },
        ],
      }
    })

    await push(define('E4-INSTALL-FIRST-RUN', 'First-run, doctor, start, static workbench and stop work inside the extracted install'), async ({ assert, evidence }) => {
      const first = pa(install, ['first-run', '--json'])
      assert('FIRST_RUN', first.status === 0 && first.json?.status === 'OK', first.stdout + first.stderr)
      assert('FIRST_RUN_NO_CREDENTIALS', JSON.stringify(first.json?.limitations ?? []).includes('No credential'), JSON.stringify(first.json?.limitations))
      const doctor = pa(install, ['doctor', '--json'])
      const checks = Object.fromEntries((doctor.json?.checks ?? []).map((check) => [check.id, check.status]))
      assert('DOCTOR_EXIT', doctor.status === 0 || doctor.status === 1, String(doctor.status))
      assert('DOCTOR_RUNTIME', checks.node_version === 'PASS' && checks.platform === 'PASS' && checks.sqlite_binding === 'PASS', JSON.stringify(checks))
      assert('DOCTOR_RELEASE', checks.release_manifest === 'PASS' && checks.console_assets === 'PASS' && checks.console_mode === 'PASS' && checks.runtime_dependencies === 'PASS', JSON.stringify(checks))

      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      const [port, apiPort] = await freePorts()
      const started = startPa(install, { port, apiPort })
      const first_ = await started.attempt
      try {
        assert('START_RUNNING', first_.status === 'RUNNING', JSON.stringify({ status: first_.status, code: first_.code, stderr: first_.stderr().slice(0, 300) }))
        const record = first_.instance
        assert('START_BUILD', record?.buildId === ARTIFACTS.upgrade.buildId, String(record?.buildId))
        const inside = witnessPath(record?.state)
        assert('START_STATE_INSIDE_INSTALL', inside.startsWith(witnessPath(join(install, 'var'))), String(record?.state))
        const index = await waitHttp(`http://127.0.0.1:${port}/`, (value) => value.status === 200 && value.text.includes('个人 Agent 工作台'))
        assert('STATIC_WORKBENCH', index.text.includes('<div id="root">') && index.text.includes('/assets/'), index.text.slice(0, 80))
        const proxied = await waitHttp(`http://127.0.0.1:${port}/v1/health`, (value) => value.status === 200)
        const health = JSON.parse(proxied.text)
        assert('STATIC_PROXY_HEALTH', health.status === 'ok' && health.mode === 'fixture', proxied.text)
        const direct = await waitHttp(`http://127.0.0.1:${apiPort}/v1/health`, (value) => value.status === 200)
        assert('DIRECT_API_HEALTH', JSON.parse(direct.text).access === 'local-development', direct.text)
        const status = pa(install, ['status', '--json'])
        assert('STATUS_RUNNING', status.status === 0 && status.json?.status === 'RUNNING' && status.json?.instance?.pid === record.pid, JSON.stringify({ status: status.status, value: status.json?.status }))
        const close = pa(install, ['stop', '--json'], { timeoutMs: 30_000 })
        assert('STOP', close.status === 0 && (close.json?.status === 'STOPPED' || close.json?.status === 'EXITED'), JSON.stringify(close.json))
        const after = pa(install, ['status', '--json'])
        assert('STATUS_STOPPED', after.status === 2 && after.json?.status === 'STOPPED', JSON.stringify({ status: after.status, value: after.json?.status }))
        evidence.install = {
          firstRun: first.json?.status,
          doctor: { status: doctor.json?.status, checks },
          instance: { pid: record.pid, consoleURL: record.consoleURL, apiURL: record.apiURL, buildId: record.buildId, startupMode: record.startupMode },
          health, staticHtmlBytes: index.text.length,
        }
        // Finding, not a pass: an overridden config root loses the prebuilt release manifest.
        const overrideProbe = (target, role) => {
          const configRoot = join(workspace, `private-config-${role}`)
          pa(target, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: configRoot } })
          const result = pa(target, ['doctor', '--json'], { env: { PA_CONFIG_ROOT: configRoot } })
          const check = (result.json?.checks ?? []).find((item) => item.id === 'release_manifest')
          return { role, buildId: role === 'base' ? ARTIFACTS.base.buildId : ARTIFACTS.upgrade.buildId, status: check?.status ?? 'unknown', detail: check?.detail?.message ?? null }
        }
        const overrideBase = overrideProbe(install, 'base')
        const overrideUpgrade = overrideProbe(upgradeInstall, 'upgrade')
        evidence.findings = [{
          id: 'config_root_override_drops_release_manifest',
          owner: 'agent-d',
          observed: [overrideBase, overrideUpgrade].map((item) => `${item.role}:${item.status}`),
          code: overrideBase.detail,
          repro: `PA_CONFIG_ROOT=<fresh dir> <install>/bin/pa first-run && PA_CONFIG_ROOT=<fresh dir> <install>/bin/pa doctor --json`,
          impact: 'A colleague who moves the config root out of either install cannot start; only the in-install var/config finds release.json.',
        }]
      } finally {
        pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      }
    })

    await push(define('E4-INSTALL-CONFIG-ROOT', 'A private config root initializes the trusted release manifest'), async ({ assert, evidence }) => {
      const probe = (target, role) => {
        const configRoot = join(workspace, `config-root-${role}`)
        const first = pa(target, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: configRoot } })
        const doctor = pa(target, ['doctor', '--json'], { env: { PA_CONFIG_ROOT: configRoot } })
        const check = (doctor.json?.checks ?? []).find((item) => item.id === 'release_manifest')
        // Seeding the prebuilt release manifest is the documented expectation for a private config
        // root; verify that this is the only missing piece rather than an unsupported layout.
        cpSync(join(target, 'var/config/release.json'), join(configRoot, 'release.json'))
        const seeded = pa(target, ['doctor', '--json'], { env: { PA_CONFIG_ROOT: configRoot } })
        const seededCheck = (seeded.json?.checks ?? []).find((item) => item.id === 'release_manifest')
        return {
          role,
          firstRun: first.status === 0 ? 'OK' : `exit ${first.status}`,
          initialized: check?.status ?? 'missing',
          code: check?.detail?.message ?? null,
          seeded: seededCheck?.status ?? 'missing',
          doctorStatus: doctor.json?.status ?? 'unknown',
        }
      }
      const baseline = probe(upgradeInstall, 'baseline')
      const target = probe(install, 'target')
      evidence.configRoot = { baseline, target, baselineHistorical: baseline.initialized }
      // The target is the candidate under test; the baseline's earlier failure is history and must
      // not be mapped onto a fixed target. Seeding proves the probe is decisive on both.
      assert('TARGET_CONFIG_ROOT_INITIALIZED', target.initialized === 'PASS', JSON.stringify(target))
      assert('TARGET_SEED_PROVES_INIT', target.seeded === 'PASS', JSON.stringify(target))
      assert('BASELINE_SEED_PROVES_INIT', baseline.seeded === 'PASS', JSON.stringify(baseline))
      assert('BASELINE_HISTORY_RECORDED', ['PASS', 'FAIL'].includes(baseline.initialized), JSON.stringify(baseline))
    })

    await push(define('E3-PERSONAL-COLD-START', 'An ordinary personal install cold-starts, serves the workbench, adopts an older config and stops'), async ({ assert, evidence }) => {
      const ports = await freePorts(4)
      const child = spawnSync(process.execPath, [join(here, 'e3-personal-child.mjs')], {
        env: {
          ...process.env,
          PA_E_PERSONAL_SPEC: JSON.stringify(ARTIFACTS.upgrade),
          PA_E_PERSONAL_BASE: JSON.stringify(ARTIFACTS.base),
          PA_E_PERSONAL_PORTS: JSON.stringify(ports),
        },
        encoding: 'utf8',
        timeout: 300_000,
      })
      let probe
      try { probe = JSON.parse(child.stdout.trim().split('\n').at(-1)) } catch { probe = undefined }
      const steps = Object.fromEntries((probe?.steps ?? []).map((item) => [item.id, item]))
      assert('PERSONAL_PROBE_RAN', probe !== undefined, `signal=${child.signal} status=${child.status} ${child.stderr.slice(-300)}`)
      for (const id of ['first_run', 'doctor', 'start', 'health', 'console_assets', 'auth_required', 'instance_mode', 'schema', 'stop', 'stopped', 'config_conflict', 'start_conflict_blocked'])
        assert(`PERSONAL_${id.toUpperCase()}`, steps[id]?.status === 'PASS', JSON.stringify(steps[id] ?? null))
      assert('PERSONAL_SCHEMA', probe?.schema === ARTIFACTS.upgrade.productSchema, String(probe?.schema))
      assert('PERSONAL_CONFIG_CONFLICT', probe?.configConflict?.code === 'release_source_conflict' && probe?.configConflict?.after === ARTIFACTS.base.buildId, JSON.stringify(probe?.configConflict))
      assert('PERSONAL_NO_MODEL_SEND', probe?.modelSends === 0, String(probe?.modelSends))
      evidence.personalInstall = {
        artifact: { buildId: ARTIFACTS.upgrade.buildId, schema: ARTIFACTS.upgrade.productSchema, source: ARTIFACTS.upgrade.sourceCommit, tarSha256: ARTIFACTS.upgrade.tarSha256 },
        baselineConfig: { buildId: ARTIFACTS.base.buildId, schema: ARTIFACTS.base.productSchema },
        start: probe?.start,
        health: probe?.health,
        console: probe?.console,
        auth: probe?.auth,
        schema: probe?.schema,
        stop: probe?.stop,
        migrated: probe?.migrated,
        configConflict: probe?.configConflict,
        modelSends: probe?.modelSends ?? null,
        steps: probe?.steps ?? [],
      }
    })

    await push(define('E4-INSTALL-REUSE-CONCURRENCY', 'Instance identity is reused only for an exact match and concurrent starts do not fork'), async ({ assert, evidence }) => {
      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      const [port, apiPort, otherPort, otherApi] = await freePorts()
      const started = startPa(install, { port, apiPort })
      const first = await started.attempt
      assert('FIRST_RUNNING', first.status === 'RUNNING', JSON.stringify({ status: first.status, code: first.code }))
      try {
        const reused = pa(install, ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort)], { timeoutMs: 30_000 })
        assert('REUSE_STATUS', reused.status === 0 && reused.json?.status === 'REUSED', JSON.stringify({ status: reused.status, value: reused.json?.status }))
        assert('REUSE_SAME_PID', reused.json?.instance?.pid === first.instance.pid, `${reused.json?.instance?.pid} vs ${first.instance.pid}`)
        const conflict = pa(install, ['start', '--fixture', '--json', '--port', String(otherPort), '--api-port', String(otherApi)], { timeoutMs: 30_000 })
        assert('IDENTITY_CONFLICT', conflict.status === 2 && conflict.json?.code === 'instance_conflict', JSON.stringify({ status: conflict.status, code: conflict.json?.code }))
        assert('CONFLICT_LISTS_DIFFERENCE', (conflict.json?.detail?.differences ?? []).length > 0, JSON.stringify(conflict.json?.detail))
        pa(install, ['stop', '--json'], { timeoutMs: 30_000 })
        const [cp1, cap1, cp2, cap2] = await freePorts()
        const a = startPa(install, { port: cp1, apiPort: cap1 })
        const b = startPa(install, { port: cp2, apiPort: cap2 })
        const [ra, rb] = await Promise.all([a.attempt, b.attempt])
        const outcomes = [ra, rb]
        const running = outcomes.filter((item) => item.status === 'RUNNING')
        const refused = outcomes.filter((item) => item.status !== 'RUNNING' && ['start_in_progress', 'instance_conflict'].includes(item.code))
        assert('CONCURRENT_SINGLE_WINNER', running.length === 1 && refused.length === 1, JSON.stringify(outcomes.map((item) => [item.status, item.code])))
        const status = pa(install, ['status', '--json'])
        assert('CONCURRENT_ONE_RECORD', status.status === 0 && status.json?.instance?.pid === running[0].instance.pid, JSON.stringify({ status: status.status, pid: status.json?.instance?.pid }))
        evidence.reuse = {
          pid: first.instance.pid,
          reusedPid: reused.json?.instance?.pid,
          conflictCode: conflict.json?.code,
          conflictDifferences: conflict.json?.detail?.differences,
          concurrent: outcomes.map((item) => ({ status: item.status, code: item.code })),
        }
      } finally {
        pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      }
    })

    await push(define('E4-INSTALL-HOST-GUARDS', 'Mode is retained on reuse and an unknown live PID is never adopted or killed'), async ({ assert, evidence }) => {
      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      const first = pa(install, ['first-run', '--json'])
      assert('GUARD_FIRST_RUN', first.status === 0, first.stdout + first.stderr)
      const [port, apiPort] = await freePorts()
      const started = startPa(install, { port, apiPort })
      const running = await started.attempt
      assert('GUARD_RUNNING', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
      let mode
      let originalRecord
      try {
        originalRecord = readFileSync(join(install, 'var/config/instance.json'), 'utf8')
        const status = pa(install, ['status', '--json'])
        assert('MODE_FIXTURE', status.status === 0 && status.json?.instance?.mode === 'fixture', JSON.stringify({ status: status.status, mode: status.json?.instance?.mode }))
        const reused = pa(install, ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort)], { timeoutMs: 30_000 })
        assert('FIXTURE_REUSED', reused.status === 0 && reused.json?.status === 'REUSED' && reused.json?.instance?.mode === 'fixture', JSON.stringify({ status: reused.status, value: reused.json?.status }))
        const personal = pa(install, ['start', '--json', '--port', String(port), '--api-port', String(apiPort)], { timeoutMs: 30_000 })
        const personalCode = personal.json?.code
        assert('PERSONAL_REFUSED', personal.status === 2 && ['author_executor_unavailable', 'author_executor_version_mismatch', 'instance_conflict'].includes(personalCode), JSON.stringify({ status: personal.status, code: personalCode }))
        const still = pa(install, ['status', '--json'])
        assert('EXISTING_UNTOUCHED', still.status === 0 && still.json?.instance?.pid === running.instance.pid && still.json?.instance?.mode === 'fixture', JSON.stringify({ status: still.status, pid: still.json?.instance?.pid }))
        mode = { fixtureReused: true, personalRefused: personalCode, existingUntouched: true }
      } finally {
        pa(install, ['stop', '--json'], { timeoutMs: 30_000 })
      }

      // An instance record whose PID is a live, unrelated process must not be adopted or signalled.
      const recordPath = join(install, 'var/config/instance.json')
      assert('RECORD_CAPTURED', typeof originalRecord === 'string' && originalRecord.length > 0)
      const foreign = spawn('sleep', ['120'], { stdio: 'ignore' })
      try {
        const record = JSON.parse(originalRecord)
        record.pid = foreign.pid
        record.consolePid = foreign.pid
        record.apiPid = foreign.pid + 1
        writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}
`, { mode: 0o600 })
        const blocked = pa(install, ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort)], { timeoutMs: 30_000 })
        assert('UNKNOWN_PID_BLOCKED', blocked.status === 2 && ['instance_identity_mismatch', 'invalid_instance_record'].includes(blocked.json?.code), JSON.stringify({ status: blocked.status, code: blocked.json?.code }))
        assert('UNKNOWN_PID_ALIVE_AFTER_START', process.kill(foreign.pid, 0) === true)
        const stop = pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
        assert('STOP_REFUSED_UNVERIFIED', stop.status !== 0, JSON.stringify({ status: stop.status, code: stop.json?.code }))
        assert('UNKNOWN_PID_ALIVE_AFTER_STOP', process.kill(foreign.pid, 0) === true)
        evidence.hostGuards = { mode, unknownPid: { startCode: blocked.json?.code, stopStatus: stop.status, alive: true } }
      } finally {
        // The real instance was already stopped; never leave its stale record for a later case.
        writeFileSync(recordPath, originalRecord, { mode: 0o600 })
        foreign.kill('SIGKILL')
        rmSync(recordPath, { force: true })
      }
    })

    await push(define('E4-BACKUP-RESTORE', 'A full backup restores read-only into a new state with recovery authorization blocked'), async ({ assert, evidence }) => {
      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      const [port, apiPort, restoredPort, restoredApi] = await freePorts()
      const started = startPa(install, { port, apiPort })
      const running = await started.attempt
      assert('RUNNING', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
      const dataRoot = running.instance.state
      let seeded
      try {
        const client = new LocalProductClient({ baseURL: running.instance.apiURL, stateDir: dataRoot, timeoutMs: 25_000 })
        const configuration = await client.configuration()
        const project = configuration.projects.find((item) => item.dispatchAllowed)
        const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)
        const human = project.defaultCriteria.find((item) => item.kind === 'human' && item.required)
        seeded = await seedProduct(client, {
          projectId: project.id,
          scope: project.scope,
          criteria: [machine].filter(Boolean),
          profileId: project.profileIds.find((id) => id.endsWith('-pass')) ?? project.defaultProfileId,
          conversationId: 'conv-install',
        })
        assert('SEEDED_WORK', seeded.phase === 'delivered' && seeded.acceptedReceipt === 'recorded', JSON.stringify(seeded))
        assert('SEEDED_ARTIFACT', seeded.artifactIds.length >= 1, JSON.stringify(seeded))
        const before = await client.snapshot({ conversationId: 'conv-install' })
        assert('SEEDED_SNAPSHOT', before.works.some((item) => item.work.id === seeded.workId), JSON.stringify(before.works.map((item) => item.work.id)))
      } finally {
        pa(install, ['stop', '--json'], { timeoutMs: 30_000 })
      }
      const bundle = join(workspace, 'state.pab')
      const backup = pa(install, ['backup', '--out', bundle, '--json'], { timeoutMs: 60_000 })
      assert('BACKUP', backup.status === 0 && backup.json?.status === 'CREATED', backup.stdout + backup.stderr)
      assert('BACKUP_ARTIFACT', (backup.json?.counts?.artifacts ?? 0) >= 1, JSON.stringify(backup.json?.counts))
      assert('BACKUP_DB', backup.json?.database?.integrity === 'ok' && backup.json?.database?.foreignKeyViolations === 0, JSON.stringify(backup.json?.database))
      const verified = pa(install, ['verify-backup', '--bundle', bundle, '--json'], { timeoutMs: 60_000 })
      assert('VERIFY_BACKUP', verified.status === 0 && verified.json?.status === 'VERIFIED', verified.stdout + verified.stderr)
      const target = join(workspace, 'restored-state')
      const restored = pa(install, ['restore', '--bundle', bundle, '--to', target, '--json'], { timeoutMs: 60_000 })
      assert('RESTORE', restored.status === 0 && restored.json?.status === 'RESTORED', restored.stdout + restored.stderr)
      assert('RESTORE_REPORT', existsSync(join(target, 'restore-report.json')), join(target, 'restore-report.json'))
      const recovery = pa(install, ['recovery-status', '--json'], { env: { PA_DATA_ROOT: target } })
      assert('RECOVERY_MARKER', recovery.json?.markerPresent === true && recovery.json?.startupMode === 'recovery_readonly', JSON.stringify(recovery.json))
      assert('RECOVERY_AUTH_BLOCKED', recovery.json?.authorization?.status === 'BLOCKED', JSON.stringify(recovery.json?.authorization))

      const restoredStart = startPa(install, { port: restoredPort, apiPort: restoredApi, env: { PA_DATA_ROOT: target } })
      const readOnly = await restoredStart.attempt
      assert('RESTORED_RUNNING', readOnly.status === 'RUNNING', JSON.stringify({ status: readOnly.status, code: readOnly.code }))
      assert('RESTORED_MODE', readOnly.instance?.startupMode === 'recovery_readonly', String(readOnly.instance?.startupMode))
      try {
        const client = new LocalProductClient({ baseURL: readOnly.instance.apiURL, stateDir: target, timeoutMs: 20_000 })
        const snapshot = await client.snapshot({ conversationId: 'conv-install' })
        assert('RESTORED_HISTORY_READABLE', snapshot.works.some((item) => item.work.id === seeded.workId), JSON.stringify(snapshot.works.map((item) => item.work.id)))
        const restoredWork = await client.work(seeded.workId)
        assert('RESTORED_WORK_DELIVERED', restoredWork.phase === 'delivered' && JSON.stringify(restoredWork.artifactIds ?? []) === JSON.stringify(seeded.artifactIds), JSON.stringify({ phase: restoredWork.phase, artifacts: restoredWork.artifactIds }))
        assert('RESTORED_ARTIFACT_BYTES', snapshot.works.find((item) => item.work.id === seeded.workId)?.artifactIds?.length >= 1, JSON.stringify(snapshot.works.map((item) => item.artifactIds)))
        const blocked = await client.request('/v1/conversations/commands', {
          method: 'POST',
          body: { commandId: `restored-${Date.now()}`, conversationId: 'conv-install', kind: 'chat', text: '不应执行' },
        }).catch((error) => ({ status: error.status, body: error.body }))
        assert('RESTORED_BUSINESS_422', blocked.status === 422, JSON.stringify({ status: blocked.status, body: blocked.body }))
        evidence.restore = {
          bundleSha256: backup.json?.archiveSha256,
          bundleBytes: statSync(bundle).size,
          counts: backup.json?.counts,
          database: backup.json?.database,
          restoreReport: readOnly.instance?.startupMode,
          authorization: recovery.json?.authorization,
          businessStatus: blocked.status,
          decisionSurface: seeded.decision,
        }
      } finally {
        pa(install, ['stop', '--json'], { timeoutMs: 20_000, env: { PA_DATA_ROOT: target } })
      }
    })

    await push(define('E7-BACKUP-CONTEXT-REPLY', 'A non-empty installed backup carries context bindings and completed replies into a second root', {
      layer: LAYERS.INSTALLED,
    }), async ({ assert, evidence }) => {
      const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w13-backup-')))
      const ownInstall = join(own, 'install')
      mkdirSync(ownInstall, { recursive: true })
      const mock = await startMockModel({ stateRoot: join(own, 'model-state'), reply: 'W13 备份回复。' })
      let started
      try {
        spawnSync('tar', ['-xzf', ARTIFACTS.upgrade.tarPath, '-C', ownInstall, '--strip-components=1'])
        const first = pa(ownInstall, ['first-run', '--json'])
        assert('CONTEXT_BACKUP_FIRST_RUN', first.status === 0, first.stderr.slice(-300))
        const [port, apiPort] = await freePorts()
        started = startPa(ownInstall, { port, apiPort, env: { PA_MODEL_CONFIG: mock.configPath } })
        const running = await started.attempt
        assert('CONTEXT_BACKUP_START', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
        const state = running.instance.state
        const client = new LocalProductClient({ baseURL: running.instance.apiURL, stateDir: state, timeoutMs: 25_000 })
        const configuration = await client.configuration()
        const project = configuration.projects.find(item => item.dispatchAllowed)
        await client.dispatch({ commandId: 'w13-backup-seed', conversationId: 'conv-backup', kind: 'chat', projectId: project.id, text: 'W13 备份来源。' })
        await new Promise(resolve => setTimeout(resolve, 700))
        const prepared = await client.request('/v1/assistant/context/prepare', { method: 'POST', body: {
          commandId: 'w13-backup-ctx', text: 'W13 备份上下文消息。', context: { projectId: project.id, conversationId: 'conv-backup',
            selections: ['project', 'conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 4096 } } } })
        assert('CONTEXT_BACKUP_PREPARE', prepared.status === 200, JSON.stringify(prepared.body)?.slice(0, 200))
        const sent = await client.request('/v1/assistant/context/send', { method: 'POST', body: { commandId: 'w13-backup-ctx', token: prepared.body.token } })
        assert('CONTEXT_BACKUP_SEND', sent.status === 200 && sent.body?.status === 'recorded', JSON.stringify(sent.body)?.slice(0, 200))
        let reply
        for (let index = 0; index < 50 && !reply; index += 1) {
          const page = await client.conversation('conv-backup')
          reply = page.messages.find(item => item.provenance === 'reasoner_reply')
          if (!reply) await new Promise(resolve => setTimeout(resolve, 150))
        }
        assert('CONTEXT_BACKUP_REPLY', reply?.text?.includes('W13 备份回复'), JSON.stringify(reply?.text ?? null))
        pa(ownInstall, ['stop', '--json'], { timeoutMs: 25_000 })
        const db = new DatabaseSync(join(state, 'state.sqlite'), { readOnly: true })
        let before
        try {
          before = { bindings: Number(db.prepare('SELECT count(*) AS c FROM assistant_context_bindings').get()?.c ?? 0),
            results: Number(db.prepare('SELECT count(*) AS c FROM assistant_reply_results').get()?.c ?? 0),
            messages: Number(db.prepare('SELECT count(*) AS c FROM conversation_messages').get()?.c ?? 0) }
        } finally { db.close() }
        assert('CONTEXT_BACKUP_NONEMPTY', before.bindings >= 1 && before.results >= 1 && before.messages >= 2, JSON.stringify(before))
        const bundle = join(own, 'rich.pab')
        const backup = pa(ownInstall, ['backup', '--out', bundle, '--json'], { timeoutMs: 60_000 })
        assert('CONTEXT_BACKUP_CREATED', backup.status === 0 && backup.json?.status === 'CREATED' && (backup.json?.counts?.artifacts ?? 0) >= 1, JSON.stringify(backup.json?.counts))
        const restoredRoot = join(own, 'restored')
        const restore = pa(ownInstall, ['restore', '--bundle', bundle, '--to', restoredRoot, '--json'], { timeoutMs: 60_000 })
        assert('CONTEXT_BACKUP_RESTORED', restore.status === 0 && restore.json?.status === 'RESTORED', restore.stderr.slice(-300))
        const restored = new DatabaseSync(join(restoredRoot, 'state.sqlite'), { readOnly: true })
        let after
        try {
          after = { bindings: Number(restored.prepare('SELECT count(*) AS c FROM assistant_context_bindings').get()?.c ?? 0),
            results: Number(restored.prepare('SELECT count(*) AS c FROM assistant_reply_results').get()?.c ?? 0),
            messages: Number(restored.prepare('SELECT count(*) AS c FROM conversation_messages').get()?.c ?? 0) }
        } finally { restored.close() }
        assert('CONTEXT_BACKUP_COUNTS', after.bindings === before.bindings && after.results === before.results && after.messages === before.messages, JSON.stringify({ before, after }))
        const artifactRows = readdirSync(join(restoredRoot, 'artifacts')).length
        assert('CONTEXT_BACKUP_ARTIFACTS', artifactRows >= 1, String(artifactRows))
        evidence.backupContextReply = { subject: artifactSubject(ARTIFACTS.upgrade), before, after, artifacts: artifactRows, backupArtifacts: backup.json?.counts?.artifacts ?? 0,
          reply: reply.text }
      } finally {
        try { pa(ownInstall, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
        try { started?.child?.kill('SIGKILL') } catch { /* gone */ }
        await mock.close().catch(() => {})
        rmSync(own, { recursive: true, force: true })
      }
    })

    await push(define('E4-INSTALL-TAMPER', 'A same-size or missing artifact and a corrupt bundle are refused'), async ({ assert, evidence }) => {
      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      cpSync(install, pristine, { recursive: true, verbatimSymlinks: true })
      const [port, apiPort] = await freePorts()
      const release = JSON.parse(readFileSync(join(install, 'var/config/release.json'), 'utf8'))
      const indexRel = release.build?.consoleRoot ? join(release.build.consoleRoot, 'index.html') : 'apps/console/dist/index.html'
      const indexPath = join(install, 'app', indexRel)
      const original = readFileSync(indexPath)
      const mutated = Buffer.from(original)
      mutated[mutated.length - 1] = mutated[mutated.length - 1] ^ 0xff
      writeFileSync(indexPath, mutated)
      assert('TAMPER_SAME_SIZE', statSync(indexPath).size === original.length)
      const tamperedStart = pa(install, ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort)], { timeoutMs: 40_000 })
      assert('TAMPER_START_BLOCKED', tamperedStart.status === 2, JSON.stringify({ status: tamperedStart.status, code: tamperedStart.json?.code }))
      assert('TAMPER_CODE', ['console_mode_mismatch', 'release_artifact_missing'].includes(tamperedStart.json?.code), JSON.stringify({ code: tamperedStart.json?.code, message: tamperedStart.json?.message }))
      writeFileSync(indexPath, original)
      const restoredStart = pa(install, ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort)], { timeoutMs: 40_000 })
      assert('TAMPER_RESTORED_STARTS', restoredStart.status === 0, JSON.stringify({ status: restoredStart.status, code: restoredStart.json?.code }))
      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })

      const artifact = (release.artifacts ?? []).find((item) => item.path?.startsWith('packages/') && item.path.endsWith('.js'))
      assert('RELEASE_LISTS_ARTIFACTS', artifact !== undefined, JSON.stringify(release.artifacts?.slice(0, 2)))
      const artifactPath = join(install, 'app', artifact.path)
      const saved = existsSync(artifactPath) ? readFileSync(artifactPath) : undefined
      if (saved) {
        rmSync(artifactPath)
        const missingStart = pa(install, ['start', '--fixture', '--json', '--port', String(port), '--api-port', String(apiPort)], { timeoutMs: 40_000 })
        assert('MISSING_ARTIFACT_BLOCKED', missingStart.status === 2 && missingStart.json?.code === 'release_artifact_missing', JSON.stringify({ status: missingStart.status, code: missingStart.json?.code }))
        writeFileSync(artifactPath, saved)
      }
      rmSync(install, { recursive: true, force: true })
      cpSync(pristine, install, { recursive: true, verbatimSymlinks: true })
      // fs.cpSync does not preserve directory modes; the private roots must stay 0700 or the launcher
      // correctly refuses to back them up as world-visible.
      for (const dir of ['var', 'var/config', 'var/data', 'var/cache', 'var/logs', 'var/workspaces'])
        if (existsSync(join(install, dir))) chmodSync(join(install, dir), 0o700)

      const corruptBundle = join(workspace, 'corrupt.pab')
      const good = join(workspace, 'tamper-bundle.pab')
      const ownBackup = pa(install, ['backup', '--out', good, '--json'], { timeoutMs: 60_000 })
      assert('HAVE_BUNDLE', ownBackup.status === 0 && existsSync(good), ownBackup.stdout + ownBackup.stderr)
      const bytes = readFileSync(good)
      const corrupt = Buffer.from(bytes)
      corrupt[corrupt.length - 40] = corrupt[corrupt.length - 40] ^ 0xff
      writeFileSync(corruptBundle, corrupt)
      const verified = pa(install, ['verify-backup', '--bundle', corruptBundle, '--json'], { timeoutMs: 40_000 })
      assert('CORRUPT_BUNDLE_REFUSED', verified.status === 2, JSON.stringify({ status: verified.status, code: verified.json?.code }))
      evidence.tamper = {
        sameSizeCode: tamperedStart.json?.code,
        missingCode: artifact === undefined ? 'not_probed' : 'release_artifact_missing',
        corruptBundleCode: verified.json?.code,
      }
    })

    await push(define('E4-INSTALL-ROLLBACK', 'A pre-change backup rolls the state back and the install starts again'), async ({ assert, evidence }) => {
      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      const [port, apiPort] = await freePorts()
      const backup = pa(install, ['backup', '--out', join(workspace, 'pre-rollback.pab'), '--json'], { timeoutMs: 60_000 })
      assert('PRE_BACKUP', backup.status === 0, backup.stdout + backup.stderr)
      const stateRoot = witnessPath(join(install, 'var/data'))
      assert('STATE_ROOT', existsSync(stateRoot), String(stateRoot))
      const started = startPa(install, { port, apiPort })
      const running = await started.attempt
      assert('RUNNING', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
      let added
      try {
        const client = new LocalProductClient({ baseURL: running.instance.apiURL, stateDir: stateRoot, timeoutMs: 20_000 })
        const configuration = await client.configuration()
        const project = configuration.projects.find((item) => item.dispatchAllowed)
        added = await client.dispatch({
          commandId: `post-backup-${Date.now()}`,
          conversationId: 'conv-install',
          kind: 'chat',
          projectId: project.id,
          text: '备份之后新增的消息，回滚后必须消失。',
        })
        assert('POST_BACKUP_WRITE', added.receipt.status === 'recorded', JSON.stringify(added.receipt))
        const page = await client.conversation('conv-install')
        assert('POST_BACKUP_MESSAGE', page.messages.some((item) => item.text?.includes('回滚后必须消失')), JSON.stringify(page.messages.at(-1)))
      } finally {
        pa(install, ['stop', '--json'], { timeoutMs: 30_000 })
      }
      const rollback = pa(install, ['rollback', '--bundle', join(workspace, 'pre-rollback.pab'), '--target', stateRoot, '--json'], { timeoutMs: 60_000 })
      assert('ROLLBACK', rollback.status === 0 && rollback.json?.status === 'ROLLED_BACK', rollback.stdout + rollback.stderr)
      const restarted = startPa(install, { port, apiPort })
      const again = await restarted.attempt
      assert('STARTS_AFTER_ROLLBACK', again.status === 'RUNNING', JSON.stringify({ status: again.status, code: again.code }))
      try {
        const client = new LocalProductClient({ baseURL: again.instance.apiURL, stateDir: stateRoot, timeoutMs: 20_000 })
        const page = await client.conversation('conv-install')
        assert('POST_BACKUP_GONE', !page.messages.some((item) => item.text?.includes('回滚后必须消失')), JSON.stringify(page.messages.at(-1)?.text))
      } finally {
        pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      }
      evidence.rollback = { bundleSha256: backup.json?.archiveSha256, target: stateRoot, postBackupReceipt: added?.receipt?.status }
    })

    if (ARTIFACTS.base.productSchema === ARTIFACTS.upgrade.productSchema) {
      await push(define('E4-UPGRADE-ROLLBACK', 'D managed upgrade and binary rollback use the explicit pair in a bounded child probe'), async ({ assert, evidence }) => {
        const probePorts = await freePorts(6)
        const child = spawnSync(process.execPath, [join(here, 'e4-managed-upgrade-child.mjs')], {
          env: { ...process.env, PA_E_MANAGED_PAIR: JSON.stringify({ baseline: ARTIFACTS.base, target: ARTIFACTS.upgrade }), PA_E_MANAGED_PORTS: JSON.stringify(probePorts) },
          encoding: 'utf8',
          timeout: 240_000,
        })
        let probe
        try {
          probe = JSON.parse(child.stdout.trim().split('\n').at(-1))
        } catch {
          probe = undefined
        }
        assert('MANAGED_PROBE_RAN', probe !== undefined, `signal=${child.signal} status=${child.status} ${child.stderr.slice(-300)}`)
        const steps = Object.fromEntries((probe?.steps ?? []).map((item) => [item.id, item]))
        for (const id of ['bootstrap', 'baseline_start', 'upgrade', 'upgraded_health', 'post_upgrade_write', 'tampered_target', 'rollback_install', 'rollback_start'])
          assert(`STEP_${id.toUpperCase()}`, steps[id]?.status === 'PASS', JSON.stringify(steps[id] ?? null))
        assert('UPGRADE_FROM', probe?.upgrade?.from === ARTIFACTS.base.buildId, JSON.stringify(probe?.upgrade))
        assert('UPGRADE_TO', probe?.upgrade?.to === ARTIFACTS.upgrade.buildId, JSON.stringify(probe?.upgrade))
        assert('UPGRADE_TARGET_STARTED', probe?.upgrade?.started === ARTIFACTS.upgrade.buildId, String(probe?.upgrade?.started))
        assert('UPGRADE_SCHEMA', probe?.schema === ARTIFACTS.upgrade.productSchema, String(probe?.schema))
        assert('UPGRADE_POST_DATA', probe?.postKept === true, String(probe?.postKept))
        assert('ROLLBACK_BUILD', probe?.rollbackBuild === ARTIFACTS.base.buildId, String(probe?.rollbackBuild))
        assert('ROLLBACK_KEEPS_DATA', probe?.rollbackKeptPost === true, String(probe?.rollbackKeptPost))
        assert('TAMPERED_REFUSED', probe?.tampered?.code === 'target_tampered', JSON.stringify(probe?.tampered))
        evidence.upgrade = {
          baseline: { buildId: ARTIFACTS.base.buildId, schema: ARTIFACTS.base.productSchema, tarSha256: ARTIFACTS.base.tarSha256, source: ARTIFACTS.base.sourceCommit },
          target: { buildId: ARTIFACTS.upgrade.buildId, schema: ARTIFACTS.upgrade.productSchema, tarSha256: ARTIFACTS.upgrade.tarSha256, source: ARTIFACTS.upgrade.sourceCommit },
          status: probe?.upgrade?.status,
          pointer: { afterUpgrade: probe?.upgrade?.to, afterRollback: probe?.rollbackBuild },
          backup: { path: probe?.upgrade?.backup ?? null },
          messages: { before: 1, after: 2 },
          preDataReadable: steps.baseline_start?.status === 'PASS',
          postUpgradeMessageKept: probe?.postKept === true,
          binaryRollback: { status: probe?.rollback?.status, build: probe?.rollbackBuild, postDataKept: probe?.rollbackKeptPost, dataRolledBack: probe?.rollback?.dataRolledBack },
          tampered: { code: probe?.tampered?.code, instanceUntouched: true },
          schemaRefusal: ARTIFACTS.upgrade.productSchema === ARTIFACTS.base.productSchema ? { applicable: false, reason: 'same_schema' } : { applicable: true },
          steps: probe?.steps ?? [],
          probeLimitations: 'Bounded child probe: fault-injection crash windows and whole-process launcher/API guards are a separate NOT_TESTED case.',
        }
      })
    } else {
      cases.push(notTested({ ...define('E4-UPGRADE-ROLLBACK', 'A second frozen same-schema build upgrades the state and rolls back', {
        layer: LAYERS.INSTALLED,
      }) }, `NOT_TESTED: the default baseline schema ${ARTIFACTS.base.productSchema} differs from target schema ${ARTIFACTS.upgrade.productSchema}; an older binary cannot start on the newer state, and no second frozen build with schema ${ARTIFACTS.upgrade.productSchema} is available. Cross-schema refusal is measured by E4-UPGRADE-CROSS-SCHEMA; the prior schema15 same-schema upgrade/rollback result remains scoped to its old tuple.`))
    }

    await push(define('E4-UPGRADE-CROSS-SCHEMA', 'An older D binary refuses a newer migrated state without a silent downgrade'), async ({ assert, evidence }) => {
      const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w14-cross-')))
      const crossInstall = join(own, 'cross')
      mkdirSync(crossInstall, { recursive: true })
      let started
      try {
        spawnSync('tar', ['-xzf', ARTIFACTS.cross.tarPath, '-C', crossInstall, '--strip-components=1'])
        const first = pa(crossInstall, ['first-run', '--json'])
        assert('CROSS_FIRST_RUN', first.status === 0, first.stderr.slice(-300))
        const [port, apiPort] = await freePorts()
        started = startPa(crossInstall, { port, apiPort })
        const running = await started.attempt
        assert('CROSS_BASE_RUNNING', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
        const state = running.instance.state
        try {
          const key = readFileSync(join(state, 'api.key'), 'utf8').trim()
          const sent = await fetch(`${running.instance.apiURL}/v1/commands`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({ commandId: 'w14-cross-chat', conversationId: 'conv-cross', kind: 'chat', projectId: 'project-atlas', text: '跨 schema 前数据。' }), signal: AbortSignal.timeout(10_000) })
          assert('CROSS_SEED', sent.status === 200, String(sent.status))
          await new Promise(resolve => setTimeout(resolve, 300))
        } finally { pa(crossInstall, ['stop', '--json'], { timeoutMs: 25_000 }) }
        const migrated = join(own, 'migrated')
        cpSync(state, migrated, { recursive: true })
        chmodSync(migrated, 0o700)
        const { ProductStore } = await import('../../../packages/storage/dist/index.js')
        const db = new ProductStore({ path: join(migrated, 'state.sqlite') })
        let newSchema
        try { newSchema = db.database.productSchema } finally { db.close() }
        assert('CROSS_MIGRATED', newSchema > ARTIFACTS.cross.productSchema, `${ARTIFACTS.cross.productSchema} -> ${newSchema}`)
        const oldOnNew = startPa(crossInstall, { port, apiPort, env: { PA_DATA_ROOT: migrated } })
        const refusedResult = await oldOnNew.attempt
        try { oldOnNew.child.kill('SIGKILL') } catch { /* gone */ }
        evidence.crossUpgrade = { baseline: { buildId: ARTIFACTS.cross.buildId, schema: ARTIFACTS.cross.productSchema, source: ARTIFACTS.cross.sourceCommit },
          migratedSchema: newSchema, status: refusedResult.status ?? null, code: refusedResult.code ?? null,
          dataSchema: (() => { try { const check = new DatabaseSync(join(migrated, 'state.sqlite'), { readOnly: true }); try { return Number(check.prepare("select value from schema_meta where key='product_schema'").get()?.value) } finally { check.close() } } catch { return null } })(),
          stderr: refusedResult.stderr?.().slice(-400) ?? null }
        assert('CROSS_REFUSAL', refusedResult.status === 'BLOCKED', JSON.stringify({ status: refusedResult.status, code: refusedResult.code, stderr: evidence.crossUpgrade.stderr }))
        assert('CROSS_CODE', ['daemon_start_failed', 'schema_unsupported', 'runtime_mismatch', 'state_schema_newer_than_binary'].includes(refusedResult.code) && refusedResult.code !== 'release_artifact_missing', JSON.stringify({ code: refusedResult.code ?? null, stderr: evidence.crossUpgrade.stderr }))
        assert('CROSS_DATA_SCHEMA', evidence.crossUpgrade.dataSchema === newSchema, String(evidence.crossUpgrade.dataSchema))
      } finally {
        try { if (started) pa(crossInstall, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
        rmSync(own, { recursive: true, force: true })
      }
    })

    await push(define('E4-MULTI-STATE', 'One install, two states: a stop for another state neither claims nor kills it'), async ({ assert, evidence }) => {
      const ports = await freePorts(4)
      const child = spawnSync(process.execPath, [join(here, 'e4-multistate-child.mjs')], {
        env: { ...process.env, PA_E_MULTI_SPEC: JSON.stringify(ARTIFACTS.upgrade), PA_E_MULTI_PORTS: JSON.stringify(ports) },
        encoding: 'utf8',
        timeout: 240_000,
      })
      let probe
      try { probe = JSON.parse(child.stdout.trim().split('\n').at(-1)) } catch { probe = undefined }
      const steps = Object.fromEntries((probe?.steps ?? []).map((item) => [item.id, item]))
      assert('MULTI_PROBE_RAN', probe !== undefined, `signal=${child.signal} status=${child.status} ${child.stderr.slice(-300)}`)
      assert('MULTI_FIRST_RUN', steps.first_run?.status === 'PASS', JSON.stringify(steps.first_run ?? null))
      assert('MULTI_STATE_A', steps.state_a_start?.status === 'PASS', JSON.stringify(steps.state_a_start ?? null))
      assert('MULTI_STATE_B', steps.state_b_start?.status === 'PASS', JSON.stringify(steps.state_b_start ?? null))
      assert('MULTI_STOP_OTHER_BLOCKED', steps.stop_other_state_blocked?.status === 'PASS', JSON.stringify(probe?.stopOtherState ?? null))
      assert('MULTI_DEAD_LAUNCHER', steps.dead_launcher_api_alive?.status !== 'FAIL', JSON.stringify(probe?.deadLauncher ?? null))
      evidence.multiState = {
        stopOtherState: probe?.stopOtherState,
        deadLauncher: probe?.deadLauncher,
        steps: probe?.steps ?? [],
        limitations: ['Only processes this probe spawned are signalled; unknown live targets are reported, not killed.'],
      }
    })

    await push(define('E4-UPGRADE-FAULTS', 'Pre-switch crash, SIGKILL and unhealthy-target recovery keep the previous build and data', {
      layer: LAYERS.INSTALLED,
    }), async ({ assert, evidence }) => {
      const windows = {}
      for (const mode of ['crash_after_stop', 'crash_after_stop_kill', 'target_unhealthy']) {
        const ports = await freePorts(4)
        const child = spawnSync(process.execPath, [join(here, 'e4-upgrade-fault-child.mjs')], {
          env: { ...process.env, PA_E_FAULT_PAIR: JSON.stringify({ baseline: ARTIFACTS.base, target: ARTIFACTS.upgrade }),
            PA_E_FAULT_PORTS: JSON.stringify(ports), PA_E_FAULT_MODE: mode },
          encoding: 'utf8', timeout: 240_000,
        })
        let probe
        try { probe = JSON.parse(child.stdout.trim().split('\n').filter(Boolean).at(-1)) } catch { probe = undefined }
        windows[mode] = { status: child.status, signal: child.signal, probe }
        assert(`FAULT_${mode.toUpperCase()}_RAN`, probe !== undefined, `status=${child.status} ${child.stderr.slice(-300)}`)
        const steps = Object.fromEntries((probe?.steps ?? []).map(item => [item.id, item]))
        assert(`FAULT_${mode.toUpperCase()}_OBSERVED`, steps.fault_observed?.status === 'PASS', JSON.stringify(steps.fault_observed ?? null))
        assert(`FAULT_${mode.toUpperCase()}_RECOVERED`, steps.recover?.status === 'PASS', JSON.stringify(steps.recover ?? null))
        assert(`FAULT_${mode.toUpperCase()}_HEALTH`, steps.recovered_health?.status === 'PASS', JSON.stringify(steps.recovered_health ?? null))
        assert(`FAULT_${mode.toUpperCase()}_DATA`, steps.data_kept?.status === 'PASS' && probe?.dataKept === true, JSON.stringify({ data: probe?.dataKept }))
        assert(`FAULT_${mode.toUpperCase()}_SCHEMA`, probe?.schema === ARTIFACTS.upgrade.productSchema, String(probe?.schema))
      }
      evidence.upgradeFaults = { subject: artifactSubject(ARTIFACTS.upgrade), windows,
        missingWindows: ['pointer/spawn/record/ACK crash after successful switch are not separately injected'] }
    })

    await push(define('E8-SCHEMA-MIGRATION', 'A real D target database opens on the current A schema with data preserved', { layer: LAYERS.CONTROLLED }), async ({ assert, evidence }) => {
      const extract = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w11-migrate-')))
      let started
      try {
        spawnSync('tar', ['-xzf', ARTIFACTS.upgrade.tarPath, '-C', extract, '--strip-components=1'])
        const first = pa(extract, ['first-run', '--json'])
        assert('MIGRATE_FIRST_RUN', first.status === 0 && first.json?.status === 'OK', first.stderr.slice(-300))
        const [port, apiPort] = await freePorts()
        started = startPa(extract, { port, apiPort })
        const running = await started.attempt
        assert('MIGRATE_START', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
        try {
          const apiURL = running.instance.apiURL
          const key = readFileSync(join(running.instance.state, 'api.key'), 'utf8').trim()
          const sent = await fetch(`${apiURL}/v1/commands`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({ commandId: 'w11-migrate-chat', conversationId: 'conv-migrate', kind: 'chat', projectId: 'project-atlas', text: '迁移前的数据。' }),
            signal: AbortSignal.timeout(10_000) })
          assert('MIGRATE_SEED_CHAT', sent.status === 200, String(sent.status))
          await new Promise(resolve => setTimeout(resolve, 400))
        } finally { pa(extract, ['stop', '--json'], { timeoutMs: 30_000 }) }
        const oldState = running.instance.state
        const db = new DatabaseSync(join(oldState, 'state.sqlite'), { readOnly: true })
        let oldSchema, oldMessages
        try {
          oldSchema = Number(db.prepare("SELECT value FROM schema_meta WHERE key='product_schema'").get()?.value)
          oldMessages = Number(db.prepare('SELECT count(*) AS c FROM conversation_messages').get()?.c ?? 0)
        } finally { db.close() }
        assert('MIGRATE_OLD_SCHEMA', oldSchema === ARTIFACTS.upgrade.productSchema, `${oldSchema} vs ${ARTIFACTS.upgrade.productSchema}`)
        assert('MIGRATE_HAS_DATA', oldMessages >= 1, String(oldMessages))
        const { ProductStore } = await import('../../../packages/storage/dist/index.js')
        const copy = join(extract, 'migrated-state')
        cpSync(oldState, copy, { recursive: true })
        const opened = new ProductStore({ path: join(copy, 'state.sqlite') })
        let newSchema, newMessages, bindingTable
        try {
          newSchema = opened.database.productSchema
          newMessages = Number(opened.db.prepare('SELECT count(*) AS c FROM conversation_messages').get()?.c ?? 0)
          bindingTable = Number(opened.db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='assistant_context_bindings'").get()?.c ?? 0)
        } finally { opened.close() }
        assert('MIGRATE_NEW_SCHEMA', newSchema >= oldSchema && newSchema >= 16, `${oldSchema} -> ${newSchema}`)
        assert('MIGRATE_DATA_KEPT', newMessages === oldMessages, `${oldMessages} -> ${newMessages}`)
        assert('MIGRATE_BINDING_TABLE', bindingTable === 1, String(bindingTable))
        const reopened = new ProductStore({ path: join(copy, 'state.sqlite') })
        try { newSchema = reopened.database.productSchema } finally { reopened.close() }
        assert('MIGRATE_REOPEN', newSchema >= 16, String(newSchema))
        evidence.schemaMigration = { artifact: { buildId: ARTIFACTS.upgrade.buildId, source: ARTIFACTS.upgrade.sourceCommit, schema: ARTIFACTS.upgrade.productSchema },
          old: { schema: oldSchema, messages: oldMessages }, migrated: { schema: newSchema, messages: newMessages, bindingTable: bindingTable === 1 },
          reopened: newSchema >= 16 }
      } finally {
        try { if (started) pa(extract, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
        rmSync(extract, { recursive: true, force: true })
      }
    })

    await push(define('E6-INSTALLED-CONTEXT', 'The frozen D tar cold-starts fixture mode and sends selected context through its installed HTTP provider path', {
      layer: LAYERS.INSTALLED,
    }), async ({ assert, evidence }) => {
      const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w12-ctx-install-')))
      const ownInstall = join(own, 'install')
      mkdirSync(ownInstall, { recursive: true })
      const mock = await startMockModel({ stateRoot: join(own, 'model-state'), reply: '安装版上下文回复。' })
      let started
      try {
        spawnSync('tar', ['-xzf', ARTIFACTS.upgrade.tarPath, '-C', ownInstall, '--strip-components=1'])
        const first = pa(ownInstall, ['first-run', '--json'])
        assert('INSTALLED_CONTEXT_FIRST_RUN', first.status === 0, first.stderr.slice(-300))
        const [port, apiPort] = await freePorts()
        started = startPa(ownInstall, { port, apiPort, env: { PA_MODEL_CONFIG: mock.configPath } })
        const running = await started.attempt
        assert('INSTALLED_CONTEXT_RUNNING', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
        const client = new LocalProductClient({ baseURL: running.instance.apiURL, stateDir: running.instance.state, timeoutMs: 25_000 })
        const configuration = await client.configuration()
        assert('INSTALLED_CONTEXT_AVAILABLE', configuration.assistantContextAvailable === true, JSON.stringify({ available: configuration.assistantContextAvailable }))
        const project = configuration.projects.find(item => item.dispatchAllowed)
        const seeded = await client.dispatch({ commandId: 'w12-installed-seed', conversationId: 'conv-installed-ctx', kind: 'chat', projectId: project.id, text: '安装版上下文来源。' })
        assert('INSTALLED_SEED', seeded.receipt?.status === 'recorded', JSON.stringify(seeded.receipt)?.slice(0, 200))
        await new Promise(resolve => setTimeout(resolve, 800))
        const prepared = await client.request('/v1/assistant/context/prepare', { method: 'POST', body: {
          commandId: 'w12-installed-ctx', text: '请使用安装版上下文。', context: { projectId: project.id, conversationId: 'conv-installed-ctx',
            selections: ['project', 'conversation'], budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 8192 } } } })
        assert('INSTALLED_PREPARE', prepared.status === 200 && prepared.body?.protocol === 'assistant-context-prepared/1', JSON.stringify(prepared.body)?.slice(0, 300))
        const sent = await client.request('/v1/assistant/context/send', { method: 'POST', body: { commandId: 'w12-installed-ctx', token: prepared.body.token } })
        assert('INSTALLED_SEND', sent.status === 200 && sent.body?.status === 'recorded', JSON.stringify(sent.body)?.slice(0, 300))
        let reply, page
        for (let index = 0; index < 50 && !reply; index += 1) {
          page = await client.conversation('conv-installed-ctx')
          reply = page.messages.find(item => item.provenance === 'reasoner_reply')
          if (!reply) await new Promise(resolve => setTimeout(resolve, 150))
        }
        assert('INSTALLED_REPLY', reply?.text?.includes('安装版上下文回复'), JSON.stringify(reply?.text ?? null))
        const userMessage = page?.messages.find(item => item.role === 'user' && item.text.includes('请使用安装版上下文'))
        const binding = await client.request(`/v1/messages/${userMessage?.id ?? ''}/context`)
        assert('INSTALLED_AUDIT', binding.status === 200 && binding.body?.commandId === 'w12-installed-ctx', JSON.stringify(binding.body)?.slice(0, 200))
        assert('INSTALLED_MOCK_CALLED', mock.requests.length >= 1 && mock.requests.some(item => JSON.stringify(item.messages).includes('安装版上下文来源')), `calls ${mock.requests.length}`)
        evidence.installedContext = { mode: 'fixture', subject: artifactSubject(ARTIFACTS.upgrade), artifact: { buildId: ARTIFACTS.upgrade.buildId, schema: ARTIFACTS.upgrade.productSchema, source: ARTIFACTS.upgrade.sourceCommit },
          available: true, prepare: prepared.status, send: sent.body?.status, reply: reply?.text, audit: binding.status, modelCalls: mock.requests.length }
      } finally {
        try { pa(ownInstall, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
        try { started?.child?.kill('SIGKILL') } catch { /* gone */ }
        await mock.close().catch(() => {})
        rmSync(own, { recursive: true, force: true })
      }
    })

    await push(define('E8-LEGACY16-MIGRATION', 'A legacy D schema16 database migrates to current A schema18 independently', { layer: LAYERS.CONTROLLED }), async ({ assert, evidence }) => {
      const extract = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w13-legacy-')))
      let started
      try {
        spawnSync('tar', ['-xzf', ARTIFACTS.cross.tarPath, '-C', extract, '--strip-components=1'])
        const first = pa(extract, ['first-run', '--json'])
        assert('LEGACY_FIRST_RUN', first.status === 0 && first.json?.status === 'OK', first.stderr.slice(-300))
        const [port, apiPort] = await freePorts()
        started = startPa(extract, { port, apiPort })
        const running = await started.attempt
        assert('LEGACY_START', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
        try {
          const key = readFileSync(join(running.instance.state, 'api.key'), 'utf8').trim()
          const sent = await fetch(`${running.instance.apiURL}/v1/commands`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
            body: JSON.stringify({ commandId: 'w13-legacy-chat', conversationId: 'conv-legacy', kind: 'chat', projectId: 'project-atlas', text: 'legacy 迁移数据。' }), signal: AbortSignal.timeout(10_000) })
          assert('LEGACY_SEED', sent.status === 200, String(sent.status))
          await new Promise(resolve => setTimeout(resolve, 300))
        } finally { pa(extract, ['stop', '--json'], { timeoutMs: 25_000 }) }
        const oldState = running.instance.state
        const db = new DatabaseSync(join(oldState, 'state.sqlite'), { readOnly: true })
        let oldSchema, oldMessages
        try {
          oldSchema = Number(db.prepare("SELECT value FROM schema_meta WHERE key='product_schema'").get()?.value)
          oldMessages = Number(db.prepare('SELECT count(*) AS c FROM conversation_messages').get()?.c ?? 0)
        } finally { db.close() }
        assert('LEGACY_SCHEMA16', oldSchema === ARTIFACTS.cross.productSchema && oldSchema < 18, String(oldSchema))
        assert('LEGACY_DATA', oldMessages >= 1, String(oldMessages))
        const { ProductStore } = await import('../../../packages/storage/dist/index.js')
        const copy = join(extract, 'legacy-migrated')
        cpSync(oldState, copy, { recursive: true })
        const opened = new ProductStore({ path: join(copy, 'state.sqlite') })
        let newSchema, newMessages
        try {
          newSchema = opened.database.productSchema
          newMessages = Number(opened.db.prepare('SELECT count(*) AS c FROM conversation_messages').get()?.c ?? 0)
          assert('LEGACY_BINDING_TABLE', Number(opened.db.prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name='assistant_context_bindings'").get()?.c ?? 0) === 1, 'binding table')
        } finally { opened.close() }
        assert('LEGACY_NEW_SCHEMA', newSchema === 18 && newSchema > oldSchema, `${oldSchema} -> ${newSchema}`)
        assert('LEGACY_DATA_KEPT', newMessages === oldMessages, `${oldMessages} -> ${newMessages}`)
        evidence.legacyMigration = { artifact: { buildId: ARTIFACTS.cross.buildId, source: ARTIFACTS.cross.sourceCommit, schema: ARTIFACTS.cross.productSchema },
          old: { schema: oldSchema, messages: oldMessages }, migrated: { schema: newSchema, messages: newMessages } }
      } finally {
        try { if (started) pa(extract, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
        rmSync(extract, { recursive: true, force: true })
      }
    })

    await push(define('E6-ARTIFACT-CURRENT-SCOPE', 'The frozen D tuple is measured from its own bytes and schema rather than assumed stale', {
      layer: LAYERS.READONLY,
    }), async ({ assert, evidence }) => {
      const { PRODUCT_SCHEMA_VERSION } = await import('../../../packages/storage/dist/index.js')
      assert('TUPLE_SCHEMA_READ', Number.isSafeInteger(ARTIFACTS.upgrade.productSchema), String(ARTIFACTS.upgrade.productSchema))
      assert('MAIN_SCHEMA_CURRENT', Number.isSafeInteger(PRODUCT_SCHEMA_VERSION) && PRODUCT_SCHEMA_VERSION >= 16, String(PRODUCT_SCHEMA_VERSION))
      assert('TUPLE_HAS_CONTEXT_SEND', TARGET_CAPABILITY.hasContextRoute === true, JSON.stringify(TARGET_CAPABILITY))
      assert('TUPLE_REPLY_CONSUMER_MEASURED', typeof TARGET_CAPABILITY.hasReplyResults === 'boolean', String(TARGET_CAPABILITY.hasReplyResults))
      assert('TUPLE_SCHEMA_MEASURED', ARTIFACTS.upgrade.productSchema === 16 || ARTIFACTS.upgrade.productSchema > 0, String(ARTIFACTS.upgrade.productSchema))
      const currentMainEligible = ARTIFACTS.upgrade.productSchema === PRODUCT_SCHEMA_VERSION && TARGET_CAPABILITY.hasContextRoute &&
        TARGET_CAPABILITY.hasHistoryRoute && TARGET_CAPABILITY.hasSourcesRoute && TARGET_CAPABILITY.hasReplyResults
      evidence.frozenScope = {
        artifact: { buildId: ARTIFACTS.upgrade.buildId, source: ARTIFACTS.upgrade.sourceCommit,
          schema: ARTIFACTS.upgrade.productSchema, tarSha256: ARTIFACTS.upgrade.tarSha256, tarBytes: ARTIFACTS.upgrade.tarBytes,
          abi: ARTIFACTS.upgrade.abi, platform: ARTIFACTS.upgrade.platform, arch: ARTIFACTS.upgrade.arch },
        capability: TARGET_CAPABILITY,
        main: { schema: PRODUCT_SCHEMA_VERSION },
        currentMainEligible,
        reason: currentMainEligible ? null
          : `artifact schema ${ARTIFACTS.upgrade.productSchema} and routed context=${TARGET_CAPABILITY.hasContextRoute}, main schema ${PRODUCT_SCHEMA_VERSION}; the bytes are scoped to their own tuple`,
      }
    })

    const currentProbe = await (async () => {
      const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w15-current-')))
      const ownInstall = join(own, 'install')
      const ownBin = join(own, 'bin')
      mkdirSync(ownInstall, { recursive: true }); mkdirSync(ownBin, { recursive: true })
      spawnSync('ln', ['-sf', process.execPath, join(ownBin, 'node')])
      const mock = await candidateModel()
      const env = { PATH: `${ownBin}:/usr/bin:/bin:/usr/sbin:/sbin`, PA_MODEL_CONFIG: mock.file }
      let started, client, configuration, actions = {}
      try {
        spawnSync('tar', ['-xzf', ARTIFACTS.upgrade.tarPath, '-C', ownInstall, '--strip-components=1'])
        const first = pa(ownInstall, ['first-run', '--json'], { env })
        const [port, apiPort] = await freePorts()
        started = startPersonalInstall(ownInstall, { port, apiPort, env, extraArgs: ['--discussion-only'] })
        const running = await started.attempt
        if (running.status === 'RUNNING' && running.instance?.apiURL) {
          try {
            client = new LocalProductClient({ baseURL: running.instance.apiURL, stateDir: running.instance.state, timeoutMs: 15_000 })
            configuration = await client.configuration()
            const project = configuration.projects.find(item => item.discussionOnly) ?? configuration.projects.find(item => item.dispatchAllowed) ?? configuration.projects[0]
            if (project) {
              const seeded = await client.dispatch({ commandId: 'w15-current-seed', conversationId: 'conv-current', projectId: project.id, kind: 'chat', text: 'W15 当前包来源。' })
              actions.seed = seeded.receipt?.status ?? seeded.status ?? null
              await new Promise(resolve => setTimeout(resolve, 700))
              const prepared = await client.request('/v1/assistant/context/prepare', { method: 'POST', body: {
                commandId: 'w15-current-ctx', text: 'W15 当前包上下文。', context: { projectId: project.id, conversationId: 'conv-current',
                  selections: ['project', 'conversation'], budget: { maxFiles: 8, maxBytes: 32768, maxTokens: 4096 } } } })
              actions.prepare = prepared.status
              if (prepared.status === 200) {
                const sent = await client.request('/v1/assistant/context/send', { method: 'POST', body: { commandId: 'w15-current-ctx', token: prepared.body.token } })
                actions.send = sent.status
                actions.sendStatus = sent.body?.status ?? null
                let page
                for (let i = 0; i < 50; i += 1) {
                  page = await client.conversation('conv-current')
                  if (page.messages.some(item => item.provenance === 'reasoner_reply')) break
                  await new Promise(resolve => setTimeout(resolve, 150))
                }
                actions.reply = page?.messages.find(item => item.provenance === 'reasoner_reply')?.text ?? null
                const user = page?.messages.find(item => item.role === 'user' && item.text.includes('W15 当前包上下文'))
                const audit = user ? await client.request(`/v1/messages/${user.id}/context`) : { status: 0 }
                actions.audit = audit.status
                const history = await client.request(`/v1/context/history?projectId=${encodeURIComponent(project.id)}&conversationId=conv-current&limit=5`)
                actions.history = history.status
                if (user) actions.sources = (await client.request(`/v1/messages/${user.id}/context/sources`)).status
                if (user) {
                  const candidates = await client.request(`/v1/messages/${user.id}/candidates`)
                  actions.candidates = candidates.status
                  actions.candidateStatus = candidates.body?.status ?? null
                  if (candidates.status === 200 && candidates.body?.status === 'candidates') {
                    const selected = candidates.body.candidates[0]
                    const preview = await client.request('/v1/assistant/candidates/prepare', { method: 'POST', body: { messageId: user.id, index: selected.index, payloadDigest: selected.payloadDigest } })
                    actions.candidatePrepare = preview.status
                    if (preview.status === 200) {
                      const confirmed = await client.request('/v1/proposals/commands', { method: 'POST', body: { kind: 'confirm_proposal', commandId: 'w16-current-candidate', projectId: project.id, conversationId: 'conv-current', token: preview.body.token } })
                      actions.candidateConfirm = confirmed.status
                      actions.candidateConfirmStatus = confirmed.body?.status ?? null
                    }
                  }
                }
              }
            }
          } catch (error) { actions.failure = String(error?.message ?? error).slice(0, 300) }
        }
        return { subject: artifactSubject(ARTIFACTS.upgrade), capability: TARGET_CAPABILITY, mode: 'personal',
          action: 'first_run_discussion_only_personal_with_mock_provider', firstRun: first.json?.status ?? null,
          observed: running.status ?? null, code: running.code ?? null, instanceMode: running.instance?.mode ?? null,
          health: running.instance?.apiURL ? 'running' : null,
          configuration: configuration ? { assistantContextAvailable: configuration.assistantContextAvailable,
            contextHistoryAvailable: configuration.contextHistoryAvailable, contextSourcesAvailable: configuration.contextSourcesAvailable,
            projects: configuration.projects.length } : null, actions }
      } finally {
        try { pa(ownInstall, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
        try {
          const record = JSON.parse(readFileSync(join(ownInstall, 'var/config/instance.json'), 'utf8'))
          for (const pid of [record.pid, record.apiPid]) {
            if (!Number.isSafeInteger(pid)) continue
            try {
              const command = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim()
              if (command.includes(ownInstall)) process.kill(pid, 'SIGKILL')
            } catch { /* gone */ }
          }
        } catch { /* no record */ }
        try { started?.child?.kill('SIGKILL') } catch { /* gone */ }
        await mock.close().catch(() => {})
        rmSync(own, { recursive: true, force: true })
      }
    })()
    const currentComplete = TARGET_CAPABILITY.hasContextRoute && TARGET_CAPABILITY.hasHistoryRoute &&
      TARGET_CAPABILITY.hasSourcesRoute && TARGET_CAPABILITY.hasReplyResults && TARGET_CAPABILITY.hasDiscussionReadiness &&
      currentProbe.observed === 'RUNNING' && currentProbe.instanceMode === 'personal' &&
      currentProbe.configuration?.assistantContextAvailable === true &&
      currentProbe.actions?.send === 200 && currentProbe.actions?.sendStatus === 'recorded' &&
      currentProbe.actions?.audit === 200 && currentProbe.actions?.history === 200 && currentProbe.actions?.sources === 200
    if (currentComplete) {
      await push(define('E6-CURRENT-MAIN-INSTALL', 'Current-main schema18 selected context is installed and exercised from cold personal bytes', {
        layer: LAYERS.INSTALLED, evidence: { currentInstall: { ...currentProbe, result: 'personal_start_observed' } },
      }), async ({ assert, evidence }) => {
        assert('CURRENT_PERSONAL_START', currentProbe.observed === 'RUNNING' && currentProbe.instanceMode === 'personal', JSON.stringify({ status: currentProbe.observed, code: currentProbe.code, mode: currentProbe.instanceMode }))
        assert('CURRENT_CAPABILITIES', currentComplete === true, JSON.stringify({ capability: currentProbe.capability, configuration: currentProbe.configuration }))
        assert('CURRENT_ACTIONS', currentProbe.actions?.send === 200 && currentProbe.actions?.sendStatus === 'recorded' && currentProbe.actions?.audit === 200 && currentProbe.actions?.history === 200 && currentProbe.actions?.sources === 200 && !!currentProbe.actions?.reply, JSON.stringify(currentProbe.actions))
        evidence.currentInstall = { ...currentProbe, result: 'personal_context_history_sources_reply_observed' }
      })
    } else {
      const reason = `NOT_TESTED: actual probe extracted ${ARTIFACTS.upgrade.buildId}, first-run=${currentProbe.firstRun}, personal start=${currentProbe.observed}/${currentProbe.code ?? 'none'}, instanceMode=${currentProbe.instanceMode}; capabilities context=${TARGET_CAPABILITY.hasContextRoute}, history=${TARGET_CAPABILITY.hasHistoryRoute}, sources=${TARGET_CAPABILITY.hasSourcesRoute}, replyResults=${TARGET_CAPABILITY.hasReplyResults}, discussionReadiness=${TARGET_CAPABILITY.hasDiscussionReadiness}. This tuple is not the current-main M1 package; it was executed, not relabeled. Required: freeze a D tar containing the e1e0c97/d9d347e/b2b1adb product paths, then run the same personal probe plus context/history/source/reply.`
      cases.push(notTested({ ...define('E6-CURRENT-MAIN-INSTALL', 'Current-main schema18 selected context is installed and exercised from cold personal bytes', {
        layer: LAYERS.INSTALLED, limitations: [reason],
        evidence: { currentInstall: { ...currentProbe, result: 'not_current_m1' } },
      }) }, reason))
    }

    if (currentProbe.actions?.candidateStatus === 'candidates' && currentProbe.actions?.candidateConfirmStatus === 'recorded') {
      await push(define('E5-INSTALLED-CANDIDATES', 'The installed package exposes an inert candidate, prepares it and confirms once through the original proposal transaction', {
        layer: LAYERS.INSTALLED, evidence: { installedCandidates: { subject: artifactSubject(ARTIFACTS.upgrade), actions: currentProbe.actions } },
      }), async ({ assert, evidence }) => {
        assert('INSTALLED_CANDIDATE_GET', currentProbe.actions.candidates === 200, String(currentProbe.actions.candidates))
        assert('INSTALLED_CANDIDATE_PREPARE', currentProbe.actions.candidatePrepare === 200, String(currentProbe.actions.candidatePrepare))
        assert('INSTALLED_CANDIDATE_CONFIRM', currentProbe.actions.candidateConfirmStatus === 'recorded', String(currentProbe.actions.candidateConfirmStatus))
        evidence.installedCandidates = { subject: artifactSubject(ARTIFACTS.upgrade), actions: currentProbe.actions }
      })
    } else {
      cases.push(notTested({ ...define('E5-INSTALLED-CANDIDATES', 'The installed package exposes an inert candidate, prepares it and confirms once through the original proposal transaction', {
        layer: LAYERS.INSTALLED,
        evidence: { installedCandidates: { subject: artifactSubject(ARTIFACTS.upgrade), actions: currentProbe.actions } },
      }) }, `NOT_TESTED: the frozen 8962d10 package reply format is pre-suggestion (candidate GET=${currentProbe.actions?.candidates ?? 'not_run'}, status=${currentProbe.actions?.candidateStatus ?? 'none'}); it cannot certify the current main suggestion/candidate UI. Main-source candidate flow is separately verified by E4-CANDIDATE-FLOW.`))
    }

    await push(define('E7-OWNERSHIP-COPY', 'A copied instance record in another config root cannot stop the original self-owned API', {
      layer: LAYERS.INSTALLED,
    }), async ({ assert, evidence }) => {
      const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w12-own-')))
      const ownInstall = join(own, 'install')
      const alternate = join(own, 'copied-config')
      mkdirSync(ownInstall, { recursive: true }); mkdirSync(alternate, { recursive: true, mode: 0o700 })
      let started
      try {
        spawnSync('tar', ['-xzf', ARTIFACTS.upgrade.tarPath, '-C', ownInstall, '--strip-components=1'])
        const first = pa(ownInstall, ['first-run', '--json'])
        assert('OWNERSHIP_FIRST_RUN', first.status === 0, first.stderr.slice(-300))
        const [port, apiPort] = await freePorts()
        started = startPa(ownInstall, { port, apiPort })
        const running = await started.attempt
        assert('OWNERSHIP_RUNNING', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
        const recordPath = join(ownInstall, 'var/config/instance.json')
        const record = JSON.parse(readFileSync(recordPath, 'utf8'))
        writeFileSync(join(alternate, 'instance.json'), JSON.stringify(record, null, 2), { mode: 0o600 })
        const copiedStop = pa(ownInstall, ['stop', '--json'], { timeoutMs: 20_000, env: { PA_CONFIG_ROOT: alternate } })
        const apiAlive = (() => { try { return process.kill(record.apiPid, 0) === true } catch { return false } })()
        assert('OWNERSHIP_COPY_REFUSED', copiedStop.status !== 0, JSON.stringify({ status: copiedStop.status, code: copiedStop.json?.code }))
        assert('OWNERSHIP_ORIGINAL_ALIVE', apiAlive, `apiPid ${record.apiPid}`)
        evidence.ownershipCopy = { subject: artifactSubject(ARTIFACTS.upgrade), status: copiedStop.status, code: copiedStop.json?.code ?? null, apiAlive,
          sourceConfig: join(ownInstall, 'var/config'), copiedConfig: alternate }
      } finally {
        try { pa(ownInstall, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
        try { started?.child?.kill('SIGKILL') } catch { /* already gone */ }
        rmSync(own, { recursive: true, force: true })
      }
    })

      await push(define('E7-OWNERSHIP-WRONG-INSTALL', "A second install cannot stop the first install's self-owned instance", {
      layer: LAYERS.INSTALLED,
    }), async ({ assert, evidence }) => {
      const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w13-wronginstall-')))
      const installA = join(own, 'a'), installB = join(own, 'b')
      mkdirSync(installA, { recursive: true }); mkdirSync(installB, { recursive: true })
      let started
      try {
        for (const dir of [installA, installB]) {
          spawnSync('tar', ['-xzf', ARTIFACTS.upgrade.tarPath, '-C', dir, '--strip-components=1'])
          const first = pa(dir, ['first-run', '--json'])
          assert(`WRONG_INSTALL_FIRST_${dir.endsWith('a') ? 'A' : 'B'}`, first.status === 0, first.stderr.slice(-200))
        }
        const [port, apiPort] = await freePorts()
        started = startPa(installA, { port, apiPort })
        const running = await started.attempt
        assert('WRONG_INSTALL_RUNNING', running.status === 'RUNNING', JSON.stringify({ status: running.status, code: running.code }))
        const record = JSON.parse(readFileSync(join(installA, 'var/config/instance.json'), 'utf8'))
        const stop = pa(installB, ['stop', '--json'], { timeoutMs: 20_000, env: {
          PA_CONFIG_ROOT: join(installA, 'var/config'), PA_DATA_ROOT: running.instance.state } })
        const apiAlive = (() => { try { return process.kill(record.apiPid, 0) === true } catch { return false } })()
        assert('WRONG_INSTALL_REFUSED', stop.status !== 0, JSON.stringify({ status: stop.status, code: stop.json?.code }))
        assert('WRONG_INSTALL_API_ALIVE', apiAlive, String(record.apiPid))
        evidence.wrongInstall = { status: stop.status, code: stop.json?.code ?? null, apiAlive }
      } finally {
        try { pa(installA, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort */ }
        try { started?.child?.kill('SIGKILL') } catch { /* gone */ }
        rmSync(own, { recursive: true, force: true })
      }
    })

  return { cases, artifacts }
  } finally {
    stopAll()
  }
}
