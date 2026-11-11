import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createServer as portProbe } from 'node:net'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const { values } = parseArgs({ options: { 'no-capture': { type: 'boolean', default: false } } })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const output = resolve('reports/releases/wave09-integration/evidence-browser')
mkdirSync(output, { recursive: true })
const root = mkdtempSync(join(tmpdir(), 'pa-evidence-browser-')), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(projectRoot); mkdirSync(join(projectRoot, 'src'))
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); writeFileSync(join(projectRoot, 'src/.gitkeep'), '')
git(['add', 'src/.gitkeep']); git(['-c', 'user.name=Evidence Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Evidence browser base'])
const principal = { userId: 'evidence-user', authorityRef: 'evidence-authority' }, actor = { ...principal, source: 'local_ui' }
const scope = { projectId: 'evidence-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [{ id: 'criterion-output', kind: 'machine', required: true, description: '产物检查', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'criterion-human', kind: 'human', required: true, description: '确认变更' }]
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
const options = { store, principal, projects: [{ id: scope.projectId, displayName: '支付服务', scope }], stateRoot,
  scratchProject: projectRoot, actionSecret: Buffer.alloc(32, 19) }
let product = createControlledProduct(options), seq = 0
const command = value => product.application.dispatch({ commandId: `evidence-command-${++seq}`, conversationId: 'evidence-conversation', ...value }, actor)
const view = async workId => (await product.application.inspect({ workId })).works[0]
async function until(read, predicate, timeout = 15000) {
  const deadline = Date.now() + timeout
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error(`Product condition timed out: ${JSON.stringify(latest)}`)
}
const create = (goal, mode = 'pass') => command({ kind: 'create_work', projectId: scope.projectId, goal,
  profileId: `profile-fixture-${mode}`, scope, criteria })
const revised = await create('支付接口幂等校验')
assert.equal(revised.status, 'recorded')
// Real application revisions exercise the source timeline without running superseded turns.
for (let revision = 2; revision <= 14; revision++) {
  const current = await view(revised.workId)
  const receipt = await command({ kind: 'revise_work', expected: { workId: revised.workId, revision: current.contract.revision,
    digest: current.contract.digest }, goal: `支付接口幂等校验 · 第 ${revision} 版`, scope, criteria })
  assert.equal(receipt.status, 'recorded', JSON.stringify(receipt))
}
const unobserved = await create('兼容性检查记录'), failed = await create('失败检查不能接受', 'fail')
assert.equal(unobserved.status, 'recorded'); assert.equal(failed.status, 'recorded')
product.start()
const ready = await until(() => view(revised.workId), value => value?.actions.available.includes('accept_candidate'))
const unknownReady = await until(() => view(unobserved.workId), value => value?.actions.available.includes('accept_candidate'))
await until(() => view(failed.workId), value => !!value?.actions.currentVerificationId)
assert.equal((await command({ kind: 'accept_candidate', candidate: unknownReady.actions.currentCandidate })).status, 'recorded')
const socket = portProbe(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening')
const port = socket.address().port; await new Promise(resolve => socket.close(resolve))
const origin = `http://127.0.0.1:${port}`
const http = () => createLocalHttpApp({ application: product.application, principal, bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64),
  allowedOrigins: [origin], mode: 'fixture', localDevelopmentAccess: true, read: product.read, operations: product.operations })
let api = listenLocalHttp(http(), 0)
await once(api, 'listening')
const vite = await createServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
  server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
const cases = [], errors = []
const check = async (id, action) => { try { await action(); cases.push({ id, status: 'PASS' }) } catch (error) { cases.push({ id, status: 'FAIL', message: error.message }); throw error } }
let browser
try {
  await vite.listen(); browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' }), page = await context.newPage()
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  const activitySamples = []
  let dialogResidence
  const assertActivityOutsideDialog = () => {
    assert.ok(dialogResidence)
    for (const sample of activitySamples) {
      assert.deepEqual(sample.candidate, ready.actions.currentCandidate)
      assert.equal(sample.source, 'ui_visibility_proxy')
      assert.ok(Date.parse(sample.endedAt) <= dialogResidence.openedAt || Date.parse(sample.startedAt) >= dialogResidence.closedAt,
        'Candidate review samples must not overlap the visible context dialog residence')
    }
  }
  page.on('request', request => {
    if (request.method() === 'POST' && request.url().endsWith(`/v1/works/${revised.workId}/review-activity`))
      activitySamples.push(request.postDataJSON())
  })
  const panel = page.getByRole('region', { name: '交付记录', exact: true })
  const detail = page.getByRole('region', { name: '工作详情', exact: true })
  const open = async workId => {
    await page.goto(`${origin}/?conversation=evidence-conversation&work=${encodeURIComponent(workId)}`)
    await detail.waitFor()
  }
  const reveal = async target => {
    await target.scrollIntoViewIfNeeded()
    await target.evaluate(element => {
      element.scrollIntoView({ block: 'start' })
      const scroller = element.closest('.detail')
      if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollTop - 80)
    })
  }
  const insideViewport = async target => {
    const box = await target.boundingBox(), viewport = page.viewportSize()
    assert.ok(box && box.y >= 120 && box.y + box.height <= viewport.height, 'Required screenshot content must be visible below the inspector heading')
  }
  await check('CONTEXT-DIALOG-RESIDENCE-IS-EXCLUDED-FROM-CANDIDATE-ACTIVITY', async () => {
    await open(revised.workId)
    await page.getByRole('button', { name: '接受当前候选', exact: true }).waitFor()
    await page.getByRole('button', { name: '上下文预览', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '上下文预览', exact: true })
    await dialog.waitFor()
    const openedAt = await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(Date.now())))))
    await page.waitForTimeout(5500)
    const closedAt = await page.evaluate(() => Date.now())
    await dialog.getByRole('button', { name: '关闭上下文预览', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.ok(closedAt - openedAt >= 5000)
    dialogResidence = { openedAt, closedAt }
    await until(() => activitySamples.filter(sample => store.commands.get(sample.commandId)), samples => samples.length > 0)
    assertActivityOutsideDialog()
    assert.notEqual((await view(revised.workId)).phase, 'delivered', 'Activity metadata cannot accept the candidate')
    assert.equal(store.workflows.routingEvidence.outcomes.list({ projectId: scope.projectId }).records.filter(value => value.attempt.contract.workId === revised.workId).length, 0)
  })
  await check('UI-ACCEPTANCE-RETAINS-EXACT-OUTCOME-AND-PARTIAL-TIMING', async () => {
    await open(revised.workId)
    await page.getByRole('button', { name: '接受当前候选', exact: true }).click()
    await panel.getByText('接受记录可核对', { exact: true }).waitFor()
    const evidence = await product.read.workEvidence(revised.workId), outcome = evidence.outcomes[0]
    assert.equal(evidence.projection, 'recorded'); assert.equal(outcome.acceptance, 'accepted')
    assert.deepEqual(outcome.candidate, ready.actions.currentCandidate)
    assert.ok(outcome.reviewTiming.readyToAcceptanceMs >= 0)
    assert.ok(outcome.reviewTiming.activeReviewMs > 0)
    assert.equal(outcome.reviewTiming.activeReviewSource, 'ui_visibility_proxy')
    assert.equal(outcome.reviewTiming.activeReviewCompleteness, 'partial')
    assertActivityOutsideDialog()
    await panel.getByText('部分', { exact: true }).waitFor()
    assert.equal(await panel.getByText('未记录', { exact: true }).count(), 0)
    assert.equal(store.workflows.routingEvidence.outcomes.list({ projectId: scope.projectId }).records.filter(value => value.attempt.contract.workId === revised.workId).length, 1)
  })
  await check('HISTORY-KEYSET-PAGINATION-AND-PROVENANCE', async () => {
    const initial = await panel.locator('.evidence-timeline > li').count()
    assert.equal(initial, 20)
    await panel.getByRole('button', { name: '加载较早记录', exact: true }).click()
    await until(() => panel.locator('.evidence-timeline > li').count(), value => value > initial)
    const first = panel.locator('.evidence-timeline > li').first()
    await first.getByText('记录来源', { exact: true }).click()
    assert.ok((await first.locator('code').textContent()).length > 0)
    const text = await panel.textContent()
    assert.match(text, /合同版本/)
    assert.equal(await panel.getByRole('alert').count(), 0)
  })
  await check('DESKTOP-AND-MOBILE-EVIDENCE-READABLE-WITHOUT-OVERFLOW', async () => {
    for (const [name, width, height] of [['desktop', 1440, 900], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await reveal(panel)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await panel.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!values['no-capture']) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true })
    }
  })
  await check('UNKNOWN-ACTIVITY-IS-NOT-ZERO-AND-SWITCHES-WORK-IDENTITY', async () => {
    await page.setViewportSize({ width: 1440, height: 900 }); await open(unobserved.workId)
    await panel.getByText('接受记录可核对', { exact: true }).waitFor()
    await panel.getByText('未记录', { exact: true }).waitFor()
    const outcome = (await product.read.workEvidence(unobserved.workId)).outcomes[0]
    assert.equal(outcome.reviewTiming.activeReviewMs, null)
    assert.equal(outcome.reviewTiming.activeReviewSource, 'unknown')
    assert.equal(outcome.reviewTiming.activeReviewCompleteness, 'unknown')
    assert.equal(await panel.getByText('不足 1 秒', { exact: true }).count() <= 1, true)
    assert.equal(await panel.getByText('合同版本 14', { exact: true }).count(), 0)
    await reveal(panel)
    await insideViewport(panel.locator('.evidence-timing'))
    await insideViewport(panel.getByText('未记录', { exact: true }))
    await insideViewport(panel.getByText('部分', { exact: true }))
    if (!values['no-capture']) await page.screenshot({ path: join(output, 'desktop-unknown.png'), fullPage: true })
  })
  await check('LATE-PREVIOUS-WORK-RESPONSE-CANNOT-REPLACE-CURRENT-HISTORY', async () => {
    let release, intercepted, completed
    const hold = new Promise(resolve => { release = resolve }), seen = new Promise(resolve => { intercepted = resolve })
    const finished = new Promise(resolve => { completed = resolve })
    await page.route(`**/v1/works/${unobserved.workId}/evidence/history?*`, async route => {
      const response = await route.fetch(); intercepted(); await hold; await route.fulfill({ response }); completed()
    })
    await panel.getByRole('button', { name: '刷新交付记录', exact: true }).click(); await seen
    await page.getByRole('button', { name: '工作与交付', exact: true }).click()
    await page.getByRole('button', { name: '支付接口幂等校验 支付服务 合同 14 4 项产物 已交付', exact: true }).click()
    await panel.getByText('接受记录可核对', { exact: true }).waitFor()
    release(); await finished; await page.unroute(`**/v1/works/${unobserved.workId}/evidence/history?*`)
    await panel.getByText('部分', { exact: true }).waitFor()
    assert.equal(await panel.getByText('未记录', { exact: true }).count(), 0)
    assert.match(await detail.locator('.goal').textContent(), /第 14 版/)
  })
  await check('MACHINE-FAIL-REMAINS-UNACCEPTABLE-WITH-READONLY-HISTORY', async () => {
    await open(failed.workId)
    await detail.getByText('未通过', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '接受当前候选', exact: true }).count(), 0)
    await panel.getByRole('button', { name: '展开交付记录', exact: true }).click()
    await panel.getByText('尚未接受当前交付', { exact: true }).waitFor()
    const value = await view(failed.workId)
    const receipt = await command({ kind: 'accept_candidate', candidate: value.actions.currentCandidate })
    assert.equal(receipt.status, 'rejected'); assert.equal(receipt.error.code, 'verification_failed')
    assert.notEqual((await view(failed.workId)).phase, 'delivered')
    await panel.getByRole('button', { name: '收起交付记录', exact: true }).click()
    await reveal(detail.locator('.verification'))
    await insideViewport(detail.getByText('未通过', { exact: true }))
    await insideViewport(detail.getByRole('heading', { name: '可用动作', exact: true }))
    await insideViewport(detail.locator('.actions').first())
    assert.equal(await detail.getByRole('button', { name: '接受当前候选', exact: true }).count(), 0)
    if (!values['no-capture']) await page.screenshot({ path: join(output, 'desktop-fail.png'), fullPage: true })
  })
  await check('REOPEN-PRESERVES-HISTORY-AND-NO-DUPLICATE-ACCEPTANCE', async () => {
    const before = await product.read.workEvidence(revised.workId)
    const oldPort = api.address().port
    api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); await product.close()
    product = createControlledProduct(options); product.start()
    api = listenLocalHttp(http(), oldPort); await once(api, 'listening')
    await open(revised.workId)
    await panel.getByText('接受记录可核对', { exact: true }).waitFor()
    const after = await product.read.workEvidence(revised.workId)
    assert.deepEqual(after.outcomes, before.outcomes)
    assert.equal(after.outcomes.length, 1)
    assert.equal((await product.read.workEvidenceHistory(revised.workId, { limit: 20 })).hasMore, true)
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 8 && cases.every(value => value.status === 'PASS') ? 'PASS_EVIDENCE_HTTP_BROWSER' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/evidence-workbench-browser.mjs'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(), cases, errors, modelCalls: 0,
    limitations: ['Actual loopback HTTP/SQLite and controlled subprocess fixture; no real model/native turn',
      'Keyset history is per-read observed data, not a frozen snapshot across requests', 'UI visibility intervals are partial observational metadata'] }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
