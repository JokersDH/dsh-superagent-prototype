/**
 * Real-App two-project daily journey for the trial workspace. It runs the actual console against a
 * private product runtime (two local Git projects, two real conversations, execution unavailable) and
 * verifies project/conversation identity, draft preservation, the real import path, the delegation
 * draft, and the trial view round trip. No vendor model, native execution or user service is used.
 *
 * Usage: node e2e/trial/app-two-projects.mjs
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createPortProbe } from 'node:net'
import { join, resolve } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ProductStore } from '../../../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../../../apps/coordinator/http/server.ts'
import { ensureStarterProject, NativeProjectRegistry } from '../../../../apps/coordinator/product/project-registry.ts'

const here = dirname(fileURLToPath(import.meta.url))
const consoleDir = join(here, '..', '..')
const repoRoot = join(consoleDir, '..', '..')
const screenshots = join(here, 'screenshots')
mkdirSync(screenshots, { recursive: true })
const results = []
const failures = []
const assertThat = (condition, message) => { if (!condition) throw new Error(message) }
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

const root = mkdtempSync('/tmp/pa-f-two-projects-')
const stateRoot = join(root, 'state')
const alpha = join(root, 'alpha')
const beta = join(root, 'beta')
mkdirSync(stateRoot, { mode: 0o700 })
ensureStarterProject(alpha)
ensureStarterProject(beta)
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const registry = new NativeProjectRegistry(stateRoot)
const recordAlpha = registry.prepare({ path: alpha, displayName: '项目 Alpha', check: 'node_test' })
registry.save(recordAlpha)
const principal = { userId: 'f-two-project-user', authorityRef: 'f-two-project-authority' }
let modelCalls = 0
const providerStatus = { protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1',
  model: 'trial-local-mock', models: ['trial-local-mock'], state: 'configured', secureTransport: true }
const product = createProductRuntime({
  store, stateRoot, scratchProject: alpha, principal, actionSecret: Buffer.alloc(32, 65),
  projects: [{ id: recordAlpha.id, displayName: recordAlpha.displayName, scope: registry.scope(recordAlpha) }],
  executionUnavailable: 'operator_disabled', projectRegistry: registry,
  assistantProvider: { status: () => providerStatus, selectModel: () => providerStatus, reply: async () => { modelCalls += 1; throw new Error('Trial journeys must not call a model') } },
})

const probe = createPortProbe()
probe.listen(0, '127.0.0.1')
await once(probe, 'listening')
const consolePort = probe.address().port
await new Promise(resolveProbe => probe.close(resolveProbe))
const origin = `http://127.0.0.1:${consolePort}`
const apiToken = 'a'.repeat(64)
const http = createLocalHttpApp({
  application: product.application, principal, apiToken, bootstrapToken: 'b'.repeat(64),
  localDevelopmentAccess: true, allowedOrigins: [origin], mode: 'personal',
  read: product.read, operations: product.operations,
})
const api = listenLocalHttp(http, 0)
await once(api, 'listening')
const apiPort = api.address().port
const apiUrl = `http://127.0.0.1:${apiPort}`
const command = async body => {
  const response = await fetch(`${apiUrl}/v1/conversations/commands`, {
    method: 'POST', headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const receipt = await response.json()
  assertThat(response.ok, `conversation command failed: ${response.status} ${JSON.stringify(receipt)}`)
  assertThat(receipt.status === 'recorded', `conversation command not recorded: ${JSON.stringify(receipt)}`)
  return receipt
}
await command({ commandId: 'cmd-create-alpha', conversationId: 'conv-alpha-daily', kind: 'create_conversation', projectId: recordAlpha.id, title: 'Alpha 讨论会话' })
await command({ commandId: 'cmd-create-beta', conversationId: 'conv-beta-daily', kind: 'create_conversation', projectId: recordAlpha.id, title: 'Beta 每日会话' })

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
  page.setDefaultTimeout(12000)
  const errors = []
  const requests = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  page.on('request', request => {
    const url = new URL(request.url())
    requests.push({ method: request.method(), path: url.pathname, conversation: url.searchParams.get('conversation') })
  })
  const readinessReads = () => requests.filter(entry => entry.path === '/v1/readiness').length
  const posts = () => requests.filter(entry => entry.method === 'POST')
  const trial = () => page.getByRole('region', { name: '试用准备', exact: true })
  const openTrial = async () => {
    await page.getByRole('button', { name: '试用准备', exact: true }).click()
    await trial().waitFor()
    await trial().getByText('个人模式', { exact: true }).waitFor()
  }
  const openConversation = async () => {
    await trial().getByRole('button', { name: '打开主对话', exact: true }).click()
    await page.locator('.conversation-surface').waitFor()
  }
  const selectConversation = async title => {
    const row = page.locator(`.conversation-select[title="${title}"]`)
    await row.waitFor()
    await row.click()
    await page.waitForFunction(expected => new URLSearchParams(window.location.search).get('conversation') === expected,
      title === 'Alpha 讨论会话' ? 'conv-alpha-daily' : 'conv-beta-daily')
  }
  const draft = () => page.locator('.composer textarea')

  await page.goto(origin, { waitUntil: 'networkidle' })
  await page.locator('.conversation-surface').waitFor()
  await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()

  await step('DEFAULT-CONVERSATION-AND-NO-EAGER-READ', async () => {
    assertThat(readinessReads() === 0, 'readiness is not read on app load')
    assertThat(posts().length === 0, 'app load posts nothing')
    assertThat((await page.getByRole('button', { name: '主对话视图', exact: true }).getAttribute('aria-current')) === 'page', 'conversation stays the default view')
  }, 'the real app keeps the main conversation default and reads readiness only on demand')

  await step('TWO-REAL-CONVERSATIONS-SWITCH', async () => {
    await page.locator('.conversation-list').waitFor()
    await selectConversation('Alpha 讨论会话')
    await draft().fill('Alpha 未发送草稿：不要提交')
    await selectConversation('Beta 每日会话')
    assertThat(await draft().inputValue() === '', 'a different conversation does not inherit the Alpha draft')
    await page.locator('.project-filter .chip').filter({ hasText: '项目 Alpha' }).click()
    await draft().fill('Beta 未发送草稿：保留到返回')
    await selectConversation('Alpha 讨论会话')
    assertThat(await draft().inputValue() === 'Alpha 未发送草稿：不要提交', 'the Alpha draft survives switching away and back')
    await selectConversation('Beta 每日会话')
    assertThat(await draft().inputValue() === 'Beta 未发送草稿：保留到返回', 'the Beta draft survives switching away and back')
  }, 'two real conversations keep separate drafts keyed by conversation identity')

  await step('TRIAL-SHOWS-CURRENT-CONVERSATION-AND-PRESERVES-DRAFT', async () => {
    await openTrial()
    assertThat(await readinessReads() === 1, `opening trial reads readiness once: ${readinessReads()}`)
    const facts = await trial().locator('.trial-facts').innerText()
    assertThat(facts.includes('当前对话') && facts.includes('Beta 每日会话'), 'the current conversation is named')
    assertThat(facts.includes('当前项目') && facts.includes('项目 Alpha'), 'the current project is named')
    assertThat((await trial().locator('.trial-cell').nth(1).innerText()).includes('已配置'), 'the configured discussion model is reported')
    await openConversation()
    assertThat(await draft().inputValue() === 'Beta 未发送草稿：保留到返回', 'returning from trial keeps the unsent draft')
    await openTrial()
    await openConversation()
    assertThat(await draft().inputValue() === 'Beta 未发送草稿：保留到返回', 'a second round trip keeps the draft')
    assertThat(await readinessReads() === 2, `each real open reads once: ${readinessReads()}`)
  }, 'trial round trips preserve draft, project and conversation identity with one read per open')

  await step('IMPORT-SECOND-PROJECT-THROUGH-THE-REAL-FORM', async () => {
    const before = posts().length
    await page.getByRole('button', { name: '导入项目', exact: true }).click()
    const form = page.getByRole('form', { name: '导入本地项目', exact: true })
    await form.waitFor()
    await form.locator('input[name="project-path"]').fill(beta)
    await form.locator('input[name="project-name"]').fill('项目 Beta 每日协作')
    await form.getByRole('button', { name: '导入项目', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    await page.locator('.project-filter').getByText('项目 Beta 每日协作', { exact: true }).waitFor()
    const after = posts()
    assertThat(after.length === before + 1, `import is exactly one POST: ${JSON.stringify(after.slice(before))}`)
    assertThat(after.at(-1)?.path === '/v1/projects', `import posts to /v1/projects: ${JSON.stringify(after.at(-1))}`)
    const workDraft = page.locator('form').filter({ has: page.getByRole('button', { name: '创建委托', exact: true }) })
    await workDraft.waitFor()
    await workDraft.getByRole('button', { name: '取消', exact: true }).click()
    assertThat(await draft().inputValue() === 'Beta 未发送草稿：保留到返回', 'the import flow keeps the conversation draft')
  }, 'the real import form adds the second project and keeps the unsent draft')

  await step('TRIAL-TWO-PROJECT-IDENTITY', async () => {
    await openTrial()
    const facts = await trial().locator('.trial-facts').innerText()
    assertThat(facts.includes('项目 Beta 每日协作'), `the imported project is current: ${facts}`)
    assertThat(await trial().locator('.trial-project').count() === 2, 'both real projects are listed')
    const currentRow = trial().locator('.trial-project[aria-current="true"]')
    assertThat(await currentRow.count() === 1, 'exactly one project is marked current')
    assertThat((await currentRow.innerText()).includes('项目 Beta 每日协作'), 'the current marker belongs to the imported project')
    assertThat((await trial().locator('.trial-cell').nth(2).innerText()).includes('暂不可用'), 'execution is honestly unavailable')
    assertThat((await trial().locator('.trial-cell').nth(2).innerText()).includes('开发执行已关闭'), 'the configured unavailable reason is shown')
    await trial().screenshot({ path: join(screenshots, 'two-projects-trial.png') })
    await page.screenshot({ path: join(screenshots, 'two-projects-page.png') })
  }, 'the trial view names the imported project and marks it current without inventing readiness')

  await step('DELEGATION-DRAFT-NOT-SUBMITTED', async () => {
    const before = posts().length
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    const workForm = page.locator('form').filter({ has: page.getByRole('button', { name: '创建委托', exact: true }) })
    await workForm.waitFor()
    await workForm.locator('textarea').fill('Beta 小委托草稿：保持未提交')
    assertThat(await workForm.getByRole('button', { name: '创建委托', exact: true }).isDisabled(), 'no executor is admitted, so creation stays disabled')
    await workForm.getByRole('button', { name: '取消', exact: true }).click()
    await workForm.waitFor({ state: 'hidden' })
    assertThat(posts().length === before, 'opening and cancelling a delegation draft posts nothing')
    assertThat(await draft().inputValue() === 'Beta 未发送草稿：保留到返回', 'the conversation draft survives the delegation draft')
  }, 'the delegation draft is inspectable, disabled without an admitted executor, and never submitted')

  await step('EXECUTOR-ROUND-TRIP-KEEPS-IDENTITY', async () => {
    await openTrial()
    const before = readinessReads()
    await trial().getByRole('button', { name: '检查执行器', exact: true }).click()
    await page.getByRole('heading', { name: '执行器连接', exact: true }).waitFor()
    await openTrial()
    assertThat(await readinessReads() === before + 1, 're-entering trial reads once')
    const facts = await trial().locator('.trial-facts').innerText()
    assertThat(facts.includes('项目 Beta 每日协作') && facts.includes('Beta 每日会话'), 'project and conversation identity survive the executor round trip')
    await openConversation()
    assertThat(await draft().inputValue() === 'Beta 未发送草稿：保留到返回', 'the draft survives the executor round trip')
  }, 'executor check and return keep the same project, conversation and draft')

  await step('NO-MODEL-NO-COMMAND-AND-NO-ERROR', async () => {
    const pagePosts = posts()
    assertThat(pagePosts.every(entry => entry.path === '/v1/session' || entry.path === '/v1/projects'), `unexpected page POST: ${JSON.stringify(pagePosts)}`)
    assertThat(pagePosts.every(entry => entry.path !== '/v1/commands'), 'no user command was sent by navigation')
    assertThat(modelCalls === 0, 'no model call was made')
    assertThat(errors.length === 0, `browser errors: ${errors.join('; ')}`)
  }, 'the journey sends no command, calls no model and logs no browser error')

  await browser.close()
  writeFileSync(join(here, 'report-two-projects.json'), JSON.stringify({
    subject: 'real App two-project daily journey (execution unavailable, configured model stub, no sends)',
    viewport: '1440x900',
    projects: [{ id: recordAlpha.id, displayName: recordAlpha.displayName }, { displayName: '项目 Beta 每日协作', importedVia: 'POST /v1/projects' }],
    conversations: ['conv-alpha-daily', 'conv-beta-daily'],
    readinessReads: readinessReads(), pagePosts: posts().map(entry => entry.path), modelCalls,
    generatedAt: new Date().toISOString(), results, failures,
  }, null, 2))
  console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} trial-two-projects: ${results.filter(item => item.status === 'PASS').length}/${results.length}`)
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
