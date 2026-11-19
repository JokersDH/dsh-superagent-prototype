import assert from 'node:assert/strict'
import { fork, execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { randomBytes, randomUUID } from 'node:crypto'

const coordinatorEntry = fileURLToPath(new URL('./native-coordinator.mjs', import.meta.url))
const proxy = fileURLToPath(new URL('./codex-budget-proxy.mjs', import.meta.url))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export const grantRoot = process.env.PA_ACCEPTANCE_ROOT ?? mkdtempSync('/tmp/pa-milestone-closeout-')
mkdirSync(grantRoot, { recursive: true, mode: 0o700 })
const ledger = join(grantRoot, 'actual-sends.log')
if (!existsSync(ledger)) writeFileSync(ledger, '', { mode: 0o600 })
const lifecycle = join(grantRoot, 'lifecycle.log')
const log = value => appendFileSync(lifecycle, JSON.stringify({ at: new Date().toISOString(), ...value }) + '\n', { mode: 0o600 })
export const actualTurns = grant => readFileSync(ledger, 'utf8').split('\n').filter(line => line.split('\t')[1] === grant && line.split('\t')[3] === 'SENT_TURN').length
const observe = pid => execFileSync('ps', ['-ww', '-p', String(pid), '-o', 'lstart=,uid=,command='], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()

export function setup(taskId, grant, limit, check, collaboration = 'default') {
  const root = join(grantRoot, taskId)
  mkdirSync(root, { mode: 0o700 })
  mkdirSync(join(root, 'state'), { mode: 0o700 })
  mkdirSync(join(root, 'project', 'src'), { recursive: true })
  writeFileSync(join(root, 'project', 'src', 'base.txt'), 'original\n')
  const git = args => execFileSync('git', args, { cwd: join(root, 'project'), stdio: 'pipe' })
  git(['init', '-q']); git(['add', '.']); git(['-c', 'user.name=MilestoneProbe', '-c', 'user.email=probe@localhost', 'commit', '-qm', 'isolated baseline'])
  const config = { root, proxy, codex: execFileSync('which', ['codex'], { encoding: 'utf8' }).trim(), ledger, grant, limit, taskId,
    check, collaboration, token: randomBytes(32).toString('hex'), nonce: randomUUID() }
  writeFileSync(join(root, 'probe-config.json'), JSON.stringify(config), { mode: 0o600 })
  log({ kind: 'SETUP', root, grant, taskId, actualTurns: actualTurns(grant) })
  return { root, config, git }
}

export async function start(config) {
  const child = fork(coordinatorEntry, [config.root], { cwd: config.root, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  let stderr = '', ready
  child.stderr.on('data', value => { stderr = (stderr + value.toString()).slice(-4096) })
  child.stdout.on('data', () => {})
  const birth = await new Promise((resolve, reject) => {
    child.once('spawn', () => { try { resolve(observe(child.pid)) } catch (error) { reject(error) } })
    child.once('error', reject)
  })
  const messages = []
  child.on('message', message => messages.push(message))
  const waitFor = async (predicate, timeout = 20000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const index = messages.findIndex(predicate)
      if (index >= 0) return messages.splice(index, 1)[0]
      if (child.exitCode !== null || child.signalCode !== null) throw new Error('Own coordinator exited: ' + stderr)
      await pause(20)
    }
    throw new Error('Own coordinator IPC timeout: ' + stderr)
  }
  ready = await waitFor(value => value.type === 'ready')
  assert.equal(ready.pid, child.pid); assert.equal(ready.nonce, config.nonce); assert.equal(ready.root, config.root)
  assert.ok(!(ready.port >= 5180 && ready.port <= 5191) && !(ready.port >= 8796 && ready.port <= 8807))
  log({ kind: 'OWN_COORDINATOR', root: config.root, pid: child.pid, birth, port: ready.port })
  let serial = 0
  return {
    child, birth, port: ready.port,
    async inspect(workId) {
      const requestId = ++serial; child.send({ kind: 'inspect', workId, requestId })
      return waitFor(value => value.type === 'inspection' && value.requestId === requestId)
    },
    async command(value) {
      const response = await fetch('http://127.0.0.1:' + ready.port + '/v1/commands', { method: 'POST',
        headers: { authorization: 'Bearer ' + config.token, 'content-type': 'application/json' },
        body: JSON.stringify({ conversationId: 'probe', ...value }), signal: AbortSignal.timeout(15000) })
      const result = await response.json()
      assert.equal(response.status, 200, JSON.stringify(result)); return result
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return
      child.send({ kind: 'shutdown' }); await waitFor(value => value.type === 'closed', 20000)
      await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve) })
    },
    killRecoveryOwner() {
      assert.equal(child.exitCode, null); assert.equal(child.signalCode, null)
      assert.equal(observe(child.pid), birth, 'original private spawn birth/UID/full command must still match')
      const previous = existsSync(lifecycle) ? readFileSync(lifecycle, 'utf8') : ''
      assert.ok(!previous.includes('"kind":"SIGKILL_SENT"'), 'Only the one explicitly authorized recovery SIGKILL')
      assert.ok(child.kill('SIGKILL'))
      log({ kind: 'SIGKILL_SENT', root: config.root, pid: child.pid, birth })
    },
  }
}

export async function waitInspect(coordinator, workId, predicate, label, timeout = 180000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await coordinator.inspect(workId)
    if (predicate(last)) return last
    if (last.held || last.parked?.length) throw new Error(label + ' held: ' + JSON.stringify({ held: last.held, parked: last.parked }))
    await pause(100)
  }
  throw new Error(label + ' timeout: ' + JSON.stringify(last))
}

export async function create(coordinator, taskId, goal) {
  const result = await coordinator.command({ kind: 'create_work', commandId: taskId + '-create', projectId: 'isolated-project',
    profileId: 'probe-codex', goal, scope: { projectId: 'isolated-project', allowedPaths: ['.'], excludedPaths: ['.git'], externalActions: [] },
    criteria: [{ id: 'machine', kind: 'machine', required: true, description: 'The original registered check', checkDefinitionRef: 'probe-check' },
      { id: 'human', kind: 'human', required: true, description: 'Explicitly review the current isolated patch' }] })
  assert.equal(result.status, 'recorded', JSON.stringify(result)); return result.workId
}

export async function answerOpen(coordinator, snapshot, decision = 'accept') {
  for (const question of snapshot.view.questions.filter(value => value.validity === 'open')) {
    let answer
    if (question.kind === 'permission') {
      if (!question.presentation.options.some(value => value.id === decision)) throw new Error('Requested approval outside admitted options')
      answer = { kind: 'choices', optionIds: [decision] }
    } else if (question.kind === 'clarification' && question.presentation.kind === 'form') {
      answer = { kind: 'form', values: Object.fromEntries(question.presentation.fields.map(field => [field.id, field.kind === 'single' ? 'option-1' : 'BETA'])) }
    } else throw new Error('Unexpected native question requires explicit evaluation')
    const command = { kind: 'answer_question', commandId: 'answer-' + question.id + '-' + decision,
      questionId: question.id, expectedVersion: question.version, answer }
    const result = await coordinator.command(command)
    assert.equal(result.status, 'recorded', JSON.stringify(result))
    log({ kind: 'QUESTION_ANSWERED', workId: snapshot.view.works[0].work.id, questionId: question.id,
      targetId: question.targets[0].id, commandId: command.commandId, decision })
  }
}

export async function acceptDelivered(coordinator, workId) {
  const deadline = Date.now() + 180000
  let snapshot
  while (Date.now() < deadline) {
    snapshot = await coordinator.inspect(workId)
    if (snapshot.view.works[0].actions.available.includes('accept_candidate')) break
    await answerOpen(coordinator, snapshot)
    if (snapshot.held || snapshot.parked.length) throw new Error('Original native Work held: ' + JSON.stringify(snapshot.held ?? snapshot.parked))
    await pause(150)
  }
  const work = snapshot.view.works[0]
  assert.ok(work.actions.available.includes('accept_candidate'), 'No acceptable current candidate')
  const accepted = await coordinator.command({ kind: 'accept_candidate', commandId: 'accept-' + workId, candidate: work.actions.currentCandidate })
  assert.equal(accepted.status, 'recorded', JSON.stringify(accepted))
  const final = await coordinator.inspect(workId)
  assert.equal(final.view.works[0].phase, 'delivered'); assert.equal(final.binding.state, 'ended')
  assert.equal(final.beginCommands.length, 1, 'original begin was never replayed')
  return final
}

export async function recovery() {
  const { root, config } = setup('recovery-final', 'recovery-last-turn', 1,
    "if(require('node:fs').readFileSync('src/recovery.txt','utf8').trim()!=='recovered')process.exit(1)")
  let coordinator
  try {
    coordinator = await start(config)
    const workId = await create(coordinator, config.taskId,
      "First run node -e 'setTimeout(()=>{},7000)' as a short local delay. Then create src/recovery.txt containing exactly recovered and a newline. Do not modify src/base.txt or Git metadata. Do not commit, install, access networks or other projects. Finish after this small change.")
    const before = await waitInspect(coordinator, workId, value => value.binding?.state === 'active' &&
      value.observations.some(row => row.kind === 'dispatch.observed' && row.detail.delivery === 'native_accepted'), 'original actual turn accepted')
    assert.equal(actualTurns(config.grant), 1)
    const originalAttempt = before.binding.attemptId
    coordinator.killRecoveryOwner()
    const killed = await once(coordinator.child, 'exit'); assert.equal(killed[1], 'SIGKILL')
    coordinator = await start(config)
    const restored = await waitInspect(coordinator, workId, value => value.binding?.attemptId === originalAttempt &&
      value.binding.state === 'active', 'same original attempt reattached')
    assert.equal(restored.beginCommands.length, 1)
    const delivered = await acceptDelivered(coordinator, workId)
    assert.equal(delivered.binding.attemptId, originalAttempt); assert.equal(actualTurns(config.grant), 1)
    await coordinator.close()
    log({ kind: 'RECOVERY_PASS', root, workId, originalAttempt, beginCount: delivered.beginCommands.length,
      artifacts: delivered.view.works[0].artifactIds, actualTurns: actualTurns(config.grant) })
    return { status: 'PASS', root, workId, originalAttempt, actualTurns: actualTurns(config.grant), coordinatorSigkills: 1 }
  } catch (error) {
    log({ kind: 'RECOVERY_FAIL_OR_UNKNOWN', root, actualTurns: actualTurns(config.grant), error: String(error.stack ?? error) })
    if (coordinator?.child.connected) coordinator.child.disconnect()
    coordinator?.child.unref(); coordinator?.child.stdout.destroy(); coordinator?.child.stderr.destroy()
    return { status: 'FAIL_OR_UNKNOWN', root, actualTurns: actualTurns(config.grant), error: String(error.message) }
  }
}

if (process.argv.includes('--recovery')) {
  if (!process.argv.includes('--execute')) throw new Error('The real recovery experiment requires explicit --execute and an authorized actual-send budget')
  console.log(JSON.stringify(await recovery()))
}
