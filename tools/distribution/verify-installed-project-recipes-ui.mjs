#!/usr/bin/env node
// Installed-package J UI workflow: same actual App/React form against the frozen package's static
// console, with API/runtime loaded from that package. This does not build, start a daemon or send a
// real model/native turn.
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer as createStaticServer } from 'node:http'
import { createServer as portProbe } from 'node:net'
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'
const APP = process.argv[2], output = resolve(process.argv[3] ?? '/tmp/w29-installed-j-ui')
mkdirSync(output, { recursive: true })
const { ProductStore } = await import(`${APP}/packages/storage/dist/index.js`)
const { createProductRuntime } = await import(`${APP}/apps/coordinator/product/runtime.ts`)
const { ensureStarterProject, NativeProjectRegistry } = await import(`${APP}/apps/coordinator/product/project-registry.ts`)
const { createLocalHttpApp } = await import(`${APP}/apps/coordinator/http/app.ts`)
const { listenLocalHttp } = await import(`${APP}/apps/coordinator/http/server.ts`)
import { createRequire } from 'node:module'
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const root = mkdtempSync('/tmp/pa-installed-recipe-ui-'), stateRoot = join(root, 'state'); mkdirSync(stateRoot, { mode: 0o700 })
const registry = new NativeProjectRegistry(stateRoot)
const records = ['alpha', 'beta'].map(name => {
  const path = join(root, name); ensureStarterProject(path)
  const record = registry.prepare({ path, displayName: name === 'alpha' ? '项目 Alpha' : '项目 Beta', check: 'node_test' }); registry.save(record); return record
})
const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') }), principal = { userId: 'installed-recipe', authorityRef: 'installed-recipe-authority' }
const product = createProductRuntime({ store, stateRoot, scratchProject: records[0].path, projectRegistry: registry, principal,
  projects: records.map(record => ({ id: record.id, displayName: record.displayName, scope: { projectId: record.id, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] } })),
  actionSecret: Buffer.alloc(32, 31) })
const probe = portProbe(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening')
const port = probe.address().port; await new Promise(resolve => probe.close(resolve))
const origin = `http://127.0.0.1:${port}`, app = createLocalHttpApp({ application: product.application, principal,
  bootstrapToken: 'b'.repeat(64), apiToken: 'a'.repeat(64), mode: 'fixture', localDevelopmentAccess: true,
  allowedOrigins: [origin], read: product.read, operations: product.operations })
const api = listenLocalHttp(app, 0); await once(api, 'listening')
const consoleDist = join(APP, 'apps/console/dist')
const staticServer = createStaticServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk)
  const requestUrl = new URL(req.url, origin)
  if (requestUrl.pathname.startsWith('/v1')) {
    const upstream = await fetch(`http://127.0.0.1:${api.address().port}${requestUrl.pathname}${requestUrl.search}`, {
      method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks) }).catch(() => null)
    if (!upstream) { res.writeHead(502); res.end(); return }
    const headers = { 'content-type': upstream.headers.get('content-type') ?? 'application/json' }
    for (const name of ['cache-control', 'connection', 'content-encoding', 'transfer-encoding']) { const value = upstream.headers.get(name); if (value) headers[name] = value }
    res.writeHead(upstream.status, headers)
    if (upstream.body) { const stream = Readable.fromWeb(upstream.body); stream.on('error', () => {}); res.on('close', () => stream.destroy()); stream.pipe(res) } else res.end()
    return
  }
  let file = join(consoleDist, requestUrl.pathname === '/' ? 'index.html' : requestUrl.pathname)
  if (!existsSync(file) || !statSync(file).isFile()) file = join(consoleDist, 'index.html')
  res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream' })
  createReadStream(file).pipe(res)
})
const cases = [], errors = [], commands = [], acceptedWorks = []
let browser, previewPosts = 0, unknownAfterRecorded = false
const check = async (id, action) => { await action(); cases.push({ id, status: 'PASS' }) }
const until = async (read, predicate) => {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error('Original product workflow timed out')
}
try {
  product.start(); await new Promise((resolveListen, rejectListen) => { staticServer.once('error', rejectListen); staticServer.listen(port, '127.0.0.1', resolveListen) }); browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    const path = new URL(request.url()).pathname
    if (path.endsWith('/recipes/preview')) previewPosts++
    if (path === '/v1/commands') commands.push(request.postDataJSON())
  })
  await page.goto(origin)
  const form = page.getByRole('form', { name: '新建委托', exact: true })
  const open = async (index = 0) => {
    await page.getByRole('button', { name: '新建委托', exact: true }).click(); await form.waitFor()
    await form.getByRole('combobox', { name: '项目', exact: true }).selectOption(records[index].id)
    await form.getByRole('combobox', { name: '开发执行器', exact: true }).selectOption('profile-fixture-pass')
    await form.getByRole('combobox', { name: '任务模板', exact: true }).selectOption('scoped_change')
  }
  const preview = async () => {
    await form.getByRole('button', { name: '预览草稿', exact: true }).click()
    await form.getByRole('button', { name: '应用草稿', exact: true }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.new-work button')].some(button => button.textContent.includes('应用草稿') && !button.disabled))
  }
  const apply = async () => { await preview(); await form.getByRole('button', { name: '应用草稿', exact: true }).click(); await form.getByText('草稿已应用', { exact: true }).waitFor() }
  await check('PREVIEW-AND-APPLY-ONLY-PREFILL-ORIGINAL-FORM', async () => {
    const before = store.events.cursor(); await open(); await apply()
    assert.equal(commands.length, 0); assert.equal(store.events.cursor(), before)
    assert.match(await form.getByRole('textbox', { name: '目标', exact: true }).inputValue(), /Alpha/)
    assert.match(await form.locator('.config-summary').textContent(), /src\//)
    assert.equal(await form.getByRole('button', { name: '创建委托', exact: true }).isEnabled(), true)
  })
  await check('CHANGED-FACTS-REFUSE-EXPLICIT-CREATION-UNTIL-REAPPLIED', async () => {
    const before = store.events.cursor()
    await page.route('**/recipes/preview', async route => {
      const response = await route.fetch(), body = await response.json(); body.factsDigest = 'f'.repeat(64)
      await route.fulfill({ response, json: body })
    })
    await form.getByRole('button', { name: '创建委托', exact: true }).click()
    await form.getByRole('alert').filter({ hasText: '项目事实或配置已变化' }).waitFor()
    assert.equal(commands.length, 0); assert.equal(store.events.cursor(), before)
    assert.equal(await form.getByRole('button', { name: '创建委托', exact: true }).isDisabled(), true)
    await page.unroute('**/recipes/preview'); await apply()
  })
  await check('SELECTION-AND-CONFIG-CHANGES-CANNOT-KEEP-HIDDEN-OLD-ATOMS', async () => {
    await form.getByRole('checkbox', { name: 'src/', exact: true }).uncheck()
    await form.getByRole('checkbox', { name: 'src/', exact: true }).check(); await apply()
    await page.route('**/v1/configuration', async route => {
      const response = await route.fetch(), body = await response.json()
      body.revision = 'e'.repeat(64); body.projects[0].scope.allowedPaths = ['app/']
      await route.fulfill({ response, json: body })
    })
    await form.getByRole('button', { name: '刷新配置', exact: true }).click()
    await form.getByRole('checkbox', { name: 'app/', exact: true }).waitFor()
    await form.getByRole('checkbox', { name: 'app/', exact: true }).check()
    const request = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/recipes/preview'))
    await form.getByRole('button', { name: '预览草稿', exact: true }).click()
    assert.deepEqual((await request).postDataJSON().allowedPaths, ['app/'])
    await page.unroute('**/v1/configuration')
    await form.getByRole('button', { name: '取消', exact: true }).click(); await form.waitFor({ state: 'hidden' })
    await page.reload(); await page.getByRole('button', { name: '新建委托', exact: true }).waitFor()
  })
  await check('ERROR-AND-LEGACY-ABSENCE-KEEP-MANUAL-DELEGATION-AVAILABLE', async () => {
    await open()
    await page.route('**/recipes/preview', route => route.fulfill({ status: 503, json: { error: { code: 'storage_unavailable', message: '/private/key-secret' } } }))
    await form.getByRole('button', { name: '预览草稿', exact: true }).click()
    await form.getByRole('alert').filter({ hasText: '项目模板暂时无法读取' }).waitFor(); assert.doesNotMatch(await form.textContent(), /key-secret/)
    await page.unroute('**/recipes/preview')
    await page.route('**/recipes/preview', route => route.fulfill({ status: 404, json: { error: { code: 'invalid_request' } } }))
    await form.getByRole('button', { name: '预览草稿', exact: true }).click()
    await form.getByRole('alert').filter({ hasText: '当前服务未提供项目模板' }).waitFor()
    await form.getByRole('combobox', { name: '任务模板', exact: true }).selectOption('')
    await form.getByRole('textbox', { name: '目标', exact: true }).fill('手动草稿保留')
    assert.equal(await form.getByRole('button', { name: '创建委托', exact: true }).isEnabled(), true)
    await form.getByRole('button', { name: '取消', exact: true }).click(); await page.unroute('**/recipes/preview')
    assert.equal(commands.length, 0)
  })
  await check('TWO-EXPLICIT-TEMPLATE-WORKS-REACH-ORIGINAL-CANDIDATE-AND-MANUAL-ACCEPT', async () => {
    for (const index of [0, 1]) {
      await open(index); await apply()
      const goal = `编辑后的有限目标 ${index}`
      await form.getByRole('textbox', { name: '目标', exact: true }).fill(goal)
      if (index === 0) {
        await page.route('**/v1/commands', async route => { await route.fetch(); await route.abort() })
        await form.getByRole('button', { name: '创建委托', exact: true }).click()
        await page.waitForFunction(() => [...document.querySelectorAll('.new-work button')].some(button => button.textContent === '创建委托' && !button.disabled))
        assert.equal(store.product.works.listByProject(records[index].id, { limit: 10 }).length, 1)
        unknownAfterRecorded = true
        await page.unroute('**/v1/commands')
      }
      await form.getByRole('button', { name: '创建委托', exact: true }).click(); await form.waitFor({ state: 'hidden' })
      const command = commands.filter(value => value.kind === 'create_work').at(-1)
      assert.equal(command.goal, goal); assert.equal(command.projectId, records[index].id); assert.deepEqual(command.scope.allowedPaths, ['src/'])
      assert.ok(command.criteria.some(criterion => criterion.kind === 'human' && criterion.required))
      assert.equal(store.product.works.listByProject(records[index].id, { limit: 10 }).length, 1)
      const ready = await until(async () => (await product.application.inspect({ conversationId: command.conversationId })).works.find(work => work.work.projectId === records[index].id),
        work => work?.actions.available.includes('accept_candidate'))
      await page.getByRole('button', { name: '接受当前候选', exact: true }).click()
      await until(async () => (await product.application.inspect({ workId: ready.work.id })).works[0], work => work.phase === 'delivered')
      acceptedWorks.push(ready.work.id)
    }
    const creates = commands.filter(value => value.kind === 'create_work')
    assert.equal(creates.length, 3); assert.equal(creates[0].commandId, creates[1].commandId)
    assert.equal(new Set(creates.map(value => value.commandId)).size, 2)
    assert.equal(commands.filter(value => value.kind === 'accept_candidate').length, 2)
  })
  await check('DESKTOP-MOBILE-TEMPLATE-CONTROLS-AND-TEXT-FIT', async () => {
    await open(); await apply()
    for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height }); await page.evaluate(() => document.fonts.ready)
      await form.getByRole('combobox', { name: '任务模板', exact: true }).scrollIntoViewIfNeeded()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
      assert.equal(await form.evaluate(element => element.scrollWidth > element.clientWidth + 1), false)
      if (!process.argv.includes('--no-capture')) await page.screenshot({ path: join(output, `${name}.png`), fullPage: true, animations: 'disabled' })
    }
    assert.deepEqual(errors, [])
  })
} finally {
  await browser?.close(); staticServer.close(); api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
  await product.close(); store.close(); rmSync(root, { recursive: true, force: true })
  const report = { status: cases.length === 6 ? 'PASS_ACTUAL_PROJECT_RECIPE_WORKFLOW' : 'FAIL',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tests/integration/project-recipes*'], { encoding: 'utf8' }).trim() === '',
    cases, errors, previewPosts, unknownAfterRecorded, commands: commands.map(value => ({ kind: value.kind, commandId: value.commandId })), acceptedWorks: acceptedWorks.length,
    realModelTurns: 0, nativeTurnStarts: 0,
    scope: 'Installed package static console + installed runtime/J observer/registered project/HTTP/Product/Broker/check/accept controlled workflow; no daemon/native/recovered admission' }
  writeFileSync(join(output, 'browser-report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(report, null, 2))
}
