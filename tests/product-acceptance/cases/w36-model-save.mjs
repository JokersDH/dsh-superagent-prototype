import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { openBrowser } from '../lib/browser.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { captureSet, createOperation, resourceBirth, rollout } from '../lib/caller-safety.mjs'
import { extractOuterZip, launcherEnv, parseJson, privateHome, verifyOuterZip, W35_ZIP_DIR, W35_ZIP_NAME } from '../lib/outer-zip.mjs'
import { freePort, liveIdentity, sha256 } from '../lib/packaged-instance.mjs'

/**
 * Wave-36 closure 4: the current W35 cohort's real web model-configuration consumer.
 *
 * The packaged console form (偏好设置 → 模型设置 → 保存配置) writes the instance's selected private
 * model file only; saving must not call the model, must clear the key from the input, and must never
 * echo it. The same W35 subject is then restarted to prove the saved configuration is picked up.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w36model] ${message}\n`) }

const runner = (root, home) => (args, { timeoutMs = 40_000 } = {}) => {
  const result = spawnSync(join(root, 'runtime/bin/node'), [join(root, 'personal-preview-launcher.mjs'), ...args], {
    cwd: root, env: launcherEnv(home), encoding: 'utf8', timeout: timeoutMs,
  })
  return { status: result.status, json: parseJson(result.stdout), stdout: String(result.stdout).slice(-600), stderr: String(result.stderr).slice(-600) }
}
async function waitStatus(run, attempts = 120) {
  let last = null
  for (let index = 0; index < attempts; index += 1) {
    last = run(['status'], { timeoutMs: 20_000 })
    if (last.json?.status === 'RUNNING') return last
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  return last
}
const recordPids = path => {
  if (!existsSync(path)) return []
  const record = JSON.parse(readFileSync(path, 'utf8'))
  return [...new Set([record.pid, record.apiPid, record.consolePid])].filter(Number.isSafeInteger)
}
const fileSha = path => createHash('sha256').update(readFileSync(path)).digest('hex')

export async function runW35ModelSave() {
  const cases = []
  const evidence = { subject: null, zip: null, form: null, save: null, negatives: {}, restart: null, resources: {}, operation: null }
  const home = privateHome('pa-e-w36-model-')
  const operation = createOperation({ id: 'w36-model-save' })
  operation.addMaterial(home, 'private-home-install-runtime')
  const modelDir = join(home, 'model')
  const modelPath = join(modelDir, 'private.json')
  let root = null, run = null, mock = null, child = null, failure = null
  try {
    const zip = verifyOuterZip(W35_ZIP_DIR, W35_ZIP_NAME)
    const extracted = extractOuterZip(zip, home)
    root = extracted.root
    run = runner(root, home)
    const result = zip.result
    evidence.zip = { sha256: zip.sha256, bytes: zip.bytes, sumsMatch: zip.sumsMatch, resultMatch: zip.resultMatch,
      buildId: result?.inner?.buildId ?? null, source: result?.inner?.source ?? null,
      innerTarSha256: result?.inner?.tarSha256 ?? null, innerTarBytes: result?.inner?.tarBytes ?? null,
      installManifestSha256: result?.inner?.installManifestSha256 ?? null,
      installManifestDigest: extracted.digests.installManifest, runtimeDigest: extracted.digests.runtime,
      licenseDigest: extracted.digests.license, manifestProtocol: extracted.manifest.protocol,
      runtime: { version: extracted.manifest.runtime?.version ?? null, abi: extracted.manifest.runtime?.abi ?? null,
        platform: extracted.manifest.runtime?.platform ?? null, arch: extracted.manifest.runtime?.arch ?? null,
        sha256: extracted.manifest.runtime?.sha256 ?? null, licenseSha256: extracted.manifest.runtime?.licenseSha256 ?? null } }
    mkdirSync(modelDir, { recursive: true, mode: 0o700 })
    if (existsSync(modelPath)) throw new Error('private model file unexpectedly exists before the GUI save')
    mock = await candidateModel()
    const [p, a] = [await freePort(), await freePort()]
    mark('start W35 with an absent private model file')
    child = spawn(join(root, 'Start.command'), ['--port', String(p), '--api-port', String(a), '--discussion-only'],
      { cwd: root, env: launcherEnv(home, { PA_MODEL_CONFIG: modelPath }), stdio: ['ignore', 'pipe', 'pipe'] })
    operation.track({ ...resourceBirthFromSpawn(child.pid, root, modelDir), op: 'model-save:launcher' })
    const status = await waitStatus(run)
    if (status?.json?.status !== 'RUNNING') throw new Error(`start ${status?.json?.status ?? 'none'}: ${status?.stderr ?? ''}`)
    const recordPath = join(home, 'Library/Application Support/PersonalAgent', `Preview-${result.inner.buildId}`, 'config/instance.json')
    const recordDir = join(home, 'Library/Application Support/PersonalAgent', `Preview-${result.inner.buildId}`)
    const set = captureSet(recordPids(recordPath), { root, config: join(recordDir, 'config'), state: join(recordDir, 'data'), op: 'model-save:instance' })
    for (const pid of recordPids(recordPath)) operation.track(resourceBirth(pid, { root, config: join(recordDir, 'config'), state: join(recordDir, 'data'), op: 'model-save:instance' }))
    evidence.resources.instance = { before: set, after: null }
    const browser = await openBrowser({ root: process.cwd(), viewport: { width: 1280, height: 900 } })
    try {
      const page = browser.page
      await page.goto(status.json.instance.consoleURL, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
      await page.getByRole('button', { name: '偏好设置', exact: true }).click()
      const form = page.locator('.trial-model-connection')
      await form.waitFor()
      const endpoint = form.getByLabel('模型端点')
      const modelName = form.getByLabel('模型名称')
      const key = form.getByLabel('API Key')
      evidence.form = { endpoint: await endpoint.getAttribute('type'), model: await modelName.getAttribute('type'),
        key: await key.getAttribute('type'), saveText: (await form.textContent()).slice(0, 200) }
      await endpoint.fill(mock.file ? JSON.parse(readFileSync(mock.file, 'utf8')).baseURL : '')
      await modelName.fill('candidate-mock')
      await key.fill(mock.key)
      // An HTTP endpoint may expose an explicit insecure-transport consent control.
      let consent = null
      const consentBox = form.getByRole('checkbox')
      if (await consentBox.count() > 0) { consent = await consentBox.first().isChecked(); if (!consent) await consentBox.first().check() }
      evidence.negatives.invalidEndpoint = await (async () => {
        await endpoint.fill('ftp://example.invalid')
        await form.getByRole('button', { name: '保存配置', exact: true }).click()
        await page.waitForTimeout(300)
        const text = await form.textContent()
        const unchanged = !existsSync(modelPath)
        await endpoint.fill(JSON.parse(readFileSync(mock.file, 'utf8')).baseURL)
        return { rejected: /http|端点|地址/u.test(text) && unchanged, fileAbsent: unchanged, text: text.slice(-200) }
      })()
      await form.getByRole('button', { name: '保存配置', exact: true }).click()
      const savedText = page.getByText('已保存到本机；尚未发送验证请求。', { exact: false })
      const errorAlert = form.getByRole('alert')
      const outcome = await Promise.race([
        savedText.waitFor({ timeout: 45_000 }).then(() => 'saved').catch(() => null),
        errorAlert.waitFor({ timeout: 45_000 }).then(() => 'error').catch(() => null),
      ])
      evidence.negatives.saveOutcome = { outcome, formText: (await form.textContent()).slice(-400),
        alertText: (await errorAlert.count()) > 0 ? (await errorAlert.first().textContent()).slice(-200) : null,
        filePresent: existsSync(modelPath) }
      if (outcome !== 'saved') throw new Error(`model save outcome ${outcome}: ${JSON.stringify(evidence.negatives.saveOutcome).slice(0, 400)}`)
      const saved = JSON.parse(readFileSync(modelPath, 'utf8'))
      const mode = statSync(modelPath).mode & 0o777
      const passwordValue = await key.inputValue()
      const bodyText = await page.locator('body').innerText()
      evidence.save = { mode, keys: Object.keys(saved).sort(), baseURL: saved.baseURL, model: saved.model,
        keyMatches: saved.apiKey === mock.key, allowInsecureHttp: saved.allowInsecureHttp === true, consent,
        providerRequests: mock.requests.length, keyEchoed: bodyText.includes(mock.key), passwordCleared: passwordValue === '',
        sha256: fileSha(modelPath), bytes: statSync(modelPath).size }
      // Reopen the settings panel: the key is never returned to the page.
      const close = page.getByRole('button', { name: '关闭模型设置', exact: true })
      if (await close.count() > 0) await close.click()
      await page.getByRole('button', { name: '偏好设置', exact: true }).click()
      const reopened = page.locator('.trial-model-connection')
      await reopened.waitFor()
      evidence.negatives.reopen = { keyValue: await reopened.getByLabel('API Key').inputValue(),
        bodyLeaksKey: (await page.locator('body').innerText()).includes(mock.key) }
      await page.screenshot({ path: join(home, 'model-settings.png') }).catch(() => {})
    } finally { await browser.close().catch(() => {}) }
    const stop = run(['stop'], { timeoutMs: 40_000 })
    evidence.resources.instance.stop = { status: stop.status, result: stop.json?.status ?? null, after: rollout(set) }
    if (stop.json?.status !== 'STOPPED') throw new Error(`stop after save ${stop.json?.status ?? stop.status}`)
    await new Promise(resolvePromise => setTimeout(resolvePromise, 600))
    // Restart with the saved private file: the same subject now reports a present configuration.
    const [p2, a2] = [await freePort(), await freePort()]
    mark('restart with the saved configuration')
    child = spawn(join(root, 'Start.command'), ['--port', String(p2), '--api-port', String(a2), '--discussion-only'],
      { cwd: root, env: launcherEnv(home, { PA_MODEL_CONFIG: modelPath }), stdio: ['ignore', 'pipe', 'pipe'] })
    operation.track({ ...resourceBirthFromSpawn(child.pid, root, modelDir), op: 'model-save:launcher-2' })
    const status2 = await waitStatus(run)
    const recordPath2 = recordPath
    const recordDir2 = recordDir
    const set2 = captureSet(recordPids(recordPath2), { root, config: join(recordDir2, 'config'), state: join(recordDir2, 'data'), op: 'model-save:instance-2' })
    for (const pid of recordPids(recordPath2)) operation.track(resourceBirth(pid, { root, config: join(recordDir2, 'config'), state: join(recordDir2, 'data'), op: 'model-save:instance-2' }))
    let readiness = null
    if (status2?.json?.status === 'RUNNING') {
      const keyBytes = readFileSync(join(recordDir2, 'data', 'api.key'), 'utf8').trim()
      readiness = await fetch(`${status2.json.instance.apiURL}/v1/readiness`, { headers: { authorization: `Bearer ${keyBytes}` }, signal: AbortSignal.timeout(10_000) })
        .then(async value => { const body = await value.json(); return { status: value.status, discussion: body.discussion, authorization: body.authorization } })
        .catch(error => ({ status: 0, error: String(error.message) }))
    }
    const stop2 = run(['stop'], { timeoutMs: 40_000 })
    evidence.restart = { status: status2?.json?.status ?? null, readiness, providerRequests: mock.requests.length,
      stop: { status: stop2.status, result: stop2.json?.status ?? null }, resources: { before: set2, after: rollout(set2) } }
    const installedSchema = (() => {
      try {
        const db = new DatabaseSync(join(recordDir2, 'data', 'state.sqlite'), { readOnly: true })
        try { return Number(db.prepare("select value from schema_meta where key='product_schema'").get()?.value ?? 0) } finally { db.close() }
      } catch { return null }
    })()
    evidence.subject = { source: evidence.zip.source, buildId: evidence.zip.buildId, schema: installedSchema,
      tarSha256: evidence.zip.innerTarSha256, tarBytes: evidence.zip.innerTarBytes,
      platform: evidence.zip.runtime?.platform ?? null, arch: evidence.zip.runtime?.arch ?? null, abi: evidence.zip.runtime?.abi ?? null }
  } catch (error) {
    failure = String(error?.message ?? error).slice(0, 600)
    operation.fail('case', error)
    operation.retain(`case:${failure}`)
  } finally {
    // Failure paths still attempt the packaged stop once; the product result decides nothing here.
    try { run?.(['stop'], { timeoutMs: 20_000 }) } catch { /* recorded by retain below */ }
    if (child) { try { child.stdout?.destroy(); child.stderr?.destroy() } catch { /* gone */ } }
  }

  await mock?.close?.().catch(() => {})
  // Product assertions run in the product case; the release decision follows them.
  const productCase = await runCase({ id: 'E36-W35-MODEL-SAVE',
    title: 'The W35 packaged console saves a private model configuration without sending a model request',
    layer: LAYERS.INSTALLED, evidence: { modelSave: evidence }, limitations: [
      'The configured endpoint is a loopback mock; no vendor model or native run is claimed.',
      'The browser is the repository Playwright; every served UI/API byte belongs to the frozen W35 ZIP.',
    ] }, async ({ assert }) => {
    assert('MODEL_PROVISIONED', failure === null, failure ?? 'no failure')
    assert('MODEL_ZIP_IDENTITY', evidence.zip?.sumsMatch === true && evidence.zip?.resultMatch === true &&
      evidence.zip?.installManifestDigest === evidence.zip?.installManifestSha256 &&
      evidence.zip?.runtimeDigest === evidence.zip?.runtime?.sha256 && evidence.zip?.licenseDigest === evidence.zip?.runtime?.licenseSha256,
      JSON.stringify({ sums: evidence.zip?.sumsMatch, result: evidence.zip?.resultMatch, manifest: evidence.zip?.installManifestDigest?.slice(0, 12) }))
    assert('MODEL_FORM_VISIBLE', evidence.form?.endpoint === 'url' && evidence.form?.key === 'password', JSON.stringify(evidence.form))
    assert('MODEL_INVALID_ENDPOINT_REFUSED', evidence.negatives.invalidEndpoint?.rejected === true, JSON.stringify(evidence.negatives.invalidEndpoint))
    assert('MODEL_SAVED_PRIVATE', evidence.save?.mode === 0o600 && evidence.save?.keyMatches === true &&
      evidence.save?.allowInsecureHttp === true && evidence.save?.baseURL?.startsWith('http://127.0.0.1:'), JSON.stringify(evidence.save))
    assert('MODEL_NO_REQUEST', evidence.save?.providerRequests === 0, JSON.stringify({ requests: evidence.save?.providerRequests }))
    assert('MODEL_NO_ECHO', evidence.save?.keyEchoed === false && evidence.save?.passwordCleared === true &&
      evidence.negatives.reopen?.keyValue === '' && evidence.negatives.reopen?.bodyLeaksKey === false,
      JSON.stringify({ echo: evidence.save?.keyEchoed, cleared: evidence.save?.passwordCleared, reopen: evidence.negatives.reopen }))
    assert('MODEL_RESTART_CONFIGURED', evidence.restart?.status === 'RUNNING' && evidence.restart?.readiness?.status === 200 &&
      evidence.restart?.readiness?.discussion === 'configuration_present' && evidence.restart?.providerRequests === 0,
      JSON.stringify(evidence.restart))
    assert('MODEL_STOP_COMPLETE', evidence.resources.instance?.stop?.result === 'STOPPED' && evidence.restart?.stop?.result === 'STOPPED',
      JSON.stringify({ first: evidence.resources.instance?.stop, second: evidence.restart?.stop }))
    evidence.subject && (assert('MODEL_SUBJECT', evidence.subject.buildId === evidence.zip.buildId, JSON.stringify(evidence.subject)))
  })
  if (productCase.status !== 'PASS') operation.retain('product_assertion_failure')
  const observation = operation.observe()
  const verdict = operation.releaseAllowed(observation)
  if (failure === null && productCase.status === 'PASS' && verdict.allowed === true) {
    const released = operation.release({ observation })
    evidence.operation = { verdict, released: released.released, retained: [], observation, signals: operation.signals }
  } else {
    operation.retain(failure ?? verdict.reason ?? 'unknown')
    const kept = operation.retainAll(failure ?? verdict.reason ?? 'unknown')
    evidence.operation = { verdict, released: [], retained: kept.retained, reason: kept.reason, observation, signals: operation.signals, failures: operation.failures }
  }
  const operationCase = await runCase({ id: 'E36-W35-MODEL-SAVE-OPERATION',
    title: 'The W35 model-save operation releases its private HOME only on a complete exited observation',
    layer: LAYERS.INSTALLED, evidence: { modelSaveOperation: evidence.operation, subject: evidence.subject }, limitations: ['Operation outcome only.'] },
    async ({ assert }) => {
      const op = evidence.operation
      assert('OPERATION_DECIDED', typeof op?.verdict?.allowed === 'boolean', JSON.stringify(op?.verdict))
      if (op.verdict.allowed === true) assert('OPERATION_CLEAN', op.released.length >= 1 && op.retained.length === 0 && op.signals.length === 0, JSON.stringify(op))
      else assert('OPERATION_RETAINED', op.released.length === 0 && (op.retained?.length ?? 0) >= 1, JSON.stringify(op?.retained))
    })
  return { cases: [productCase, operationCase], artifacts: {} }
}

/** Birth facts captured immediately after spawn, before any status wait. */
function resourceBirthFromSpawn(pid, root, stateRoot) {
  const live = liveIdentity(pid)
  return { pid, start: live.start, uid: live.uid, ppid: live.ppid, argv: live.command,
    argvSha256: live.command ? sha256(live.command) : null, aliveAtBirth: live.alive, root, config: stateRoot, state: stateRoot, parentPid: null, role: 'launcher' }
}
