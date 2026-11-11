import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer as createPortProbe } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false }, output: { type: 'string' } } })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const { createServer: createViteServer } = await import(require.resolve('vite'))
const output = resolve(values.output ?? 'reports/releases/conversation-catalog')
mkdirSync(output, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'pa-catalog-browser-'))
const stateRoot = join(root, 'state'), scratchProject = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(scratchProject)
const git = args => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
git(['init', '-q']); mkdirSync(join(scratchProject, 'src')); writeFileSync(join(scratchProject, 'src/.gitkeep'), '')
git(['add', 'src/.gitkeep']); git(['-c', 'user.name=Catalog Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Catalog fixture base'])
const principal = { userId: 'catalog-user', authorityRef: 'catalog-authority' }, actor = { ...principal, source: 'local_ui' }
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const scope = { projectId: 'catalog-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const product = createControlledProduct({ store, principal, projects: [{ id: scope.projectId, scope }], actionSecret: Buffer.alloc(32, 1), stateRoot, scratchProject })
for (const [id, text] of [['history-one', '支付方案讨论'], ['history-two', '缓存排查记录']])
  await product.application.dispatch({ kind: 'chat', commandId: `${id}-message`, conversationId: id, projectId: scope.projectId, text }, actor)
await product.application.dispatch({ kind: 'create_work', commandId: 'attention-work', conversationId: 'attention-conversation',
  projectId: scope.projectId, goal: '保持待办可见', profileId: 'profile-fixture-question', scope,
  criteria: [{ id: 'output', kind: 'machine', required: true, description: 'Check output', checkDefinitionRef: FIXTURE_CHECK }] }, actor)
const portProbe = createPortProbe(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening')
const frontendPort = portProbe.address().port
await new Promise(resolve => portProbe.close(resolve))
const origin = `http://127.0.0.1:${frontendPort}`
const app = createLocalHttpApp({ application: product.application, principal, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64),
  allowedOrigins: [origin], mode: 'fixture', localDevelopmentAccess: true, read: product.read, operations: product.operations })
const api = listenLocalHttp(app, 0); await once(api, 'listening')
const vite = await createViteServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
  server: { host: '127.0.0.1', port: frontendPort, strictPort: true, proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
let browser
const cases = [], errors = []
const check = async (id, action) => {
  try { await action(); cases.push({ id, status: 'PASS' }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error }
}
try {
  await vite.listen(); product.start(); browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const history = page.getByRole('region', { name: '历史对话', exact: true })
  const select = text => history.locator('.conversation-select').filter({ hasText: text })
  await check('PERSISTED-DIRECTORY-AND-PER-CONVERSATION-DRAFTS', async () => {
    await page.goto(`${origin}/?conversation=history-one`)
    await select('支付方案讨论').waitFor()
    await page.locator('#composer-input').fill('草稿只留在支付对话')
    await select('缓存排查记录').click()
    assert.equal(await page.locator('#composer-input').inputValue(), '')
    await select('支付方案讨论').click()
    assert.equal(await page.locator('#composer-input').inputValue(), '草稿只留在支付对话')
  })
  await check('SEARCH-RENAME-AND-REFRESH', async () => {
    const search = history.getByRole('searchbox', { name: '搜索历史对话' })
    await search.fill('支付')
    await page.waitForFunction(() => document.querySelectorAll('.conversation-select').length === 1)
    await history.getByRole('button', { name: '重命名：支付方案讨论', exact: true }).click()
    await history.getByRole('textbox', { name: '对话名称' }).fill('支付架构终稿')
    await history.getByRole('button', { name: '保存对话名称', exact: true }).click()
    await select('支付架构终稿').waitFor()
    await search.fill('')
    await select('缓存排查记录').waitFor()
    await page.reload()
    await select('支付架构终稿').waitFor()
    assert.match(await page.locator('.conversation-head').innerText(), /支付架构终稿/)
  })
  await check('ARCHIVE-RESTORE-AND-PENDING-WORK-VISIBILITY', async () => {
    await history.getByRole('button', { name: '归档：支付架构终稿', exact: true }).click()
    await select('支付架构终稿').waitFor({ state: 'hidden' })
    await history.getByRole('checkbox', { name: '包含归档' }).check()
    await select('支付架构终稿').waitFor()
    await history.getByRole('button', { name: '取消归档：支付架构终稿', exact: true }).click()
    await history.getByRole('checkbox', { name: '包含归档' }).uncheck()
    await select('支付架构终稿').waitFor()
    await history.getByRole('button', { name: '归档：保持待办可见', exact: true }).click()
    await history.getByRole('button', { name: '取消归档：保持待办可见', exact: true }).waitFor()
    assert.equal(await select('保持待办可见').count(), 1)
    const snapshot = await product.application.inspect({ conversationId: 'attention-conversation' })
    assert.equal(snapshot.questions.length, 1)
    if (!values['no-capture']) await page.screenshot({ path: join(output, 'desktop.png') })
  })
  await check('PERSISTED-NEW-CONVERSATION-AND-MOBILE-NAVIGATION', async () => {
    await page.locator('.sidebar .new-conversation').click()
    await page.waitForURL(url => url.searchParams.get('conversation')?.startsWith('conversation-') === true)
    const conversationId = new URL(page.url()).searchParams.get('conversation')
    await select('新对话').waitFor()
    await page.reload()
    await select('新对话').waitFor()
    assert.equal(new URL(page.url()).searchParams.get('conversation'), conversationId)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '工作空间', exact: true }).click()
    await select('支付架构终稿').click()
    await page.locator('.sidebar').waitFor({ state: 'hidden' })
    assert.equal(new URL(page.url()).searchParams.get('conversation'), 'history-one')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.getByRole('button', { name: '工作空间', exact: true }).click()
    if (!values['no-capture']) await page.screenshot({ path: join(output, 'mobile.png') })
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 4 && cases.every(value => value.status === 'PASS') ? 'PASS_CONTROLLED_CONVERSATION_CATALOG' : 'FAIL',
    checkedAt: new Date().toISOString(), sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'package.json', 'pnpm-lock.yaml', 'tests/integration/conversation-catalog-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    cases, errors, modelCalls: 0, scope: 'Actual local SQLite/HTTP and controlled child; no native compatibility or whole-product admission' }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
