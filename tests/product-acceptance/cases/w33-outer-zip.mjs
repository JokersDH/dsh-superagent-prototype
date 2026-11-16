import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { extractOuterZip, launcherEnv, OUTER_ZIP_DIR, OUTER_ZIP_NAME, parseJson, privateHome, verifyOuterZip } from '../lib/outer-zip.mjs'
import { freePort, liveIdentity } from '../lib/packaged-instance.mjs'

/**
 * Wave-33 outer distribution ZIP.
 *
 * The candidate is the real shareable ZIP (SHA256SUMS + package-result.json), extracted into a private
 * directory and driven through the package's own Start/Stop/status with the bundled Node. HOME is
 * redirected to a private directory so the user's real Application Support tree is never touched.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w33zip] ${message}\n`) }

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

function indexPath(root, home, manifest) {
  return join(home, 'Library/Application Support/PersonalAgent', `Preview-${manifest.inner.buildId}`, 'config/instance.json')
}

function recordPids(path) {
  if (!existsSync(path)) return []
  const record = JSON.parse(readFileSync(path, 'utf8'))
  return [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger)
    .map(pid => { const identity = liveIdentity(pid)
      return { pid, start: identity.start, uid: identity.uid, parentPid: pid === record.pid ? null : record.pid } })
}

function observe(set) {
  return set.map(item => { const identity = liveIdentity(item.pid)
    return { pid: item.pid, expectedStart: item.start, alive: identity.alive, sameIdentity: identity.alive && identity.start === item.start } })
}

export async function runOuterZip() {
  const cases = []
  const evidence = { zip: { path: join(OUTER_ZIP_DIR, OUTER_ZIP_NAME), sha256: null, bytes: null, source: null, buildId: null, innerTarSha256: null,
    innerTarBytes: null, installManifestSha256: null, runtime: null, entries: null, secretScan: null },
    phases: {}, resources: {}, negatives: {} }
  let mock = null, runnerFn = null, home = null, root = null, failure = null

  try {
    const zipValue = verifyOuterZip(OUTER_ZIP_DIR)
    const digest = zipValue.sha256
    const result = zipValue.result
    evidence.zip.sha256 = digest
    evidence.zip.bytes = zipValue.bytes
    evidence.zip.sumsMatch = zipValue.sumsMatch
    evidence.zip.resultMatch = zipValue.resultMatch
    evidence.zip.source = result?.inner?.source ?? null
    evidence.zip.buildId = result?.inner?.buildId ?? null
    evidence.zip.innerTarSha256 = result?.inner?.tarSha256 ?? null
    evidence.zip.innerTarBytes = result?.inner?.tarBytes ?? null
    evidence.zip.installManifestSha256 = result?.inner?.installManifestSha256 ?? null
    evidence.zip.runtime = result?.runtime ? { version: result.runtime.version, abi: result.runtime.abi, sha256: result.runtime.sha256,
      licenseSha256: result.runtime.licenseSha256, bytes: result.runtime.bytes } : null

    home = privateHome()
    const extracted = extractOuterZip(zipValue, home)
    root = extracted.root
    const manifest = extracted.manifest
    evidence.zip.entries = extracted.entries
    evidence.zip.installManifestDigest = extracted.digests.installManifest
    evidence.zip.runtimeDigest = extracted.digests.runtime
    evidence.zip.licenseDigest = extracted.digests.license
    evidence.zip.manifestProtocol = manifest.protocol
    evidence.zip.innerTarSha256 = evidence.zip.innerTarSha256 ?? manifest.inner?.tarSha256 ?? null
    const secretScan = spawnSync('grep', ['-rIl', '-E', '(sk-[A-Za-z0-9]{20,}|api[_-]?key["\u0027]?\\s*[:=]\\s*["\u0027][A-Za-z0-9]{16,})', join(root, 'install/app/apps')], { encoding: 'utf8', timeout: 60_000 })
    evidence.zip.secretScan = { status: secretScan.status, hits: String(secretScan.stdout ?? '').split('\n').filter(Boolean).length }

    runnerFn = runner(root, home)
    const recordPath = indexPath(root, home, manifest)

    // Phase 1: unconfigured private root, discussion-only start.
    const [p1, a1] = [await freePort(), await freePort()]
    mark('start unconfigured')
    const firstStart = await startAsync(root, home, ['--port', String(p1), '--api-port', String(a1), '--discussion-only'])
    const status1 = await waitStatus(runnerFn)
    const firstExit = await Promise.race([
      new Promise(resolvePromise => firstStart.child.once('exit', code => resolvePromise({ code }))),
      new Promise(resolvePromise => setTimeout(() => resolvePromise({ code: 'RUNNING' }), 1_000)),
    ])
    const setA = recordPids(recordPath)
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
    const afterA = observe(setA)
    const schema = (() => {
      try {
        const db = new DatabaseSync(join(dirname(recordPath), '..', 'data', 'state.sqlite'), { readOnly: true })
        try { return Number(db.prepare("select value from schema_meta where key='product_schema'").get()?.value ?? 0) } finally { db.close() }
      } catch { return null }
    })()
    evidence.phases.unconfigured = { consolePort: p1, apiPort: a1, schema, startOutput: firstStart.output().slice(-500), startExit: firstExit,
      recordPresent: existsSync(recordPath), status: status1?.json?.status ?? null, mode: status1?.json?.instance?.mode ?? null,
      startupMode: status1?.json?.instance?.startupMode ?? null,
      readiness: readinessA ? { status: readinessA.status, discussion: readinessA.body?.discussion ?? null, authorization: readinessA.body?.authorization ?? null } : null,
      contextAvailable: configurationA?.body?.assistantContextAvailable ?? null,
      stop: { status: stop1.status, result: stop1.json?.status ?? null, code: stop1.json?.code ?? null },
      resources: { before: setA, after: afterA } }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 600))

    // Phase 2: explicit private model configuration through PA_MODEL_CONFIG with the loopback mock.
    mock = await candidateModel()
    const [p2, a2] = [await freePort(), await freePort()]
    mark('start configured')
    const configuredStart = await startAsync(root, home, ['--port', String(p2), '--api-port', String(a2), '--discussion-only'],
      { PA_MODEL_CONFIG: mock.file })
    const status2 = await waitStatus(runnerFn)
    const configuredExit = await Promise.race([
      new Promise(resolvePromise => configuredStart.child.once('exit', code => resolvePromise({ code }))),
      new Promise(resolvePromise => setTimeout(() => resolvePromise({ code: 'RUNNING' }), 1_000)),
    ])
    const setB = recordPids(recordPath)
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
    const stop2 = runnerFn(['stop'], { timeoutMs: 40_000 })
    const afterB = observe(setB)
    evidence.phases.configured = { consolePort: p2, apiPort: a2, startExit: configuredExit, status: status2?.json?.status ?? null,
      readiness: readinessB ? { status: readinessB.status, discussion: readinessB.body?.discussion ?? null } : null,
      stop: { status: stop2.status, result: stop2.json?.status ?? null }, resources: { before: setB, after: afterB } }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 600))

    // Phase 3: reopen through the packaged Start again (same private roots).
    const [p3, a3] = [await freePort(), await freePort()]
    const reopen = await startAsync(root, home, ['--port', String(p3), '--api-port', String(a3), '--discussion-only'])
    const status3 = await waitStatus(runnerFn)
    const setC = recordPids(recordPath)
    const stop3 = runnerFn(['stop'], { timeoutMs: 40_000 })
    evidence.phases.reopen = { status: status3?.json?.status ?? null, mode: status3?.json?.instance?.mode ?? null,
      stop: { status: stop3.status, result: stop3.json?.status ?? null }, resources: { before: setC, after: observe(setC) } }
    evidence.negatives.statusStopped = (() => {
      const value = runnerFn(['status'], { timeoutMs: 20_000 })
      return { status: value.status, result: value.json?.status ?? null }
    })()
    evidence.runtimeNode = { version: execFileSync(join(root, 'runtime/bin/node'), ['--version'], { encoding: 'utf8' }).trim(),
      abi: execFileSync(join(root, 'runtime/bin/node'), ['-p', 'process.versions.modules'], { encoding: 'utf8' }).trim() }
    evidence.zip.subject = { source: evidence.zip.source, buildId: evidence.zip.buildId, schema,
      tarSha256: evidence.zip.innerTarSha256, tarBytes: evidence.zip.innerTarBytes,
      platform: evidence.zip.runtime?.platform ?? null, arch: evidence.zip.runtime?.arch ?? null, abi: evidence.zip.runtime?.abi ?? null }
  } catch (error) { failure = String(error?.message ?? error).slice(0, 600) }

  if (home) { try { rmSync(home, { recursive: true, force: true }) } catch { /* retained for inspection */ } }
  await mock?.close?.().catch(() => {})

  cases.push(await runCase({ id: 'E33-OUTER-ZIP',
    title: 'The shareable outer ZIP is verified by its own hashes, extracted privately and driven through the packaged Start/Stop/status',
    layer: LAYERS.INSTALLED, evidence: { outerZip: evidence }, limitations: [
      'HOME is redirected to a private directory; the user’s Application Support tree and existing instances are untouched.',
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
  }))

  return { cases, artifacts: {} }
}
