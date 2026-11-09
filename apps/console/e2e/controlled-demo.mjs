/**
 * Browser acceptance against the configuration-driven controlled product API.
 *
 * Covers: configuration-driven create form, question/answer, machine PASS/FAIL, delivery manifest
 * and output download, acceptance, stop, revision, stale question/candidate rejection, refresh,
 * SSE reconnect, configuration failure/unscheduled executor, narrow layout and keyboard focus.
 * No vendor model is involved; the controlled profiles only perform a fixed scratch write.
 *
 * Env: CONSOLE_PRODUCT_URL (default http://127.0.0.1:5174/), PRODUCT_DEMO_STATE (/tmp/pa-product-demo).
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.env.CONSOLE_PRODUCT_URL ?? 'http://127.0.0.1:5174/'
const state = process.env.PRODUCT_DEMO_STATE ?? '/tmp/pa-product-demo'
const screenshots = join(here, 'screenshots')
mkdirSync(screenshots, { recursive: true })

const results = []
const failures = []
const step = async (id, action, detail) => {
  const started = Date.now()
  try {
    await action()
    results.push({ id, status: 'PASS', ms: Date.now() - started, detail })
  } catch (error) {
    results.push({ id, status: 'FAIL', ms: Date.now() - started, detail: `${detail ?? ''} ${String(error?.message ?? error)}`.trim() })
    failures.push(id)
  }
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const token = readFileSync(join(state, 'bootstrap.key'), 'utf8')

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
const errors = []
const bootstrapPage = async page => {
  await page.locator('#bootstrap-token').fill(token)
  await page.getByRole('button', { name: '建立本地会话' }).click()
  await page.waitForSelector('.layout')
}
const openCreate = async page => {
  await page.getByRole('button', { name: '新建委托' }).click()
  await page.waitForSelector('.new-work')
}
const createWork = async (page, goal, profileId) => {
  await openCreate(page)
  const form = page.locator('.new-work')
  await form.locator('textarea').fill(goal)
  await form.locator('select').nth(1).selectOption(profileId)
  await form.getByRole('button', { name: '创建委托' }).click()
  await page.waitForFunction(text => [...document.querySelectorAll('.work-card')].some(card => card.textContent?.includes(text)), goal)
}
const selectWork = async (page, goal) => {
  await page.locator('.work-card').filter({ hasText: goal }).click()
  await page.waitForSelector('.detail')
}
const waitPhase = async (page, label, timeout = 30_000) =>
  page.waitForFunction(value => document.querySelector('.detail .phase')?.textContent === value, label, { timeout })

const page = await context.newPage()
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
let watchErrors = false
page.on('console', message => { if (watchErrors && message.type() === 'error') errors.push(`console: ${message.text()}`) })

try {
  await page.goto(base, { waitUntil: 'networkidle' })

  await step('CONFIG-DRIVEN-FORM', async () => {
    await page.waitForSelector('.session-gate')
    await bootstrapPage(page)
    assert((await page.locator('.badge.status-live').textContent())?.includes('实时连接'), 'SSE is live')
    await openCreate(page)
    const form = page.locator('.new-work')
    assert(await form.locator('select').first().inputValue() === 'project-atlas', 'project initialized from configuration')
    const profiles = await form.locator('select').nth(1).locator('option').allTextContents()
    assert(profiles.length === 4 && profiles.join('|').includes('Controlled Fixture: question'), `configured profiles are offered: ${profiles.join(',')}`)
    assert(await form.locator('select').nth(1).inputValue() === 'profile-fixture-question', 'default profile comes from configuration')
    assert((await form.innerText()).includes('src/'), 'scope comes from configuration')
    assert((await form.innerText()).includes('Output matches the registered check'), 'default criteria come from configuration')
    await form.locator('textarea').fill('Produce a reviewed scratch artifact via console')
    await page.screenshot({ path: join(screenshots, 'controlled-config-form.png') })
    await form.getByRole('button', { name: '创建委托' }).click()
    await page.waitForSelector('.work-card')
    await page.waitForSelector('.question-card', { timeout: 30_000 })
    assert((await page.locator('.question-card').innerText()).includes('Allow the controlled fixture'), 'real native question reached the browser')
    await page.screenshot({ path: join(screenshots, 'controlled-form-question.png') })
    watchErrors = true
  }, 'create form is initialized from /v1/configuration and creates a real work')

  await step('ANSWER-VERIFY-ARTIFACTS', async () => {
    await page.locator('.question-card').first().getByRole('button', { name: 'Allow once' }).click()
    await page.waitForSelector('.question-card', { state: 'detached', timeout: 30_000 })
    await page.waitForSelector('.verification .outcome-PASS', { timeout: 30_000 })
    await page.waitForFunction(() => [...document.querySelectorAll('.actions button')].some(button => button.textContent === '接受当前候选'), null, { timeout: 30_000 })
    assert(await page.locator('.artifacts li').count() === 4, 'four delivery artifacts')
    await page.screenshot({ path: join(screenshots, 'controlled-verified.png') })
  }, 'answer, registered check and trusted PASS candidate')

  await step('ARTIFACT-PREVIEW-AND-DOWNLOAD', async () => {
    await page.locator('.artifacts li').first().getByRole('button', { name: '查看' }).click()
    await page.waitForSelector('.artifact-text')
    const manifest = await page.locator('.artifact-text').innerText()
    assert(manifest.includes('"kind": "controlled-product-artifact/1"') && manifest.includes('"attemptId"'), 'delivery manifest is readable and attempt-bound')
    await page.locator('.artifact-preview').getByRole('button', { name: '关闭预览' }).click()
    await page.locator('.artifacts li').nth(2).getByRole('button', { name: '查看' }).click()
    await page.waitForSelector('.artifact-text')
    assert((await page.locator('.artifact-text').innerText()).includes('approved product output'), 'fixed output bytes are readable')
    const links = await page.locator('.artifacts a[href^="/v1/artifacts/"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')))
    assert(links.length === 4, 'each artifact has an approved download link')
    const download = await context.request.get(new URL(links[2], base).href)
    assert(download.status() === 200, `artifact download status ${download.status()}`)
    assert((await download.text()).includes('approved product output'), 'download returns the published output')
  }, 'manifest/output preview and authenticated artifact download')

  await step('ACCEPT-DELIVERED-RELOAD', async () => {
    await page.getByRole('button', { name: '接受当前候选' }).click()
    await waitPhase(page, '已交付')
    assert(await page.locator('.artifacts li').count() === 4, 'artifacts remain after acceptance')
    await page.screenshot({ path: join(screenshots, 'controlled-delivered.png') })
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.work-card')
    await page.locator('.work-card').filter({ hasText: 'Produce a reviewed scratch artifact via console' }).click()
    await waitPhase(page, '已交付')
    assert(await page.locator('.artifacts li').count() === 4, 'artifacts survive reload')
    await page.screenshot({ path: join(screenshots, 'controlled-after-reload.png') })
  }, 'acceptance delivers and reload keeps work plus artifacts')

  await step('FAIL-PROFILE', async () => {
    await createWork(page, 'Fail profile must not deliver', 'profile-fixture-fail')
    await selectWork(page, 'Fail profile must not deliver')
    await page.waitForSelector('.verification .outcome-FAIL', { timeout: 30_000 })
    assert(await page.getByRole('button', { name: '接受当前候选' }).count() === 0, 'no acceptance for a failed check')
    assert(!(await page.locator('.detail .phase').textContent())?.includes('已交付'), 'failed profile is not delivered')
    await page.screenshot({ path: join(screenshots, 'controlled-fail.png') })
  }, 'machine FAIL offers no acceptance')

  await step('REVISE-AND-STALE-CANDIDATE', async () => {
    await createWork(page, 'Candidate to revise', 'profile-fixture-pass')
    await selectWork(page, 'Candidate to revise')
    await page.waitForSelector('.verification .outcome-PASS', { timeout: 30_000 })
    // Freeze this page's live view while another session revises the contract.
    await page.route('**/v1/events*', route => route.abort())
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.work-card')
    await selectWork(page, 'Candidate to revise')
    const other = await context.newPage()
    await other.goto(base, { waitUntil: 'networkidle' })
    await other.waitForSelector('.layout')
    await selectWork(other, 'Candidate to revise')
    await other.getByRole('button', { name: '修订合同' }).click()
    await other.locator('.revise-form textarea').fill('Revised goal after candidate')
    await other.getByRole('button', { name: '提交修订' }).click()
    await other.waitForFunction(() => document.querySelector('.detail .context-line')?.textContent?.includes('@2'), null, { timeout: 30_000 })
    await other.close()
    // The stale page still shows the previous candidate; the backend must reject acceptance.
    await page.getByRole('button', { name: '接受当前候选' }).click()
    await page.waitForSelector('.error-panel')
    const error = await page.locator('.error-panel').innerText()
    assert(error.includes('候选') || error.includes('stale'), `stale candidate error: ${error}`)
    assert(!(await page.locator('.detail .phase').textContent())?.includes('已交付'), 'stale candidate is not delivered')
    await page.screenshot({ path: join(screenshots, 'controlled-stale-candidate.png') })
    await page.unroute('**/v1/events*')
    await page.locator('.error-panel').getByRole('button', { name: '关闭' }).click()
    await page.locator('.topbar').getByRole('button', { name: '刷新快照' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .context-line')?.textContent?.includes('@2'), null, { timeout: 30_000 })
  }, 'revise creates a new contract revision and rejects the old candidate')

  await step('STALE-QUESTION', async () => {
    const builder = await context.newPage()
    await builder.goto(base, { waitUntil: 'networkidle' })
    await builder.waitForSelector('.layout')
    await createWork(builder, 'Question answered elsewhere', 'profile-fixture-question')
    await builder.waitForSelector('.question-card', { timeout: 30_000 })
    const stale = await context.newPage()
    await stale.goto(base, { waitUntil: 'networkidle' })
    await stale.waitForSelector('.layout')
    await selectWork(stale, 'Question answered elsewhere')
    await stale.waitForSelector('.question-card')
    await stale.route('**/v1/events*', route => route.abort())
    // Reload under the aborted stream so this page keeps the stale question while the other answers.
    await stale.reload({ waitUntil: 'networkidle' })
    await stale.waitForSelector('.work-card')
    await selectWork(stale, 'Question answered elsewhere')
    await stale.waitForSelector('.question-card')
    await builder.locator('.question-card').first().getByRole('button', { name: 'Allow once' }).click()
    await builder.waitForSelector('.question-card', { state: 'detached', timeout: 30_000 })
    await stale.locator('.question-card').first().getByRole('button', { name: 'Allow once' }).click()
    await stale.waitForSelector('.error-panel')
    await stale.screenshot({ path: join(screenshots, 'controlled-stale-question.png') })
    const staleError = await stale.locator('.error-panel').innerText()
    assert(staleError.includes('问题已过期') || staleError.includes('问题版本已变化'), `old question is explicitly rejected: ${staleError}`)
    await stale.close()
    await builder.close()
  }, 'answering an already-answered question version is rejected')

  await step('STOP-WORK', async () => {
    await createWork(page, 'Work to stop', 'profile-fixture-slow')
    await selectWork(page, 'Work to stop')
    await page.getByRole('button', { name: '停止工作' }).click()
    await page.waitForFunction(() => {
      const phase = document.querySelector('.detail .phase')?.textContent ?? ''
      return phase === '已结束' || phase === '停止中'
    }, null, { timeout: 30_000 })
    assert(!(await page.locator('.detail .phase').textContent())?.includes('已交付'), 'stop does not deliver')
    await page.screenshot({ path: join(screenshots, 'controlled-stopped.png') })
  }, 'stop is accepted and never shown as delivered')

  await step('CONFIG-FAILURE-PRESERVES-DRAFT', async () => {
    const fault = await context.newPage()
    await fault.route('**/v1/configuration', route => route.abort())
    await fault.goto(base, { waitUntil: 'networkidle' })
    await fault.waitForSelector('.layout')
    await openCreate(fault)
    const form = fault.locator('.new-work')
    await form.locator('textarea').fill('Draft kept while configuration fails')
    await form.getByRole('button', { name: '刷新配置' }).click()
    await form.getByRole('alert').waitFor()
    assert((await form.locator('textarea').inputValue()) === 'Draft kept while configuration fails', 'draft survives a configuration failure')
    assert(await form.getByRole('button', { name: '创建委托' }).isDisabled(), 'new delegation is disabled')
    assert(await fault.locator('.work-card').count() > 0, 'existing works still render')
    await selectWork(fault, 'Fail profile must not deliver')
    await fault.waitForSelector('.verification .outcome-FAIL', { timeout: 30_000 })
    assert(await fault.getByRole('button', { name: '停止工作' }).isVisible(), 'existing work actions remain usable')
    await fault.screenshot({ path: join(screenshots, 'controlled-config-error.png') })
    await fault.close()
  }, 'configuration failure disables only new delegation and keeps the draft')

  await step('UNSCHEDULED-EXECUTOR-DISABLED', async () => {
    const real = await (await context.request.get(new URL('/v1/configuration', base).href)).json()
    const blocked = {
      ...real,
      projects: real.projects.map(project => ({ ...project, dispatchAllowed: false, blockedReason: 'unsupported_capability', profileIds: [] })),
      profiles: real.profiles.map(profile => ({ ...profile, dispatchAllowed: false, blockedReason: 'unsupported_capability' })),
    }
    for (const project of blocked.projects) delete project.defaultProfileId
    const fault = await context.newPage()
    await fault.route('**/v1/configuration', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(blocked) }))
    await fault.goto(base, { waitUntil: 'networkidle' })
    await fault.waitForSelector('.layout')
    await openCreate(fault)
    const form = fault.locator('.new-work')
    await form.locator('textarea').fill('Draft kept while executor is blocked')
    await form.getByRole('button', { name: '刷新配置' }).click()
    await fault.waitForFunction(() => document.body.innerText.includes('执行器不可调度'), null, { timeout: 10_000 })
    assert(await form.getByRole('button', { name: '创建委托' }).isDisabled(), 'blocked executor disables new delegation')
    assert((await form.locator('textarea').inputValue()) === 'Draft kept while executor is blocked', 'blocked state keeps the draft')
    await selectWork(fault, 'Fail profile must not deliver')
    await fault.waitForSelector('.verification .outcome-FAIL', { timeout: 30_000 })
    assert(await fault.getByRole('button', { name: '停止工作' }).isVisible(), 'existing work actions remain usable')
    await fault.screenshot({ path: join(screenshots, 'controlled-config-blocked.png') })
    await fault.close()
  }, 'unscheduled executor disables new delegation with an explicit reason')

  await step('SSE-RECONNECT', async () => {
    await page.getByRole('button', { name: '刷新快照' }).click()
    await page.waitForFunction(() => document.querySelector('.badge.status-live')?.textContent === '实时连接', null, { timeout: 10_000 })
    await context.setOffline(true)
    await page.waitForFunction(() => document.body.innerText.includes('事件流断开'), null, { timeout: 10_000 })
    await context.setOffline(false)
    await page.waitForFunction(() => document.querySelector('.badge.status-live')?.textContent === '实时连接', null, { timeout: 15_000 })
  }, 'offline/reconnect resumes the event stream')

  await step('NARROW-KEYBOARD', async () => {
    const narrowContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
    const mobile = await narrowContext.newPage()
    await mobile.goto(base, { waitUntil: 'networkidle' })
    await mobile.waitForSelector('.session-gate')
    await bootstrapPage(mobile)
    await openCreate(mobile)
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    assert(!overflow, 'no horizontal overflow on narrow viewport')
    await mobile.locator('.new-work textarea').fill('窄屏配置驱动委托')
    await mobile.locator('.new-work textarea').focus()
    await mobile.keyboard.press('Tab')
    const outline = await mobile.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)
    assert(outline !== 'none', 'keyboard focus outline is visible')
    await mobile.screenshot({ path: join(screenshots, 'controlled-narrow.png') })
    await narrowContext.close()
  }, 'narrow layout and keyboard focus work with configuration')

  await step('NO-PAGE-ERRORS', async () => {
    const pageErrors = errors.filter(error => error.startsWith('pageerror:'))
    assert(pageErrors.length === 0, pageErrors.join(' | '))
  }, 'no uncaught page errors')
} finally {
  await browser.close()
}

const report = {
  status: failures.length === 0 ? 'PASS_CONSOLE_CONTROLLED_PRODUCT' : 'FAIL_CONSOLE_CONTROLLED_PRODUCT',
  mode: 'controlled-product-http-configuration',
  base,
  apiState: state,
  testedAt: new Date().toISOString(),
  cases: results,
  failures,
  screenshots: [
    'screenshots/controlled-config-form.png', 'screenshots/controlled-form-question.png', 'screenshots/controlled-verified.png',
    'screenshots/controlled-delivered.png',
    'screenshots/controlled-after-reload.png', 'screenshots/controlled-fail.png', 'screenshots/controlled-stale-candidate.png',
    'screenshots/controlled-stale-question.png', 'screenshots/controlled-stopped.png', 'screenshots/controlled-config-error.png',
    'screenshots/controlled-config-blocked.png', 'screenshots/controlled-narrow.png',
  ],
  limitations: [
    'Controlled fixture profiles only: no installed vendor/model compatibility is claimed.',
    'Configuration failure/blocked scenarios are injected browser-side against the real endpoint; the backend still revalidates every command.',
    'Independent Runner reconnect, power loss and vendor-native authorization remain separate gates.',
  ],
}
writeFileSync(join(here, 'report-controlled.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ status: report.status, cases: results.map(result => `${result.status} ${result.id}`), failures }, null, 2))
if (failures.length) process.exitCode = 1
