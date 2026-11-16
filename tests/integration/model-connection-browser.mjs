import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer as createPortProbe } from 'node:net'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct } from '../../apps/coordinator/product/runtime.ts'
import { PrivateModelProvider } from '../../apps/coordinator/product/model-provider.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const output = resolve(process.argv[2] ?? 'reports/releases/wave35-integration/model-browser')
mkdirSync(output, { recursive: true })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const root = mkdtempSync('/tmp/pa-model-browser-'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.keep'), '')
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'initial'])
const store = new ProductStore({ path: join(stateRoot, 'db.sqlite') }), principal = { userId: 'model-browser', authorityRef: 'model-browser-authority' }
const file = join(root, 'private/model.json'), provider = new PrivateModelProvider(file)
let modelRequests = 0, saves = 0
provider.prepareReply = () => { modelRequests++; throw new Error('Configuration must not send a model request') }
const product = createControlledProduct({ store, principal, stateRoot, scratchProject: projectRoot, actionSecret: Buffer.alloc(32, 11),
  assistantProvider: provider, projects: [{ id: 'one', displayName: '模型配置测试项目',
    scope: { projectId: 'one', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } }] })
const probe = createPortProbe(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
const origin = `http://127.0.0.1:${port}`, app = createLocalHttpApp({ application: product.application, principal,
  bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64), mode: 'fixture', localDevelopmentAccess: true,
  allowedOrigins: [origin], read: product.read, operations: product.operations })
const api = listenLocalHttp(app, 0); await once(api, 'listening')
const vite = await createServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') }, server: { host: '127.0.0.1', port, strictPort: true,
    proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
let browser, before, commands = 0
const cases = [], errors = [], secret = 'fixture-browser-transient-model-key'
const check = async (id, action) => { await action(); cases.push({ id, status: 'PASS' }) }
try {
  product.start(); before = store.events.cursor(); await vite.listen(); browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/v1/assistant/connection') saves++
    if (new URL(request.url()).pathname === '/v1/commands') commands++
  })
  await page.goto(origin)
  await page.getByRole('button', { name: '偏好设置', exact: true }).click()
  const panel = page.getByRole('region', { name: '模型设置', exact: true })
  const endpoint = panel.getByLabel('模型端点', { exact: true }), model = panel.getByLabel('模型名称', { exact: true })
  const key = panel.getByLabel('API Key', { exact: true }), save = panel.getByRole('button', { name: '保存配置', exact: true })
  await check('ACTUAL-SETTINGS-SAVES-PRIVATE-CONFIGURATION-IN-STRICTMODE-WITHOUT-MODEL-TURN', async () => {
    await endpoint.fill('https://models.invalid/v1'); await model.fill('model-one'); await key.fill(secret)
    await save.click(); await panel.getByText('已保存到本机；尚未发送验证请求。', { exact: true }).waitFor()
    assert.equal(await key.inputValue(), ''); assert.equal(await save.isEnabled(), true)
    assert.equal(provider.status().state, 'configured'); assert.equal(provider.status().model, 'model-one')
    assert.equal(JSON.parse(readFileSync(file)).apiKey, secret); assert.equal(modelRequests, 0)
    assert.equal(saves, 1); assert.equal(await panel.innerText().then(text => text.includes(secret)), false)
    assert.equal(await page.evaluate(secret => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(secret), secret), false)
  })
  await check('REOPEN-RETURNS-CURRENT-MODEL-WITHOUT-SECRET', async () => {
    await panel.getByRole('button', { name: '关闭模型设置', exact: true }).click()
    await page.getByRole('button', { name: '偏好设置', exact: true }).click()
    assert.equal(await endpoint.inputValue(), 'https://models.invalid/v1'); assert.equal(await model.inputValue(), 'model-one')
    assert.equal(await key.inputValue(), '')
  })
  await check('REMOTE-HTTP-REQUIRES-EXPLICIT-CONSENT-AND-SAVING-KEEPS-STATUS-CONFIGURED', async () => {
    await endpoint.fill('http://models.invalid/v1'); await model.fill('model-http'); await key.fill(secret)
    await save.click(); await panel.getByText('使用 HTTP 需要明确允许未加密传输。', { exact: true }).waitFor()
    assert.equal(saves, 1)
    await panel.getByRole('checkbox', { name: '允许未加密的 HTTP（密钥会随请求发送）', exact: true }).check()
    await save.click(); await panel.getByText('已保存到本机；尚未发送验证请求。', { exact: true }).waitFor()
    assert.equal(provider.status().secureTransport, false); assert.equal(provider.status().state, 'configured')
    assert.equal(modelRequests, 0); assert.equal(saves, 2)
  })
  await check('FAILED-OR-LEGACY-SAVE-CLEARS-KEY-AND-KEEPS-CURRENT-CONFIGURATION', async () => {
    for (const [status, code] of [[503, 'storage_unavailable'], [422, 'unsupported_capability']]) {
      await page.route('**/v1/assistant/connection', route => route.fulfill({ status, json: { error: { code, message: secret } } }))
      await key.fill(secret); await save.click()
      await panel.getByRole('alert').waitFor(); assert.equal(await key.inputValue(), '')
      assert.equal((await panel.innerText()).includes(secret), false)
      assert.equal(provider.status().model, 'model-http')
      await page.unroute('**/v1/assistant/connection')
    }
  })
  await check('CLOSING-A-PENDING-FORM-CANNOT-UPDATE-THE-REOPENED-FORM', async () => {
    let release, capturedResolve
    const captured = new Promise(resolve => { capturedResolve = resolve }), gate = new Promise(resolve => { release = resolve })
    await page.route('**/v1/assistant/connection', async route => {
      capturedResolve(); await gate
      await route.fulfill({ status: 503, json: { error: { code: 'storage_unavailable', message: secret } } })
    })
    try {
      await key.fill(secret); await save.click(); await captured
      await panel.getByRole('button', { name: '关闭模型设置', exact: true }).click()
      await page.getByRole('button', { name: '偏好设置', exact: true }).click()
      release(); await page.waitForTimeout(150)
      assert.equal(await key.inputValue(), ''); assert.equal(await panel.getByRole('alert').count(), 0)
      assert.equal((await panel.innerText()).includes(secret), false)
    } finally { release(); await page.unroute('**/v1/assistant/connection') }
  })
  await check('ACTUAL-DESKTOP-MOBILE-CONFIGURATION-FITS-AND-DOES-NOT-DISPATCH-WORK', async () => {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await save.scrollIntoViewIfNeeded()
      const saveBox = await save.boundingBox()
      assert.ok(saveBox && saveBox.y >= 52 && saveBox.y + saveBox.height <= height - (width < 720 ? 56 : 0))
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    assert.equal(commands, 0); assert.equal(store.events.cursor(), before); assert.equal(modelRequests, 0); assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  const eventDelta = before === undefined ? null : store.events.cursor() - before
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 6 ? 'PASS_ACTUAL_MODEL_CONFIGURATION_APP' : 'FAIL', cases, errors, saves, commands, eventDelta,
    modelRequests, realModelTurns: 0, nativeTurnStarts: 0,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/model-connection*'], { encoding: 'utf8' }).trim() === '',
    scope: 'Actual StrictMode App/HTTP/Product/private provider and local settings; configuration persistence only, no model turn/installed/native/recovery/value admission' }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
}
