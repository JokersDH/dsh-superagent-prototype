import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { startMockModel } from '../lib/mock-model.mjs'
import { cleanup, pickPort, startWorkbench, tempState } from '../lib/instance.mjs'
import { VIEWPORTS, openBrowser, screenshot } from '../lib/browser.mjs'

const define = (id, title) => ({ id, title, layer: LAYERS.CONTROLLED, limitations: [
  'Packaged workbench with real coordinator/SQLite and a loopback OpenAI-compatible mock provider; no vendor call.',
  'Lost-response and pending reconciliation are browser-visible behaviour; the mock provider count is local.',
] })

/**
 * E2/E3 UI slice: the real workbench selects sources, previews, confirms, survives a lost response
 * and reconciles the original token once; a second selection works at mobile width.
 */
export async function runContextUi({ root, runDirectory }) {
  const cases = []
  const shots = join(runDirectory, 'screenshots')
  const artifacts = { screenshots: [] }
  const { root: tempRoot, state } = tempState('pa-w11-context-ui-')
  const port = await pickPort(), apiPort = await pickPort()
  const mock = await startMockModel({ stateRoot: state, reply: 'UI 上下文回复已收到。' })
  let workbench, browser
  try {
    workbench = await startWorkbench({ root, port, apiPort, stateRoot: state, env: { PA_MODEL_CONFIG: mock.configPath } })
    const client = new LocalProductClient({ baseURL: workbench.apiURL, stateDir: state, timeoutMs: 20_000 })
    const configuration = await client.configuration()
    const project = configuration.projects.find(item => item.dispatchAllowed)
    await client.dispatch({ commandId: 'w11-ui-seed', conversationId: 'conv-ui', kind: 'chat', projectId: project.id, text: 'W11 UI 种子消息。' })
    await new Promise(resolve => setTimeout(resolve, 1200))

    browser = await openBrowser({ root, viewport: VIEWPORTS.desktop })
    const page = browser.page
    const consoleURL = `http://127.0.0.1:${port}/?conversation=conv-ui`
    await page.goto(consoleURL, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.locator('#composer-input').waitFor({ timeout: 25_000 })

    const waitCalls = async (count, timeoutMs = 15_000) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline && mock.requests.length < count)
        await new Promise(resolve => setTimeout(resolve, 120))
      return mock.requests.length
    }
    cases.push(await runCase({ ...define('E3-CONTEXT-UI', 'Workbench selects sources, survives a lost send response, reconciles once and works on mobile'), evidence: {} },
      async ({ assert, evidence }) => {
        const openContext = async () => {
          const button = page.getByRole('button', { name: '上下文预览' })
          await button.click()
          await page.getByRole('dialog', { name: '上下文预览' }).waitFor({ timeout: 10_000 })
        }
        const fillAndPrepare = async (text) => {
          await page.getByLabel('上下文消息').fill(text)
          await page.getByRole('button', { name: '预览消息' }).click()
          await page.getByRole('heading', { name: '确认上下文消息' }).waitFor({ timeout: 15_000 })
        }
        const messages = async () => (await client.snapshot({ conversationId: 'conv-ui' })).conversation?.messages ?? []
        const contextMessages = async () => (await messages()).filter(item => ['W11-DESKTOP-CONTEXT', 'W11-MOBILE-CONTEXT'].includes(item.text))

        const callsBefore = mock.requests.length
        await openContext()
        await fillAndPrepare('W11-DESKTOP-CONTEXT')
        await screenshot(page, shots, 'context-confirm-desktop')
        artifacts.screenshots.push(join(shots, 'context-confirm-desktop.png'))
        await page.route('**/v1/assistant/context/send', route => route.abort())
        await page.getByRole('button', { name: '确认发送' }).click()
        await page.getByText('发送结果尚未确认，请核对原请求。').waitFor({ timeout: 10_000 })
        assert('LOST_RESPONSE_PENDING', await page.getByText('原请求待核对').isVisible(), 'pending banner missing')
        await page.unroute('**/v1/assistant/context/send')
        await page.reload({ waitUntil: 'domcontentloaded' })
        await page.locator('#composer-input').waitFor({ timeout: 20_000 })
        await openContext()
        assert('PENDING_RESTORED', await page.getByRole('heading', { name: '核对消息请求' }).isVisible(), 'pending not restored after reload')
        await page.getByRole('button', { name: '核对原请求' }).click()
        await page.getByRole('dialog', { name: '上下文预览' }).waitFor({ state: 'hidden', timeout: 20_000 })
        const afterDesktop = await contextMessages()
        assert('DESKTOP_ONE_MESSAGE', afterDesktop.length === 1, JSON.stringify(afterDesktop.map(item => item.text)))
        const audit = await client.request(`/v1/messages/${afterDesktop[0].id}/context`)
        assert('DESKTOP_AUDIT', audit.status === 200 && !!audit.body?.commandId, JSON.stringify(audit.body)?.slice(0, 200))
        await waitCalls(callsBefore + 1)
        assert('DESKTOP_SINGLE_PROVIDER_SEND', mock.requests.length === callsBefore + 1, `before ${callsBefore} after ${mock.requests.length}`)

        await page.setViewportSize(VIEWPORTS.mobile)
        await page.waitForTimeout(250)
        await openContext()
        await fillAndPrepare('W11-MOBILE-CONTEXT')
        await screenshot(page, shots, 'context-confirm-mobile')
        artifacts.screenshots.push(join(shots, 'context-confirm-mobile.png'))
        await page.getByRole('button', { name: '确认发送' }).click()
        await page.getByRole('dialog', { name: '上下文预览' }).waitFor({ state: 'hidden', timeout: 20_000 })
        const afterMobile = await contextMessages()
        assert('MOBILE_ONE_MESSAGE', afterMobile.length === 2, JSON.stringify(afterMobile.map(item => item.text)))
        await waitCalls(callsBefore + 2)
        assert('MOBILE_PROVIDER_SEND', mock.requests.length === callsBefore + 2, `before ${callsBefore} after ${mock.requests.length}`)
        assert('MOBILE_AUDIT', (await client.request(`/v1/messages/${afterMobile[1].id}/context`)).status === 200, 'mobile audit missing')
        assert('NO_HORIZONTAL_OVERFLOW', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'mobile overflow')

        // Two tabs: a later selection in tab 2 must not replace tab 1's already-open selection.
        const tab2 = await browser.context.newPage()
        await tab2.goto(consoleURL, { waitUntil: 'domcontentloaded', timeout: 25_000 })
        await tab2.locator('#composer-input').waitFor({ timeout: 20_000 })
        await tab2.getByRole('button', { name: '上下文预览' }).click()
        await tab2.getByRole('dialog', { name: '上下文预览' }).waitFor({ timeout: 10_000 })
        await tab2.getByLabel('上下文消息').fill('W11-TAB-TWO')
        await tab2.getByRole('button', { name: '预览消息' }).click()
        await tab2.getByRole('heading', { name: '确认上下文消息' }).waitFor({ timeout: 15_000 })
        await tab2.getByRole('button', { name: '确认发送' }).click()
        await tab2.getByRole('dialog', { name: '上下文预览' }).waitFor({ state: 'hidden', timeout: 20_000 })
        await page.getByRole('button', { name: '上下文预览' }).click()
        await page.getByRole('dialog', { name: '上下文预览' }).waitFor({ timeout: 10_000 })
        await page.getByLabel('上下文消息').fill('W11-TAB-ONE')
        await page.getByRole('button', { name: '预览消息' }).click()
        await page.getByRole('heading', { name: '确认上下文消息' }).waitFor({ timeout: 15_000 })
        await page.getByRole('button', { name: '确认发送' }).click()
        await page.getByRole('dialog', { name: '上下文预览' }).waitFor({ state: 'hidden', timeout: 20_000 })
        const tabMessages = await waitCalls(callsBefore + 4).then(async () => (await messages()).filter(item => ['W11-TAB-ONE', 'W11-TAB-TWO'].includes(item.text)))
        assert('TABS_BOTH_MESSAGES', tabMessages.length === 2 && tabMessages[0].text !== tabMessages[1].text, JSON.stringify(tabMessages.map(item => item.text)))
        assert('TABS_PROVIDER_CALLS', mock.requests.length === callsBefore + 4, `before ${callsBefore} after ${mock.requests.length}`)
        await tab2.close()
        evidence.contextUi = { desktopMessages: afterDesktop.length, mobileMessages: afterMobile.length, tabMessages: tabMessages.length,
          pendingReconciled: true, providerRequests: mock.requests.length,
          auditCommandIds: [audit.body.commandId] }
      }))
  } finally {
    await browser?.close().catch(() => {})
    await workbench?.stop().catch(() => {})
    await mock.close().catch(() => {})
    cleanup({ root: tempRoot, state })
  }
  return { cases, artifacts }
}
