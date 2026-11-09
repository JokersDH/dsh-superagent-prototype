import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct } from '../../apps/coordinator/product/runtime.ts'
import { PrivateModelProvider } from '../../apps/coordinator/product/model-provider.ts'
import { ensureScratchProject } from '../../apps/coordinator/product/scratch.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { chromium } = createRequire(new URL('../../apps/console/package.json', import.meta.url))('@playwright/test')
const consoleURL = process.env.ASSISTANT_CONSOLE_URL ?? 'http://127.0.0.1:5180'
const root = mkdtempSync('/tmp/pa-assistant-browser-')
const output = resolve('reports/releases/assistant-streaming')
mkdirSync(output, { recursive: true })
let release
const gate = new Promise((resolve) => {
  release = resolve
})
let calls = 0
const first = '# 需求计划\n\n第一段已实时到达。\n\n'
const second = '## 下一步\n\n- 明确用户和范围\n- 输出独立任务与验收条件\n'
const mock = createServer(async (req, res) => {
  let body = ''
  for await (const bytes of req) body += bytes
  assert.equal(JSON.parse(body).stream, true)
  assert.equal(req.headers.authorization, 'Bearer browser-fixture-private-key')
  calls++
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = (content, finish_reason = null) =>
    `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason }] })}\n\n`
  res.write(chunk(first))
  await gate
  res.end(chunk(second, 'stop') + 'data: [DONE]\n\n')
})
mock.listen(0, '127.0.0.1')
await once(mock, 'listening')
const config = join(root, 'model.json')
writeFileSync(
  config,
  JSON.stringify({
    baseURL: `http://127.0.0.1:${mock.address().port}/v1`,
    apiKey: 'browser-fixture-private-key',
    model: 'mock-stream',
    allowedModels: ['mock-stream'],
    allowInsecureHttp: true,
  }),
  { mode: 0o600 },
)
const store = new ProductStore({ path: join(root, 'state.sqlite') })
const scratchProject = ensureScratchProject(root)
const projectId = 'project-atlas'
const product = createControlledProduct({
  store,
  principal: { userId: 'browser-user', authorityRef: 'browser-authority' },
  stateRoot: root,
  scratchProject,
  projects: [
    {
      id: projectId,
      displayName: '流式验收项目',
      scope: { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
    },
  ],
  actionSecret: Buffer.alloc(32, 1),
  assistantProvider: new PrivateModelProvider(config),
})
const app = createLocalHttpApp({
  application: product.application,
  principal: { userId: 'browser-user', authorityRef: 'browser-authority' },
  apiToken: 'a'.repeat(64),
  bootstrapToken: 'b'.repeat(64),
  allowedOrigins: [new URL(consoleURL).origin],
  mode: 'fixture',
  localDevelopmentAccess: true,
  read: product.read,
})
const server = listenLocalHttp(app, 0)
await once(server, 'listening')
product.start()
const api = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  locale: 'zh-CN',
  acceptDownloads: true,
})
const page = await context.newPage()
const conversationId = `assistant-browser-${crypto.randomUUID()}`
const cases = [],
  errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/v1/**', (route) => {
  const url = new URL(route.request().url())
  return route.continue({ url: `${api}${url.pathname}${url.search}` })
})
const step = async (id, action) => {
  try {
    await action()
    cases.push({ id, status: 'PASS' })
  } catch (error) {
    cases.push({ id, status: 'FAIL', message: error.message })
    throw error
  }
}
try {
  await page.goto(`${consoleURL}/?conversation=${conversationId}`)
  await step('ACTIONABLE-TASK-TEMPLATE', async () => {
    await page.getByRole('button', { name: '生成 Agent 任务单', exact: true }).click()
    assert.match(await page.locator('#composer-input').inputValue(), /负责路径.*实施步骤.*验收命令/)
    assert.equal(calls, 0)
  })
  await step('REAL-SDK-SSE-BROWSER-INCREMENT', async () => {
    await page.locator('#composer-input').fill('请拆解一个个人需求管理工具的开发任务。')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.locator('.streaming-reply .markdown').getByText('第一段已实时到达。').waitFor()
    assert.equal(calls, 1)
    assert.equal(
      store.product.messages.page(conversationId).messages.filter((message) => message.role === 'assistant').length,
      0,
    )
    assert.doesNotMatch(await page.locator('.streaming-reply').innerText(), /明确用户/)
  })
  await step('STREAMING-DESKTOP-AND-MOBILE', async () => {
    await page.screenshot({ path: join(output, 'desktop-streaming.png'), fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: join(output, 'mobile-streaming.png'), fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
  })
  await step('RELOAD-RECOVERS-PARTIAL-WITHOUT-RECHARGE', async () => {
    await page.reload()
    await page.locator('.streaming-reply .markdown').getByText('第一段已实时到达。').waitFor()
    assert.equal(calls, 1)
    assert.equal(await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), true)
  })
  await step('COMPLETE-COMMIT-AND-MARKDOWN-EXPORT', async () => {
    release()
    await page.getByRole('button', { name: '导出 Markdown', exact: true }).waitFor()
    assert.equal(await page.locator('.streaming-reply').count(), 0)
    assert.equal(
      store.product.messages.page(conversationId).messages.filter((message) => message.role === 'assistant').length,
      1,
    )
    const downloaded = page.waitForEvent('download')
    await page.getByRole('button', { name: '导出 Markdown', exact: true }).click()
    const download = await downloaded
    assert.equal(readFileSync(await download.path(), 'utf8'), (first + second).trim())
    await page.reload()
    await page.getByRole('button', { name: '导出 Markdown', exact: true }).waitFor()
    assert.equal(calls, 1)
  })
  await step('NEW-CONVERSATION-ISOLATES-PRIOR-STREAM', async () => {
    await page.getByRole('button', { name: '新对话', exact: true }).first().click()
    await page.getByRole('button', { name: '生成 Agent 任务单', exact: true }).waitFor()
    assert.equal(await page.locator('.message.role-assistant').count(), 0)
    assert.equal(errors.length, 0, errors.join('\n'))
  })
} finally {
  release()
  await browser.close()
  await product.close()
  server.closeAllConnections()
  await new Promise((resolve) => server.close(resolve))
  mock.closeAllConnections()
  await new Promise((resolve) => mock.close(resolve))
  store.close()
  rmSync(root, { recursive: true, force: true })
  rmSync(scratchProject, { recursive: true, force: true })
  const report = {
    status:
      cases.length === 6 && cases.every((item) => item.status === 'PASS')
        ? 'PASS_ASSISTANT_STREAM_BROWSER'
        : 'FAIL_ASSISTANT_STREAM_BROWSER',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    testedAt: new Date().toISOString(),
    cases,
    errors,
    modelRequests: calls,
    vendorRequests: 0,
    limitations: [
      'Actual SDK, HTTP/SSE, SQLite/effect and console; model content comes from an isolated local SSE fixture',
      'Native coding and Runner admission remain separate',
    ],
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
