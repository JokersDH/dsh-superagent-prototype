/**
 * Verifies the four main navigation targets that TrialWorkspace callbacks open, against the real App
 * shell and a private fixture workbench. It does not mount TrialWorkspace (App.tsx is main-owned); it
 * proves the target entries exist, are reachable and keep the app error-free.
 *
 * Usage: node e2e/trial/app-targets.mjs   (ports 5292/8898, private temp state)
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, closeSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const consoleDir = join(here, '..', '..')
const repoRoot = join(consoleDir, '..', '..')
const screenshots = join(here, 'screenshots')
mkdirSync(screenshots, { recursive: true })
const consolePort = Number(process.env.TRIAL_APP_PORT ?? 5292)
const apiPort = Number(process.env.TRIAL_APP_API_PORT ?? 8898)
const base = `http://127.0.0.1:${consolePort}`
const stateRoot = mkdtempSync(join(tmpdir(), 'pa-f-app-targets-'))
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
const logFd = openSync(join(tmpdir(), `f-app-targets-${process.pid}.log`), 'a')
const launcher = spawn(process.execPath, [
  'tools/dev/start.mjs', '--fixture', '--state', stateRoot, '--port', String(consolePort), '--api-port', String(apiPort),
], { cwd: repoRoot, env: process.env, stdio: ['ignore', logFd, logFd] })
const stop = async () => {
  if (launcher.exitCode === null && launcher.signalCode === null) {
    launcher.kill('SIGTERM')
    await new Promise(resolve => {
      const timer = setTimeout(() => { try { process.kill(-launcher.pid, 'SIGKILL') } catch { /* gone */ } resolve() }, 8000)
      launcher.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}
const waitFor = async (url, tries = 120) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`workbench did not answer within ${tries} bounded attempts: ${url}`)
}

try {
  await waitFor(`http://127.0.0.1:${apiPort}/v1/health`)
  await waitFor(base)
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('.app')
  if (await page.locator('.session-gate').count() > 0) {
    await page.locator('#bootstrap-token').fill('0'.repeat(64))
    throw new Error('fixture workbench unexpectedly requires a login token')
  }
  await page.waitForSelector('.workspace-rail')

  await step('SHELL', async () => {
    for (const label of ['主对话视图', '工作与交付', '待我决定', '执行器目录']) assert(await page.locator(`[aria-label="${label}"]`).count() === 1, `rail target ${label} exists`)
    assert(await page.locator('[aria-label="模型设置"]').count() >= 1, 'model settings entry exists')
    assert(await page.locator('[aria-label="导入项目"]').count() === 1, 'project import entry exists')
    assert((await page.locator('.workspace-rail').getAttribute('aria-label')) === '工作台导航', 'rail is a labelled navigation')
    await page.screenshot({ path: join(screenshots, 'app-shell-desktop.png') })
  }, 'chat, works, decisions, executors, model settings and import entries all exist')

  await step('TARGET-INSPECT-EXECUTOR', async () => {
    await page.locator('[aria-label="执行器目录"]').click()
    await page.waitForSelector('.executor-directory')
    const text = await page.locator('.executor-directory').innerText()
    assert(text.includes('执行器') || text.includes('固定流程'), 'executor view opened')
    assert(text.includes('暂无已连接的原生执行器'), 'native executors are honestly reported as absent in fixture mode')
    assert(await page.locator('.test-profiles').count() === 1, 'controlled fixture profiles stay in their own section')
    assert((await page.locator('[aria-label="执行器目录"]').getAttribute('aria-current')) === 'page', 'rail marks the executor view')
  }, 'inspect_executor opens the real executor directory')

  await step('TARGET-IMPORT-PROJECT', async () => {
    await page.locator('[aria-label="导入项目"]').click()
    await page.waitForSelector('form[aria-label="导入本地项目"]')
    assert(await page.locator('input[name="project-path"]').isVisible(), 'project path field is visible')
    await page.locator('[aria-label="取消导入"]').click()
    assert(await page.locator('form[aria-label="导入本地项目"]').count() === 0, 'import form closes again')
  }, 'import_project opens and dismisses the real project import form')

  await step('TARGET-CONFIGURE-MODEL', async () => {
    await page.locator('[aria-label="模型设置"]').first().click()
    await page.waitForSelector('section[aria-label="模型设置"]')
    assert(await page.locator('section[aria-label="模型设置"]').isVisible(), 'model panel is visible')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(150)
  }, 'configure_model opens the real model settings panel')

  await step('TARGET-CONVERSATION', async () => {
    await page.locator('[aria-label="主对话视图"]').click()
    await page.waitForSelector('.conversation-surface')
    assert(await page.locator('.conversation-surface').isVisible(), 'conversation surface is visible')
    assert((await page.locator('[aria-label="主对话视图"]').getAttribute('aria-current')) === 'page', 'rail marks conversation')
  }, 'open_conversation returns to the real main conversation')

  await step('BROWSER-ERRORS', async () => {
    assert(errors.length === 0, `browser errors: ${errors.join('; ')}`)
  }, 'the real shell journey produces no page or console error')

  await browser.close()
  writeFileSync(join(here, 'report-app-targets.json'), JSON.stringify({
    subject: 'real App shell navigation targets (fixture workbench; TrialWorkspace not mounted by main yet)',
    ports: { console: consolePort, api: apiPort }, viewport: '1440x900',
    stateRootKind: 'private temporary root (not committed)', generatedAt: new Date().toISOString(), results, failures,
  }, null, 2))
  console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} trial-app-targets: ${results.filter(item => item.status === 'PASS').length}/${results.length}`)
  for (const item of results) console.log(`${item.status} ${item.id} (${item.ms}ms)`)
  if (failures.length) process.exitCode = 1
} finally {
  await stop()
  closeSync(logFd)
}
