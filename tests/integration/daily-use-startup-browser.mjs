import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { personalCase } from './fixtures/personal-startup.mjs'
import { ensureStarterProject } from '../../apps/coordinator/product/project-registry.ts'

if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('This source UI regression requires the admitted darwin-arm64 platform')
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const evidence = mkdtempSync('/tmp/pa-ms03-startup-ui-')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' })
page.setDefaultTimeout(15000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
let checks = 0
try {
  const loggedOut = await personalCase({ mode: 'needs_auth', workbench: true })
  try {
    await loggedOut.start()
    await page.goto(loggedOut.consoleURL)
    const status = page.getByRole('status', { name: '开发执行状态', exact: true })
    await status.waitFor()
    assert.match(await status.textContent(), /Codex 尚未登录/)
    assert.match(await status.textContent(), /codex login/)
    await page.getByRole('button', { name: '查看执行器', exact: true }).click()
    await page.getByRole('heading', { name: '执行器连接', exact: true }).waitFor()
    assert.match(await page.locator('.executor-row').textContent(), /尚未登录/)
    assert.equal(await page.locator('.test-profiles').count(), 0)
    assert.equal(loggedOut.modelRequests.length, 0)
    assert.equal(existsSync(loggedOut.launchLog), false)
    await page.screenshot({ path: join(evidence, 'needs-auth.png'), fullPage: true })
    checks++
    console.log('PASS normal personal workbench explains missing local login without model/native work')
  } finally { await loggedOut.close() }

  const ready = await personalCase({ mode: 'ready', workbench: true })
  try {
    const project = join(ready.root, 'sample project')
    ensureStarterProject(project)
    await ready.start()
    await page.goto(ready.consoleURL)
    await page.getByRole('button', { name: '导入项目', exact: true }).waitFor()
    const before = (await ready.json('/v1/configuration')).value
    assert.equal(before.projects.length, 1)
    assert.equal(before.projects[0].discussionOnly, true)
    assert.deepEqual(before.profiles.map(profile => profile.id), ['profile-codex-native'])
    assert.equal(await page.locator('.project-filter').textContent().then(value => /流程测试项目/.test(value)), false)
    await page.getByRole('button', { name: '执行器目录', exact: true }).click()
    await page.getByRole('heading', { name: '执行器连接', exact: true }).waitFor()
    assert.equal(await page.locator('.executor-row').count(), 1)
    assert.equal(await page.locator('.test-profiles').count(), 0)
    checks++
    console.log('PASS normal ready startup exposes one native executor and requires explicit project import')

    await page.getByRole('button', { name: '导入项目', exact: true }).click()
    const form = page.getByRole('form', { name: '导入本地项目', exact: true })
    await form.locator('input[name="project-path"]').fill(project)
    await form.getByRole('button', { name: '导入项目', exact: true }).click()
    const workForm = page.locator('.new-work')
    await workForm.waitFor()
    assert.equal(await workForm.getByRole('combobox', { name: '开发执行器', exact: true }).locator('option').count(), 1)
    assert.equal(await workForm.getByRole('combobox', { name: '开发执行器', exact: true }).inputValue(), 'profile-codex-native')
    const imported = (await ready.json('/v1/configuration')).value.projects.find(value => value.displayName === 'sample project')
    assert.ok(imported?.dispatchAllowed)
    assert.notEqual(imported.id, 'project-atlas')
    await workForm.getByRole('button', { name: '取消', exact: true }).click()
    await page.screenshot({ path: join(evidence, 'ready-imported.png'), fullPage: true })
    assert.equal((await ready.json('/v1/snapshot')).value.works.length, 0)
    assert.equal(ready.modelRequests.length, 0)
    assert.equal(existsSync(ready.launchLog), false)
    checks++
    console.log('PASS real React import selects the original registered project/native executor without creating a task')

    await ready.stop()
    await ready.start()
    await page.goto(ready.consoleURL)
    await page.getByRole('button', { name: 'sample project', exact: true }).waitFor()
    const reopened = (await ready.json('/v1/configuration')).value.projects.find(value => value.id === imported.id)
    assert.equal(reopened.displayName, imported.displayName)
    assert.deepEqual(reopened.defaultCriteria, imported.defaultCriteria)
    assert.equal(readFileSync(ready.authLog, 'utf8').trim().split('\n').length, 2)
    assert.equal(ready.modelRequests.length, 0)
    assert.equal(existsSync(ready.launchLog), false)
    checks++
    console.log('PASS normal process reopening preserves the original project and checks local login again without a task')
  } finally { await ready.close() }
  assert.deepEqual(errors, [])
  console.log('PASS ' + checks + ' source UI cases; screenshots=' + evidence + '; real vendor/model/native turns=0; source UI with a private fake CLI, not installed/native delivery acceptance')
} finally { await browser.close() }
