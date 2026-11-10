import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer as createPortProbe } from 'node:net'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { projectSettingsFixture } from './project-settings.fixture.mjs'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false } } })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url)), { chromium } = require('@playwright/test')
const { createServer: createViteServer } = await import(require.resolve('vite'))
const output = resolve('reports/releases/project-settings'); mkdirSync(output, { recursive: true })
const h = projectSettingsFixture(), cases = [], errors = []
const probe = createPortProbe(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
const origin = `http://127.0.0.1:${port}`, api = listenLocalHttp(h.http(origin), 0); await once(api, 'listening')
const vite = await createViteServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') }, server: { host: '127.0.0.1', port, strictPort: true,
    proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
let browser
const check = async (id, run) => { try { await run(); cases.push({ id, status: 'PASS' }) } catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error } }
try {
  await vite.listen(); browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' }), page = await context.newPage()
  page.on('pageerror', error => errors.push(error.message))
  const dialog = page.getByRole('dialog', { name: '项目设置', exact: true })
  await check('EDIT-SETTINGS-AND-PERSIST-HISTORY', async () => {
    await page.goto(origin)
    await page.getByRole('group', { name: '按项目筛选' }).getByRole('button', { name: '支付服务', exact: true }).click()
    await page.getByRole('button', { name: '项目设置', exact: true }).click()
    await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill('支付服务正式版')
    await dialog.getByRole('combobox', { name: '验收检查' }).selectOption('npm_test')
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click()
    await dialog.getByText('设置已保存', { exact: true }).waitFor()
    assert.equal((await h.product.read.projectSettings(h.projectId)).current.revision, 2)
    await dialog.locator('summary').click()
    assert.match(await dialog.locator('.settings-history').innerText(), /版本 1 · 支付服务/)
    if (!values['no-capture']) await page.screenshot({ path: join(output, 'desktop.png') })
    await dialog.getByRole('button', { name: '关闭项目设置' }).click()
    await page.reload()
    await page.getByRole('group', { name: '按项目筛选' }).getByRole('button', { name: '支付服务正式版', exact: true }).click()
    await page.getByRole('button', { name: '项目设置', exact: true }).click()
    await dialog.getByText('版本 2', { exact: true }).waitFor()
    assert.equal(await dialog.getByRole('combobox', { name: '验收检查' }).inputValue(), 'npm_test')
  })
  await check('ARCHIVE-AND-RESTORE-ACTUAL-CONFIGURATION', async () => {
    await dialog.getByRole('button', { name: '归档项目', exact: true }).click()
    await dialog.getByText('项目已归档', { exact: true }).waitFor()
    assert.equal(await dialog.getByRole('button', { name: '保存设置', exact: true }).isEnabled(), false)
    assert.equal((await h.product.read.configuration()).projects[0].dispatchAllowed, false)
    await dialog.getByRole('button', { name: '恢复项目', exact: true }).click()
    await dialog.getByText('项目已恢复', { exact: true }).waitFor()
    assert.equal((await h.product.read.configuration()).projects[0].dispatchAllowed, true)
  })
  await check('CONCURRENT-EDIT-REFUSES-STALE-PAGE-WITHOUT-LOSING-INPUT', async () => {
    await dialog.getByRole('textbox', { name: '项目名称' }).fill('本页尚未保存的修改')
    await h.product.operations.projectSettings({ kind: 'update_project_settings', commandId: 'another-operator-edit', projectId: h.projectId,
      expectedRevision: 2, displayName: '另一窗口保存', check: 'node_test', environment: { policy: 'existing_only' } }, h.actor)
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    assert.equal(await dialog.getByRole('textbox', { name: '项目名称' }).inputValue(), '本页尚未保存的修改')
    assert.equal((await h.product.read.projectSettings(h.projectId)).current.displayName, '另一窗口保存')
    await dialog.getByRole('button', { name: '刷新', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('dialog input[aria-label="项目名称"]')?.value === '另一窗口保存')
  })
  await check('MOBILE-DIALOG-CACHE-VALIDATION-AND-KEYBOARD', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await dialog.getByRole('checkbox', { name: '授权使用本地缓存离线准备依赖' }).check()
    await dialog.getByRole('textbox', { name: '缓存目录' }).fill('/does-not-exist/settings-fixture')
    await dialog.getByRole('button', { name: '保存设置', exact: true }).click()
    await dialog.getByRole('alert').waitFor()
    assert.equal((await h.product.read.projectSettings(h.projectId)).current.revision, 3)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    const box = await dialog.boundingBox(); assert.ok(box.width <= 390 && box.x >= 0)
    if (!values['no-capture']) await page.screenshot({ path: join(output, 'mobile.png') })
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: '工作空间', exact: true }).evaluate(element => document.activeElement === element), true)
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); await h.close()
  const report = { status: cases.length === 4 && cases.every(item => item.status === 'PASS') ? 'PASS_SETTINGS_HTTP_BROWSER' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/project-settings*'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, modelCalls: 0,
    limitations: ['Real HTTP and SQLite with a configuration-only profile fixture; the execution runtime is deliberately not started', 'No native task, dependency installation, full product or installer admission'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
}
