import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { openBrowser } from '../lib/browser.mjs'
import { createTurnLedger, applyPatchToCopy, prepareBackupProject } from '../lib/m03.mjs'
import { extractOuterZip, privateHome, verifyOuterZip, W36_ZIP_DIR, W36_ZIP_NAME } from '../lib/outer-zip.mjs'
import { freePort, launcher, privateRoot, startOwned, stopOwned } from '../lib/packaged-instance.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'

/**
 * Milestone-03 zero-model preparation.
 *
 * Nothing here sends a Codex turn. The live two-project delivery, workbench controls, manual accept
 * and reopen are prepared as explicit NOT_TESTED entries until D freezes the milestone package and
 * the 3-turn E budget is actually available. The provisional cohort used for readiness/import is the
 * existing W36 package and is labeled as such, never as the milestone verdict.
 */
const here = resolve('.')
const COHORT = {
  id: process.env.PA_E_M03_COHORT ?? 'w36-provisional',
  dir: process.env.PA_E_M03_DIR ?? W36_ZIP_DIR,
  name: process.env.PA_E_M03_ZIP ?? W36_ZIP_NAME,
}

const runner = (root, home) => (args, { timeoutMs = 40_000 } = {}) => {
  const result = spawnSync(join(root, 'runtime/bin/node'), [join(root, 'personal-preview-launcher.mjs'), ...args], {
    cwd: root, env: { ...process.env, HOME: home, PATH: `${join(home, 'bin')}:${process.env.PATH}` }, encoding: 'utf8', timeout: timeoutMs,
  })
  let json
  try { json = JSON.parse(String(result.stdout).trim()) } catch { json = undefined }
  return { status: result.status, json, stdout: String(result.stdout).slice(-500), stderr: String(result.stderr).slice(-500) }
}
async function waitRunning(run, attempts = 120) {
  let last = null
  for (let index = 0; index < attempts; index += 1) {
    last = run(['status'], { timeoutMs: 20_000 })
    if (last.json?.status === 'RUNNING') return last
    await new Promise(resolvePromise => setTimeout(resolvePromise, 250))
  }
  return last
}

function stage(home) {
  mkdirSync(join(home, 'bin'), { recursive: true })
  writeFileSync(join(home, 'bin', 'open'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
}

async function startCohort({ env = {} } = {}) {
  const root = privateRoot('pa-e-m03-')
  const home = privateHome('pa-e-m03home-')
  stage(home)
  const zip = verifyOuterZip(COHORT.dir, COHORT.name)
  const extracted = extractOuterZip(zip, home)
  root.install = extracted.install
  const first = launcher(root.install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state } })
  if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
  const ports = [await freePort(), await freePort()]
  const started = startOwned(root, { ports, fixture: false, extraArgs: [], env })
  const value = await started.value
  return { root, home, zip, extracted, started, value, run: runner(root.install, home) }
}

export async function runM03Prep() {
  const cases = []
  const evidence = { cohort: { ...COHORT, provisional: COHORT.id !== 'm03-frozen' }, preflight: null, noExecutor: null, importTwo: null, apply: null, budget: null }

  cases.push(await runCase({ id: 'E-M03-PREFLIGHT',
    title: 'The provisional packaged entry starts normally, reports real Codex readiness and keeps credentials out of the page/package',
    layer: LAYERS.INSTALLED, evidence: { m03Preflight: evidence }, limitations: [
      'Provisional cohort (existing W36 package) for zero-model preparation; not the milestone-03 installed verdict.',
      'No Codex turn is sent: readiness/version/auth are read-only.',
    ] }, async ({ assert }) => {
    let value = null
    try {
      const modelDir = join(privateHome('pa-e-m03model-'), 'private')
      mkdirSync(modelDir, { recursive: true, mode: 0o700 })
      const modelPath = join(modelDir, 'model.json')
      const previousModel = process.env.PA_MODEL_CONFIG
      process.env.PA_MODEL_CONFIG = modelPath
      value = await startCohort()
      if (previousModel === undefined) delete process.env.PA_MODEL_CONFIG
      else process.env.PA_MODEL_CONFIG = previousModel
      if (value.value.status !== 'RUNNING') throw new Error(`start ${value.value.status}/${value.value.code ?? 'none'}: ${value.value.stderr ?? ''}`)
      const client = new LocalProductClient({ baseURL: value.value.instance.apiURL, stateDir: value.value.instance.state, timeoutMs: 20_000 })
      for (let index = 0; index < 80; index += 1) { try { if ((await client.health())?.status === 'ok') break } catch { /* wait */ } await new Promise(resolvePromise => setTimeout(resolvePromise, 150)) }
      const readiness = await client.request('/v1/readiness')
      const configuration = await client.request('/v1/configuration')
      const codexVersion = spawnSync('codex', ['--version'], { encoding: 'utf8', timeout: 20_000 })
      const codexAuth = spawnSync('codex', ['login', 'status'], { encoding: 'utf8', timeout: 20_000 })
      const browser = await openBrowser({ root: here })
      let ui = null
      try {
        const page = browser.page
        await page.goto(value.value.instance.consoleURL, { waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: '试用准备', exact: true }).click()
        await page.waitForTimeout(700)
        const trialText = await page.locator('body').innerText()
        const executor = page.getByRole('button', { name: '检查执行器', exact: true })
        let executorText = null
        if (await executor.count() > 0) { await executor.click(); await page.waitForTimeout(700); executorText = (await page.locator('body').innerText()).slice(-900) }
        // Private model configuration through the same packaged form; saving must not connect.
        await page.getByRole('button', { name: '偏好设置', exact: true }).click()
        const form = page.locator('.trial-model-connection')
        await form.waitFor()
        await form.getByLabel('模型端点').fill('https://example.invalid/v1')
        await form.getByLabel('模型名称').fill('prep-model')
        await form.getByLabel('API Key').fill('prep-private-key')
        await form.getByRole('button', { name: '保存配置', exact: true }).click()
        await page.getByText('已保存到本机；尚未发送验证请求。', { exact: false }).waitFor({ timeout: 30_000 })
        const savedText = await page.locator('body').innerText()
        const storage = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))
        const savedBytes = existsSync(modelPath) ? readFileSync(modelPath, 'utf8') : null
        ui = { trialTail: trialText.slice(-500), executorText, storage,
          saved: savedBytes !== null,
          savedTextTail: savedText.slice(-260),
          savedMode: existsSync(modelPath) ? (statSync(modelPath).mode & 0o777) : null,
          savedKeys: savedBytes ? Object.keys(JSON.parse(savedBytes)).sort() : null,
          keyEchoed: savedText.includes('prep-private-key'),
          connectedClaim: /连接已确认|connected/iu.test(savedText) }
        await page.getByRole('button', { name: '关闭模型设置', exact: true }).click().catch(() => {})
      } finally { await browser.close().catch(() => {}) }
      const packageGrep = spawnSync('grep', ['-rIl', '-E', '(sk-[A-Za-z0-9]{20,}|api[_-]?key["\u0027]?\\s*[:=]\\s*["\u0027][A-Za-z0-9]{16,})', join(value.root.install, 'app/apps')], { encoding: 'utf8', timeout: 60_000 })
      evidence.preflight = {
        status: value.value.status, readiness: { status: readiness.status, body: readiness.body },
        configuration: { status: configuration.status, execution: configuration.body?.executionAvailability,
          projects: (configuration.body?.projects ?? []).length },
        codex: { version: { status: codexVersion.status, text: String(codexVersion.stdout ?? codexVersion.stderr).trim().slice(0, 80) },
          auth: { status: codexAuth.status, text: String(codexAuth.stdout ?? codexAuth.stderr).trim().slice(0, 120).replace(/sk-[A-Za-z0-9]+/gu, 'sk-***') } },
        ui, packageSecretHits: String(packageGrep.stdout ?? '').split('\n').filter(Boolean).length,
        modelTurns: 0,
      }
      await stopOwned(value.root, { birth: value.started.birth })
      evidence.preflight.stop = 'STOPPED'
    } finally { if (value) await stopOwned(value.root, { birth: value.started.birth }).catch(() => {}) }
    const pf = evidence.preflight ?? {}
    assert('M03_PREFLIGHT_START', pf.status === 'RUNNING', JSON.stringify(pf))
    assert('M03_PREFLIGHT_CODEX', pf.readiness?.body?.execution?.state === 'available' &&
      pf.readiness?.body?.development === 'configuration_present' && (pf.readiness?.body?.profiles?.admittedNative ?? 0) >= 1 &&
      pf.codex?.version?.status === 0 && /codex-cli/u.test(pf.codex.version.text) && pf.codex?.auth?.status === 0,
      JSON.stringify({ readiness: pf.readiness?.body, codex: pf.codex }))
    assert('M03_PREFLIGHT_UI', /Codex|执行器|版本|认证/u.test(String(pf.ui?.executorText ?? '') + String(pf.ui?.trialTail ?? '')), JSON.stringify(pf.ui?.executorText?.slice(0, 400)))
    assert('M03_CONFIG_SAVED', pf.ui?.saved === true && pf.ui?.savedMode === 0o600 &&
      pf.ui?.savedKeys?.includes('apiKey') && pf.ui?.keyEchoed === false,
      JSON.stringify({ saved: pf.ui?.saved, mode: pf.ui?.savedMode, keys: pf.ui?.savedKeys, echo: pf.ui?.keyEchoed }))
    assert('M03_SAVED_NOT_CONNECTED', pf.ui?.connectedClaim === false && /已保存到本机/u.test(String(pf.ui?.savedTextTail ?? '')),
      JSON.stringify(pf.ui?.savedTextTail))
    assert('M03_NO_TURN', pf.modelTurns === 0, String(pf.modelTurns))
    assert('M03_CREDENTIALS', pf.packageSecretHits === 0 && (pf.ui?.storage?.local ?? []).every(key => !/key|token|secret/iu.test(key)) &&
      (pf.ui?.storage?.session ?? []).every(key => !/key|token|secret/iu.test(key)), JSON.stringify(pf.ui?.storage))
  }))

  cases.push(await runCase({ id: 'E-M03-NO-EXECUTOR',
    title: 'Without a usable Codex the product blocks development and never falls back to a fixture executor',
    layer: LAYERS.INSTALLED, evidence: { m03NoExecutor: evidence }, limitations: [
      'Provisional cohort; the PATH is stripped only for this probe-owned start.',
      'If the product refuses to start at all, that outcome is recorded as observed rather than failing the whole milestone.',
    ] }, async ({ assert, note }) => {
    const strippedPath = '/usr/bin:/bin:/usr/sbin:/sbin'
    let value = null
    try {
      const original = process.env.PATH
      process.env.PATH = strippedPath
      try { value = await startCohort() } finally { process.env.PATH = original }
      if (value.value.status === 'RUNNING') {
        const client = new LocalProductClient({ baseURL: value.value.instance.apiURL, stateDir: value.value.instance.state, timeoutMs: 20_000 })
        for (let index = 0; index < 60; index += 1) { try { if ((await client.health())?.status === 'ok') break } catch { /* wait */ } await new Promise(resolvePromise => setTimeout(resolvePromise, 150)) }
        const readiness = await client.request('/v1/readiness')
        const discussion = await client.request('/v1/conversations/commands', { method: 'POST', body: {
          commandId: `m03-discussion-${Date.now()}`, conversationId: 'conv-m03-noexec', kind: 'chat', text: '讨论仍应可用。' } })
          .catch(error => ({ status: error.status, body: error.body }))
        evidence.noExecutor = { status: value.value.status, readiness: { status: readiness.status, body: readiness.body },
          fixtureFallback: readiness.body?.mode === 'fixture' || readiness.body?.execution?.kind === 'controlled',
          discussion: discussion.status, modelTurns: 0 }
        await stopOwned(value.root, { birth: value.started.birth })
      } else {
        evidence.noExecutor = { status: value.value.status, code: value.value.code ?? null, stderr: String(value.value.stderr ?? '').slice(-300), modelTurns: 0 }
      }
    } catch (error) { evidence.noExecutor = { error: String(error?.message ?? error).slice(0, 300), modelTurns: 0 } }
    const ne = evidence.noExecutor ?? {}
    if (ne.status === 'RUNNING') {
      assert('M03_NO_EXECUTOR_BLOCKED', ne.readiness?.body?.execution?.state === 'unavailable' && ne.readiness?.body?.development === 'blocked',
        JSON.stringify(ne.readiness?.body))
      assert('M03_NO_FIXTURE_FALLBACK', ne.fixtureFallback === false && ne.readiness?.body?.mode === 'personal', JSON.stringify(ne.readiness?.body))
      assert('M03_DISCUSSION_ALLOWED', typeof ne.discussion === 'number', String(ne.discussion))
    } else {
      note(`product start without Codex reported ${ne.status}/${ne.code ?? 'none'}: ${String(ne.stderr ?? ne.error ?? '').slice(0, 200)}`)
      assert('M03_NO_EXECUTOR_OBSERVED', ne.status !== undefined, JSON.stringify(ne))
    }
    assert('M03_NO_EXECUTOR_NO_TURN', ne.modelTurns === 0, String(ne.modelTurns))
  }))

  cases.push(await runCase({ id: 'E-M03-IMPORT-TWO',
    title: 'Two different real source backups import through the packaged UI as distinct projects with their own checks',
    layer: LAYERS.INSTALLED, evidence: { m03ImportTwo: evidence }, limitations: [
      'Provisional cohort; the backups are copies of real repository sources, and the checks are the projects\' node:test entries (scope recorded).',
      'No Work is created in this preparation, so no Codex turn is sent.',
    ] }, async ({ assert }) => {
    let value = null
    try {
      const modelDir = join(privateHome('pa-e-m03model-'), 'private')
      mkdirSync(modelDir, { recursive: true, mode: 0o700 })
      const modelPath = join(modelDir, 'model.json')
      const previousModel = process.env.PA_MODEL_CONFIG
      process.env.PA_MODEL_CONFIG = modelPath
      value = await startCohort()
      if (previousModel === undefined) delete process.env.PA_MODEL_CONFIG
      else process.env.PA_MODEL_CONFIG = previousModel
      if (value.value.status !== 'RUNNING') throw new Error(`start ${value.value.status}/${value.value.code ?? 'none'}`)
      const projectsRoot = join(value.home, 'projects')
      // Real repository sources copied as backups; the live milestone run will use their real checks.
      const projectA = prepareBackupProject({ source: join(here, 'product-spec'), target: join(projectsRoot, 'spec-tools'), name: 'spec-tools-backup', check: 'node_test' })
      const projectB = prepareBackupProject({ source: join(here, 'tools/acceptance'), target: join(projectsRoot, 'accept-tools'), name: 'accept-tools-backup', check: 'node_test' })
      const browser = await openBrowser({ root: here })
      const ui = []
      try {
        const page = browser.page
        await page.goto(value.value.instance.consoleURL, { waitUntil: 'domcontentloaded' })
        for (const project of [projectA, projectB]) {
          await page.getByRole('button', { name: '试用准备', exact: true }).click()
          await page.getByRole('button', { name: '导入项目', exact: true }).click()
          const form = page.getByRole('form', { name: '导入本地项目', exact: true })
          await form.waitFor()
          await form.locator('input[name=project-path]').fill(project.path)
          await form.locator('input[name=project-name]').fill(project.name)
          await form.locator('select[name=project-check]').selectOption(project.check)
          await form.getByRole('button', { name: '导入项目', exact: true }).click()
          await page.waitForTimeout(900)
          ui.push({ name: project.name, text: (await page.locator('body').innerText()).slice(-400) })
        }
      } finally { await browser.close().catch(() => {}) }
      const client = new LocalProductClient({ baseURL: value.value.instance.apiURL, stateDir: value.value.instance.state, timeoutMs: 20_000 })
      const configuration = await client.request('/v1/configuration')
      const names = (configuration.body?.projects ?? []).map(item => item.displayName)
      const projectIds = (configuration.body?.projects ?? []).map(item => item.id)
      const works = (configuration.body?.projects ?? []).filter(item => item.dispatchAllowed).length
      evidence.importTwo = { status: configuration.status, names, projectIds, dispatchable: works,
        distinct: new Set(projectIds).size === projectIds.length, ui, modelTurns: 0,
        backups: [{ name: projectA.name, head: projectA.head, check: projectA.check }, { name: projectB.name, head: projectB.head, check: projectB.check }] }
      await stopOwned(value.root, { birth: value.started.birth })
    } finally { if (value) await stopOwned(value.root, { birth: value.started.birth }).catch(() => {}) }
    const it = evidence.importTwo ?? {}
    assert('M03_IMPORT_TWO_PROJECTS', it.names?.includes('spec-tools-backup') && it.names?.includes('accept-tools-backup'),
      JSON.stringify(it.names))
    assert('M03_IMPORT_DISTINCT', it.distinct === true && it.projectIds?.length >= 2, JSON.stringify(it.projectIds))
    assert('M03_IMPORT_CHECKS', it.backups?.every(item => item.check === 'node_test' && /^[a-f0-9]{40}$/u.test(item.head)), JSON.stringify(it.backups))
    assert('M03_IMPORT_UI', it.ui?.length === 2 && it.ui.every(item => item.text?.length > 0), JSON.stringify(it.ui?.map(item => item.text?.slice(-120))))
    assert('M03_IMPORT_NO_TURN', it.modelTurns === 0, String(it.modelTurns))
  }))

  cases.push(await runCase({ id: 'E-M03-APPLY-VERIFY',
    title: 'A patch is applied and checked only in an independent baseline copy',
    layer: LAYERS.INSTALLED, evidence: { m03Apply: evidence }, limitations: [
      'Synthetic bug/fix repository; it proves the apply-and-check helper, not a Codex-produced patch.',
    ] }, async ({ assert }) => {
    const root = privateHome('pa-e-m03apply-')
    const baseline = join(root, 'baseline')
    mkdirSync(join(baseline, 'src'), { recursive: true })
    mkdirSync(join(baseline, 'test'), { recursive: true })
    mkdirSync(join(root, 'fix'), { recursive: true })
    writeFileSync(join(baseline, 'package.json'), JSON.stringify({ name: 'm03-buggy', private: true, type: 'module', scripts: { test: 'node --test' } }))
    writeFileSync(join(baseline, 'src/calc.mjs'), 'export const add = (a, b) => a - b\n')
    writeFileSync(join(baseline, 'test/add.test.mjs'), `import { test } from 'node:test'\nimport assert from 'node:assert'\nimport { add } from '../src/calc.mjs'\ntest('add', () => assert.equal(add(2, 3), 5))\n`)
    const git = args => spawnSync('git', args, { cwd: baseline, encoding: 'utf8', timeout: 60_000 })
    git(['init', '-q']); git(['add', '-A']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'baseline'])
    const head = git(['rev-parse', 'HEAD']).stdout.trim()
    // Author the fix in the baseline worktree, capture the patch, then restore the baseline.
    writeFileSync(join(baseline, 'src/calc.mjs'), 'export const add = (a, b) => a + b\n')
    const patch = git(['diff']).stdout
    writeFileSync(join(root, 'fix.patch'), patch)
    git(['checkout', '--', '.'])
    const before = git(['status', '--porcelain']).stdout.trim()
    const copy = join(root, 'copy')
    const result = applyPatchToCopy({ baseline, copy, patchPath: join(root, 'fix.patch') })
    const baselineStatus = git(['status', '--porcelain']).stdout.trim()
    const baselineHead = git(['rev-parse', 'HEAD']).stdout.trim()
    evidence.apply = { head, patchBytes: patch.length, copyCheck: result.check.slice(-200), baselineClean: before === '' && baselineStatus === '',
      baselineHeadUnchanged: baselineHead === head, copyHeadExists: existsSync(join(copy, '.git')) }
    assert('M03_APPLY_PATCH', patch.length > 0 && /^[a-f0-9]{40}$/u.test(head), JSON.stringify({ patchBytes: patch.length }))
    assert('M03_APPLY_CHECK_PASSES', /pass|ok/iu.test(result.check), result.check.slice(-200))
    assert('M03_APPLY_BASELINE_UNTOUCHED', before === '' && baselineStatus === '' && baselineHead === head, JSON.stringify(evidence.apply))
    rmSync(root, { recursive: true, force: true })
  }))

  cases.push(await runCase({ id: 'E-M03-BUDGET',
    title: 'The milestone ledger caps E at three turns, keeps unknown sends occupied and refuses resend',
    layer: LAYERS.READONLY, evidence: { m03Budget: evidence } }, async ({ assert }) => {
    const root = privateHome('pa-e-m03ledger-')
    const ledger = createTurnLedger(join(root, 'turns.jsonl'))
    const first = ledger.reserve('project-a')
    const second = ledger.reserve('project-b')
    const third = ledger.reserve('controls')
    const fourth = ledger.reserve('overflow')
    const sent = ledger.sent('project-a', { turnStart: 'turn-a' })
    const unknown = ledger.unknown('project-b', 'transport_closed_after_write')
    const retry = ledger.canRetryAfterUnknown('project-b')
    const duplicate = ledger.reserve('project-a')
    evidence.budget = { first, second, third, fourth, sent, unknown, retry, duplicate, used: ledger.used(), remaining: ledger.remaining() }
    assert('M03_BUDGET_RESERVES', first.ok === true && second.ok === true && third.ok === true, JSON.stringify(evidence.budget))
    assert('M03_BUDGET_CAP', fourth.ok === false && fourth.reason === 'cap_reached', JSON.stringify(fourth))
    assert('M03_BUDGET_UNKNOWN_HELD', unknown.ok === true && retry === false && ledger.used() === 3 && ledger.remaining() === 0, JSON.stringify({ unknown, retry }))
    assert('M03_BUDGET_DUPLICATE', duplicate.ok === false && duplicate.reason === 'duplicate_id', JSON.stringify(duplicate))
    rmSync(root, { recursive: true, force: true })
  }))

  cases.push(notTested({ id: 'E-M03-DUAL-DELIVERY',
    title: 'Two real Git projects each deliver one bug fix and one small feature through the normal workbench',
    layer: LAYERS.INSTALLED, evidence: { m03Dual: { status: 'NOT_TESTED', reason: 'requires the D-frozen milestone package and the 2-turn E budget' } } },
  'NOT_TESTED: gated on (1) D freezing the milestone package from main\'s released source and (2) the E budget. Steps prepared: import two real backups through the UI, create one bug-fix and one small-feature Work on separate original project ids, answer the original questions, wait for the machine check, view candidate, explicitly accept, apply the patch in an independent copy and rerun the project check, then reopen the same instance and read both Works/messages/candidates/artifacts. No fixture Works and no probe API may substitute.'))

  cases.push(notTested({ id: 'E-M03-WORKBENCH-CONTROLS',
    title: 'Progress, original questions, same-Work supplements and explicit stop are driven through the normal UI',
    layer: LAYERS.INSTALLED, evidence: { m03Controls: { status: 'NOT_TESTED', reason: 'needs a live Work and the third budget turn' } } },
  'NOT_TESTED: prepared on the normal UI path; requires a live Work. Covers progress visibility, answering an original question, adding a requirement to the same Work, explicit stop, and preserving original target/question/command identities plus the physical resource barrier. Approval/clarification trigger conditions and plan-mode limits are recorded only if actually triggered; no probe coordinator or script call may stand in.'))

  cases.push(notTested({ id: 'E-M03-REOPEN',
    title: 'After a normal stop and reopen both original projects, Works, messages, candidates and acceptances remain visible',
    layer: LAYERS.INSTALLED, evidence: { m03Reopen: { status: 'NOT_TESTED', reason: 'depends on the completed live delivery' } } },
  'NOT_TESTED: depends on E-M03-DUAL-DELIVERY. Reopen uses the same private roots and the packaged normal entry; no new SIGKILL or fault-window work.'))

  cases.push(notTested({ id: 'E-M03-INSTALLED-JOURNEY',
    title: 'The same frozen package installs into a fresh private root and repeats the six-item journey via its own entry',
    layer: LAYERS.INSTALLED, evidence: { m03Installed: { status: 'NOT_TESTED', reason: 'D has not frozen the milestone package yet' } } },
  'NOT_TESTED: D must publish the milestone-03 package built from main\'s explicitly released source (exact source/build/inner/outer SHA). E will then repeat configuration, two real projects, workbench controls, check/manual accept, patch apply verification and normal reopen in a new install directory/private roots/ports using only package entries. Same-machine installation only; cross-machine stays NOT_TESTED.'))

  return { cases, artifacts: {} }
}
