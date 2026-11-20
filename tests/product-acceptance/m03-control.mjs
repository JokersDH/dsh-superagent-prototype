#!/usr/bin/env node
/**
 * Milestone-03 last control Work (one actual Codex turn).
 *
 *   node tests/product-acceptance/m03-control.mjs --preflight
 *   node tests/product-acceptance/m03-control.mjs --run
 *
 * Drives the fixed package's normal UI to: surface a native question, answer it, add a requirement
 * to the same running Work (turn/steer), stop while running, and confirm the original resource
 * binding/occupancy was returned by the product barrier. It never calls a probe coordinator or the
 * business API. The single send is guarded by a persistent control ledger that starts from the
 * previously recorded 3/4 usage.
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openBrowser } from './lib/browser.mjs'

const ROOT = resolve('.')
const PRIVATE = process.env.PA_E_M03_CONTROL_ROOT ?? '/Users/hh/Desktop/joker/pa-artifacts/m03-e-live'
const INSTALL = process.env.PA_E_M03_INSTALL ?? '/tmp/pa-e-m03-live/install'
const MODEL = process.env.PA_E_M03_MODEL ?? '/tmp/pa-e-m03-live/model/model.json'
const STATE_DB = process.env.PA_E_M03_STATE ?? join(process.env.HOME, 'Library/Application Support/PersonalAgent/Preview-d3ba0ec6dccc5eac/data/state.sqlite')
const PROJECT = process.env.PA_E_M03_CONTROL_PROJECT ?? '/tmp/pa-e-m03-live/projects3/token-engine-b'
const PROJECT_NAME = 'tokens-b'
const CONTROL_LEDGER = join(PRIVATE, 'control-send.jsonl')
const EVIDENCE = join(ROOT, 'tests/product-acceptance/evidence/m03-control.json')
const PRIOR_EVIDENCE = join(ROOT, 'tests/product-acceptance/evidence/m03-final.json')
const PKG = { zip: '/Users/hh/Desktop/joker/pa-artifacts/m03-preview-d3ba0ec/PersonalAgent-Preview-d3ba0ec.zip',
  outer: '163b32170680bcbdb324a4fd8edc631bdfb685633911a787c3b3de353577075b',
  source: '83f79e8249efd68f429f2b6828ea233278071737', build: 'd3ba0ec6dccc5eac' }
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const launcher = args => {
  const result = spawnSync(join(INSTALL, 'runtime/bin/node'), [join(INSTALL, 'personal-preview-launcher.mjs'), ...args],
    { cwd: INSTALL, env: { ...process.env, HOME: process.env.HOME, PA_MODEL_CONFIG: MODEL }, encoding: 'utf8', timeout: 60_000 })
  let json; try { json = JSON.parse(result.stdout.trim()) } catch { json = undefined }
  return { status: result.status, json }
}
const db = () => new DatabaseSync(STATE_DB, { readOnly: true })
const query = (sql, params = []) => { const value = db(); try { return value.prepare(sql).all(...params) } finally { value.close() } }
const lit = value => JSON.parse(value)
const ticketFor = workId => query("select id, value from ticket where json_extract(value,'$.mandate.basis.scope.contract.workId')=? order by rowid desc limit 1", [workId])[0] ?? null

async function createWork(page, goal) {
  await page.getByRole('button', { name: '新建委托', exact: true }).click()
  const form = page.getByRole('form', { name: '新建委托', exact: true })
  await form.waitFor()
  const options = await form.getByRole('combobox', { name: '项目', exact: true }).locator('option').evaluateAll(els => els.map(e => [e.value, e.textContent]))
  const project = options.find(([, text]) => text === PROJECT_NAME)
  if (!project) throw new Error(`project option missing: ${JSON.stringify(options)}`)
  await form.getByRole('combobox', { name: '项目', exact: true }).selectOption(project[0])
  const profile = form.getByRole('combobox', { name: '开发执行器', exact: true })
  if (await profile.count() > 0) {
    const values = await profile.locator('option').evaluateAll(els => els.map(e => [e.value, e.textContent]))
    const native = values.find(([value]) => /codex/iu.test(String(value))) ?? values.find(([, text]) => /codex/iu.test(String(text)))
    if (!native) throw new Error(`native profile missing: ${JSON.stringify(values)}`)
    await profile.selectOption(native[0])
  }
  await page.locator('.new-work textarea').fill(goal)
  const command = page.waitForResponse(response => response.url().endsWith('/v1/commands') && response.request().method() === 'POST', { timeout: 120_000 })
  await form.getByRole('button', { name: '创建委托', exact: true }).click()
  const response = await command
  const body = await response.json().catch(() => null)
  return { status: response.status(), body, receipt: body?.receipt ?? body ?? null }
}

async function openWork(page, goal) {
  const cards = page.locator('.work-card')
  let total = 0
  for (let attempt = 0; attempt < 30 && total === 0; attempt += 1) {
    total = await cards.count()
    if (total === 0) await page.waitForTimeout(1_000)
  }
  for (let index = 0; index < total; index += 1) {
    const card = cards.nth(index)
    const text = await card.innerText().catch(() => '')
    if (!text.includes(goal.slice(0, 24))) continue
    await card.click()
    await page.waitForTimeout(700)
    const detail = await page.locator('.detail').innerText().catch(() => '')
    if (detail.includes(PROJECT) || detail.includes(PROJECT.replace('/tmp/', '/private/tmp/'))) return index
  }
  throw new Error(`control Work card not found (cards=${total})`)
}

async function answerQuestion(page) {
  await page.waitForTimeout(1_000)
  const detail = await page.locator('.detail').innerText().catch(() => page.locator('body').innerText())
  const choices = [
    page.getByRole('button', { name: '拒绝', exact: true }),
    page.getByRole('button', { name: '取消执行', exact: true }),
    page.getByRole('button', { name: '仅本次允许', exact: true }),
  ]
  for (const choice of choices) {
    if (await choice.count() > 0 && await choice.first().isEnabled()) {
      await choice.first().click()
      await page.waitForTimeout(1_500)
      return { answered: true, mode: 'choice', label: (await choice.first().innerText().catch(() => '')) || 'choice', detail }
    }
  }
  const form = page.locator('form.answer-form').first()
  if (await form.count() > 0) {
    const textarea = form.locator('textarea').first()
    if (await textarea.count() > 0) await textarea.fill('拒绝执行沙箱外命令；请运行 sleep 60 等待我补充要求。')
    else {
      const input = form.locator('input[type=text]').first()
      if (await input.count() > 0) await input.fill('拒绝执行沙箱外命令；请运行 sleep 60 等待我补充要求。')
      const select = form.locator('select').first()
      if (await select.count() > 0) await select.selectOption({ index: 1 }).catch(() => {})
    }
    await form.locator('button[type=submit]').first().click()
    await page.waitForTimeout(1_500)
    return { answered: true, mode: 'form', detail }
  }
  return { answered: false, mode: 'none', detail }
}

async function sendSupplement(page, text) {
  const composer = page.locator('#composer-input')
  await composer.waitFor({ timeout: 20_000 })
  const placeholder = await composer.getAttribute('placeholder')
  if (!String(placeholder ?? '').includes('补充当前工作的要求')) return { sent: false, placeholder, reason: 'composer_not_in_supplement_mode' }
  await composer.fill(text)
  await composer.press('Meta+Enter')
  await page.waitForTimeout(2_000)
  return { sent: true, placeholder }
}

function processTree(rootPid) {
  const result = spawnSync('ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8' })
  const rows = result.stdout.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    const match = line.match(/^(\d+)\s+(\d+)\s+(.*)$/u)
    return match ? { pid: Number(match[1]), ppid: Number(match[2]), command: match[3] } : null
  }).filter(Boolean)
  const seen = new Set([rootPid]), out = []
  let added = true
  while (added) {
    added = false
    for (const row of rows) if (seen.has(row.ppid) && !seen.has(row.pid)) { seen.add(row.pid); out.push(row); added = true }
  }
  return out
}

const commands = {
  async preflight() {
    const zip = readFileSync(PKG.zip)
    const status = launcher(['status'])
    const doctor = launcher(['doctor'])
    const codex = doctor.json?.checks?.find(check => check.id === 'executor_codex')
    const open = query("select id, work_id, validity from user_questions where validity='open'")
    const projects = query('select project_id, display_name, check_kind from project_settings_versions order by rowid desc')
    const result = { package: { outer: sha(zip), matches: sha(zip) === PKG.outer },
      status: status.json?.status, instance: status.json?.instance, executor: codex ? { status: codex.status,
        available: codex.detail?.available, authPresent: codex.detail?.authPresent, version: codex.detail?.version } : null,
      openQuestions: open.length, project: projects.find(item => item.display_name === PROJECT_NAME) ?? null,
      controlLedgerExists: existsSync(CONTROL_LEDGER), priorEvidenceExists: existsSync(PRIOR_EVIDENCE) }
    console.log(JSON.stringify(result, null, 1))
    if (!result.package.matches || result.status !== 'RUNNING' || !result.project) process.exitCode = 1
  },
  async cleanup() {
    const prior = JSON.parse(readFileSync(EVIDENCE, 'utf8'))
    const goal = prior.goal
    const workId = prior.created?.workId
    if (!workId) throw new Error('control evidence has no workId')
    const status = launcher(['status'])
    if (status.json?.status !== 'RUNNING') throw new Error('own instance is not RUNNING')
    const instance = status.json.instance
    const ticket = ticketFor(workId)
    const ticketValue = ticket ? lit(ticket.value) : null
    const attemptRow = ticket ? query('select attempt_id from runtime_current where ticket_id=?', [ticket.id])[0] ?? null : null
    const beforeBinding = attemptRow ? query('select attempt_id, state from runtime_bindings where attempt_id=?', [attemptRow.attempt_id])[0] ?? null : null
    const beforePids = processTree(instance.pid)
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1100 } })
    const evidence = { ...prior, reconciledAt: new Date().toISOString(), actualAttempt: {
      ticketId: ticket?.id ?? null, assignmentState: ticketValue?.assignments?.[0]?.state ?? null,
      report: ticketValue?.assignments?.[0]?.report ?? null, attemptId: beforeBinding?.attempt_id ?? null,
      bindingBefore: beforeBinding?.state ?? null,
      begun: ticketValue?.assignments?.[0]?.startedAt ?? null,
      turnEnded: false, dispatch: query('select * from dispatch_receipts where target=? order by updated_at', [beforeBinding?.attempt_id ?? '']),
      questions: query('select id, validity from user_questions where work_id=?', [workId]),
      steerReceipts: query("select * from dispatch_receipts where target=? and command_id like '%deliver%'", [beforeBinding?.attempt_id ?? '']),
    }}
    try {
      const page = browser.page
      await page.goto(instance.consoleURL, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
      await openWork(page, goal)
      const beforeDetail = await page.locator('.detail').innerText().catch(() => '')
      await page.screenshot({ path: join(PRIVATE, 'm03-control-terminal-before-stop.png'), fullPage: true })
      const stop = page.getByRole('button', { name: '停止工作', exact: true })
      const enabled = await stop.count() > 0 && await stop.isEnabled()
      if (enabled) {
        await stop.click()
        await page.waitForTimeout(1_000)
        const confirm = page.getByRole('button', { name: /确认停止|确认/u }).first()
        if (await confirm.count() > 0) await confirm.click()
      }
      let ended = null
      for (let attempt = 0; attempt < 90 && !ended; attempt += 1) {
        await page.waitForTimeout(1_000)
        if (!ticket) break
        ended = query("select json_extract(value,'$.ended') ended from ticket where id=?", [ticket.id])[0] ?? null
      }
      let afterPids = []
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await page.waitForTimeout(1_000)
        afterPids = processTree(instance.pid)
        const live = afterPids.filter(pid => !beforePids.some(before => before.pid === pid.pid))
        const state = beforeBinding ? query('select state from runtime_bindings where attempt_id=?', [beforeBinding.attempt_id])[0]?.state : 'ended'
        if (live.length === 0 && state === 'ended') break
      }
      const afterBinding = beforeBinding ? query('select attempt_id, state from runtime_bindings where attempt_id=?', [beforeBinding.attempt_id])[0] ?? null : null
      const afterDetail = await page.locator('.detail').innerText().catch(() => '')
      await page.screenshot({ path: join(PRIVATE, 'm03-control-terminal-stopped.png'), fullPage: true })
      const newPids = afterPids.filter(pid => !beforePids.some(before => before.pid === pid.pid))
      const journalPath = beforeBinding ? join(instance.state, 'runners', beforeBinding.attempt_id, 'critical.journal') : null
      const journal = journalPath && existsSync(journalPath) ? readFileSync(journalPath, 'utf8') : ''
      evidence.actualAttempt.turnEnded = /"kind":"turn.ended"/u.test(journal)
      evidence.actualAttempt.turnEndedInUI = /验证详情|当前候选产物/u.test(beforeDetail)
      evidence.stop = { terminalCleanupOnly: true, buttonPresent: await stop.count() > 0, enabledBeforeClick: enabled,
        ended: ended ? lit(ended.ended) : null, bindingBefore: beforeBinding?.state ?? null,
        bindingAfter: afterBinding?.state ?? null, beforeDetail: beforeDetail.slice(-800), afterDetail: afterDetail.slice(-800) }
      evidence.resources = { beforePids: beforePids.map(row => ({ pid: row.pid, command: row.command.slice(0, 160) })),
        afterPids: afterPids.map(row => ({ pid: row.pid, command: row.command.slice(0, 160) })),
        survivingNew: newPids, runtimeCurrent: query('select * from runtime_current'), bindings: query('select attempt_id, state from runtime_bindings order by rowid desc limit 8') }
      evidence.result = { ok: false, question: evidence.actualAttempt.questions.length > 0,
        answer: false, steer: evidence.actualAttempt.steerReceipts.length > 0,
        runningStop: false, terminalCleanupStopped: evidence.stop.ended?.outcome === 'stopped',
        bindingEnded: afterBinding?.state === 'ended', noSurvivingNewProcess: newPids.length === 0,
        reason: 'native turn completed without surfacing an original question; no running steer/stop window remained' }
    } finally {
      await browser.close().catch(() => {})
      mkdirSync(join(PRIVATE, 'evidence'), { recursive: true, mode: 0o700 })
      writeFileSync(join(PRIVATE, 'evidence/m03-control.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
      writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
      console.log(JSON.stringify({ result: evidence.result, actualAttempt: { ticketId: evidence.actualAttempt.ticketId,
        attemptId: evidence.actualAttempt.attemptId, questions: evidence.actualAttempt.questions,
        steer: evidence.actualAttempt.steerReceipts.length, dispatch: evidence.actualAttempt.dispatch.length },
        stop: evidence.stop, surviving: evidence.resources?.survivingNew?.length }, null, 1))
    }
  },
  async run() {
    mkdirSync(PRIVATE, { recursive: true, mode: 0o700 })
    if (existsSync(CONTROL_LEDGER)) throw new Error(`control send already recorded: ${CONTROL_LEDGER}`)
    if (existsSync(EVIDENCE)) throw new Error('the milestone-03 control attempt is already recorded; refusing any resend at 4/4')
    const prior = JSON.parse(readFileSync(PRIOR_EVIDENCE, 'utf8'))
    const priorUsed = prior.ledger?.used ?? 0
    if (priorUsed >= 4) throw new Error(`milestone cap already reached: ${priorUsed}/4`)
    const zip = readFileSync(PKG.zip)
    if (sha(zip) !== PKG.outer) throw new Error('package identity mismatch')
    const status = launcher(['status'])
    if (status.json?.status !== 'RUNNING') throw new Error('own instance is not RUNNING; run the packaged Start first')
    const instance = status.json.instance
    const goal = [
      '这是短控制链验证，不要修改源码、测试或配置文件，不要新建 Work。',
      '在运行任何命令之前，必须先通过用户提问工具向我提出一个确认问题，询问是否允许运行沙箱外的探针命令 `touch /tmp/m03-control-approval`，并停下来等待我在问题中心回答；不得自行假定允许或绕过提问。',
      '如果你没有可用的用户提问工具，就直接运行 `touch /tmp/m03-control-approval`，让沙箱审批请求上浮并等待回答。',
      '收到回答（允许或拒绝）后，立即运行 `sleep 60`。',
      '然后运行 `node --test` 并简要报告结果。',
    ].join('\n')
    writeFileSync(CONTROL_LEDGER, `${JSON.stringify({ kind: 'reserved', id: 'm03-control-v4', priorUsed, at: new Date().toISOString() })}\n`, { mode: 0o600 })
    const beforePids = processTree(instance.pid)
    const bindingsBefore = query('select attempt_id, state from runtime_bindings order by rowid desc limit 10')
    const browser = await openBrowser({ root: ROOT, viewport: { width: 1440, height: 1100 } })
    const evidence = { at: new Date().toISOString(), package: { outer: sha(zip), source: PKG.source, build: PKG.build },
      instance: { pid: instance.pid, consoleURL: instance.consoleURL, apiURL: instance.apiURL, state: instance.state },
      goal, priorUsed, question: null, answer: null, supplement: null, stop: null, resources: null, commands: null }
    try {
      const page = browser.page
      await page.goto(instance.consoleURL, { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: '主对话视图', exact: true }).waitFor()
      const created = await createWork(page, goal)
      const workId = created.receipt?.workId ?? null
      evidence.created = { status: created.status, workId, receipt: created.receipt }
      if (!workId) {
        writeFileSync(CONTROL_LEDGER, `${JSON.stringify({ kind: 'unknown', id: 'm03-control-v4', reason: 'create_receipt_missing', at: new Date().toISOString() })}\n`, { flag: 'a', mode: 0o600 })
        throw new Error('create returned no workId; recorded UNKNOWN, refusing resend')
      }
      // Only an actual attempt start counts as sent.
      let started = false, blocked = false, ticket = null
      for (let attempt = 0; attempt < 90 && !started && !blocked; attempt += 1) {
        await page.waitForTimeout(1_000)
        ticket = ticketFor(workId)
        started = ticket ? lit(ticket.value).assignments?.[0]?.state === 'running' : false
        if (!started && attempt % 5 === 0) {
          await openWork(page, goal).catch(() => {})
          const detail = await page.locator('.detail').innerText().catch(() => '')
          if (/依赖环境[\s\S]{0,80}(准备受阻|未获确认)/u.test(detail)) blocked = true
        }
      }
      writeFileSync(CONTROL_LEDGER, `${JSON.stringify({ kind: started ? 'sent' : blocked ? 'cancelled' : 'unknown', id: 'm03-control-v4',
        reason: started ? null : blocked ? 'environment_preparation_blocked_unsent' : 'attempt_start_not_observed', at: new Date().toISOString() })}\n`, { flag: 'a', mode: 0o600 })
      if (!started) throw new Error(blocked ? 'environment preparation blocked before native start; reservation cancelled' : 'native attempt start was not observed; recorded UNKNOWN')
      ticket = ticketFor(workId)
      await openWork(page, goal)
      // Wait for an open original question, then answer it through the UI.
      let questionRow = null
      for (let attempt = 0; attempt < 120 && !questionRow; attempt += 1) {
        await page.waitForTimeout(1_000)
        questionRow = query("select * from user_questions where work_id=? and validity='open' order by opened_at desc limit 1", [workId])[0] ?? null
        if (!questionRow) {
          const failure = await page.locator('.detail').innerText().catch(() => '')
          if (/验证失败|执行失败|无法完成|已交付/u.test(failure)) break
        }
      }
      if (questionRow) {
        evidence.question = { id: questionRow.id, version: questionRow.version, validity: questionRow.validity,
          openedAt: questionRow.opened_at, value: lit(questionRow.value) }
        await openWork(page, goal).catch(() => {})
        await page.locator('.question-card').first().waitFor({ timeout: 20_000 }).catch(() => {})
        await page.screenshot({ path: join(PRIVATE, 'm03-control-question.png'), fullPage: true })
        const answered = await answerQuestion(page)
        evidence.answer = answered
        const answerRow = query('select * from answers where question_id=? order by recorded_at desc limit 1', [questionRow.id])[0] ?? null
        evidence.answerRecord = answerRow ? { answerId: answerRow.answer_id, questionId: answerRow.question_id,
          version: answerRow.expected_version, digest: answerRow.answer_digest, answer: lit(answerRow.answer), recordedAt: answerRow.recorded_at } : null
      }
      // Same running Work supplement: the composer turns into "补充当前工作的要求…" for the active Work.
      const supplementText = '补充要求（同一 Work，运行中）：不要执行任何沙箱外命令；在项目根目录写入 control-probe.txt，内容为 supplemented，然后继续 sleep 60 等待我停止。不要新建 Work。'
      evidence.supplement = await sendSupplement(page, supplementText)
      evidence.supplement.text = supplementText
      await page.screenshot({ path: join(PRIVATE, 'm03-control-supplement.png'), fullPage: true })
      // Wait briefly for the native steer to be accepted before stopping.
      let steer = null
      for (let attempt = 0; attempt < 40 && !steer; attempt += 1) {
        await page.waitForTimeout(1_000)
        steer = query("select * from event_log where payload like '%steer%' and (entity_ref=? or payload like ?) order by seq desc limit 1", [ticket?.id ?? '', `%${ticket?.id ?? workId}%`])[0] ?? null
      }
      const steerReceipt = runningBinding ? query("select * from dispatch_receipts where target=? and command_id like '%deliver%' order by updated_at desc limit 1", [runningBinding.attempt_id])[0] ?? null : null
      const beginReceipts = runningBinding ? query("select * from dispatch_receipts where target=? and command_id like '%begin%'", [runningBinding.attempt_id]) : []
      evidence.supplement.steer = steerReceipt ? { commandId: steerReceipt.command_id, target: steerReceipt.target,
        delivery: steerReceipt.delivery, updatedAt: steerReceipt.updated_at, beginReceipts: beginReceipts.length,
        event: steer ? { seq: steer.seq, topic: steer.topic, payload: lit(steer.payload) } : null } : null
      const runningCurrent = query('select * from runtime_current where ticket_id=?', [ticket?.id ?? ''])
      const runningBinding = runningCurrent[0] ? query('select attempt_id, state from runtime_bindings where attempt_id=?', [runningCurrent[0].attempt_id])[0] ?? null : null
      // Explicit stop while the turn is still running.
      const stopButton = page.getByRole('button', { name: '停止工作', exact: true })
      const stopEnabled = await stopButton.count() > 0 && await stopButton.isEnabled()
      evidence.stop = { buttonPresent: await stopButton.count() > 0, enabledBeforeClick: stopEnabled }
      if (stopEnabled) {
        await stopButton.click()
        await page.waitForTimeout(1_000)
        const confirm = page.getByRole('button', { name: /确认停止|确认/u }).first()
        if (await confirm.count() > 0) { await confirm.click(); evidence.stop.confirmed = true }
      }
      // Product end + physical resource return.
      let ended = null
      for (let attempt = 0; attempt < 90 && !ended; attempt += 1) {
        await page.waitForTimeout(1_000)
        ended = query("select json_extract(value,'$.ended') ended from ticket where id=?", [ticket?.id ?? ''])[0] ?? null
      }
      let afterPids = []
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await page.waitForTimeout(1_000)
        afterPids = processTree(instance.pid)
        const live = afterPids.filter(pid => !beforePids.some(before => before.pid === pid.pid))
        const bound = runningCurrent[0]
          ? query('select attempt_id, state from runtime_bindings where attempt_id=?', [runningCurrent[0].attempt_id])[0]?.state
          : 'ended'
        if (live.length === 0 && bound === 'ended') break
      }
      const bindingsAfter = query('select attempt_id, state from runtime_bindings order by rowid desc limit 10')
      const attemptIds = bindingsAfter.map(row => row.attempt_id).filter(id => !bindingsBefore.some(before => before.attempt_id === id))
      const newBindings = bindingsAfter.filter(row => attemptIds.includes(row.attempt_id))
      const commandsRows = query('select command_id, status, seq, result, recorded_at from command_receipts order by seq desc limit 12')
      evidence.commands = commandsRows
      evidence.stop.ended = ended ? lit(ended.ended) : null
      evidence.stop.detail = (await page.locator('.detail').innerText().catch(() => '')).slice(-700)
      await page.screenshot({ path: join(PRIVATE, 'm03-control-stopped.png'), fullPage: true })
      const newPids = afterPids.filter(pid => !beforePids.some(before => before.pid === pid.pid))
      const bindingGone = runningCurrent.length > 0 && query('select attempt_id, state from runtime_bindings where attempt_id=?', [runningCurrent[0].attempt_id])[0]?.state === 'ended'
      evidence.resources = { beforePids: beforePids.map(row => ({ pid: row.pid, command: row.command.slice(0, 160) })),
        afterPids: afterPids.map(row => ({ pid: row.pid, command: row.command.slice(0, 160) })),
        survivingNew: newPids, newBindings, runningCurrent, bindingGone,
        occupancy: query('select * from runtime_current'), bindingsBefore, bindingsAfter }
      const ok = evidence.question !== null && (evidence.answerRecord !== null || evidence.answer?.answered === true) &&
        evidence.supplement.steer !== null && evidence.stop.ended?.outcome === 'stopped' &&
        newBindings.every(row => row.state === 'ended') && newPids.length === 0 && bindingGone &&
        (evidence.supplement.steer?.delivery === 'native_accepted') && (evidence.supplement.steer?.beginReceipts === 1)
      evidence.result = { ok, question: evidence.question !== null, answer: evidence.answerRecord !== null,
        steer: evidence.supplement.steer !== null, stopped: evidence.stop.ended?.outcome === 'stopped',
        bindingEnded: newBindings.every(row => row.state === 'ended'), occupancyReturned: bindingGone,
        steerNativeAccepted: evidence.supplement.steer?.delivery === 'native_accepted',
        sameBegin: evidence.supplement.steer?.beginReceipts === 1,
        noSurvivingNewProcess: newPids.length === 0 }
      if (!ok) process.exitCode = 1
    } finally {
      await browser.close().catch(() => {})
      mkdirSync(join(PRIVATE, 'evidence'), { recursive: true, mode: 0o700 })
      writeFileSync(join(PRIVATE, 'evidence/m03-control.json'), `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
      mkdirSync(join(EVIDENCE, '..'), { recursive: true, mode: 0o700 })
      writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
      console.log(JSON.stringify({ result: evidence.result, question: evidence.question?.id ?? null,
        answer: evidence.answerRecord?.answerId ?? null, steer: evidence.supplement?.steer?.seq ?? null,
        stop: evidence.stop, bindings: evidence.resources?.newBindings, surviving: evidence.resources?.survivingNew?.length,
        evidence: EVIDENCE }, null, 1))
    }
  },
}

const argv = process.argv.slice(2)
try {
  if (argv.includes('--preflight')) await commands.preflight()
  else if (argv.includes('--run')) await commands.run()
  else if (argv.includes('--cleanup')) await commands.cleanup()
  else { console.log('usage: --preflight | --run | --cleanup'); process.exitCode = 2 }
} catch (error) {
  console.error(`m03-control failed: ${String(error?.message ?? error).slice(0, 800)}`)
  process.exitCode = 1
}
