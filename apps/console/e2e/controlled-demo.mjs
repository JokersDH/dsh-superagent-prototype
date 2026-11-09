/**
 * Browser acceptance against the controlled product API (apps/coordinator/product/demo.ts).
 * It creates a work with profile-fixture-question, answers the real native question, waits for the
 * registered check, reads the published delivery manifest/output artifacts from the browser, accepts
 * the current candidate, reloads, and checks a failing profile cannot be accepted. No vendor model is
 * involved and no verification is faked.
 *
 * Env: CONSOLE_PRODUCT_URL (default http://127.0.0.1:5174/),
 *      PRODUCT_DEMO_STATE (default /tmp/pa-product-demo).
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
const page = await context.newPage()
const errors = []
let watchErrors = false
page.on('pageerror', error => { if (watchErrors) errors.push(`pageerror: ${error.message}`) })
page.on('console', message => { if (watchErrors && message.type() === 'error') errors.push(`console: ${message.text()}`) })

const createWork = async (goal, profile) => {
  await page.getByRole('button', { name: '新建委托' }).click()
  const form = page.locator('.new-work')
  await form.locator('textarea').fill(goal)
  await form.locator('select').last().selectOption(profile)
  await form.getByRole('button', { name: '创建委托' }).click()
  await page.waitForFunction(text => [...document.querySelectorAll('.work-card')].some(card => card.textContent?.includes(text)), goal)
}

try {
  await page.goto(base, { waitUntil: 'networkidle' })

  await step('CONTROLLED-SESSION', async () => {
    await page.waitForSelector('.session-gate')
    await page.locator('#bootstrap-token').fill(token)
    await page.getByRole('button', { name: '建立本地会话' }).click()
    await page.waitForSelector('.layout')
    assert(await page.getByText('该项目还没有工作。').isVisible(), 'fresh controlled state is empty')
    assert((await page.locator('.badge.status-live').textContent())?.includes('实时连接'), 'SSE is live')
    watchErrors = true
  }, 'authenticated session against the controlled product API')

  const goal = 'Produce a reviewed scratch artifact via console'
  await step('CREATE-QUESTION-WORK', async () => {
    await page.getByRole('button', { name: '新建委托' }).click()
    const form = page.locator('.new-work')
    await form.locator('textarea').fill(goal)
    assert(await form.locator('select').last().inputValue() === 'profile-fixture-question', 'the configured question profile is selected')
    await form.getByRole('button', { name: '创建委托' }).click()
    await page.waitForSelector('.work-card')
    await page.waitForSelector('.question-card', { timeout: 30_000 })
    assert((await page.locator('.question-card').innerText()).includes('Allow the controlled fixture'), 'real native question reached the browser')
    await page.screenshot({ path: join(screenshots, 'controlled-question.png') })
  }, 'create_work with profile-fixture-question surfaces the native question')

  await step('ANSWER-AND-VERIFY', async () => {
    await page.locator('.question-card').first().getByRole('button', { name: 'Allow once' }).click()
    await page.waitForSelector('.question-card', { state: 'detached', timeout: 30_000 })
    await page.waitForSelector('.verification .outcome-PASS', { timeout: 30_000 })
    await page.waitForFunction(() => [...document.querySelectorAll('.actions button')].some(button => button.textContent === '接受当前候选'), null, { timeout: 30_000 })
    assert(await page.locator('.artifacts li').count() === 4, 'delivery manifest, patch, output and check evidence are published')
    await page.screenshot({ path: join(screenshots, 'controlled-verified.png') })
  }, 'the structured answer triggers the registered check and a trusted PASS candidate')

  await step('ARTIFACT-READING', async () => {
    await page.locator('.artifacts li').first().getByRole('button', { name: '查看' }).click()
    await page.waitForSelector('.artifact-text')
    const manifestText = await page.locator('.artifact-text').innerText()
    assert(manifestText.includes('"kind": "controlled-product-artifact/1"'), 'the delivery manifest is readable')
    assert(manifestText.includes('"attemptId"'), 'the manifest binds this attempt')
    await page.locator('.artifact-preview').getByRole('button', { name: '关闭预览' }).click()
    await page.locator('.artifacts li').nth(2).getByRole('button', { name: '查看' }).click()
    await page.waitForSelector('.artifact-text')
    assert((await page.locator('.artifact-text').innerText()).includes('approved product output'), 'the fixed output bytes are readable')
    assert(await page.locator('.artifacts a[href^="/v1/artifacts/"]').count() === 4, 'each artifact has an approved download reference')
  }, 'browser reads the current-candidate delivery manifest and output through /v1/artifacts')

  await step('ACCEPT-DELIVERED', async () => {
    await page.getByRole('button', { name: '接受当前候选' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付', null, { timeout: 30_000 })
    assert(await page.locator('.artifacts li').count() === 4, 'delivered artifact references remain visible')
    await page.screenshot({ path: join(screenshots, 'controlled-delivered.png') })
  }, 'current candidate acceptance delivers and keeps its artifacts')

  await step('RELOAD-PERSISTENCE', async () => {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.work-card')
    await page.locator('.work-card').filter({ hasText: goal }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    assert(await page.locator('.artifacts li').count() === 4, 'artifacts survive refresh')
    await page.screenshot({ path: join(screenshots, 'controlled-after-reload.png') })
  }, 'session, delivered work and artifact references survive reload')

  await step('FAILING-PROFILE-BLOCKED', async () => {
    const failing = 'Fail profile must not deliver'
    await createWork(failing, 'profile-fixture-fail')
    await page.locator('.work-card').filter({ hasText: failing }).click()
    await page.waitForSelector('.verification .outcome-FAIL', { timeout: 30_000 })
    assert(await page.getByRole('button', { name: '接受当前候选' }).count() === 0, 'a failed machine check offers no acceptance')
    assert(!(await page.locator('.detail .phase').textContent())?.includes('已交付'), 'a failed profile is not delivered')
    await page.screenshot({ path: join(screenshots, 'controlled-fail.png') })
  }, 'profile-fixture-fail produces a FAIL verification with no acceptance path')

  await step('NO-CONSOLE-ERRORS', async () => {
    assert(errors.length === 0, errors.join(' | '))
  }, 'no console/page errors after login')
} finally {
  await browser.close()
}

const report = {
  status: failures.length === 0 ? 'PASS_CONSOLE_CONTROLLED_PRODUCT' : 'FAIL_CONSOLE_CONTROLLED_PRODUCT',
  mode: 'controlled-product-http',
  base,
  apiState: state,
  testedAt: new Date().toISOString(),
  cases: results,
  failures,
  screenshots: [
    'screenshots/controlled-question.png', 'screenshots/controlled-verified.png', 'screenshots/controlled-delivered.png',
    'screenshots/controlled-after-reload.png', 'screenshots/controlled-fail.png',
  ],
  limitations: [
    'Controlled fixture profiles only: no installed vendor/model compatibility is claimed.',
    'The coordinator hosts the controlled subprocess; independent Runner reconnect and power-loss behavior remain separate lanes.',
    'Only the fixed profile scratch operation is exercised (no arbitrary user code execution).',
  ],
}
writeFileSync(join(here, 'report-controlled.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ status: report.status, cases: results.map(result => `${result.status} ${result.id}`), failures }, null, 2))
if (failures.length) process.exitCode = 1
