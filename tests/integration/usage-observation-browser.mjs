import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer as createPortProbe } from 'node:net'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const output = resolve(process.argv[2] ?? 'reports/releases/wave27-insights/browser')
mkdirSync(output, { recursive: true })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const root = mkdtempSync('/tmp/pa-insights-browser-'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.keep'), '')
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'initial'])
const store = new ProductStore({ path: join(stateRoot, 'db.sqlite') }), principal = { userId: 'usage-browser', authorityRef: 'usage-browser-authority' }
const scope = id => ({ projectId: id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })
const product = createControlledProduct({ store, principal, stateRoot, scratchProject: projectRoot, actionSecret: Buffer.alloc(32, 9),
  projects: ['one', 'two'].map(id => ({ id, displayName: id === 'one' ? '甲项目' : '乙项目', scope: scope(id) })) })
const probe = createPortProbe(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
const origin = `http://127.0.0.1:${port}`, app = createLocalHttpApp({ application: product.application, principal,
  bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64), mode: 'fixture', localDevelopmentAccess: true,
  allowedOrigins: [origin], read: product.read, operations: product.operations })
const api = listenLocalHttp(app, 0); await once(api, 'listening')
const vite = await createServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') }, server: { host: '127.0.0.1', port, strictPort: true,
    proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
let browser, before, posts = 0, insightReads = 0
const cases = [], errors = []
const check = async (id, action) => { await action(); cases.push({ id, status: 'PASS' }) }
try {
  product.start()
  for (const [index, id] of ['one', 'two', 'two'].entries()) {
    const created = await product.application.dispatch({ commandId: `browser-${index}`, conversationId: `chat-${index}`,
      kind: 'create_work', projectId: id, goal: 'Bounded question fixture', profileId: 'profile-fixture-question', scope: scope(id),
      criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Fixed output', checkDefinitionRef: FIXTURE_CHECK }] },
      { ...principal, source: 'local_cli' })
    assert.equal(created.status, 'recorded')
    const deadline = Date.now() + 20000
    while (!(await product.application.inspect({ workId: created.workId })).questions.length) {
      assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 20))
    }
  }
  before = store.events.cursor(); await vite.listen(); browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' })
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/v1/insights') insightReads++
    if (request.url().includes('/v1/') && request.method() === 'POST') posts++
  })
  const trial = page.getByRole('region', { name: '试用准备', exact: true })
  const questionValue = trial.locator('.trial-insight-row').filter({ has: page.getByText('提出问题', { exact: true }) }).locator('dd')
  const choose = name => page.getByRole('group', { name: '按项目筛选' }).getByRole('button', { name, exact: true }).click()
  const reload = () => trial.getByRole('button', { name: '重新读取试用状态', exact: true }).click()
  await page.goto(origin)
  await check('DEFAULT-CONVERSATION-DOES-NOT-COLLECT-INSIGHTS', async () => {
    await page.getByRole('button', { name: '试用准备', exact: true }).waitFor(); assert.equal(insightReads, 0)
    await page.getByRole('button', { name: '试用准备', exact: true }).click(); await trial.waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.trial-insight-row')].some(row => row.textContent.includes('提出问题') && row.querySelector('dd').firstChild.textContent === '3'))
    assert.match(await questionValue.textContent(), /^3/); assert.match(await trial.textContent(), /本次 2 个项目/)
  })
  await check('REAL-PROJECT-SELECTION-SCOPES-OBSERVATIONS', async () => {
    await choose('甲项目'); await page.waitForFunction(() => [...document.querySelectorAll('.trial-insight-row')].some(row => row.textContent.includes('提出问题') && row.querySelector('dd').firstChild.textContent === '1'))
    await choose('乙项目'); await page.waitForFunction(() => [...document.querySelectorAll('.trial-insight-row')].some(row => row.textContent.includes('提出问题') && row.querySelector('dd').firstChild.textContent === '2'))
    assert.match(await questionValue.textContent(), /^2/)
  })
  await check('LATE-OLD-PROJECT-RESPONSE-CANNOT-REPLACE-CURRENT-DATA', async () => {
    let capturedResolve; const captured = new Promise(resolve => { capturedResolve = resolve })
    await page.route('**/v1/insights?**', async route => {
      if (new URL(route.request().url()).searchParams.get('projectId') !== 'one') return route.continue()
      const response = await route.fetch(), body = await response.json(); capturedResolve()
      await new Promise(resolve => setTimeout(resolve, 200)); body.metrics = body.metrics.map(row => ({ ...row, value: '999' }))
      try { await route.fulfill({ response, json: body }) } catch { /* The old request is intentionally aborted. */ }
    })
    await choose('甲项目')
    let timer
    try { await Promise.race([captured, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Old request not captured')), 10000) })]) }
    finally { clearTimeout(timer) }
    await choose('乙项目'); await page.waitForFunction(() => [...document.querySelectorAll('.trial-insight-row')].some(row => row.textContent.includes('提出问题') && row.querySelector('dd').firstChild.textContent === '2'))
    await page.waitForTimeout(300); assert.doesNotMatch(await trial.textContent(), /999/)
    await page.unroute('**/v1/insights?**')
  })
  await check('INVALID-OR-FAILED-READ-KEEPS-DATED-OBSERVATION-WITH-SANITIZED-ERROR', async () => {
    await page.route('**/v1/insights?**', route => route.fulfill({ status: 503, json: { error: { code: 'storage_unavailable', message: '/private/key-secret' } } }))
    await reload(); await trial.getByText('使用观察暂时无法读取，请重新读取。', { exact: true }).waitFor()
    assert.match(await trial.textContent(), /上次观察/); assert.doesNotMatch(await trial.textContent(), /key-secret/)
    await page.unroute('**/v1/insights?**')
  })
  await check('LEGACY-OPTIONAL-ABSENCE-KEEPS-THE-OLD-WORKBENCH-USABLE', async () => {
    await page.route('**/v1/insights?**', route => route.fulfill({ status: 404, json: { error: { code: 'invalid_request' } } }))
    await reload(); await trial.getByRole('heading', { name: '使用观察', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await trial.getByRole('button', { name: '检查执行器', exact: true }).count(), 1)
    await page.unroute('**/v1/insights?**'); await choose('全部项目')
    await trial.getByRole('heading', { name: '使用观察', exact: true }).waitFor()
  })
  await check('DESKTOP-MOBILE-SCOPED-DATA-FITS-WITHOUT-WRITES', async () => {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await trial.getByRole('heading', { name: '使用观察', exact: true }).scrollIntoViewIfNeeded()
      assert.equal(await trial.getByRole('heading', { name: '使用观察', exact: true }).evaluate(element =>
        element.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(element).lineHeight) + 2), true)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await trial.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!process.argv.includes('--no-capture')) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    assert.equal(posts, 0); assert.equal(store.events.cursor(), before); assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  const eventDelta = before === undefined ? null : store.events.cursor() - before
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 6 ? 'PASS_ACTUAL_SCOPED_INSIGHTS_APP' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/usage-observation*'], { encoding: 'utf8' }).trim() === '',
    cases, errors, insightReads, postRequests: posts, eventDelta, realModelTurns: 0, nativeTurnStarts: 0,
    scope: 'Actual App/React/Product/Broker/SQLite/HTTP/G Node analyzer, private controlled question fixtures; no installed/native/recovery/benefit admission' }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
}
