import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { personalCase } from './fixtures/personal-startup.mjs'

const { values } = parseArgs({ options: { output: { type: 'string' } } })
const output = resolve(values.output ?? 'reports/releases/wave13-integration/readiness-browser')
mkdirSync(output, { recursive: true })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
let releaseReply
const replyGate = new Promise(resolve => { releaseReply = resolve })
const h = await personalCase({ mode: 'missing', workbench: true, replyGate })
const cases = [], errors = []
const check = async (id, run) => {
  try { await run(); cases.push({ id, status: 'PASS' }) }
  catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error }
}
let browser, completed = false
try {
  await h.start(); browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  await page.goto(h.consoleURL)
  const state = page.getByRole('status', { name: '开发执行状态', exact: true })
  await check('ACTUAL-PERSONAL-WORKBENCH-WITHOUT-CODEX-KEEPS-DISCUSSION-AND-EXPLAINS-READINESS', async () => {
    await state.waitFor(); assert.match(await state.textContent(), /开发执行未就绪/)
    assert.match(await state.textContent(), process.platform === 'darwin' && process.arch === 'arm64' ? /未安装 Codex/ : /当前平台尚未通过验证/)
    const configuration = (await h.json('/v1/configuration')).value
    assert.equal(configuration.projects[0].discussionOnly, true)
    assert.equal(configuration.profiles.some(profile => profile.kind === 'controlled_fixture' || profile.dispatchAllowed), false)
    assert.equal(await page.getByRole('button', { name: '委托执行', exact: true }).count(), 0)
    assert.equal(h.modelRequests.length, 0)
  })
  await check('BLOCKED-DELEGATION-FORM-DOES-NOT-PROMISE-ANSWER-OR-STOP', async () => {
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    const form = page.locator('.new-work')
    await form.waitFor(); assert.equal(await form.getByRole('button', { name: '创建委托', exact: true }).isDisabled(), true)
    assert.doesNotMatch(await form.textContent(), /回答和停止仍可用/)
    assert.match(await form.getByRole('alert').textContent(), /历史记录保留/)
    await form.getByRole('button', { name: '取消', exact: true }).click()
    assert.equal(h.modelRequests.length, 0)
  })
  await check('ORDINARY-DISCUSSION-USES-ACTUAL-HTTP-SSE-AND-PERSISTED-REPLY', async () => {
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('讨论无执行器的开发需求。')
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await page.locator('.streaming-reply').filter({ hasText: '可以继续' }).waitFor()
    assert.equal(h.modelRequests.length, 1)
    assert.equal(await page.getByRole('button', { name: '发送消息', exact: true }).isDisabled(), true)
    releaseReply()
    await page.locator('.message.role-assistant').filter({ hasText: '可以继续讨论需求。' }).waitFor()
    await page.reload(); await state.waitFor()
    await page.locator('.message.role-assistant').filter({ hasText: '可以继续讨论需求。' }).waitFor()
    assert.equal(h.modelRequests.length, 1)
    assert.match(h.modelRequests[0].messages[0].content, /开发执行器未就绪/)
  })
  const contextualText = '根据刚才的需求，整理实施步骤。'
  const dialog = page.locator('dialog.context-workspace')
  await check('CONTEXT-PREVIEW-CONFIRM-AND-ORIGINAL-SOURCE-AUDIT-WORK-WITHOUT-EXECUTION', async () => {
    await page.getByRole('textbox', { name: '发送消息', exact: true }).fill(contextualText)
    await page.getByRole('button', { name: '上下文预览', exact: true }).click(); await dialog.waitFor()
    await dialog.getByRole('button', { name: '预览消息', exact: true }).click()
    await dialog.getByRole('button', { name: '确认发送', exact: true }).waitFor()
    assert.equal(h.modelRequests.length, 1)
    await dialog.getByRole('button', { name: '确认发送', exact: true }).click(); await dialog.waitFor({ state: 'hidden' })
    await page.waitForFunction(() => document.querySelectorAll('.message.role-assistant').length === 2)
    assert.equal(h.modelRequests.length, 2)
    const article = page.locator('.message.role-user').filter({ hasText: contextualText })
    await article.locator('.message-context-audit > summary').click()
    const source = article.getByRole('region', { name: '原始上下文内容', exact: true })
    await source.waitFor(); assert.match(await source.textContent(), /讨论无执行器的开发需求/)
  })
  await check('HISTORY-RELOAD-AND-ORIGINAL-BODY-READING-DO-NOT-RESEND-A-MODEL-REQUEST', async () => {
    await page.reload(); await state.waitFor()
    await page.getByRole('button', { name: '上下文预览', exact: true }).click(); await dialog.waitFor()
    await dialog.getByRole('tab', { name: '使用记录', exact: true }).click()
    await dialog.getByRole('button', { name: `查看使用记录：${contextualText}`, exact: true }).click()
    const source = dialog.getByRole('region', { name: '原始上下文内容', exact: true })
    await source.waitFor(); assert.match(await source.textContent(), /讨论无执行器的开发需求/)
    await dialog.getByRole('button', { name: '关闭上下文预览', exact: true }).click()
    assert.equal(h.modelRequests.length, 2)
  })
  await check('READINESS-AND-COMPOSER-FIT-DESKTOP-MOBILE-AND-ZOOM-SIZE', async () => {
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844], ['zoom', 720, 450]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      const rect = await state.boundingBox()
      assert.ok(rect && rect.x >= 0 && rect.x + rect.width <= width + 1)
      const submit = await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox()
      assert.ok(submit && submit.x >= 0 && submit.x + submit.width <= width + 1 && submit.y + submit.height <= height)
      if (width <= 720) {
        const rail = await page.getByRole('navigation', { name: '工作台导航', exact: true }).boundingBox()
        const controls = await page.locator('.composer-actions').boundingBox()
        assert.ok(rail && controls && controls.y + controls.height <= rail.y, 'Composer controls must stay above bottom navigation')
      }
      assert.equal(await page.getByRole('button', { name: '发送消息', exact: true }).evaluate(element => {
        const rect = element.getBoundingClientRect()
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }), true)
      await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('button', { name: '查看执行器', exact: true }).click()
    await page.getByRole('heading', { name: '执行器连接', exact: true }).waitFor()
    assert.match(await page.locator('.executor-row').textContent(), /Codex/)
    assert.doesNotMatch(await page.locator('.executor-row').textContent(), /受控验证|固定流程/)
    await page.screenshot({ path: join(output, 'executors.png'), fullPage: true, animations: 'disabled' })
  })
  assert.deepEqual(errors, []); assert.equal(existsSync(h.launchLog), false); assert.equal(h.modelRequests.length, 2)
  completed = true
} finally {
  releaseReply(); await browser?.close(); await h.close()
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify({
    protocol: 'personal-readiness-browser/1', source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    trackedSourceDirty: !!execFileSync('git', ['diff', 'HEAD', '--', 'apps/console/src', 'apps/coordinator', 'packages/contracts', 'packages/application', 'tools/dev/workbench.mjs'], { encoding: 'utf8' }).trim(),
    status: completed && cases.length === 6 && cases.every(item => item.status === 'PASS') && !errors.length ? 'PASS' : 'FAIL', cases, errors,
    mockModelRequests: h.modelRequests.length, realModelTurns: 0, realNativeTurns: 0,
    scope: 'Actual CLI/workbench/SQLite/HTTP/React/SSE using a local mock provider and a private missing-Codex executable probe. Not installed/native/activation/release admission.',
  }, null, 2) + '\n')
}
