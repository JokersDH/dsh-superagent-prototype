import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { sha256 } from '../lib/evidence.mjs'
import { cleanup, pickPort, startWorkbench, tempState } from '../lib/instance.mjs'
import {
  VIEWPORTS,
  downloadBytes,
  gotoConsole,
  intersect,
  layoutFacts,
  openBrowser,
  screenshot,
} from '../lib/browser.mjs'

const LONG_CHINESE =
  '这是一个用于验证窄屏与长文本换行的中文段落，包含标点、数字 1234567890、以及不应导致横向滚动的连续描述。'.repeat(3)
const LONG_PATH =
  '/Users/hh/Desktop/joker/superagent-agent-e/packages/very-long-directory-name-for-acceptance/src/product-output.txt'

async function waitWork(client, workId, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let latest
  while (Date.now() < deadline) {
    latest = await client.work(workId)
    if (predicate(latest)) return latest
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 120))
  }
  throw new Error(`work ${workId} never reached the expected state (last ${latest?.phase})`)
}

/**
 * E3 uses the product's own Playwright install against the packaged workbench (same-origin console
 * and product API). Seeding goes through the authenticated public API; the browser only performs
 * user-visible actions. Geometry checks are facts (overflow, overlap, reachability), not taste.
 */
export async function runE3({ root, runDirectory, keep = false }) {
  const cases = []
  const shots = join(runDirectory, 'screenshots')
  const artifacts = { screenshots: [] }
  const { root: tempRoot, state } = tempState('pa-e3-')
  const port = await pickPort()
  const apiPort = await pickPort()
  const consoleURL = `http://127.0.0.1:${port}/`
  const facts = {}
  let workbench
  let browserBundle

  const push = async (definition, body) => {
    const result = await runCase({ ...definition, evidence: {} }, body)
    cases.push(result)
    return result
  }

  try {
    workbench = await startWorkbench({
      root,
      port,
      apiPort,
      stateRoot: state,
      env: { PA_MODEL_CONFIG: join(state, 'no-model-configured.json') },
    })
    const client = new LocalProductClient({ baseURL: workbench.apiURL, stateDir: state, timeoutMs: 20_000 })
    const configuration = await client.configuration()
    const project = configuration.projects.find((item) => item.dispatchAllowed)
    const machine = project.defaultCriteria.find((item) => item.kind === 'machine' && item.required)
    const human = project.defaultCriteria.find((item) => item.kind === 'human' && item.required)
    let sequence = 0
    const create = async (mode, criteria, goal) =>
      client.dispatch({
        commandId: `e3-seed-${++sequence}`,
        conversationId: 'conv-main',
        kind: 'create_work',
        projectId: project.id,
        profileId: `profile-fixture-${mode}`,
        goal,
        scope: project.scope,
        criteria,
      })

    // Seed: one open question, one candidate ready to accept, and filler works for list scrolling.
    const questionWork = await create('question', [machine, human], 'E3 待回答问题：允许受控检查')
    const acceptWork = await create('pass', [machine, human], 'E3 待接受候选：生成受控输出')
    const fillers = []
    for (let index = 0; index < 6; index += 1)
      fillers.push(await create('pass', [machine], `E3 列表工作 ${index + 1} · ${LONG_CHINESE.slice(0, 24)}`))
    await create('pass', [machine], `E3 长标题与长路径 ${LONG_CHINESE.slice(0, 40)} ${LONG_PATH}`)
    await client.dispatch({
      commandId: 'e3-seed-chat',
      conversationId: 'conv-main',
      kind: 'chat',
      projectId: project.id,
      text: `${LONG_CHINESE}\n${LONG_PATH}`,
    })

    const question = await waitWork(client, questionWork.receipt.workId, (work) => work.openQuestionIds.length === 1)
    const candidate = await waitWork(client, acceptWork.receipt.workId, (work) =>
      work.actions.available.includes('accept_candidate'),
    )
    facts.questionWorkId = questionWork.receipt.workId
    facts.questionId = question.openQuestionIds[0]
    facts.acceptWorkId = acceptWork.receipt.workId
    facts.candidate = candidate

    browserBundle = await openBrowser({ root, viewport: VIEWPORTS.desktop })
    const { page, context } = browserBundle
    await gotoConsole(page, consoleURL)
    await page.locator('.work-card').first().waitFor({ timeout: 25_000 })
    await page.waitForFunction(() => document.querySelectorAll('.work-card').length >= 8, undefined, {
      timeout: 25_000,
    })
    await page.locator('.question-card').first().waitFor({ state: 'attached', timeout: 25_000 })

    const desktopAssertions = async (assert, label) => {
      const layout = await layoutFacts(page)
      assert(`${label}_NO_HORIZONTAL_OVERFLOW`, layout.horizontalOverflow === false, JSON.stringify(layout.overflowing))
      assert(`${label}_RAIL_VISIBLE`, layout.boxes.rail?.onScreen === true)
      assert(`${label}_CONVERSATION_VISIBLE`, layout.boxes.conversation?.onScreen === true)
      assert(`${label}_COMPOSER_VISIBLE`, layout.boxes.composer?.onScreen === true)
      if (layout.boxes.sidebar?.onScreen)
        assert(
          `${label}_SIDEBAR_NO_OVERLAP`,
          intersect(layout.boxes.sidebar, layout.boxes.conversation) === 0,
          JSON.stringify(layout.boxes),
        )
      assert(
        `${label}_CONVERSATION_IS_CENTRAL`,
        layout.boxes.conversation.width >= (layout.boxes.sidebar?.width ?? 0),
        `conversation ${layout.boxes.conversation.width} vs sidebar ${layout.boxes.sidebar?.width}`,
      )
      return layout
    }

    await push(define('E3-DESKTOP-GEOMETRY', 'Desktop: conversation-centred layout without overflow or overlap'), async ({ assert, evidence }) => {
      assert('SAME_ORIGIN_HTTP_TRANSPORT', (await page.locator('html').getAttribute('data-console-mode')) === 'http')
      const navButtons = page.getByRole('navigation', { name: '工作台导航' }).getByRole('button')
      assert('NAV_PRESENT', (await navButtons.count()) >= 4)
      assert('WORK_CARDS', (await page.locator('.work-card').count()) >= 8)
      assert('QUESTION_CARD', (await page.locator('.question-card').count()) >= 1)
      assert('COMPOSER', await page.locator('#composer-input').isVisible())

      const tokens = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement)
        return {
          rail: style.getPropertyValue('--rail').trim(),
          accent: style.getPropertyValue('--accent').trim(),
          panel: style.getPropertyValue('--panel').trim(),
          body: getComputedStyle(document.body).backgroundColor,
        }
      })
      assert('TOKEN_RAIL', tokens.rail === '#272d2a', tokens.rail)
      assert('TOKEN_ACCENT', tokens.accent === '#197764', tokens.accent)
      assert('TOKEN_WHITE_CONVERSATION', tokens.body === 'rgb(255, 255, 255)', tokens.body)

      const layout = await desktopAssertions(assert, 'DESKTOP')
      await screenshot(page, shots, 'desktop-main')
      artifacts.screenshots.push(join(shots, 'desktop-main.png'))
      evidence.layouts = { desktop: layout }
      evidence.tokens = tokens
    })

    await push(define('E3-NOTEBOOK-GEOMETRY', 'Notebook 1280x800 keeps the same structure without overflow'), async ({ assert, evidence }) => {
      await page.setViewportSize(VIEWPORTS.notebook)
      await page.waitForTimeout(150)
      const layout = await desktopAssertions(assert, 'NOTEBOOK')
      await screenshot(page, shots, 'notebook-main')
      artifacts.screenshots.push(join(shots, 'notebook-main.png'))
      evidence.layouts = { notebook: layout }
    })

    await push(define('E3-MOBILE-GEOMETRY', 'Mobile: drawers replace columns and never overflow'), async ({ assert, evidence }) => {
      await page.setViewportSize(VIEWPORTS.mobile)
      await page.waitForTimeout(200)
      const initial = await layoutFacts(page)
      assert('MOBILE_NO_OVERFLOW', initial.horizontalOverflow === false, JSON.stringify(initial.overflowing))
      assert('MOBILE_COMPOSER', initial.boxes.composer?.onScreen === true)
      assert('MOBILE_SIDEBAR_HIDDEN', initial.boxes.sidebar?.onScreen !== true)
      await screenshot(page, shots, 'mobile-main')

      await page.getByRole('button', { name: '工作空间', exact: true }).click()
      await page.locator('#work-navigation').waitFor({ state: 'visible' })
      const withSidebar = await layoutFacts(page)
      assert('MOBILE_SIDEBAR_OPEN', withSidebar.boxes.sidebar?.onScreen === true)
      assert('MOBILE_SIDEBAR_NO_OVERFLOW', withSidebar.horizontalOverflow === false)
      await screenshot(page, shots, 'mobile-navigation')
      await page.getByRole('button', { name: '关闭工作列表', exact: true }).click()

      await page.getByRole('button', { name: '工作详情', exact: true }).click()
      await page.locator('#work-inspector').waitFor({ state: 'visible' })
      const withDetail = await layoutFacts(page)
      assert('MOBILE_DETAIL_OPEN', withDetail.boxes.detail?.onScreen === true)
      assert('MOBILE_DETAIL_NO_OVERFLOW', withDetail.horizontalOverflow === false)
      await screenshot(page, shots, 'mobile-detail')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(150)
      const afterEscape = await layoutFacts(page)
      assert('MOBILE_ESCAPE_CLOSES', afterEscape.boxes.detail?.onScreen !== true)
      artifacts.screenshots.push(
        join(shots, 'mobile-main.png'),
        join(shots, 'mobile-navigation.png'),
        join(shots, 'mobile-detail.png'),
      )
      evidence.layouts = { mobile: initial, mobileSidebar: withSidebar, mobileDetail: withDetail }
    })

    await push(define('E3-QUESTION-FORM', 'The decision inbox answers the real question through the UI'), async ({ assert, evidence }) => {
      await page.setViewportSize(VIEWPORTS.desktop)
      await page.getByRole('navigation', { name: '工作台导航' }).getByRole('button', { name: '待我决定' }).click()
      const card = page.locator('.question-card').first()
      await card.waitFor()
      assert('CARD_TARGET_DETAILS', (await card.locator('.technical-details').first().textContent())?.includes('原生目标'))
      const option = card.locator('.options button').first()
      const label = (await option.textContent())?.trim()
      await option.click()
      await page.waitForFunction((id) => !document.querySelector(`#q-${id}`), facts.questionId, { timeout: 15_000 })
      const snapshot = await client.snapshot({ workId: facts.questionWorkId })
      assert('UI_ANSWER_PERSISTED', snapshot.questions.every((item) => item.id !== facts.questionId))
      const deliveries = await client.deliveries(facts.questionId)
      assert(
        'DELIVERY_RECORDED',
        deliveries.some((item) => ['native_applied', 'response_written', 'local_recorded'].includes(item.status)),
        JSON.stringify(deliveries),
      )
      evidence.question = { id: facts.questionId, option: label, deliveries: deliveries.map((item) => item.status) }
    })

    await push(define('E3-ACCEPT-AND-DOWNLOAD', 'Accept through the UI, verify the artifact bytes and a patch preview'), async ({ assert, evidence }) => {
      await page.getByRole('navigation', { name: '工作台导航' }).getByRole('button', { name: '主对话视图' }).click()
      const card = page.locator('.work-card').filter({ hasText: 'E3 待接受候选' }).first()
      await card.click()
      const detail = page.locator('#work-inspector')
      await detail.waitFor()
      await detail.locator('.verification .outcome-PASS').first().waitFor()
      assert('VERIFICATION_VISIBLE', (await detail.locator('.outcome-PASS').count()) >= 1)

      // Full patch preview: the complete change must be readable, not only listed.
      const patchRow = detail.locator('.artifacts li').nth(1)
      await patchRow.getByRole('button', { name: '查看' }).click()
      await detail.locator('.artifact-preview .artifact-text').waitFor()
      const preview = await detail.locator('.artifact-preview .artifact-text').textContent()
      assert('PATCH_PREVIEW', String(preview).startsWith('diff --git'), String(preview).slice(0, 40))
      await detail.getByRole('button', { name: '关闭预览' }).click()

      // Download routes through the real `/v1/artifacts/:id` and is verified byte-for-byte.
      const outputRow = detail.locator('.artifacts li').nth(2)
      const download = await downloadBytes(page, outputRow.getByRole('link', { name: '下载' }), shots, 'product-output.txt')
      const downloaded = readFileSync(download.saved)
      assert('DOWNLOAD_BYTES', downloaded.toString('utf8') === 'approved product output\n', String(downloaded).slice(0, 40))
      assert('DOWNLOAD_DIGEST', sha256(downloaded) === sha256(readFileSync(download.saved)))
      assert('DOWNLOAD_NAME', download.suggestedFilename === 'product-output.txt', download.suggestedFilename)

      await detail.getByRole('button', { name: '接受当前候选' }).click()
      await page.waitForFunction(() => document.querySelector('#work-inspector .phase')?.textContent === '已交付', undefined, {
        timeout: 20_000,
      })
      const delivered = await client.work(facts.acceptWorkId)
      assert('API_DELIVERED', delivered.phase === 'delivered')

      // Reopen: reload the page and confirm delivery and the artifact reference survive.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.workspace-rail').waitFor()
      await page.locator('.work-card').filter({ hasText: 'E3 待接受候选' }).first().click()
      await page.locator('#work-inspector .phase').waitFor()
      assert(
        'REOPEN_SHOWS_DELIVERED',
        (await page.locator('#work-inspector .phase').first().textContent()) === '已交付',
      )
      assert('REOPEN_ARTIFACTS', (await page.locator('#work-inspector .artifacts li').count()) >= 3)
      await screenshot(page, shots, 'desktop-delivered')
      artifacts.screenshots.push(join(shots, 'desktop-delivered.png'))
      evidence.download = {
        filename: download.suggestedFilename,
        bytes: downloaded.length,
        sha256: sha256(downloaded),
        saved: download.saved,
      }
    })

    await push(define('E3-OFFLINE-AND-ERROR', 'Offline, slow and failing responses surface honest states'), async ({ assert, evidence }) => {
      // Loading: a delayed first snapshot must leave the sidebar in its explicit loading state.
      let slowSnapshot = true
      await context.route('**/v1/snapshot*', async (route) => {
        if (slowSnapshot) await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500))
        // The route can be detached while a delayed request is still in flight.
        await route.continue().catch(() => undefined)
      })
      await page.goto(consoleURL, { waitUntil: 'commit' })
      await page.locator('.workspace-rail').waitFor()
      const loadingVisible = await page
        .getByText('正在载入…')
        .first()
        .isVisible()
        .catch(() => false)
      assert('SLOW_SHOWS_LOADING', loadingVisible, 'loading indicator was not visible during a slow snapshot')
      await page.waitForFunction(() => !document.body.innerText.includes('正在载入…'), undefined, {
        timeout: 15_000,
      })
      slowSnapshot = false
      await page.waitForTimeout(1800)
      await context.unroute('**/v1/snapshot*')

      // Failing snapshot: an alert with the product message and a retry action.
      await context.route('**/v1/snapshot*', (route) =>
        route
          .fulfill({
            status: 500,
            contentType: 'application/json',
            body: JSON.stringify({
              error: { code: 'storage_unavailable', message: 'Local product operation is unavailable', retry: 'safe' },
            }),
          })
          .catch(() => undefined),
      )
      await page.getByRole('button', { name: '刷新快照' }).click()
      const alert = page.getByRole('alert').first()
      await alert.waitFor({ timeout: 10_000 })
      assert('ERROR_ALERT', (await alert.textContent())?.includes('操作未完成'))
      assert('ERROR_RETRY', (await alert.getByRole('button', { name: '刷新快照' }).count()) === 1)
      await screenshot(page, shots, 'desktop-error')
      artifacts.screenshots.push(join(shots, 'desktop-error.png'))
      await context.unroute('**/v1/snapshot*')
      await alert.getByRole('button', { name: '刷新快照' }).click()
      await page.getByRole('alert').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => undefined)

      // SSE offline: blocking the event stream must show a reconnect notice, never a false live badge.
      await context.route('**/v1/events*', (route) => route.abort())
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.workspace-rail').waitFor()
      await page.getByText('连接中断').first().waitFor({ timeout: 15_000 })
      assert('OFFLINE_BADGE', (await page.getByText('连接中断').count()) >= 1)
      assert('RECONNECT_NOTICE', (await page.getByText(/事件流断开，正在重连/).count()) >= 1)
      await screenshot(page, shots, 'desktop-offline')
      artifacts.screenshots.push(join(shots, 'desktop-offline.png'))
      await context.unroute('**/v1/events*')
      evidence.states = { slow: true, error: true, offline: true }
    })

    await push(define('E3-KEYBOARD-AND-SCROLL', 'Keyboard focus, composer and the work list stay operable'), async ({ assert, evidence }) => {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.locator('.workspace-rail').waitFor()
      await page.keyboard.press('Tab')
      const focus = await page.evaluate(() => {
        const element = document.activeElement
        if (!element || element === document.body) return null
        const style = getComputedStyle(element)
        return {
          tag: element.tagName.toLowerCase(),
          label: element.getAttribute('aria-label') ?? element.textContent?.slice(0, 24),
          outline: `${style.outlineStyle} ${style.outlineWidth}`,
        }
      })
      assert('TAB_FOCUS', focus !== null)
      assert('FOCUS_VISIBLE', focus.outline !== 'none 0px', JSON.stringify(focus))

      // Long Chinese and a long path must not create horizontal overflow in the reading column.
      const message = page.locator('.message').filter({ hasText: '用于验证窄屏与长文本换行' }).first()
      await message.scrollIntoViewIfNeeded()
      const messageOverflow = await message.evaluate((element) => element.scrollWidth - element.clientWidth)
      assert('LONG_TEXT_NO_OVERFLOW', messageOverflow <= 2, `overflow ${messageOverflow}px`)
      assert('LONG_PATH_PRESENT', (await page.getByText(LONG_PATH, { exact: false }).count()) >= 1)

      // The work list is scrollable when it holds more items than fit.
      const list = page.locator('.work-list')
      const scroll = await list.evaluate((element) => ({
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflowY: getComputedStyle(element).overflowY,
      }))
      assert('WORK_LIST_SCROLLABLE', scroll.scrollHeight > scroll.clientHeight, JSON.stringify(scroll))
      assert('WORK_LIST_OVERFLOW_AUTO', ['auto', 'scroll'].includes(scroll.overflowY), scroll.overflowY)
      const before = await list.evaluate((element) => element.scrollTop)
      await list.evaluate((element) => element.scrollBy(0, 120))
      const after = await list.evaluate((element) => element.scrollTop)
      assert('WORK_LIST_SCROLLS', after > before, `${before} -> ${after}`)

      // Composer: typing and sending appends a persisted message.
      const composer = page.locator('#composer-input')
      await composer.fill(LONG_CHINESE)
      assert('COMPOSER_VALUE', (await composer.inputValue()) === LONG_CHINESE)
      const before_count = await page.locator('.message').count()
      await page.getByRole('button', { name: '发送消息' }).click()
      await page.waitForFunction((count) => document.querySelectorAll('.message').length > count, before_count, {
        timeout: 15_000,
      })
      assert('SENT_MESSAGE', (await page.locator('.message').count()) > before_count)
      assert('ALL_BUTTONS_REACHABLE', (await page.locator('.work-card').first().isVisible()) === true)

      await screenshot(page, shots, 'desktop-keyboard')
      artifacts.screenshots.push(join(shots, 'desktop-keyboard.png'))
      evidence.keyboard = { focus, messageOverflow, scroll, before, after }
    })
  } finally {
    await browserBundle?.close()
    await workbench?.stop()
    artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
  }

  return { cases, artifacts }
}

const define = (id, title, extra = {}) => ({
  id,
  title,
  layer: LAYERS.CONTROLLED,
  limitations: [
    'Browser acceptance against the packaged fixture workbench; no vendor model or native agent.',
    'Layout checks assert geometry/overflow/reachability, not aesthetic quality.',
    ...(extra.limitations ?? []),
  ],
})
