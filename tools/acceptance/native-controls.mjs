import assert from 'node:assert/strict'
import { createServer as netServer } from 'node:net'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { setup, start, create, waitInspect, actualTurns, grantRoot } from './native-milestones.mjs'

const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
const { createServer } = await import(require.resolve('vite'))
const consoleRoot = fileURLToPath(new URL('../../apps/console/', import.meta.url))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const log = value => appendFileSync(join(grantRoot, 'lifecycle.log'), JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n')
const results = []
const selected = new Set(process.argv.slice(2))
if (!selected.has('--execute')) throw new Error('Real native-control probes require explicit --execute and the user-authorized shared grant root')

async function freePort() {
  const server = netServer(); server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port
}
async function begin(taskId, goal, check, collaboration = 'default', approvalPolicy = 'on-request', prepare) {
  assert.ok(actualTurns('native-control-six') < 6)
  const h = setup(taskId, 'native-control-six', 6, check, collaboration)
  if (prepare) { prepare(h); h.git(['add', '.']); h.git(['-c', 'user.name=MilestoneProbe', '-c', 'user.email=probe@localhost', 'commit', '-qm', 'fixed control helpers']) }
  const port = await freePort()
  h.config.uiOrigin = 'http://127.0.0.1:' + port
  h.config.approvalPolicy = approvalPolicy
  writeFileSync(join(h.root, 'probe-config.json'), JSON.stringify(h.config), { mode: 0o600 })
  const coordinator = await start(h.config)
  const vite = await createServer({ root: consoleRoot, configFile: join(consoleRoot, 'vite.config.ts'),
    define: { 'import.meta.env.VITE_CONSOLE_MODE': JSON.stringify('http') },
    server: { host: '127.0.0.1', port, strictPort: true, proxy: { '/v1': { target: 'http://127.0.0.1:' + coordinator.port, changeOrigin: true } } } })
  await vite.listen()
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  const commands = []
  page.on('request', request => { if (request.url().endsWith('/v1/commands') && request.method() === 'POST') commands.push(request.postDataJSON()) })
  const workId = await create(coordinator, taskId, goal)
  await page.goto(h.config.uiOrigin + '/?conversation=probe&work=' + workId)
  await page.locator('.layout').waitFor({ state: 'visible', timeout: 20000 })
  return { ...h, coordinator, vite, browser, page, workId, commands }
}
async function clickAnswer(h, question, decision = 'accept', dropResponse = false) {
  const card = h.page.locator('[aria-labelledby="q-' + question.id + '"]').first()
  await card.waitFor({ state: 'visible', timeout: 20000 })
  let committed
  if (dropResponse) await h.page.route('**/v1/commands', async route => {
    if (route.request().postDataJSON()?.questionId !== question.id) { await route.continue(); return }
    const upstream = await route.fetch(); committed = await upstream.json()
    await route.abort('failed')
  })
  const response = dropResponse ? null : h.page.waitForResponse(value => value.url().endsWith('/v1/commands') && value.request().method() === 'POST' && value.request().postDataJSON()?.questionId === question.id)
  if (question.kind === 'permission') {
    const option = question.presentation.options.find(value => value.id === decision)
    assert.ok(option); await card.getByRole('button', { name: option.label, exact: true }).click()
  } else {
    for (const field of question.presentation.fields) {
      if (field.kind === 'single') await card.locator('select').selectOption('option-1')
      else await card.locator('input[type=text]').fill('BETA')
    }
    await card.getByRole('button', { name: '提交表单', exact: true }).click()
  }
  if (response) assert.equal((await (await response).json()).status, 'recorded')
  else {
    const until = Date.now() + 15000
    while (!committed && Date.now() < until) await pause(20)
    assert.equal(committed?.status, 'recorded', 'The response fault occurs after the original Store commit')
    await h.page.unroute('**/v1/commands')
  }
  const recorded = h.commands.find(value => value.questionId === question.id)
  assert.equal(recorded.expectedVersion, question.version)
  log({ kind: 'UI_ANSWER', taskId: h.config.taskId, workId: h.workId, questionId: question.id,
    targetId: question.targets[0].id, nativeMethod: question.targets[0].nativeMethod, commandId: recorded.commandId, decision })
}
async function finish(h) {
  const deadline = Date.now() + 150000
  let last
  const answered = new Set()
  while (Date.now() < deadline) {
    last = await h.coordinator.inspect(h.workId)
    for (const q of last.view.questions.filter(q => q.validity === 'open' && !answered.has(q.id))) {
      if (q.kind !== 'permission') throw new Error('Unexpected question in completion')
      answered.add(q.id); await clickAnswer(h, q)
    }
    const view = last.view.works[0]
    if (view.actions.available.includes('accept_candidate')) {
      const response = await h.coordinator.command({ kind: 'accept_candidate', commandId: 'final-' + h.workId, candidate: view.actions.currentCandidate })
      assert.equal(response.status, 'recorded')
      const delivered = await h.coordinator.inspect(h.workId)
      assert.equal(delivered.view.works[0].phase, 'delivered'); assert.equal(delivered.binding.state, 'ended')
      assert.equal(delivered.beginCommands.length, 1)
      return delivered
    }
    if (last.held || last.parked.length) throw new Error('Held: ' + JSON.stringify(last.held ?? last.parked))
    await pause(150)
  }
  throw new Error('Native control completion timeout: ' + JSON.stringify(last))
}
async function close(h) {
  await h.browser.close(); await h.vite.close()
  await h.coordinator.close()
}
async function scenario(name, action) {
  try { const value = await action(); results.push({ name, status: 'PASS', ...value }); log({ kind: 'CONTROL_PASS', name, ...value }) }
  catch (error) { results.push({ name, status: 'FAIL_OR_UNKNOWN', error: String(error.message) }); log({ kind: 'CONTROL_FAIL_OR_UNKNOWN', name, error: String(error.stack ?? error) }) }
  console.log(JSON.stringify({ name, result: results.at(-1), actualTurns: actualTurns('native-control-six') }))
}

if (selected.has('--approval-allow')) await scenario('approval-allow', async () => {
  const h = await begin('control-approval-allow-untrusted',
    "Use the exec_command shell tool to run exactly: node -e \"require('node:fs').writeFileSync('src/approved.txt','APPROVED\\n')\". Do not use apply_patch or other write paths. Wait for any user approval. After this one local command finishes, stop. Do not access networks or other files, install, commit or use alternative commands if denied.",
    "if(require('node:fs').readFileSync('src/approved.txt','utf8').trim()!=='APPROVED')process.exit(1)", 'default', 'untrusted')
  try {
    const waiting = await waitInspect(h.coordinator, h.workId, value => value.view.questions.some(q => q.kind === 'permission'), 'real native approval', 90000)
    const question = waiting.view.questions.find(q => q.kind === 'permission')
    await h.page.screenshot({ path: join(h.root, 'approval-workbench.png'), fullPage: true })
    await clickAnswer(h, question, 'accept', true)
    const done = await finish(h)
    assert.ok(done.observations.some(row => row.kind === 'answer.observed' && row.detail.status === 'native_applied'))
    assert.equal(h.commands.filter(value => value.questionId === question.id).length, 1, 'A lost UI response never automatically resends the business answer')
    assert.equal(done.answerCommands.length, 1)
    await h.page.reload(); await h.page.locator('.layout').waitFor()
    return { workId: h.workId, root: h.root, nativeMethod: question.targets[0].nativeMethod, answerCommands: done.answerCommands.length, delivered: true, lostResponseReconciledReadonly: true }
  } finally { await close(h) }
})

if (selected.has('--approval-deny')) await scenario('approval-deny', async () => {
  const h = await begin('control-approval-deny',
    "Use the exec_command shell tool for exactly: node -e \"require('node:fs').writeFileSync('src/denied.txt','DENIED\\n')\". If the user rejects approval, immediately finish without writing any file, invoking another command, using alternative tools or asking again. No network, install, commits or other changes.",
    "if(require('node:fs').existsSync('src/denied.txt'))process.exit(1)", 'default', 'untrusted')
  try {
    const waiting = await waitInspect(h.coordinator, h.workId, value => value.view.questions.some(q => q.kind === 'permission'), 'native denial request', 90000)
    const question = waiting.view.questions.find(q => q.kind === 'permission')
    await clickAnswer(h, question, 'decline')
    const stopped = await waitInspect(h.coordinator, h.workId, value => value.binding?.state === 'ended', 'denied native process becomes quiescent', 90000)
    assert.equal(existsSync(join(stopped.workspace, 'src/denied.txt')), false, 'No denied file write')
    assert.notEqual(stopped.view.works[0].phase, 'delivered')
    assert.equal(stopped.answerCommands.length, 1)
    assert.ok(stopped.resources.resources.every(resource => resource.quiescence === 'observed_quiescent'))
    return { root: h.root, workId: h.workId, nativeMethod: question.targets[0].nativeMethod, deniedFileAbsent: true, physicalQuiescence: true }
  } finally { await close(h) }
})

if (selected.has('--clarification')) await scenario('clarification', async () => {
  const h = await begin('control-clarification',
    'Before doing anything else, use request_user_input to ask the user to choose one of ALPHA or BETA as the final answer. You must call that native tool and wait; do not infer or choose for the user. After the tool answer, state the chosen literal and finish. No file changes or commands are needed.',
    "const t=require('node:fs').readFileSync(" + JSON.stringify(join(grantRoot, 'actual-sends.log')) + ",'utf8');if(!t.includes('control-clarification\\tNATIVE_REQUEST\\titem/tool/requestUserInput')||!t.includes('control-clarification\\tSERVER_REPLY'))process.exit(1)", 'plan')
  try {
    const waiting = await waitInspect(h.coordinator, h.workId, value => value.view.questions.some(q => q.kind === 'clarification'), 'native request_user_input', 90000)
    const question = waiting.view.questions.find(q => q.kind === 'clarification')
    assert.equal(question.targets[0].nativeMethod, 'item/tool/requestUserInput')
    await clickAnswer(h, question)
    const done = await finish(h)
    assert.equal(done.binding.attemptId, waiting.binding.attemptId)
    assert.equal(done.answerCommands.length, 1)
    assert.equal(done.answerCommands[0].attemptId, question.targets[0].attemptId)
    assert.equal(done.answerCommands[0].kind, 'answer')
    assert.ok(done.observations.some(row => row.kind === 'answer.observed' && row.detail.status === 'native_applied'))
    await h.page.screenshot({ path: join(h.root, 'clarification-workbench.png'), fullPage: true })
    return { root: h.root, workId: h.workId, originalQuestionId: question.id, targetId: question.targets[0].id, sameNativeSession: true, delivered: true }
  } finally { await close(h) }
})

if (selected.has('--steer-stop')) await scenario('steer-stop', async () => {
  const h = await begin('control-steer-stop',
    'First run exactly node src/first-wait.mjs. It is an authorized short local delay. After that, obey the next user supplement. Do not modify the supplied helper scripts or src/base.txt. Do not install, use networks, commit or access other projects. Keep working until the user stops you.',
    "if(require('node:fs').readFileSync('src/steered.txt','utf8').trim()!=='BETA')process.exit(1)", 'default', 'on-request', value => {
      writeFileSync(join(value.root, 'project/src/first-wait.mjs'), "import fs from 'node:fs';fs.writeFileSync('src/first-ready.txt','READY');setTimeout(()=>{},20000);\n")
      writeFileSync(join(value.root, 'project/src/stop-wait.mjs'), "import fs from 'node:fs';fs.writeFileSync('src/stop-meta.txt',JSON.stringify({pid:process.pid,at:Date.now()}));setTimeout(()=>{},35000);\n")
    })
  try {
    const first = await waitInspect(h.coordinator, h.workId, value => value.workspace && existsSync(join(value.workspace, 'src/first-ready.txt')), 'first real command is running', 90000)
    assert.equal(first.binding.state, 'active')
    await h.page.getByRole('button', { name: '当前工作', exact: true }).click()
    await h.page.locator('#composer-input').fill("Supplement this same Work: after the current command returns, create src/steered.txt containing BETA and a newline, then run exactly node src/stop-wait.mjs. Do not finish early; the user will stop the Work while this final short command is running. Do not change helper scripts, use other write paths, networks or commit.")
    const posted = h.page.waitForResponse(value => value.url().endsWith('/v1/commands') && value.request().postDataJSON()?.kind === 'chat')
    await h.page.getByRole('button', { name: '发送消息', exact: true }).click()
    assert.equal((await (await posted).json()).status, 'recorded')
    const deadline = Date.now() + 120000
    let running
    while (Date.now() < deadline) {
      running = await h.coordinator.inspect(h.workId)
      for (const question of running.view.questions.filter(q => q.validity === 'open')) await clickAnswer(h, question)
      if (running.workspace && existsSync(join(running.workspace, 'src/stop-meta.txt'))) break
      if (running.held || running.parked.length) throw new Error('Steer held: ' + JSON.stringify(running.held ?? running.parked))
      await pause(100)
    }
    assert.ok(existsSync(join(running.workspace, 'src/stop-meta.txt')), 'Real Codex did not reach the supplemented command')
    assert.equal(readFileSync(join(running.workspace, 'src/steered.txt'), 'utf8').trim(), 'BETA')
    assert.equal(running.binding.attemptId, first.binding.attemptId)
    assert.equal(running.beginCommands.length, 1)
    assert.equal(running.deliverCommands.length, 1)
    const tool = JSON.parse(readFileSync(join(running.workspace, 'src/stop-meta.txt'), 'utf8'))
    assert.ok(Number.isSafeInteger(tool.pid) && tool.pid > 1)
    const birth = execFileSync('ps', ['-ww', '-p', String(tool.pid), '-o', 'lstart=,uid=,command='], { encoding: 'utf8' }).trim()
    assert.ok(birth.includes('node src/stop-wait.mjs'))
    await h.page.screenshot({ path: join(h.root, 'steer-running-workbench.png'), fullPage: true })
    const stoppedResponse = h.page.waitForResponse(value => value.url().endsWith('/v1/commands') && value.request().postDataJSON()?.kind === 'stop_work')
    await h.page.getByRole('button', { name: '停止工作', exact: true }).click()
    assert.equal((await (await stoppedResponse).json()).status, 'recorded')
    const stopped = await waitInspect(h.coordinator, h.workId, value => value.binding?.state === 'ended', 'original physical barrier after UI stop', 30000)
    assert.ok(stopped.resources.resources.every(resource => resource.quiescence === 'observed_quiescent'))
    let toolGone = false
    try {
      const state = execFileSync('ps', ['-p', String(tool.pid), '-o', 'stat='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
      toolGone = state.startsWith('Z')
    } catch (error) { if (error.status === 1) toolGone = true; else throw error }
    assert.equal(toolGone, true, 'The independently observed running tool must also stop before slot release')
    return { root: h.root, workId: h.workId, sameAttempt: true, steerAccepted: true, finalMarker: 'BETA', physicalStop: true, observedToolPid: tool.pid, resourceBarrierEnded: true }
  } finally { await close(h) }
})

appendFileSync(join(grantRoot, 'control-session-state.txt'), results.map(value => JSON.stringify(value)).join('\n') + '\n', { mode: 0o600 })
