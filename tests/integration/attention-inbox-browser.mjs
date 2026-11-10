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
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false } } })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const { createServer: createViteServer } = await import(require.resolve('vite'))
const output = resolve('reports/releases/attention-inbox/browser'), captures = resolve('apps/console/.impeccable/review')
mkdirSync(output, { recursive: true }); mkdirSync(captures, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'pa-attention-browser-')), stateRoot = join(root, 'state'), scratchProject = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(scratchProject)
const git = args => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
git(['init', '-q']); mkdirSync(join(scratchProject, 'src')); writeFileSync(join(scratchProject, 'src/.gitkeep'), '')
git(['add', 'src/.gitkeep']); git(['-c', 'user.name=Attention Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Attention fixture base'])
const principal = { userId: 'attention-user', authorityRef: 'attention-authority' }, actor = { ...principal, source: 'local_ui' }
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const project = id => ({ id, displayName: id === 'project-alpha' ? '支付服务' : '研发效率与基础设施平台',
  scope: { projectId: id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } })
const projects = [project('project-alpha'), project('project-beta')]
const product = createControlledProduct({ store, principal, projects, actionSecret: Buffer.alloc(32, 1), stateRoot, scratchProject })
const verify = product.completion.verify.bind(product.completion)
product.completion.verify = async (candidate, contract, ...args) => {
  if (contract.goal === '离线依赖检查恢复') throw new ApplicationFault('verification_failed', 'private-attention-diagnostic')
  return verify(candidate, contract, ...args)
}
const definitions = [
  ['question', '支付接口确认', 'question', 0], ['candidate-one', '订单幂等校验', 'pass', 0],
  ['candidate-two', '跨项目工作目录与长路径边界的兼容性调整', 'pass', 1],
  ['machine-fail', '缓存一致性检查', 'fail', 1], ['verification-block', '离线依赖检查恢复', 'pass', 1],
]
const works = new Map()
for (const [id, goal, mode, index] of definitions) {
  const target = projects[index]
  const receipt = await product.application.dispatch({ kind: 'create_work', commandId: `create-${id}`, conversationId: `conversation-${id}`,
    projectId: target.id, scope: target.scope, goal, profileId: `profile-fixture-${mode}`,
    criteria: [{ id: 'output', kind: 'machine', required: true, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
      { id: 'human', kind: 'human', required: true, description: 'Review the frozen output' }] }, actor)
  assert.equal(receipt.status, 'recorded'); works.set(id, receipt.workId)
}
const portProbe = createPortProbe(); portProbe.listen(0, '127.0.0.1'); await once(portProbe, 'listening')
const frontendPort = portProbe.address().port; await new Promise(resolve => portProbe.close(resolve))
const origin = `http://127.0.0.1:${frontendPort}`
const api = listenLocalHttp(createLocalHttpApp({ application: product.application, principal, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64),
  allowedOrigins: [origin], mode: 'fixture', localDevelopmentAccess: true, read: product.read, operations: product.operations }), 0)
await once(api, 'listening')
const vite = await createViteServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
  server: { host: '127.0.0.1', port: frontendPort, strictPort: true, proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
let browser
const cases = [], errors = []
const check = async (id, action) => {
  try { await action(); cases.push({ id, status: 'PASS' }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error }
}
const until = async (read, predicate) => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 30)) }
  throw new Error('Controlled attention setup did not become ready')
}
const accepted = () => store.events.after(0, 5000).filter(event => event.topic === 'application.candidate.accepted')
const frames = () => readdirSync(join(stateRoot, 'receipts')).flatMap(file => readFileSync(join(stateRoot, 'receipts', file), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)))
try {
  await vite.listen(); product.start()
  await until(() => product.read.attention({}), value => value.items.length === 5 && value.items.filter(item => item.kind === 'candidate').length === 2)
  browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const inbox = () => page.getByRole('button', { name: '待我决定', exact: true }).click()
  const open = title => page.getByRole('button', { name: `打开待办：${title}`, exact: true }).click()
  const typeTab = name => page.getByRole('group', { name: '待办类型' }).getByRole('button', { name }).click()
  await check('CROSS-PROJECT-INBOX-FROM-EMPTY-CONVERSATION-AND-RESPONSIVE', async () => {
    await page.goto(`${origin}/?conversation=main-inbox`)
    assert.equal((await product.application.inspect({ conversationId: 'main-inbox' })).works.length, 0)
    await inbox()
    await page.waitForFunction(() => document.querySelectorAll('.attention-row').length === 5)
    await page.getByText('全部会话 · 已读取 5 个工作 · 本页 5 项', { exact: true }).waitFor()
    assert.doesNotMatch(await page.locator('body').innerText(), /private-attention-diagnostic/)
    assert.equal(accepted().length, 0)
    for (const [name, width, height] of [['desktop', 1440, 900], ['user-1280', 1280, 800], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      if (!values['no-capture']) { const bytes = await page.screenshot({ path: join(captures, `${name}.png`), fullPage: true }); writeFileSync(join(output, `${name}.png`), bytes) }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  })
  await check('PROJECT-AND-KIND-FILTERS-KEEP-ORIGINAL-SOURCE', async () => {
    await page.getByRole('combobox', { name: '待办项目' }).selectOption('project-beta')
    await page.waitForFunction(() => document.querySelectorAll('.attention-row').length === 3)
    await typeTab(/^待处理/)
    await page.waitForFunction(() => document.querySelectorAll('.attention-row').length === 2)
    await page.getByRole('textbox', { name: '搜索待办' }).fill('离线依赖')
    await page.waitForFunction(() => document.querySelectorAll('.attention-row').length === 1)
    await page.getByRole('textbox', { name: '搜索待办' }).fill('')
    await page.getByRole('combobox', { name: '待办项目' }).selectOption('')
    await typeTab(/^全部/)
    await page.waitForFunction(() => document.querySelectorAll('.attention-row').length === 5)
  })
  await check('QUESTION-NAVIGATION-RELOADS-EXACT-WORK-AND-CONVERSATION', async () => {
    await open('支付接口确认')
    await page.waitForURL(url => url.searchParams.get('conversation') === 'conversation-question' && url.searchParams.get('work') === works.get('question'))
    await page.locator('.question-card').waitFor()
    await page.reload()
    await page.locator('.question-card').waitFor()
    assert.equal(await page.locator('.detail h2').textContent(), '支付接口确认')
    assert.equal(accepted().length, 0)
  })
  await check('SEQUENTIAL-REVIEW-NAVIGATES-WITHOUT-BULK-ACCEPTANCE', async () => {
    await inbox()
    await typeTab(/^待审阅/)
    await page.getByRole('button', { name: '逐项审阅', exact: true }).click()
    await page.getByRole('group', { name: '逐项审阅队列' }).getByText('审阅队列 1 / 2', { exact: true }).waitFor()
    assert.equal(accepted().length, 0)
    await page.getByRole('button', { name: '接受当前候选', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    assert.equal(accepted().length, 1)
    await page.getByRole('button', { name: '下一项交付', exact: true }).click()
    await page.getByRole('group', { name: '逐项审阅队列' }).getByText('审阅队列 2 / 2', { exact: true }).waitFor()
    assert.equal(accepted().length, 1)
    await page.getByRole('button', { name: '接受当前候选', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    assert.equal(accepted().length, 2)
    assert.equal(frames().filter(frame => frame.type === 'begin').length, 5)
  })
  await check('MACHINE-FAIL-IS-A-BLOCKAGE-AND-CANNOT-BECOME-ACCEPTANCE', async () => {
    await inbox()
    await typeTab(/^全部/)
    await open('缓存一致性检查')
    await page.getByText('FAIL', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '接受当前候选', exact: true }).count(), 0)
    assert.equal(accepted().length, 2)
  })
  await check('CROSS-CONVERSATION-ANSWER-USES-ONLY-ORIGINAL-TARGET', async () => {
    await inbox(); await open('支付接口确认')
    const snapshot = await product.application.inspect({ workId: works.get('question') }), question = snapshot.questions[0]
    const option = question.presentation.options.find(option => option.id === 'allow')
    await page.locator('.question-card').getByRole('button', { name: option.label, exact: true }).click()
    await page.getByRole('button', { name: '接受当前候选', exact: true }).waitFor()
    const writes = frames().filter(frame => frame.type === 'answer')
    assert.equal(writes.length, 1)
    const deliveries = await until(() => product.read.deliveries(question.id), values => values[0]?.status === 'native_applied')
    assert.deepEqual(deliveries.map(value => value.targetBindingId), question.targets.map(target => target.id))
    assert.equal(accepted().length, 2, 'Answering never implicitly accepts a delivery')
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close()
  const report = { status: cases.length === 6 && cases.every(value => value.status === 'PASS') ? 'PASS_CONTROLLED_ATTENTION_INBOX_BROWSER' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/attention-inbox-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, modelCalls: 0,
    limitations: ['Real local HTTP/SQLite and controlled subprocesses only; no native compatibility or reviewer benefit claim',
      'Current ranking is waiting order within a bounded work page; C deterministic priority is not enabled',
      'Sequential review is navigation plus individual confirmation, never bulk authorization or auto-acceptance'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
  rmSync(root, { recursive: true, force: true })
}
