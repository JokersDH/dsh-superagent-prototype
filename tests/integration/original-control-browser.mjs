import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer as portProbe } from 'node:net'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { UserCommandSchema } from '../../packages/contracts/dist/index.js'
import { createProductRuntime } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'
import { listenLocalHttp } from '../../apps/coordinator/http/server.ts'
import { nativeCallbackLink } from './fixtures/native-callback-link.ts'

const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const { createServer } = await import(require.resolve('vite'))
const evidence = mkdtempSync(join(resolve(process.argv[2] ?? tmpdir()), 'pa-control-app-'))
const principal = { userId: 'control-browser-user', authorityRef: 'control-browser-authority' }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(read, predicate, label) {
  const deadline = Date.now() + 12000
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (predicate(last)) return last
    await pause(25)
  }
  throw new Error(label + ': ' + JSON.stringify(last))
}
async function freePort() {
  const socket = portProbe()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  return port
}

for (const mode of ['question', 'questionless', 'lost-answer-response', 'unknown-resource']) {
  const root = join(evidence, mode), stateRoot = join(root, 'state'), project = join(root, 'project')
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 }); mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, 'src/base.txt'), 'Base\n')
  const git = args => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/base.txt'])
  git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'private baseline'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const trace = { virtualResources: 0, nativeEffects: 0, stdioFacts: [], stdioPayloads: 0, stdioGuards: 0,
    protocolMethods: [], errors: [], closers: [], holdAfterAnswer: true, questionless: mode === 'questionless' }
  const scope = { projectId: 'control-project', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] }
  const profile = { id: 'controlled-native-profile', revision: 1, driverId: 'codex-native', driverApiMajor: 1,
    driverRelease: 'controlled-integration', executable: process.execPath, argv: [], expectedVersion: process.version,
    nativeConfigRef: 'controlled-settings', permissionPolicyRevision: 'controlled-policy', requiredFeatures: [] }
  const product = createProductRuntime({ store, stateRoot, scratchProject: project, principal, actionSecret: Buffer.alloc(32, 31),
    projects: [{ id: scope.projectId, displayName: '原控制项目', scope }], nativeRunnerLinkFactory: nativeCallbackLink(trace),
    native: { profile, approvalPolicy: 'on-request', projects: [{ id: scope.projectId, path: project,
      check: { id: 'original-check', revision: 1, executable: process.execPath, argv: ['-e', 'process.exit(0)'],
        deadlineMs: 1000, outputLimitBytes: 1024 } }] } })
  const consolePort = await freePort(), origin = 'http://127.0.0.1:' + consolePort
  const api = listenLocalHttp(createLocalHttpApp({ application: product.application, principal, apiToken: 'a'.repeat(64),
    bootstrapToken: 'b'.repeat(64), mode: 'personal', localDevelopmentAccess: true, allowedOrigins: [origin],
    read: product.read, operations: product.operations }), 0)
  await once(api, 'listening')
  const vite = await createServer({ root: resolve('apps/console'), configFile: false,
    define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
    server: { host: '127.0.0.1', port: consolePort, strictPort: true,
      proxy: { '/v1': { target: 'http://127.0.0.1:' + api.address().port, changeOrigin: true } } } })
  let browser
  const commands = [], errors = []
  const snapshot = workId => product.application.inspect({ workId })
  try {
    product.start(); await vite.listen(); browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
    page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/v1/commands' && request.method() === 'POST')
        commands.push(UserCommandSchema.parse(request.postDataJSON()))
    })
    let answerResponseDropped = false
    if (mode === 'lost-answer-response') await page.route('**/v1/commands', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON()?.kind === 'answer_question' && !answerResponseDropped) {
        await route.fetch()
        answerResponseDropped = true
        await route.abort('failed')
      } else await route.continue()
    })
    await page.goto(origin)
    await page.getByRole('button', { name: '新建委托', exact: true }).click()
    const form = page.getByRole('form', { name: '新建委托', exact: true })
    await form.locator('textarea').fill('在原工作中回答问题并等待运行中的补充和停止：' + mode)
    await form.getByRole('button', { name: '创建委托', exact: true }).click()
    const work = await until(async () => (await product.application.inspect({})).works[0], value => !!value?.actions.currentAssignment, 'Original Work/assignment')
    const workId = work.work.id
    await page.locator('.work-card').first().click()
    const active = await until(async () => (await snapshot(workId)).works[0], value => value.resourceStatus === 'active', 'Original active resource')
    const assignment = active.actions.currentAssignment
    const binding = store.bindings.current(assignment.ticketId)
    assert.equal(binding.contract.workId, workId)
    assert.equal(binding.state, 'active')
    if (mode !== 'questionless') {
      const waiting = await until(() => snapshot(workId), value => value.questions.length === 1, 'Original question')
      const question = waiting.questions[0], target = question.targets[0]
      assert.deepEqual(target.nativeRequestId, { kind: 'integer', decimal: '42' })
      assert.equal(target.attemptId, binding.attemptId)
      const card = page.locator('.question-card').filter({ hasText: 'Choose output' }).first()
      await card.locator('select').selectOption('option-1')
      await card.getByRole('button', { name: '提交表单', exact: true }).click()
      await until(async () => product.application.questions.currentDeliveries(question.id), values => values[0]?.status === 'native_applied', 'Original native answer acknowledgement')
      const answer = commands.find(value => value.kind === 'answer_question')
      assert.equal(answer.questionId, question.id); assert.equal(answer.expectedVersion, question.version)
      assert.equal(trace.nativeEffects, 1)
      assert.equal(store.db.prepare("SELECT count(*) AS n FROM runtime_observations WHERE attempt_id=? AND kind='turn.ended'").get(binding.attemptId).n, 0)
      if (mode === 'lost-answer-response') {
        assert.equal(answerResponseDropped, true)
        await page.reload()
        await page.locator('.work-card').first().click()
        assert.equal(commands.filter(value => value.kind === 'answer_question').length, 1)
        assert.equal(store.db.prepare('SELECT count(*) AS n FROM answers WHERE question_id=?').get(question.id).n, 1)
        assert.equal(trace.nativeEffects, 1)
      }
    } else {
      assert.equal((await snapshot(workId)).questions.length, 0)
    }
    await page.getByRole('button', { name: '当前工作', exact: true }).click()
    const text = '补充原工作：保持当前原生会话，等待我明确停止。'
    await page.locator('#composer-input').fill(text)
    await page.getByRole('button', { name: '发送消息', exact: true }).click()
    await until(async () => trace.supplements, values => values?.[0] === text, 'Actual production Driver turn/steer')
    const supplement = commands.find(value => value.kind === 'chat')
    assert.deepEqual(supplement.anchor, { workId })
    assert.equal(trace.protocolMethods.filter(value => value === 'turn/start').length, 1)
    assert.equal(trace.protocolMethods.filter(value => value === 'turn/steer').length, 1)
    assert.equal(store.bindings.current(assignment.ticketId).attemptId, binding.attemptId)
    assert.equal(store.db.prepare("SELECT count(*) AS n FROM runtime_observations WHERE attempt_id=? AND kind='turn.ended'").get(binding.attemptId).n, 0)
    await page.screenshot({ path: join(root, 'same-work-running.png'), fullPage: true })
    if (mode === 'unknown-resource') trace.inventoryUnknown = true
    assert.equal(trace.stopCalls ?? 0, 0)
    await page.getByRole('button', { name: '停止工作', exact: true }).click()
    await until(async () => trace.stopCalls, value => value > 0, 'Original Runner owned-resource stop')
    if (mode === 'unknown-resource') {
      await until(async () => store.bindings.binding(binding.attemptId), value => value.state === 'stopping', 'UNKNOWN held binding')
      await pause(300)
      assert.notEqual(store.bindings.binding(binding.attemptId).state, 'ended')
      assert.ok(store.bindings.binding(binding.attemptId).resources.length > 0)
      assert.equal(store.db.prepare("SELECT count(*) AS n FROM event_log WHERE topic='runtime.barrier.confirmed' AND entity_ref=?").get(binding.attemptId).n, 0)
      console.log('PASS real App/HTTP/Store/Driver refuses UNKNOWN resource release; own original state retained: ' + root)
    } else {
      await until(async () => store.bindings.binding(binding.attemptId), value => value.state === 'ended', 'Original resource barrier and binding release')
      const final = (await snapshot(workId)).works[0]
      assert.equal(final.phase, 'ended'); assert.equal(final.resourceStatus, 'quiescent')
      const stop = commands.find(value => value.kind === 'stop_work')
      assert.equal(stop.workId, workId)
      assert.equal(trace.protocolMethods.filter(value => value === 'turn/start').length, 1)
      assert.ok(store.db.prepare("SELECT count(*) AS n FROM event_log WHERE topic='runtime.barrier.confirmed' AND entity_ref=?").get(binding.attemptId).n > 0)
      console.log('PASS real App/HTTP/Store/Application/Broker/Driver question=' + !trace.questionless + ' same-attempt steer and running stop; work=' + workId + '; original begin=1')
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(trace.errors, [])
  } finally {
    await browser?.close()
    await vite.close()
    api.closeAllConnections(); await new Promise(resolve => api.close(resolve))
    await product.close()
    await Promise.all(trace.closers.map(close => close()))
    store.close()
  }
}
console.log('Completed source UI control integration: ' + evidence + '; virtual protocol/resource only; real vendor/model/native processes/signals=0. This does not certify installed/live controls or close milestone03.')
