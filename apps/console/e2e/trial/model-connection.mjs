/**
 * Browser acceptance for the transient model connection form. It checks that the real component keeps
 * the key out of storage, URL, page text and feedback, clears it on submit/identity change/unmount and
 * still offers an honest unavailable/old-settings path. It sends no model request and uses only the
 * local callback.
 *
 * Usage: node e2e/trial/model-connection.mjs   (spawns its own Vite on 5177)
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

const logFile = join('/tmp', `f-model-connection-${process.pid}.log`)
const logFd = openSync(logFile, 'a')
let server
const port = Number(process.env.MODEL_FORM_PORT ?? 5177)
const base = `http://127.0.0.1:${port}`
const waitFor = async (url, tries = 80) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return } catch { /* not up */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`dev server did not answer within ${tries} bounded attempts: ${url}`)
}
const secret = 'sk-wave34-transient-example'
const storageAudit = page => page.evaluate(() => ({
  local: Object.keys(localStorage).length, session: Object.keys(sessionStorage).length,
  url: window.location.href, text: document.body.innerText,
}))
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
  const open = async query => {
    await page.goto(`${base}/e2e/trial/harness.html?mode=model-form&${query}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.trial-model-connection')
  }
  const fill = async () => {
    await page.getByLabel('模型端点').fill('https://api.example.test/v1')
    await page.getByLabel('模型名称').fill('reasoner')
    await page.getByLabel('API Key', { exact: true }).fill(secret)
  }
  const calls = () => page.evaluate(() => window.__TRIAL_MODEL_CALLS__ ?? [])

  await step('FIELDS-AND-PASSWORD', async () => {
    await open('outcome=connected')
    assert(await page.getByLabel('模型端点').count() === 1, 'endpoint field exists')
    assert(await page.getByLabel('模型名称').count() === 1, 'model field exists')
    assert(await page.getByLabel('API Key', { exact: true }).getAttribute('type') === 'password', 'key uses a password input')
    assert(await page.getByLabel('API Key', { exact: true }).getAttribute('autocomplete') === 'new-password', 'key is not autofilled')
    assert((await page.locator('.trial-model-key-note').innerText()).includes('不写入浏览器存储'), 'the transient secret rule is stated')
  }, 'controlled form fields')

  await step('NO-PREMATURE-SIDE-EFFECT', async () => {
    await fill()
    const audit = await storageAudit(page)
    assert(!audit.text.includes(secret), 'typed key is never page text')
    assert(!audit.url.includes(secret), 'typed key is never in the URL')
    assert(audit.local === 0 && audit.session === 0, 'typing writes no browser storage')
    assert((await page.evaluate(() => window.__TRIAL_REQUESTS__ ?? [])).length === 0, 'the form makes no fetch')
    assert((await calls()).length === 0, 'no callback before explicit submit')
  }, 'no storage/url/fetch before submit')

  await step('SUBMIT-CLEARS-AND-CALLS-ONCE', async () => {
    await page.getByRole('button', { name: '连接模型' }).click()
    await page.waitForSelector('.trial-model-status')
    const recorded = await calls()
    assert(recorded.length === 1, 'one explicit submit calls one callback')
    assert(recorded[0].apiKey === secret && recorded[0].endpoint === 'https://api.example.test/v1', 'main receives the transient draft')
    assert(await page.getByLabel('API Key', { exact: true }).inputValue() === '', 'the key field is empty after submit')
    const audit = await storageAudit(page)
    assert(!audit.text.includes(secret) && !audit.url.includes(secret), 'submitted key is not page text or URL')
    assert(audit.local === 0 && audit.session === 0, 'submit writes no browser storage')
    assert((await page.evaluate(() => window.__TRIAL_REQUESTS__ ?? [])).length === 0, 'submit makes no direct fetch')
    assert((await page.locator('.trial-model-status').innerText()).includes('主程序确认'), 'connection feedback names the main confirmation')
  }, 'transient key lifecycle')

  await step('LEAKY-FEEDBACK-IS-REFUSED', async () => {
    await open('outcome=leak')
    await fill()
    await page.getByRole('button', { name: '连接模型' }).click()
    await page.waitForSelector('.trial-model-failure')
    const alert = await page.locator('.trial-model-failure').innerText()
    assert(!alert.includes(secret), 'feedback never echoes the submitted key')
    assert(!alert.includes('/Users/'), 'feedback never echoes a local path')
    assert(alert.includes('连接未完成'), 'unsafe feedback degrades to fixed copy')
    assert(await page.getByLabel('API Key', { exact: true }).inputValue() === '', 'failed submit keeps the key field empty')
  }, 'sanitised failure')

  await step('FAILED-CONNECTION-KEEPS-EDITABLE-FORM', async () => {
    await open('outcome=failed')
    await fill()
    await page.getByRole('button', { name: '连接模型' }).click()
    await page.waitForSelector('.trial-model-failure')
    assert((await page.locator('.trial-model-failure').innerText()).includes('端点拒绝连接'), 'safe provider feedback is shown')
    assert(await page.getByLabel('模型名称').isEditable(), 'the form remains editable after failure')
    await page.getByLabel('API Key', { exact: true }).fill(secret)
    await page.getByRole('button', { name: '连接模型' }).click()
    assert((await calls()).length === 2, 'a second explicit submit is allowed without duplicates')
  }, 'failure remains recoverable')

  await step('IDENTITY-CHANGE-CLEARS-SECRET', async () => {
    await open('outcome=connected')
    await fill()
    await page.locator('[data-harness="switch"]').click()
    assert(await page.locator('[data-harness-identity]').innerText() === 'b', 'identity switched')
    await page.waitForFunction(() => [...document.querySelectorAll('.trial-model-field input')].every(input => input.value === ''))
    assert(await page.getByLabel('API Key', { exact: true }).inputValue() === '', 'identity change clears the key')
    assert(await page.getByLabel('模型端点').inputValue() === '', 'identity change clears the endpoint')
    assert(await page.getByLabel('模型名称').inputValue() === '', 'identity change clears the model')
    assert((await calls()).length === 0, 'identity change does not submit')
    assert((await page.evaluate(() => Object.keys(sessionStorage).length + Object.keys(localStorage).length)) === 0, 'identity change writes no storage')
  }, 'secret lifecycle across identity')

  await step('UNMOUNT-CLEARS-AND-DOES-NOT-SUBMIT', async () => {
    await open('outcome=connected')
    await fill()
    await page.locator('[data-harness="unmount"]').click()
    await page.waitForSelector('[data-unmounted="true"]')
    const audit = await storageAudit(page)
    assert(!audit.text.includes(secret), 'unmount leaves no key in page text')
    assert(audit.local === 0 && audit.session === 0, 'unmount writes no storage')
    assert((await calls()).length === 0, 'unmount does not submit')
  }, 'unmount lifecycle')

  await step('UNAVAILABLE-ENTRY', async () => {
    await open('outcome=unavailable')
    assert(await page.locator('.trial-model-form').count() === 0, 'an unavailable entry offers no form')
    assert((await page.locator('.trial-model-unavailable').innerText()).includes('未提供模型连接入口'), 'unavailable reason is stated')
  }, 'old API / no callback fallback')

  await step('CANCEL-IS-NAVIGATION-ONLY', async () => {
    await open('outcome=connected')
    await fill()
    await page.getByRole('button', { name: '取消' }).click()
    await page.waitForFunction(() => document.querySelector('[data-harness-log]')?.textContent === 'cancel')
    assert((await calls()).length === 0, 'cancel does not connect')
  }, 'explicit cancel')

  await step('KEYBOARD-ORDER', async () => {
    await open('outcome=failed')
    await page.getByLabel('模型端点').focus()
    const order = []
    for (let index = 0; index < 4; index += 1) {
      await page.keyboard.press('Tab')
      order.push(await page.evaluate(() => { const element = document.activeElement; return element?.labels?.[0]?.innerText?.trim() ?? element?.textContent?.trim().slice(0, 12) ?? '' }))
    }
    assert(order[0] === '模型名称', 'Tab reaches the model name')
    assert(order[1] === 'API Key', 'Tab reaches the key')
    assert(order[2] === '连接模型', 'Tab reaches the submit action')
  }, 'bounded keyboard path')

  await step('MOBILE-NO-OVERFLOW', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await open('outcome=failed')
    await fill()
    const audit = await page.evaluate(() => {
      const form = document.querySelector('.trial-model-form')
      const note = document.querySelector('.trial-model-key-note')
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        formWidth: form?.getBoundingClientRect().width ?? 0,
        noteWidth: note?.getBoundingClientRect().width ?? 0,
        viewport: document.documentElement.clientWidth,
      }
    })
    assert(audit.overflow <= 1, `no horizontal overflow (${audit.overflow})`)
    assert(audit.formWidth > 0 && audit.formWidth <= audit.viewport, 'the form fits the viewport')
    assert(audit.noteWidth > 0 && audit.noteWidth <= audit.viewport, 'the key note fits the viewport')
    await page.locator('.trial-model-connection').screenshot({ path: join(screenshots, 'model-connection-390.png') })
  }, '390px layout')

  await step('NO-UNEXPECTED-ERRORS', async () => {
    assert(errors.length === 0, `unexpected browser errors: ${errors.join(' | ')}`)
  }, 'page errors')

  await browser.close()
} finally {
  if (server) server.kill('SIGTERM')
  closeSync(logFd)
}
writeFileSync(join(here, 'report-model-connection.json'), JSON.stringify({
  subject: 'trial model connection form (controlled local callback; no model/native request; not a release verdict)',
  generatedAt: new Date().toISOString(), results, failed: failures,
}, null, 2))
console.log(failures.length === 0
  ? `PASS model connection: ${results.length}/${results.length}`
  : `FAIL model connection: ${results.length - failures.length}/${results.length}; failed: ${failures.join(', ')}`)
process.exitCode = failures.length === 0 ? 0 : 1
