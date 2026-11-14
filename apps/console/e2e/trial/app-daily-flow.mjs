/**
 * Real-App two-project daily flow with the controlled fixture executor: create work, answer a native
 * question, verify, inspect delivery evidence and accept, in two different local Git projects; then
 * check the trial view's project/conversation identity and draft preservation. The fixture performs a
 * fixed scratch write only: no vendor model and no native Codex execution.
 *
 * Usage: node e2e/trial/app-daily-flow.mjs
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createPortProbe } from 'node:net'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '../../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../../../apps/coordinator/http/server.ts'
import { ensureStarterProject, NativeProjectRegistry } from '../../../../apps/coordinator/product/project-registry.ts'

const here = dirname(fileURLToPath(import.meta.url))
const consoleDir = join(here, '..', '..')
const screenshots = join(here, 'screenshots')
mkdirSync(screenshots, { recursive: true })
const results = []
const failures = []
const check = (condition, message) => { if (!condition) throw new Error(message) }
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

const require = createRequire(new URL('../../package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const { createServer } = await import(require.resolve('vite'))

const root = mkdtempSync('/tmp/pa-f-daily-flow-')
const stateRoot = join(root, 'state')
const alpha = join(root, 'alpha')
const beta = join(root, 'beta')
mkdirSync(stateRoot, { mode: 0o700 })
ensureStarterProject(alpha)
ensureStarterProject(beta)
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const registry = new NativeProjectRegistry(stateRoot)
const recordAlpha = registry.prepare({ path: alpha, displayName: '项目 Alpha', check: 'node_test' })
const recordBeta = registry.prepare({ path: beta, displayName: '项目 Beta', check: 'node_test' })
registry.save(recordAlpha)
registry.save(recordBeta)
const principal = { userId: 'f-daily-user', authorityRef: 'f-daily-authority' }
let modelCalls = 0
const providerStatus = { protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1',
  model: 'trial-local-mock', models: ['trial-local-mock'], state: 'configured', secureTransport: true }
const product = createProductRuntime({
  store, stateRoot, scratchProject: alpha, principal, actionSecret: Buffer.alloc(32, 65),
  projects: [
    { id: recordAlpha.id, displayName: recordAlpha.displayName, scope: { projectId: recordAlpha.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } },
    { id: recordBeta.id, displayName: recordBeta.displayName, scope: { projectId: recordBeta.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } },
  ],
  projectRegistry: registry,
  assistantProvider: { status: () => providerStatus, selectModel: () => providerStatus, reply: async () => { modelCalls += 1; throw new Error('Daily flow must not call a model') } },
})
product.start()

const probe = createPortProbe()
probe.listen(0, '127.0.0.1')
await once(probe, 'listening')
const consolePort = probe.address().port
await new Promise(resolveProbe => probe.close(resolveProbe))
const origin = `http://127.0.0.1:${consolePort}`
const apiToken = 'a'.repeat(64)
const http = createLocalHttpApp({
  application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
  localDevelopmentAccess: true, allowedOrigins: [origin], mode: 'fixture',
  read: product.read, operations: product.operations,
})
const api = listenLocalHttp(http, 0)
await once(api, 'listening')
const apiUrl = `http://127.0.0.1:${api.address().port}`
const conversationCommand = async body => {
  const response = await fetch(`${apiUrl}/v1/conversations/commands`, {
    method: 'POST', headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const receipt = await response.json()
  check(response.ok && receipt.status === 'recorded', `conversation command failed: ${response.status} ${JSON.stringify(receipt)}`)
}
await conversationCommand({ commandId: 'cmd-alpha', conversationId: 'conv-alpha-daily', kind: 'create_conversation', projectId: recordAlpha.id, title: 'Alpha 日常会话' })
await conversationCommand({ commandId: 'cmd-beta', conversationId: 'conv-beta-daily', kind: 'create_conversation', projectId: recordBeta.id, title: 'Beta 日常会话' })

const vite = await createServer({
  root: resolve(consoleDir), configFile: resolve(consoleDir, 'vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
  server: { host: '127.0.0.1', port: consolePort, strictPort: true, proxy: { '/v1': { target: apiUrl, changeOrigin: true } } },
})
let browser
try {
  await vite.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(20000)
  const errors = []
  const reviewActivityConflicts = []
  const posts = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => {
    if (message.type() !== 'error') return
    const location = message.location().url ?? ''
    // A known main-owned review-timing conflict is recorded separately, not as an F regression.
    if (location.includes('/review-activity')) { reviewActivityConflicts.push(location); return }
    errors.push(`console: ${message.text()}`)
  })
  page.on('request', request => {
    if (request.method() === 'POST') posts.push(new URL(request.url()).pathname)
  })
  const trial = () => page.getByRole('region', { name: '试用准备', exact: true })
  const openTrial = async () => {
    await page.getByRole('button', { name: '试用准备', exact: true }).click()
    await trial().waitFor()
    await page.waitForSelector('.trial-view[data-trial-state="observed"]')
  }
  const backToConversation = async () => {
    await trial().getByRole('button', { name: '打开主对话', exact: true }).click()
    await page.locator('.conversation-surface').waitFor()
  }
  const selectConversation = async (title, id) => {
    const row = page.locator(`.conversation-select[title="${title}"]`)
    await row.waitFor()
    await row.click()
    await page.waitForFunction(expected => new URLSearchParams(window.location.search).get('conversation') === expected, id)
  }
  const selectProject = async name => {
    await page.locator('.project-filter .chip').filter({ hasText: name }).click()
  }
  const createWork = async (goal, profileId) => {
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    const form = page.locator('form.new-work')
    await form.waitFor()
    await form.locator('textarea').fill(goal)
    await form.locator('select').nth(1).selectOption(profileId)
    await form.getByRole('button', { name: '创建委托', exact: true }).click()
    await page.locator('.work-card').filter({ hasText: goal }).waitFor()
  }
  const waitDelivered = async () => {
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付', null, { timeout: 30000 })
  }
  const accept = async () => {
    await page.getByRole('button', { name: '接受当前候选', exact: true }).waitFor()
    await page.getByRole('button', { name: '接受当前候选', exact: true }).click()
    await waitDelivered()
  }

  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.locator('.conversation-surface').waitFor()
  await selectConversation('Alpha 日常会话', 'conv-alpha-daily')
  await selectProject('项目 Alpha')

  await step('ALPHA-QUESTION-VERIFY-EVIDENCE-ACCEPT', async () => {
    await createWork('Alpha：固定流程问答与交付', 'profile-fixture-question')
    const question = page.locator('.question-card').first()
    await question.waitFor({ timeout: 30000 })
    check((await question.innerText()).includes('Allow the controlled fixture'), 'the real question is a native permission question')
    await question.getByRole('button', { name: 'Allow once', exact: true }).click()
    await page.locator('.question-card').first().waitFor({ state: 'detached', timeout: 30000 })
    await page.locator('.verification .outcome-PASS').waitFor({ timeout: 30000 })
    check(await page.locator('.artifacts li').count() === 4, 'four delivery artifacts are published')
    await page.locator('.artifacts li').first().getByRole('button', { name: '查看', exact: true }).click()
    await page.locator('.artifact-text').waitFor()
    check((await page.locator('.artifact-text').innerText()).includes('controlled-product-artifact/1'), 'the delivery manifest is readable')
    await page.locator('.artifact-preview').getByRole('button', { name: '关闭预览', exact: true }).click()
    await accept()
    await page.screenshot({ path: join(screenshots, 'daily-alpha-delivered.png') })
  }, 'Alpha delegation, native question, answer, PASS verification, evidence and acceptance')

  await step('ALPHA-TRIAL-IDENTITY', async () => {
    await openTrial()
    const facts = await trial().locator('.trial-facts').innerText()
    check(facts.includes('项目 Alpha') && facts.includes('Alpha 日常会话'), 'trial names the Alpha project and conversation')
    check((await trial().locator('.trial-cell').nth(2).innerText()).includes('固定流程'), 'the controlled fixture is labelled as fixture, not native')
    check((await trial().locator('.trial-panel').first().innerText()).includes('可派工 2'), 'both configured projects are dispatchable in this controlled runtime')
    await backToConversation()
  }, 'the trial view shows the Alpha project, conversation and fixture execution honestly')

  await step('BETA-DRAFT-AND-DELIVERY', async () => {
    await selectProject('项目 Beta')
    await selectConversation('Beta 日常会话', 'conv-beta-daily')
    await page.locator('.composer textarea').fill('Beta 未发送草稿：保持到返回')
    await createWork('Beta：固定流程交付', 'profile-fixture-pass')
    await page.locator('.verification .outcome-PASS').waitFor({ timeout: 30000 })
    check(await page.getByRole('button', { name: '接受当前候选', exact: true }).count() === 1, 'a PASS candidate offers acceptance')
    await accept()
    await page.screenshot({ path: join(screenshots, 'daily-beta-delivered.png') })
  }, 'Beta delegation runs the pass fixture through verification and acceptance')

  await step('BETA-TRIAL-AND-DRAFT-PRESERVED', async () => {
    await openTrial()
    const facts = await trial().locator('.trial-facts').innerText()
    check(facts.includes('项目 Beta') && facts.includes('Beta 日常会话'), 'trial names the Beta project and conversation')
    check(await trial().locator('.trial-project').count() === 2, 'both projects remain listed')
    check((await trial().locator('.trial-project[aria-current="true"]').innerText()).includes('项目 Beta'), 'the current project marker follows the filter')
    await backToConversation()
    check(await page.locator('.composer textarea').inputValue() === 'Beta 未发送草稿：保持到返回', 'the unsent draft survives the daily flow and trial round trip')
    await page.screenshot({ path: join(screenshots, 'daily-two-projects.png') })
  }, 'the second project keeps its own conversation, draft and delivery')

  await step('NO-MODEL-NO-UNEXPECTED-POSTS', async () => {
    check(modelCalls === 0, 'no model call was made')
    const unexpected = posts.filter(path => path !== '/v1/commands' && path !== '/v1/session' &&
      !/^\/v1\/works\/[^/]+\/review-activity$/.test(path))
    check(unexpected.length === 0, `unexpected POST paths: ${JSON.stringify(unexpected)}`)
    check(posts.filter(path => path === '/v1/commands').length >= 5, `expected product commands were sent: ${JSON.stringify(posts)}`)
    check(errors.length === 0, `browser errors: ${errors.join('; ')}`)
    check(reviewActivityConflicts.length <= 4, `unexpected review-activity conflicts: ${reviewActivityConflicts.length}`)
  }, 'only explicit product commands were sent; no model or hidden write occurred')

  await browser.close()
  writeFileSync(join(here, 'report-daily-flow.json'), JSON.stringify({
    subject: 'real App two-project daily flow with controlled fixture execution (no vendor model/native)',
    viewport: '1440x900',
    projects: [recordAlpha.displayName, recordBeta.displayName],
    conversations: ['conv-alpha-daily', 'conv-beta-daily'],
    profileUsed: ['profile-fixture-question', 'profile-fixture-pass'],
    posts, modelCalls, reviewActivityConflicts: reviewActivityConflicts.length,
    generatedAt: new Date().toISOString(), results, failures,
  }, null, 2))
  console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} trial-daily-flow: ${results.filter(item => item.status === 'PASS').length}/${results.length}`)
  for (const item of results) console.log(`${item.status} ${item.id} (${item.ms}ms)`)
  if (failures.length) process.exitCode = 1
} finally {
  if (browser !== undefined) await browser.close()
  await vite.close()
  await product.close()
  store.close()
  await new Promise(resolveClose => api.close(resolveClose))
  rmSync(root, { recursive: true, force: true })
}
