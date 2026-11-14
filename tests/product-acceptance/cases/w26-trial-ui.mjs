import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { runCase, notTested, LAYERS } from '../lib/status.mjs'
import { openBrowser, VIEWPORTS } from '../lib/browser.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact, packagedFile } from '../lib/frozen-package.mjs'

/**
 * Wave-26 installed trial workbench.
 *
 * The packaged console bytes are served by the packaged static server and proxy, and the browser
 * drives the same navigation callbacks the product exposes. Selector names are user-visible labels
 * cross-checked against the packaged bundle; the screenshot is taken from these exact bytes.
 */
const sha = value => createHash('sha256').update(value).digest('hex')
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w26ui] ${message}\n`) }
const SHOTS = resolve('tests/product-acceptance/reports/wave26/browser')

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
  return { status: result.status, json: parseJson(result.stdout), stderr: String(result.stderr).slice(-500) }
}

function startPackage(install, { state, config, mockFile, consolePort, apiPort, timeoutMs = 90_000 }) {
  const record = join(config, 'instance.json')
  if (existsSync(record)) {
    let value
    try { value = JSON.parse(readFileSync(record, 'utf8')) } catch { rmSync(record, { force: true }) }
    if (value && (!Number.isSafeInteger(value.pid) || (() => { try { process.kill(value.pid, 0); return false } catch { return true } })()))
      rmSync(record, { force: true })
  }
  const child = spawn(join(install, 'bin/pa'), ['start', '--json', '--discussion-only', '--port', String(consolePort), '--api-port', String(apiPort)], {
    cwd: join(install, '..'), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PA_NODE: process.execPath, ...(mockFile ? { PA_MODEL_CONFIG: mockFile } : {}), PA_CONFIG_ROOT: config, PA_DATA_ROOT: state },
  })
  child.stdout.on('data', () => {})
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk })
  let buffer = ''
  const value = new Promise(resolvePromise => {
    const timer = setTimeout(() => resolvePromise({ status: 'TIMEOUT' }), timeoutMs)
    child.stdout.on('data', chunk => {
      buffer += chunk
      const text = buffer.trim()
      if (!text.endsWith('}')) return
      try { const json = JSON.parse(text); clearTimeout(timer); resolvePromise({ ...json, stderr: stderr.slice(-800) }) } catch { /* buffering */ }
    })
    child.once('exit', code => { clearTimeout(timer); resolvePromise({ status: 'EXITED', code, stderr: stderr.slice(-800) }) })
  })
  return { child, value }
}

async function stopOwned(install, { state, config, mockFile }) {
  launcher(install, ['stop', '--json'], { env: { ...(mockFile ? { PA_MODEL_CONFIG: mockFile } : {}), PA_CONFIG_ROOT: config, PA_DATA_ROOT: state } })
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
  await new Promise(resolvePromise => setTimeout(resolvePromise, 500))
  for (const pid of owned) if (alive(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
  rmSync(recordPath, { force: true })
}

const navButtons = ['主对话视图', '试用准备']
async function navOverlap(page) {
  const boxes = await page.evaluate(names => names.map(name => {
    const element = [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === name || item.textContent?.trim() === name)
    if (!element) return { name, present: false }
    const rect = element.getBoundingClientRect()
    return { name, present: true, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }), navButtons)
  const overlaps = []
  for (let i = 0; i < boxes.length; i += 1)
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i], b = boxes[j]
      if (!a.present || !b.present) continue
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) overlaps.push(`${a.name}/${b.name}`)
    }
  return { boxes, overlaps }
}

export async function runTrialUi() {
  const cases = []
  const target = loadFrozenArtifact('target', DEFAULT_FROZEN_DIRS.target)
  const bundleMarker = (() => {
    const listing = spawnSync('tar', ['-tzf', target.tarPath], { encoding: 'utf8', timeout: 60_000 })
    for (const entry of String(listing.stdout).split('\n').filter(line => /apps\/console\/dist\/assets\/index-.*\.js$/u.test(line))) {
      const text = packagedFile(target, entry)
      if (typeof text === 'string' && text.includes('试用准备')) {
        const bytes = Buffer.from(text)
        return { entry, sha256: sha(bytes), bytes: bytes.byteLength }
      }
    }
    return null
  })()
  let observed, failure
  try {
    const own = realpathSync(mkdtempSync(join(tmpdir(), 'pa-w26-ui-')))
    const install = join(own, 'install'), config = join(own, 'config'), state = join(own, 'state')
    mkdirSync(install, { recursive: true })
    const bytes = readFileSync(target.tarPath)
    if (sha(bytes) !== target.tarSha256 || bytes.byteLength !== target.tarBytes) throw new Error('frozen tar identity mismatch')
    const extracted = spawnSync('tar', ['-xzf', target.tarPath, '-C', install, '--strip-components=1'])
    if (extracted.status !== 0) throw new Error('tar extract failed')
    const modelPath = join(own, 'model', 'absent.json')
    const first = launcher(install, ['first-run', '--json'], { env: { PA_CONFIG_ROOT: config, PA_DATA_ROOT: state, PA_MODEL_CONFIG: modelPath } })
    if (first.status !== 0) throw new Error(`first-run ${first.status}: ${first.stderr}`)
    const consolePort = await freePort(), apiPort = await freePort()
    const started = startPackage(install, { state, config, mockFile: modelPath, consolePort, apiPort })
    const value = await started.value
    mark(`start ${value.status}`)
    if (value.status !== 'RUNNING' || !value.instance?.consoleURL) throw new Error(`start ${value.status}/${value.code ?? 'none'}: ${value.stderr ?? ''}`)
    observed = { own, install, config, state, modelPath, value, started, target, consoleURL: value.instance.consoleURL }
  } catch (error) { failure = String(error?.message ?? error).slice(0, 500) }

  const ui = { subject: frozenArtifactSubject(target), mode: null, selector: null, bundle: null, actions: {}, negatives: {},
    layout: {}, screenshots: [], problems: [], readinessReads: 0, writes: 0, providerBefore: 0, providerAfter: 0 }
  cases.push(await runCase({ id: 'E3-TRIAL-WORKBENCH-UI', title: 'The packaged console exposes the trial preparation navigation, reads readiness only on demand and keeps the four original callbacks and the original draft',
    layer: LAYERS.INSTALLED, evidence: { trialUi: ui }, limitations: [
      'Loopback packaged console and proxy; the browser driver is the repository Playwright 1.65.0, while every served UI/API byte belongs to the frozen package.',
      'Only the normal personal surface is driven here; the readonly/fixture readiness facts are asserted over HTTP in E7-READINESS.',
    ] }, async ({ assert, evidence }) => {
    assert('UI_PROVISIONED', observed !== undefined, failure ?? 'no observation')
    if (!observed) return
    ui.bundle = bundleMarker ? { entry: bundleMarker.entry, sha256: bundleMarker.sha256, bytes: bundleMarker.bytes } : null
    const browser = await openBrowser({ root: resolve('.') })
    const { page, problems } = browser
    page.setDefaultTimeout(12_000)
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path === '/v1/readiness') ui.readinessReads += 1
      if (path.startsWith('/v1/') && request.method() === 'POST') ui.writes += 1
    })
    const trial = page.getByRole('region', { name: '试用准备', exact: true })
    const openTrial = async () => {
      await page.getByRole('button', { name: '试用准备', exact: true }).click()
      await trial.waitFor()
      await trial.getByText('个人模式', { exact: true }).waitFor()
    }
    try {
      await page.goto(observed.consoleURL, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
      ui.selector = { navigations: navButtons, trialRegion: '试用准备', draft: '.composer textarea' }
      assert('UI_DEFAULT_CONVERSATION', await page.getByRole('button', { name: '主对话视图', exact: true }).getAttribute('aria-current') === 'page', 'default view is not the conversation')
      assert('UI_NO_EAGER_READINESS', ui.readinessReads === 0, String(ui.readinessReads))
      ui.providerBefore = 0
      await openTrial()
      ui.mode = 'personal'
      assert('UI_TRIAL_REACHABLE', await page.getByRole('button', { name: '试用准备', exact: true }).getAttribute('aria-current') === 'page', 'trial navigation is not current')
      assert('UI_READINESS_ON_DEMAND', ui.readinessReads === 1, String(ui.readinessReads))
      const step = async (name, action) => { try { return await action() } catch (error) { ui.actions[`${name}Error`] = String(error?.message ?? error).slice(0, 300); throw error } }
      ui.actions.model = await step('model', async () => {
        await trial.getByRole('button', { name: '配置对话模型', exact: true }).click()
        await page.getByRole('region', { name: '模型设置', exact: true }).waitFor()
        await page.getByRole('button', { name: '关闭模型设置', exact: true }).click()
        return 'opened-settings'
      })
      ui.actions.import = await step('import', async () => {
        await trial.getByRole('button', { name: '导入项目', exact: true }).click()
        const form = page.getByRole('form', { name: '导入本地项目', exact: true })
        await form.waitFor()
        await form.getByRole('button', { name: '取消导入', exact: true }).click()
        await form.waitFor({ state: 'hidden' })
        await openTrial()
        return 'opened-import-form'
      })
      ui.actions.executor = await step('executor', async () => {
        await trial.getByRole('button', { name: '检查执行器', exact: true }).click()
        await page.getByRole('heading', { name: '执行器连接', exact: true }).waitFor()
        await page.getByRole('button', { name: '主对话视图', exact: true }).click()
        return 'opened-executor'
      })
      ui.actions.phaseOneRendered = ['configure_model', 'import_project', 'inspect_executor']
      assert('UI_THREE_CALLBACKS_UNCONFIGURED', ui.actions.model === 'opened-settings' && ui.actions.import === 'opened-import-form' &&
        ui.actions.executor === 'opened-executor', JSON.stringify(ui.actions))
      assert('UI_NO_WRITES', ui.writes === 0, String(ui.writes))
      await openTrial()
      let readinessFault = null
      await page.route('**/v1/readiness', async route => {
        if (readinessFault === 'abort') return route.abort()
        if (readinessFault === 'granted') {
          const response = await route.fetch()
          const body = await response.json()
          body.authorization = 'granted'
          return route.fulfill({ response, json: body })
        }
        if (readinessFault === 'missing') return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid_request' } }) })
        return route.continue()
      })
      readinessFault = 'abort'
      await trial.getByRole('button', { name: '重新读取试用状态', exact: true }).click()
      await trial.getByRole('alert').waitFor()
      ui.negatives.abort = { preservesPrior: /上次读取结果/u.test(await trial.textContent()) && /个人模式/u.test(await trial.textContent()) }
      readinessFault = 'granted'
      await trial.getByRole('button', { name: '重试', exact: true }).click()
      await trial.getByRole('alert').waitFor()
      const text = await trial.textContent()
      ui.negatives.badSchema = { alertShown: true, leaksGranted: /granted/u.test(text), keepsPersonal: /个人模式/u.test(text) }
      assert('UI_BAD_SCHEMA_REFUSED', ui.negatives.badSchema.alertShown && ui.negatives.badSchema.leaksGranted === false && ui.negatives.badSchema.keepsPersonal === true,
        JSON.stringify(ui.negatives.badSchema))
      readinessFault = null
      await trial.getByRole('button', { name: '重试', exact: true }).click()
      await trial.getByRole('alert').waitFor({ state: 'hidden' })
      readinessFault = 'missing'
      await trial.getByRole('button', { name: '重新读取试用状态', exact: true }).click()
      const legacy = trial.getByRole('status').filter({ hasText: '当前服务未提供试用状态接口' })
      await legacy.waitFor()
      ui.negatives.legacy = { absentInterfaceStated: true }
      assert('UI_LEGACY_ABSENCE', ui.negatives.legacy.absentInterfaceStated === true, JSON.stringify(ui.negatives.legacy))
      readinessFault = null
      await trial.getByRole('button', { name: '重新读取试用状态', exact: true }).click()
      await trial.getByText('个人模式', { exact: true }).waitFor()
      assert('UI_ABORT_PRESERVES', ui.negatives.abort.preservesPrior === true, JSON.stringify(ui.negatives.abort))
      await page.unroute('**/v1/readiness').catch(() => {})

      mkdirSync(SHOTS, { recursive: true })
      await openTrial()
      const desktop = join(SHOTS, 'desktop.png')
      await page.screenshot({ path: desktop, fullPage: true })
      ui.layout.desktop = { viewport: VIEWPORTS.desktop, ...(await navOverlap(page)),
        overflow: await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })) }
      assert('UI_DESKTOP_LAYOUT', ui.layout.desktop.overlaps.length === 0 && ui.layout.desktop.overflow.scrollWidth <= ui.layout.desktop.overflow.innerWidth + 1,
        JSON.stringify(ui.layout.desktop))
      await browser.resize(VIEWPORTS.mobile)
      await openTrial().catch(() => {})
      const mobile = join(SHOTS, 'mobile.png')
      await page.screenshot({ path: mobile, fullPage: true })
      ui.layout.mobile = { viewport: VIEWPORTS.mobile, ...(await navOverlap(page)),
        overflow: await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth })) }
      assert('UI_MOBILE_LAYOUT', ui.layout.mobile.overlaps.length === 0 && ui.layout.mobile.overflow.scrollWidth <= ui.layout.mobile.overflow.innerWidth + 1,
        JSON.stringify(ui.layout.mobile))
      for (const path of [desktop, mobile]) {
        const bytes = readFileSync(path)
        ui.screenshots.push({ path: path.replace(`${resolve('.')}/`, ''), sha256: sha(bytes), bytes: bytes.byteLength, size: statSync(path).size })
      }
      await browser.resize(VIEWPORTS.desktop)

      mkdirSync(SHOTS, { recursive: true })
      ui.configuredMode = { actions: {} }
      // The packaged action row renders at most three entries: with an unconfigured model only
      // configure/import/executor are visible, so the conversation callback is driven in the
      // configured state on a second packaged instance over the same probe-owned state.
      await stopOwned(observed.install, { state: observed.state, config: observed.config, mockFile: observed.modelPath })
      const mock = await candidateModel()
      const secondPorts = [await freePort(), await freePort()]
      const configuredStart = startPackage(observed.install, { state: observed.state, config: observed.config,
        mockFile: mock.file, consolePort: secondPorts[0], apiPort: secondPorts[1] })
      let configured
      try { configured = await configuredStart.value } catch (error) { ui.configuredMode.error = String(error?.message ?? error).slice(0, 300) }
      ui.configuredMode.status = configured?.status ?? 'NO_START'
      ui.configuredMode.mode = configured?.instance?.mode ?? null
      if (configured?.status === 'RUNNING' && configured.instance?.consoleURL) {
        await page.goto(configured.instance.consoleURL, { waitUntil: 'domcontentloaded' })
        await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
        await page.locator('.composer textarea').fill('尚未发送的原始草稿')
        await openTrial()
        ui.configuredMode.actions.configureVisible = await trial.getByRole('button', { name: '配置对话模型', exact: true }).count()
        ui.configuredMode.actions.openConversationVisible = await trial.getByRole('button', { name: '打开主对话', exact: true }).count()
        await trial.getByRole('button', { name: '打开主对话', exact: true }).click()
        const draft = await page.locator('.composer textarea').inputValue()
        ui.actions.conversation = draft === '尚未发送的原始草稿' ? 'opened-conversation-draft-kept' : `draft:${draft}`
        ui.configuredMode.actions.draft = draft
        const shot = join(SHOTS, 'configured-conversation.png')
        await page.screenshot({ path: shot })
        const bytes = readFileSync(shot)
        ui.screenshots.push({ path: shot.replace(`${resolve('.')}/`, ''), sha256: sha(bytes), bytes: bytes.byteLength, size: bytes.byteLength })
      }
      ui.providerAfter = mock.requests.length
      await stopOwned(observed.install, { state: observed.state, config: observed.config, mockFile: mock.file })
      await mock.close().catch(() => {})
      assert('UI_FOUR_CALLBACKS', ['model', 'import', 'executor', 'conversation'].every(key => String(ui.actions[key] ?? '').startsWith('opened')),
        JSON.stringify(ui.actions))
      assert('UI_DRAFT_KEPT', ui.actions.conversation === 'opened-conversation-draft-kept', JSON.stringify(ui.actions))
      assert('UI_CONDITIONAL_ACTIONS', ui.configuredMode.actions.configureVisible === 0 && ui.configuredMode.actions.openConversationVisible === 1,
        JSON.stringify(ui.configuredMode.actions))
      assert('UI_NO_MODEL', ui.providerAfter === ui.providerBefore, JSON.stringify({ before: ui.providerBefore, after: ui.providerAfter }))

      ui.problems = [...problems].slice(0, 10)
      const pageErrors = ui.problems.filter(item => !/Failed to load resource/u.test(item))
      ui.pageErrors = pageErrors
      ui.problems.filtered = { total: ui.problems.length, injectedResourceFailures: ui.problems.length - pageErrors.length }
      assert('UI_NO_PAGE_ERRORS', pageErrors.length === 0, JSON.stringify(pageErrors))
      assert('UI_BUNDLE_FROM_TARGET', ui.bundle !== null && /^[a-f0-9]{64}$/u.test(ui.bundle.sha256) && ui.bundle.bytes > 0,
        JSON.stringify(ui.bundle))
    } catch (error) {
      ui.caseError = String(error?.message ?? error).slice(0, 500)
      throw error
    } finally {
      try { await browser.close() } catch { /* gone */ }
      await stopOwned(observed.install, { state: observed.state, config: observed.config, mockFile: observed.modelPath })
      if (!process.env.PA_E_KEEP) { try { rmSync(observed.own, { recursive: true, force: true }) } catch { /* best effort */ } }
    }
  }))

  return { cases, artifacts: {} }
}
