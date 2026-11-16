/**
 * Browser acceptance for the read-only history/source panel. It drives the real component with
 * controlled public-DTO fixtures: non-empty rows, a live continuation, frozen source body excerpts,
 * explicit missing/scope-changed states and a refused foreign page. No history/source API is called
 * from the component and no send/execute capability is implied.
 *
 * Usage: node e2e/trial/history-source.mjs   (spawns its own Vite on 5176)
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, closeSync, openSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const consoleDir = join(here, '..', '..')
const screenshots = join(here, 'screenshots')
mkdirSync(screenshots, { recursive: true })
const results = []
const failures = []
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const step = async (id, action, detail) => {
  const started = Date.now()
  try { await action(); results.push({ id, status: 'PASS', ms: Date.now() - started, detail }) }
  catch (error) {
    results.push({ id, status: 'FAIL', ms: Date.now() - started, detail: `${detail ?? ''} ${String(error?.message ?? error)}`.trim() })
    failures.push(id)
  }
}
const logFile = join('/tmp', `f-history-source-${process.pid}.log`)
const logFd = openSync(logFile, 'a')
let server
const port = Number(process.env.HISTORY_FORM_PORT ?? 5176)
const base = `http://127.0.0.1:${port}`
const waitFor = async (url, tries = 80) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return } catch { /* not up */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`dev server did not answer within ${tries} bounded attempts: ${url}`)
}
try {
  server = spawn(join(consoleDir, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: consoleDir, env: { ...process.env, VITE_CONSOLE_MODE: 'fixture' }, stdio: ['ignore', logFd, logFd],
  })
  await waitFor(`${base}/e2e/trial/harness.html`)
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  const open = async scenario => {
    await page.goto(`${base}/e2e/trial/harness.html?mode=history&scenario=${scenario}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.trial-history')
  }

  await step('NON-EMPTY-ROWS', async () => {
    await open('verified')
    assert(await page.locator('.trial-history-row').count() === 2, 'both original entries render')
    assert((await page.locator('.trial-history-list').innerText()).includes('为项目补充回归检查'), 'original message text is shown')
    assert((await page.locator('.trial-history-list').innerText()).includes('2 条来源'), 'source count is shown')
    assert((await page.locator('.trial-history-list').innerText()).includes('msg-1'), 'original message identity is locatable')
    assert((await page.locator('.trial-history').innerText()).includes('续页是当前 keyset'), 'live continuation is not presented as a frozen snapshot')
  }, 'non-empty history')

  await step('VERIFIED-SOURCE-BODY', async () => {
    const detail = page.locator('.trial-history-detail')
    assert((await detail.innerText()).includes('已核对冻结原文'), 'verified source state is explicit')
    assert((await detail.innerText()).includes('工作合同摘要'), 'source title is shown')
    const first = detail.locator('.trial-history-sources details').first()
    await first.locator('summary').click()
    assert((await first.locator('pre').innerText()).includes('补充回归检查'), 'bounded frozen body is readable')
    assert((await detail.innerText()).includes('当前允许路径比冻结时更窄'), 'scope explanation is shown')
    assert((await detail.innerText()).includes('不构成发送、执行或批准权限'), 'readability is not presented as a grant')
  }, 'frozen body and scope review')

  await step('MISSING-SOURCE-IS-EXPLICIT', async () => {
    await page.locator('[data-harness="select-second"]').click()
    await page.waitForFunction(() => document.querySelector('.trial-history-source-state')?.textContent?.includes('缺失'))
    assert((await page.locator('.trial-history-source-state').innerText()).includes('冻结原文文件缺失'), 'missing source is labelled')
    assert((await page.locator('.trial-history-sources').innerText()).includes('不会被当成完整的零条来源'), 'missing is not drawn as a complete zero')
    assert(await page.locator('.trial-history-sources pre').count() === 0, 'missing source exposes no body')
  }, 'missing body')

  await step('LIVE-CONTINUATION', async () => {
    await open('verified')
    await page.getByRole('button', { name: '更多记录' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.trial-history-row').length === 3)
    assert((await page.locator('.trial-history-list').innerText()).includes('第三条历史记录'), 'continuation appends the next page')
    assert(await page.getByRole('button', { name: '更多记录' }).count() === 0, 'the exhausted page removes the continuation action')
    assert((await page.locator('.trial-history').innerText()).includes('没有更多记录'), 'the end of the live keyset is stated')
  }, 'continuation merge')

  await step('FOREIGN-PAGE-REFUSED', async () => {
    await open('foreign')
    assert((await page.locator('.trial-history-status').first().innerText()).includes('另一个项目或会话'), 'foreign page is refused')
    assert(await page.locator('.trial-history-row').count() === 0, 'foreign rows are not rendered')
  }, 'foreign project refusal')

  await step('SCOPE-CHANGED-BODY-WITHHELD', async () => {
    await open('scopechanged')
    assert((await page.locator('.trial-history-source-state').innerText()).includes('当前只读选择与冻结时不同'), 'scope change is labelled')
    assert(await page.locator('.trial-history-sources pre').count() === 0, 'scope-changed sources do not expose a body')
    assert((await page.locator('.trial-history-sources').innerText()).includes('另有 1 条冻结来源未展示'), 'withheld sources are counted')
  }, 'scope_changed state')

  await step('KEYBOARD-AND-RETURN', async () => {
    await open('verified')
    await page.locator('.trial-history-row').first().focus()
    await page.keyboard.press('Tab')
    assert(await page.locator('.trial-history-row').nth(1).evaluate(element => element === document.activeElement), 'Tab reaches the next history row')
    await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelector('.trial-history-source-state')?.textContent?.includes('缺失'))
    await page.getByRole('button', { name: '返回原会话' }).click()
    await page.waitForFunction(() => document.querySelector('[data-harness-log]')?.textContent === 'open-conversation')
  }, 'keyboard selection and return')

  await step('MOBILE-NO-OVERFLOW', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open('verified')
    const audit = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      panel: document.querySelector('.trial-history')?.getBoundingClientRect().width ?? 0,
      viewport: document.documentElement.clientWidth,
    }))
    assert(audit.overflow <= 1, `no horizontal overflow (${audit.overflow})`)
    assert(audit.panel > 0 && audit.panel <= audit.viewport, 'the history panel fits 390px')
    await page.locator('.trial-history').screenshot({ path: join(screenshots, 'history-source-390.png') })
  }, '390px layout')

  await step('NO-UNEXPECTED-ERRORS', async () => {
    assert(errors.length === 0, `unexpected browser errors: ${errors.join(' | ')}`)
  }, 'page errors')

  await browser.close()
} finally {
  if (server) server.kill('SIGTERM')
  closeSync(logFd)
}
writeFileSync(join(here, 'report-history-source.json'), JSON.stringify({
  subject: 'trial history/source panel (controlled public-DTO fixtures; read-only; not a release verdict)',
  generatedAt: new Date().toISOString(), results, failed: failures,
}, null, 2))
console.log(failures.length === 0
  ? `PASS history/source: ${results.length}/${results.length}`
  : `FAIL history/source: ${results.length - failures.length}/${results.length}; failed: ${failures.join(', ')}`)
process.exitCode = failures.length === 0 ? 0 : 1
