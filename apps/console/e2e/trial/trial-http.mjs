/**
 * Real HTTP user journey for the trial workspace: an isolated product demo on a private port and
 * state root, the real ConsoleTransport over the Vite proxy, and the trial component reading
 * GET /v1/readiness. It cross-checks every rendered value against a direct authenticated API read,
 * proves navigation callbacks cause no requests, and proves reload performs exactly one more
 * readiness read. Fixture mode only: no vendor model, no native execution, no user instance.
 *
 * Usage: node e2e/trial/trial-http.mjs
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, closeSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const consoleDir = join(here, '..', '..')
const repoRoot = join(consoleDir, '..', '..')
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

const apiPort = Number(process.env.TRIAL_API_PORT ?? 5789)
const consolePort = Number(process.env.TRIAL_PORT ?? 5178)
const base = `http://127.0.0.1:${consolePort}`
const stateRoot = mkdtempSync(join(tmpdir(), 'pa-f-trial-http-'))
const logPath = join(tmpdir(), `f-trial-http-${process.pid}.log`)
const logFd = openSync(logPath, 'a')
const children = []
const waitFor = async (url, tries = 120) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return response } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`endpoint did not answer within ${tries} bounded attempts: ${url}`)
}
const stopChildren = async () => {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    child.kill('SIGTERM')
    await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 5000)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
}

let api
let consoleServer
try {
  api = spawn(process.execPath, ['apps/coordinator/product/demo.ts', '--port', String(apiPort), '--state', stateRoot, '--console-origin', base], {
    cwd: repoRoot, env: process.env, stdio: ['ignore', logFd, logFd],
  })
  children.push(api)
  await waitFor(`http://127.0.0.1:${apiPort}/v1/health`)
  consoleServer = spawn(join(consoleDir, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(consolePort), '--strictPort'], {
    cwd: consoleDir, env: { ...process.env, VITE_CONSOLE_MODE: 'http', VITE_API_TARGET: `http://127.0.0.1:${apiPort}` }, stdio: ['ignore', logFd, logFd],
  })
  children.push(consoleServer)
  await waitFor(`${base}/e2e/trial/harness.html`)

  const bootstrapToken = readFileSync(join(stateRoot, 'bootstrap.key'), 'utf8').trim()
  const apiToken = readFileSync(join(stateRoot, 'api.key'), 'utf8').trim()
  assert(/^[a-f0-9]{64}$/.test(bootstrapToken), 'bootstrap credential has the expected shape')
  assert(/^[a-f0-9]{64}$/.test(apiToken), 'api credential has the expected shape')
  const apiRead = async path => {
    const response = await fetch(`http://127.0.0.1:${apiPort}${path}`, { headers: { authorization: `Bearer ${apiToken}` } })
    assert(response.ok, `direct API read failed: ${path} ${response.status}`)
    return response.json()
  }
  const readiness = await apiRead('/v1/readiness')
  const configuration = await apiRead('/v1/configuration')

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  await context.addInitScript(token => { window.__TRIAL_BOOTSTRAP__ = token }, bootstrapToken)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  const requests = () => page.evaluate(() => window.__TRIAL_REQUESTS__ ?? [])
  const actions = () => page.evaluate(() => window.__TRIAL_ACTIONS__ ?? [])
  const countOf = async path => (await requests()).filter(url => url === path).length
  const open = async () => {
    await page.goto(`${base}/e2e/trial/harness.html?mode=http`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.trial-view[data-trial-state="observed"]')
  }

  await step('HTTP-READINESS-RENDER', async () => {
    await open()
    const cells = await page.locator('.trial-cell').allInnerTexts()
    const strip = cells.map(text => text.replace(/\s+/g, ' ').trim())
    assert(strip[0].includes(readiness.mode === 'fixture' ? '固定流程' : readiness.mode === 'personal' ? '个人模式' : '产品模式'), `mode cell: ${strip[0]}`)
    const discussionLabel = { configuration_present: '已配置', not_configured: '未配置', provider_error: '服务异常', unknown: '未知' }[readiness.discussion]
    assert(strip[1].includes(discussionLabel), `discussion cell: ${strip[1]}`)
    assert(strip[2].includes(readiness.development === 'fixture_only' ? '固定流程' : readiness.development), `development cell: ${strip[2]}`)
    if (readiness.development === 'fixture_only') assert(strip[2].includes('非原生执行器'), 'fixture is not native')
    const meta = await page.locator('.trial-panel').first().innerText()
    assert(meta.includes(`开发 ${readiness.projects.development} · 讨论 ${readiness.projects.discussion} · 可派工 ${readiness.projects.dispatchable}`), `project counts match the API: ${meta}`)
    for (const project of configuration.projects) assert(await page.getByText(project.displayName, { exact: true }).count() >= 1, `project ${project.id} is rendered from the API`)
    const facts = await page.locator('.trial-facts').innerText()
    assert(facts.includes(`${readiness.profiles.native} 个`), 'native profile count matches')
    assert(facts.includes(`已准入 ${readiness.profiles.admittedNative}`), 'admitted native count matches')
    assert(facts.includes(`${readiness.profiles.controlled} 个`), 'controlled profile count matches')
    assert(facts.includes(`已准入 ${readiness.profiles.admittedControlled}`), 'admitted controlled count matches')
    const boundary = await page.locator('.trial-boundary').innerText()
    assert(boundary.includes(readiness.configurationRevision.slice(0, 8)), 'configuration revision matches')
    assert(boundary.includes('未授予执行权限'), 'authorization none is rendered as no execution authority')
    assert(boundary.includes('不含项目路径、凭据或模型端点'), 'privacy boundary is stated')
    assert(!boundary.includes(stateRoot), 'the private state path never reaches the page')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'real-http-desktop.png') })
    await page.screenshot({ path: join(screenshots, 'real-http-page.png') })
  }, 'real HTTP readiness and configuration render the same facts as the API')

  await step('HTTP-REQUEST-BUDGET', async () => {
    const seen = await requests()
    assert(await countOf('/v1/session') === 1, `one bootstrap: ${seen.join(', ')}`)
    assert(await countOf('/v1/readiness') === 1, `one readiness read: ${seen.join(', ')}`)
    assert(await countOf('/v1/configuration') === 1, `one configuration read: ${seen.join(', ')}`)
    assert(seen.every(url => ['/v1/session', '/v1/readiness', '/v1/configuration'].includes(url)), `unexpected requests: ${seen.join(', ')}`)
  }, 'the page performs only bootstrap, readiness and configuration reads')

  await step('HTTP-ACTION-NO-REQUEST', async () => {
    const before = (await requests()).length
    const primary = page.locator('.trial-actions button').first()
    const action = await primary.getAttribute('data-trial-action')
    await primary.click()
    await page.waitForTimeout(200)
    assert((await actions()).at(-1) === action, `callback recorded: ${action}`)
    assert((await requests()).length === before, 'a navigation callback performs no HTTP request')
  }, 'navigation is a callback, not a command or a read')

  await step('HTTP-RELOAD-ONE-READ', async () => {
    const before = await countOf('/v1/readiness')
    await page.getByRole('button', { name: '重新读取试用状态' }).click()
    await page.waitForFunction(count => (window.__TRIAL_REQUESTS__ ?? []).filter(url => url === '/v1/readiness').length > count, before)
    await page.waitForTimeout(300)
    assert(await countOf('/v1/readiness') === before + 1, 'reload performs exactly one readiness read')
    assert(await countOf('/v1/configuration') === 1, 'reload does not re-read configuration')
    assert(await countOf('/v1/session') === 1, 'reload does not re-authenticate')
  }, 'reload is one bounded re-read with no command')

  await step('HTTP-MOBILE', async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
    await mobile.addInitScript(token => { window.__TRIAL_BOOTSTRAP__ = token }, bootstrapToken)
    const mobilePage = await mobile.newPage()
    const mobileErrors = []
    mobilePage.on('pageerror', error => mobileErrors.push(error.message))
    await mobilePage.goto(`${base}/e2e/trial/harness.html?mode=http`, { waitUntil: 'networkidle' })
    await mobilePage.waitForSelector('.trial-view[data-trial-state="observed"]')
    const overflow = await mobilePage.evaluate(() => ({ page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    assert(overflow.page <= overflow.client + 1, `mobile overflows: ${JSON.stringify(overflow)}`)
    await mobilePage.locator('.trial-view').screenshot({ path: join(screenshots, 'real-http-mobile.png') })
    assert(mobileErrors.length === 0, `mobile errors: ${mobileErrors.join('; ')}`)
    await mobile.close()
  }, 'the real HTTP state is usable at 390px')

  await step('HTTP-UNMOUNT', async () => {
    await page.locator('[data-harness="unmount"]').click()
    await page.waitForSelector('[data-unmounted="true"]')
    assert(errors.length === 0, `browser errors: ${errors.join('; ')}`)
  }, 'unmounting the real-HTTP view leaves no page or console error')

  await browser.close()
  writeFileSync(join(here, 'report-http.json'), JSON.stringify({
    subject: 'trial workspace against an isolated product demo (fixture profiles; not a native or release verdict)',
    endpoints: ['GET /v1/readiness', 'GET /v1/configuration', 'POST /v1/session'],
    apiObservation: {
      mode: readiness.mode, startupMode: readiness.startupMode, development: readiness.development,
      discussion: readiness.discussion, projects: readiness.projects, profiles: readiness.profiles,
      capabilities: readiness.capabilities, authorization: readiness.authorization,
      configurationRevision: readiness.configurationRevision.slice(0, 8),
      configuredProjects: configuration.projects.map(project => ({ id: project.id, displayName: project.displayName, dispatchAllowed: project.dispatchAllowed })),
    },
    viewports: ['1440x900', '390x844'], generatedAt: new Date().toISOString(),
    stateRootKind: 'private temporary root (not committed)', results, failures,
  }, null, 2))
  console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} trial-http: ${results.filter(item => item.status === 'PASS').length}/${results.length}`)
  for (const item of results) console.log(`${item.status} ${item.id} (${item.ms}ms)`)
  if (failures.length) process.exitCode = 1
} finally {
  await stopChildren()
  closeSync(logFd)
}
