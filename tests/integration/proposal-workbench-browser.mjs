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

const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false } } })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const output = resolve('reports/releases/wave08-proposal-workbench/browser'), captures = resolve('apps/console/.impeccable/review')
mkdirSync(output, { recursive: true }); mkdirSync(captures, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'pa-proposal-browser-')), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(projectRoot); mkdirSync(join(projectRoot, 'src'))
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
git(['add', 'src/.gitkeep']); git(['-c', 'user.name=Proposal Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Proposal browser base'])
const principal = { userId: 'proposal-user', authorityRef: 'proposal-authority' }, actor = { ...principal, source: 'local_ui' }
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const scope = { projectId: 'proposal-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const product = createProductRuntime({ store, principal, projects: [
  { id: scope.projectId, displayName: '支付服务', scope },
  { id: 'other-project', displayName: '文档项目', scope: { ...scope, projectId: 'other-project' } },
  { id: 'expired-project', displayName: '旧项目', scope: { ...scope, projectId: 'expired-project', expiresAt: '2026-01-01T00:00:00.000Z' } },
], stateRoot, scratchProject: projectRoot, actionSecret: Buffer.alloc(32, 17) })
await product.application.dispatch({ kind: 'chat', commandId: 'browser-source', conversationId: 'proposal-conversation',
  projectId: scope.projectId, text: '支付接口新增幂等校验，变更必须通过已有检查，再由我确认接受。' }, actor)
await product.application.dispatch({ kind: 'chat', commandId: 'foreign-source', conversationId: 'foreign-conversation',
  projectId: 'other-project', text: '另一项目的消息不进入支付服务提案。' }, actor)
await product.application.dispatch({ kind: 'chat', commandId: 'expired-source', conversationId: 'proposal-conversation',
  projectId: 'expired-project', text: '旧项目的待办需要新的项目授权。' }, actor)
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
const records = () => store.workflows.assistant.proposals.list({ projectId: scope.projectId, limit: 50 }).records
const works = () => store.product.works.listByProject(scope.projectId)
let browser
try {
  await vite.listen(); browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' }), page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(10000)
  const dialog = page.getByRole('dialog', { name: '提案', exact: true })
  const open = async () => { await page.getByRole('button', { name: '创建提案', exact: true }).click(); await dialog.waitFor() }
  const close = () => dialog.getByRole('button', { name: '关闭提案', exact: true }).click()
  await check('EXPLICIT-PREVIEW-IS-READONLY-DESKTOP-AND-MOBILE', async () => {
    await page.goto(`${origin}/?conversation=proposal-conversation`)
    await page.getByRole('button', { name: '转为提案', exact: true }).first().click()
    await dialog.getByRole('textbox', { name: '提案内容', exact: true }).fill('为支付接口增加幂等校验，并补齐重复请求的单元测试。')
    await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
    await dialog.getByRole('heading', { name: '确认提案', exact: true }).waitFor()
    assert.equal(records().length, 0); assert.equal(works().length, 0)
    assert.equal(store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).length, 0)
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) {
        const bytes = await page.screenshot({ path: join(captures, `proposal-${name}.png`), fullPage: true })
        writeFileSync(join(output, `${name}.png`), bytes)
      }
    }
  })
  await check('CONFIRM-CREATES-ONE-WORK-AND-NAVIGATES-TO-IT', async () => {
    await dialog.getByRole('button', { name: '确认创建', exact: true }).click()
    await dialog.getByRole('heading', { name: '工作已创建', exact: true }).first().waitFor()
    assert.equal(works().length, 1); assert.equal(records()[0].state, 'confirmed')
    await dialog.getByRole('button', { name: '查看工作', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.getByRole('heading', { name: '工作详情', exact: true }).waitFor()
  })
  await check('REVISION-USES-THE-CURRENT-CONTRACT-AND-EXPLICIT-GOAL', async () => {
    const target = works()[0]
    const configuration = await product.read.configuration(), project = configuration.projects.find(value => value.id === scope.projectId)
    await product.application.dispatch({ kind: 'create_work', commandId: 'second-work', conversationId: 'proposal-conversation',
      projectId: project.id, goal: '这份独立工作不应被本次修订。', scope: project.scope, profileId: project.defaultProfileId, criteria: project.defaultCriteria }, actor)
    await page.reload()
    await page.setViewportSize({ width: 1440, height: 900 })
    await open()
    await dialog.getByRole('button', { name: '修订工作', exact: true }).click()
    await dialog.getByRole('combobox', { name: '修订目标工作', exact: true }).selectOption(target.id)
    await dialog.getByRole('textbox', { name: '修订后目标', exact: true }).fill('覆盖支付并发重复请求，保持错误码兼容。')
    await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
    await dialog.getByRole('heading', { name: '新工作目标', exact: true }).waitFor()
    await dialog.locator('dd').filter({ hasText: target.title }).waitFor()
    await dialog.getByText(target.id, { exact: true }).waitFor()
    await dialog.getByText('版本 1', { exact: true }).waitFor()
    for (const [name, width, height] of [['desktop-revision', 1440, 900], ['mobile-revision', 390, 844]]) {
      await page.setViewportSize({ width, height })
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
    }
    await dialog.getByRole('button', { name: '确认修订', exact: true }).click()
    await dialog.getByRole('heading', { name: '工作已修订', exact: true }).first().waitFor()
    assert.equal(store.product.contracts.history(target.id)[0].revision, 2)
    assert.equal(store.product.contracts.history(target.id)[0].goal, '覆盖支付并发重复请求，保持错误码兼容。')
    assert.equal(works().length, 2)
    await close()
  })
  await check('DECISION-AND-REJECTION-ARE-DURABLE-WITHOUT-NEW-WORK', async () => {
    await open(); await dialog.getByRole('button', { name: '记录决定', exact: true }).click()
    await dialog.getByRole('textbox', { name: '提案内容', exact: true }).fill('支付变更必须保留既有错误码。')
    await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
    await dialog.getByRole('button', { name: '确认记录', exact: true }).click()
    await dialog.getByRole('heading', { name: '决定已记录', exact: true }).first().waitFor()
    assert.equal(store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 1)
    await close(); await open()
    await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
    await dialog.getByRole('button', { name: '拒绝提案', exact: true }).click()
    await dialog.getByRole('heading', { name: '提案已拒绝', exact: true }).first().waitFor()
    assert.equal(records().filter(value => value.state === 'rejected').length, 1)
    assert.equal(works().length, 2)
    await close()
  })
  await check('LOST-RESPONSE-RELOAD-KEEPS-EXACT-COMMAND-AND-ONE-EFFECT', async () => {
    await open(); await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
    const sent = []
    await page.route('**/v1/proposals/commands', async route => {
      sent.push(route.request().postDataJSON())
      if (sent.length === 1) {
        const response = await route.fetch(), receipt = await response.json()
        assert.equal(receipt.status, 'recorded', receipt.error?.message)
        await route.abort()
      } else await route.continue()
    })
    await dialog.getByRole('button', { name: '确认创建', exact: true }).click()
    await dialog.getByText('原请求待核对', { exact: true }).waitFor()
    await dialog.getByRole('alert').filter({ hasText: '提交结果尚未确认' }).waitFor()
    assert.equal(works().length, 3)
    await page.reload(); await open()
    await dialog.getByRole('button', { name: '核对原请求', exact: true }).click()
    await dialog.getByRole('heading', { name: '工作已创建', exact: true }).first().waitFor()
    assert.equal(sent.length, 2); assert.deepEqual(sent[1], sent[0]); assert.equal(works().length, 3)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('personal-agent:pending-proposal-command')), null)
    await page.unroute('**/v1/proposals/commands'); await close()
  })
  await check('REJECTED-RECEIPT-SETTLES-WITHOUT-AN-UNKNOWN-RETRY-LOOP', async () => {
    await open()
    const previewResponse = page.waitForResponse(response => response.url().endsWith('/v1/proposals/prepare') && response.request().method() === 'POST')
    await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
    const prepared = await (await previewResponse).json()
    const original = store.product.messages.getById(prepared.record.sourceMessageId)
    store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify({ ...original, text: 'Changed after preview' }), original.id)
    await dialog.getByRole('button', { name: '确认创建', exact: true }).click()
    await dialog.getByRole('alert').filter({ hasText: '提案未执行' }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: '核对原请求', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('personal-agent:pending-proposal-command')), null)
    assert.equal(works().length, 3)
    store.db.prepare('UPDATE conversation_messages SET value = ? WHERE id = ?').run(JSON.stringify(original), original.id)
    await close()
  })
  await check('PROJECT-SCOPE-AND-MISSING-INPUTS-STAY-EXPLICIT', async () => {
    await open()
    const path = dialog.getByRole('checkbox', { name: 'src/', exact: true })
    await path.uncheck()
    assert.equal(await dialog.getByRole('button', { name: '预览提案', exact: true }).isDisabled(), true)
    await path.check()
    await dialog.getByRole('combobox', { name: '提案项目', exact: true }).selectOption('other-project')
    await dialog.getByText('当前对话没有可用的用户消息', { exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: '预览提案', exact: true }).isDisabled(), true)
    await close()
    assert.deepEqual(errors, [])
    assert.equal(store.bindings.current('any-ticket'), undefined)
  })
  await check('EXPIRED-PROJECT-EXPLAINS-DISABLED-PREVIEW', async () => {
    await open()
    await dialog.getByRole('combobox', { name: '提案项目', exact: true }).selectOption('expired-project')
    await dialog.getByRole('alert').filter({ hasText: '项目授权已过期' }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: '预览提案', exact: true }).isDisabled(), true)
    assert.match(await dialog.getByRole('combobox', { name: '提案项目', exact: true }).textContent(), /旧项目（不可调度）/)
    for (const [name, width, height] of [['desktop-blocked', 1440, 900], ['mobile-blocked', 390, 844]]) {
      await page.setViewportSize({ width, height })
      assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
    }
    await close()
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 8 && cases.every(value => value.status === 'PASS') ? 'PASS_PROPOSAL_HTTP_BROWSER' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/proposal-workbench-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, modelCalls: 0,
    limitations: ['Real local HTTP/SQLite and UI over A/C ports; runtime effects not started', 'No real model/native/automatic structured reasoning or restored target activation'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
