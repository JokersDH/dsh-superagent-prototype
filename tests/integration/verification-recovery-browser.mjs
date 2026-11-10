import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer as createPortProbe } from 'node:net'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { ApplicationFault } from '../../packages/application/dist/index.js'
import { createControlledProduct } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const { createServer: createViteServer } = await import(require.resolve('vite'))
const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false }, output: { type: 'string' } } })
const output = resolve(values.output ?? 'reports/releases/verification-recovery')
mkdirSync(output, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'pa-recheck-browser-'))
const stateRoot = join(root, 'state'), scratchProject = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(scratchProject)
const git = args => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
git(['init', '-q'])
mkdirSync(join(scratchProject, 'src'))
writeFileSync(join(scratchProject, 'src/.gitkeep'), '')
git(['add', 'src/.gitkeep'])
git(['-c', 'user.name=Recovery Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Recovery fixture base'])
const principal = { userId: 'recovery-browser-user', authorityRef: 'recovery-browser-authority' }
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const product = createControlledProduct({ store,
  principal, projects: [{ id: 'recovery-project', scope: { projectId: 'recovery-project', allowedPaths: ['src/'],
    excludedPaths: [], externalActions: [] } }], actionSecret: Buffer.alloc(32, 1), stateRoot, scratchProject })
const verify = product.completion.verify.bind(product.completion)
product.completion.verify = async () => { throw new ApplicationFault('verification_failed', 'private-diagnostic-sentinel') }
const portProbe = createPortProbe()
portProbe.listen(0, '127.0.0.1')
await once(portProbe, 'listening')
const frontendPort = portProbe.address().port
await new Promise(resolve => portProbe.close(resolve))
const origin = `http://127.0.0.1:${frontendPort}`
const api = listenLocalHttp(createLocalHttpApp({ application: product.application, principal, bootstrapToken: 'b'.repeat(64),
  apiToken: 'a'.repeat(64), allowedOrigins: [origin], mode: 'fixture', localDevelopmentAccess: true,
  read: product.read, operations: product.operations }), 0)
await once(api, 'listening')
const vite = await createViteServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
  server: { host: '127.0.0.1', port: frontendPort, strictPort: true,
    proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
let browser
const cases = [], errors = []
const check = async (id, action) => {
  try { await action(); cases.push({ id, status: 'PASS' }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error }
}
try {
  await vite.listen()
  product.start()
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  await check('CREATE-AND-EXPOSE-PERSISTED-VERIFICATION-BLOCK', async () => {
    await page.goto(`${origin}/?conversation=recovery-browser`)
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    await page.locator('.new-work').getByRole('combobox', { name: '项目', exact: true }).selectOption('recovery-project')
    await page.locator('.new-work select').last().selectOption('profile-fixture-pass')
    await page.locator('.new-work textarea').fill('恢复验证浏览器任务')
    await page.locator('.new-work').getByRole('button', { name: '创建委托', exact: true }).click()
    await page.getByRole('region', { name: '验证运行状态', exact: true }).getByText('验证受阻，自动重试已停止').waitFor()
    assert.equal(await page.getByRole('button', { name: '重新检查', exact: true }).isEnabled(), true)
    assert.doesNotMatch(await page.locator('body').innerText(), /private-diagnostic-sentinel/)
    if (!values['no-capture']) await page.screenshot({ path: join(output, 'desktop-blocked.png') })
  })
  await check('BLOCK-SURVIVES-RELOAD-AND-FITS-NARROW-DETAIL', async () => {
    await page.reload()
    await page.locator('.work-card').filter({ hasText: '恢复验证浏览器任务' }).click()
    await page.getByRole('button', { name: '重新检查', exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.getByRole('button', { name: '重新检查', exact: true }).scrollIntoViewIfNeeded()
    if (!values['no-capture']) await page.screenshot({ path: join(output, 'mobile-blocked.png') })
  })
  await check('RECHECK-VERIFIES-SAME-WRITER-AND-DELIVERS', async () => {
    product.completion.verify = verify
    await page.getByRole('button', { name: '重新检查', exact: true }).click()
    const accept = page.getByRole('button', { name: '接受当前候选', exact: true })
    await accept.waitFor()
    assert.equal(await page.getByRole('button', { name: '重新检查', exact: true }).count(), 0)
    const configuration = await (await page.request.get(`${origin}/v1/configuration`)).json()
    assert.equal(configuration.reviewActivityAvailable, true)
    await page.bringToFront()
    await page.waitForFunction(() => document.visibilityState === 'visible' && document.hasFocus())
    await page.waitForTimeout(250)
    await accept.click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    const observation = store.events.after(0, 5000).find(event => event.topic === 'application.candidate.accepted')
    assert.ok(observation)
    const timing = observation.payload.reviewTiming
    assert.ok(timing.readyToAcceptanceMs > 0)
    assert.ok(timing.activeReviewMs > 0 && timing.activeReviewMs <= timing.readyToAcceptanceMs)
    assert.equal(timing.activeReviewSource, 'ui_visibility_proxy')
    assert.equal(timing.activeReviewCompleteness, 'partial')
    const frames = readdirSync(join(stateRoot, 'receipts')).flatMap(file => readFileSync(join(stateRoot, 'receipts', file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
    assert.equal(frames.filter(frame => frame.type === 'begin').length, 1)
    await page.reload()
    await page.getByRole('button', { name: '工作空间', exact: true }).click()
    await page.locator('.work-card').filter({ hasText: '恢复验证浏览器任务' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    assert.deepEqual(errors, [])
  })
  await check('FAILED-ACTIVITY-TRANSPORT-DOES-NOT-BLOCK-ACCEPTANCE', async () => {
    const rejectedRequests = []
    await page.route('**/v1/works/*/review-activity', async route => { rejectedRequests.push(route.request().url()); await route.abort() })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    await page.locator('.new-work').getByRole('combobox', { name: '项目', exact: true }).selectOption('recovery-project')
    await page.locator('.new-work select').last().selectOption('profile-fixture-pass')
    await page.locator('.new-work textarea').fill('遥测失败仍可接受')
    await page.locator('.new-work').getByRole('button', { name: '创建委托', exact: true }).click()
    const accept = page.getByRole('button', { name: '接受当前候选', exact: true })
    await accept.waitFor()
    await page.bringToFront()
    await page.waitForFunction(() => document.hasFocus())
    await page.waitForTimeout(250)
    await accept.click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    assert.ok(rejectedRequests.length > 0)
    const observations = store.events.after(0, 5000).filter(event => event.topic === 'application.candidate.accepted')
    assert.equal(observations.length, 2)
    assert.equal(observations[1].payload.reviewTiming.activeReviewMs, null)
    assert.equal(observations[1].payload.reviewTiming.activeReviewSource, 'unknown')
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close()
  await vite.close()
  api.closeAllConnections()
  await new Promise(resolve => api.close(resolve))
  await product.close()
  store.close()
  const report = { status: cases.length === 4 && cases.every(value => value.status === 'PASS') ? 'PASS_CONTROLLED_VERIFICATION_RECOVERY_BROWSER' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'package.json', 'tests/integration/verification-recovery-browser.mjs', 'tests/integration/product-execution.case.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, modelCalls: 0,
    limitations: ['Actual local HTTP/SQLite and controlled child; no native/model compatibility claim',
      'Fault injected on the isolated completion port; no production fault-injection endpoint',
      'Focused visible candidate detail is a partial activity proxy, not actual human thinking time'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
  rmSync(root, { recursive: true, force: true })
}
