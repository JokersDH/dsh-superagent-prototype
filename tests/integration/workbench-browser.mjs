import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://127.0.0.1:5180' },
    state: { type: 'string', default: '.local-state/workbench' },
  },
})
const { chromium } = createRequire(new URL('../../apps/console/package.json', import.meta.url))('@playwright/test')
const directory = resolve('reports/releases/workbench-browser')
const redact = (value) => String(value)
mkdirSync(directory, { recursive: true })
const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  locale: 'zh-CN',
})
const page = await context.newPage()
const cases = [],
  errors = []
page.on('pageerror', (error) => errors.push(redact(error.message)))
const step = async (id, action) => {
  try {
    await action()
    cases.push({ id, status: 'PASS' })
  } catch (error) {
    const message = redact(error.message)
    cases.push({ id, status: 'FAIL', message })
    throw new Error(message)
  }
}
const goal = `Controlled browser work ${Date.now()}`
const conversationId = `browser-test-${crypto.randomUUID()}`
const conversationURL = new URL(values.url)
conversationURL.searchParams.set('conversation', conversationId)
try {
  await step('AUTOMATIC-LOCAL-SESSION', async () => {
    await page.goto(conversationURL.href)
    await page.waitForSelector('.layout')
    assert.equal(await page.locator('.session-gate').count(), 0)
  })
  await step('CREATE-REAL-QUESTION', async () => {
    await page.getByRole('button', { name: '新建委托' }).click()
    await page.locator('.new-work').getByRole('combobox', { name: '项目', exact: true }).selectOption('project-atlas')
    await page
      .locator('.new-work')
      .getByRole('combobox', { name: '开发执行器', exact: true })
      .selectOption('profile-fixture-question')
    await page.locator('.new-work textarea').fill(goal)
    await page.locator('.new-work').getByRole('button', { name: '创建委托' }).click()
    await page.waitForSelector('.question-card', { timeout: 10000 })
    assert.match(await page.locator('.question-card').first().innerText(), /Allow the controlled fixture/)
  })
  await step('ACTIVE-REFRESH-KEEPS-QUESTION', async () => {
    const before = await (
      await context.request.get(`${values.url}/v1/snapshot?conversationId=${conversationId}`)
    ).json()
    const question = before.questions[0]
    assert.ok(question)
    await page.reload()
    await page.locator('.work-card').filter({ hasText: goal }).click()
    await page.waitForSelector('.question-card')
    const after = await (await context.request.get(`${values.url}/v1/snapshot?conversationId=${conversationId}`)).json()
    assert.deepEqual(after.questions.find((item) => item.id === question.id)?.targets, question.targets)
  })
  await step('ANSWER-AND-VERIFY', async () => {
    await page.locator('.question-card').first().getByRole('button', { name: 'Allow once' }).click()
    await page.waitForSelector('.verification .outcome-PASS', {
      timeout: 10000,
    })
    await page.getByRole('button', { name: '接受当前候选' }).waitFor()
    assert.equal(await page.locator('.artifacts li').count(), 4)
  })
  await step('READ-VERIFIED-OUTPUT', async () => {
    await page.locator('.artifacts li').nth(2).getByRole('button', { name: '查看' }).click()
    await page.waitForSelector('.artifact-text')
    assert.match(await page.locator('.artifact-text').innerText(), /approved product output/)
    await page.locator('.artifact-preview').getByRole('button', { name: '关闭预览' }).click()
  })
  await step('ACCEPT-AND-RELOAD', async () => {
    await page.getByRole('button', { name: '接受当前候选' }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    await page.reload()
    await page.locator('.work-card').filter({ hasText: goal }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    assert.equal(await page.locator('.artifacts li').count(), 4)
  })
  await step('MACHINE-FAIL-CANNOT-DELIVER', async () => {
    const failedGoal = `${goal} failing`
    await page.getByRole('button', { name: '新建委托' }).click()
    await page.locator('.new-work').getByRole('combobox', { name: '项目', exact: true }).selectOption('project-atlas')
    await page.locator('.new-work textarea').fill(failedGoal)
    await page.locator('.new-work select').last().selectOption('profile-fixture-fail')
    await page.locator('.new-work').getByRole('button', { name: '创建委托' }).click()
    await page.locator('.work-card').filter({ hasText: failedGoal }).click()
    await page.waitForSelector('.verification .outcome-FAIL', {
      timeout: 10000,
    })
    assert.equal(await page.getByRole('button', { name: '接受当前候选' }).count(), 0)
  })
  await step('DESKTOP-AND-NARROW-LAYOUT', async () => {
    assert.equal(
      await page.locator('.messages .role-user').count(),
      0,
      'work goals must not masquerade as personal chat',
    )
    await page.screenshot({
      path: join(directory, 'desktop.png'),
      fullPage: true,
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({
      path: join(directory, 'narrow.png'),
      fullPage: true,
    })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
    assert.equal(overflow, false)
    assert.equal(errors.length, 0, errors.join('\n'))
  })
  await step('SAFE-MODEL-SETTINGS', async () => {
    await page.getByRole('button', { name: '模型设置', exact: true }).click()
    await page.locator('.model-panel').waitFor()
    assert.equal(await page.locator('.work-panels').isVisible(), false)
    const response = await context.request.get(`${values.url}/v1/assistant`)
    assert.equal(response.status(), 200)
    assert.doesNotMatch(await response.text(), /apiKey|sk-/)
    await page.getByRole('button', { name: '工作详情', exact: true }).click()
    assert.equal(await page.locator('.detail').isVisible(), false)
  })
  await step('USAGE-GUIDE', async () => {
    const response = await context.request.get(`${values.url}/v1/guide`)
    assert.equal(response.status(), 200)
    assert.match(response.headers()['content-disposition'], /attachment/)
    assert.match(await response.text(), /一分钟开始/)
  })
  await step('NEW-CONVERSATION-SURVIVES-REFRESH', async () => {
    await page.getByRole('button', { name: '新对话', exact: true }).first().click()
    const conversation = new URL(page.url()).searchParams.get('conversation')
    assert.match(conversation, /^conversation-/)
    await page.reload()
    await page.waitForSelector('.layout')
    assert.equal(new URL(page.url()).searchParams.get('conversation'), conversation)
    assert.equal(await page.locator('.model-panel').count(), 0)
    assert.equal(await page.locator('.detail').isVisible(), false)
    assert.equal(errors.length, 0, errors.join('\n'))
  })
} finally {
  await browser.close()
  const report = {
    status:
      cases.length === 11 && cases.every((item) => item.status === 'PASS')
        ? 'PASS_MAIN_CONTROLLED_BROWSER'
        : 'FAIL_MAIN_CONTROLLED_BROWSER',
    testedAt: new Date().toISOString(),
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    consoleURL: values.url,
    conversationId,
    cases,
    errors,
    limitations: [
      'Controlled work execution; no paid model requests in this browser suite',
      'Independent Runner and native compatibility remain unaccepted',
      'Real model response and Markdown rendering are verified separately by manual smoke',
    ],
  }
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
