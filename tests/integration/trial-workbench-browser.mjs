import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createPortProbe } from 'node:net'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { values } = parseArgs({ options: { output: { type: 'string' }, 'no-capture': { type: 'boolean', default: false } } })
const output = resolve(values.output ?? 'reports/releases/wave26-integration/browser')
mkdirSync(output, { recursive: true })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const root = mkdtempSync('/tmp/pa-trial-workbench-'), stateRoot = join(root, 'state'), scratch = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(join(scratch, 'src'), { recursive: true })
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const principal = { userId: 'trial-browser-user', authorityRef: 'trial-browser-authority' }
let configured = false, readonly = false, fixture = false, modelCalls = 0, readinessReads = 0, writes = 0
const status = () => ({ protocol: 'assistant-provider/1', configured, baseURL: configured ? 'https://fixture.invalid/v1' : null,
  model: configured ? 'trial-local-mock' : null, models: configured ? ['trial-local-mock'] : [],
  state: configured ? 'configured' : 'not_configured', secureTransport: configured })
const product = createProductRuntime({ store, stateRoot, scratchProject: scratch, projects: [], principal,
  actionSecret: Buffer.alloc(32, 65), executionUnavailable: 'operator_disabled',
  assistantProvider: { status, selectModel: status, reply: async () => { modelCalls++; throw new Error('Trial navigation must not call a model') } } })
const beforeEvents = store.events.cursor()
const probe = createPortProbe(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
const origin = `http://127.0.0.1:${port}`
const base = { application: product.application, principal, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64),
  localDevelopmentAccess: true, allowedOrigins: [origin], read: product.read, operations: product.operations }
const personal = createLocalHttpApp({ ...base, mode: 'personal' }), restored = createLocalHttpApp({ ...base, mode: 'personal', startupMode: 'recovery_readonly' })
const controlled = createLocalHttpApp({ ...base, mode: 'fixture' })
const api = listenLocalHttp({ fetch: (...args) => (readonly ? restored : fixture ? controlled : personal).fetch(...args) }, 0)
await once(api, 'listening')
const vite = await createServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') }, server: { host: '127.0.0.1', port, strictPort: true,
    proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
const cases = [], errors = []
const check = async (id, action) => { try { await action(); cases.push({ id, status: 'PASS' }) } catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error } }
let browser
try {
  await vite.listen(); browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (new URL(request.url()).pathname === '/v1/readiness') readinessReads++
    if (request.url().includes('/v1/') && request.method() === 'POST') writes++ })
  const trial = page.getByRole('region', { name: '试用准备', exact: true })
  const openTrial = async () => { await page.getByRole('button', { name: '试用准备', exact: true }).click(); await trial.waitFor(); await trial.getByText('个人模式', { exact: true }).waitFor() }
  await page.goto(origin)
  await check('ACTUAL-APP-KEEPS-CONVERSATION-DEFAULT-AND-READS-ON-TRIAL-ENTRY', async () => {
    await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '主对话视图', exact: true }).getAttribute('aria-current'), 'page')
    assert.equal(readinessReads, 0)
    await openTrial()
    assert.equal(await page.getByRole('button', { name: '试用准备', exact: true }).getAttribute('aria-current'), 'page')
    await trial.getByText('未配置', { exact: true }).waitFor()
    assert.equal(readinessReads, 1); assert.equal(modelCalls, 0); assert.equal(writes, 0)
    assert.equal(store.events.cursor(), beforeEvents)
  })
  await check('MODEL-CALLBACK-OPENS-EXISTING-SETTINGS-WITHOUT-SENDING', async () => {
    await trial.getByRole('button', { name: '配置对话模型', exact: true }).click()
    await page.getByRole('region', { name: '模型设置', exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭模型设置', exact: true }).click()
    assert.equal(modelCalls, 0); assert.equal(writes, 0)
  })
  await check('IMPORT-CALLBACK-OPENS-THE-EXISTING-FORM-WITHOUT-CREATING-A-PROJECT', async () => {
    await trial.getByRole('button', { name: '导入项目', exact: true }).click()
    const form = page.getByRole('form', { name: '导入本地项目', exact: true }); await form.waitFor()
    await form.getByRole('button', { name: '取消导入', exact: true }).click()
    await form.waitFor({ state: 'hidden' }); await openTrial()
    assert.equal(store.events.cursor(), beforeEvents); assert.equal(writes, 0)
  })
  await check('EXECUTOR-AND-CONVERSATION-CALLBACKS-KEEP-THE-ORIGINAL-DRAFT', async () => {
    await trial.getByRole('button', { name: '检查执行器', exact: true }).click()
    await page.getByRole('heading', { name: '执行器连接', exact: true }).waitFor()
    await page.getByRole('button', { name: '主对话视图', exact: true }).click()
    await page.locator('.composer textarea').fill('尚未发送的原始草稿')
    configured = true; await openTrial()
    await trial.getByText('已配置', { exact: true }).waitFor()
    await trial.getByRole('button', { name: '打开主对话', exact: true }).click()
    assert.equal(await page.locator('.composer textarea').inputValue(), '尚未发送的原始草稿')
    assert.equal(modelCalls, 0); assert.equal(writes, 0)
    await openTrial()
  })
  await check('FAILED-OR-INVALID-READINESS-PRESERVES-VALID-OBSERVATIONS-AND-RETRIES', async () => {
    await page.route('**/v1/readiness', route => route.abort())
    await trial.getByRole('button', { name: '重新读取试用状态', exact: true }).click()
    await trial.getByRole('alert').waitFor(); assert.match(await trial.textContent(), /上次读取结果/)
    assert.match(await trial.textContent(), /个人模式/)
    await page.unroute('**/v1/readiness')
    await trial.getByRole('button', { name: '重试', exact: true }).click()
    await trial.getByRole('alert').waitFor({ state: 'hidden' })
    await page.route('**/v1/readiness', async route => {
      const response = await route.fetch(), body = await response.json(); body.authorization = 'granted'
      await route.fulfill({ response, json: body })
    })
    await trial.getByRole('button', { name: '重新读取试用状态', exact: true }).click(); await trial.getByRole('alert').waitFor()
    assert.match(await trial.textContent(), /个人模式/); assert.doesNotMatch(await trial.textContent(), /granted/)
    await page.unroute('**/v1/readiness'); await trial.getByRole('button', { name: '重试', exact: true }).click()
    await trial.getByRole('alert').waitFor({ state: 'hidden' })
    assert.equal(modelCalls, 0); assert.equal(writes, 0)
  })
  await check('LEGACY-OPTIONAL-ABSENCE-IS-UNKNOWN-AND-DOES-NOT-DISABLE-OLD-VIEWS', async () => {
    await page.route('**/v1/readiness', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid_request' } }) }))
    await trial.getByRole('button', { name: '重新读取试用状态', exact: true }).click()
    await trial.getByRole('status').filter({ hasText: '当前服务未提供试用状态接口' }).waitFor()
    assert.equal(await trial.getByText('配置已具备', { exact: true }).count(), 0)
    await trial.getByRole('button', { name: '打开主对话', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: '主对话视图', exact: true }).getAttribute('aria-current'), 'page')
    await page.unroute('**/v1/readiness'); await openTrial()
  })
  await check('ACTUAL-READONLY-AND-FIXTURE-HTTP-MODES-NEVER-OFFER-NATIVE-DISPATCH', async () => {
    readonly = true; await page.reload(); await openTrial()
    await trial.getByText('只读恢复', { exact: true }).first().waitFor()
    assert.equal(await trial.getByRole('button', { name: '导入项目', exact: true }).count(), 0)
    assert.equal(await trial.getByText('配置已具备', { exact: true }).count(), 0)
    readonly = false; fixture = true; await page.reload()
    await page.getByRole('button', { name: '试用准备', exact: true }).click()
    await trial.getByText('固定流程', { exact: true }).first().waitFor()
    assert.equal(await trial.getByText('配置已具备', { exact: true }).count(), 0)
    assert.equal(modelCalls, 0); assert.equal(writes, 0)
  })
  await check('DESKTOP-MOBILE-NAVIGATION-FOCUS-AND-TEXT-FIT', async () => {
    fixture = false; await page.reload(); await openTrial()
    const reload = trial.getByRole('button', { name: '重新读取试用状态', exact: true })
    const read = page.waitForResponse(response => new URL(response.url()).pathname === '/v1/readiness')
    await reload.focus(); await page.keyboard.press('Enter'); await read
    assert.equal(await reload.evaluate(element => document.activeElement === element), true)
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await trial.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      const boxes = await page.locator('.rail-top .rail-button').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
      }))
      assert.equal(boxes.length, 5)
      if (width < 720) for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].left >= boxes[i - 1].right)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    assert.deepEqual(errors, []); assert.equal(modelCalls, 0); assert.equal(writes, 0); assert.equal(store.events.cursor(), beforeEvents)
  })
} finally {
  const eventDelta = store.events.cursor() - beforeEvents
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 8 && cases.every(value => value.status === 'PASS') ? 'PASS_ACTUAL_TRIAL_WORKBENCH' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/trial-workbench-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, readinessReads, postRequests: writes, modelCalls,
    eventDelta, realModelTurns: 0, nativeTurnStarts: 0,
    limitations: ['Actual App/React/readiness HTTP/SQLite with unstarted execution and a no-send local provider stub',
      'Readonly/fixture cases switch real HTTP guards over the private normal Store; this is not snapshot/daemon recovery',
      'No G summary, H toolkit, native profile or installed release admission'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
