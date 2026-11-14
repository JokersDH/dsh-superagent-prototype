/**
 * Browser acceptance for the trial workspace, driven against the real component and schema-validated
 * fixtures. It proves state wording, the four navigation callbacks, keyboard reachability, double-click
 * suppression, retry semantics without transport calls, bounded responsive layout and honest empty
 * states. The harness banner marks the data as controlled; element screenshots show only the component.
 *
 * Usage: node e2e/trial/trial-states.mjs   (spawns its own Vite on 5178 unless TRIAL_URL is set)
 */
import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, closeSync, openSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const consoleDir = join(here, '..', '..')
const screenshots = join(here, 'screenshots')
mkdirSync(screenshots, { recursive: true })
const results = []
const failures = []
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const step = async (id, action, detail) => {
  const started = Date.now()
  try {
    await action()
    results.push({ id, status: 'PASS', ms: Date.now() - started, detail })
  } catch (error) {
    results.push({ id, status: 'FAIL', ms: Date.now() - started, detail: `${detail ?? ''} ${String(error?.message ?? error)}`.trim() })
    failures.push(id)
  }
}

const logFile = join('/tmp', `f-trial-states-${process.pid}.log`)
const logFd = openSync(logFile, 'a')
let server
const port = Number(process.env.TRIAL_PORT ?? 5178)
const base = process.env.TRIAL_URL ?? `http://127.0.0.1:${port}`
const waitFor = async (url, tries = 80) => {
  for (let attempt = 0; attempt < tries; attempt += 1) {
    try { const response = await fetch(url); if (response.ok) return } catch { /* not up yet */ }
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error(`dev server did not answer within ${tries} bounded attempts: ${url}`)
}
try {
  if (process.env.TRIAL_URL === undefined) {
    server = spawn(join(consoleDir, 'node_modules', '.bin', 'vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: consoleDir, env: { ...process.env, VITE_CONSOLE_MODE: 'fixture' }, stdio: ['ignore', logFd, logFd],
    })
    await waitFor(`${base}/e2e/trial/harness.html`)
  }

  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', colorScheme: 'light' })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`))
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
  const open = async (query) => {
    await page.goto(`${base}/e2e/trial/harness.html?${query}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.trial-view')
  }
  const actions = () => page.evaluate(() => window.__TRIAL_ACTIONS__ ?? [])
  const requests = () => page.evaluate(() => window.__TRIAL_REQUESTS__ ?? [])
  const actionButtons = () => page.locator('.trial-actions button')
  const labels = async () => (await actionButtons().allTextContents()).map(text => text.trim())
  const strip = async () => (await page.locator('.trial-cell').allInnerTexts()).map(text => text.replace(/\s+/g, ' ').trim())
  const layoutAudit = async (target) => target.evaluate(() => {
    const violations = []
    const rect = element => element.getBoundingClientRect()
    const overlap = (a, b) => !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5)
    const buttons = [...document.querySelectorAll('.trial-actions button')]
    for (let i = 0; i < buttons.length; i += 1)
      for (let j = i + 1; j < buttons.length; j += 1)
        if (overlap(rect(buttons[i]), rect(buttons[j]))) violations.push('actions overlap')
    const cells = [...document.querySelectorAll('.trial-cell')]
    for (let i = 0; i < cells.length; i += 1)
      for (let j = i + 1; j < cells.length; j += 1)
        if (overlap(rect(cells[i]), rect(cells[j]))) violations.push('strip cells overlap')
    const heading = document.querySelector('.trial-heading'), meta = document.querySelector('.trial-header-meta')
    if (heading && meta && overlap(rect(heading), rect(meta))) violations.push('header overlaps meta')
    for (const element of document.querySelectorAll('.trial-project-name, .trial-value-text strong, .trial-value-text small, .trial-sentence, .trial-fact dd, .trial-panel-meta')) {
      const style = getComputedStyle(element)
      if (element.scrollWidth > element.clientWidth + 1 && style.textOverflow !== 'ellipsis') violations.push(`text clips horizontally: ${element.className}`)
      if (element.scrollHeight > element.clientHeight + 1 && style.overflow !== 'visible' && style.overflowY !== 'visible') violations.push(`text clips vertically: ${element.className}`)
    }
    for (const button of document.querySelectorAll('.trial-view button')) {
      if (rect(button).height < 31.5) violations.push('control below 32px')
      if (rect(button).width < 24) violations.push('control narrower than 24px')
    }
    for (const element of document.querySelectorAll('.trial-view, .trial-view *')) {
      const style = getComputedStyle(element)
      const radius = parseFloat(style.borderRadius)
      if (!style.borderRadius.includes('%') && radius > 8) violations.push(`radius above 8px: ${element.className}`)
      if (style.boxShadow !== 'none') violations.push(`unexpected shadow: ${element.className}`)
      if (style.transform !== 'none') violations.push(`unexpected transform: ${element.className}`)
      const size = parseFloat(style.fontSize)
      if (size < 10) violations.push(`font below 10px: ${element.className}`)
      if (style.letterSpacing !== '0px' && style.letterSpacing !== 'normal') violations.push(`tracking applied: ${element.className}`)
    }
    return [...new Set(violations)]
  })
  const contrast = (foreground, background) => {
    const parse = value => {
      const text = value.trim()
      const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
      if (hex) {
        const digits = hex[1].length === 3 ? hex[1].split('').map(part => part + part).join('') : hex[1]
        return [0, 2, 4].map(index => parseInt(digits.slice(index, index + 2), 16) / 255)
      }
      const match = text.match(/rgba?\(([^)]+)\)/)
      if (!match) return [0, 0, 0]
      return match[1].split(',').slice(0, 3).map(part => Number(part.trim()) / 255)
    }
    const luminance = value => {
      const [r, g, b] = parse(value).map(channel => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const a = luminance(foreground), b = luminance(background)
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
  }
  const token = name => page.evaluate(name => getComputedStyle(document.documentElement).getPropertyValue(name).trim(), name)

  await step('CONFIGURED', async () => {
    await open('state=configured')
    const cells = await strip()
    assert(cells[0].includes('个人模式'), 'mode is personal')
    assert(cells[1].includes('已配置'), 'discussion configured')
    assert(cells[2].includes('配置已具备'), 'development configuration')
    assert(cells[2].includes('配置事实，非连接验证'), 'configuration is not a connection proof')
    assert((await labels()).join('|') === '打开主对话', 'only the conversation entry is offered')
    assert(await page.getByText('当前', { exact: true }).count() === 1, 'active project marker')
    assert((await page.locator('.trial-fact').filter({ hasText: '当前项目' }).innerText()).includes('流程测试项目'), 'the current project is named explicitly')
    assert((await page.locator('.trial-boundary').innerText()).includes('未授予执行权限'), 'the absence of execution authority is explicit')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'configured.png') })
  }, 'configured state shows facts only and one navigation action')

  await step('UNCONFIGURED', async () => {
    await open('state=unconfigured')
    const cells = await strip()
    assert(cells[1].includes('未配置'), 'discussion is unconfigured')
    assert((await labels())[0] === '配置对话模型', 'model configuration is primary')
    assert((await labels()).includes('打开主对话'), 'conversation navigation remains available')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'unconfigured.png') })
  }, 'missing model configuration is separated from execution readiness')

  await step('BLOCKED', async () => {
    await open('state=blocked')
    const cells = await strip()
    assert(cells[2].includes('暂不可用'), 'development is blocked')
    assert(cells[2].includes('未安装 Codex'), 'the actual reason is shown')
    assert((await labels())[0] === '检查执行器', 'executor inspection is primary')
    assert(await page.locator('.trial-dot.tone-danger').count() >= 1, 'blocked uses the danger semantic')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'blocked.png') })
  }, 'execution blockage names the reason instead of a bare red error')

  await step('NEEDS-PROJECT', async () => {
    await open('state=needs-project')
    assert((await strip())[2].includes('需要项目'), 'development needs a project')
    assert((await labels())[0] === '导入项目', 'import is primary')
    assert((await labels()).includes('检查执行器'), 'inspection is secondary')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'needs-project.png') })
  }, 'a missing project is actionable and does not claim readiness')

  await step('NO-PROJECTS', async () => {
    await open('state=no-projects')
    assert((await page.locator('.trial-panel').first().innerText()).includes('开发 0 · 讨论 0 · 可派工 0'), 'zero counts are real zero, not unknown')
    assert((await page.locator('.trial-panel').first().innerText()).includes('还没有项目'), 'empty project list is explained')
    assert((await labels())[0] === '导入项目', 'import is the primary action')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'no-projects.png') })
  }, 'an empty project set is an actionable state, not a blank panel')

  await step('FIXTURE', async () => {
    await open('state=fixture')
    const cells = await strip()
    assert(cells[0].includes('固定流程'), 'fixture mode is labelled')
    assert(cells[2].includes('固定流程'), 'fixture execution is labelled')
    assert(cells[2].includes('非原生执行器'), 'fixture is not native')
    assert(!cells[2].includes('配置已具备'), 'fixture never renders as admitted native')
    assert((await page.locator('.trial-facts').innerText()).includes('已准入 4'), 'controlled profiles are counted')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'fixture.png') })
  }, 'controlled fixture path is never mistaken for native readiness')

  await step('UNKNOWN', async () => {
    await open('state=unknown')
    const cells = await strip()
    assert(cells[1].includes('未知') && cells[2].includes('未知'), 'both unknown states are named')
    assert(!(await page.locator('.trial-cell').nth(2).locator('.trial-dot').getAttribute('class')).includes('tone-ok'), 'unknown is not painted ready')
    assert((await labels())[0] === '检查执行器', 'inspection is the safe next step')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'unknown.png') })
  }, 'unknown stays unknown and never turns green')

  await step('READONLY', async () => {
    await open('state=readonly')
    const cells = await strip()
    assert(cells[0].includes('只读恢复') || cells[0].includes('个人模式'), 'readonly mode is visible')
    assert(cells[2].includes('只读恢复'), 'development is read-only')
    assert((await page.locator('.trial-view').innerText()).includes('只读'), 'readonly explains what is possible')
    assert(!(await labels()).includes('导入项目'), 'readonly does not offer the import write')
    for (const label of await labels()) assert(!/批准|恢复授权|重发|接受/.test(label), `readonly offered an approval-like action: ${label}`)
    assert((await page.locator('.trial-facts').innerText()).replace(/\s+/g, '').includes('项目决定未提供'), 'disabled capabilities are visible')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'readonly.png') })
  }, 'recovery read-only keeps readable navigation and hides approval/write entries')

  await step('NOREDINESS', async () => {
    await open('state=noreadiness')
    const cells = await strip()
    assert(cells.every(cell => cell.includes('未观察')), 'unread values stay unobserved')
    assert((await page.locator('.trial-sentence').innerText()).includes('尚未读取'), 'headline states the gap')
    assert(!(await labels()).includes('导入项目'), 'import is not inferred before configuration is read')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'noreadiness.png') })
  }, 'an unread readiness is not guessed from other data')

  await step('LOADING', async () => {
    await open('state=loading')
    assert(await page.locator('[role=status]').first().innerText().then(text => text.includes('正在读取')), 'loading is announced')
    assert(await page.locator('.trial-view').getAttribute('aria-busy') === 'true', 'aria-busy is set')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'loading.png') })
  }, 'first load announces progress and blocks no navigation')

  await step('UNAVAILABLE', async () => {
    await open('state=unavailable')
    assert((await page.locator('[role=status]').first().innerText()).includes('未提供试用状态接口'), 'absent endpoint is named')
    assert((await strip()).every(cell => cell.includes('未观察')), 'absent endpoint does not fabricate values')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'unavailable.png') })
  }, 'an old backend degrades explicitly')

  await step('ERROR-AND-RETRY', async () => {
    await open('state=error')
    assert(await page.locator('[role=alert]').count() === 1, 'error is an alert')
    assert((await page.locator('[role=alert]').innerText()).includes('上次读取结果'), 'last valid observation is retained')
    const before = await requests()
    assert((await strip())[1].includes('已配置'), 'stale data still renders')
    await page.locator('[role=alert] button').click()
    await page.waitForTimeout(150)
    assert(await page.evaluate(() => window.__TRIAL_RELOADS__) === 1, 'retry asks for a re-read')
    assert((await requests()).length === before.length, 'retry performs no transport request of its own')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'error.png') })
  }, 'retry re-reads status without clearing valid data or sending a command')

  await step('LONG-CONTENT', async () => {
    await open('state=long')
    assert(await page.locator('.trial-project').count() === 5, 'five projects render')
    assert((await page.locator('.trial-fact').filter({ hasText: '当前对话' }).innerText()).includes('把本机执行器'), 'long conversation title renders')
    const overflow = await page.evaluate(() => {
      const root = document.querySelector('.trial-view')
      return { page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth,
        root: root.scrollWidth, rootClient: root.clientWidth }
    })
    assert(overflow.page <= overflow.client + 1, `page overflows horizontally: ${JSON.stringify(overflow)}`)
    assert(overflow.root <= overflow.rootClient + 1, `component overflows horizontally: ${JSON.stringify(overflow)}`)
    const insights = await page.locator('.trial-insights').innerText()
    assert(insights.includes('未知'), 'unknown insight value stays unknown')
    assert(insights.includes('可见性代理'), 'limitations are published')
    assert(insights.includes('本项目群 5 个项目'), 'the declared scope is named')
    assert(insights.includes('2 个未知'), 'the unknown count is declared')
    assert(insights.includes('美元') === false && insights.includes('USD'), 'currency stays on its own row')
    assert(insights.includes('原生执行') && insights.includes('受控流程'), 'layers stay labelled')
    assert(await page.locator('.trial-insight-row').count() === 3, 'each metric keeps its own row')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'long.png') })
  }, 'long Chinese/English content wraps without horizontal overflow')

  await step('VISUAL-AUDIT', async () => {
    await open('state=long')
    const violations = await layoutAudit(page)
    assert(violations.length === 0, `layout violations: ${violations.join('; ')}`)
    const pairs = [
      ['ink', 'panel', 4.5], ['muted', 'panel', 4.5], ['muted', 'sidebar', 4.5],
      ['warn', 'warn-soft', 4.5], ['danger', 'danger-soft', 4.5], ['accent-strong', 'accent-soft', 4.5],
    ]
    for (const [foreground, background, minimum] of pairs) {
      const value = contrast(await token(`--${foreground}`), await token(`--${background}`))
      assert(value >= minimum, `contrast ${foreground} on ${background} is ${value.toFixed(2)}`)
    }
    await open('state=blocked')
    const danger = await page.locator('.trial-cell').nth(2).locator('.trial-dot').evaluate(element => getComputedStyle(element).backgroundColor)
    assert(danger === await token('--danger') || danger === 'rgb(173, 66, 71)', `blocked dot uses the danger token: ${danger}`)
    await open('state=configured')
    const ok = await page.locator('.trial-cell').nth(2).locator('.trial-dot').evaluate(element => getComputedStyle(element).backgroundColor)
    assert(ok === await token('--ok') || ok === 'rgb(39, 118, 76)', `ready dot uses the ok token: ${ok}`)
    await open('state=unknown')
    const warn = await page.locator('.trial-cell').nth(2).locator('.trial-dot').evaluate(element => getComputedStyle(element).backgroundColor)
    assert(warn === await token('--warn') || warn === 'rgb(142, 94, 32)', `unknown dot uses the warn token: ${warn}`)
  }, 'geometry, overflow, contrast, radii, shadows and semantic dot colours are verified programmatically')

  await step('INSIGHTS-EMPTY', async () => {
    await open('state=insights-empty')
    assert((await page.locator('.trial-insights').innerText()).includes('样本不足'), 'insufficient data is honest')
    assert(await page.locator('.trial-insight-rows').count() === 0, 'no measurements are fabricated')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'insights-empty.png') })
  }, 'optional insights cannot invent efficiency numbers')

  await step('INSIGHTS-UNSCOPED', async () => {
    await open('state=insights-unscoped')
    assert((await page.locator('.trial-insights').innerText()).includes('缺少观测范围说明'), 'an undeclared scope blocks measurements')
    assert(await page.locator('.trial-insight-row').count() === 0, 'no metric row is shown without scope')
    assert((await labels())[0] === '打开主对话', 'core readiness actions stay available')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'insights-unscoped.png') })
  }, 'ready-looking metrics without a declared scope are not shown')

  await step('INSIGHTS-WRONG-PROJECT', async () => {
    await open('state=insights-wrong-project')
    assert((await page.locator('.trial-insights').innerText()).includes('不包含当前项目'), 'foreign-project summary is refused')
    assert(await page.locator('.trial-insight-row').count() === 0, 'no foreign metric row is shown')
    assert((await page.locator('.trial-fact').filter({ hasText: '当前项目' }).innerText()).includes('流程测试项目'), 'the current project identity is still visible')
    await page.locator('.trial-view').screenshot({ path: join(screenshots, 'insights-wrong-project.png') })
  }, 'a summary for another project cannot be read as the current project result')

  await step('NAVIGATION-CALLBACKS', async () => {
    for (const [state, expected] of [['blocked', 'inspect_executor'], ['needs-project', 'import_project'], ['unconfigured', 'configure_model'], ['configured', 'open_conversation']]) {
      await open(`state=${state}`)
      const button = page.locator(`[data-trial-action="${expected}"]`)
      assert(await button.count() === 1, `${state} offers ${expected}`)
      await button.click()
      await page.waitForTimeout(80)
      assert((await actions()).at(-1) === expected, `${state} recorded ${expected}`)
    }
  }, 'each of the four navigation names is reachable and recorded once')

  await step('DOUBLE-CLICK-GUARD', async () => {
    await open('state=configured')
    await page.evaluate(() => { window.__TRIAL_ACTIONS__.length = 0 })
    const button = page.locator('[data-trial-action="open_conversation"]')
    await button.click()
    await page.waitForTimeout(80)
    assert((await actions()).length === 1, 'one click is one navigation')
    await button.click()
    await button.click()
    await page.waitForTimeout(80)
    assert((await actions()).length === 1, 'a rapid double click is suppressed')
    await page.waitForTimeout(350)
    await button.click()
    await page.waitForTimeout(80)
    assert((await actions()).length === 2, 'a later deliberate click still navigates')
  }, 'rapid duplicate activation does not duplicate navigation')

  await step('KEYBOARD', async () => {
    await open('state=configured')
    await page.evaluate(() => { window.__TRIAL_ACTIONS__.length = 0; document.body.focus() })
    await page.keyboard.press('Tab')
    const first = await page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim(), visible: document.activeElement?.matches(':focus-visible') }))
    assert(first.label === '重新读取试用状态', `first focusable is the reload control: ${JSON.stringify(first)}`)
    assert(first.visible === true, 'focus is visible')
    await page.keyboard.press('Tab')
    const second = await page.evaluate(() => ({ action: document.activeElement?.getAttribute('data-trial-action'), visible: document.activeElement?.matches(':focus-visible') }))
    assert(second.action === 'open_conversation', `second focusable is the primary action: ${JSON.stringify(second)}`)
    assert(second.visible === true, 'action focus is visible')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(80)
    assert((await actions()).length === 1, 'keyboard activation calls the callback once')
    await open('state=configured')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(120)
    const afterReload = await page.evaluate(() => ({ label: document.activeElement?.getAttribute('aria-label'), reloads: window.__TRIAL_RELOADS__ }))
    assert(afterReload.label === '重新读取试用状态', `reload keeps keyboard focus: ${JSON.stringify(afterReload)}`)
    assert(afterReload.reloads === 1, 'keyboard reload re-reads exactly once')
    const structure = await page.evaluate(() => {
      const view = document.querySelector('.trial-view')
      const buttons = [...view.querySelectorAll('button')]
      return {
        labelled: view.getAttribute('aria-labelledby') !== null,
        heading: view.querySelector('h2')?.textContent ?? '',
        nameless: buttons.filter(button => !(button.getAttribute('aria-label') ?? button.textContent ?? '').trim()).length,
        hiddenFocusable: [...view.querySelectorAll('[aria-hidden="true"] button, [aria-hidden="true"] a')].length,
        cells: view.querySelectorAll('.trial-cell').length,
      }
    })
    assert(structure.labelled && structure.heading === '试用准备', 'section is labelled by its heading')
    assert(structure.nameless === 0, 'every button has an accessible name')
    assert(structure.hiddenFocusable === 0, 'no focusable element is hidden from assistive tech')
    assert(structure.cells === 3, 'the status strip is a three-part definition list')
  }, 'the main journey is operable by keyboard with visible focus and names')

  await step('MOBILE', async () => {
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' })
    const mobilePage = await mobile.newPage()
    const mobileErrors = []
    mobilePage.on('pageerror', error => mobileErrors.push(error.message))
    for (const state of ['configured', 'unconfigured', 'blocked', 'unknown', 'readonly', 'long', 'insights-unscoped', 'insights-wrong-project']) {
      await mobilePage.goto(`${base}/e2e/trial/harness.html?state=${state}`, { waitUntil: 'networkidle' })
      await mobilePage.waitForSelector('.trial-view')
      const overflow = await mobilePage.evaluate(() => ({ page: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
      assert(overflow.page <= overflow.client + 1, `${state} mobile overflows: ${JSON.stringify(overflow)}`)
      const cells = await mobilePage.locator('.trial-cell').count()
      assert(cells === 3, `${state} keeps the strip`)
      const mobileViolations = await layoutAudit(mobilePage)
      assert(mobileViolations.length === 0, `${state} mobile layout violations: ${mobileViolations.join('; ')}`)
      await mobilePage.locator('.trial-view').screenshot({ path: join(screenshots, `mobile-${state}.png`) })
    }
    assert(mobileErrors.length === 0, `mobile page errors: ${mobileErrors.join('; ')}`)
    await mobile.close()
  }, 'narrow viewport keeps every action reachable without horizontal overflow')

  await step('STALE-RESPONSE', async () => {
    await page.goto(`${base}/e2e/trial/harness.html?mode=stale`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.trial-view')
    await page.locator('[data-harness="reload"]').click()
    await page.waitForFunction(() => document.querySelector('.trial-cell:nth-child(2) .trial-value-text strong')?.textContent === '已配置')
    await page.locator('[data-harness="resolve-first"]').click()
    await page.waitForTimeout(300)
    assert((await strip())[1].includes('已配置'), 'a late first response cannot overwrite the newer read')
  }, 'out-of-order responses keep the newest identity')

  await step('UNMOUNT-IN-FLIGHT', async () => {
    const before = errors.length
    await page.goto(`${base}/e2e/trial/harness.html?mode=unmount`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.trial-view')
    await page.locator('[data-harness="unmount"]').click()
    await page.locator('[data-harness="resolve"]').click()
    await page.waitForTimeout(250)
    assert(await page.locator('[data-unmounted="true"]').count() === 1, 'component unmounted')
    assert(errors.length === before, `unmount produced errors: ${errors.slice(before).join('; ')}`)
  }, 'a response after unmount updates no state')

  await step('BROWSER-ERRORS', async () => {
    assert(errors.length === 0, `browser errors: ${errors.join('; ')}`)
  }, 'no page or console errors across the suite')

  await browser.close()
  writeFileSync(join(here, 'report-states.json'), JSON.stringify({
    subject: 'trial workspace, controlled fixtures (not a product/native/release verdict)',
    base, viewports: ['1440x900', '390x844'], generatedAt: new Date().toISOString(),
    results, failures, screenshots: screenshots,
  }, null, 2))
  console.log(`${failures.length === 0 ? 'PASS' : 'FAIL'} trial-states: ${results.filter(item => item.status === 'PASS').length}/${results.length}`)
  for (const item of results) console.log(`${item.status} ${item.id} (${item.ms}ms)`)
  if (failures.length) process.exitCode = 1
} finally {
  closeSync(logFd)
  if (server !== undefined) {
    server.kill('SIGTERM')
    await new Promise(resolve => server.once('exit', resolve))
  }
}
