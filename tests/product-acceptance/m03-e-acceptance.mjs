#!/usr/bin/env node
/**
 * Milestone-03 focused E entry.
 *
 *   node tests/product-acceptance/m03-e-acceptance.mjs --prep
 *   node tests/product-acceptance/m03-e-acceptance.mjs --prepare
 *   node tests/product-acceptance/m03-e-acceptance.mjs --work=alpha
 *   node tests/product-acceptance/m03-e-acceptance.mjs --work=beta
 *   node tests/product-acceptance/m03-e-acceptance.mjs --reopen
 *   node tests/product-acceptance/m03-e-acceptance.mjs --status
 *
 * Live stages require an explicit selection and check the real ledger before reserving a turn.
 * Everything runs against the fixed milestone package; nothing here uses the dev checkout as the
 * product entry except the browser driver.
 */
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { openBrowser } from './lib/browser.mjs'
import { createTurnLedger, prepareRealProject, runProjectCheck, applyPatchToCopy } from './lib/m03.mjs'
import { extractOuterZip, privateHome } from './lib/outer-zip.mjs'
import { freePort, launcher } from './lib/packaged-instance.mjs'

const ROOT = resolve('.')
const PKG = {
  dir: '/Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec',
  name: 'PersonalAgent-Preview-d3ba0ec.zip',
  source: '83f79e8249efd68f429f2b6828ea233278071737', build: 'd3ba0ec6dccc5eac',
  inner: '52eee9083b4d2256a58189327c93605c157e38f5cd44894482a82c6198f56123', innerBytes: 20631227,
  outer: '163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b',
}
const WORK_ROOT = process.env.PA_E_M03_ROOT ?? '/tmp/pa-e-m03-live'
const STATE = join(WORK_ROOT, 'state.json')
const LEDGER = join(WORK_ROOT, 'turns.jsonl')
const PROJECT_A = process.env.PA_E_M03_PROJECT_A ?? '/Users/hh/Desktop/joker/MerchantOpsRpaCli'
const PROJECT_B = process.env.PA_E_M03_PROJECT_B ?? '/Users/hh/Desktop/joker/agent-WorkFLow'
const PREPARED_A = process.env.PA_E_M03_PREPARED_A ?? '/tmp/pa-e-m03-live/projects2/merchantops-rpa'
const PREPARED_B = process.env.PA_E_M03_PREPARED_B ?? '/tmp/pa-e-m03-live/projects2/agent-workflow'
const PREPARED_A3 = process.env.PA_E_M03_PREPARED_A3 ?? '/tmp/pa-e-m03-live/projects3/token-engine-a'
const PREPARED_B3 = process.env.PA_E_M03_PREPARED_B3 ?? '/tmp/pa-e-m03-live/projects3/token-engine-b'
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const loadState = () => existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {}
const saveState = state => { mkdirSync(WORK_ROOT, { recursive: true, mode: 0o700 }); writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 }) }
const run = (cmd, args, options = {}) => spawnSync(cmd, args, { encoding: 'utf8', timeout: 300_000, ...options })

function verifyPackage() {
  const zip = join(PKG.dir, PKG.name)
  if (!existsSync(zip)) throw new Error(`package absent: ${zip}`)
  const bytes = readFileSync(zip)
  if (sha(bytes) !== PKG.outer) throw new Error(`outer SHA mismatch: ${sha(bytes)}`)
  const result = JSON.parse(readFileSync(join(PKG.dir, 'package-result.json'), 'utf8'))
  const inner = result.inner ?? {}
  if (inner.buildId !== PKG.build || inner.source !== PKG.source || inner.tarSha256 !== PKG.inner || inner.tarBytes !== PKG.innerBytes)
    throw new Error(`inner identity mismatch: ${JSON.stringify(inner)}`)
  return { zip, bytes: bytes.byteLength, result }
}

function installTo(installRoot) {
  const home = privateHome('pa-e-m03-live-home-')
  const zip = verifyPackage()
  const extracted = extractOuterZip({ zipPath: zip.zip, sha256: PKG.outer, bytes: zip.bytes, sumsMatch: true, resultMatch: true, result: zip.result }, home)
  if (!existsSync(installRoot)) cpSync(extracted.root, installRoot, { recursive: true, verbatimSymlinks: true })
  const modelDir = join(WORK_ROOT, 'model'); mkdirSync(modelDir, { recursive: true, mode: 0o700 })
  return { install: installRoot, home, modelPath: join(modelDir, 'model.json'),
    config: join(WORK_ROOT, 'instance/config'), state: join(WORK_ROOT, 'instance/state') }
}

function launchEnv(env) {
  // A normal personal start uses the real HOME: the packaged launcher derives its own
  // Preview-<buildId> namespace and readiness must see the user's own Codex auth home.
  return { ...process.env, HOME: process.env.HOME, PA_MODEL_CONFIG: env.modelPath,
    PATH: `${env.home}/bin:${process.env.PATH}` }
}
function launcherFor(env) {
  return args => {
    const r = run(join(env.install, 'runtime/bin/node'), [join(env.install, 'personal-preview-launcher.mjs'), ...args],
      { cwd: env.install, env: launchEnv(env), timeout: 40_000 })
    let json; try { json = JSON.parse(String(r.stdout).trim()) } catch { json = undefined }
    return { status: r.status, json, stdout: String(r.stdout).slice(-400), stderr: String(r.stderr).slice(-400) }
  }
}
async function startInstance(env) {
  // The packaged launcher runs the original first-run itself when launcher.json is absent.
  const [p1, p2] = [await freePort(), await freePort()]
  const child = spawn(join(env.install, 'Start.command'), ['--port', String(p1), '--api-port', String(p2)],
    { cwd: env.install, env: launchEnv(env), stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  child.stdout.on('data', c => { out += c }); child.stderr.on('data', c => { out += c })
  for (let i = 0; i < 120; i += 1) {
    const s = launcherFor(env)(['status'])
    if (s.json?.status === 'RUNNING') {
      // The packaged Start window is a long-lived foreground process; release it so this
      // entry can finish while the owned instance keeps running.
      child.stdout?.unref?.(); child.stderr?.unref?.(); child.unref?.()
      return { status: s.json, started: true }
    }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error(`start did not become RUNNING: ${out.slice(-500)}`)
}
async function ensureInstance(state) {
  const runStatus = launcherFor(state.env)
  const current = runStatus(['status'])
  if (current.json?.status === 'RUNNING') return { launcherRun: runStatus, status: current.json }
  const started = await startInstance(state.env)
  return { launcherRun: runStatus, status: started.status }
}

async function uiImport(page, project, check = 'npm_test') {
  // Return to the main conversation first so the trial panel always opens (not toggles) per import.
  await page.getByRole('button', { name: '主对话视图', exact: true }).click().catch(() => {})
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: '试用准备', exact: true }).click()
  await page.waitForTimeout(1_200)
  const openImport = page.getByRole('button', { name: '导入项目', exact: true }).first()
  await openImport.waitFor({ state: 'visible', timeout: 20_000 })
  console.log(`import-debug trial-open buttons=${await page.getByRole('button', { name: '导入项目', exact: true }).count()}`)
  await openImport.click()
  await page.waitForTimeout(1_500)
  console.log(`import-debug after-click forms=${await page.locator('form').count()} inputs=${await page.locator('input[name=project-path]').count()}`)
  const pathInput = page.locator('input[name=project-path]').first()
  try { await pathInput.waitFor({ timeout: 20_000 }) } catch {
    const text = await page.locator('body').innerText()
    throw new Error(`import form did not open: ${text.slice(-500)}`)
  }
  const form = pathInput.locator('xpath=ancestor::form[1]')
  await pathInput.fill(project.path)
  await form.locator('input[name=project-name]').fill(project.name)
  await form.locator('select[name=project-check]').selectOption(check)
  const environment = form.locator('select[name=environment-policy]')
  if (await environment.count() > 0) await environment.selectOption('existing_only')
  await form.locator('button[type=submit]').click()
  await page.waitForTimeout(2_000)
  const text = await page.locator('body').innerText()
  const failure = text.match(/导入失败[^\n]*/u)
  if (failure) throw new Error(`import refused: ${failure[0].slice(0, 200)}`)
  await page.keyboard.press('Escape').catch(() => {})
  await page.getByRole('button', { name: '主对话视图', exact: true }).click().catch(() => {})
  await page.waitForTimeout(600)
}

async function uiSaveModel(page) {
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  const form = page.locator('.trial-model-connection')
  await form.waitFor()
  await form.getByLabel('模型端点').fill('https://example.invalid/v1')
  await form.getByLabel('模型名称').fill('m03-demo-model')
  await form.getByLabel('API Key').fill('m03-demo-key-not-a-real-credential')
  await form.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('已保存到本机；尚未发送验证请求。', { exact: false }).waitFor({ timeout: 30_000 })
  const close = page.getByRole('button', { name: '关闭模型设置', exact: true })
  if (await close.count() > 0) await close.click()
}

async function uiCreateWork(page, { projectName, profileId, goal }) {
  await page.getByRole('button', { name: '新建委托', exact: true }).click()
  const form = page.getByRole('form', { name: '新建委托', exact: true })
  await form.waitFor()
  const options = await form.getByRole('combobox', { name: '项目', exact: true }).locator('option').evaluateAll(els => els.map(e => [e.value, e.textContent]))
  const project = options.find(([, text]) => text === projectName)
  if (!project) throw new Error(`project option not found: ${projectName} in ${JSON.stringify(options)}`)
  await form.getByRole('combobox', { name: '项目', exact: true }).selectOption(project[0])
  const profile = form.getByRole('combobox', { name: '开发执行器', exact: true })
  if (await profile.count() > 0) {
    const profileOptions = await profile.locator('option').evaluateAll(els => els.map(e => [e.value, e.textContent]))
    const native = profileOptions.find(([value]) => value === profileId) ?? profileOptions.find(([, text]) => /codex/iu.test(text ?? ''))
    if (!native) throw new Error(`native profile not found: ${JSON.stringify(profileOptions)}`)
    await profile.selectOption(native[0])
  }
  await page.locator('.new-work textarea').fill(goal)
  const command = page.waitForResponse(response => response.url().endsWith('/v1/commands') && response.request().method() === 'POST', { timeout: 120_000 })
  await form.getByRole('button', { name: '创建委托', exact: true }).click()
  const response = await command
  const body = await response.json().catch(() => null)
  return { status: response.status(), body, receipt: body?.receipt ?? body ?? null }
}

async function uiOpenWork(page, goal, projectPath = null) {
  const cards = page.locator('.work-card')
  let count = 0
  for (let attempt = 0; attempt < 30 && count === 0; attempt += 1) {
    count = await cards.count()
    if (count === 0) await page.waitForTimeout(1_000)
  }
  const byText = []
  for (let index = 0; index < count; index += 1) {
    const text = await cards.nth(index).innerText().catch(() => '')
    if (text.includes(goal.slice(0, 32))) byText.push(index)
  }
  const order = [...byText, ...Array.from({ length: count }, (_, index) => index).filter(index => !byText.includes(index))]
  for (const index of order) {
    const card = cards.nth(index)
    await card.click()
    await page.waitForTimeout(600)
    const detail = await page.locator('.detail').innerText().catch(() => '')
    if (!projectPath || detail.includes(projectPath)) {
      await page.waitForTimeout(400)
      return
    }
  }
  throw new Error(`work card not found for ${goal.slice(0, 32)} ${projectPath ?? ''} (cards=${count})`)
}

async function waitForAttempt(page, goal, { timeoutMs = 120_000, projectPath = null } = {}) {
  const deadline = Date.now() + timeoutMs
  await uiOpenWork(page, goal, projectPath)
  let last = ''
  while (Date.now() < deadline) {
    last = await page.locator('.detail').innerText().catch(() => page.locator('body').innerText())
    if (/依赖环境[\s\S]{0,80}(准备受阻|未获确认)/u.test(last) || /写者状态未知[\s\S]{0,40}停止中/u.test(last))
      return { started: false, blocked: true, reason: 'environment_preparation_blocked' }
    if (/验证详情|接受当前候选|写者已静止|执行中/u.test(last))
      return { started: true, blocked: false, reason: 'attempt_observed' }
    await page.waitForTimeout(1_000)
  }
  return { started: false, blocked: false, reason: `attempt_not_observed:${last.slice(-160)}` }
}

async function driveToCandidate(page, workId, { goal = null, projectPath = null, maxMs = 900_000 } = {}) {
  const deadline = Date.now() + maxMs
  const log = []
  if (goal) await uiOpenWork(page, goal, projectPath)
  while (Date.now() < deadline) {
    const text = await page.locator('body').innerText()
    log.push(text.slice(-120))
    if (/接受当前候选/u.test(text)) return { reached: 'candidate', log }
    if (/验证失败|执行失败|无法完成/u.test(text)) return { reached: 'failed', log }
    // Answer a pending original question through the UI.
    const question = page.getByRole('region', { name: /待决定|问题/ })
    if (await question.count() > 0) {
      const option = question.getByRole('radio').first()
      if (await option.count() > 0 && !(await option.isChecked())) await option.check({ force: true })
      const submit = question.getByRole('button', { name: /提交|回答|确认/ }).first()
      if (await submit.count() > 0 && await submit.isEnabled()) { await submit.click(); log.push('answered') }
    }
    await page.waitForTimeout(1_500)
  }
  return { reached: 'timeout', log }
}

async function uiCheckEvidence(page) {
  const row = page.locator('li').filter({ hasText: '检查证据' }).first()
  const view = row.getByRole('button', { name: '查看' })
  if (await view.count() === 0) return { viewed: false, text: '' }
  await view.click()
  await page.waitForTimeout(1_200)
  const text = await page.locator('body').innerText()
  const close = page.getByRole('button', { name: '关闭预览' })
  if (await close.count() > 0) await close.click()
  return { viewed: true, text: text.slice(-2_500) }
}

async function uiAccept(page) {
  const accept = page.getByRole('button', { name: '接受当前候选', exact: true })
  await accept.waitFor()
  await accept.click()
  await page.waitForFunction(() => /已交付/u.test(document.querySelector('.detail .phase')?.textContent ?? document.body.innerText), { timeout: 60_000 })
  return { accepted: true, phase: '已交付' }
}

async function uiDownloadPatch(page) {
  const row = page.locator('li').filter({ hasText: '完整变更补丁' }).first()
  const downloadButton = row.getByRole('link', { name: '下载' })
  if (await downloadButton.count() === 0) return { downloaded: false, reason: 'no_patch_download' }
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), downloadButton.click()])
  const path = join(WORK_ROOT, `patch-${Date.now()}.patch`)
  await download.saveAs(path)
  return { downloaded: true, path, bytes: statSync(path).size, name: download.suggestedFilename() }
}

async function openConsole(page, status) {
  await page.goto(status.instance.consoleURL, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
}

const commands = {
  status() {
    const ledger = createTurnLedger(LEDGER)
    console.log(JSON.stringify({ ledger: LEDGER, used: ledger.used(), inFlight: ledger.inFlight(), remaining: ledger.remaining(),
      entries: ledger.entries() }, null, 1))
  },
  async prepare() {
    const state = loadState()
    state.package = { ...PKG, verifiedAt: new Date().toISOString() }
    state.env = state.env ?? installTo(join(WORK_ROOT, 'install'))
    const instance = await ensureInstance(state)
    state.status = instance.status
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1000 } })
    try {
      const page = browser.page
      await openConsole(page, state.status)
      await uiSaveModel(page)
      const projects = []
      for (const spec of [{ name: 'merchantops-rpa', source: PROJECT_A, task: 'bug_fix' }, { name: 'agent-workflow', source: PROJECT_B, task: 'feature' }]) {
        const target = join(WORK_ROOT, 'projects', spec.name)
        const project = state.projects?.[spec.name] ?? prepareRealProject({ source: spec.source, target, name: spec.name })
        state.projects = { ...(state.projects ?? {}), [spec.name]: project }
        const check = runProjectCheck(project.path)
        await uiImport(page, project)
        projects.push({ name: project.name, head: project.head, passed: check.passed, failed: check.failed })
      }
      state.prepared = { projects, at: new Date().toISOString() }
      saveState(state)
      console.log(JSON.stringify({ prepared: true, install: state.env.install, console: state.status.instance.consoleURL, projects }, null, 1))
    } finally { await browser.close().catch(() => {}) }
  },
  async prepare2() {
    const state = loadState()
    state.package = { ...PKG, verifiedAt: new Date().toISOString() }
    state.env = state.env ?? installTo(join(WORK_ROOT, 'install'))
    const instance = await ensureInstance(state)
    state.status = instance.status
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1000 } })
    try {
      const page = browser.page
      await openConsole(page, state.status)
      const imported = []
      for (const spec of [
        { name: 'merchantops-v2', path: PREPARED_A, task: 'bug_fix' },
        { name: 'workflow-v2', path: PREPARED_B, task: 'feature' },
      ]) {
        const project = { path: spec.path, name: spec.name }
        const check = runProjectCheck(project.path)
        await uiImport(page, project)
        imported.push({ name: project.name, head: run('git', ['-C', project.path, 'rev-parse', 'HEAD']).stdout.trim(),
          passed: check.passed, failed: check.failed, exit: check.exit })
      }
      state.projects2 = Object.fromEntries(imported.map(item => [item.name, { path: item.name === 'merchantops-v2' ? PREPARED_A : PREPARED_B, name: item.name }]))
      state.prepared2 = { projects: imported, at: new Date().toISOString() }
      saveState(state)
      console.log(JSON.stringify({ prepared2: true, console: state.status.instance.consoleURL, projects: imported }, null, 1))
    } finally { await browser.close().catch(() => {}) }
  },
  async work2(which) {
    const state = loadState()
    if (!state.prepared2) throw new Error('run --prepare2 first')
    const tasks = {
      alpha: { id: 'm03-alpha-v2', projectName: 'merchantops-v2', task: 'bug_fix',
        goal: '修复当前项目中 `npm test` 的失败：运行测试定位回归，修改实现使全部测试通过；不要修改或删除任何测试文件。完成后简要说明根因。' },
      beta: { id: 'm03-beta-v2', projectName: 'workflow-v2', task: 'feature',
        goal: '为仓库增加一个小功能：在 packages/domain 下新增纯函数 formatWorkflowVersion(version, commit)，返回 `${version} (${commit.slice(0, 12)})`，并新增对应测试覆盖完整哈希与短哈希；确保 `npm test` 全部通过，不要修改现有测试断言。' },
    }
    const task = tasks[which]
    if (!task) throw new Error('select exactly one of --work2=alpha|beta')
    const ledger = createTurnLedger(LEDGER)
    const balance = ledger.canReserve()
    if (!balance.ok) throw new Error(`refusing to send: ${balance.reason}`)
    if (state.works?.[`${which}2`]) throw new Error(`work ${which}2 already recorded`)
    const reserved = ledger.reserve(task.id)
    if (!reserved.ok) throw new Error(`reserve failed: ${JSON.stringify(reserved)}`)
    let browser = null
    try {
      const instance = await ensureInstance(state)
      browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1000 } })
      const page = browser.page
      await openConsole(page, instance.status)
      const status = instance.status
      const apiKey = readFileSync(join(status.instance.state, 'api.key'), 'utf8').trim()
      const config = await page.request.get(`${status.instance.apiURL}/v1/configuration`, { headers: { authorization: `Bearer ${apiKey}` } })
      const configuration = await config.json()
      const profileId = configuration.profiles?.find?.(p => /codex/iu.test(String(p.id ?? '')))?.id ?? 'profile-codex-native'
      const created = await uiCreateWork(page, { projectName: task.projectName, profileId, goal: task.goal })
      const workId = created.receipt?.workId ?? created.body?.workId ?? null
      if (workId) ledger.sent(task.id, { turnStart: new Date().toISOString() })
      else ledger.unknown(task.id, 'create_work_receipt_missing')
      state.works = { ...(state.works ?? {}), [`${which}2`]: { id: task.id, projectName: task.projectName, task: task.task,
        goal: task.goal, workId, createStatus: created.status, receipt: created.receipt, startedAt: new Date().toISOString() } }
      saveState(state)
      const outcome = await driveToCandidate(page, workId, { goal: task.goal })
      state.works[`${which}2`].outcome = outcome.reached
      saveState(state)
      console.log(JSON.stringify({ which: `${which}2`, workId, created: { status: created.status, receipt: created.receipt },
        outcome: outcome.reached, tail: outcome.log.at(-1) }, null, 1))
      if (!workId) throw new Error('create returned no workId; recorded UNKNOWN, refusing any resend')
    } catch (error) {
      if (!loadState().works?.[`${which}2`]) ledger.cancel(task.id, `setup_failed:${String(error?.message ?? error).slice(0, 120)}`)
      throw error
    } finally { await browser?.close?.().catch(() => {}) }
  },
  async accept2(which) {
    const state = loadState()
    const work = state.works?.[`${which}2`]
    if (!work?.workId) throw new Error(`no work ${which}2`)
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1100 } })
    try {
      const page = browser.page
      const instance = await ensureInstance(state)
      await openConsole(page, instance.status)
      await uiOpenWork(page, work.goal)
      const evidence = await uiCheckEvidence(page)
      if (!/"outcome": "PASS"/u.test(evidence.text)) {
        throw new Error(`machine check is not PASS; refusing acceptance: ${evidence.text.slice(-400)}`)
      }
      const accepted = await uiAccept(page)
      const patch = await uiDownloadPatch(page)
      const project = state.projects2?.[work.projectName]
      let verification = null
      if (patch.downloaded && project) {
        const copy = join(WORK_ROOT, `verify2-${which}`)
        verification = applyPatchToCopy({ baseline: project.path, copy, patchPath: patch.path, gitTop: project.path })
        state.works[`${which}2`].verification = verification
      }
      state.works[`${which}2`].accept = accepted
      state.works[`${which}2`].machineCheck = evidence.text.slice(-900)
      state.works[`${which}2`].patch = { downloaded: patch.downloaded, bytes: patch.bytes, name: patch.name }
      saveState(state)
      console.log(JSON.stringify({ which: `${which}2`, accepted, patch: state.works[`${which}2`].patch, verification }, null, 1))
    } finally { await browser?.close?.().catch(() => {}) }
  },
  async prepare3() {
    const state = loadState()
    state.package = { ...PKG, verifiedAt: new Date().toISOString() }
    state.env = state.env ?? installTo(join(WORK_ROOT, 'install'))
    const instance = await ensureInstance(state)
    state.status = instance.status
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1000 } })
    try {
      const page = browser.page
      await openConsole(page, state.status)
      const imported = []
      for (const spec of [
        { name: 'tokens-a', path: PREPARED_A3 },
        { name: 'tokens-b', path: PREPARED_B3 },
      ]) {
        const project = { path: spec.path, name: spec.name }
        const check = runProjectCheck(project.path)
        await uiImport(page, project, 'node_test')
        imported.push({ name: project.name, head: run('git', ['-C', project.path, 'rev-parse', 'HEAD']).stdout.trim(),
          passed: check.passed, failed: check.failed, exit: check.exit })
      }
      state.projects3 = Object.fromEntries(imported.map(item => [item.name, { path: item.name === 'tokens-a' ? PREPARED_A3 : PREPARED_B3, name: item.name }]))
      state.prepared3 = { projects: imported, at: new Date().toISOString() }
      saveState(state)
      console.log(JSON.stringify({ prepared3: true, console: state.status.instance.consoleURL, projects: imported }, null, 1))
    } finally { await browser.close().catch(() => {}) }
  },
  async work3(which) {
    const state = loadState()
    if (!state.prepared3) throw new Error('run --prepare3 first')
    const tasks = {
      alpha: { id: 'm03-a-v3', projectName: 'tokens-a', task: 'bug_fix',
        goal: '修复当前项目中 `npm test` 的失败：运行测试定位回归，修改实现使全部测试通过；不要修改或删除任何测试文件。完成后简要说明根因。' },
      beta: { id: 'm03-b-v3', projectName: 'tokens-b', task: 'feature',
        goal: '为当前包增加一个小功能：新增导出函数 resolveTokenValue(document, name)，返回该 token 解析后的 value，未找到时返回 null；新增对应测试覆盖命中与未命中；确保 `npm test` 全部通过，不要修改现有测试断言。' },
    }
    const task = tasks[which]
    if (!task) throw new Error('select exactly one of --work3=alpha|beta')
    const ledger = createTurnLedger(LEDGER)
    const balance = ledger.canReserve()
    if (!balance.ok) throw new Error(`refusing to send: ${balance.reason}`)
    if (state.works?.[`${which}3`]) throw new Error(`work ${which}3 already recorded`)
    const reserved = ledger.reserve(task.id)
    if (!reserved.ok) throw new Error(`reserve failed: ${JSON.stringify(reserved)}`)
    let browser = null
    try {
      const instance = await ensureInstance(state)
      browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1000 } })
      const page = browser.page
      await openConsole(page, instance.status)
      const status = instance.status
      const apiKey = readFileSync(join(status.instance.state, 'api.key'), 'utf8').trim()
      const config = await page.request.get(`${status.instance.apiURL}/v1/configuration`, { headers: { authorization: `Bearer ${apiKey}` } })
      const configuration = await config.json()
      const profileId = configuration.profiles?.find?.(p => /codex/iu.test(String(p.id ?? '')))?.id ?? 'profile-codex-native'
      const created = await uiCreateWork(page, { projectName: task.projectName, profileId, goal: task.goal })
      const workId = created.receipt?.workId ?? created.body?.workId ?? null
      state.works = { ...(state.works ?? {}), [`${which}3`]: { id: task.id, projectName: task.projectName, task: task.task,
        goal: task.goal, workId, createStatus: created.status, receipt: created.receipt, startedAt: new Date().toISOString() } }
      saveState(state)
      if (!workId) {
        ledger.unknown(task.id, 'create_work_receipt_missing')
        throw new Error('create returned no workId; recorded UNKNOWN, refusing any resend')
      }
      // A recorded command is not yet a model turn: only an actual attempt start consumes the budget.
      const attempt = await waitForAttempt(page, task.goal, { timeoutMs: 120_000,
        projectPath: state.projects3?.[task.projectName]?.path })
      if (attempt.started) ledger.sent(task.id, { turnStart: new Date().toISOString() })
      else if (attempt.blocked) {
        ledger.cancel(task.id, `environment_blocked_unsent:${attempt.reason}`)
        throw new Error(`environment preparation blocked before any native turn: ${attempt.reason}`)
      } else {
        ledger.unknown(task.id, `attempt_state_unconfirmed:${attempt.reason}`)
        throw new Error(`attempt state unconfirmed: ${attempt.reason}`)
      }
      state.works[`${which}3`].attempt = attempt
      saveState(state)
      const outcome = await driveToCandidate(page, workId, { goal: task.goal,
        projectPath: state.projects3?.[task.projectName]?.path })
      state.works[`${which}3`].outcome = outcome.reached
      saveState(state)
      console.log(JSON.stringify({ which: `${which}3`, workId, created: { status: created.status, receipt: created.receipt },
        attempt: { started: attempt.started, blocked: attempt.blocked }, outcome: outcome.reached, tail: outcome.log.at(-1) }, null, 1))
    } catch (error) {
      throw error
    } finally { await browser?.close?.().catch(() => {}) }
  },
  async accept3(which) {
    const state = loadState()
    const work = state.works?.[`${which}3`]
    if (!work?.workId) throw new Error(`no work ${which}3`)
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1100 } })
    try {
      const page = browser.page
      const instance = await ensureInstance(state)
      await openConsole(page, instance.status)
      await uiOpenWork(page, work.goal, state.projects3?.[work.projectName]?.path)
      const evidence = await uiCheckEvidence(page)
      if (!/"outcome": "PASS"/u.test(evidence.text)) {
        throw new Error(`machine check is not PASS; refusing acceptance: ${evidence.text.slice(-400)}`)
      }
      const accepted = await uiAccept(page)
      const patch = await uiDownloadPatch(page)
      const project = state.projects3?.[work.projectName]
      let verification = null
      if (patch.downloaded && project) {
        const copy = join(WORK_ROOT, `verify3-${which}`)
        verification = applyPatchToCopy({ baseline: project.path, copy, patchPath: patch.path, gitTop: project.path })
        state.works[`${which}3`].verification = verification
      }
      state.works[`${which}3`].accept = accepted
      state.works[`${which}3`].machineCheck = evidence.text.slice(-900)
      state.works[`${which}3`].patch = { downloaded: patch.downloaded, bytes: patch.bytes, name: patch.name }
      saveState(state)
      console.log(JSON.stringify({ which: `${which}3`, accepted, patch: state.works[`${which}3`].patch, verification }, null, 1))
    } finally { await browser?.close?.().catch(() => {}) }
  },
  async resume3(which) {
    const state = loadState()
    const work = state.works?.[`${which}3`]
    if (!work?.workId) throw new Error(`no work ${which}3`)
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1100 } })
    try {
      const page = browser.page
      const instance = await ensureInstance(state)
      await openConsole(page, instance.status)
      const projectPath = state.projects3?.[work.projectName]?.path
      const outcome = await driveToCandidate(page, work.workId, { goal: work.goal, projectPath })
      state.works[`${which}3`].outcome = outcome.reached
      saveState(state)
      console.log(JSON.stringify({ which: `${which}3`, outcome: outcome.reached, tail: outcome.log.at(-1) }, null, 1))
      if (outcome.reached !== 'candidate') process.exitCode = 1
    } finally { await browser?.close?.().catch(() => {}) }
  },
  async work(which) {
    const state = loadState()
    if (!state.prepared) throw new Error('run --prepare first')
    if (!['alpha', 'beta'].includes(which)) throw new Error('select exactly one of --work=alpha|beta')
    const ledger = createTurnLedger(LEDGER)
    const task = which === 'alpha'
      ? { id: 'm03-project-alpha', projectName: 'merchantops-rpa', task: 'bug_fix' }
      : { id: 'm03-project-beta', projectName: 'agent-workflow', task: 'feature' }
    const balance = ledger.canReserve()
    if (!balance.ok) throw new Error(`refusing to send: ${balance.reason}`)
    const already = state.works?.[which]
    if (already) throw new Error(`work ${which} already recorded: ${JSON.stringify(already)}`)
    const reserved = ledger.reserve(task.id)
    if (!reserved.ok) throw new Error(`reserve failed: ${JSON.stringify(reserved)}`)
    let browser = null
    try {
      const instance = await ensureInstance(state)
      browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1000 } })
      const page = browser.page
      await openConsole(page, instance.status)
      const status = instance.status
      const apiKey = readFileSync(join(status.instance.state, 'api.key'), 'utf8').trim()
      const config = await page.request.get(`${status.instance.apiURL}/v1/configuration`, { headers: { authorization: `Bearer ${apiKey}` } })
      const configuration = await config.json()
      const profileId = configuration.profiles?.find?.(p => /codex/iu.test(String(p.id ?? '')))?.id ?? 'profile-codex-native'
      const goal = which === 'alpha'
        ? '修复当前项目中 `npm test` 的失败：运行测试定位回归，修改实现使全部测试通过；不要修改或删除任何测试文件。完成后简要说明根因。'
        : '为项目增加一个小功能：让 CLI 的 `--version` 输出同时包含 package.json 的版本号与当前 Git 提交的短哈希，并补充对应测试；确保 `npm test` 全部通过。提交前不要改动已有测试的断言。'
      const created = await uiCreateWork(page, { projectName: task.projectName, profileId, goal })
      const workId = created.receipt?.workId ?? created.body?.workId ?? null
      // The turn was written once the command returned a recorded receipt with a Work id.
      if (workId) ledger.sent(task.id, { turnStart: new Date().toISOString() })
      else ledger.unknown(task.id, 'create_work_receipt_missing')
      state.works = { ...(state.works ?? {}), [which]: { id: task.id, projectName: task.projectName, task: task.task, goal,
        workId, createStatus: created.status, receipt: created.receipt, startedAt: new Date().toISOString() } }
      saveState(state)
      const outcome = await driveToCandidate(page, workId, { goal })
      state.works[which].outcome = outcome.reached
      saveState(state)
      console.log(JSON.stringify({ which, workId, created: { status: created.status, receipt: created.receipt },
        outcome: outcome.reached, tail: outcome.log.at(-1) }, null, 1))
    } catch (error) {
      if (!loadState().works?.[which]) ledger.cancel(task.id, `setup_failed:${String(error?.message ?? error).slice(0, 120)}`)
      throw error
    } finally { await browser?.close?.().catch(() => {}) }
  },
  async accept(which) {
    const state = loadState()
    const work = state.works?.[which]
    if (!work?.workId) throw new Error(`no work ${which}`)
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1000 } })
    try {
      const page = browser.page
      const instance = await ensureInstance(state)
      await openConsole(page, instance.status)
      await page.locator('.work-card').filter({ hasText: work.goal ?? '' }).first().click().catch(() => {})
      const accepted = await uiAccept(page)
      const patch = await uiDownloadPatch(page)
      const project = state.projects[work.projectName]
      let verification = null
      if (patch.downloaded && project) {
        const copy = join(WORK_ROOT, `verify-${which}`)
        verification = applyPatchToCopy({ baseline: project.path, copy, patchPath: patch.path, gitTop: project.path })
        state.works[which].verification = verification
        state.works[which].verifyExit = verification.check ? 0 : null
      }
      state.works[which].accept = accepted
      state.works[which].patch = { downloaded: patch.downloaded, bytes: patch.bytes, name: patch.name }
      saveState(state)
      console.log(JSON.stringify({ which, accepted, patch: state.works[which].patch, verification }, null, 1))
    } finally { await browser?.close?.().catch(() => {}) }
  },
}

const argv = process.argv.slice(2)
const flag = name => argv.includes(name)
const value = prefix => argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length)
try {
  if (flag('--prep')) {
    const { runM03Prep } = await import('./cases/m03-prep.mjs')
    const result = await runM03Prep()
    for (const item of result.cases) console.log(item.status, item.id, item.reason ? String(item.reason).slice(0, 160) : '')
    process.exitCode = result.cases.every(item => item.status !== 'FAIL') ? 0 : 1
  } else if (flag('--status')) commands.status()
  else if (value('--correct-unsent=')) {
    const ledger = createTurnLedger(LEDGER)
    const result = ledger.correctUnsent(value('--correct-unsent='), {
      reason: value('--reason=') ?? 'proven_unsent_setup_failure', evidence: value('--evidence=') ?? '',
    })
    console.log(JSON.stringify(result, null, 1))
    if (!result.ok) process.exitCode = 1
  }
  else if (flag('--prepare')) await commands.prepare()
  else if (flag('--prepare2')) await commands.prepare2()
  else if (flag('--prepare3')) await commands.prepare3()
  else if (value('--work=')) await commands.work(value('--work='))
  else if (value('--work2=')) await commands.work2(value('--work2='))
  else if (value('--work3=')) await commands.work3(value('--work3='))
  else if (value('--accept=')) await commands.accept(value('--accept='))
  else if (value('--accept2=')) await commands.accept2(value('--accept2='))
  else if (value('--accept3=')) await commands.accept3(value('--accept3='))
  else if (value('--resume3=')) await commands.resume3(value('--resume3='))
  else if (flag('--reopen')) {
    const state = loadState()
    const instance = await ensureInstance(state)
    const stop = instance.launcherRun(['stop'])
    const restarted = await startInstance(state.env)
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1100 } })
    try {
      const page = browser.page
      await openConsole(page, restarted.status)
      const works = []
      for (const key of ['alpha3', 'beta3']) {
        const work = state.works?.[key]
        if (!work) continue
        const projectPath = state.projects3?.[work.projectName]?.path
        await uiOpenWork(page, work.goal, projectPath)
        const detail = await page.locator('.detail').innerText().catch(() => '')
        works.push({ key, workId: work.workId, projectPath,
          projectVisible: detail.includes(projectPath ?? ''), goalVisible: detail.includes(work.goal.slice(0, 24)),
          delivered: /已交付/u.test(detail), candidate: /当前候选产物/u.test(detail),
          acceptanceRecord: /交付记录/u.test(detail) && /检查证据/u.test(detail),
          acceptanceBody: (detail.match(/交付记录[\s\S]{0,400}/u) ?? [''])[0].slice(0, 400) })
      }
      state.reopen = { stopped: stop.json?.status ?? stop.status, running: restarted.status?.status,
        console: restarted.status?.instance?.consoleURL ?? null, works, at: new Date().toISOString() }
      saveState(state)
      console.log(JSON.stringify(state.reopen, null, 1))
      if (!works.length || works.some(item => !item.projectVisible || !item.goalVisible || !item.delivered))
        process.exitCode = 1
    } finally { await browser?.close?.().catch(() => {}) }
  } else {
    console.log('usage: --prep | --prepare | --prepare2 | --prepare3 | --work2=alpha|beta | --work3=alpha|beta | --accept2=... | --accept3=... | --resume3=... | --reopen | --status')
    process.exitCode = 2
  }
} catch (error) {
  console.error(`m03-e-acceptance failed: ${String(error?.message ?? error).slice(0, 800)}`)
  process.exitCode = 1
}
