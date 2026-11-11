import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer as portProbe } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false } } })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const output = resolve('reports/releases/wave09-integration/context-browser')
mkdirSync(output, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'pa-context-browser-')), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(projectRoot); mkdirSync(join(projectRoot, 'src'))
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
git(['add', 'src/.gitkeep']); git(['-c', 'user.name=Context Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Context browser base'])
const principal = { userId: 'context-user', authorityRef: 'context-authority' }, actor = { ...principal, source: 'local_ui' }
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const scope = { projectId: 'context-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const product = createProductRuntime({ store, principal, projects: [
  { id: scope.projectId, displayName: '支付服务', scope },
  { id: 'other-project', displayName: '文档项目', scope: { ...scope, projectId: 'other-project' } },
  { id: 'unrelated-project', displayName: '独立项目', scope: { ...scope, projectId: 'unrelated-project' } },
  { id: 'expired-project', displayName: '旧项目', scope: { ...scope, projectId: 'expired-project', expiresAt: '2026-01-01T00:00:00.000Z' } },
], stateRoot, scratchProject: projectRoot, actionSecret: Buffer.alloc(32, 23) })
const conversationId = 'context-conversation'
let seq = 0
const dispatch = value => product.application.dispatch({ commandId: `context-command-${++seq}`, conversationId, ...value }, actor)
const source = await dispatch({ kind: 'chat', projectId: scope.projectId, text: 'PAYMENT-SOURCE：支付接口新增幂等校验，保留既有错误码。' })
assert.equal(source.status, 'recorded')
await dispatch({ kind: 'chat', projectId: 'other-project', text: 'FOREIGN-PROJECT：文档项目的独立消息。' })
await dispatch({ kind: 'chat', conversationId: 'other-conversation', projectId: scope.projectId, text: 'FOREIGN-SESSION：另一会话的内部内容。' })
await dispatch({ kind: 'chat', projectId: 'expired-project', text: 'EXPIRED-PROJECT：已过期授权的消息。' })
const sourceMessage = store.product.messages.page(conversationId).messages.find(message => message.projectId === scope.projectId)
const decisionPreview = await product.operations.prepareDecision({ projectId: scope.projectId, conversationId,
  sourceMessageId: sourceMessage.id, content: '支付变更保留既有错误码。', scope }, actor)
assert.equal((await product.operations.decision({ kind: 'record_decision', commandId: 'context-browser-decision', projectId: scope.projectId,
  conversationId, token: decisionPreview.token }, actor)).status, 'recorded')
const configuration = await product.read.configuration(), project = configuration.projects.find(value => value.id === scope.projectId)
const work = await dispatch({ kind: 'create_work', projectId: scope.projectId, goal: '支付接口幂等校验与兼容性检查',
  profileId: project.defaultProfileId, scope, criteria: project.defaultCriteria })
assert.equal(work.status, 'recorded')
const snapshot = () => ({ changes: store.db.prepare('SELECT total_changes() AS n').get().n, cursor: store.events.cursor(),
  works: store.product.works.listByProject(scope.projectId).length,
  queued: store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100).length,
  decisions: store.workflows.assistant.decisions.list({ projectId: scope.projectId, limit: 100 }).records.length })
const socket = portProbe(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
const port = socket.address().port; await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const api = listenLocalHttp(createLocalHttpApp({ application: product.application, principal, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64),
  allowedOrigins: [origin], mode: 'fixture', localDevelopmentAccess: true, read: product.read, operations: product.operations }), 0)
await once(api, 'listening')
const vite = await createServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
const cases = [], errors = []
const check = async (id, action) => { try { await action(); cases.push({ id, status: 'PASS' }) } catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error } }
let browser
try {
  await vite.listen(); browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' }), page = await context.newPage()
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  await page.clock.install()
  const dialog = page.getByRole('dialog', { name: '上下文预览', exact: true })
  const open = async () => { await page.getByRole('button', { name: '上下文预览', exact: true }).click(); await dialog.waitFor() }
  const prepare = async () => {
    const response = page.waitForResponse(value => value.url().endsWith('/v1/context/preview') && value.request().method() === 'POST')
    await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
    const result = await response, body = await result.json()
    assert.equal(result.status(), 200, JSON.stringify(body))
    await dialog.getByRole('region', { name: '上下文读取结果', exact: true }).waitFor()
    return body
  }
  const budget = async () => { const target = dialog.locator('.context-budget'); if (!await target.getAttribute('open')) await target.locator('summary').click() }
  const sources = dialog.getByRole('group', { name: '上下文来源', exact: true })
  const selectedOnly = async labels => {
    for (const label of ['当前工作', '项目决定', '项目信息', '当前会话', '交付元数据']) {
      const checkbox = sources.getByRole('checkbox', { name: label, exact: true })
      if (await checkbox.isEnabled()) await checkbox.setChecked(labels.includes(label))
    }
  }
  await check('EXPLICIT-PREVIEW-READS-REAL-SELECTED-SOURCES-WITHOUT-WRITES', async () => {
    await page.goto(`${origin}/?conversation=${conversationId}&work=${encodeURIComponent(work.workId)}`)
    await open()
    const before = snapshot(), body = await prepare()
    assert.deepEqual(snapshot(), before)
    assert.equal(body.projectId, scope.projectId); assert.equal(body.conversationId, conversationId); assert.equal(body.contract.workId, work.workId)
    assert.equal(body.trust, 'untrusted_data')
    for (const kind of ['work', 'contract', 'decision', 'project_metadata', 'conversation_message']) assert.ok(body.sources.some(source => source.kind === kind), kind)
    assert.match(JSON.stringify(body.sources), /PAYMENT-SOURCE/)
    assert.doesNotMatch(JSON.stringify(body.sources), /FOREIGN-PROJECT|FOREIGN-SESSION|EXPIRED-PROJECT/)
    for (const source of body.sources) assert.equal(source.previewDigest, createHash('sha256').update(source.content).digest('hex'))
    assert.equal(await dialog.locator('.context-source').count(), body.sources.length)
  })
  await check('DESKTOP-MOBILE-SOURCE-AND-DIGEST-DETAIL-DO-NOT-OVERFLOW', async () => {
    const source = dialog.locator('.context-source').first()
    await source.locator('summary').click()
    assert.ok((await source.locator('pre').textContent()).length > 0)
    await source.getByText('来源摘要', { exact: true }).waitFor(); await source.getByText('预览摘要', { exact: true }).waitFor()
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await dialog.evaluate(element => { element.scrollTop = 0 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
      await source.scrollIntoViewIfNeeded()
      assert.equal(await source.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}-source.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  })
  await check('SOURCE-SELECTION-EMPTY-STATE-AND-INVALID-BUDGET', async () => {
    await selectedOnly([])
    assert.equal(await dialog.getByRole('button', { name: '生成预览', exact: true }).isDisabled(), true)
    await selectedOnly(['交付元数据'])
    const empty = await prepare()
    assert.equal(empty.status, 'insufficient'); assert.equal(empty.sources.length, 0)
    await dialog.getByRole('heading', { name: '没有可用来源', exact: true }).waitFor()
    await selectedOnly(['项目信息', '当前会话'])
    await budget(); await dialog.getByRole('spinbutton', { name: '最多条目', exact: true }).fill('0')
    assert.equal(await dialog.getByRole('button', { name: '生成预览', exact: true }).isDisabled(), true)
    await dialog.getByRole('spinbutton', { name: '最多条目', exact: true }).fill('64')
    await dialog.getByRole('spinbutton', { name: '最多字节', exact: true }).fill('4194304')
    await dialog.getByRole('spinbutton', { name: '最多估算 token', exact: true }).fill('500000')
    const clamped = await prepare()
    assert.deepEqual(clamped.budgetClamped.sort(), ['maxBytes', 'maxFiles', 'maxTokens'])
    assert.deepEqual(clamped.budget, { maxFiles: 32, maxBytes: 131072, maxTokens: 32768 })
    await dialog.getByText(/已按实例上限收紧预算/).waitFor()
    await dialog.getByRole('spinbutton', { name: '最多字节', exact: true }).fill('1')
    const omitted = await prepare()
    assert.equal(omitted.status, 'insufficient'); assert.ok(omitted.omitted.length > 0)
    await dialog.locator('.context-omissions > summary').click()
    assert.ok(await dialog.locator('.context-omissions li').count() > 0)
  })
  await check('PROJECT-CHANGE-CLEARS-PREVIEW-AND-PRESERVES-ORIGINAL-CONVERSATION', async () => {
    await dialog.getByRole('spinbutton', { name: '最多字节', exact: true }).fill('65536')
    await dialog.getByRole('combobox', { name: '上下文项目', exact: true }).selectOption('other-project')
    assert.equal(await dialog.getByRole('region', { name: '上下文读取结果', exact: true }).count(), 0)
    assert.equal(await sources.getByRole('checkbox', { name: '当前工作', exact: true }).isDisabled(), true)
    assert.equal(await sources.getByRole('checkbox', { name: '交付元数据', exact: true }).isDisabled(), true)
    const foreign = await prepare()
    assert.equal(foreign.projectId, 'other-project'); assert.equal(foreign.conversationId, conversationId)
    assert.match(JSON.stringify(foreign.sources), /FOREIGN-PROJECT/); assert.doesNotMatch(JSON.stringify(foreign.sources), /PAYMENT-SOURCE|FOREIGN-SESSION/)
    await dialog.getByRole('combobox', { name: '上下文项目', exact: true }).selectOption('unrelated-project')
    await dialog.getByRole('button', { name: '生成预览', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: '所选项目与当前会话不匹配' }).waitFor()
    assert.equal(await dialog.getByRole('region', { name: '上下文读取结果', exact: true }).count(), 0)
    await dialog.getByRole('combobox', { name: '上下文项目', exact: true }).selectOption(scope.projectId)
    await dialog.getByRole('combobox', { name: '上下文工作', exact: true }).selectOption(work.workId)
    const restored = await prepare()
    assert.equal(restored.contract.workId, work.workId); assert.doesNotMatch(JSON.stringify(restored.sources), /FOREIGN-PROJECT|FOREIGN-SESSION/)
  })
  await check('EXPIRED-PROJECT-DISABLES-PREVIEW-WITH-AN-ACTIONABLE-STATE', async () => {
    await dialog.getByRole('combobox', { name: '上下文项目', exact: true }).selectOption('expired-project')
    await dialog.getByRole('alert').filter({ hasText: '项目授权已过期' }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: '生成预览', exact: true }).isDisabled(), true)
    assert.equal(await dialog.getByRole('region', { name: '上下文读取结果', exact: true }).count(), 0)
    await dialog.getByRole('combobox', { name: '上下文项目', exact: true }).selectOption(scope.projectId)
    await dialog.getByRole('combobox', { name: '上下文工作', exact: true }).selectOption(work.workId)
    await prepare()
    assert.equal(await dialog.getByRole('button', { name: '复制预览', exact: true }).isEnabled(), true)
    await page.clock.fastForward(301000)
    await dialog.getByRole('heading', { name: '预览已过期', exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: '复制预览', exact: true }).isDisabled(), true)
  })
  await check('KEYBOARD-CLOSE-RESTORES-FOCUS-AND-NO-BUSINESS-EFFECTS', async () => {
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: '上下文预览', exact: true }).evaluate(element => element === document.activeElement), true)
    assert.equal(store.product.works.listByProject(scope.projectId).length, 1)
    assert.equal(store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100).length, 1)
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 6 && cases.every(value => value.status === 'PASS') ? 'PASS_CONTEXT_HTTP_BROWSER' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/context-workbench-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, modelCalls: 0,
    limitations: ['Actual local HTTP/SQLite/A/C readers and UI; runtime effects deliberately not started',
      'Expiry UI uses browser clock advancement over an actual server-issued expiry',
      'No model/native/context attachment or restored target activation admission'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
