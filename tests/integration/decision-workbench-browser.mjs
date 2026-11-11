import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer as probe } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false } } })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const output = resolve('reports/releases/wave06-main-checkpoint/decisions-browser'), captures = resolve('apps/console/.impeccable/review')
mkdirSync(output, { recursive: true }); mkdirSync(captures, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'pa-decisions-browser-')), stateRoot = join(root, 'state'), scratchProject = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(scratchProject); mkdirSync(join(scratchProject, 'src'))
const git = args => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
git(['init', '-q']); writeFileSync(join(scratchProject, 'src/.gitkeep'), ''); git(['add', 'src/.gitkeep'])
git(['-c', 'user.name=Decision Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Decision fixture base'])
const principal = { userId: 'decision-user', authorityRef: 'decision-authority' }, actor = { ...principal, source: 'local_ui' }
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const scope = { projectId: 'decision-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const product = createControlledProduct({ store, principal, projects: [{ id: scope.projectId, displayName: '支付服务', scope }],
  actionSecret: Buffer.alloc(32, 7), stateRoot, scratchProject })
await product.application.dispatch({ kind: 'chat', commandId: 'source-message', conversationId: 'decision-conversation', projectId: scope.projectId,
  text: '支付接口新增幂等校验。所有变更都必须通过现有测试，再由我确认接受；不要自动合并。' }, actor)
const socket = probe(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
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
const records = () => store.workflows.assistant.decisions.list({ projectId: scope.projectId, limit: 50 }).records
let browser
try {
  await vite.listen(); browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' }), page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const dialog = page.getByRole('dialog', { name: '项目决定', exact: true })
  await check('USER-MESSAGE-PREVIEW-IS-READONLY-AND-RESPONSIVE', async () => {
    await page.goto(`${origin}/?conversation=decision-conversation`)
    await page.getByRole('button', { name: '记录为项目决定', exact: true }).click()
    await dialog.getByRole('textbox', { name: '决定内容', exact: true }).fill('支付变更必须通过现有测试，并由本人明确接受。禁止自动合并或扩大执行权限。')
    await dialog.getByRole('button', { name: '预览决定', exact: true }).click()
    await dialog.getByRole('heading', { name: '确认决定', exact: true }).waitFor()
    assert.equal(records().length, 0)
    assert.equal(store.events.after(0, 1000).filter(event => event.topic === 'application.decision.changed').length, 0)
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) { const bytes = await page.screenshot({ path: join(captures, `${name}.png`), fullPage: true }); writeFileSync(join(output, `${name}.png`), bytes) }
    }
  })
  await check('EXPLICIT-CONFIRMATION-REOPEN-AND-REVOKE-KEEP-AUDIT', async () => {
    await dialog.getByRole('button', { name: '确认记录', exact: true }).click()
    await dialog.getByText('决定已记录', { exact: true }).waitFor()
    assert.equal(records().length, 1)
    await dialog.getByRole('button', { name: '关闭项目决定', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: '项目决定', exact: true }).click()
    await dialog.getByText('来源可核对', { exact: true }).waitFor()
    await dialog.getByRole('button', { name: '撤销', exact: true }).click()
    assert.equal(records()[0].decision.version, 1)
    await dialog.getByRole('button', { name: '确认撤销', exact: true }).click()
    await dialog.getByText('已撤销', { exact: true }).waitFor()
    assert.equal(records()[0].decision.version, 2)
    assert.ok(records()[0].decision.revokedAt)
    assert.equal(store.workflows.assistant.decisions.history(records()[0].decision.id).length, 2)
  })
  await check('LOST-RESPONSE-RELOAD-RETRIES-THE-SAME-COMMAND-ONCE', async () => {
    await dialog.getByRole('button', { name: '关闭项目决定', exact: true }).click()
    await page.getByRole('button', { name: '记录为项目决定', exact: true }).click()
    await dialog.getByRole('button', { name: '预览决定', exact: true }).click()
    const sent = []
    await page.route('**/v1/decisions/commands', async route => {
      sent.push(route.request().postDataJSON())
      if (sent.length === 1) { await route.fetch(); await route.abort() } else await route.continue()
    })
    await dialog.getByRole('button', { name: '确认记录', exact: true }).click()
    await dialog.getByText('有一笔决定请求待核对', { exact: true }).waitFor()
    assert.equal(records().length, 2)
    await page.reload(); await page.getByRole('button', { name: '项目决定', exact: true }).click()
    await dialog.getByRole('button', { name: '重试原请求', exact: true }).click()
    await dialog.getByText('决定已记录', { exact: true }).waitFor()
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); assert.equal(records().length, 2)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('personal-agent:pending-decision-command')), null)
  })
  await check('DECISIONS-NEVER-CREATE-WORK-OR-NATIVE-EFFECTS', async () => {
    assert.equal((await product.application.inspect({})).works.length, 0)
    assert.equal(store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100).length, 0)
    assert.equal(store.events.after(0, 1000).filter(event => event.topic === 'application.decision.changed').length, 3)
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 4 && cases.every(value => value.status === 'PASS') ? 'PASS_DECISION_HTTP_BROWSER' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/decision-workbench-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, modelCalls: 0,
    limitations: ['Real local HTTP/SQLite and A/C persistence/domain code; no model/native call',
      'Explicit decision record/revoke only; no generic proposal execution, automatic context injection or recovery reauthorization'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
}
