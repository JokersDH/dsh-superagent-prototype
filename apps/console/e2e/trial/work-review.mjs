/**
 * Browser acceptance for the trial Work-history/decision-reference/evidence summaries. It uses only
 * controlled public DTOs and local callbacks: no history API, decision command, accept command or model
 * request. These panels are candidates for main wiring; main's existing actual viewers remain canonical.
 *
 * Usage: node e2e/trial/work-review.mjs   (spawns its own Vite on 5175)
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, closeSync, openSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const here = dirname(fileURLToPath(import.meta.url)), consoleDir = join(here, '..', '..')
const screenshots = join(here, 'screenshots'); mkdirSync(screenshots, { recursive: true })
const results = [], failures = []
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const step = async (id, action, detail) => {
  const started = Date.now()
  try { await action(); results.push({ id, status: 'PASS', ms: Date.now() - started, detail }) }
  catch (error) { results.push({ id, status: 'FAIL', ms: Date.now() - started, detail: `${detail ?? ''} ${String(error?.message ?? error)}`.trim() }); failures.push(id) }
}
const logFd = openSync(join('/tmp', `f-work-review-${process.pid}.log`), 'a')
let server
const port = Number(process.env.WORK_REVIEW_PORT ?? 5175), base = `http://127.0.0.1:${port}`
const waitFor = async (url, tries = 80) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return } catch { /* not up */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`dev server did not answer: ${url}`)
}
try {
  server = spawn(join(consoleDir, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: consoleDir, env: { ...process.env, VITE_CONSOLE_MODE: 'fixture' }, stdio: ['ignore', logFd, logFd],
  })
  await waitFor(`${base}/e2e/trial/harness.html`)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  const open = async () => { await page.goto(`${base}/e2e/trial/harness.html?mode=review`, { waitUntil: 'networkidle' }); await page.waitForSelector('.trial-work-history') }

  await step('WORK-HISTORY-NON-EMPTY', async () => {
    await open()
    assert((await page.locator('.trial-work-history').innerText()).includes('当前合同版本 2'), 'current contract revision is shown')
    assert((await page.locator('.trial-work-history').innerText()).includes('部分记录'), 'partial coverage is explicit')
    assert(await page.locator('.trial-work-history-list li').count() === 1, 'the classified metadata row is shown')
    assert((await page.locator('.trial-work-history').innerText()).includes('来源 3 条'), 'source total is shown')
    assert((await page.locator('.trial-work-history').innerText()).includes('人工标准验收是逐条'), 'criterion acceptance is distinguished from overall acceptance')
    assert((await page.locator('.trial-work-history').innerText()).includes('原时间线保留整体交付接受'), 'classified metadata is distinguished from the overall delivery timeline')
  }, 'non-empty work history')

  await step('WORK-HISTORY-CONTINUATION', async () => {
    await page.locator('.trial-work-history').getByRole('button', { name: '较早记录' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.trial-work-history-list li').length === 2)
    assert((await page.locator('.trial-work-history').innerText()).includes('没有更早记录'), 'the end of the live keyset is stated')
  }, 'continuation')

  await step('DECISION-CURRENT-AND-REFUSED', async () => {
    const panel = page.locator('.trial-decision-reference')
    const text = await panel.innerText()
    assert(text.includes('采用标准检查') && text.includes('版本 1'), 'current decision content and version are shown')
    assert(text.includes('决定已替代') || text.includes('旧检查已替代'), 'the superseded decision remains visible')
    assert(text.includes('决定已替代') && text.includes('不可作为当前参考'), 'superseded decision is explicitly ineligible')
    const current = page.getByRole('button', { name: /采用标准检查/ })
    assert(await current.isEnabled(), 'current recorded decision is selectable as a reference')
    await current.click()
    await page.waitForFunction(() => (window.__TRIAL_DECISION_SELECT__ ?? []).length === 1)
    const superseded = page.getByRole('button', { name: /旧检查已替代/ })
    assert(await superseded.isDisabled(), 'superseded decision cannot be selected')
    assert((await panel.innerText()).includes('不构成执行 grant'), 'reference is not presented as a grant')
  }, 'decision reference eligibility')

  await step('REVIEW-EVIDENCE-ACCEPTANCE', async () => {
    const panel = page.locator('.trial-review-evidence')
    const text = await panel.innerText()
    assert(text.includes('已交付') && text.includes('检查完成'), 'phase and verification are shown')
    assert(text.includes('2 项'), 'artifact count is shown')
    assert(text.includes('原确认命令'), 'acceptance authority stays with the original command')
    assert(text.includes('原界面当前提供接受动作'), 'accept hint is explicit')
  }, 'acceptance summary')

  await step('MACHINE-FAILURE-IS-EXPLICIT', async () => {
    await page.locator('[data-harness="fail-verification"]').click()
    await page.waitForFunction(() => document.querySelector('.trial-review-evidence')?.textContent?.includes('机器检查失败'))
    const text = await page.locator('.trial-review-evidence').innerText()
    assert(text.includes('机器检查失败'), 'machine failure is labelled')
    assert(text.includes('当前不可接受'), 'failed verification does not offer acceptance')
  }, 'machine failure')

  await step('KEYBOARD-AND-MOBILE', async () => {
    await open()
    await page.getByRole('button', { name: /采用标准检查/ }).focus()
    await page.keyboard.press('Tab')
    assert((await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '')).length > 0, 'Tab reaches the next named control; ineligible decisions are not focusable')
    await page.setViewportSize({ width: 390, height: 844 })
    const audit = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      history: document.querySelector('.trial-work-history')?.getBoundingClientRect().width ?? 0,
      viewport: document.documentElement.clientWidth,
    }))
    assert(audit.overflow <= 1, `no horizontal overflow (${audit.overflow})`)
    assert(audit.history > 0 && audit.history <= audit.viewport, 'review panels fit 390px')
    await page.locator('.trial-review-evidence').screenshot({ path: join(screenshots, 'work-review-390.png') })
  }, 'keyboard and 390px')

  await step('FORCED-COLORS', async () => {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.emulateMedia({ forcedColors: 'active' })
    await open()
    const audit = await page.evaluate(() => {
      const row = document.querySelector('.trial-decision-row')
      const style = row ? getComputedStyle(row) : undefined
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        rowVisible: !!row && row.getBoundingClientRect().height > 0,
        border: style?.borderBottomWidth ?? '',
        color: style?.color ?? '',
      }
    })
    assert(audit.rowVisible, 'decision rows remain visible in forced colors')
    assert(audit.overflow <= 1, `forced colors have no horizontal overflow (${audit.overflow})`)
    assert(audit.border !== '0px' && audit.color.length > 0, 'row boundary and text remain rendered')
    await page.emulateMedia({ forcedColors: 'none' })
  }, 'forced-colors rendering')

  await step('NO-UNEXPECTED-ERRORS', async () => { assert(errors.length === 0, errors.join(' | ')) }, 'browser errors')
  await browser.close()
} finally { if (server) server.kill('SIGTERM'); closeSync(logFd) }
writeFileSync(join(here, 'report-work-review.json'), JSON.stringify({
  subject: 'trial work history/decision reference/review evidence (controlled DTOs, read-only, not a release verdict)',
  generatedAt: new Date().toISOString(), results, failures,
}, null, 2))
console.log(failures.length === 0 ? `PASS work review: ${results.length}/${results.length}` : `FAIL work review: ${results.length - failures.length}/${results.length}; failed: ${failures.join(', ')}`)
process.exitCode = failures.length === 0 ? 0 : 1
