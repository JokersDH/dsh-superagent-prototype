import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'
import { candidateModel } from './fixtures/assistant-candidate-model.mjs'
import { availablePort, waitUntil } from './fixtures/personal-startup.mjs'

const { values } = parseArgs({ options: { output: { type: 'string' }, 'no-capture': { type: 'boolean', default: false } } })
const output = resolve(values.output ?? 'reports/releases/wave15-integration/candidates-browser')
mkdirSync(output, { recursive: true })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
let release
const gate = new Promise(resolve => { release = resolve }), model = await candidateModel({ gate, legacy: true })
const configBefore = readFileSync(model.file), stateRoot = join(model.root, 'state'), projectRoot = join(model.root, 'project')
mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Candidate browser fixture'])
const principal = { userId: 'candidate-browser-user', authorityRef: 'candidate-browser-authority' }
const projectId = 'candidate-browser-project', conversationId = 'candidate-browser-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const product = createProductRuntime({ store, stateRoot, scratchProject: projectRoot, principal,
  projects: [{ id: projectId, displayName: '支付服务', scope }], actionSecret: Buffer.alloc(32, 61), assistantProvider: model.provider })
const port = await availablePort(), origin = `http://127.0.0.1:${port}`
const api = listenLocalHttp(createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64), bootstrapToken: 'b'.repeat(64),
  mode: 'fixture', localDevelopmentAccess: true, allowedOrigins: [origin], read: product.read, operations: product.operations }), 0)
await once(api, 'listening')
const vite = await createServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
const cases = [], errors = [], check = async (id, run) => { try { await run(); cases.push({ id, status: 'PASS' }) } catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error } }
let browser, complete = false
try {
  await vite.listen(); product.start(); browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  const dialog = page.getByRole('dialog', { name: '提案', exact: true })
  const candidateFor = text => page.locator('.message.role-assistant').filter({ hasText: text }).locator('.reply-candidates')
  const send = async text => { await page.getByRole('textbox', { name: '发送消息', exact: true }).fill(text); await page.getByRole('button', { name: '发送消息', exact: true }).click() }
  const openCandidates = async text => { const details = candidateFor(text); if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click(); return details }
  const capture = async (prefix = '', target) => {
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['zoom', 720, 450]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      if (target) await target.scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      if (await dialog.isVisible()) assert.equal(await dialog.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (prefix === 'work-') {
        const action = await dialog.getByRole('button', { name: '预览提案', exact: true }).boundingBox(), frame = await dialog.boundingBox()
        assert.ok(action && frame && action.y >= frame.y && action.y + action.height <= Math.min(height, frame.y + frame.height), 'The complete form action must remain visible')
        const scrolling = dialog.locator('.proposal-form-scroll'), scrollBox = await scrolling.boundingBox(), footerBox = await dialog.locator('form > footer').boundingBox()
        assert.ok(scrollBox && footerBox && scrollBox.y + scrollBox.height <= footerBox.y, 'Content and actions must have disjoint painting areas')
        assert.equal(await scrolling.evaluate(element => getComputedStyle(element).overflowY), 'auto')
      }
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${prefix}${name}.png`), fullPage: true, animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await page.goto(`${origin}/?conversation=${conversationId}`)
  await check('EXPLICIT_PREFERENCE_DEFAULTS_OFF_AND_SIDECAR_PRESERVES_LEGACY_MODEL_CONFIG', async () => {
    await page.getByRole('button', { name: '模型设置', exact: true }).click()
    const checkbox = page.getByRole('checkbox', { name: '提案建议', exact: true })
    assert.equal(await checkbox.isChecked(), false)
    const response = page.waitForResponse(value => value.url().endsWith('/v1/assistant/suggestions') && value.request().method() === 'POST')
    await checkbox.click(); assert.equal((await response).status(), 200); await waitUntil(() => checkbox.isChecked())
    assert.equal(model.provider.status().suggestionsEnabled, true); assert.deepEqual(readFileSync(model.file), configBefore)
    assert.equal(model.requests.length, 0)
    await page.getByRole('button', { name: '关闭模型设置', exact: true }).click()
  })
  const decisionText = '已整理为一项项目决定。'
  await check('ONE_SDK_RESPONSE_STREAMS_AND_LAZY_CANDIDATE_REVIEW_HAS_NO_BUSINESS_EFFECT', async () => {
    await send('请把保留错误码整理为一项项目决定。')
    await page.locator('.streaming-reply').filter({ hasText: '已整' }).waitFor()
    assert.equal(model.requests.length, 1); assert.equal(store.product.works.listByProject(projectId).length, 0)
    release(); await page.locator('.message.role-assistant').filter({ hasText: decisionText }).waitFor()
    const cursor = store.events.cursor(), details = await openCandidates(decisionText)
    await details.getByRole('button', { name: '预览记录决定建议', exact: true }).waitFor()
    assert.equal(model.requests.length, 1); assert.equal(store.events.cursor(), cursor)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get().n, 0)
    await capture('', details.getByRole('button', { name: '预览记录决定建议', exact: true }))
  })
  await check('ORIGINAL_CANDIDATE_FORM_AND_PREVIEW_ARE_INERT_AND_CLOSE_RESTORES_FOCUS', async () => {
    const details = await openCandidates(decisionText)
    await details.getByRole('button', { name: '预览记录决定建议', exact: true }).click(); await dialog.waitFor()
    const content = dialog.getByRole('textbox', { name: '提案内容', exact: true })
    assert.equal(await content.inputValue(), '支付接口保留原有错误码。'); assert.equal(await content.evaluate(element => element.readOnly), true)
    assert.equal(await dialog.getByRole('combobox', { name: '提案项目', exact: true }).isDisabled(), true)
    await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
    await dialog.getByRole('button', { name: '确认记录', exact: true }).waitFor()
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get().n, 0)
    assert.equal(model.requests.length, 1)
    await capture('preview-', dialog.getByRole('heading', { name: '确认提案', exact: true }))
    await dialog.getByRole('button', { name: '关闭提案', exact: true }).click()
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '预览记录决定建议')
  })
  await check('LOST_CONFIRMATION_RESPONSE_RELOAD_REPLAYS_THE_ORIGINAL_COMMAND_ONCE', async () => {
    await candidateFor(decisionText).getByRole('button', { name: '预览记录决定建议', exact: true }).click(); await dialog.waitFor()
    await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
    const commands = []
    await page.route('**/v1/proposals/commands', async route => {
      commands.push(route.request().postDataJSON())
      if (commands.length === 1) { await route.fetch(); await route.abort() } else await route.continue()
    })
    await dialog.getByRole('button', { name: '确认记录', exact: true }).click()
    await dialog.getByRole('button', { name: '核对原请求', exact: true }).waitFor()
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get().n, 1)
    await page.reload(); await page.getByRole('button', { name: '创建提案', exact: true }).click(); await dialog.waitFor()
    await dialog.getByRole('button', { name: '核对原请求', exact: true }).click()
    await dialog.getByRole('heading', { name: '决定已记录', level: 2, exact: true }).waitFor()
    assert.deepEqual(commands[1], commands[0]); assert.equal(model.requests.length, 1)
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get().n, 1)
    await page.unroute('**/v1/proposals/commands'); await dialog.getByRole('button', { name: '返回对话', exact: true }).click()
  })
  const workText = '建议创建幂等测试工作。', goal = '增加支付幂等测试，保留既有错误码。'.repeat(20)
  await check('WORK_CANDIDATE_REQUIRES_USER_SCOPE_REGISTERED_CHECK_AND_PROFILE_BEFORE_CREATION', async () => {
    model.setReply(context => ({ text: workText, suggestions: [{ kind: 'propose_work', goal, projectId, sourceMessageId: context.sourceMessageId }] }))
    await send('创建一项幂等测试工作。'); await page.locator('.message.role-assistant').filter({ hasText: workText }).waitFor()
    const details = await openCandidates(workText)
    await details.getByRole('button', { name: '预览创建工作建议', exact: true }).click(); await dialog.waitFor()
    assert.equal(await dialog.getByRole('textbox', { name: '提案内容', exact: true }).inputValue(), goal)
    await dialog.getByRole('combobox', { name: '提案执行器', exact: true }).selectOption('profile-fixture-pass')
    const paths = dialog.getByRole('checkbox', { name: 'src/', exact: true }), prepare = dialog.getByRole('button', { name: '预览提案', exact: true })
    await paths.uncheck(); assert.equal(await prepare.isDisabled(), true); await paths.check()
    const machine = dialog.getByRole('checkbox', { name: /机器检查/ }).first()
    await machine.uncheck(); assert.equal(await prepare.isDisabled(), true); await machine.check()
    await capture('work-', dialog.getByRole('textbox', { name: '提案内容', exact: true }))
    await prepare.click(); await dialog.getByRole('button', { name: '确认创建', exact: true }).waitFor()
    assert.equal(store.product.works.listByProject(projectId).length, 0); assert.equal(model.requests.length, 2)
    await dialog.getByRole('button', { name: '确认创建', exact: true }).click()
    await dialog.getByRole('heading', { name: '工作已创建', level: 2, exact: true }).waitFor()
    assert.equal(store.product.works.listByProject(projectId).length, 1)
    await dialog.getByRole('button', { name: '返回对话', exact: true }).click()
  })
  await check('REVISION_CANDIDATE_LOADS_EXACT_CURRENT_TARGET_AND_REQUIRES_AN_EXPLICIT_NEW_GOAL', async () => {
    const workId = store.product.works.listByProject(projectId)[0].id
    const current = await waitUntil(async () => { const value = (await product.application.inspect({ workId })).works[0]; return value.resourceStatus === 'quiescent' && value.actions.currentVerificationId ? value : false })
    const expected = { workId, revision: current.contract.revision, digest: current.contract.digest }, replyText = '建议补充重复请求边界。'
    model.setReply(context => ({ text: replyText, suggestions: [{ kind: 'propose_revision', expected, rationale: '覆盖重复请求与失败重试。', sourceMessageId: context.sourceMessageId }] }))
    await send('补充这项工作的重复请求边界。'); await page.locator('.message.role-assistant').filter({ hasText: replyText }).waitFor()
    const details = await openCandidates(replyText)
    await details.getByRole('button', { name: '预览修订工作建议', exact: true }).click(); await dialog.waitFor()
    const prepare = dialog.getByRole('button', { name: '预览提案', exact: true })
    assert.equal(await prepare.isDisabled(), true)
    await dialog.getByRole('textbox', { name: '修订后目标', exact: true }).fill('增加幂等、重复请求及失败重试的边界用例。')
    await waitUntil(async () => !(await prepare.isDisabled()))
    assert.equal(await dialog.getByRole('combobox', { name: '修订目标工作', exact: true }).isDisabled(), true)
    await prepare.click(); await dialog.getByRole('button', { name: '确认修订', exact: true }).click()
    await dialog.getByRole('heading', { name: '工作已修订', level: 2, exact: true }).waitFor()
    assert.equal((await product.application.inspect({ workId })).works[0].contract.revision, 2)
    assert.equal(store.product.works.listByProject(projectId).length, 1); assert.equal(model.requests.length, 3)
    await dialog.getByRole('button', { name: '返回对话', exact: true }).click()
  })
  await check('INVALID_SCOPE_AND_CORRUPT_BODY_SHOW_SAFE_STATES_WITHOUT_MODEL_RETRY', async () => {
    const text = '这项规则仍需审阅。'
    model.setReply(context => ({ text, suggestions: [{ kind: 'propose_decision', content: 'Attempt an external action',
      scope: { ...scope, externalActions: ['deploy'] }, sourceMessageId: context.sourceMessageId }] }))
    await send('审阅外部动作规则。'); await page.locator('.message.role-assistant').filter({ hasText: text }).waitFor()
    const denied = await openCandidates(text)
    await denied.getByRole('status').filter({ hasText: '当前不可用' }).waitFor()
    assert.equal(await denied.getByRole('button', { name: /预览.*建议/ }).count(), 0)
    const source = store.product.messages.page(conversationId, { limit: 200 }).messages.find(message => message.text === '请把保留错误码整理为一项项目决定。')
    const result = store.workflows.assistant.replyResults.forRequest(key('assistant-request', source.id)), file = store.artifacts.filePath(result.artifactRef), bytes = readFileSync(file)
    const original = await openCandidates(decisionText)
    writeFileSync(file, 'corrupt original candidate body')
    await original.getByRole('button', { name: '重新读取建议', exact: true }).click(); await original.getByRole('alert').waitFor()
    assert.equal(await original.getByRole('button', { name: '预览记录决定建议', exact: true }).count(), 0)
    writeFileSync(file, bytes)
    await original.getByRole('button', { name: '重新读取建议', exact: true }).click(); await original.getByRole('button', { name: '预览记录决定建议', exact: true }).waitFor()
    assert.equal(model.requests.length, 4)
  })
  await check('PLAIN_MODE_STILL_STREAMS_AND_THE_LEGACY_MODEL_CONFIG_REMAINS_UNCHANGED', async () => {
    await page.getByRole('button', { name: '模型设置', exact: true }).click()
    await page.getByRole('checkbox', { name: '提案建议', exact: true }).click()
    await waitUntil(() => model.provider.status().suggestionsEnabled === false)
    await page.getByRole('button', { name: '关闭模型设置', exact: true }).click()
    await send('再说明一次错误码约束。')
    await page.locator('.message.role-assistant').filter({ hasText: '需要保留现有错误码。' }).waitFor()
    assert.equal(model.requests.length, 5); assert.equal(model.requests.at(-1).tools, undefined)
    assert.deepEqual(readFileSync(model.file), configBefore)
    assert.equal((await page.textContent('body')).includes(model.key), false)
  })
  assert.deepEqual(errors, []); complete = true
} finally {
  release(); await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); await model.close()
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify({ protocol: 'assistant-candidates-browser/1',
    source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedSourceDirty: !!execFileSync('git', ['diff', 'HEAD', '--', 'apps', 'packages'], { encoding: 'utf8' }).trim(),
    status: complete && cases.length === 8 && cases.every(item => item.status === 'PASS') ? 'PASS' : 'FAIL', cases, errors,
    mockSDKRequests: model.requests.length, realModelTurns: 0, nativeTurnStarts: 0,
    scope: 'Actual React/HTTP/SQLite/PrivateModelProvider SDK with a private local mock; controlled local work creation/revision, not vendor/native/install/activation admission' }, null, 2) + '\n')
}
