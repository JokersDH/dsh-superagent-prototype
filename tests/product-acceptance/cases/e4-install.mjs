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
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { sha256 } from '../lib/evidence.mjs'

/**
 * Independent acceptance of D's frozen wave-06 install artifact.
 *
 * The artifact is verified by digest before use, extracted into a fresh temporary root outside this
 * checkout, and then exercised only through the installed `bin/pa` and the product's own HTTP entry.
 * Nothing from the source checkout (packages/, node_modules/, the dev launcher) is imported, and the
 * tests never start or stop the user's existing 5180-5184/8796-8800 instances.
 */
const ARTIFACTS = Object.freeze({
  base: {
    role: 'base',
    name: 'wave06-alpha-b0f87c88',
    buildId: 'b0f87c883aa6b206',
    productSchema: 12,
    tarPath: process.env.PA_E_INSTALL_TAR_BASE ?? '/Users/hh/Desktop/joker/pa-artifacts/wave06/wave06-alpha-b0f87c88.tar.gz',
    tarSha256: '8b728b610d980fa9fa4a37886ecd50a3a767098ce7f4bec5bf9b35cb552b5c5d',
    tarBytes: 19762074,
    installManifestSha256: '64444cb87130593d656738fd6929333533738f73b1cfec0c2858eaa4c823d5b9',
    releaseManifestSha256: '962c89dc85d593dd211a80108cf8f71b2fdfd72df09718e6c5e239c5625c4e7f',
    closureDigest: '10f3c1eccd544a96cc619e7c75cf29130c388f7bd28512f311f2accd878f8c8e',
    files: 6483,
    sourceCommit: '9046d4c5d3b9f583ba6384b851c32cc5703437c9',
    sourceDirty: true,
  },
  upgrade: {
    role: 'upgrade',
    name: 'wave06-alpha2-7e8f6ce6',
    buildId: '7e8f6ce6fa2e2633',
    productSchema: 13,
    tarPath: process.env.PA_E_INSTALL_TAR_UPGRADE ?? '/Users/hh/Desktop/joker/pa-artifacts/wave06-alpha2/wave06-alpha2-7e8f6ce6.tar.gz',
    tarSha256: '0fe0ed53e6c4f50ff87fa9fe14518f1f45ca4bbf3c5cb9322c8babbeed1c7631',
    tarBytes: 19911757,
    installManifestSha256: '09041204af46dca6810a070b4f2cba9895f07e2a56776ec8472af96ef785b548',
    releaseManifestSha256: '749ed6b304e6cfe782ae50987b94fa29cfa49c85e3d884b126485f546b8eb87e',
    closureDigest: '55069a730c6954261da765fc5dceadf78df2697f3348d4a99f64782e630e2966',
    files: 6603,
    sourceCommit: 'e10bfdb7a74f40b72a5e61d0debb0ed0bdd22389',
    sourceDirty: false,
  },
})
const PLATFORM = Object.freeze({
  platform: 'darwin',
  arch: 'arm64',
  node: '24.21.0',
  abi: '137',
  sqlite: '3.53.4',
  dependencies: ['@hono/node-server', 'better-sqlite3', 'hono', 'node-addon-api', 'openai', 'semver', 'yaml', 'zod'],
})
/** The base artifact is the compatibility view used by the original install cases. */
export const EXPECTED = ARTIFACTS.base

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

  const workspace = mkdtempSync(join(tmpdir(), 'pa-e-install-'))
  const install = join(workspace, 'base')
  const upgradeInstall = join(workspace, 'upgrade')
  const pristine = join(workspace, 'pristine')
  let stopped = false
  const stopAll = () => {
    if (stopped) return
    stopped = true
    try { pa(install, ['stop', '--json'], { timeoutMs: 20_000 }) } catch { /* best effort cleanup */ }
  }
  const push = async (definition, body) => {
    const result = await runCase({ ...definition, evidence: {} }, body)
    cases.push(result)
    return result
  }

  try {
    mkdirSync(install, { recursive: true })
    mkdirSync(upgradeInstall, { recursive: true })
    execFileSync('tar', ['-xzf', ARTIFACTS.base.tarPath, '-C', install, '--strip-components=1'])
    execFileSync('tar', ['-xzf', ARTIFACTS.upgrade.tarPath, '-C', upgradeInstall, '--strip-components=1'])

    await push(define('E4-INSTALL-ARTIFACT-IDENTITY', 'The frozen install bytes match the recorded artifact identity'), async ({ assert, evidence }) => {
      for (const artifact of [ARTIFACTS.base, ARTIFACTS.upgrade]) {
        assert(`TAR_DIGEST_${artifact.role}`, digest(artifact.tarPath) === artifact.tarSha256, digest(artifact.tarPath))
        assert(`TAR_BYTES_${artifact.role}`, statSync(artifact.tarPath).size === artifact.tarBytes, String(statSync(artifact.tarPath).size))
      }
      const manifest = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8'))
      assert('INSTALL_PROTOCOL', manifest.format === 'pa-install' && manifest.formatVersion === 1, manifest.format)
      assert('INSTALL_BUILD_ID', manifest.buildId === EXPECTED.buildId, manifest.buildId)
      assert('INSTALL_MANIFEST_DIGEST', digest(join(install, 'install.json')) === EXPECTED.installManifestSha256, digest(join(install, 'install.json')))
      assert('RELEASE_MANIFEST_DIGEST', digest(join(install, 'var/config/release.json')) === EXPECTED.releaseManifestSha256, digest(join(install, 'var/config/release.json')))
      assert('PRODUCER_PLATFORM', manifest.producer.platform === PLATFORM.platform && manifest.producer.arch === PLATFORM.arch, `${manifest.producer.platform}/${manifest.producer.arch}`)
      assert('PRODUCER_NODE', manifest.producer.node === PLATFORM.node, manifest.producer.node)
      assert('PRODUCER_ABI', String(manifest.producer.abi) === PLATFORM.abi && manifest.producer.sqlite === PLATFORM.sqlite, `${manifest.producer.abi}/${manifest.producer.sqlite}`)
      assert('SOURCE_COMMIT', manifest.source.commit === EXPECTED.sourceCommit, manifest.source.commit)
      const deps = (manifest.dependencies ?? []).map((item) => (typeof item === 'string' ? item : item.name)).sort()
      assert('DEPENDENCY_CLOSURE', JSON.stringify(deps) === JSON.stringify([...PLATFORM.dependencies].sort()), JSON.stringify(deps))
      for (const rel of ['app/apps/launcher/bin/pa.mjs', 'app/apps/coordinator/product/demo.ts', 'app/apps/console/dist/index.html', 'app/node_modules/better-sqlite3'])
        assert(`ENTRYPOINT_${rel.split('/').at(-1)}`, existsSync(join(install, rel)), rel)
      const scan = scanCheckoutReferences(install)
      assert('NO_CHECKOUT_REFERENCES', scan.hits.length === 0, JSON.stringify(scan.hits.slice(0, 5)))
      const version = pa(install, ['version', '--json'])
      assert('LAUNCHER_VERSION', version.status === 0 && version.json?.node === process.versions.node, JSON.stringify(version.json))
      const upgradeManifest = JSON.parse(readFileSync(join(upgradeInstall, 'install.json'), 'utf8'))
      assert('UPGRADE_BUILD_ID', upgradeManifest.buildId === ARTIFACTS.upgrade.buildId, upgradeManifest.buildId)
      assert('UPGRADE_INSTALL_DIGEST', digest(join(upgradeInstall, 'install.json')) === ARTIFACTS.upgrade.installManifestSha256, digest(join(upgradeInstall, 'install.json')))
      assert('UPGRADE_RELEASE_DIGEST', digest(join(upgradeInstall, 'var/config/release.json')) === ARTIFACTS.upgrade.releaseManifestSha256, digest(join(upgradeInstall, 'var/config/release.json')))
      assert('UPGRADE_SOURCE', upgradeManifest.source.commit === ARTIFACTS.upgrade.sourceCommit && upgradeManifest.source.dirty === false, JSON.stringify(upgradeManifest.source))
      assert('UPGRADE_SCHEMA', upgradeManifest.producer.productSchema === 13, String(upgradeManifest.producer.productSchema))
      assert('DISTINCT_BUILDS', upgradeManifest.buildId !== manifest.buildId && ARTIFACTS.base.tarSha256 !== ARTIFACTS.upgrade.tarSha256)
      evidence.artifact = {
        artifacts: [
          { role: 'base', name: ARTIFACTS.base.name, buildId: ARTIFACTS.base.buildId, tarSha256: ARTIFACTS.base.tarSha256, schema: 12, source: manifest.source },
          { role: 'upgrade', name: ARTIFACTS.upgrade.name, buildId: ARTIFACTS.upgrade.buildId, tarSha256: ARTIFACTS.upgrade.tarSha256, schema: 13, source: upgradeManifest.source },
        ],
        files: manifest.files?.count,
        producer: manifest.producer,
        scannedModules: scan.scanned,
        extractedAt: workspace,
      }
      // The strict installed-alpha layer binds these facts rather than trusting a self-description.
      evidence.installation = {
        status: 'installed',
        bundleVersion: EXPECTED.buildId,
        bundleDigest: EXPECTED.tarSha256,
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
        assert('START_BUILD', record?.buildId === EXPECTED.buildId, String(record?.buildId))
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
        pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
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

    await push(define('E4-UPGRADE-ROLLBACK', 'A second frozen build upgrades real data; the old binary refuses the new schema and an explicit restore does not delete it'), async ({ assert, evidence }) => {
      pa(install, ['stop', '--json'], { timeoutMs: 20_000 })
      pa(upgradeInstall, ['stop', '--json'], { timeoutMs: 20_000 })
      for (const target of [install, upgradeInstall]) {
        const first = pa(target, ['first-run', '--json'])
        assert(`FIRST_RUN_${target === install ? 'base' : 'upgrade'}`, first.status === 0 && first.json?.status === 'OK', first.stdout + first.stderr)
      }
      const [p1, a1, p2, a2, p3, a3, p4, a4] = await freePorts(8)
      // A dedicated state keeps the upgrade flow independent of earlier cases' rollback markers.
      const baseState = join(workspace, 'upgrade-base-state')
      const baseEnv = { PA_DATA_ROOT: baseState }
      const baseStart = startPa(install, { port: p1, apiPort: a1, env: baseEnv })
      const baseRunning = await baseStart.attempt
      assert('BASE_RUNNING', baseRunning.status === 'RUNNING', JSON.stringify({ status: baseRunning.status, code: baseRunning.code }))
      let seeded
      try {
        const client = new LocalProductClient({ baseURL: baseRunning.instance.apiURL, stateDir: baseState, timeoutMs: 25_000 })
        const configuration = await client.configuration()
        const project = configuration.projects.find((item) => item.dispatchAllowed)
        const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)
        seeded = await seedProduct(client, {
          projectId: project.id,
          scope: project.scope,
          criteria: [machine].filter(Boolean),
          profileId: project.profileIds.find((id) => id.endsWith('-pass')) ?? project.defaultProfileId,
          conversationId: 'conv-upgrade',
        })
        assert('BASE_SEEDED', seeded.phase === 'delivered' && seeded.acceptedReceipt === 'recorded', JSON.stringify(seeded))
      } finally {
        pa(install, ['stop', '--json'], { timeoutMs: 30_000 })
      }
      const beforeSchema = readSchema(baseState)
      const beforeMessages = countMessages(baseState)
      assert('BASE_SCHEMA', beforeSchema === ARTIFACTS.base.productSchema, String(beforeSchema))
      const preBundle = join(workspace, 'pre-upgrade.pab')
      const backup = pa(install, ['backup', '--out', preBundle, '--json'], { timeoutMs: 60_000, env: baseEnv })
      assert('PRE_UPGRADE_BACKUP', backup.status === 0 && existsSync(preBundle), backup.stdout + backup.stderr)

      const upgradeStart = startPa(upgradeInstall, { port: p2, apiPort: a2, env: { PA_DATA_ROOT: baseState } })
      const upgraded = await upgradeStart.attempt
      assert('UPGRADE_RUNNING', upgraded.status === 'RUNNING', JSON.stringify({ status: upgraded.status, code: upgraded.code, stderr: upgraded.stderr().slice(0, 300) }))
      assert('UPGRADE_BUILD_RUNNING', upgraded.instance?.buildId === ARTIFACTS.upgrade.buildId, String(upgraded.instance?.buildId))
      let afterMessages
      try {
        assert('SCHEMA_MIGRATED', readSchema(baseState) === ARTIFACTS.upgrade.productSchema, String(readSchema(baseState)))
        const client = new LocalProductClient({ baseURL: upgraded.instance.apiURL, stateDir: baseState, timeoutMs: 25_000 })
        const page = await client.conversation('conv-upgrade')
        assert('PRE_UPGRADE_DATA_READABLE', page.messages.some((item) => item.text?.includes('安装物验收')), JSON.stringify(page.messages.at(-1)))
        const post = await client.dispatch({ commandId: `post-upgrade-${Date.now()}`, conversationId: 'conv-upgrade', kind: 'chat', projectId: 'project-atlas', text: '升级后新增的数据' })
        assert('POST_UPGRADE_WRITE', post.receipt.status === 'recorded', JSON.stringify(post.receipt))
        afterMessages = countMessages(baseState)
        assert('POST_UPGRADE_MESSAGE', hasMessage(baseState, '升级后新增的数据'))
        assert('MESSAGE_GROWTH', afterMessages > beforeMessages, `${beforeMessages} -> ${afterMessages}`)
        const work = await client.work(seeded.workId)
        assert('WORK_INTACT', work.phase === 'delivered' && JSON.stringify(work.artifactIds) === JSON.stringify(seeded.artifactIds), JSON.stringify({ phase: work.phase, artifacts: work.artifactIds }))
      } finally {
        pa(upgradeInstall, ['stop', '--json'], { timeoutMs: 30_000 })
      }

      // The old binary must refuse the newer schema instead of silently reverting data.
      const oldOnNew = startPa(install, { port: p3, apiPort: a3, env: baseEnv })
      const refused = await oldOnNew.attempt
      assert('OLD_BINARY_REFUSED', refused.status !== 'RUNNING' && refused.exitCode === 2 && refused.code === 'daemon_start_failed', JSON.stringify({ status: refused.status, exitCode: refused.exitCode, code: refused.code }))
      const daemonLog = readdirSync(join(install, 'var/logs'))
        .filter((name) => name.startsWith('daemon-'))
        .map((name) => readFileSync(join(install, 'var/logs', name), 'utf8'))
        .join('\n')
      const refusalText = `${JSON.stringify(refused.detail ?? {})}\n${refused.stderr()}\n${daemonLog}`
      assert('OLD_BINARY_MIGRATION_ERROR', /MigrationIntegrityError|Applied migration .* is not registered/.test(refusalText), refusalText.slice(-400))
      assert(
        'DATA_NOT_DELETED',
        readSchema(baseState) === ARTIFACTS.upgrade.productSchema &&
          hasMessage(baseState, '升级后新增的数据') &&
          hasMessage(baseState, '安装物验收'),
        `${readSchema(baseState)} messages ${countMessages(baseState)} (was ${afterMessages})`,
      )

      // An explicit restore of the pre-upgrade backup into a NEW state is data recovery, not a
      // lossless binary downgrade: the upgraded state above is left intact.
      const restoredState = join(workspace, 'restored-pre-upgrade')
      const restored = pa(install, ['restore', '--bundle', preBundle, '--to', restoredState, '--json'], { timeoutMs: 60_000 })
      assert('RESTORE_EXPLICIT', restored.status === 0 && restored.json?.status === 'RESTORED', restored.stdout + restored.stderr)
      assert('RESTORED_SCHEMA', readSchema(restoredState) === ARTIFACTS.base.productSchema, String(readSchema(restoredState)))
      assert('RESTORED_DATA', hasMessage(restoredState, '安装物验收') && !hasMessage(restoredState, '升级后新增的数据'))
      const restoredStart = startPa(install, { port: p4, apiPort: a4, env: { PA_DATA_ROOT: restoredState } })
      const again = await restoredStart.attempt
      assert('RESTORED_STARTS', again.status === 'RUNNING', JSON.stringify({ status: again.status, code: again.code }))
      assert('RESTORED_UPGRADED_STATE_KEPT', readSchema(baseState) === ARTIFACTS.upgrade.productSchema && hasMessage(baseState, '升级后新增的数据'))
      pa(install, ['stop', '--json'], { timeoutMs: 30_000 })

      evidence.upgrade = {
        base: { buildId: ARTIFACTS.base.buildId, schema: beforeSchema, tarSha256: ARTIFACTS.base.tarSha256 },
        upgrade: { buildId: ARTIFACTS.upgrade.buildId, schema: ARTIFACTS.upgrade.productSchema, tarSha256: ARTIFACTS.upgrade.tarSha256 },
        migratedSchema: readSchema(baseState),
        messages: { before: beforeMessages, after: afterMessages },
        preUpgradeDataReadable: true,
        postUpgradeMessageKept: hasMessage(baseState, '升级后新增的数据'),
        oldBinary: { code: refused.code, migrationError: true, dataUntouched: true, detail: refused.detail ?? null },
        explicitRestore: { schema: readSchema(restoredState), upgradedStateKept: true },
      }
    })

  } finally {
    stopAll()
    if (!keep) rmSync(workspace, { recursive: true, force: true })
  }
  return { cases, artifacts }
}
