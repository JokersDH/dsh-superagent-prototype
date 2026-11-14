/**
 * React-hook async/identity acceptance for the trial workspace. It drives the real hook through a
 * controlled harness: transport A -> B switch with a late A response, inline prop objects that must not
 * loop, and disable/enable in the middle of a request. No product service or model is involved.
 *
 * Usage: node e2e/trial/trial-async.mjs   (spawns Vite on 5178 unless TRIAL_URL is set)
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
  try {
    await action()
    results.push({ id, status: 'PASS', ms: Date.now() - started, detail })
  } catch (error) {
    results.push({ id, status: 'FAIL', ms: Date.now() - started, detail: `${detail ?? ''} ${String(error?.message ?? error)}`.trim() })
    failures.push(id)
  }
}

const port = Number(process.env.TRIAL_PORT ?? 5178)
const base = process.env.TRIAL_URL ?? `http://127.0.0.1:${port}`
const logFd = openSync(join('/tmp', `f-trial-async-${process.pid}.log`), 'a')
let server
const waitFor = async (url, tries = 80) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`dev server did not answer within ${tries} bounded attempts: ${url}`)
}
try {
  if (process.env.TRIAL_URL === undefined) {
    server = spawn(join(consoleDir, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: consoleDir, env: { ...process.env, VITE_CONSOLE_MODE: 'fixture' }, stdio: ['ignore', logFd, logFd],
    })
    await waitFor(`${base}/e2e/trial/harness.html`)
  }
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  const open = async mode => {
    await page.goto(`${base}/e2e/trial/harness.html?mode=${mode}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.trial-view')
  }
  const discussion = async () => (await page.locator('.trial-cell').nth(1).innerText()).replace(/\s+/g, ' ')
  const reads = (which) => page.evaluate(name => window[name] ?? 0, which)
  const busy = async () => page.locator('.trial-view').getAttribute('aria-busy')

  await step('IDENTITY-SWITCH-A-TO-B', async () => {
    await open('identity')
    assert(await page.locator('[data-harness-identity]').innerText() === 'a', 'starts on identity A')
    assert(await reads('__TRIAL_A_READS__') === 1, 'one read for A')
    assert(await reads('__TRIAL_B_READS__') === 0, 'B is not read yet')
    assert(await busy() === 'true', 'A is still loading')
    assert((await discussion()).includes('未观察'), 'no fabricated readiness while loading')
    await page.locator('[data-harness="switch-b"]').click()
    await page.waitForFunction(() => document.querySelector('.trial-cell:nth-child(2) .trial-value-text strong')?.textContent === '已配置')
    assert(await reads('__TRIAL_B_READS__') === 1, 'identity change reads B exactly once')
    assert(await reads('__TRIAL_A_READS__') === 1, 'A is not re-read on identity change')
    await page.locator('[data-harness="resolve-a"]').click()
    await page.waitForTimeout(200)
    assert((await discussion()).includes('已配置'), 'a late A response cannot overwrite B')
    assert(await reads('__TRIAL_A_READS__') === 1, 'A still has one read')
    await page.locator('[data-harness="reload"]').click()
    await page.waitForFunction(() => (window.__TRIAL_B_READS__ ?? 0) === 2)
    await page.waitForTimeout(150)
    assert((await discussion()).includes('已配置'), 'reload keeps the current identity result')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'identity-b.png') })
  }, 'transport identity change cancels A, reads B once and rejects A late response')

  await step('IDENTITY-SWITCH-BACK-HIDES-OLD-DATA', async () => {
    await page.locator('[data-harness="switch-a"]').click()
    await page.waitForTimeout(100)
    assert((await discussion()).includes('未观察'), 'B data is hidden immediately when switching back to A')
    assert(await reads('__TRIAL_A_READS__') === 2, 'the new A identity is read once')
    await page.locator('[data-harness="resolve-a"]').click()
    await page.waitForFunction(() => document.querySelector('.trial-cell:nth-child(2) .trial-value-text strong')?.textContent === '未配置')
    assert((await discussion()).includes('未配置'), 'the new A observation renders after it arrives')
    assert(await reads('__TRIAL_B_READS__') === 2, 'B is not read again')
  }, 'switching identity hides the old service observation instead of relabelling it')

  await step('INLINE-PROPS-NO-LOOP', async () => {
    await open('inline')
    await page.waitForFunction(() => (window.__TRIAL_INLINE_READS__ ?? 0) === 1)
    assert(await reads('__TRIAL_INLINE_READS__') === 1, 'initial inline transport reads once')
    for (let index = 0; index < 3; index += 1) await page.locator('[data-harness="rerender"]').click()
    await page.waitForTimeout(300)
    assert(await reads('__TRIAL_INLINE_READS__') === 1, 'a fresh inline prop object does not retrigger the probe')
    assert((await discussion()).includes('已配置'), 'the one observation remains visible')
    assert(await page.locator('[data-harness-tick]').innerText() === '3', 'the harness really re-rendered')
  }, 'inline transport objects do not cause a request loop')

  await step('DISABLE-MID-FLIGHT', async () => {
    await open('disabled')
    assert(await page.locator('[data-harness-enabled]').innerText() === 'false', 'starts disabled')
    assert(await reads('__TRIAL_DISABLED_READS__') === 0, 'disabled hook performs no request')
    assert(await busy() === 'false', 'disabled hook is not busy')
    await page.locator('[data-harness="enable"]').click()
    await page.waitForFunction(() => (window.__TRIAL_DISABLED_READS__ ?? 0) === 1)
    await page.waitForFunction(() => document.querySelector('.trial-view')?.getAttribute('aria-busy') === 'true')
    await page.locator('[data-harness="disable"]').click()
    await page.waitForTimeout(120)
    assert(await busy() === 'false', 'disabling mid-flight ends the loading state')
    await page.locator('[data-harness="resolve"]').click()
    await page.waitForTimeout(200)
    assert((await discussion()).includes('未观察'), 'a response after disable is ignored')
    assert(await page.locator('.trial-banner-danger').count() === 0, 'no error is fabricated by a cancelled attempt')
    await page.locator('[data-harness="enable"]').click()
    await page.waitForFunction(() => (window.__TRIAL_DISABLED_READS__ ?? 0) === 2)
    await page.locator('[data-harness="resolve"]').click()
    await page.waitForFunction(() => document.querySelector('.trial-cell:nth-child(2) .trial-value-text strong')?.textContent === '已配置')
    assert(await reads('__TRIAL_DISABLED_READS__') === 2, 're-enabling performs exactly one new request')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'disabled-reenabled.png') })
  }, 'disabling mid-flight clears loading, ignores the late response and re-enables with one read')

  await step('AUTH-EXPIRY-KEEPS-LAST-OBSERVATION', async () => {
    await open('auth-expiry')
    await page.waitForFunction(() => document.querySelector('.trial-cell:nth-child(2) .trial-value-text strong')?.textContent === '已配置')
    await page.locator('[data-harness="reload"]').click()
    await page.getByRole('alert').waitFor()
    const text = await page.locator('.trial-view').innerText()
    assert(text.includes('会话已失效'), 'expired session has actionable copy')
    assert(text.includes('已配置') && text.includes('上次读取结果'), 'the last valid observation is retained and marked')
    assert(!text.includes('/Users') && !text.includes('token') && !text.includes('abc'), 'raw transport text never reaches the page')
    assert(await page.locator('[data-harness-auth-reads]').innerText() === '2', 'one reload, one attempt')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'auth-expiry.png') })
  }, 'an auth failure keeps the prior observation and shows bounded copy')

  await step('BROWSER-ERRORS', async () => {
    assert(errors.length === 0, `browser errors: ${errors.join('; ')}`)
  }, 'the async suite produces no page or console errors')

  await browser.close()
  writeFileSync(join(here, 'report-async.json'), JSON.stringify({
    subject: 'trial hook identity/async behavior with controlled transports (no product service or model)',
    viewport: '1440x900', generatedAt: new Date().toISOString(), results, failures,
  }, null, 2))
  console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} trial-async: ${results.filter(item => item.status === 'PASS').length}/${results.length}`)
  for (const item of results) console.log(`${item.status} ${item.id} (${item.ms}ms)`)
  if (failures.length) process.exitCode = 1
} finally {
  closeSync(logFd)
  if (server !== undefined) {
    server.kill('SIGTERM')
    await new Promise(resolve => server.once('exit', resolve))
  }
}
