import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createServer as createPortProbe } from 'node:net'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

const output = resolve(process.argv[2] ?? 'reports/releases/wave36-integration/history-browser')
mkdirSync(output, { recursive: true })
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test'), { createServer } = await import(require.resolve('vite'))
const root = mkdtempSync('/tmp/pa-history-browser-'), stateRoot = join(root, 'state'), projectRoot = join(root, 'project')
mkdirSync(stateRoot); mkdirSync(join(projectRoot, 'src'), { recursive: true }); writeFileSync(join(projectRoot, 'src/.keep'), '')
const git = args => execFileSync('git', args, { cwd: projectRoot, stdio: 'pipe' })
git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'initial'])
const store = new ProductStore({ path: join(stateRoot, 'db.sqlite') }), principal = { userId: 'history-browser', authorityRef: 'history-browser-authority' }
const scope = id => ({ projectId: id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] })
const product = createControlledProduct({ store, principal, stateRoot, scratchProject: projectRoot, actionSecret: Buffer.alloc(32, 13),
  projects: ['one', 'two'].map(id => ({ id, displayName: id, scope: scope(id) })) })
const probe = createPortProbe(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
const origin = `http://127.0.0.1:${port}`, app = createLocalHttpApp({ application: product.application, principal,
  bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64), mode: 'fixture', localDevelopmentAccess: true,
  allowedOrigins: [origin], read: product.read, operations: product.operations })
const api = listenLocalHttp(app, 0); await once(api, 'listening')
const vite = await createServer({ root: resolve('apps/console'), configFile: resolve('apps/console/vite.config.ts'),
  define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') }, server: { host: '127.0.0.1', port, strictPort: true,
    proxy: { '/v1': { target: `http://127.0.0.1:${api.address().port}`, changeOrigin: true } } } })
let browser, before, writes = 0, historyReads = 0, acceptedWorks = 0
const works = [], cases = [], errors = []
const check = async (id, action) => { await action(); cases.push({ id, status: 'PASS' }) }
const until = async read => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('Original controlled work did not become acceptable')
}
try {
  product.start()
  for (const id of ['one', 'two']) {
    const receipt = await product.application.dispatch({ kind: 'create_work', commandId: `create-${id}`, conversationId: 'conv-main', projectId: id,
      goal: `History ${id}`, profileId: 'profile-fixture-pass', scope: scope(id),
      criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'Fixed output', checkDefinitionRef: FIXTURE_CHECK }] }, { ...principal, source: 'local_cli' })
    assert.equal(receipt.status, 'recorded')
    const ready = await until(async () => {
      const value = (await product.application.inspect({ workId: receipt.workId })).works[0]
      return value.actions.available.includes('accept_candidate') && value.actions.currentCandidate ? value : undefined
    })
    const accepted = await product.application.dispatch({ kind: 'accept_candidate', commandId: `accept-${id}`, conversationId: 'conv-main', candidate: ready.actions.currentCandidate }, { ...principal, source: 'local_cli' })
    assert.equal(accepted.status, 'recorded'); acceptedWorks++
    works.push((await product.application.inspect({ workId: receipt.workId })).works[0])
  }
  const first = works[0], link = first.links.find(link => link.role === 'primary'), original = store.db.prepare('SELECT * FROM completion_verifications WHERE ticket_id=? LIMIT 1').get(link.ticketId)
  assert.ok(original)
  const insert = store.db.prepare(`INSERT INTO completion_verifications
    (id,ticket_id,assignment_id,candidate_generation,contract,artifact_digest,criteria_digest,environment_ref,verifier_identity_ref,results,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
  for (let index = 0; index < 14; index++) insert.run(`browser-history-${index}`, original.ticket_id, original.assignment_id, original.candidate_generation,
    original.contract, original.artifact_digest, original.criteria_digest, original.environment_ref, original.verifier_identity_ref, original.results, '2026-01-01T00:00:00.000Z')
  before = store.events.cursor(); await vite.listen(); browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/completion-history')) historyReads++
    if (request.url().includes('/v1/') && request.method() === 'POST') writes++
  })
  const history = page.getByRole('region', { name: '工作历史', exact: true })
  const choose = kind => history.getByRole('combobox', { name: '工作历史类别', exact: true }).selectOption(kind)
  await page.goto(`${origin}/?work=${first.work.id}`)
  await check('ORIGINAL-WORK-DETAIL-READS-REAL-COMPLETION-PAGES-ONLY-ON-DEMAND', async () => {
    await history.getByRole('button', { name: '展开工作历史', exact: true }).waitFor(); assert.equal(historyReads, 0)
    await history.getByRole('button', { name: '展开工作历史', exact: true }).click()
    await history.getByText('本类来源 15 条 · 已显示 10 条 · 部分记录', { exact: true }).waitFor()
    assert.equal(await history.locator('ol > li').count(), 10)
    await history.getByRole('button', { name: '加载较早记录', exact: true }).click()
    await history.getByText('本类来源 15 条 · 已显示 15 条', { exact: true }).waitFor()
    assert.equal(await history.locator('ol > li').count(), 15)
  })
  await check('ORIGINAL-CONTRACT-AND-ACCEPTANCE-CATEGORIES-PRESERVE-THEIR-OWN-IDENTITIES', async () => {
    await choose('contracts'); await history.getByText('合同版本 1', { exact: true }).waitFor()
    assert.equal(await history.locator('ol > li').count(), 1)
    const received = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/completion-history') && new URL(response.url()).searchParams.get('kind') === 'acceptances')
    await choose('acceptances')
    const response = await received, value = await response.json()
    assert.equal(response.status(), 200, JSON.stringify(value))
    const accepted = store.db.prepare('SELECT candidate_generation FROM completion_acceptances WHERE ticket_id=? LIMIT 1').get(original.ticket_id)
    assert.equal(value.entries[0]?.generation, accepted.candidate_generation)
    await history.getByText(`第 ${accepted.candidate_generation} 代接受记录`, { exact: true }).waitFor()
    assert.equal(await history.locator('ol > li').count(), 1)
  })
  await check('WRONG-WORK-RESPONSE-IS-REFUSED-WITHOUT-OLD-ROWS-OR-RAW-ERROR', async () => {
    await page.route('**/completion-history?**', async route => {
      const response = await route.fetch(), body = await response.json(); body.workId = 'foreign-private-canary'
      await route.fulfill({ response, json: body })
    })
    await choose('verifications'); await history.getByRole('alert').waitFor()
    assert.equal(await history.locator('ol > li').count(), 0); assert.doesNotMatch(await history.innerText(), /foreign-private-canary/)
    await page.unroute('**/completion-history?**')
  })
  await check('LATE-OTHER-CATEGORY-CANNOT-REPLACE-CURRENT-HISTORY', async () => {
    await choose('contracts'); await history.getByText('合同版本 1', { exact: true }).waitFor()
    let release, capturedResolve
    const captured = new Promise(resolve => { capturedResolve = resolve }), gate = new Promise(resolve => { release = resolve })
    await page.route('**/completion-history?**', async route => {
      if (new URL(route.request().url()).searchParams.get('kind') !== 'verifications') return route.continue()
      const response = await route.fetch(); capturedResolve(); await gate
      try { await route.fulfill({ response }) } catch { /* The old request is intentionally aborted. */ }
    })
    let timer
    try {
      await choose('verifications')
      await Promise.race([captured, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('History request not captured')), 10000) })])
      await choose('contracts'); await history.getByText('合同版本 1', { exact: true }).waitFor()
      release(); await page.waitForTimeout(150)
      assert.equal(await history.locator('ol > li').count(), 1); assert.doesNotMatch(await history.innerText(), /检查记录\s*记录标识/)
    } finally { clearTimeout(timer); release(); await page.unroute('**/completion-history?**') }
  })
  await check('OVERSIZED-FIRST-RECORD-IS-EXPLICITLY-BLOCKED-WITHOUT-FALSE-CONTINUATION', async () => {
    insert.run('browser-oversized', original.ticket_id, original.assignment_id, original.candidate_generation, original.contract,
      original.artifact_digest, original.criteria_digest, original.environment_ref, original.verifier_identity_ref, JSON.stringify('x'.repeat(4194304)), '2099-01-01T00:00:00.000Z')
    try {
      await choose('verifications'); await history.getByText('单条历史超过读取上限，较早记录暂不可达。', { exact: true }).waitFor()
      assert.equal(await history.getByRole('button', { name: '加载较早记录', exact: true }).count(), 0)
    } finally { store.db.prepare('DELETE FROM completion_verifications WHERE id=?').run('browser-oversized') }
  })
  await check('LEGACY-ABSENCE-KEEPS-THE-ORIGINAL-DELIVERY-VIEW', async () => {
    await page.route('**/completion-history?**', route => route.fulfill({ status: 404, json: { error: { code: 'invalid_request' } } }))
    await choose('contracts'); await history.getByText('此版本未提供分类历史', { exact: true }).waitFor()
    assert.equal(await page.getByRole('region', { name: '交付记录', exact: true }).count(), 1)
    await page.unroute('**/completion-history?**')
  })
  await check('SWITCHING-ORIGINAL-WORKS-DOES-NOT-REUSE-THE-PREVIOUS-WORK-PAGE', async () => {
    await page.goto(`${origin}/?work=${works[1].work.id}`)
    await history.getByRole('button', { name: '展开工作历史', exact: true }).click()
    await history.getByText('本类来源 1 条 · 已显示 1 条', { exact: true }).waitFor()
    assert.equal(await history.locator('ol > li').count(), 1); assert.doesNotMatch(await history.innerText(), /browser-history-/)
  })
  await check('DESKTOP-MOBILE-HISTORY-IS-READABLE-WITHOUT-BUSINESS-WRITES', async () => {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await history.scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await history.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    assert.equal(writes, 0); assert.equal(store.events.cursor(), before); assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); await vite.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  const eventDelta = before === undefined ? null : store.events.cursor() - before
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 8 ? 'PASS_ACTUAL_COMPLETION_HISTORY_APP' : 'FAIL', cases, errors, historyReads, businessPosts: writes,
    eventDelta, acceptedWorks, additionalMetadataFixtures: 14, realModelTurns: 0, nativeTurnStarts: 0,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/completion-history*'], { encoding: 'utf8' }).trim() === '',
    scope: 'Actual App/HTTP/A production keyset/original controlled Work/check/manualaccept; additional historical rows are explicit metadata fixtures, no installed/native/recovery/value admission' }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
}
