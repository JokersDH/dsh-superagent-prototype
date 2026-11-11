import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runCase, LAYERS } from '../lib/status.mjs'
import { LocalProductClient } from '../lib/http-client.mjs'
import { countRows } from '../lib/product-db.mjs'
import { cleanup, pickPort, startWorkbench, tempState } from '../lib/instance.mjs'
import { VIEWPORTS, gotoConsole, layoutFacts, openBrowser, screenshot } from '../lib/browser.mjs'

/**
 * Wave-09 independent browser acceptance of the current proposal workspace. The same product and
 * real SQLite back the page; assertions read the product store only to prove a preview had no effect
 * and a confirmation had exactly one. Main's own browser suite is reference, not a substitute.
 */
export async function runProposalUi({ root, runDirectory, keep = false }) {
  const cases = []
  const artifacts = { screenshots: [] }
  const { root: tempRoot, state } = tempState('pa-w9-prop-ui-')
  const port = await pickPort()
  const consolePort = await pickPort()
  let workbench
  let browser
  let page
  try {
    workbench = await startWorkbench({
      root,
      port,
      apiPort: consolePort,
      stateRoot: state,
      env: { PA_MODEL_CONFIG: join(state, 'no-model-configured.json') },
    })
    const client = new LocalProductClient({ baseURL: workbench.apiURL, stateDir: state, timeoutMs: 20_000 })
    const configuration = await client.configuration()
    const project = configuration.projects.find((item) => item.dispatchAllowed)
    await client.dispatch({ commandId: 'ui-chat-1', conversationId: 'conv-ui-proposal', kind: 'chat', projectId: project.id, text: '支付接口新增幂等校验，确认后创建受控工作。' })
    await client.dispatch({ commandId: 'ui-chat-2', conversationId: 'conv-ui-proposal', kind: 'chat', projectId: project.id, text: '第二条来源：正常确认路径。' })
    await client.dispatch({ commandId: 'ui-chat-3', conversationId: 'conv-ui-proposal', kind: 'chat', projectId: project.id, text: '第三条来源：拒绝路径从这里发起。' })
    const opened = await openBrowser({ root })
    browser = opened.browser
    page = await browser.newPage()
    const shots = []
    const works = async () => (await client.snapshot({ conversationId: 'conv-ui-proposal' })).works.length
    const receipts = () => countRows(state, root, 'command_receipts')

    cases.push(
      await runCase(
        {
          id: 'E3-PROPOSAL-UI',
          title: 'The current web entry previews, confirms and rejects proposals without side effects',
          layer: LAYERS.CONTROLLED,
          evidence: {},
          limitations: [
            'Real console built from apps/console against the same fixture product; no model call.',
            'The page is exercised at 1440×900 and 390×844; visual taste is not judged.',
          ],
        },
        async ({ assert, evidence }) => {
          await page.setViewportSize(VIEWPORTS.desktop)
          await gotoConsole(page, `http://127.0.0.1:${port}/?conversation=conv-ui-proposal`)
          const beforeWorks = await works()
          const beforeReceipts = receipts()
          await page.getByRole('button', { name: '转为提案', exact: true }).first().click()
          const dialog = page.getByRole('dialog', { name: '提案', exact: true })
          await dialog.waitFor({ timeout: 20_000 })
          await dialog.getByRole('textbox', { name: '提案内容', exact: true }).fill('为支付接口增加幂等校验，并补齐重复请求测试。')
          await dialog.getByRole('button', { name: '预览提案', exact: true }).click()
          await dialog.getByRole('heading', { name: '确认提案', exact: true }).waitFor({ timeout: 20_000 })
          assert('PREVIEW_NO_WORK', (await works()) === beforeWorks, `${beforeWorks} -> ${await works()}`)
          assert('PREVIEW_NO_RECEIPT', receipts() === beforeReceipts, `${beforeReceipts} -> ${receipts()}`)
          const details = await dialog.locator('.proposal-preview').textContent()
          assert('PREVIEW_SOURCE', String(details).includes('conv-ui-proposal'), String(details).slice(0, 180))
          assert('PREVIEW_CRITERIA', String(details).includes('验收标准'), String(details).slice(0, 180))

          shots.push(await screenshot(page, runDirectory, 'proposal-preview-desktop'))
          for (const [name, viewport] of [['notebook', VIEWPORTS.notebook], ['mobile', VIEWPORTS.mobile]]) {
            await page.setViewportSize(viewport)
            await page.evaluate(() => document.fonts.ready)
            const facts = await layoutFacts(page)
            assert(`NO_OVERFLOW_${name.toUpperCase()}`, facts.horizontalOverflow === false, JSON.stringify(facts.overflowing))
            shots.push(await screenshot(page, runDirectory, `proposal-preview-${name}`))
          }
          await page.setViewportSize(VIEWPORTS.desktop)

          // Lose the response after the request may have committed. The UI must keep the same
          // command identity across a reload and settle it once, not mint a second work.
          await page.route('**/v1/proposals/commands', (route) => route.abort('failed'))
          await dialog.getByRole('button', { name: '确认创建', exact: true }).click()
          await dialog.getByText('原请求待核对', { exact: true }).waitFor({ timeout: 20_000 })
          await page.unroute('**/v1/proposals/commands')
          await page.reload()
          await page.getByRole('button', { name: '创建提案', exact: true }).click()
          const restored = page.getByRole('dialog', { name: '提案', exact: true })
          await restored.waitFor({ timeout: 20_000 })
          await restored.getByRole('heading', { name: '核对提案请求', exact: true }).waitFor({ timeout: 20_000 })
          await restored.getByRole('button', { name: '核对原请求', exact: true }).click()
          await restored.getByRole('heading', { name: '工作已创建', level: 2, exact: true }).waitFor({ timeout: 20_000 })
          const afterWorks = await works()
          assert('CONFIRM_ONE_WORK', afterWorks === beforeWorks + 1, `${beforeWorks} -> ${afterWorks}`)
          await restored.getByRole('button', { name: '关闭提案', exact: true }).click()
          const rowCount = await page.locator('.work-card').count()
          assert('WORK_VISIBLE', rowCount >= 1, String(rowCount))

          // Normal confirm from the second source adds exactly one more work.
          await page.getByRole('button', { name: '转为提案', exact: true }).nth(1).click()
          const second = page.getByRole('dialog', { name: '提案', exact: true })
          await second.waitFor({ timeout: 20_000 })
          await second.getByRole('textbox', { name: '提案内容', exact: true }).fill('第二个受控工作提案。')
          await second.getByRole('button', { name: '预览提案', exact: true }).click()
          await second.getByRole('button', { name: '确认创建', exact: true }).click()
          await second.getByRole('heading', { name: '工作已创建', level: 2, exact: true }).waitFor({ timeout: 20_000 })
          const afterSecond = await works()
          assert('SECOND_ONE_WORK', afterSecond === afterWorks + 1, `${afterWorks} -> ${afterSecond}`)
          await second.getByRole('button', { name: '关闭提案', exact: true }).click()

          // Reject path: preview, then refuse explicitly; no third work is created.
          await page.getByRole('button', { name: '转为提案', exact: true }).last().click()
          const rejectDialog = page.getByRole('dialog', { name: '提案', exact: true })
          await rejectDialog.waitFor({ timeout: 20_000 })
          await rejectDialog.getByRole('textbox', { name: '提案内容', exact: true }).fill('这条提案将被明确拒绝。')
          await rejectDialog.getByRole('button', { name: '预览提案', exact: true }).click()
          await rejectDialog.getByRole('button', { name: '拒绝提案', exact: true }).click()
          await rejectDialog.getByRole('heading', { name: '提案已拒绝', level: 2, exact: true }).waitFor({ timeout: 20_000 })
          assert('REJECT_NO_NEW_WORK', (await works()) === afterSecond, `${afterSecond} -> ${await works()}`)
          evidence.proposalUi = {
            preview: { works: beforeWorks, receipts: beforeReceipts },
            confirm: { works: afterWorks, visibleRows: rowCount },
            secondConfirm: { works: afterSecond },
            reject: { works: await works() },
            viewports: ['desktop', 'notebook', 'mobile'],
            pendingSurvivedReload: true,
            lostResponseSettledOnce: true,
          }
        },
      ),
    )
    artifacts.screenshots.push(...shots)
  } finally {
    await browser?.close()
    await workbench?.stop()
    artifacts.cleaned = cleanup({ root: tempRoot, state }, { keep })
  }
  return { cases, artifacts }
}
