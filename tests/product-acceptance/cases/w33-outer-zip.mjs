import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { captureSet, createOperation, resourceBirth, rollout } from '../lib/caller-safety.mjs'
import { extractOuterZip, launcherEnv, OUTER_ZIP_DIR, OUTER_ZIP_NAME, parseJson, privateHome, verifyOuterZip } from '../lib/outer-zip.mjs'
import { freePort, liveIdentity } from '../lib/packaged-instance.mjs'

/**
 * Wave-34 locked outer distribution ZIP.
 *
 * The candidate is the fixed shareable ZIP for the current W33 cohort (SHA256SUMS +
 * package-result.json), extracted into a private HOME and driven through the package's own
 * Start/Stop/status with the bundled Node. The caller owns one operation: every product process and
 * the whole private HOME are tracked from birth, and the HOME is deleted only when the complete set
 * is re-observed exited. A failure, refusal or unknown keeps the entire material set.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w34zip] ${message}\n`) }

function runner(root, home) {
  return (args, { timeoutMs = 60_000 } = {}) => {
    const result = spawnSync(join(root, 'runtime/bin/node'), [join(root, 'personal-preview-launcher.mjs'), ...args], {
      cwd: root, env: launcherEnv(home), encoding: 'utf8', timeout: timeoutMs,
    })
    return { status: result.status, json: parseJson(result.stdout), stdout: String(result.stdout).slice(-600), stderr: String(result.stderr).slice(-600) }
  }
}

async function startAsync(root, home, args, extraEnv = {}) {
  const child = spawn(join(root, 'Start.command'), args, { cwd: root, env: launcherEnv(home, extraEnv), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', chunk => { out += chunk })
  child.stderr.on('data', chunk => { out += chunk })
  return { child, output: () => out.slice(-800) }
}

async function waitStatus(run, { attempts = 120, wantRunning = true } = {}) {
  let last = null
  for (let index = 0; index < attempts; index += 1) {
    last = run(['status'], { timeoutMs: 20_000 })
    if (wantRunning) { if (last.json?.status === 'RUNNING') return last }
    else if (last.json?.status === 'STOPPED' || last.json?.status === 'RUNNING') return last
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  return last
}

async function waitExited(pid, attempts = 80) {
  for (let index = 0; index < attempts; index += 1) { if (!liveIdentity(pid).alive) return true; await new Promise(resolvePromise => setTimeout(resolvePromise, 50)) }
  return !liveIdentity(pid).alive
}

function indexPath(root, home, manifest) {
  return join(home, 'Library/Application Support/PersonalAgent', `Preview-${manifest.inner.buildId}`, 'config/instance.json')
}

const recordPids = path => {
  if (!existsSync(path)) return []
  const record = JSON.parse(readFileSync(path, 'utf8'))
  return [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger)
}

export async function runOuterZip() {
  const cases = []
  const zipPath = join(OUTER_ZIP_DIR, OUTER_ZIP_NAME)
  const evidence = { zip: { path: zipPath, sha256: null, bytes: null, source: null, buildId: null, innerTarSha256: null,
    innerTarBytes: null, installManifestSha256: null, runtime: null, entries: null, secretScan: null },
    phases: {}, negatives: {}, operation: null }
  let mock = null, runnerFn = null, home = null, root = null, failure = null
  const operation = createOperation({ id: 'w34-outer-zip' })

  const track = (label, pid, { state = null, config = null, role = 'product' } = {}) => {
    try {
      operation.track(resourceBirth(pid, { root, state, config, op: `outer-zip:${label}`, role }))
      return true
    } catch (error) {
      operation.fail(`track:${label}`, error)
      operation.retain(`track_failed:${label}`)
      return false
    }
  }

  const capture = (label, recordPath) => {
    const pids = recordPids(recordPath)
    const config = dirname(recordPath)
    const state = join(dirname(recordPath), '..', 'data')
    for (const pid of pids) track(label, pid, { state, config })
    return captureSet(pids, { root, config, state, op: `outer-zip:${label}` })
  }

  try {
    const zipValue = verifyOuterZip(OUTER_ZIP_DIR)
    const result = zipValue.result
    evidence.zip.sha256 = zipValue.sha256
    evidence.zip.bytes = zipValue.bytes
    evidence.zip.sumsMatch = zipValue.sumsMatch
    evidence.zip.resultMatch = zipValue.resultMatch
    evidence.zip.source = result?.inner?.source ?? null
    evidence.zip.buildId = result?.inner?.buildId ?? null
    evidence.zip.innerTarSha256 = result?.inner?.tarSha256 ?? null
    evidence.zip.innerTarBytes = result?.inner?.tarBytes ?? null
    evidence.zip.installManifestSha256 = result?.inner?.installManifestSha256 ?? null
    evidence.zip.runtime = result?.runtime ? { version: result.runtime.version, abi: result.runtime.abi, sha256: result.runtime.sha256,
      licenseSha256: result.runtime.licenseSha256, bytes: result.runtime.bytes,
      platform: result.runtime.platform ?? null, arch: result.runtime.arch ?? null } : null

    home = privateHome('pa-e-w34-home-')
    operation.addMaterial(home, 'private-home-install-runtime')
    const extracted = extractOuterZip(zipValue, home)
    root = extracted.root
    const manifest = extracted.manifest
    evidence.zip.entries = extracted.entries
    evidence.zip.installManifestDigest = extracted.digests.installManifest
    evidence.zip.runtimeDigest = extracted.digests.runtime
    evidence.zip.licenseDigest = extracted.digests.license
    evidence.zip.manifestProtocol = manifest.protocol

    const secretScan = spawnSync('grep', ['-rIl', '-E', '(sk-[A-Za-z0-9]{20,}|api[_-]?key["\u0027]?\\s*[:=]\\s*["\u0027][A-Za-z0-9]{16,})', join(root, 'install/app/apps')], { encoding: 'utf8', timeout: 60_000 })
    evidence.zip.secretScan = { status: secretScan.status, hits: String(secretScan.stdout ?? '').split('\n').filter(Boolean).length }

    // Settings: the supported entry launches a GUI editor through an absolute /usr/bin/open, which E
    // must not trigger unattended. Its template contract is read from the frozen launcher bytes.
    const launcherSource = readFileSync(join(root, 'personal-preview-launcher.mjs'), 'utf8')
    evidence.settings = {
      entry: 'Settings.command',
      template: { mode0600: /mode:\s*0o600/u.test(launcherSource), exclusive: /flag:\s*'wx'/u.test(launcherSource),
        keys: ['baseURL', 'apiKey', 'model', 'allowedModels', 'allowInsecureHttp', 'maxOutputTokens']
          .filter(key => launcherSource.includes(`'${key}'`) || launcherSource.includes(`${key}:`)) },
      gui: 'HELD',
      reason: 'Settings.command opens TextEdit through the absolute /usr/bin/open; E does not launch a GUI editor unattended.',
    }

    runnerFn = runner(root, home)
    const recordPath = indexPath(root, home, manifest)

    // Phase 1: unconfigured private root, discussion-only start through the supported Start.command.
    // The packaged launcher can race its own first-run directory creation (EEXIST) on a loaded host;
    // one immediate retry is recorded, never hidden.
    const [p1, a1] = [await freePort(), await freePort()]
    mark('start unconfigured')
    const attempts = []
    let firstStart = await startAsync(root, home, ['--port', String(p1), '--api-port', String(a1), '--discussion-only'])
    track('unconfigured:launcher:1', firstStart.child.pid, { role: 'launcher' })
    let status1 = await waitStatus(runnerFn)
    let firstExit = await Promise.race([
      new Promise(resolvePromise => firstStart.child.once('exit', code => resolvePromise({ code }))),
      new Promise(resolvePromise => setTimeout(() => resolvePromise({ code: 'RUNNING' }), 1_000)),
    ])
    attempts.push({ status: status1?.json?.status ?? null, exit: firstExit, output: firstStart.output().slice(-300) })
    if (status1?.json?.status !== 'RUNNING') {
      await waitExited(firstStart.child.pid)
      await new Promise(resolvePromise => setTimeout(resolvePromise, 800))
      firstStart = await startAsync(root, home, ['--port', String(p1), '--api-port', String(a1), '--discussion-only'])
      track('unconfigured:launcher:2', firstStart.child.pid, { role: 'launcher' })
      status1 = await waitStatus(runnerFn)
      firstExit = await Promise.race([
        new Promise(resolvePromise => firstStart.child.once('exit', code => resolvePromise({ code }))),
        new Promise(resolvePromise => setTimeout(() => resolvePromise({ code: 'RUNNING' }), 1_000)),
      ])
      attempts.push({ status: status1?.json?.status ?? null, exit: firstExit, output: firstStart.output().slice(-300) })
    }
    const setA = capture('unconfigured', recordPath)
    let readinessA = null, configurationA = null
    if (status1?.json?.status === 'RUNNING' && status1.json.instance?.apiURL) {
      const api = status1.json.instance.apiURL
      const key = readFileSync(join(dirname(recordPath), '..', 'data', 'api.key'), 'utf8').trim()
      readinessA = await fetch(`${api}/v1/readiness`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8_000) })
        .then(async response => ({ status: response.status, body: await response.json() })).catch(error => ({ status: 0, error: String(error.message) }))
      configurationA = await fetch(`${api}/v1/configuration`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8_000) })
        .then(async response => ({ status: response.status, body: await response.json() })).catch(error => ({ status: 0, error: String(error.message) }))
    }
    const stop1 = runnerFn(['stop'], { timeoutMs: 40_000 })
    const afterA = rollout(setA)
    const schema = (() => {
      try {
        const db = new DatabaseSync(join(dirname(recordPath), '..', 'data', 'state.sqlite'), { readOnly: true })
        try { return Number(db.prepare("select value from schema_meta where key='product_schema'").get()?.value ?? 0) } finally { db.close() }
      } catch { return null }
    })()
    evidence.phases.unconfigured = { consolePort: p1, apiPort: a1, schema, startOutput: firstStart.output().slice(-500), startExit: firstExit, attempts,
      recordPresent: existsSync(recordPath), status: status1?.json?.status ?? null, mode: status1?.json?.instance?.mode ?? null,
      startupMode: status1?.json?.instance?.startupMode ?? null,
      readiness: readinessA ? { status: readinessA.status, discussion: readinessA.body?.discussion ?? null, authorization: readinessA.body?.authorization ?? null } : null,
      contextAvailable: configurationA?.body?.assistantContextAvailable ?? null,
      stop: { status: stop1.status, result: stop1.json?.status ?? null, code: stop1.json?.code ?? null },
      resources: { before: setA, after: afterA } }
    await waitExited(firstStart.child.pid)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 600))

    // Phase 2: existing private model configuration through the supported Start.command.
    mock = await candidateModel()
    const [p2, a2] = [await freePort(), await freePort()]
    mark('start configured')
    const configuredStart = await startAsync(root, home, ['--port', String(p2), '--api-port', String(a2), '--discussion-only'],
      { PA_MODEL_CONFIG: mock.file })
    track('configured:launcher', configuredStart.child.pid, { role: 'launcher' })
    const status2 = await waitStatus(runnerFn)
    const configuredExit = await Promise.race([
      new Promise(resolvePromise => configuredStart.child.once('exit', code => resolvePromise({ code }))),
      new Promise(resolvePromise => setTimeout(() => resolvePromise({ code: 'RUNNING' }), 1_000)),
    ])
    const setB = capture('configured', recordPath)
    let readinessB = null
    if (status2?.json?.status === 'RUNNING' && status2.json.instance?.apiURL) {
      const key = readFileSync(join(dirname(recordPath), '..', 'data', 'api.key'), 'utf8').trim()
      readinessB = await fetch(`${status2.json.instance.apiURL}/v1/readiness`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8_000) })
        .then(async response => ({ status: response.status, body: await response.json() })).catch(error => ({ status: 0, error: String(error.message) }))
    }
    // Port conflict: a second start on the live console port must be refused without a second instance.
    const conflict = await startAsync(root, home, ['--port', String(p2), '--api-port', String(a2 + 1), '--discussion-only'])
    const conflictStatus = await new Promise(resolvePromise => {
      const timer = setTimeout(() => resolvePromise({ outcome: 'TIMEOUT' }), 25_000)
      conflict.child.once('exit', code => { clearTimeout(timer); resolvePromise({ outcome: 'EXITED', code }) })
    })
    evidence.negatives.portConflict = { outcome: conflictStatus.outcome, code: conflictStatus.code ?? null,
      output: conflict.output().slice(-220) }
    await waitExited(conflict.child.pid)
    const stop2 = runnerFn(['stop'], { timeoutMs: 40_000 })
    const afterB = rollout(setB)
    evidence.phases.configured = { consolePort: p2, apiPort: a2, startExit: configuredExit, status: status2?.json?.status ?? null,
      readiness: readinessB ? { status: readinessB.status, discussion: readinessB.body?.discussion ?? null } : null,
      stop: { status: stop2.status, result: stop2.json?.status ?? null }, resources: { before: setB, after: afterB } }
    await waitExited(configuredStart.child.pid)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 600))

    // Phase 2b: project import in the normal (non-discussion) personal surface of the same ZIP.
    const [p2b, a2b] = [await freePort(), await freePort()]
    const importStart = await startAsync(root, home, ['--port', String(p2b), '--api-port', String(a2b)], { PA_MODEL_CONFIG: mock.file })
    track('import:launcher', importStart.child.pid, { role: 'launcher' })
    const status2b = await waitStatus(runnerFn)
    const importExit = await Promise.race([
      new Promise(resolvePromise => importStart.child.once('exit', code => resolvePromise({ code }))),
      new Promise(resolvePromise => setTimeout(() => resolvePromise({ code: 'RUNNING' }), 1_000)),
    ])
    const setImport = capture('import', recordPath)
    let imported = { status: null, projectId: null, readBack: null }
    if (status2b?.json?.status === 'RUNNING' && status2b.json.instance?.apiURL) {
      const key = readFileSync(join(dirname(recordPath), '..', 'data', 'api.key'), 'utf8').trim()
      const projectDir = join(home, 'imported-project')
      mkdirSync(join(projectDir, 'src'), { recursive: true })
      writeFileSync(join(projectDir, 'index.mjs'), 'export const ok = true\n')
      const git = args => execFileSync('git', args, { cwd: projectDir, stdio: 'pipe' })
      git(['init', '-q']); git(['add', 'index.mjs'])
      git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'zip import'])
      const response = await fetch(`${status2b.json.instance.apiURL}/v1/projects`, { method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ path: projectDir, displayName: 'W33 导入项目', check: 'node_test' }), signal: AbortSignal.timeout(20_000) })
        .then(async value => ({ status: value.status, body: await value.json().catch(() => null) }))
        .catch(error => ({ status: 0, error: String(error.message) }))
      const echoed = (response.body?.projects ?? []).filter(item => item.displayName === 'W33 导入项目')[0] ?? null
      imported = { status: response.status, projectId: echoed?.id ?? null, readBack: (response.body?.projects ?? []).length }
    }
    const stopImport = runnerFn(['stop'], { timeoutMs: 40_000 })
    evidence.phases.import = { consolePort: p2b, apiPort: a2b, startExit: importExit, status: status2b?.json?.status ?? null,
      imported, stop: { status: stopImport.status, result: stopImport.json?.status ?? null },
      resources: { before: setImport, after: rollout(setImport) } }
    await waitExited(importStart.child.pid)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 600))

    // Phase 3: reopen through the packaged Start again (same private roots).
    const [p3, a3] = [await freePort(), await freePort()]
    const reopen = await startAsync(root, home, ['--port', String(p3), '--api-port', String(a3), '--discussion-only'])
    track('reopen:launcher', reopen.child.pid, { role: 'launcher' })
    const status3 = await waitStatus(runnerFn)
    const reopenExit = await Promise.race([
      new Promise(resolvePromise => reopen.child.once('exit', code => resolvePromise({ code }))),
      new Promise(resolvePromise => setTimeout(() => resolvePromise({ code: 'RUNNING' }), 1_000)),
    ])
    const setC = capture('reopen', recordPath)
    const stop3 = runnerFn(['stop'], { timeoutMs: 40_000 })
    evidence.phases.reopen = { status: status3?.json?.status ?? null, mode: status3?.json?.instance?.mode ?? null, startExit: reopenExit,
      stop: { status: stop3.status, result: stop3.json?.status ?? null }, resources: { before: setC, after: rollout(setC) } }
    await waitExited(reopen.child.pid)
    evidence.negatives.statusStopped = (() => {
      const value = runnerFn(['status'], { timeoutMs: 20_000 })
      return { status: value.status, result: value.json?.status ?? null }
    })()
    evidence.runtimeNode = { version: execFileSync(join(root, 'runtime/bin/node'), ['--version'], { encoding: 'utf8' }).trim(),
      abi: execFileSync(join(root, 'runtime/bin/node'), ['-p', 'process.versions.modules'], { encoding: 'utf8' }).trim() }
    evidence.subject = { source: evidence.zip.source, buildId: evidence.zip.buildId, schema,
      tarSha256: evidence.zip.innerTarSha256, tarBytes: evidence.zip.innerTarBytes,
      platform: evidence.zip.runtime?.platform ?? null, arch: evidence.zip.runtime?.arch ?? null, abi: evidence.zip.runtime?.abi ?? null }
  } catch (error) {
    failure = String(error?.message ?? error).slice(0, 600)
    operation.fail('case', error)
    operation.retain(`case_error:${failure}`)
  }

  const observation = operation.observe()
  const verdict = operation.releaseAllowed(observation)
  if (failure === null && verdict.allowed === true) {
    const released = operation.release({ observation })
    evidence.operation = { verdict, released: released.released, retained: released.retained, observation, signals: operation.signals }
  } else {
    operation.retain(failure ?? verdict.reason ?? 'unknown')
    const kept = operation.retainAll(failure ?? verdict.reason ?? 'unknown')
    evidence.operation = { verdict, released: [], retained: kept.retained, reason: kept.reason, observation,
      signals: operation.signals, failures: operation.failures }
    if (process.env.PA_E_TRACE) process.stderr.write(`[w34zip] retained ${JSON.stringify(kept.retained)}\n`)
  }
  await mock?.close?.().catch(() => {})

  cases.push(await runCase({ id: 'E33-OUTER-ZIP',
    title: 'The locked shareable outer ZIP is verified by its own hashes, extracted privately and driven through the packaged Start/Stop/status',
    layer: LAYERS.INSTALLED, evidence: { outerZip: evidence }, limitations: [
      'The private HOME is redirected for this operation; the user’s Application Support tree and existing instances are untouched.',
      'No vendor model or native run: the configured phase uses a loopback mock through an explicit PA_MODEL_CONFIG.',
      'The bundled weekly preview only exposes discussion/normal modes; fixture execution is not part of this entry.',
    ] }, async ({ assert, evidence: ev }) => {
    assert('ZIP_VERIFIED', failure === null, failure ?? 'no failure')
    const zip = evidence.zip
    assert('ZIP_DIGEST', zip.sumsMatch === true && zip.resultMatch === true, JSON.stringify({ sha: zip.sha256, sums: zip.sumsMatch, result: zip.resultMatch }))
    assert('ZIP_INNER_IDENTITY', zip.installManifestDigest === zip.installManifestSha256 && zip.runtimeDigest === zip.runtime?.sha256 &&
      zip.licenseDigest === zip.runtime?.licenseSha256 && zip.manifestProtocol === 'personal-agent-preview/1',
      JSON.stringify({ install: zip.installManifestDigest?.slice(0, 12), runtime: zip.runtimeDigest?.slice(0, 12), license: zip.licenseDigest?.slice(0, 12) }))
    assert('ZIP_NO_SECRETS', zip.secretScan?.hits === 0, JSON.stringify(zip.secretScan))
    assert('ZIP_BUNDLED_NODE', evidence.runtimeNode?.version === `v${zip.runtime?.version}` && evidence.runtimeNode?.abi === zip.runtime?.abi,
      JSON.stringify(evidence.runtimeNode))
    const unconfigured = evidence.phases.unconfigured ?? {}
    assert('ZIP_UNCONFIGURED_START', unconfigured.status === 'RUNNING' && unconfigured.readiness?.status === 200 &&
      unconfigured.readiness?.discussion !== 'configuration_present' && unconfigured.contextAvailable === false,
      JSON.stringify({ status: unconfigured.status, readiness: unconfigured.readiness, context: unconfigured.contextAvailable }))
    assert('ZIP_UNCONFIGURED_STOP', unconfigured.stop?.status === 0 && unconfigured.stop?.result === 'STOPPED' &&
      Array.isArray(unconfigured.resources?.after) && unconfigured.resources.after.length === unconfigured.resources.before.length &&
      unconfigured.resources.after.every(item => item.alive === false || item.sameIdentity === false) && unconfigured.resources.before.length >= 1,
      JSON.stringify(unconfigured.stop ?? unconfigured.resources))
    const configured = evidence.phases.configured ?? {}
    assert('ZIP_CONFIGURED_START', configured.status === 'RUNNING' && configured.readiness?.discussion === 'configuration_present',
      JSON.stringify(configured.readiness))
    assert('ZIP_CONFIGURED_STOP', configured.stop?.status === 0 && configured.stop?.result === 'STOPPED', JSON.stringify(configured.stop))
    assert('ZIP_PORT_CONFLICT_REFUSED', evidence.negatives.portConflict?.outcome === 'EXITED' && evidence.negatives.portConflict?.code !== 0,
      JSON.stringify(evidence.negatives.portConflict))
    assert('ZIP_REOPEN', evidence.phases.reopen?.status === 'RUNNING' && evidence.phases.reopen?.stop?.result === 'STOPPED' &&
      evidence.phases.reopen?.resources?.after?.every(item => item.alive === false || item.sameIdentity === false),
      JSON.stringify(evidence.phases.reopen))
    assert('ZIP_STATUS_STOPPED', evidence.negatives.statusStopped?.status === 2 && evidence.negatives.statusStopped?.result === 'STOPPED',
      JSON.stringify(evidence.negatives.statusStopped))
    assert('ZIP_IMPORT', evidence.phases.import?.imported?.status === 200 && typeof evidence.phases.import?.imported?.projectId === 'string' &&
      evidence.phases.import?.stop?.result === 'STOPPED', JSON.stringify(evidence.phases.import?.imported))
    assert('ZIP_SETTINGS_CONTRACT', evidence.settings?.template?.mode0600 === true && evidence.settings?.template?.exclusive === true &&
      evidence.settings?.template?.keys?.length === 6 && evidence.settings?.gui === 'HELD',
      JSON.stringify(evidence.settings))
    assert('ZIP_OPERATION_RELEASED', evidence.operation?.verdict?.allowed === true && evidence.operation.released.length === 1 &&
      evidence.operation.retained.length === 0 && evidence.operation.signals.length === 0,
      JSON.stringify({ verdict: evidence.operation?.verdict, signals: evidence.operation?.signals?.length, retained: evidence.operation?.retained }))
  }))

  return { cases, artifacts: {} }
}
