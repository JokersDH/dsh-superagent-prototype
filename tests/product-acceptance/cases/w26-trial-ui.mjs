import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { openBrowser, VIEWPORTS } from '../lib/browser.mjs'
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
import { DEFAULT_FROZEN_DIRS, frozenArtifactSubject, loadFrozenArtifact, packagedFile } from '../lib/frozen-package.mjs'
import {
  extractFrozen, freePort, launcher, liveIdentity, privateRoot, releaseRoot, retainMaterial, sha256, startOwned,
  stopOwned,
} from '../lib/packaged-instance.mjs'

/**
 * Wave-27 installed trial workbench on exact packaged bytes.
 *
 * The packaged console is served by the packaged static server and proxy; Playwright drives the same
 * navigation callbacks the product exposes. Lifecycle is owned by `lib/packaged-instance.mjs`: the
 * packaged `pa stop` runs first, and a refusal or timeout retains the private root instead of
 * force-killing by path similarity or deleting the record. Screenshots come from these exact bytes.
 */
const mark = message => { if (process.env.PA_E_TRACE) process.stderr.write(`[w27ui] ${message}\n`) }
const SHOTS = resolve('tests/product-acceptance/reports/wave27/browser')

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
    for (const entry of packagedAssetEntries(target)) {
      const text = packagedFile(target, entry)
      if (typeof text === 'string' && text.includes('试用准备')) {
        const bytes = Buffer.from(text)
        return { entry, sha256: sha256(bytes), bytes: bytes.byteLength }
      }
    }
    return null
  })()
  const ui = { subject: frozenArtifactSubject(target), mode: null, selector: null, bundle: bundleMarker,
    actions: {}, negatives: {}, layout: {}, screenshots: [], problems: [], readinessReads: 0, writes: 0,
    providerBefore: 0, providerAfter: 0, lifecycle: { stages: [] } }

  cases.push(await runCase({ id: 'E3-TRIAL-WORKBENCH-UI', title: 'The packaged console exposes the trial preparation navigation, reads readiness only on demand and keeps the four original callbacks and the original draft',
    layer: LAYERS.INSTALLED, evidence: { trialUi: ui }, limitations: [
      'Loopback packaged console and proxy; the browser driver is the repository Playwright 1.65.0, while every served UI/API byte belongs to the frozen package.',
      'Only the normal personal surface is driven here; the readonly/fixture readiness facts are asserted over HTTP in E7-READINESS.',
      'Cleanup prefers the packaged `pa stop`; a refusal or timeout retains the private root and is reported, never force-killed by path similarity.',
    ] }, async ({ assert, evidence }) => {
    const root = privateRoot('pa-e-w27-ui-')
    const modelPath = join(root.own, 'model', 'absent.json')
    ui.lifecycle.root = root.own
    let browser, stopped, released, unknown
    try {
      ui.bundle = bundleMarker
      assert('UI_FROZEN_BYTES', bundleMarker !== null && /^[a-f0-9]{64}$/u.test(bundleMarker.sha256), JSON.stringify(bundleMarker))
      extractFrozen(target, root.install)
      const first = launcher(root.install, ['first-run', '--json'], {
        env: { PA_CONFIG_ROOT: root.config, PA_DATA_ROOT: root.state, PA_MODEL_CONFIG: modelPath } })
      assert('UI_FIRST_RUN', first.status === 0, JSON.stringify(first).slice(0, 400))

      // Phase A: unconfigured personal instance. The packaged action row renders at most three
      // entries, so configure/import/executor are driven here and the conversation callback in B.
      const portsA = [await freePort(), await freePort()]
      const startedA = startOwned(root, { ports: portsA, mockFile: modelPath, timeoutMs: 90_000 })
      const valueA = await startedA.value
      ui.lifecycle.startA = { status: valueA.status, code: valueA.code ?? null, birth: startedA.birth,
        instance: valueA.instance ? { mode: valueA.instance.mode ?? null, processStart: valueA.instance.processStart ?? null } : null }
      mark(`phase A start ${valueA.status}`)
      assert('UI_PHASE_A_RUNNING', valueA.status === 'RUNNING' && !!valueA.instance?.consoleURL,
        `${valueA.status}/${valueA.code ?? 'none'}: ${valueA.stderr ?? ''}`)

      browser = await openBrowser({ root: resolve('.') })
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
      await page.goto(valueA.instance.consoleURL, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
      ui.selector = { navigations: navButtons, trialRegion: '试用准备', draft: '.composer textarea' }
      assert('UI_DEFAULT_CONVERSATION', await page.getByRole('button', { name: '主对话视图', exact: true }).getAttribute('aria-current') === 'page', 'default view is not the conversation')
      assert('UI_NO_EAGER_READINESS', ui.readinessReads === 0, String(ui.readinessReads))
      await openTrial()
      ui.mode = 'personal'
      assert('UI_TRIAL_REACHABLE', await page.getByRole('button', { name: '试用准备', exact: true }).getAttribute('aria-current') === 'page', 'trial navigation is not current')
      assert('UI_READINESS_ON_DEMAND', ui.readinessReads === 1, String(ui.readinessReads))
      const step = async (name, action) => {
        try { return await action() } catch (error) { ui.actions[`${name}Error`] = String(error?.message ?? error).slice(0, 300); throw error }
      }
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
      await trial.getByRole('status').filter({ hasText: '当前服务未提供试用状态接口' }).waitFor()
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
        ui.screenshots.push({ path: path.replace(`${resolve('.')}/`, ''), sha256: sha256(bytes), bytes: bytes.byteLength, size: statSync(path).size })
      }
      await browser.resize(VIEWPORTS.desktop)

      // Phase B: configured personal instance over the same probe-owned data root. The packaged stop
      // must report a clean result before the second start; otherwise the root is retained as unknown.
      stopped = await stopOwned(root, { mockFile: modelPath, birth: startedA.birth, equivalentProof: true })
      ui.lifecycle.stageAStop = { clean: stopped.clean, reason: stopped.reason ?? null,
        package: stopped.packageStop?.json?.status ?? null, refusal: stopped.packageRefusal ?? null,
        recordRemoved: stopped.recordRemoved ?? null, signals: stopped.signals }
      assert('UI_STAGE_A_STOPPED', stopped.clean === true, JSON.stringify({ reason: stopped.reason, package: stopped.packageStop?.json ?? null }))

      const mock = await candidateModel()
      const portsB = [await freePort(), await freePort()]
      const startedB = startOwned(root, { ports: portsB, mockFile: mock.file, timeoutMs: 90_000 })
      const valueB = await startedB.value
      ui.lifecycle.startB = { status: valueB.status, code: valueB.code ?? null, birth: startedB.birth,
        instance: valueB.instance ? { mode: valueB.instance.mode ?? null, processStart: valueB.instance.processStart ?? null } : null }
      ui.configuredMode = { actions: {}, status: valueB.status, mode: valueB.instance?.mode ?? null }
      mark(`phase B start ${valueB.status}`)
      assert('UI_PHASE_B_RUNNING', valueB.status === 'RUNNING' && !!valueB.instance?.consoleURL,
        `${valueB.status}/${valueB.code ?? 'none'}: ${valueB.stderr ?? ''}`)
      await page.goto(valueB.instance.consoleURL, { waitUntil: 'domcontentloaded' })
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
      const shotBytes = readFileSync(shot)
      ui.screenshots.push({ path: shot.replace(`${resolve('.')}/`, ''), sha256: sha256(shotBytes), bytes: shotBytes.byteLength, size: shotBytes.byteLength })
      ui.providerAfter = mock.requests.length
      const stopB = await stopOwned(root, { mockFile: mock.file, birth: startedB.birth, equivalentProof: true })
      ui.lifecycle.stageBStop = { clean: stopB.clean, reason: stopB.reason ?? null,
        package: stopB.packageStop?.json?.status ?? null, refusal: stopB.packageRefusal ?? null,
        recordRemoved: stopB.recordRemoved ?? null, signals: stopB.signals }
      await mock.close().catch(() => {})
      assert('UI_STAGE_B_STOPPED', stopB.clean === true, JSON.stringify({ reason: stopB.reason, package: stopB.packageStop?.json ?? null }))
      assert('UI_FOUR_CALLBACKS', ['model', 'import', 'executor', 'conversation'].every(key => String(ui.actions[key] ?? '').startsWith('opened')),
        JSON.stringify(ui.actions))
      assert('UI_DRAFT_KEPT', ui.actions.conversation === 'opened-conversation-draft-kept', JSON.stringify(ui.actions))
      assert('UI_CONDITIONAL_ACTIONS', ui.configuredMode.actions.configureVisible === 0 && ui.configuredMode.actions.openConversationVisible === 1,
        JSON.stringify(ui.configuredMode.actions))
      assert('UI_NO_MODEL', ui.providerAfter === ui.providerBefore, JSON.stringify({ before: ui.providerBefore, after: ui.providerAfter }))

      ui.problems = [...problems].slice(0, 20)
      const pageErrors = ui.problems.filter(item => !/Failed to load resource/u.test(item))
      ui.pageErrors = pageErrors
      ui.problems.filtered = { total: ui.problems.length, injectedResourceFailures: ui.problems.length - pageErrors.length }
      assert('UI_NO_PAGE_ERRORS', pageErrors.length === 0, JSON.stringify(pageErrors))
      released = releaseRoot(root, stopB)
    } catch (error) {
      ui.caseError = String(error?.message ?? error).slice(0, 600)
      if (!stopped) {
        const salvage = await stopOwned(root, { mockFile: modelPath }).catch(cause => ({ clean: false, reason: String(cause?.message ?? cause) }))
        ui.lifecycle.failureStop = { clean: salvage.clean ?? false, reason: salvage.reason ?? null,
          package: salvage.packageStop?.json?.status ?? null, signals: salvage.signals ?? [] }
        unknown = salvage.clean === true ? null : salvage.reason ?? 'unknown'
      } else if (stopped.clean !== true) unknown = stopped.reason ?? 'unknown'
      throw error
    } finally {
      if (browser) { try { await browser.close() } catch { /* gone */ } }
      if (unknown) {
        const retained = retainMaterial(root, unknown)
        ui.lifecycle.retained = { reason: retained.reason, root: retained.root, record: retained.record, at: retained.retainedAt }
      } else if (!released) {
        released = releaseRoot(root, { clean: true })
      }
      ui.lifecycle.released = released ?? null
      ui.lifecycle.unknown = unknown ?? null
    }
  }))

  return { cases, artifacts: {} }
}

/** Packaged console asset entries, read from the frozen tar (never from a checkout). */
function packagedAssetEntries(target) {
  const listing = spawnSync('tar', ['-tzf', target.tarPath], { encoding: 'utf8', timeout: 60_000 })
  return String(listing.stdout).split('\n').filter(line => /apps\/console\/dist\/assets\/index-.*\.js$/u.test(line))
}
