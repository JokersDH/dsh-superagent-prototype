import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer as portProbe } from 'node:net'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { ProductContextRecords } from '../../apps/coordinator/product/context-records.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { values } = parseArgs({ options: { output: { type: 'string' }, 'no-capture': { type: 'boolean', default: false } } })
const output = resolve(values.output ?? 'reports/releases/wave12-context/history-browser')
mkdirSync(output, { recursive: true })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const root = mkdtempSync('/tmp/pa-context-history-browser-'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true })
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const principal = { userId: 'history-browser-user', authorityRef: 'history-browser-authority' }, actor = { ...principal, source: 'local_cli' }
const projectId = 'payment-project', conversationId = 'payment-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
let now = new Date().toISOString(), providerConfigured = true, readonly = false, modelCalls = 0
const provider = {
  status: () => providerConfigured ? { protocol: 'assistant-provider/1', configured: true, baseURL: 'https://fixture.invalid/v1',
    model: 'history-mock', models: ['history-mock'], state: 'configured', secureTransport: true }
    : { protocol: 'assistant-provider/1', configured: false, baseURL: null, model: null, models: [], state: 'not_configured', secureTransport: false },
  selectModel() { return this.status() },
  reply: async (_messages, onDelta) => { modelCalls++; onDelta?.('已保留原始来源。'); return { text: '已保留原始来源。', model: 'history-mock' } },
}
const product = createProductRuntime({ store, principal, stateRoot, scratchProject: projectRoot,
  projects: [{ id: projectId, displayName: '支付服务', scope }, { id: 'docs-project', displayName: '文档项目', scope: { ...scope, projectId: 'docs-project' } },
    { id: 'empty-project', displayName: '空项目', scope: { ...scope, projectId: 'empty-project' } }],
  actionSecret: Buffer.alloc(32, 49), assistantProvider: provider, now: () => now })
const configuration = await product.read.configuration(), configuredProject = configuration.projects.find(project => project.id === projectId)
const otherWorkTitle = '其他会话的兼容性复核'
const otherWork = await product.application.dispatch({ kind: 'create_work', commandId: 'history-other-work', conversationId: 'other-conversation',
  projectId, goal: otherWorkTitle, scope, criteria: configuredProject.defaultCriteria, profileId: configuredProject.defaultProfileId }, actor)
assert.equal(otherWork.status, 'recorded')
const otherWorkView = (await product.application.inspect({ workId: otherWork.workId })).works[0]
assert.equal((await product.application.dispatch({ kind: 'pause_dispatch', commandId: 'history-hold-other-work', conversationId: 'other-conversation',
  expected: { workId: otherWorkView.contract.workId, revision: otherWorkView.contract.revision, digest: otherWorkView.contract.digest },
  expectedHoldRevision: otherWorkView.actions.dispatchHold.revision }, actor)).status, 'recorded')
const source = { id: 'history-payment-source', conversationId, projectId, role: 'user', provenance: 'trusted_user',
  text: 'PAYMENT-HISTORY：支付变更必须保留既有错误码，重复请求返回同一笔结果。', sourceRefs: [], createdAt: now }
store.product.messages.append(source)
store.product.messages.append({ ...source, id: 'history-docs-source', projectId: 'docs-project', text: 'DOCS-HISTORY：文档项目的独立来源。' })
store.product.messages.append({ ...source, id: 'history-other-source', conversationId: 'other-conversation', text: 'OTHER-HISTORY：另一会话的来源。' })
const seeded = []
async function seed(commandId, text, selection = {}) {
  const context = { projectId, conversationId, selections: ['project'], budget: { maxFiles: 24, maxBytes: 65536, maxTokens: 16384 }, ...selection }
  const prepared = await product.operations.assistantContextPrepare({ commandId, text, context }, actor)
  await product.operations.assistantContextSend({ commandId, token: prepared.token }, actor)
  seeded.push({ commandId, prepared }); now = new Date(Date.parse(now) + 1000).toISOString()
}
const targetText = '复核支付接口的原始约束，保持错误码与重复请求处理一致。'
try {
  for (let index = 0; index < 22; index++) await seed(`history-${index}`, `历史需求 ${String(index).padStart(2, '0')}：核对项目范围与兼容性。`)
  await seed('history-other-session', '其他会话的历史约束核对。', { conversationId: 'other-conversation', workId: otherWork.workId, selections: ['work'] })
  await seed('history-docs', '文档项目的独立上下文记录。', { projectId: 'docs-project' })
  store.product.messages.append({ ...source, id: 'history-frozen-source', createdAt: now })
  await seed('history-target', targetText, { selections: ['conversation', 'project'] })
} catch (error) { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }); throw error }
product.start(); await product.execution.effects.idle()
store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...store.product.messages.getById('history-frozen-source'),
  text: 'CURRENT-SOURCE-CHANGED：这是后来变化的来源，不应替换历史正文。' }), 'history-frozen-source')
const baselineCalls = modelCalls, baselineEvents = store.events.cursor()
let sourceScope = 'normal', sourceFault = 'none'
const originalArtifactGet = store.artifacts.get.bind(store.artifacts)
store.artifacts.get = id => {
  const result = originalArtifactGet(id)
  return sourceFault === 'missing' ? undefined : sourceFault === 'unverified' && result ? { ...result, digest: '0'.repeat(64) } : result
}
const records = new ProductContextRecords({ store, principal, bindings: store.workflows.assistant.contextBindings,
  history: store.workflows.assistant.contextHistory, secret: Buffer.alloc(32, 49), now: () => now,
  projects: () => [{ id: projectId, scope: sourceScope === 'narrow' ? { ...scope, allowedPaths: ['src/narrow/'], excludedPaths: ['src/private/'] } : scope },
    { id: 'docs-project', scope: { ...scope, projectId: 'docs-project' } }] })
const socket = portProbe(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
const port = socket.address().port; await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const api = listenLocalHttp(createLocalHttpApp({ application: product.application, principal, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64),
  mode: 'fixture', localDevelopmentAccess: true, allowedOrigins: [origin], operations: product.operations, read: {
    ...product.read, contextSources: async (id, options) => sourceScope === 'normal' && sourceFault === 'none'
      ? product.read.contextSources(id, options) : records.sources(id, options),
    configuration: async () => { const value = await product.read.configuration(); return readonly
      ? { ...value, contextPreviewAvailable: false, assistantContextAvailable: false } : value },
  } }), 0)
await once(api, 'listening')
const vite = await createServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') }, server: { host: '127.0.0.1', port, strictPort: true,
    proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
const cases = [], errors = []
const check = async (id, action) => { try { await action(); cases.push({ id, status: 'PASS' }) } catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error } }
let browser
try {
  await vite.listen(); browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' }), page = await context.newPage()
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  const dialog = page.locator('dialog.context-workspace')
  const openHistory = async () => {
    await page.getByRole('button', { name: '上下文预览', exact: true }).click(); await dialog.waitFor()
    const tab = dialog.getByRole('tab', { name: '使用记录', exact: true })
    if (await tab.count()) await tab.click()
    await dialog.getByRole('heading', { name: '上下文使用记录', exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog', { name: '上下文使用记录', exact: true }).count(), 1)
    await dialog.getByRole('list', { name: '上下文使用记录列表' }).waitFor()
  }
  await page.goto(`${origin}/?conversation=${conversationId}`)
  await check('ACTUAL-A18-HISTORY-PAGES-AND-DOES-NOT-SEND', async () => {
    await openHistory()
    const list = dialog.getByRole('list', { name: '上下文使用记录列表' })
    await list.locator('li').nth(19).waitFor()
    assert.equal(await list.locator('li').count(), 20)
    await dialog.getByRole('button', { name: '更多记录', exact: true }).click()
    await list.locator('li').nth(22).waitFor()
    assert.equal(await list.locator('li').count(), 23)
    assert.equal(modelCalls, baselineCalls); assert.equal(store.events.cursor(), baselineEvents)
  })
  await check('ORIGINAL-SOURCE-IS-READABLE-AND-UNAFFECTED-BY-CURRENT-CHANGES', async () => {
    await dialog.getByRole('button', { name: `查看使用记录：${targetText}`, exact: true }).click()
    const sources = dialog.getByRole('region', { name: '原始上下文内容' })
    await sources.waitFor()
    assert.match(await sources.textContent(), /PAYMENT-HISTORY/)
    assert.doesNotMatch(await sources.textContent(), /CURRENT-SOURCE-CHANGED/)
    const message = sources.locator('.context-source').filter({ hasText: 'PAYMENT-HISTORY' }).first()
    await message.locator(':scope > summary').click()
    await message.locator('.context-readable').waitFor()
    assert.match(await message.locator('.context-readable').textContent(), /保留既有错误码/)
    assert.equal(modelCalls, baselineCalls)
  })
  await check('DESKTOP-MOBILE-SOURCE-READER-AND-BACK-NAVIGATION-FIT', async () => {
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      if (width < 720) await page.waitForFunction(() => document.activeElement?.matches('.context-history-detail-heading h3'))
      await dialog.evaluate(element => { element.scrollTop = 0 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    await dialog.getByRole('button', { name: '返回使用记录', exact: true }).click()
    await page.waitForFunction(text => document.activeElement?.getAttribute('aria-label') === `查看使用记录：${text}`, targetText)
    await dialog.getByRole('list', { name: '上下文使用记录列表' }).waitFor({ state: 'visible' })
    await page.setViewportSize({ width: 1440, height: 900 })
  })
  await check('PROJECT-SWITCH-EMPTY-AND-RETRY-KEEP-RECORDS-SCOPED', async () => {
    await dialog.getByRole('combobox', { name: '记录项目', exact: true }).selectOption('empty-project')
    await dialog.getByRole('status').filter({ hasText: '暂无使用记录' }).waitFor()
    await dialog.getByRole('combobox', { name: '记录项目', exact: true }).selectOption('docs-project')
    await dialog.getByRole('button', { name: '查看使用记录：文档项目的独立上下文记录。', exact: true }).waitFor()
    assert.equal(await dialog.getByRole('list', { name: '上下文使用记录列表' }).locator('li').count(), 1)
    assert.equal(await dialog.getByRole('button', { name: `查看使用记录：${targetText}`, exact: true }).count(), 0)
    await page.route('**/v1/context/history?**', route => route.abort())
    await dialog.getByRole('button', { name: '刷新使用记录', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: '使用记录暂时无法读取' }).waitFor()
    await page.unroute('**/v1/context/history?**')
    await dialog.getByRole('button', { name: '重新读取', exact: true }).click()
    await dialog.getByRole('button', { name: '查看使用记录：文档项目的独立上下文记录。', exact: true }).waitFor()
    await dialog.getByRole('combobox', { name: '记录项目', exact: true }).selectOption(projectId)
    await dialog.getByRole('button', { name: '更多记录', exact: true }).waitFor()
  })
  await check('EXPIRED-CURSOR-RELOADS-HISTORY-WITHOUT-REPLAYING-A-MODEL-REQUEST', async () => {
    now = new Date(Date.parse(now) + 360000).toISOString()
    await dialog.getByRole('button', { name: '更多记录', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: '记录续页已过期或范围已变化' }).waitFor()
    await dialog.getByRole('button', { name: '重新读取', exact: true }).click()
    await dialog.getByRole('button', { name: `查看使用记录：${targetText}`, exact: true }).waitFor()
    await dialog.getByRole('button', { name: `查看使用记录：${targetText}`, exact: true }).click()
    await dialog.getByRole('region', { name: '原始上下文内容' }).waitFor()
    assert.equal(modelCalls, baselineCalls); assert.equal(store.events.cursor(), baselineEvents)
  })
  await check('MODEL-OFF-DOES-NOT-HIDE-MESSAGE-SOURCE-AUDIT', async () => {
    await dialog.getByRole('button', { name: '关闭上下文预览', exact: true }).click()
    providerConfigured = false; await page.reload()
    const article = page.locator('.message.role-user').filter({ hasText: targetText })
    await article.locator('.message-context-audit > summary').click()
    await article.getByRole('region', { name: '原始上下文内容' }).waitFor()
    assert.match(await article.locator('.message-context-audit').textContent(), /PAYMENT-HISTORY/)
    assert.equal(modelCalls, baselineCalls)
  })
  await check('HISTORY-NAVIGATES-TO-THE-ORIGINAL-CONVERSATION', async () => {
    await openHistory()
    await dialog.getByRole('checkbox', { name: '仅当前会话', exact: true }).uncheck()
    await dialog.getByRole('combobox', { name: '记录工作', exact: true }).getByRole('option', { name: otherWorkTitle, exact: true }).waitFor({ state: 'attached' })
    await dialog.getByRole('combobox', { name: '记录工作', exact: true }).selectOption(otherWork.workId)
    await dialog.getByRole('button', { name: '查看使用记录：其他会话的历史约束核对。', exact: true }).click()
    await dialog.getByRole('region', { name: '原始上下文内容' }).waitFor()
    await dialog.getByRole('button', { name: '返回原会话', exact: true }).click()
    await page.waitForURL(url => url.searchParams.get('conversation') === 'other-conversation')
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(modelCalls, baselineCalls)
  })
  await check('READONLY-CAPABILITY-AND-TAB-KEYBOARD-STATE-ARE-ACCURATE', async () => {
    readonly = true; await page.reload(); await openHistory()
    assert.equal(await dialog.getByRole('button', { name: '预览消息', exact: true }).count(), 0)
    assert.equal(await dialog.getByRole('button', { name: '生成预览', exact: true }).count(), 0)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    readonly = false; await page.reload(); await openHistory()
    const historyTab = dialog.getByRole('tab', { name: '使用记录', exact: true })
    await historyTab.focus(); await page.keyboard.press('ArrowLeft')
    assert.equal(await dialog.getByRole('tab', { name: '预览', exact: true }).getAttribute('aria-selected'), 'true')
    await page.keyboard.press('ArrowRight')
    assert.equal(await historyTab.getAttribute('aria-selected'), 'true')
    assert.deepEqual(errors, []); assert.equal(modelCalls, baselineCalls)
  })
  await check('SCOPE-EXPLANATION-IS-EXPLICIT-READ-ONLY-AND-RETRIABLE', async () => {
    await page.goto(`${origin}/?conversation=${conversationId}`); await openHistory()
    await dialog.getByRole('button', { name: `查看使用记录：${targetText}`, exact: true }).click()
    const sources = dialog.getByRole('region', { name: '原始上下文内容', exact: true })
    await sources.getByRole('button', { name: '查看范围说明', exact: true }).waitFor()
    let reads = 0
    const count = request => { if (new URL(request.url()).searchParams.get('scopeReview') === '1') reads++ }
    page.on('request', count)
    assert.equal(reads, 0)
    await sources.getByRole('button', { name: '查看范围说明', exact: true }).click()
    await sources.getByRole('region', { name: '来源范围说明', exact: true }).waitFor()
    assert.equal(reads, 1)
    assert.match(await sources.textContent(), /PAYMENT-HISTORY/)
    await sources.getByRole('button', { name: '重新读取来源正文', exact: true }).click()
    await sources.getByRole('button', { name: '查看范围说明', exact: true }).waitFor()
    await page.route('**/context/sources?scopeReview=1', route => route.abort())
    await sources.getByRole('button', { name: '查看范围说明', exact: true }).click()
    await sources.getByRole('alert').filter({ hasText: '范围说明暂时无法读取' }).waitFor()
    assert.match(await sources.textContent(), /PAYMENT-HISTORY/)
    await page.unroute('**/context/sources?scopeReview=1')
    await sources.getByRole('button', { name: '重试范围说明', exact: true }).click()
    await sources.getByRole('region', { name: '来源范围说明', exact: true }).waitFor()
    page.off('request', count)
    assert.equal(modelCalls, baselineCalls); assert.equal(store.events.cursor(), baselineEvents)
  })
  await check('MISSING-OPTIONAL-DIAGNOSTICS-AND-BAD-IDENTITY-DO-NOT-REPLACE-THE-BODY', async () => {
    const sources = dialog.getByRole('region', { name: '原始上下文内容', exact: true })
    const refresh = async () => { await sources.getByRole('button', { name: '重新读取来源正文', exact: true }).click(); await sources.getByRole('button', { name: '查看范围说明', exact: true }).waitFor() }
    await refresh()
    await page.route('**/context/sources?scopeReview=1', async route => {
      const response = await route.fetch(), value = await response.json(); delete value.scopeReview
      await route.fulfill({ response, json: value })
    })
    await sources.getByRole('button', { name: '查看范围说明', exact: true }).click()
    await sources.getByRole('status').filter({ hasText: '范围说明暂不可用' }).waitFor()
    assert.match(await sources.textContent(), /PAYMENT-HISTORY/)
    await page.unroute('**/context/sources?scopeReview=1'); await refresh()
    await page.route('**/context/sources?scopeReview=1', async route => {
      const response = await route.fetch(), value = await response.json(); value.binding.messageId = 'foreign-message'
      await route.fulfill({ response, json: value })
    })
    await sources.getByRole('button', { name: '查看范围说明', exact: true }).click()
    await sources.getByRole('alert').filter({ hasText: '范围说明暂时无法读取' }).waitFor()
    assert.match(await sources.textContent(), /PAYMENT-HISTORY/)
    await page.unroute('**/context/sources?scopeReview=1')
  })
  await check('ACTUAL-STATE-AND-SCOPE-DIAGNOSTICS-HIDE-UNVERIFIED-BODIES', async () => {
    const sources = dialog.getByRole('region', { name: '原始上下文内容', exact: true })
    for (const [selection, fault, title] of [['narrow', 'none', '当前只读选择与冻结时不同'], ['normal', 'missing', '冻结原文文件缺失'], ['normal', 'unverified', '无法核对冻结原文']]) {
      sourceScope = selection; sourceFault = fault
      await sources.getByRole('button', { name: '重新读取来源正文', exact: true }).click()
      await sources.getByText(title, { exact: true }).waitFor()
      await sources.getByRole('button', { name: '查看范围说明', exact: true }).click()
      const explanation = sources.getByRole('region', { name: '来源范围说明', exact: true }); await explanation.waitFor()
      assert.equal(await sources.locator('.context-source').count(), 0)
      assert.doesNotMatch(await sources.textContent(), /PAYMENT-HISTORY/)
      assert.doesNotMatch(await explanation.textContent(), /src\/private|authority|granted|允许执行/)
      if (selection === 'narrow') {
        assert.match(await explanation.textContent(), /当前允许路径比冻结时更窄/)
        assert.match(await explanation.textContent(), /新增了排除路径/)
        assert.match(await explanation.textContent(), /另有 \d+ 条冻结来源未展示/)
      } else assert.doesNotMatch(await explanation.textContent(), /另有 0|未发现范围变化/)
    }
    assert.equal(modelCalls, baselineCalls); assert.equal(store.events.cursor(), baselineEvents)
  })
  await check('DIAGNOSTIC-DESKTOP-MOBILE-KEYBOARD-AND-LAYOUT', async () => {
    sourceScope = 'narrow'; sourceFault = 'none'
    const sources = dialog.getByRole('region', { name: '原始上下文内容', exact: true })
    await sources.getByRole('button', { name: '重新读取来源正文', exact: true }).click()
    const button = sources.getByRole('button', { name: '查看范围说明', exact: true })
    await button.focus(); await page.keyboard.press('Enter')
    await sources.getByRole('region', { name: '来源范围说明', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), '刷新范围说明')
    for (const [name, width, height] of [['scope-desktop', 1440, 900], ['scope-mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await dialog.evaluate(element => { element.scrollTop = 0 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      const boxes = await sources.locator('.context-record-heading, .context-scope-review').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      }))
      assert.equal(boxes.length, 2); assert.ok(boxes[1].top >= boxes[0].bottom)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    assert.deepEqual(errors, []); assert.equal(modelCalls, baselineCalls); assert.equal(store.events.cursor(), baselineEvents)
  })
  await check('DELAYED-DIAGNOSTIC-CANNOT-REPLACE-A-NEWLY-SELECTED-RECORD', async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); sourceScope = 'normal'; sourceFault = 'none'
    const sources = dialog.getByRole('region', { name: '原始上下文内容', exact: true })
    await sources.getByRole('button', { name: '重新读取来源正文', exact: true }).click()
    await sources.getByRole('button', { name: '查看范围说明', exact: true }).waitFor()
    let markIntercepted, release
    const intercepted = new Promise(resolve => { markIntercepted = resolve }), gate = new Promise(resolve => { release = resolve })
    await page.route('**/context/sources?scopeReview=1', async route => {
      const response = await route.fetch(), value = await response.json(); markIntercepted(); await gate
      await route.fulfill({ response, json: value })
    })
    try {
      await sources.getByRole('button', { name: '查看范围说明', exact: true }).click(); await intercepted
      await dialog.getByRole('button', { name: /^查看使用记录：历史需求/ }).first().click()
      await sources.getByRole('button', { name: '查看范围说明', exact: true }).waitFor()
      const delivered = page.waitForResponse(response => new URL(response.url()).searchParams.get('scopeReview') === '1')
      release(); await delivered
      assert.equal(await sources.getByRole('region', { name: '来源范围说明', exact: true }).count(), 0)
      assert.match(await sources.locator('.context-record-summary').textContent(), /^1 条原始来源/)
      assert.equal(modelCalls, baselineCalls); assert.equal(store.events.cursor(), baselineEvents)
    } finally { release(); await page.unroute('**/context/sources?scopeReview=1') }
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 13 && cases.every(value => value.status === 'PASS') ? 'PASS_CONTEXT_HISTORY_WORKBENCH' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/context-history-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, realModelTurns: 0, nativeTurnStarts: 0,
    seededMockReplies: baselineCalls, readTriggeredMockReplies: modelCalls - baselineCalls, productSchema: store.database.productSchema,
    ports: 'production A SQLite contextBindings/contextHistory/replyResults',
    limitations: ['Actual HTTP/SQLite/React/SSE with local mock provider; not native or installed acceptance',
      'Readonly UI capability is projected by the fixture; backend readonly authorization is tested separately'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
