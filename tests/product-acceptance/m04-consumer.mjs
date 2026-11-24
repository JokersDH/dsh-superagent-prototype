#!/usr/bin/env node
/**
 * Milestone-04 independent consumer — prepared before F0, no model/task sends.
 *
 *   node tests/product-acceptance/m04-consumer.mjs --preflight
 *   node tests/product-acceptance/m04-consumer.mjs --harness <DMG> [--static-only]
 *   node tests/product-acceptance/m04-consumer.mjs --package <DMG> --expect-source <sha40> \
 *        --expect-build <sha16> --expect-dmg-sha256 <sha64> [--static-only]
 *
 * --package refuses to run without the exact frozen identity. --harness is only a dry run of the
 * consumer against a non-F0 candidate and never claims M04 package acceptance.
 * All Store/HTTP observations are read-only; no Store success fact is written by this consumer.
 */
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openBrowser } from './lib/browser.mjs'

const ROOT = resolve('.')
const BASE = process.env.PA_E_M04_ROOT ?? '/Users/hh/Desktop/joker/pa-artifacts/pa-e-m04-consumer'
const VERIFIER = join(ROOT, 'tools/bootstrap/verify-personal-preview.mjs')
const EVIDENCE = join(ROOT, 'tests/product-acceptance/evidence/m04-consumer.json')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const fileSha = file => sha(readFileSync(file))
const sh = (command, args, options = {}) => spawnSync(command, args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024, ...options })
const fail = message => { throw new Error(message) }
const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms))

const COMPATIBILITY = Object.freeze({
  verified: { label: '已验证版本', dispatch: true, nativeTestPassed: true, trial: false },
  compatible_unverified: { label: '未验证版本', dispatch: false, nativeTestPassed: false, trial: true },
  incompatible: { label: '不兼容', dispatch: false, nativeTestPassed: false, trial: false },
  unknown: { label: '未能核实', dispatch: false, nativeTestPassed: false, trial: false },
})

function compatibilityDecision(classification, { explicitTrialAdmission = false } = {}) {
  const base = COMPATIBILITY[classification]
  if (!base) return { classification: 'unknown', ...COMPATIBILITY.unknown, reason: 'unknown_classification' }
  return { classification, ...base,
    dispatch: classification === 'verified' ? true : classification === 'compatible_unverified' ? explicitTrialAdmission : false,
    reason: classification === 'compatible_unverified' && !explicitTrialAdmission ? 'trial_admission_required' : null }
}

const AUTH_STATES = Object.freeze(['verified', 'not_granted', 'unknown', 'rejected'])
function authorizationDecision(request, current, receipts = []) {
  const same = receipts.find(receipt => receipt.requestId === request.requestId)
  if (same) return { state: 'replayed', receipt: same.receipt, effect: 'none', resend: false }
  if (!request.requestId || !request.principal || !request.sourceDigest || !request.targetRoot || !request.generation ||
      !request.projectId || !request.profileId || !request.profileRevision)
    return { state: 'rejected', reason: 'incomplete_binding', effect: 'none' }
  for (const key of ['principal', 'sourceDigest', 'targetRoot', 'generation', 'projectId', 'profileId', 'profileRevision']) {
    if (current[key] !== request[key]) return { state: 'rejected', reason: `changed_${key}`, effect: 'none' }
  }
  if (!current.sourceConfirmed) return { state: 'rejected', reason: 'source_not_confirmed', effect: 'none' }
  if (!current.inventoryComplete) return { state: 'rejected', reason: 'inventory_unknown', effect: 'none' }
  if (current.writerState !== 'quiescent') return { state: 'rejected', reason: 'writer_not_quiescent', effect: 'none' }
  if (current.targetNonEmpty) return { state: 'rejected', reason: 'non_empty_target', effect: 'none' }
  if (current.restoreMarker !== 'preserved') return { state: 'rejected', reason: 'restore_marker_changed', effect: 'none' }
  if (request.contractDigest !== current.contractDigest) return { state: 'rejected', reason: 'contract_changed', effect: 'none' }
  if (request.resourceRef !== current.resourceRef) return { state: 'rejected', reason: 'resource_changed', effect: 'none' }
  if (request.unknownResponse) return { state: 'unknown', action: 'lookup_same_id', resend: false, effect: 'held' }
  return { state: 'verified', effect: 'new_authorization', resend: false }
}

function pureSelfTests() {
  const checks = {}
  const check = (name, value, detail = null) => { checks[name] = { ok: !!value, ...(detail ? { detail } : {}) } }
  check('verified_allowed', compatibilityDecision('verified').dispatch === true &&
    compatibilityDecision('verified').nativeTestPassed === true)
  check('unverified_not_native_passed', compatibilityDecision('compatible_unverified').nativeTestPassed === false &&
    compatibilityDecision('compatible_unverified').dispatch === false)
  check('unverified_trial_explicit', compatibilityDecision('compatible_unverified', { explicitTrialAdmission: true }).dispatch === true &&
    compatibilityDecision('compatible_unverified', { explicitTrialAdmission: true }).nativeTestPassed === false)
  check('incompatible_disabled', compatibilityDecision('incompatible').dispatch === false &&
    compatibilityDecision('incompatible').nativeTestPassed === false)
  check('unknown_disabled', compatibilityDecision('unknown').dispatch === false &&
    compatibilityDecision('unknown').nativeTestPassed === false && compatibilityDecision('other').classification === 'unknown')
  const baseAuth = { requestId: 'req-1', principal: 'p1', sourceDigest: 's1', targetRoot: '/tmp/target', generation: 2,
    projectId: 'project-1', profileId: 'profile-1', profileRevision: 1, contractDigest: 'c1', resourceRef: 'r1' }
  const currentAuth = { ...baseAuth, sourceConfirmed: true, inventoryComplete: true, writerState: 'quiescent',
    targetNonEmpty: false, restoreMarker: 'preserved' }
  check('authorization_ok', authorizationDecision(baseAuth, currentAuth).state === 'verified')
  check('authorization_replay_no_effect', authorizationDecision(baseAuth, currentAuth,
    [{ requestId: 'req-1', receipt: { id: 'receipt-1' } }]).state === 'replayed' &&
    authorizationDecision(baseAuth, currentAuth, [{ requestId: 'req-1', receipt: {} }]).resend === false)
  check('authorization_unknown_lookup_only', authorizationDecision({ ...baseAuth, unknownResponse: true }, currentAuth).state === 'unknown' &&
    authorizationDecision({ ...baseAuth, unknownResponse: true }, currentAuth).action === 'lookup_same_id' &&
    authorizationDecision({ ...baseAuth, unknownResponse: true }, currentAuth).resend === false)
  check('authorization_rejects_changes', authorizationDecision({ ...baseAuth, generation: 3 }, currentAuth).state === 'rejected' &&
    authorizationDecision({ ...baseAuth, profileId: 'profile-2' }, currentAuth).state === 'rejected' &&
    authorizationDecision({ ...baseAuth, contractDigest: 'c2' }, currentAuth).state === 'rejected' &&
    authorizationDecision({ ...baseAuth, resourceRef: 'r2' }, currentAuth).state === 'rejected')
  check('authorization_rejects_non_empty_and_marker', authorizationDecision(baseAuth, { ...currentAuth, targetNonEmpty: true }).state === 'rejected' &&
    authorizationDecision(baseAuth, { ...currentAuth, restoreMarker: 'deleted' }).state === 'rejected')
  check('authorization_rejects_unknown_inventory', authorizationDecision(baseAuth, { ...currentAuth, inventoryComplete: false }).state === 'rejected')
  return { ok: Object.values(checks).every(item => item.ok), checks }
}

function toolPreflight() {
  const checks = {}
  const check = (name, ok, detail) => { checks[name] = { ok: !!ok, detail } }
  check('platform', process.platform === 'darwin' && process.arch === 'arm64', { platform: process.platform, arch: process.arch })
  check('macos_version', Number(spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim().split('.')[0]) >= 14,
    spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout.trim())
  check('tools', ['/usr/bin/hdiutil', '/usr/bin/codesign', '/usr/bin/plutil'].every(existsSync))
  const verifier = spawnSync(process.execPath, [VERIFIER, '--self-test'], { cwd: ROOT, encoding: 'utf8', timeout: 60_000 })
  let report = null; try { report = JSON.parse(verifier.stdout) } catch { /* refusal is captured below */ }
  check('static_verifier_self_test', verifier.status === 0 && report?.status === 'PASS', report ?? verifier.stdout.slice(-400))
  check('no_frozen_manifest', !existsSync(join(BASE, 'M04-F0.json')), join(BASE, 'M04-F0.json'))
  return { ok: Object.values(checks).every(item => item.ok), checks }
}

function verifyStatic(dmg, { expectSource, expectBuild, expectDmgSha256, cohort }) {
  const facts = { dmg: resolve(dmg), cohort, failures: [], checks: {} }
  const check = (name, ok, detail) => { facts.checks[name] = { ok: !!ok, detail }; if (!ok) facts.failures.push(name) }
  if (!existsSync(facts.dmg)) fail(`DMG missing: ${facts.dmg}`)
  facts.bytes = statSync(facts.dmg).size
  facts.sha256 = fileSha(facts.dmg)
  check('dmg_sha256', !expectDmgSha256 || facts.sha256 === expectDmgSha256, { observed: facts.sha256, expected: expectDmgSha256 ?? null })
  const verify = sh('/usr/bin/hdiutil', ['verify', facts.dmg], { timeout: 180_000 })
  check('hdiutil_verify', verify.status === 0, verify.stderr.slice(-400) || verify.stdout.slice(-400))
  const runBase = join(BASE, `run-${Date.now()}-${cohort}`)
  const mount = join(runBase, 'mounted image')
  const home = join(runBase, 'fresh home with spaces')
  const firstApp = join(runBase, '安装 路径', 'Personal Agent.app')
  const secondApp = join(runBase, '安装 路径', 'Personal Agent 2.app')
  mkdirSync(mount, { recursive: true, mode: 0o700 })
  mkdirSync(home, { recursive: true, mode: 0o700 })
  facts.runRoot = runBase
  facts.mount = mount
  let attached = false
  try {
    const attach = sh('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, facts.dmg], { timeout: 180_000 })
    attached = attach.status === 0
    if (!attached) { check('dmg_attach', false, attach.stderr.slice(-400)); return facts }
    check('dmg_attach', true)
    const rootEntries = readdirSync(mount).sort()
    check('dmg_root_entries', rootEntries.includes('Personal Agent.app') && rootEntries.includes('Applications') &&
      rootEntries.some(name => name.includes('安装说明')), rootEntries)
    const mountedApp = join(mount, 'Personal Agent.app')
    check('app_bundle', existsSync(join(mountedApp, 'Contents/MacOS/PersonalAgent')) &&
      existsSync(join(mountedApp, 'Contents/Resources/engine/preview-manifest.json')))
    const engine = join(mountedApp, 'Contents/Resources/engine')
    const plistFile = join(mountedApp, 'Contents/Info.plist')
    const plist = JSON.parse(sh('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistFile], { encoding: 'utf8' }).stdout)
    check('app_source_build_plist', (!expectSource || plist.PAProductSource === expectSource) &&
      (!expectBuild || plist.PAProductBuild === expectBuild), { source: plist.PAProductSource, build: plist.PAProductBuild })
    const verifier = spawnSync(process.execPath, [VERIFIER, '--dir', engine,
      ...(expectSource ? ['--expect-source', expectSource] : []), ...(expectBuild ? ['--expect-build-id', expectBuild] : [])],
      { cwd: ROOT, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024 })
    let preview = null; try { preview = JSON.parse(verifier.stdout) } catch { /* captured */ }
    check('embedded_engine_static', verifier.status === 0 && preview?.status === 'VERIFIED_STATIC',
      preview?.status ?? verifier.stdout.slice(-500))
    facts.preview = preview
    const node = join(engine, 'runtime/bin/node')
    const nodeVersion = sh(node, ['--version']).stdout.trim()
    const nodeAbi = sh(node, ['-p', 'process.versions.modules']).stdout.trim()
    const nodeSha = fileSha(node)
    check('embedded_node_identity', nodeVersion === 'v24.21.0' && nodeAbi === '137' &&
      (!preview?.runtime?.sha256 || nodeSha === preview.runtime.sha256), { nodeVersion, nodeAbi, nodeSha })
    const manifest = JSON.parse(readFileSync(join(engine, 'preview-manifest.json'), 'utf8'))
    facts.embedded = { source: manifest.inner.source, buildId: manifest.inner.buildId, nodeSha256: nodeSha, version: manifest.inner.version ?? null }
    check('embedded_source_build', (!expectSource || manifest.inner.source === expectSource) &&
      (!expectBuild || manifest.inner.buildId === expectBuild), facts.embedded)
    const signature = sh('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', mountedApp])
    check('app_signature', signature.status === 0, signature.stderr.slice(-400))
    const artifactPath = join(resolve(dmg), '..', 'artifact.json')
    if (existsSync(artifactPath)) {
      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'))
      facts.artifact = artifact
      check('artifact_identity', artifact.sha256 === facts.sha256 && (!expectSource || artifact.source === expectSource) &&
        (!expectBuild || artifact.buildId === expectBuild) && artifact.embeddedNodeSha256 === nodeSha,
        { sha: artifact.sha256, source: artifact.source, build: artifact.buildId, node: artifact.embeddedNodeSha256 })
    } else facts.artifact = null
    cpSync(mountedApp, firstApp, { recursive: true, verbatimSymlinks: true })
    cpSync(mountedApp, secondApp, { recursive: true, verbatimSymlinks: true })
    check('copied_apps', existsSync(join(firstApp, 'Contents/MacOS/PersonalAgent')) &&
      existsSync(join(secondApp, 'Contents/MacOS/PersonalAgent')))
    check('copied_signature', sh('/usr/bin/codesign', ['--verify', '--strict', firstApp]).status === 0)
    facts.home = home; facts.app = firstApp; facts.duplicateApp = secondApp
    return facts
  } finally {
    if (attached) sh('/usr/bin/hdiutil', ['detach', mount, '-force'], { timeout: 60_000 })
  }
}

const STATUS_LOCK = {}
function launcher(env, args) {
  const engine = join(env.app, 'Contents/Resources/engine')
  const result = sh(join(engine, 'runtime/bin/node'), [join(engine, 'personal-preview-launcher.mjs'), ...args], {
    cwd: engine, env: { ...env.processEnv }, timeout: 60_000 })
  let json = null; try { json = JSON.parse(result.stdout.trim()) } catch { /* status can be empty before first start */ }
  return { status: result.status, json, stdout: result.stdout.slice(-600), stderr: result.stderr.slice(-600) }
}

async function launchChecks(facts, envBase) {
  const checks = {}
  const check = (name, ok, detail) => { checks[name] = { ok: !!ok, detail } }
  const env = { HOME: envBase, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8',
    AppleLocale: 'zh_CN', PA_DESKTOP_APP: '1' }
  const appExe = join(facts.app, 'Contents/MacOS/PersonalAgent')
  const app = spawn(appExe, [], { cwd: facts.app, env, stdio: 'ignore' })
  facts.processes = [{ role: 'first-app', pid: app.pid }]
  let status = null
  try {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await sleep(500)
      const current = launcher({ app: facts.app, processEnv: env }, ['status'])
      if (current.json?.status === 'RUNNING') { status = current; break }
    }
    check('packaged_start_running', status?.json?.status === 'RUNNING', status?.stdout ?? status?.stderr)
    facts.status = status?.json ?? null
    if (!status) return { checks, env, app }
    const instance = status.json.instance
    check('fresh_home_state', instance.state.startsWith(`${envBase}/`), instance.state)
    check('no_checkout_or_global_node', instance.apiArgv?.every(value => !String(value).includes('/superagent') &&
      !String(value).includes('/superagent-agent-') && (!String(value).includes('node') || String(value).startsWith(join(facts.app, 'Contents/Resources/engine')))) &&
      instance.apiArgv?.[0]?.startsWith(join(facts.app, 'Contents/Resources/engine')), instance.apiArgv)
    const apiKey = readFileSync(join(instance.state, 'api.key'), 'utf8').trim()
    const response = await fetch(`${instance.apiURL}/v1/readiness`, { headers: { authorization: `Bearer ${apiKey}`, 'accept-language': 'zh-CN' } })
    const readiness = await response.json()
    facts.readiness = { status: response.status, body: readiness }
    check('readiness_observed', response.status === 200 && readiness?.execution !== undefined, readiness)
    check('no_fixture_fallback', !JSON.stringify(readiness).toLowerCase().includes('fixture') &&
      (readiness.execution?.state !== 'available' || readiness.execution?.kind !== 'fixture'), readiness)
    const configResponse = await fetch(`${instance.apiURL}/v1/configuration`, { headers: { authorization: `Bearer ${apiKey}` } })
    const configuration = await configResponse.json()
    facts.configuration = configuration
    const compatibility = inspectCompatibility(configuration)
    check('compatibility_surface', compatibility.state === 'present', compatibility)
    check('unknown_not_native_test_passed', compatibility.state !== 'present' ||
      compatibility.profiles.every(item => item.classification === 'verified' || item.nativeTestPassed === false), compatibility.profiles)
    check('ui_admission_consistency', compatibility.state !== 'present' ||
      compatibility.profiles.every(item => item.dispatchAllowed === (item.classification === 'verified' ||
        (item.classification === 'compatible_unverified' && item.explicitTrialAdmission === true))), compatibility.profiles)
    const browser = await openBrowser({ root: ROOT })
    try {
      await browser.page.goto(instance.consoleURL, { waitUntil: 'domcontentloaded' })
      await browser.page.getByRole('button', { name: '主对话视图', exact: true }).waitFor({ timeout: 45_000 })
      const body = await browser.page.locator('body').innerText()
      facts.ui = { url: instance.consoleURL, chinese: /工作台|主对话|待决定/u.test(body), text: body.slice(0, 600) }
      check('chinese_ui', facts.ui.chinese, facts.ui.text)
    } finally { await browser.close().catch(() => {}) }
    // Duplicate app path must not create a second writer/instance identity.
    const duplicate = spawn(join(facts.duplicateApp, 'Contents/MacOS/PersonalAgent'), [], { cwd: facts.duplicateApp, env, stdio: 'ignore' })
    facts.processes.push({ role: 'duplicate-app', pid: duplicate.pid })
    await sleep(2_000)
    const afterDuplicate = launcher({ app: facts.app, processEnv: env }, ['status'])
    check('duplicate_path_reuses_instance', afterDuplicate.json?.instance?.pid === instance.pid &&
      afterDuplicate.json?.instance?.processStart === instance.processStart, { before: instance.pid, after: afterDuplicate.json?.instance?.pid })
    try { duplicate.kill('SIGTERM') } catch { /* already exited */ }
    // Normal packaged stop, then reopen through the packaged app.
    const stop = launcher({ app: facts.app, processEnv: env }, ['stop'])
    check('packaged_stop', stop.json?.status === 'STOPPED' && stop.json?.stillAlive === false, stop.json ?? stop.stderr)
    facts.stop = stop.json ?? null
    const reopen = spawn(appExe, [], { cwd: facts.app, env, stdio: 'ignore' })
    facts.processes.push({ role: 'reopen-app', pid: reopen.pid })
    let reopened = null
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await sleep(500)
      const current = launcher({ app: facts.app, processEnv: env }, ['status'])
      if (current.json?.status === 'RUNNING') { reopened = current; break }
    }
    check('packaged_reopen', reopened?.json?.status === 'RUNNING' && reopened.json.instance.state.startsWith(`${envBase}/`),
      reopened?.json ?? null)
    const stop2 = launcher({ app: facts.app, processEnv: env }, ['stop'])
    check('packaged_stop_after_reopen', stop2.json?.status === 'STOPPED', stop2.json ?? stop2.stderr)
    try { reopen.kill('SIGTERM') } catch { /* already exited */ }
    // Negative admission probe: an unknown CLI version must stay disabled and never become native_test_passed.
    const fakeBin = join(envBase, 'bin'); mkdirSync(fakeBin, { recursive: true, mode: 0o700 })
    writeFileSync(join(fakeBin, 'codex'), '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "codex-cli 0.0.0-unknown"; exit 0; fi\nexit 0\n', { mode: 0o700 })
    const fakeEnv = { ...env, PATH: `${fakeBin}:/usr/bin:/bin:/usr/sbin:/sbin` }
    const unknownApp = spawn(appExe, [], { cwd: facts.app, env: fakeEnv, stdio: 'ignore' })
    facts.processes.push({ role: 'unknown-executor-app', pid: unknownApp.pid })
    let unknownStatus = null
    for (let attempt = 0; attempt < 240; attempt += 1) {
      await sleep(500)
      const current = launcher({ app: facts.app, processEnv: fakeEnv }, ['status'])
      if (current.json?.status === 'RUNNING') { unknownStatus = current; break }
    }
    check('unknown_executor_start_running', unknownStatus?.json?.status === 'RUNNING', unknownStatus?.stdout ?? null)
    if (unknownStatus) {
      const key = readFileSync(join(unknownStatus.json.instance.state, 'api.key'), 'utf8').trim()
      const readinessResponse = await fetch(`${unknownStatus.json.instance.apiURL}/v1/readiness`, { headers: { authorization: `Bearer ${key}` } })
      const unknownReadiness = await readinessResponse.json()
      const configResponse = await fetch(`${unknownStatus.json.instance.apiURL}/v1/configuration`, { headers: { authorization: `Bearer ${key}` } })
      const unknownConfiguration = await configResponse.json()
      facts.unknownExecutor = { readiness: unknownReadiness, configuration: unknownConfiguration }
      check('unknown_executor_disables_development', readinessResponse.status === 200 &&
        unknownReadiness.execution?.state !== 'available' && unknownReadiness.development !== 'configuration_present',
        unknownReadiness)
      check('unknown_executor_not_native_passed', !JSON.stringify(unknownConfiguration).includes('native_test_passed'),
        unknownConfiguration)
      check('unknown_executor_no_fixture', !JSON.stringify({ unknownReadiness, unknownConfiguration }).toLowerCase().includes('fixture'),
        { execution: unknownReadiness.execution, profiles: unknownConfiguration.profiles })
    }
    const unknownStop = launcher({ app: facts.app, processEnv: fakeEnv }, ['stop'])
    check('unknown_executor_stop', unknownStop.json?.status === 'STOPPED', unknownStop.json ?? unknownStop.stderr)
    try { unknownApp.kill('SIGTERM') } catch { /* already exited */ }
    // Official stop path used by the packaged launcher; GUI button remains a later app-level assertion.
    facts.launchMethod = 'app executable start; packaged launcher status/stop; duplicate app path; unknown executor negative probe'
    return { checks, env, app }
  } finally {
    try { app.kill('SIGTERM') } catch { /* exited */ }
    await sleep(500)
    facts.processes = (facts.processes ?? []).map(item => ({ ...item, identity: exactProcess(item.pid) }))
  }
}

function exactProcess(pid) {
  if (!pid) return null
  const result = sh('ps', ['-p', String(pid), '-o', 'pid=,ppid=,uid=,lstart=,command='])
  return result.status === 0 ? result.stdout.trim() : null
}

function inspectCompatibility(configuration) {
  const profiles = Array.isArray(configuration?.profiles) ? configuration.profiles : []
  const candidates = profiles.filter(profile => profile && typeof profile === 'object')
  if (!candidates.length) return { state: 'absent', reason: 'no_profiles' }
  const classify = item => {
    const raw = item.compatibility ?? item.compatibilityClass ?? item.admission ?? item.versionClass ??
      item.classification ?? item.versionEvidence?.classification ?? null
    const value = typeof raw === 'string' ? raw : raw?.classification ?? raw?.state ?? null
    return value
  }
  const mapped = candidates.map(item => {
    const raw = classify(item)
    const classification = ['verified', 'compatible_unverified', 'incompatible', 'unknown'].includes(raw) ? raw : 'unknown'
    return { id: item.id ?? item.profileId ?? null, classification, raw,
      nativeTestPassed: item.nativeTestPassed ?? item.versionEvidence?.nativeTestPassed ?? null,
      dispatchAllowed: item.dispatchAllowed ?? item.dispatch ?? null,
      explicitTrialAdmission: item.explicitTrialAdmission ?? item.trialAdmission ?? false,
      label: item.label ?? item.classificationLabel ?? null }
  })
  const present = mapped.some(item => item.raw !== null)
  return { state: present ? 'present' : 'absent', reason: present ? null : 'compatibility_metadata_missing', profiles: mapped }
}

function inspectRecovery(configuration, readiness, status) {
  const availability = configuration?.recovery ?? configuration?.recoveryAvailability ?? null
  const auth = availability?.authorization ?? configuration?.recoveryAuthorization ?? null
  const implemented = !(availability?.blockers ?? []).some(item => item?.code === 'authorization_not_implemented')
  return { availability, authorization: auth, implemented,
    state: implemented && availability ? 'present' : 'absent',
    reason: !implemented ? 'authorization_not_implemented' : availability ? null : 'recovery_surface_missing' }
}

async function runPackage(dmg, options, cohort) {
  const staticFacts = verifyStatic(dmg, { ...options, cohort })
  const evidence = { at: new Date().toISOString(), kind: cohort === 'M04-F0' ? 'm04-f0-package-consumer' : 'm04-harness-dry-run',
    cohort, static: staticFacts, launch: null, compatibility: null, recovery: null, items: {}, status: 'REFUSED' }
  if (staticFacts.failures.length) {
    evidence.status = 'REFUSED_STATIC'
    return evidence
  }
  if (options.staticOnly) { evidence.status = 'STATIC_ONLY'; return evidence }
  const launched = await launchChecks(staticFacts, staticFacts.home)
  evidence.launch = { checks: launched.checks, status: staticFacts.status, readiness: staticFacts.readiness,
    configuration: staticFacts.configuration, ui: staticFacts.ui, stop: staticFacts.stop,
    processes: staticFacts.processes, launchMethod: staticFacts.launchMethod }
  const healthNames = ['packaged_start_running', 'fresh_home_state', 'no_checkout_or_global_node', 'readiness_observed',
    'no_fixture_fallback', 'chinese_ui', 'duplicate_path_reuses_instance', 'packaged_stop', 'packaged_reopen', 'packaged_stop_after_reopen', 'unknown_executor_start_running', 'unknown_executor_disables_development',
    'unknown_executor_not_native_passed', 'unknown_executor_no_fixture', 'unknown_executor_stop']
  const launchOk = healthNames.every(name => launched.checks[name]?.ok === true)
  const compatibility = inspectCompatibility(staticFacts.configuration)
  const recovery = inspectRecovery(staticFacts.configuration, staticFacts.readiness, staticFacts.status)
  evidence.compatibility = compatibility
  evidence.recovery = recovery
  evidence.items = {
    L1_1_compatibility_ui: compatibility.state === 'present' ? 'PASS' : 'BLOCKED',
    L1_2_package_identity: 'PASS',
    L1_5_start_stop_locale_paths: launchOk ? 'PASS' : 'FAIL',
    L1_4_recovery_new_authorization: recovery.state === 'present' ? 'BLOCKED' : 'BLOCKED',
    colleague_machine: 'NOT_TESTED',
  }
  evidence.status = cohort === 'M04-F0'
    ? (launchOk && compatibility.state === 'present' && recovery.state === 'present' ? 'READY_FOR_PACKAGE_ACCEPTANCE' : 'PACKAGE_BLOCKED')
    : (launchOk ? 'HARNESS_READY' : 'HARNESS_FAILED')
  return evidence
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--preflight')) {
    const tools = toolPreflight(), pure = pureSelfTests()
    const evidence = { at: new Date().toISOString(), kind: 'm04-consumer-preflight', package: { status: 'BLOCKED_NO_F0' },
      tools, pure, l1: '0/6', l2: '0/7', notes: ['No frozen M04 DMG identity supplied; package and colleague items remain BLOCKED/NOT_TESTED.',
        'Compatibility/auth pure checks are harness logic, not product evidence.'] }
    writeEvidence('m04-consumer-preflight.json', evidence)
    console.log(JSON.stringify({ ok: tools.ok && pure.ok, tools: tools.checks, pure: pure.checks, l1: '0/6', l2: '0/7',
      evidence: join(EVIDENCE, '..', 'm04-consumer-preflight.json') }, null, 1))
    if (!(tools.ok && pure.ok)) process.exitCode = 1
    return
  }
  const value = prefix => argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
  if (argv.includes('--harness') || argv.includes('--package')) {
    const packageMode = argv.includes('--package')
    let dmg = packageMode ? value('--package=') : value('--harness=')
    if (!dmg) { const index = argv.indexOf(packageMode ? '--package' : '--harness'); dmg = argv[index + 1] }
    if (!dmg) fail('DMG path is required')
    const expected = { expectSource: value('--expect-source='), expectBuild: value('--expect-build='),
      expectDmgSha256: value('--expect-dmg-sha256='), staticOnly: argv.includes('--static-only') }
    if (packageMode && (!expected.expectSource || !expected.expectBuild || !expected.expectDmgSha256))
      fail('--package requires exact --expect-source, --expect-build and --expect-dmg-sha256; refusing to follow a moving candidate')
    if (!packageMode && (!expected.expectSource || !expected.expectBuild || !expected.expectDmgSha256)) {
      const artifact = join(resolve(dmg), '..', 'artifact.json')
      if (existsSync(artifact)) {
        const value = JSON.parse(readFileSync(artifact, 'utf8'))
        expected.expectSource = expected.expectSource ?? value.source
        expected.expectBuild = expected.expectBuild ?? value.buildId
        expected.expectDmgSha256 = expected.expectDmgSha256 ?? value.sha256
      }
    }
    const evidence = await runPackage(dmg, expected, packageMode ? 'M04-F0' : 'HARNESS_ONLY')
    writeEvidence('m04-consumer.json', evidence)
    console.log(JSON.stringify({ evidence: EVIDENCE, cohort: evidence.cohort, status: evidence.status,
      staticFailures: evidence.static?.failures, launch: evidence.launch ? Object.fromEntries(Object.entries(evidence.launch.checks)
        .map(([name, item]) => [name, item.ok])) : null, compatibility: evidence.compatibility, recovery: evidence.recovery,
      items: evidence.items }, null, 1))
    if (evidence.status === 'REFUSED_STATIC' || evidence.status === 'REFUSED' || evidence.status === 'HARNESS_FAILED' ||
      evidence.status === 'PACKAGE_BLOCKED') process.exitCode = 1
    return
  }
  console.log('usage: --preflight | --harness <DMG> [--static-only] | --package <DMG> --expect-source ... --expect-build ... --expect-dmg-sha256 ...')
  process.exitCode = 2
}

function writeEvidence(name, evidence) {
  mkdirSync(join(EVIDENCE, '..'), { recursive: true, mode: 0o700 })
  writeFileSync(join(EVIDENCE, '..', name), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
  mkdirSync(BASE, { recursive: true, mode: 0o700 })
  writeFileSync(join(BASE, name), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
}

try { await main() } catch (error) {
  console.error(`m04-consumer failed: ${String(error?.message ?? error).slice(0, 1200)}`)
  process.exitCode = 1
}
