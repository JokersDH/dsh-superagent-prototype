/**
 * Playwright acceptance for the wave-02 console (fixture adapter). It drives the real browser
 * against the Vite dev server: conversation, questions per target, verification/acceptance, dispatch
 * controls, stale/unknown states, offline and SSE recovery, refresh persistence, keyboard and a
 * narrow viewport. Screenshots and a JSON result are written under e2e/.
 *
 * Run from apps/console with the dev server already listening (npm run dev).
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const base = process.env.CONSOLE_URL ?? 'http://127.0.0.1:5173/'
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

const browser = await chromium.launch()
const consoleErrors = []
const watch = page => {
  page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`) })
}
const desktop = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
const page = await desktop.newPage()
watch(page)

try {
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('.work-card')
  await step('MAIN-RENDER', async () => {
    assert(await page.locator('.work-card').count() === 5, 'five works')
    assert(await page.locator('.question-card').count() === 5, 'five open questions')
    assert(await page.locator('.message').count() === 4, 'four seed messages')
    assert((await page.locator('.badge.status-live').textContent())?.includes('实时连接'), 'SSE live')
    await page.screenshot({ path: join(screenshots, 'desktop-main.png') })
  }, 'works/questions/conversation rendered and SSE is live')

  await step('EXECUTOR-FIXTURE', async () => {
    assert(await page.locator('.executor').count() === 1, 'one executor fixture')
    assert((await page.locator('.executor').innerText()).includes('profile-codex-local'), 'profile identity')
    assert((await page.locator('.executor').innerText()).includes('只读检查通过'), 'readiness is inspection only')
    assert(await page.getByText('生产 Catalog 由主线统一接线。').isVisible(), 'production wiring is stated')
  }, 'AgentProfile/ProbeReport fixture renders without inventing production Catalog data')

  await step('CHAT-SEND', async () => {
    const before = await page.locator('.message').count()
    await page.getByLabel('发送消息').fill('补充：保留 retry 上下文与 request id。')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.waitForFunction(count => document.querySelectorAll('.message').length > count, before)
    assert(await page.locator('.message').last().textContent().then(text => text?.includes('已记录你的补充')), 'assistant reply appended')
  }, 'message dispatch appends a persisted conversation message')

  await step('QUESTION-ANSWER-PER-TARGET', async () => {
    const card = page.locator('.question-card').filter({ hasText: '重试窗口应采用哪种策略？' })
    await page.screenshot({ path: join(screenshots, 'desktop-question.png') })
    await card.getByRole('button', { name: '指数退避（推荐）' }).click()
    await page.waitForFunction(() => !document.body.innerText.includes('重试窗口应采用哪种策略？'))
    assert(!(await page.locator('body').innerText()).includes('原生已应用'), 'local recording never claims native application')
    await page.locator('.question-card').filter({ hasText: '允许执行本次发布检查吗？' }).getByRole('button', { name: '允许本次' }).click()
    await page.waitForFunction(() => !document.body.innerText.includes('允许执行本次发布检查吗？'))
    await page.locator('.question-card').filter({ hasText: '请在原生客户端完成登录授权。' }).getByRole('button', { name: '取消授权' }).click()
    await page.waitForFunction(() => !document.body.innerText.includes('请在原生客户端完成登录授权。'))
  }, 'choice/review/url questions answered; local recording never claims native application')

  await step('VERIFICATION-AND-ACCEPT', async () => {
    await page.locator('.work-card').filter({ hasText: '发布前只读检查与候选摘要' }).click()
    await page.waitForSelector('.verification .outcome-PASS')
    await page.screenshot({ path: join(screenshots, 'desktop-work.png') })
    await page.getByRole('button', { name: '重试当前执行' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '执行中')
    await page.getByRole('button', { name: '接受当前候选' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
  }, 'current candidate with passing verification is accepted')

  await step('STALE-CANDIDATE-BLOCKED', async () => {
    await page.locator('.work-card').filter({ hasText: '旧候选：重试窗口已变更' }).click()
    assert(await page.getByRole('button', { name: '接受当前候选' }).isDisabled(), 'stale accept is disabled')
    assert(await page.getByText('该候选已过期，不能接受为完成结果。').isVisible(), 'stale warning is visible')
  }, 'expired candidate cannot be accepted')

  await step('STOPPING-UNKNOWN-WRITER', async () => {
    await page.locator('.work-card').filter({ hasText: '知识库索引重建' }).click()
    assert(await page.getByText('写者状态未知（不能视为已停止）').isVisible(), 'unknown writer is explicit')
    assert(!(await page.locator('.detail').innerText()).includes('已停止\n'), 'unknown writer is never shown as stopped')
  }, 'stopping work shows an indeterminate writer, not success')

  await step('PAUSE-DISPATCH-CAS', async () => {
    await page.locator('.work-card').filter({ hasText: '支付错题重试' }).click()
    await page.getByRole('button', { name: '暂停派工' }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '恢复派工'))
    assert(await page.locator('.work-card').filter({ hasText: '支付错题重试' }).innerText().then(text => text.includes('派工暂停')), 'card shows paused dispatch')
    await page.getByRole('button', { name: '继续工作' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '执行中')
  }, 'dispatch hold is updated through CAS, and continue resumes work')

  await step('STOP-WORK', async () => {
    await page.locator('.work-card').filter({ hasText: '一个非常长的委托标题' }).click()
    await page.getByRole('button', { name: '停止工作' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '停止中')
    assert(await page.getByText('写者状态未知（不能视为已停止）').isVisible(), 'unknown writer after stop')
  }, 'stop reports stopping with an unknown physical writer')

  await step('NO-OVERFLOW-DESKTOP', async () => {
    const offenders = await page.evaluate(() => {
      const bad = []
      for (const element of document.querySelectorAll('.app *')) {
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden') continue
        if (element.scrollWidth > element.clientWidth + 2 && style.overflowX === 'visible' && element.clientWidth > 0) {
          bad.push(`${element.tagName}.${element.className}`)
        }
      }
      return bad
    })
    assert(offenders.length === 0, `overflow: ${offenders.join(', ')}`)
    await page.screenshot({ path: join(screenshots, 'desktop-longtext.png') })
  }, 'long text wraps without horizontal overflow')

  await step('OFFLINE-READ-ANSWER-STOP', async () => {
    await page.getByRole('button', { name: '模拟模型离线' }).click()
    assert(await page.locator('.badge.warn', { hasText: '模型离线' }).first().isVisible(), 'offline badge')
    const before = await page.locator('.message').count()
    await page.getByLabel('发送消息').fill('离线时发送')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.waitForSelector('.error-panel')
    assert((await page.locator('.error-panel').innerText()).includes('模型离线'), 'chat is explicitly rejected')
    assert(await page.locator('.message').count() === before, 'no fake message is appended')
    await page.screenshot({ path: join(screenshots, 'desktop-offline-error.png') })
    const free = page.locator('.question-card').filter({ hasText: '还有需要补充的业务约束吗？' })
    await free.locator('textarea').fill('离线仍可回答')
    await free.getByRole('button', { name: '提交回答' }).click()
    await page.waitForFunction(() => !document.body.innerText.includes('还有需要补充的业务约束吗？'))
  }, 'offline model blocks chat only; query and answers still work')

  await step('RECOVER-AND-SEND', async () => {
    await page.getByRole('button', { name: '恢复模型' }).click()
    if (await page.locator('.error-panel').count()) await page.locator('.error-panel').getByRole('button', { name: '关闭' }).click()
    await page.getByLabel('发送消息').fill('恢复后继续')
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await page.waitForFunction(() => document.body.innerText.includes('恢复后继续'))
  }, 'recovery allows the next message')

  await step('SSE-RECONNECT', async () => {
    await page.getByRole('button', { name: '模拟断线' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('事件流断开'))
    await page.waitForFunction(() => document.querySelector('.badge.status-live')?.textContent === '实时连接', undefined, { timeout: 10_000 })
  }, 'dropped event stream reconnects without losing the page')

  await step('CURSOR-EXPIRY-REFETCH', async () => {
    await page.getByRole('button', { name: '使游标过期' }).click()
    await page.waitForFunction(() => document.body.innerText.includes('事件游标已过期'))
    await page.waitForFunction(() => document.querySelector('.badge.status-live')?.textContent === '实时连接', undefined, { timeout: 10_000 })
    assert(await page.locator('.work-card').count() === 5, 'snapshot restored')
  }, 'expired cursor triggers a snapshot refetch and resumes live updates')

  await step('RELOAD-PERSISTENCE', async () => {
    await page.reload({ waitUntil: 'networkidle' })
    await page.waitForSelector('.work-card')
    assert(await page.getByText('恢复后继续').isVisible(), 'conversation survives reload')
    await page.locator('.work-card').filter({ hasText: '发布前只读检查与候选摘要' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    await page.screenshot({ path: join(screenshots, 'desktop-after-reload.png') })
  }, 'page refresh restores conversation and delivered work')

  await step('CREATE-WORK', async () => {
    await page.getByRole('button', { name: '新建委托' }).click()
    await page.locator('.new-work textarea').fill('梳理离线恢复流程并给出可验证变更')
    await page.getByRole('button', { name: '创建委托' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.work-card').length === 6)
    assert(await page.getByText('梳理离线恢复流程并给出可验证变更').first().isVisible(), 'new work is listed')
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已排队')
    await page.screenshot({ path: join(screenshots, 'desktop-new-work.png') })
  }, 'a user can create a work from the console and see its queued state')

  await step('KEYBOARD-SEND-AND-FOCUS', async () => {
    await page.getByLabel('发送消息').focus()
    await page.keyboard.type('键盘发送验证')
    await page.keyboard.press('Control+Enter')
    await page.waitForFunction(() => document.body.innerText.includes('键盘发送验证'))
    await page.keyboard.press('Tab')
    const outline = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle)
    assert(outline !== 'none', 'keyboard focus has a visible outline')
  }, 'Ctrl+Enter sends and keyboard focus stays visible')

  await desktop.close()

  const narrow = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
  const mobile = await narrow.newPage()
  watch(mobile)
  await mobile.goto(base, { waitUntil: 'networkidle' })
  await mobile.waitForSelector('.work-card')
  await step('NARROW-NO-HORIZONTAL-OVERFLOW', async () => {
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
    assert(!overflow, `scrollWidth ${await mobile.evaluate(() => document.documentElement.scrollWidth)} > viewport`)
    assert(await mobile.getByLabel('发送消息').isVisible(), 'composer visible')
    await mobile.screenshot({ path: join(screenshots, 'narrow-main.png') })
  }, 'narrow layout has no horizontal overflow')
  await step('NARROW-QUESTION-FORM', async () => {
    const form = mobile.locator('.question-card').filter({ hasText: '补充重试上限与告警方式' })
    await form.scrollIntoViewIfNeeded()
    assert(await form.getByLabel('最大重试次数').isVisible(), 'form field visible')
    await mobile.screenshot({ path: join(screenshots, 'narrow-question.png') })
  }, 'question form is usable on a narrow viewport')
  await narrow.close()

  await step('NO-CONSOLE-ERRORS', async () => {
    assert(consoleErrors.length === 0, consoleErrors.join(' | '))
  }, 'no page or console errors')
} finally {
  await browser.close()
}

const report = {
  status: failures.length === 0 ? 'PASS_CONSOLE_FIXTURE' : 'FAIL_CONSOLE_FIXTURE',
  mode: 'fixture',
  base,
  node: process.version,
  testedAt: new Date().toISOString(),
  cases: results,
  failures,
  screenshots: [
    'screenshots/desktop-main.png', 'screenshots/desktop-question.png', 'screenshots/desktop-work.png',
    'screenshots/desktop-longtext.png', 'screenshots/desktop-offline-error.png', 'screenshots/desktop-after-reload.png',
    'screenshots/desktop-new-work.png', 'screenshots/narrow-main.png', 'screenshots/narrow-question.png',
  ],
  limitations: [
    'Fixture-level acceptance only: no live product HTTP/SSE server was available.',
    'Verification detail and per-target deliveries use fixture-only transport methods until the main transport publishes routes.',
    'No native Driver was exercised; delivery statuses remain local_recorded and are never shown as native_applied.',
  ],
}
writeFileSync(join(here, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ status: report.status, cases: results.map(result => `${result.status} ${result.id}`), failures }, null, 2))
if (failures.length) process.exitCode = 1
