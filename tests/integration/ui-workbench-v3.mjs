import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { url: { type: 'string', default: 'http://127.0.0.1:5192' }, capture: { type: 'boolean', default: false }, output: { type: 'string' } } })
const { chromium } = createRequire(new URL('../../apps/console/package.json', import.meta.url))('@playwright/test')
const output = resolve(values.output ?? 'reports/releases/ui-wave-03'), captures = resolve('apps/console/.impeccable/review')
mkdirSync(output, { recursive: true })
mkdirSync(captures, { recursive: true })
const browser = await chromium.launch(), context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', reducedMotion: 'reduce' })
const page = await context.newPage(), cases = [], errors = []
page.on('pageerror', error => errors.push(error.message))
const check = async (id, action) => {
  try { await action(); cases.push({ id, status: 'PASS' }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error }
}
const nav = name => page.getByRole('navigation', { name: '工作台导航' }).getByRole('button', { name, exact: true })
const visibleOverflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
const screenshot = async name => {
  if (values.capture) await page.screenshot({ path: join(captures, name), fullPage: true })
}
try {
  await check('CONTROLLED-FIXTURE-ONLY', async () => {
    await page.goto(values.url)
    await page.locator('.workspace-rail').waitFor()
    assert.equal(await page.locator('html').getAttribute('data-console-mode'), 'fixture')
    assert.equal(await page.getByRole('navigation', { name: '工作台导航' }).getByRole('button').count(), 5)
    assert.equal(await page.locator('.work-card').count(), 5)
  })
  const draft = '保留当前讨论草稿：核对重试窗口和错误码，不要创建第二项委托。'
  await check('DRAFT-SURVIVES-VIEW-SWITCH', async () => {
    await page.locator('#composer-input').fill(draft)
    await nav('工作与交付').click()
    await page.getByRole('heading', { name: '工作与交付', exact: true }).waitFor()
    assert.equal(await page.locator('.work-row').count(), 5)
    await nav('主对话视图').click()
    assert.equal(await page.locator('#composer-input').inputValue(), draft)
  })
  await check('TASK-SEARCH-FILTER-AND-RESET', async () => {
    await nav('工作与交付').click()
    const search = page.getByRole('textbox', { name: '搜索当前对话的工作' })
    await search.fill('不会存在的工作')
    assert.equal(await page.locator('.work-row').count(), 0)
    await page.getByRole('button', { name: '清除筛选', exact: true }).click()
    assert.equal(await page.locator('.work-row').count(), 5)
    await screenshot('tasks.png')
    await search.fill('指数退避与错误码')
    assert.equal(await page.locator('.work-row').count(), 1)
    await page.locator('.work-row').click()
    await page.locator('.work-stage-strip').waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('region', { name: '工作详情' }).isVisible(), true)
    await page.getByRole('button', { name: '关闭工作详情', exact: true }).click()
  })
  await check('DECISION-INBOX-USES-REAL-ANSWER-COMMAND', async () => {
    await nav('待我决定').click()
    assert.equal(await page.locator('.workspace-view .question-card').count(), 5)
    const question = page.locator('.workspace-view .question-card').filter({ hasText: '还有需要补充的业务约束吗？' })
    await question.getByRole('textbox', { name: '回答', exact: true }).fill('保留原错误码，不能自动扩大权限。')
    await question.getByRole('button', { name: '提交回答', exact: true }).click()
    await page.waitForFunction(() => document.querySelectorAll('.workspace-view .question-card').length === 4)
    await screenshot('decisions.png')
  })
  await check('EXECUTOR-DIRECTORY-KEEPS-FIXTURE-IDENTITY', async () => {
    await nav('执行器目录').click()
    await page.getByRole('heading', { name: '执行器连接', exact: true }).waitFor()
    const fixtures = page.locator('.test-profiles')
    await fixtures.locator('summary').click()
    assert.ok(await fixtures.locator('.executor-row').count() > 0)
    assert.match(await fixtures.innerText(), /固定流程/)
    await screenshot('executors.png')
  })
  await check('CONVERSATION-DETAIL-AND-DESKTOP-GEOMETRY', async () => {
    await nav('主对话视图').click()
    assert.equal(await page.locator('#composer-input').inputValue(), draft)
    await page.locator('.work-card').filter({ hasText: '支付错题重试' }).click()
    assert.equal(await page.locator('.work-stage-strip').isVisible(), true)
    assert.equal(await page.locator('.stage-step').count(), 4)
    assert.match(await page.locator('.stage-work').innerText(), /支付错题重试/)
    assert.match(await page.locator('.stage-pending').innerText(), /3 项待决定/)
    assert.match(await page.locator('.stage-step.active').innerText(), /执行/)
    assert.equal(await visibleOverflow(), false)
    await screenshot('desktop.png')
    await page.setViewportSize({ width: 1280, height: 800 })
    assert.equal(await visibleOverflow(), false)
    await screenshot('notebook.png')
  })
  await check('NARROW-NAVIGATION-AND-DRAWERS', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '关闭工作详情', exact: true }).click()
    await page.locator('#composer-input').waitFor({ state: 'visible' })
    assert.equal(await visibleOverflow(), false)
    await screenshot('mobile.png')
    await page.getByRole('button', { name: '工作空间', exact: true }).click()
    assert.equal(await page.locator('.sidebar').isVisible(), true)
    assert.equal(await page.locator('.detail').isVisible(), false)
    await screenshot('mobile-navigation.png')
    await page.getByRole('button', { name: '关闭工作列表', exact: true }).click()
    await page.getByRole('button', { name: '工作空间', exact: true }).click()
    await page.getByRole('button', { name: '模型设置', exact: true }).click()
    assert.equal(await page.locator('.model-panel').isVisible(), true)
    assert.equal(await page.locator('.sidebar').isVisible(), false)
    await page.getByRole('button', { name: '关闭模型设置', exact: true }).click()
    await page.getByRole('button', { name: '工作空间', exact: true }).click()
    await page.getByRole('button', { name: '工作详情', exact: true }).click()
    assert.equal(await page.locator('.detail').isVisible(), true)
    assert.equal(await page.locator('.sidebar').isVisible(), false)
    await screenshot('mobile-detail.png')
    await page.keyboard.press('Escape')
    assert.equal(await page.locator('.detail').isVisible(), false)
  })
  await check('NO-UNCAUGHT-ERROR-AND-PRIVATE-DESIGN-RECORD', async () => {
    assert.deepEqual(errors, [])
    const denied = await context.request.get(new URL('/.impeccable/surfaces/src-app-tsx.md', values.url).href)
    assert.equal(denied.status(), 403)
    await page.keyboard.press('Tab')
    assert.equal(await page.evaluate(() => document.activeElement?.tagName === 'BODY'), false)
  })
} finally {
  await browser.close()
  const report = { status: cases.every(item => item.status === 'PASS') && cases.length === 8 ? 'PASS_CONTROLLED_UI_V3' : 'FAIL_CONTROLLED_UI_V3', checkedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), cases, errors, captures: values.capture ? captures : null,
    limitations: ['Controlled browser fixture only; no vendor/model call or native compatibility claim', 'Daily backend workflow, migration and new runtime controls are separate wave-03 packages'] }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
