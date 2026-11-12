import assert from 'node:assert/strict'
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

const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false }, output: { type: 'string' } } })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const output = resolve(values.output ?? 'reports/releases/wave10-integration/context-browser')
mkdirSync(output, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'pa-context-send-browser-')), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(projectRoot); mkdirSync(join(projectRoot, 'src'))
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
git(['add', 'src/.gitkeep']); git(['-c', 'user.name=Context Browser', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Context message fixture'])
const principal = { userId: 'context-browser-user', authorityRef: 'context-browser-authority' }, actor = { ...principal, source: 'local_ui' }
const scope = { projectId: 'payment-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const conversationId = 'payment-conversation', store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
let time = new Date().toISOString(), providerConfigured = true, firstRelease, firstStarted
const firstGate = new Promise(resolve => { firstRelease = resolve }), begun = new Promise(resolve => { firstStarted = resolve })
const requests = []
const provider = {
  status: () => ({ protocol: 'assistant-provider/1', configured: providerConfigured, baseURL: 'https://fixture.invalid/v1', model: 'mock-context',
    models: ['mock-context'], state: providerConfigured ? 'configured' : 'not_configured', secureTransport: true }),
  selectModel() { return this.status() },
  reply: async (messages, onDelta) => {
    requests.push(structuredClone(messages)); onDelta('依据所选来源，')
    if (requests.length === 1) { firstStarted(); await firstGate }
    onDelta('保留既有错误码。')
    return { text: '依据所选来源，保留既有错误码。', model: 'mock-context' }
  },
}
assert.ok(store.workflows.assistant.contextBindings)
assert.ok(store.workflows.assistant.replyResults)
const product = createProductRuntime({ store, principal, stateRoot, scratchProject: projectRoot,
  projects: [{ id: scope.projectId, displayName: '支付服务', scope },
    { id: 'docs-project', displayName: '文档项目', scope: { ...scope, projectId: 'docs-project' } }],
  actionSecret: Buffer.alloc(32, 48), assistantProvider: provider, now: () => time })
const original = { id: 'payment-source', conversationId, projectId: scope.projectId, role: 'user', provenance: 'trusted_user',
  text: 'PAYMENT-SOURCE：支付变更必须保留既有错误码。', sourceRefs: [], createdAt: time }
store.product.messages.append(original)
store.product.messages.append({ ...original, id: 'docs-source', projectId: 'docs-project', text: 'DOCS-SOURCE：另一项目的文档约定。' })
store.product.messages.append({ ...original, id: 'foreign-session', conversationId: 'private-conversation', text: 'FOREIGN-SESSION：另一会话的内容。' })
store.product.messages.append({ ...original, id: 'permission-source', provenance: 'question_answer_display', anchor: { questionId: 'permission-question' }, text: 'PERMISSION-DISPLAY：仅本次批准。' })
const configuration = await product.read.configuration(), configured = configuration.projects.find(value => value.id === scope.projectId)
const created = await product.application.dispatch({ kind: 'create_work', commandId: 'context-held-work', conversationId, projectId: scope.projectId,
  goal: '支付接口幂等校验与兼容性检查', profileId: configured.defaultProfileId, scope, criteria: configured.defaultCriteria }, actor)
assert.equal(created.status, 'recorded')
const work = (await product.application.inspect({ workId: created.workId })).works[0]
assert.equal((await product.application.dispatch({ kind: 'pause_dispatch', commandId: 'context-hold', conversationId,
  expected: { workId: work.contract.workId, revision: work.contract.revision, digest: work.contract.digest }, expectedHoldRevision: work.actions.dispatchHold.revision }, actor)).status, 'recorded')
product.start()
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
const users = () => store.product.messages.page(conversationId, { limit: 200 }).messages.filter(message => message.role === 'user' && message.provenance === 'trusted_user')
let browser
try {
  await vite.listen(); browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' }), page = await context.newPage()
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  const dialog = page.getByRole('dialog', { name: '上下文预览', exact: true })
  const open = async () => { await page.getByRole('button', { name: '上下文预览', exact: true }).click(); await dialog.waitFor() }
  const prepare = async () => {
    const response = page.waitForResponse(result => result.url().endsWith('/v1/assistant/context/prepare') && result.request().method() === 'POST')
    await dialog.getByRole('button', { name: '预览消息', exact: true }).click()
    const result = await response, value = await result.json()
    assert.equal(result.status(), 200, JSON.stringify(value)); await dialog.getByRole('button', { name: '确认发送', exact: true }).waitFor()
    return value
  }
  await check('EXPLICIT-MESSAGE-PREVIEW-IS-READONLY-AND-BOUND-TO-EXACT-DRAFT-AND-SOURCES', async () => {
    await page.goto(`${origin}/?conversation=${conversationId}&work=${created.workId}`)
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('请结合当前工作说明兼容性要求。')
    await open()
    assert.equal(await dialog.getByRole('textbox', { name: '上下文消息', exact: true }).inputValue(), '请结合当前工作说明兼容性要求。')
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await dialog.evaluate(element => { element.scrollTop = 0 })
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}-edit.png`), fullPage: true, animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    const before = { users: users().length, events: store.events.cursor(), requests: requests.length }, prepared = await prepare()
    assert.deepEqual({ users: users().length, events: store.events.cursor(), requests: requests.length }, before)
    assert.equal(prepared.text, '请结合当前工作说明兼容性要求。'); assert.equal(prepared.preview.contract.workId, created.workId)
    const content = JSON.stringify(prepared.preview.sources)
    assert.match(content, /PAYMENT-SOURCE/); assert.doesNotMatch(content, /DOCS-SOURCE|FOREIGN-SESSION|PERMISSION-DISPLAY/)
    assert.equal(await dialog.getByRole('textbox', { name: '上下文消息', exact: true }).count(), 0)
  })
  await check('DESKTOP-AND-MOBILE-CONFIRMATION-AND-SOURCE-DETAIL-FIT', async () => {
    const source = dialog.locator('.context-source').first()
    await source.locator('summary').click()
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await dialog.evaluate(element => { element.scrollTop = 0 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
      await source.scrollIntoViewIfNeeded()
      assert.equal(await source.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}-source.png`), fullPage: true, animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  })
  await check('ONE-CONFIRM-USES-THE-EXISTING-STREAM-AND-PRESERVES-CONTEXT-ONLY-WORK-SELECTION', async () => {
    await dialog.getByRole('button', { name: '确认发送', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' }); await Promise.race([begun, new Promise((_, reject) => setTimeout(() => reject(new Error('Mock provider did not start')), 10000))])
    await page.locator('.streaming-reply').getByText('依据所选来源，', { exact: true }).waitFor()
    assert.equal(requests.length, 1)
    const selected = requests[0].find(message => message.content.includes('user-selected-context/1'))
    assert.equal(selected.role, 'user'); assert.match(selected.content, /PAYMENT-SOURCE/)
    assert.doesNotMatch(selected.content, /DOCS-SOURCE|FOREIGN-SESSION|PERMISSION-DISPLAY/)
    assert.equal(requests[0].at(-1).content, '请结合当前工作说明兼容性要求。')
    const user = users().find(message => message.text === '请结合当前工作说明兼容性要求。')
    assert.equal(user.anchor, undefined); assert.equal(store.domain.tickets.list().length, 1)
    assert.equal(await page.getByRole('textbox', { name: '发送消息', exact: true }).inputValue(), '')
    firstRelease(); await page.getByText('依据所选来源，保留既有错误码。', { exact: true }).first().waitFor()
  })
  await check('MESSAGE-AUDIT-COMES-FROM-THE-ACTUAL-BINDING', async () => {
    const article = page.locator('.message.role-user').filter({ hasText: '请结合当前工作说明兼容性要求。' })
    await article.locator('.message-context-audit > summary').click()
    await article.locator('.message-context-audit li').first().waitFor()
    const user = users().find(message => message.text === '请结合当前工作说明兼容性要求。')
    const binding = store.workflows.assistant.contextBindings.forMessage(user.id)
    assert.equal(await article.locator('.message-context-audit li').count(), binding.sources.length)
    assert.ok((await article.locator('.message-context-audit').textContent()).includes(binding.sources[0].previewDigest))
  })
  await check('EDITED-MODAL-MESSAGE-DOES-NOT-CLEAR-A-DIFFERENT-COMPOSER-DRAFT', async () => {
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('保留这份未发送草稿。')
    await open(); await dialog.getByRole('textbox', { name: '上下文消息', exact: true }).fill('这是另一条明确发送的消息。')
    await prepare(); await dialog.getByRole('button', { name: '确认发送', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('textbox', { name: '发送消息', exact: true }).inputValue(), '保留这份未发送草稿。')
    await product.execution.effects.idle('application.assistant.reply')
  })
  await check('LOST-RESPONSE-RELOAD-RECONCILES-THE-ORIGINAL-COMMAND-AFTER-EXPIRY', async () => {
    await open(); await dialog.getByRole('textbox', { name: '上下文消息', exact: true }).fill('核对原请求，不重复生成。')
    await prepare()
    const sent = []
    await page.route('**/v1/assistant/context/send', async route => {
      sent.push(route.request().postDataJSON())
      if (sent.length === 1) { const response = await route.fetch(); assert.equal((await response.json()).status, 'recorded'); await route.abort() }
      else await route.continue()
    })
    await dialog.getByRole('button', { name: '确认发送', exact: true }).click()
    await dialog.getByText('原请求待核对', { exact: true }).waitFor()
    await product.execution.effects.idle('application.assistant.reply')
    const calls = requests.length, messages = users().length
    providerConfigured = false
    time = new Date(Date.parse(time) + 301000).toISOString()
    await page.reload(); await open()
    const configuration = await (await page.request.get(`${origin}/v1/configuration`)).json()
    assert.equal(configuration.assistantContextAvailable, false)
    assert.equal(await dialog.getByRole('button', { name: '核对原请求', exact: true }).isEnabled(), true)
    await dialog.getByRole('button', { name: '核对原请求', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
    assert.equal(sent.length, 2); assert.deepEqual(sent[0], sent[1]); assert.equal(requests.length, calls); assert.equal(users().length, messages)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('personal-agent:pending-context-message')), null)
    await page.unroute('**/v1/assistant/context/send')
    providerConfigured = true
    await page.reload()
  })
  await check('SOURCE-REJECTION-SETTLES-WITHOUT-SENDING-OR-LOSING-THE-DRAFT', async () => {
    await open(); await dialog.getByRole('textbox', { name: '上下文消息', exact: true }).fill('来源变化后应重新确认。')
    const prepared = await prepare()
    const selected = prepared.preview.sources.find(source => source.kind === 'conversation_message')
    assert.ok(selected)
    const source = store.product.messages.getById(JSON.parse(selected.content).messageId), calls = requests.length, before = users().length
    store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...source, text: 'Changed payment constraints.' }), source.id)
    await dialog.getByRole('button', { name: '确认发送', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: '消息未发送' }).waitFor()
    assert.equal(await dialog.getByRole('textbox', { name: '上下文消息', exact: true }).inputValue(), '来源变化后应重新确认。')
    assert.equal(await page.evaluate(() => sessionStorage.getItem('personal-agent:pending-context-message')), null)
    assert.equal(requests.length, calls); assert.equal(users().length, before)
    store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify(source), source.id)
    await dialog.getByRole('button', { name: '关闭上下文预览', exact: true }).click()
  })
  await check('PROJECT-ISOLATION-INVALID-BUDGET-AND-FIRST-SEND-EXPIRY', async () => {
    await open(); await dialog.getByRole('textbox', { name: '上下文消息', exact: true }).fill('讨论文档项目。')
    await dialog.getByRole('combobox', { name: '上下文项目', exact: true }).selectOption('docs-project')
    const prepared = await prepare()
    assert.equal(prepared.preview.projectId, 'docs-project')
    assert.match(JSON.stringify(prepared.preview.sources), /DOCS-SOURCE/); assert.doesNotMatch(JSON.stringify(prepared.preview.sources), /PAYMENT-SOURCE|FOREIGN-SESSION/)
    await dialog.getByRole('button', { name: '修改消息', exact: true }).click()
    await dialog.locator('.context-budget > summary').click()
    await dialog.getByRole('spinbutton', { name: '最多条目', exact: true }).fill('0')
    assert.equal(await dialog.getByRole('button', { name: '预览消息', exact: true }).isDisabled(), true)
    await dialog.getByRole('spinbutton', { name: '最多条目', exact: true }).fill('24')
    await page.clock.install({ time: new Date(time) }); await prepare(); await page.clock.fastForward(301000)
    await dialog.getByRole('heading', { name: '预览已过期', exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: '确认发送', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: '上下文预览', exact: true }).evaluate(element => element === document.activeElement), true)
  })
  await check('CAPABILITY-OFF-KEEPS-THE-EXISTING-READONLY-PREVIEW', async () => {
    await page.route('**/v1/configuration', async route => { const response = await route.fetch(), value = await response.json(); await route.fulfill({ response, json: { ...value, assistantContextAvailable: false } }) })
    await page.reload(); await open()
    assert.equal(await dialog.getByRole('textbox', { name: '上下文消息', exact: true }).count(), 0)
    assert.equal(await dialog.getByRole('button', { name: '预览消息', exact: true }).count(), 0)
    assert.equal(await dialog.getByRole('button', { name: '生成预览', exact: true }).isEnabled(), true)
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' }); await page.unroute('**/v1/configuration')
    assert.deepEqual(errors, [])
    const replies = store.product.messages.page(conversationId).messages.filter(message => message.provenance === 'reasoner_reply')
    assert.ok(replies.length)
    for (const reply of replies) assert.ok(store.workflows.assistant.replyResults.forReply(reply.id))
  })
} finally {
  firstRelease(); await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 9 && cases.every(value => value.status === 'PASS') ? 'PASS_SELECTED_CONTEXT_WORKBENCH' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/assistant-context-workbench-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, modelCalls: 0, mockProviderCalls: requests.length,
    bindingPort: 'production_A_port', replyResultPort: 'production_A_SQLite', productSchema: store.database.productSchema,
    limitations: ['Actual local HTTP/SQLite/React/SSE plus mock AssistantModelPort; zero real native/model turns',
      'Production A binding/result ports exercised; independent process crashes are covered by a separate suite',
      'Work remains paused; no coding execution or target activation is admitted'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
