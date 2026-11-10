import assert from 'node:assert/strict'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer, request } from 'node:http'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { NativeProjectRegistry, ensureStarterProject } from '../../apps/coordinator/product/project-registry.ts'
import { admittedNativeProfile } from '../../apps/coordinator/product/native-startup.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'

if (!process.argv.includes('--execute'))
  throw new Error('Pass --execute for one authorized native task in a private temporary project')
const { chromium } = createRequire(new URL('../../apps/console/package.json', import.meta.url))('@playwright/test')
const environmentLane = process.argv.includes('--environment')
const screenshots = !process.argv.includes('--no-screenshots')
const consoleURL = process.env.NATIVE_CONSOLE_URL ?? 'http://127.0.0.1:5180'
const output = resolve(environmentLane ? 'reports/releases/environment-mvp/browser' : 'reports/releases/native-mvp/browser')
const screenshot = (name) => screenshots ? page.screenshot({ path: join(output, name), fullPage: true }) : Promise.resolve()
const previous = process.env.NATIVE_RESUME_ROOT
  ? JSON.parse(readFileSync(join(output, 'report.json'), 'utf8'))
  : undefined
if (previous && previous.root !== process.env.NATIVE_RESUME_ROOT)
  throw new Error('Resume root must match the recorded native fixture')
const root = previous?.root ?? mkdtempSync('/tmp/pa-native-browser-'),
  state = join(root, 'state'),
  project = join(root, 'project')
if (!previous) {
  mkdirSync(state, { mode: 0o700 })
  ensureStarterProject(project)
}
let environmentStore = previous?.environmentStore
if (environmentLane && !previous) {
  const { makePnpmFixture } = await import('../../packages/environment-preparation/test/helpers.ts')
  const recipe = makePnpmFixture()
  environmentStore = recipe.store
  for (const file of ['package.json', 'pnpm-lock.yaml', 'smoke.test.cjs']) cpSync(join(recipe.template, file), join(project, file))
  cpSync(join(recipe.template, 'vendor'), join(project, 'vendor'), { recursive: true })
}
const git = (args) => execFileSync('git', args, { cwd: project, encoding: 'utf8', stdio: 'pipe' }).trim()
const acceptance =
  "import test from 'node:test';import assert from 'node:assert/strict';import {slugify} from '../src/slugify.mjs';test('slugify',()=>{assert.equal(slugify(' Hello, World! '),'hello-world');assert.equal(slugify('A   B'),'a-b');assert.equal(slugify('---'),'')});\n"
if (!previous) {
  writeFileSync(join(project, 'test/acceptance.test.mjs'), acceptance)
  git(['add', 'test/acceptance.test.mjs', ...(environmentLane ? ['package.json', 'pnpm-lock.yaml', 'smoke.test.cjs', 'vendor'] : [])])
  git([
    '-c',
    'user.name=Native Browser Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-qm',
    'Independent native acceptance',
  ])
}
const base = git(['rev-parse', 'HEAD']),
  principal = { userId: 'native-browser-user', authorityRef: 'native-browser-authority' }
const profile = admittedNativeProfile()
const cases = previous?.cases.filter((item) => item.status === 'PASS') ?? [],
  errors = []
mkdirSync(output, { recursive: true })
let store, product, server, api
const proxy = createServer((incoming, outgoing) => {
  const target = new URL(incoming.url, incoming.url.startsWith('/v1/') ? api : consoleURL)
  const upstream = request(
    target,
    { method: incoming.method, headers: { ...incoming.headers, host: target.host } },
    (response) => {
      outgoing.writeHead(response.statusCode, response.headers)
      response.pipe(outgoing)
    },
  )
  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502)
    outgoing.end()
  })
  incoming.pipe(upstream)
})
proxy.listen(0, '127.0.0.1')
await once(proxy, 'listening')
const browserURL = `http://127.0.0.1:${proxy.address().port}`
async function start() {
  store = new ProductStore({ path: join(state, 'state.sqlite') })
  const registry = new NativeProjectRegistry(state),
    projects = registry.list()
  product = createProductRuntime({
    store,
    principal,
    stateRoot: state,
    scratchProject: project,
    actionSecret: Buffer.alloc(32, 1),
    projects: projects.map((item) => ({ id: item.id, displayName: item.displayName, scope: registry.scope(item) })),
    native: {
      profile,
      projects: projects.map((item) => ({ id: item.id, path: item.path, check: registry.check(item),
        ...(item.environment ? { environment: registry.environment(item) } : {}) })),
      approvalPolicy: 'on-request',
    },
    projectRegistry: registry,
  })
  const app = createLocalHttpApp({
    application: product.application,
    principal,
    apiToken: 'a'.repeat(64),
    bootstrapToken: 'b'.repeat(64),
    allowedOrigins: [new URL(consoleURL).origin, browserURL],
    mode: 'personal',
    localDevelopmentAccess: true,
    read: product.read,
  })
  server = listenLocalHttp(app, 0)
  await once(server, 'listening')
  api = `http://127.0.0.1:${server.address().port}`
  product.start()
}
async function stop() {
  if (!server) return
  server.closeAllConnections()
  await product.close()
  await new Promise((resolve) => server.close(resolve))
  store.close()
  server = undefined
}
await start()
const browser = await chromium.launch(),
  context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    locale: 'zh-CN',
    acceptDownloads: true,
  }),
  page = await context.newPage()
page.on('pageerror', (error) => errors.push(error.message))
const conversationId = previous?.conversationId ?? `native-browser-${crypto.randomUUID()}`
const goal =
  '实现 src/slugify.mjs，导出 slugify(text)：英文字母转小写，保留数字，连续的其他字符变成一个连字符，去掉首尾连字符。运行 node --test。不要修改 test/acceptance.test.mjs、package.json 或 Git 元数据，不要联网或安装依赖，可以补充测试。'
const step = async (id, action) => {
  try {
    await action()
    cases.push({ id, status: 'PASS' })
    console.log(JSON.stringify({ case: id, status: 'PASS' }))
  } catch (error) {
    cases.push({ id, status: 'FAIL', message: error.message })
    throw error
  }
}
let workId = previous?.workId,
  attemptId = previous?.attemptId
try {
  await page.goto(`${browserURL}/?conversation=${conversationId}`)
  await page.waitForSelector('.layout')
  if (environmentLane && previous) {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: '工作空间', exact: true }).click()
    await page.getByRole('button', { name: '导入项目', exact: true }).click()
    await page.locator('.project-import input[name="project-path"]').fill(project)
    await page.getByRole('combobox', { name: '依赖准备', exact: true }).selectOption('offline_install')
    await page.getByRole('textbox', { name: '授权 pnpm 缓存目录', exact: true }).fill(environmentStore)
    await page.getByRole('textbox', { name: '授权 pnpm 缓存目录', exact: true }).scrollIntoViewIfNeeded()
    await screenshot('mobile-import.png')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await page.getByRole('button', { name: '取消导入', exact: true }).click()
    await page.setViewportSize({ width: 1440, height: 960 })
  }
  if (!previous) {
    await step('IMPORT-REAL-PROJECT-THROUGH-UI', async () => {
      await page.getByRole('button', { name: '导入项目', exact: true }).click()
      await page.locator('.project-import input[name="project-path"]').fill(project)
      await page.locator('.project-import input[name="project-name"]').fill('真实原生验收项目')
      if (environmentLane) {
        await page.getByRole('combobox', { name: '验收命令', exact: true }).selectOption('pnpm_test')
        await page.getByRole('combobox', { name: '依赖准备', exact: true }).selectOption('offline_install')
        await page.getByRole('textbox', { name: '授权 pnpm 缓存目录', exact: true }).fill(environmentStore)
        await screenshot('desktop-import.png')
        await page.setViewportSize({ width: 390, height: 844 })
        await screenshot('mobile-import.png')
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
        await page.setViewportSize({ width: 1440, height: 960 })
      }
      await page.locator('.project-import').getByRole('button', { name: '导入项目', exact: true }).click()
      await page.locator('.new-work').waitFor()
      assert.equal(
        await page.locator('.new-work').getByRole('combobox', { name: '开发执行器', exact: true }).inputValue(),
        profile.id,
      )
      assert.equal(store.domain.tickets.list().length, 0)
    })
    await step('EXPLICIT-CHAT-DELEGATION-CONFIRMATION', async () => {
      await page.locator('.new-work').getByRole('button', { name: '取消', exact: true }).click()
      await page.locator('#composer-input').fill(goal)
      await page.getByRole('button', { name: '委托执行', exact: true }).click()
      assert.equal(await page.locator('.new-work textarea').inputValue(), goal)
      assert.equal(store.domain.tickets.list().length, 0)
      await page.locator('.new-work').getByRole('button', { name: '创建委托', exact: true }).click()
      await page.locator('.work-card').waitFor()
      const view = await product.application.inspect({ conversationId })
      workId = view.works[0].work.id
    })
    await step('ACTUAL-CODEX-CODE-AND-REGISTERED-VERIFICATION', async () => {
      let watching = true
      const monitor = (async () => {
        while (watching) {
          const view = await product.application.inspect({ conversationId, workId })
          const link = view.works[0]?.links[0],
            binding = link && store.bindings.current(link.ticketId)
          const errors =
            binding && store.observations.forAttempt(binding.attemptId).filter((item) => item.kind === 'runtime.error')
          if (errors?.length) throw new Error(JSON.stringify((await store.payloads.read(errors[0].payloadRef)).value))
          if (view.questions.length)
            throw new Error(
              'Native task requested a decision; this bounded automatic happy-path lane will not auto-answer it',
            )
          if (view.works[0]?.phase === 'stopping')
            throw new Error('Native dispatch is held for physical reconciliation')
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
      })()
      try {
        await Promise.race([page.waitForSelector('.verification .outcome-PASS', { timeout: 180000 }), monitor])
      } finally {
        watching = false
      }
      await page.getByRole('button', { name: '接受当前候选', exact: true }).waitFor()
      assert.equal(await page.locator('.artifacts li').count(), 3)
      const view = await product.application.inspect({ conversationId, workId })
      attemptId = store.bindings.current(view.works[0].links[0].ticketId).attemptId
      const workspace = product.workspaces.attemptPath(attemptId)
      assert.equal(readFileSync(join(workspace, 'test/acceptance.test.mjs'), 'utf8'), acceptance)
      assert.equal(git(['rev-parse', 'HEAD']), base)
      assert.equal(git(['status', '--porcelain']), '')
      if (environmentLane) {
        const prepared = await product.read.workEnvironment(workId)
        assert.equal(prepared.status, 'ready')
        await page.getByRole('region', { name: '依赖环境', exact: true }).waitFor()
        assert.match(await page.getByRole('region', { name: '依赖环境', exact: true }).innerText(), /已准备并复验/)
      }
      await screenshot('desktop-verified.png')
    })
  } else {
    await page.locator('.work-card').click()
    await page.waitForSelector('.verification .outcome-PASS', { timeout: 30000 })
    const view = (await product.application.inspect({ conversationId, workId })).works[0]
    attemptId = store.bindings.current(view.links[0].ticketId).attemptId
    if (!cases.some(item => item.id === 'ACTUAL-CODEX-CODE-AND-REGISTERED-VERIFICATION')) {
      await step('ACTUAL-CODEX-CODE-AND-REGISTERED-VERIFICATION', async () => {
        assert.equal(readFileSync(join(product.workspaces.attemptPath(attemptId), 'test/acceptance.test.mjs'), 'utf8'), acceptance)
        assert.equal(git(['rev-parse', 'HEAD']), base)
        assert.equal(git(['status', '--porcelain']), '')
        if (environmentLane) assert.equal((await product.read.workEnvironment(workId)).status, 'ready')
        await screenshot('desktop-verified.png')
      })
    }
  }
  await step('LOCATION-AND-COMPLETE-PATCH-EXPORT', async () => {
    await page.getByRole('region', { name: '代码位置' }).waitFor()
    assert.match(await page.getByRole('region', { name: '代码位置', exact: true }).innerText(), /原项目|工作区/)
    const location = await product.read.workLocation(workId)
    assert.equal(location.projectPath, realpathSync(project))
    assert.equal(location.baseCommit, base)
    const patch = page.locator('.artifacts li').filter({ hasText: '完整变更补丁' })
    await patch.getByRole('button', { name: '查看', exact: true }).click()
    await page.locator('.artifact-text').waitFor()
    const text = await page.locator('.artifact-text').innerText()
    assert.match(text, /src\/slugify\.mjs/)
    if (environmentLane) {
      assert.doesNotMatch(text, /node_modules|product-environment|authorityRoot|COREPACK/)
      const clone = join(root, 'patch-roundtrip')
      execFileSync('git', ['clone', '-q', project, clone], { stdio: 'pipe' })
      execFileSync('git', ['checkout', '--detach', base], { cwd: clone, stdio: 'pipe' })
      execFileSync('git', ['apply', '-'], { cwd: clone, input: text, stdio: 'pipe' })
      execFileSync(process.execPath, ['--test', 'test/acceptance.test.mjs'], { cwd: clone, stdio: 'pipe' })
    }
    const downloading = page.waitForEvent('download')
    await patch.getByRole('link', { name: '下载', exact: true }).click()
    assert.equal(readFileSync(await (await downloading).path(), 'utf8'), text)
    await page.locator('.artifact-preview').getByRole('button', { name: '关闭预览', exact: true }).click()
  })
  await step('ACCEPT-CURRENT-NATIVE-CANDIDATE', async () => {
    await page.getByRole('button', { name: '接受当前候选', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
  })
  await step('RESTART-PRESERVES-PROJECT-DELIVERY-WITHOUT-BEGIN', async () => {
    const count = store.observations.forAttempt(attemptId).length
    await stop()
    await start()
    await page.reload()
    await page.locator('.work-card').click()
    await page.waitForFunction(() => document.querySelector('.detail .phase')?.textContent === '已交付')
    assert.equal(store.observations.forAttempt(attemptId).length, count)
    assert.equal((await product.read.configuration()).projects.length, 1)
    if (environmentLane) assert.equal((await product.read.workEnvironment(workId)).status, 'ready')
    assert.equal(await page.locator('.artifacts li').count(), 3)
    await page.setViewportSize({ width: 390, height: 844 })
    await screenshot('mobile-delivered.png')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    assert.equal(errors.length, 0, errors.join('\n'))
  })
} finally {
  await browser.close()
  await stop()
  proxy.closeAllConnections()
  await new Promise((resolve) => proxy.close(resolve))
  const report = {
    status:
      cases.length === 6 && cases.every((item) => item.status === 'PASS')
        ? 'PASS_REAL_NATIVE_WORKBENCH'
        : 'FAIL_REAL_NATIVE_WORKBENCH',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceWorktreeClean: execFileSync('git', ['status', '--porcelain', '--', 'apps', 'packages', 'tools', 'package.json', 'pnpm-lock.yaml', 'tests/integration/native-workbench.mjs', ':(exclude)packages/*/reports'], { encoding: 'utf8' }).trim() === '',
    checkedAt: new Date().toISOString(),
    nativeVersion: profile.expectedVersion,
    environmentLane,
    screenshotsCapturedThisRun: screenshots,
    ...(environmentStore ? { environmentStore } : {}),
    root,
    workId,
    conversationId,
    attemptId,
    cases,
    errors,
    nativeTasksStartedThisRun: previous ? 0 : 1,
    ...(previous ? { resumedExistingVerifiedCandidate: true, nativeSourceCommit: previous.sourceCommit } : {}),
    limitations: [
      'One real Codex task; no auto-answer of native questions in this happy-path lane',
      environmentLane ? 'Single-package pnpm offline fixture with local tarball; no online install or package lifecycle scripts' : 'Private scratch project retained; no user repository changed; dependency preparation is a separate package',
    ],
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report, null, 2))
}
