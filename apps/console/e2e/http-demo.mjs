/**
 * Live HTTP demo acceptance for the console. It boots against the main-owned loopback API sandbox
 * (apps/coordinator/http/demo.ts): session bootstrap with the private token, snapshot, work creation
 * through the real ApplicationService/core/SQLite path, conversation, dispatch hold, stop, and
 * reload persistence. The sandbox is an API fixture: execution intents are queued, no vendor model is
 * called, and no verification is fabricated.
 *
 * Env: CONSOLE_HTTP_URL (default http://127.0.0.1:5174/), HTTP_DEMO_STATE (default /tmp/pa-http-demo).
 */
import { chromium } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.env.CONSOLE_HTTP_URL ?? 'http://127.0.0.1:5174/'
const state = process.env.HTTP_DEMO_STATE ?? '/tmp/pa-http-demo'
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
const bootstrapToken = readFileSync(join(state, 'bootstrap.key'), 'utf8')

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
const page = await context.newPage()
const errors = []
let watchErrors = false
page.on('pageerror', error => { if (watchErrors) errors.push(`pageerror: ${error.message}`) })
page.on('console', message => { if (watchErrors && message.type() === 'error') errors.push(`console: ${message.text()}`) })

try {
  await page.goto(base, { waitUntil: 'networkidle' })

  await step('SESSION-GATE-WRONG-TOKEN', async () => {
    await page.waitForSelector('.session-gate')
    await page.screenshot({ path: join(screenshots, 'http-gate.png') })
    await page.locator('#bootstrap-token').fill('0'.repeat(64))
    await page.getByRole('button', { name: '建立本地会话' }).click()
    await page.waitForSelector('.session-card [role=alert]')
    assert((await page.locator('.session-card [role=alert]').innerText()).includes('credential'), 'wrong token is refused in-place')
  }, 'the private bootstrap credential is required; a wrong token is refused without losing the page')

  await step('SESSION-BOOTSTRAP', async () => {
    await page.locator('#bootstrap-token').fill(bootstrapToken)
    await page.getByRole('button', { name: '建立本地会话' }).click()
    await page.waitForSelector('.layout')
    assert(await page.getByText('该项目还没有工作。').isVisible(), 'fresh sandbox is empty')
    assert((await page.locator('.badge.status-live').textContent())?.includes('实时连接'), 'SSE is live over the product API')
    watchErrors = true
  }, 'HttpOnly session cookie authenticates snapshot and SSE; the browser never sends an actor')

  await step('CREATE-WORK-VIA-PRODUCT', async () => {
    await page.getByRole('button', { name: '新建委托' }).click()
    const form = page.locator('.new-work')
    await form.locator('textarea').fill('实现 HTTP 演示工作：保留回执并展示当前候选状态')
    await form.locator('input[type=text]').first().fill('project-atlas')
    await form.getByRole('button', { name: '创建委托' }).click()
    await page.waitForSelector('.work-card')
    assert(await page.locator('.work-card').count() === 1, 'one work after create_work')
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已排队')
    const available = await page.locator('.actions button').allTextContents()
    assert(available.includes('暂停派工') && available.includes('停止工作'), `actions come from the backend: ${available.join(',')}`)
    await page.screenshot({ path: join(screenshots, 'http-work.png') })
  }, 'create_work goes through ApplicationService/core/SQLite and its actions render')

  await step('CHAT-AND-MESSAGE-RELOAD', async () => {
    const before = await page.locator('.message').count()
    await page.getByLabel('发送消息').fill('先讨论实现路径，不要直接执行不可逆动作。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.waitForFunction(count => document.querySelectorAll('.message').length > count, before)
    assert(await page.getByText('先讨论实现路径，不要直接执行不可逆动作。').isVisible(), 'user message persisted through the application')
  }, 'chat is a real product command; no assistant text is fabricated by the sandbox')

  await step('PAUSE-DISPATCH-LIVE', async () => {
    await page.getByRole('button', { name: '暂停派工' }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '恢复派工'))
    assert(await page.locator('.work-card').innerText().then(text => text.includes('派工暂停')), 'dispatch hold shown from the snapshot')
  }, 'pause_dispatch CAS is accepted by the live application')

  await step('STOP-WORK-LIVE', async () => {
    await page.getByRole('button', { name: '停止工作' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已结束')
    assert(!(await page.locator('.detail').innerText()).includes('已交付'), 'a stop never claims delivery')
    assert(!(await page.locator('.actions').innerText()).includes('停止工作'), 'stop is no longer offered on an ended ticket')
    await page.screenshot({ path: join(screenshots, 'http-stopped.png') })
  }, 'stop_work is accepted by the live application; the ended ticket is shown as ended, not delivered')

  await step('RELOAD-PERSISTENCE-LIVE', async () => {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.work-card')
    assert(await page.locator('.work-card').count() === 1, 'work survives reload')
    await page.locator('.work-card').first().click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已结束')
    assert(!(await page.locator('.detail').innerText()).includes('已交付'), 'ended state persists without a delivery claim')
    await page.screenshot({ path: join(screenshots, 'http-after-reload.png') })
  }, 'session cookie and product SQLite persist the work across page reload')

  await step('NO-CONSOLE-ERRORS', async () => {
    assert(errors.length === 0, errors.join(' | '))
  }, 'no page or console errors')
} finally {
  await browser.close()
}

const report = {
  status: failures.length === 0 ? 'PASS_CONSOLE_HTTP_DEMO' : 'FAIL_CONSOLE_HTTP_DEMO',
  mode: 'product-http-demo-fixture',
  base,
  apiState: state,
  testedAt: new Date().toISOString(),
  cases: results,
  failures,
  screenshots: ['screenshots/http-gate.png', 'screenshots/http-work.png', 'screenshots/http-stopped.png', 'screenshots/http-after-reload.png'],
  limitations: [
    'The loopback API sandbox queues execution intents and does not dispatch a Runner or vendor model; a stopped ticket therefore ends without a physical writer to observe.',
    'No question/verification artifacts were produced by the sandbox, so those live panels remain empty/NOT_TESTED.',
    'This is not G2-Native-Preview and makes no vendor compatibility claim.',
  ],
}
writeFileSync(join(here, 'report-http.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ status: report.status, cases: results.map(result => `${result.status} ${result.id}`), failures }, null, 2))
if (failures.length) process.exitCode = 1
