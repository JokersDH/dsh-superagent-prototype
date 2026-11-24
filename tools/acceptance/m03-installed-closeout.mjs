import assert from 'node:assert/strict'
import { spawn, spawnSync, execFileSync, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { UserCommandSchema } from '../../packages/contracts/dist/index.js'

const root = process.env.PA_M03_MAIN_ROOT
if (!root) throw new Error('An explicit authorized private execution root is required')
const privateRoot = join(root, 'private'), stateFile = join(privateRoot, 'state.json')
const readState = () => existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : {}
const save = value => writeFileSync(stateFile, JSON.stringify(value, null, 2), { mode: 0o600 })
const loadPreflight = () => JSON.parse(readFileSync(join(privateRoot, 'preflight.json'), 'utf8'))
const ledger = join(privateRoot, 'actual-sends.jsonl')
const events = () => existsSync(ledger) ? readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []
const sent = () => new Set(events().filter(e => ['TURN_WRITE_INTENT', 'SENT_TURN', 'UNKNOWN_TURN_WRITE'].includes(e.kind)).map(e => e.key)).size
const log = (kind, fields = {}) => appendFileSync(join(privateRoot, 'lifecycle.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind, ...fields }) + '\n', { mode: 0o600 })
const sha = data => createHash('sha256').update(data).digest('hex')
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const expected = { source: '83f79e8249efd68f429f2b6828ea233278071737', build: 'd3ba0ec6dccc5eac',
  outer: '163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b' }
const zip = '/Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip'
const require = createRequire(new URL('../../apps/console/package.json', import.meta.url))
const { chromium } = require('@playwright/test')
function paths() {
  const s = readState(), config = join(s.taskHome, 'Library/Application Support/PersonalAgent/Preview-' + expected.build + '/config')
  return { ...s, config, data: join(s.taskHome, 'Library/Application Support/PersonalAgent/Preview-' + expected.build + '/data'),
    node: join(s.bundle, 'runtime/bin/node') }
}
function environment() {
  const s = paths(), p = loadPreflight()
  return { ...process.env, HOME: s.taskHome, CODEX_HOME: p.authRoot,
    PA_MODEL_CONFIG: join(privateRoot, 'model.json'), PATH: join(root, 'bin') + ':' + process.env.PATH }
}
function query(sql, params = []) {
  const db = new DatabaseSync(join(paths().data, 'state.sqlite'), { readOnly: true })
  try { return db.prepare(sql).all(...params) } finally { db.close() }
}
async function wait(read, predicate, label, timeout = 90000) {
  const deadline = Date.now() + timeout
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (predicate(value)) return value
    await pause(150)
  }
  throw new Error(label + ' timeout; inspect original state before any action')
}
async function snapshot(workId) {
  const s = paths(), record = JSON.parse(readFileSync(join(s.config, 'instance.json'), 'utf8'))
  const token = readFileSync(join(s.data, 'api.key'), 'utf8').trim()
  const response = await fetch(record.apiURL + '/v1/snapshot' + (workId ? '?workId=' + encodeURIComponent(workId) : ''),
    { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(5000) })
  assert.equal(response.status, 200)
  return response.json()
}
function facts(workId) {
  const link = query("SELECT ticket_id FROM ticket_links WHERE work_id=? AND role='primary'", [workId])[0]
  if (!link) return null
  const ticket = JSON.parse(query('SELECT value FROM ticket WHERE id=?', [link.ticket_id])[0].value)
  const binding = query('SELECT * FROM runtime_bindings WHERE ticket_id=?', [link.ticket_id])[0]
  const observations = binding ? query('SELECT kind,detail,observed_at FROM runtime_observations WHERE attempt_id=? ORDER BY observed_at', [binding.attempt_id]) : []
  return { ticketId: link.ticket_id, ticket, binding, observations,
    dispatch: binding ? query('SELECT * FROM dispatch_receipts WHERE target=?', [binding.attempt_id]) : [],
    questions: query('SELECT id,validity,value FROM user_questions WHERE work_id=?', [workId]) }
}
async function browserPage() {
  const s = paths(), record = JSON.parse(readFileSync(join(s.config, 'instance.json'), 'utf8'))
  const browser = await chromium.launch(), page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' })
  page.setDefaultTimeout(15000)
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/v1/commands' && request.method() === 'POST') {
      const cmd = UserCommandSchema.parse(request.postDataJSON())
      log('UI_COMMAND', { commandId: cmd.commandId, kind: cmd.kind, workId: cmd.workId ?? cmd.anchor?.workId, questionId: cmd.questionId })
    }
  })
  try {
    await page.goto(record.consoleURL)
    await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
  } catch (error) { await browser.close(); throw error }
  return { browser, page, record }
}
async function openWork(page, goal) {
  const card = page.locator('.work-card').filter({ hasText: goal.slice(0, 35) }).first()
  await card.waitFor(); await card.click()
  await page.locator('.detail').waitFor()
}
async function create(page, goal) {
  await page.getByRole('button', { name: '新建委托', exact: true }).click()
  const form = page.getByRole('form', { name: '新建委托', exact: true }); await form.waitFor()
  const option = await form.getByRole('combobox', { name: '项目', exact: true }).locator('option').evaluateAll(nodes =>
    nodes.find(n => n.textContent === '控制链验证项目')?.value)
  assert.ok(option)
  await form.getByRole('combobox', { name: '项目', exact: true }).selectOption(option)
  await form.locator('textarea').fill(goal)
  const response = page.waitForResponse(r => r.url().endsWith('/v1/commands') && r.request().method() === 'POST')
  await form.getByRole('button', { name: '创建委托', exact: true }).click()
  const received = await response, value = await received.json()
  assert.equal(received.status(), 200)
  assert.equal(value.status, 'recorded')
  assert.ok(value.workId)
  return value.workId
}
async function setup() {
  assert.equal(sha(readFileSync(zip)), expected.outer)
  const p = loadPreflight(); assert.equal(p.version, 'codex-cli 0.164.0'); assert.equal(p.authExit, 0)
  assert.equal(existsSync(stateFile), false, 'Setup is one-time; inspect existing private state instead of replacing it')
  const extract = join(root, 'distribution'), taskHome = join(root, 'home'), project = join(root, 'project')
  for (const path of [extract, taskHome, project, join(root, 'bin')]) mkdirSync(path, { mode: 0o700 })
  execFileSync('/usr/bin/unzip', ['-q', zip, '-d', extract], { stdio: 'pipe' })
  const bundle = join(extract, 'PersonalAgent-Preview-' + expected.build.slice(0, 7))
  const manifest = JSON.parse(readFileSync(join(bundle, 'preview-manifest.json'), 'utf8'))
  assert.equal(manifest.inner.source, expected.source); assert.equal(manifest.inner.buildId, expected.build)
  save({ bundle, taskHome, project, expected, tasks: {} })
  writeFileSync(ledger, '', { mode: 0o600, flag: 'wx' })
  const forwardConfig = join(privateRoot, 'forwarder.json'), activeTask = join(privateRoot, 'active-task.json')
  writeFileSync(forwardConfig, JSON.stringify({ executable: p.codex, ledger, activeTask, cap: 2, grant: 'm03-main-closeout-2' }), { mode: 0o600 })
  writeFileSync(join(root, 'bin', 'codex'), '#!' + join(bundle, 'runtime/bin/node') + '\n' +
    'import {runForwarder} from ' + JSON.stringify(new URL('./m03-budget-forwarder.mjs', import.meta.url).href) + ';\n' +
    'runForwarder(' + JSON.stringify(forwardConfig) + ',process.argv.slice(2));\n', { mode: 0o700 })
  writeFileSync(join(root, 'bin', 'open'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  mkdirSync(join(project, 'tools')); mkdirSync(join(project, 'test'))
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'm03-local-controls', private: true, type: 'module', scripts: { test: 'node --test' } }) + '\n')
  writeFileSync(join(project, 'test', 'base.test.mjs'), "import test from 'node:test';import assert from 'node:assert/strict';test('baseline',()=>assert.equal(2+2,4));\n")
  writeFileSync(join(project, 'tools', 'control-window.mjs'), "import fs from 'node:fs';const phase=process.argv[2];if(!['first','second'].includes(phase))process.exit(2);fs.writeFileSync('control-'+phase+'.json',JSON.stringify({pid:process.pid,ppid:process.ppid,uid:process.getuid(),argv:process.argv,cwd:process.cwd(),at:new Date().toISOString()}));await new Promise(r=>setTimeout(r,phase==='first'?15000:60000));\n")
  execFileSync('git', ['init', '-q'], { cwd: project })
  execFileSync('git', ['add', 'package.json', 'test/base.test.mjs', 'tools/control-window.mjs'], { cwd: project })
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Milestone', '-c', 'user.email=milestone@localhost', 'commit', '-qm', 'private control baseline'], { cwd: project })
  console.log('SETUP_READY ' + root)
}
async function start() {
  const s = paths()
  assert.equal(existsSync(join(s.config, 'instance.json')), false, 'A prior own instance must be inspected, never overwritten')
  const argv = [join(s.bundle, 'Start.command')]
  const child = spawn(argv[0], [], { cwd: s.bundle, env: environment(), stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  child.stdout.on('data', b => appendFileSync(join(privateRoot, 'start.log'), b, { mode: 0o600 }))
  child.stderr.on('data', b => appendFileSync(join(privateRoot, 'start.err'), b, { mode: 0o600 }))
  const birth = spawnSync('ps', ['-ww', '-p', String(child.pid), '-o', 'lstart=,uid=,args='], { encoding: 'utf8' }).stdout.trim()
  log('OWN_START', { pid: child.pid, executable: argv[0], argv, cwd: s.bundle, birth })
  const record = await wait(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('Own normal startup exited; retain logs')
    try { const r = JSON.parse(readFileSync(join(s.config, 'instance.json'), 'utf8')); if ((await fetch(r.consoleURL)).ok) return r } catch {}
  }, v => !!v, 'Own normal package startup', 45000)
  const { browser, page } = await browserPage()
  try {
    await page.getByRole('button', { name: '导入项目', exact: true }).click()
    const form = page.getByRole('form', { name: '导入本地项目', exact: true })
    await form.locator('input[name=project-path]').fill(s.project)
    await form.locator('input[name=project-name]').fill('控制链验证项目')
    await form.getByRole('button', { name: '导入项目', exact: true }).click()
    await page.locator('.new-work').waitFor()
    await page.locator('.new-work').getByRole('button', { name: '取消', exact: true }).click()
    await page.screenshot({ path: join(privateRoot, 'ready.png'), fullPage: true })
  } finally { await browser.close() }
  console.log(JSON.stringify({ status: 'READY', consoleURL: record.consoleURL, apiURL: record.apiURL, data: s.data, used: sent() }))
  if (process.argv.includes('--serve')) await exited
}
const goals = {
  approval: "仅验证本工作区的一次审批，不修改文件、Git、账户或网络。请使用 exec_command 工具执行只读命令 node -p 'JSON.parse(require(\"node:fs\").readFileSync(\"package.json\",\"utf8\")).name'，这一次调用必须显式指定 sandbox_permissions=require_escalated，并提供 justification='是否允许运行本工作区的这条只读命令？'，等待用户逐次审批，不要改用自动执行或其他工具绕过。若本机工具不提供该审批能力，请明确报告能力不足并结束。获批后报告读取到的名称并结束。",
  'steer-stop': '仅验证本工作区运行中的补充和停止。第一步必须调用exec_command运行 node tools/control-window.mjs first，允许它完成这段有界本地等待；不修改该脚本。结束后优先执行用户在运行中发来的补充要求，不要自行完成任务，不访问其他目录、账户、网络或Git元数据。'
}
async function runTask(task) {
  assert.ok(goals[task]); assert.ok(process.argv.includes('--execute'), 'An actual task requires explicit --execute')
  const state = readState()
  assert.ok(!state.tasks[task], 'Existing business task must be reconciled, not created again')
  assert.ok(sent() < 2, 'Authorized maximum reached')
  writeFileSync(join(privateRoot, 'active-task.json'), JSON.stringify({ id: task }), { mode: 0o600 })
  const { browser, page } = await browserPage()
  try {
    const workId = await create(page, goals[task])
    state.tasks[task] = { workId, goal: goals[task] }; save(state); log('CREATED', { task, workId })
    await openWork(page, goals[task])
    await wait(() => facts(workId), f => f?.observations.some(o => o.kind === 'dispatch.observed'), 'Original native begin', 60000)
    const first = facts(workId); state.tasks[task].attemptId = first.binding.attempt_id; save(state)
    if (task === 'approval') {
      const f = await wait(() => facts(workId), value => value.questions.length > 0 || value.observations.some(o => o.kind === 'turn.ended'), 'Native approval or explicit capability end', 120000)
      if (!f.questions.length) {
        state.tasks[task].result = 'NOT_TRIGGERED'; save(state)
        await page.screenshot({ path: join(privateRoot, 'approval-not-triggered.png'), fullPage: true })
        console.log(JSON.stringify({ task, workId, result: 'NOT_TRIGGERED', used: sent(), facts: f.observations })); return
      }
      const question = JSON.parse(f.questions[0].value)
      assert.equal(question.kind, 'permission')
      const card = page.locator('.question-card').first(); await card.waitFor()
      await page.screenshot({ path: join(privateRoot, 'approval-question.png'), fullPage: true })
      const option = card.getByRole('button', { name: '仅本次允许', exact: true }); await option.click()
      await wait(() => query('SELECT status FROM answer_deliveries WHERE answer_id IN (SELECT answer_id FROM answers WHERE question_id=?)', [question.id]),
        rows => rows.length === 1 && rows[0].status === 'native_applied', 'Original native approval answer', 30000)
      await wait(() => snapshot(workId), value => value.works[0].actions.available.includes('accept_candidate'), 'Original candidate/check', 120000)
      await openWork(page, goals[task]); await page.getByRole('button', { name: '接受当前候选', exact: true }).click()
      await wait(() => snapshot(workId), value => value.works[0].phase === 'delivered', 'Original manual acceptance', 30000)
      state.tasks[task].result = 'PASS'; state.tasks[task].questionId = question.id; save(state)
      await page.screenshot({ path: join(privateRoot, 'approval-delivered.png'), fullPage: true })
      console.log(JSON.stringify({ task, workId, result: 'PASS', used: sent() }))
    } else {
      const locationResponse = await fetch((JSON.parse(readFileSync(join(paths().config, 'instance.json'), 'utf8')).apiURL) + '/v1/works/' + workId + '/location',
        { headers: { authorization: 'Bearer ' + readFileSync(join(paths().data, 'api.key'), 'utf8').trim() } })
      assert.equal(locationResponse.status, 200)
      const location = await locationResponse.json(), worktree = location.workspacePath
      assert.ok(worktree); state.tasks[task].workspace = worktree; save(state)
      await wait(async () => existsSync(join(worktree, 'control-first.json')), Boolean, 'Actual first running tool marker', 120000)
      assert.equal(facts(workId).observations.some(o => o.kind === 'turn.ended'), false)
      await page.getByRole('button', { name: '当前工作', exact: true }).click()
      const supplement = '补充同一个当前工作：first等待结束后，在工作区写 control-steered.txt 内容为 STEERED，然后必须运行 node tools/control-window.mjs second 等待我停止。不要更改等待脚本，不要新建Work，不访问网络或其他目录。'
      await page.locator('#composer-input').fill(supplement)
      await page.getByRole('button', { name: '发送消息', exact: true }).click()
      await wait(() => facts(workId), f => f.dispatch.some(r => r.command_id.includes('-deliver-') && r.delivery === 'native_accepted'), 'Actual same-attempt steer', 30000)
      await wait(async () => existsSync(join(worktree, 'control-second.json')), Boolean, 'Actual supplemented second running tool', 120000)
      const marker = JSON.parse(readFileSync(join(worktree, 'control-second.json'), 'utf8'))
      assert.equal(readFileSync(join(worktree, 'control-steered.txt'), 'utf8').trim(), 'STEERED')
      const observed = spawnSync('ps', ['-ww', '-p', String(marker.pid), '-o', 'lstart=,uid=,args='], { encoding: 'utf8' })
      assert.equal(observed.status, 0)
      state.tasks[task].tool = { ...marker, birth: observed.stdout.trim() }; save(state)
      assert.equal(facts(workId).observations.some(o => o.kind === 'turn.ended'), false)
      await page.screenshot({ path: join(privateRoot, 'steer-running.png'), fullPage: true })
      await page.getByRole('button', { name: '停止工作', exact: true }).click()
      await wait(() => facts(workId), f => f.binding.state === 'ended', 'Original physical barrier and binding release', 30000)
      await wait(async () => spawnSync('ps', ['-ww', '-p', String(marker.pid), '-o', 'lstart=,uid=,args='], { encoding: 'utf8' }).status !== 0,
        Boolean, 'Original running tool exited', 15000)
      const final = facts(workId)
      assert.equal(final.ticket.ended.outcome, 'stopped')
      assert.equal(final.dispatch.filter(r => r.command_id.includes('-begin-')).length, 1)
      assert.equal(final.binding.attempt_id, first.binding.attempt_id)
      assert.ok(query("SELECT seq FROM event_log WHERE topic='runtime.barrier.confirmed' AND entity_ref=?", [first.binding.attempt_id]).length > 0)
      state.tasks[task].result = 'PASS'; save(state)
      await page.screenshot({ path: join(privateRoot, 'steer-stopped.png'), fullPage: true })
      console.log(JSON.stringify({ task, workId, result: 'PASS', originalBegin: 1, originalAttempt: first.binding.attempt_id, toolExited: marker.pid, used: sent() }))
    }
  } catch (error) {
    log('TASK_FAIL_OR_UNKNOWN', { task, used: sent(), error: String(error.message) })
    console.error('TASK_FAIL_OR_UNKNOWN ' + task + '; inspect ' + privateRoot + '; ' + error.message); process.exitCode = 1
  } finally { await browser.close() }
}
async function inspect() {
  const state = readState()
  console.log(JSON.stringify({ root, usedOrUncertain: sent(), budget: events().filter(e => ['SENT_TURN', 'UNKNOWN_TURN_WRITE', 'TURN_WRITE_INTENT'].includes(e.kind)),
    tasks: Object.fromEntries(Object.entries(state.tasks ?? {}).map(([key, value]) => [key, { ...value, facts: facts(value.workId) }])) }, null, 2))
}
async function reopenCheck() {
  const state = readState(), before = sent()
  const { browser, page } = await browserPage()
  try {
    const snapshotValue = await snapshot()
    assert.equal(snapshotValue.works.length, 2)
    for (const [task, expectedPhase] of [['approval', 'delivered'], ['steer-stop', 'ended']]) {
      const meta = state.tasks[task]
      await openWork(page, meta.goal)
      await page.getByRole('button', { name: '当前工作', exact: true }).click()
      const value = (await snapshot(meta.workId)).works[0]
      assert.equal(value.work.id, meta.workId); assert.equal(value.phase, expectedPhase)
      assert.equal(facts(meta.workId).binding.attempt_id, meta.attemptId)
      if (task === 'approval') assert.ok(value.artifactIds.length >= 3)
      else await page.getByText('补充同一个当前工作：first等待结束后', { exact: false }).first().waitFor()
      await page.screenshot({ path: join(privateRoot, task + '-reopened.png'), fullPage: true })
    }
    assert.equal(sent(), before); assert.equal(before, 2)
    log('NORMAL_REOPEN_PASS', { originalWorks: Object.values(state.tasks).map(v => v.workId), actualSends: before })
    console.log('PASS normal fixed-package reopen retains both original Works/attempts, approval artifacts and anchored supplement; no extra model send')
  } finally { await browser.close() }
}
async function stop() {
  const s = paths()
  const value = await promisify(execFile)(join(s.bundle, 'Stop.command'), [], { cwd: s.bundle, env: environment(), timeout: 20000 })
  const result = JSON.parse(value.stdout); assert.ok(['STOPPED', 'STALE_RECORD_CLEANED'].includes(result.status))
  console.log('Own normal package instance STOPPED; all original private evidence retained: ' + root)
}
const action = process.argv[2]
if (action === '--setup') await setup()
else if (action === '--start') await start()
else if (action === '--approval') await runTask('approval')
else if (action === '--steer-stop') await runTask('steer-stop')
else if (action === '--inspect') await inspect()
else if (action === '--reopen-check') await reopenCheck()
else if (action === '--stop') await stop()
else throw new Error('Choose --setup, --start, --approval/--steer-stop --execute, --inspect, or --stop')
