import assert from 'node:assert/strict'
import { test } from 'node:test'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { key } from '../../packages/orchestrator-core/dist/index.js'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
import { createLocalHttpApp } from '../../apps/coordinator/http/app.ts'

const principal = { userId: 'local-product-user', authorityRef: 'local-product-authority' }
const actor = { ...principal, source: 'local_cli' }
const scope = { projectId: 'project-scratch', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  {
    id: 'criterion-output',
    kind: 'machine',
    required: true,
    description: 'Fixed output matches',
    checkDefinitionRef: FIXTURE_CHECK,
  },
]
async function until(read, predicate, timeout = 7000) {
  const deadline = Date.now() + timeout
  let latest
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error(`Product condition timed out: ${JSON.stringify(latest)}`)
}
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pa-product-test-'))
  const stateRoot = join(root, 'state'),
    scratchProject = join(root, 'project')
  mkdirSync(stateRoot)
  mkdirSync(scratchProject)
  const git = (args) => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
  git(['init', '-q'])
  mkdirSync(join(scratchProject, 'src'))
  writeFileSync(join(scratchProject, 'src', '.gitkeep'), '')
  git(['add', 'src/.gitkeep'])
  git([
    '-c',
    'user.name=Product Fixture',
    '-c',
    'user.email=fixture@localhost',
    'commit',
    '-qm',
    'Fixed scratch fixture base',
  ])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const options = {
    store,
    principal,
    projects: [{ id: scope.projectId, scope }],
    actionSecret: Buffer.alloc(32, 1),
    stateRoot,
    scratchProject,
  }
  let product = createControlledProduct(options)
  let seq = 0
  const command = (value) =>
    product.application.dispatch(
      { commandId: `product-command-${++seq}`, conversationId: 'conversation-product', ...value },
      actor,
    )
  const view = async (workId) => (await product.application.inspect({ ...(workId ? { workId } : {}) })).works[0]
  t.after(async () => {
    await product.close()
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  return {
    root,
    stateRoot,
    scratchProject,
    store,
    command,
    view,
    get product() {
      return product
    },
    create: (mode = 'question', human = true) =>
      command({
        kind: 'create_work',
        projectId: scope.projectId,
        goal: 'Produce the controlled scratch artifact',
        profileId: `profile-fixture-${mode}`,
        scope,
        criteria: [
          ...criteria,
          ...(human
            ? [{ id: 'criterion-human', kind: 'human', required: true, description: 'Review generated patch' }]
            : []),
        ],
      }),
    frames: () => {
      try {
        return readdirSync(join(stateRoot, 'receipts')).flatMap((file) =>
          readFileSync(join(stateRoot, 'receipts', file), 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line)),
        )
      } catch {
        return []
      }
    },
    reopen: async () => {
      await product.close()
      product = createControlledProduct(options)
      product.start()
    },
  }
}

test(
  'product executes a real child, routes its original question and verifies a human-accepted artifact',
  { timeout: 20000 },
  async (t) => {
    const h = fixture(t)
    h.product.start()
    const created = await h.create()
    assert.equal(created.status, 'recorded')
    const snapshot = await until(
      async () => ({
        ...(await h.product.application.inspect({})),
        queue: h.store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10),
        parked: h.store.queue.parked('application.execute'),
      }),
      (value) => value.questions.length === 1,
    )
    const question = snapshot.questions[0]
    assert.deepEqual(question.targets[0].nativeRequestId, { kind: 'integer', decimal: '9223372036854775807' })
    const answer = await h.command({
      kind: 'answer_question',
      questionId: question.id,
      expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] },
    })
    assert.equal(answer.status, 'recorded')
    const ready = (
      await until(
        async () => ({
          view: await h.view(created.workId),
          recovery: h.store.queue.dueRows('runtime.reconcile', Number.MAX_SAFE_INTEGER, 10),
          verify: h.store.queue.dueRows('application.verify', Number.MAX_SAFE_INTEGER, 10),
          failures: h.store.events
            .after(0)
            .filter((event) => event.topic === 'application.execution.held')
            .map((event) => h.store.commands.get(key('product-runtime-failure', event.payload.attemptId))),
          frames: h.frames(),
        }),
        (value) => value.view?.actions.available.includes('accept_candidate'),
      )
    ).view
    assert.equal(ready.resourceStatus, 'quiescent')
    assert.equal(ready.artifactIds.length, 4)
    const deliveries = h.product.application.questions.currentDeliveries(question.id)
    assert.equal(deliveries[0].status, 'native_applied')
    const accepted = await h.command({ kind: 'accept_candidate', candidate: ready.actions.currentCandidate })
    assert.equal(accepted.status, 'recorded', JSON.stringify(accepted))
    const delivered = await h.view(created.workId)
    assert.equal(delivered.phase, 'delivered')
    assert.deepEqual(delivered.artifactIds, ready.artifactIds)
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 1)
    assert.equal(h.frames().filter((frame) => frame.type === 'answer').length, 1)
    assert.equal(h.frames().filter((frame) => frame.type === 'deliver').length, 0)
    assert.ok((await h.product.read.artifact(ready.artifactIds[1])).body)
    assert.equal(await h.product.read.artifact('0'.repeat(64)), undefined)
  },
)

test(
  'required machine FAIL stays visible and cannot be overridden by human acceptance',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.product.start()
    const created = await h.create('fail')
    const ready = await until(
      () => h.view(created.workId),
      (value) => !!value?.actions.currentVerificationId,
    )
    const verification = await h.product.read.verification(ready.actions.currentVerificationId)
    assert.equal(verification.results[0].outcome, 'FAIL')
    assert.equal(ready.actions.available.includes('accept_candidate'), false)
    const accepted = await h.command({ kind: 'accept_candidate', candidate: ready.actions.currentCandidate })
    assert.equal(accepted.status, 'rejected')
    assert.equal(accepted.error.code, 'verification_failed')
    assert.notEqual((await h.view(created.workId)).phase, 'delivered')
  },
)

test('a machine-only contract completes without creating empty human acceptance', { timeout: 15000 }, async (t) => {
  const h = fixture(t)
  h.product.start()
  const created = await h.create('pass', false)
  const ready = await until(
    () => h.view(created.workId),
    (value) => value?.actions.available.includes('accept_candidate'),
  )
  assert.equal(
    (await h.command({ kind: 'accept_candidate', candidate: ready.actions.currentCandidate })).status,
    'recorded',
  )
  const ticket = h.store.domain.tickets.get(ready.actions.currentCandidate.ticketId)
  assert.equal(ticket.ended.outcome, 'completed')
  assert.equal(ticket.completion.confirmed.proposal.humanAcceptanceRef, undefined)
})

test(
  'pause holds queued execution and resume launches once; effect replay cannot begin twice',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    const created = await h.create('pass')
    const queued = await h.view(created.workId)
    const expected = queued.actions.currentAssignment.contract
    assert.equal((await h.command({ kind: 'pause_dispatch', expected, expectedHoldRevision: 0 })).status, 'recorded')
    h.product.start()
    await h.product.execution.effects.idle('application.execute')
    assert.equal(h.frames().length, 0)
    assert.equal((await h.command({ kind: 'resume_dispatch', expected, expectedHoldRevision: 1 })).status, 'recorded')
    const ready = await until(
      () => h.view(created.workId),
      (value) => !!value?.actions.currentVerificationId,
    )
    const intent = { kind: 'start', ...queued.actions.currentAssignment }
    h.store.queue.enqueue(
      'application.execute',
      key('start', intent.assignmentId),
      JSON.stringify(intent),
      h.store.queue.maxSeq() + 1,
      0,
      new Date().toISOString(),
    )
    await h.product.execution.effects.idle('application.execute')
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 1)
    assert.deepEqual((await h.view(created.workId)).actions.currentCandidate, ready.actions.currentCandidate)
  },
)

test(
  'pause during asynchronous host registration retains the same unfed begin until resume',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    const created = await h.create('pass')
    const queued = await h.view(created.workId)
    const expected = queued.actions.currentAssignment.contract
    const append = h.store.events.append.bind(h.store.events)
    h.store.events.append = (event) => {
      const seq = append(event)
      if (event.topic === 'runtime.runner.registered')
        queueMicrotask(() => {
          void h.command({ kind: 'pause_dispatch', expected, expectedHoldRevision: 0 })
        })
      return seq
    }
    h.product.start()
    await until(
      () => h.view(created.workId),
      (value) => value.actions.dispatchHold.paused && value.resourceStatus === 'active',
    )
    await h.product.execution.effects.idle('application.execute')
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 0)
    const firstAttempt = h.store.bindings.current(queued.actions.currentAssignment.ticketId).attemptId
    await h.command({ kind: 'resume_dispatch', expected, expectedHoldRevision: 1 })
    await until(
      () => h.view(created.workId),
      (value) => value.actions.available.includes('accept_candidate'),
    )
    assert.equal(h.store.bindings.current(queued.actions.currentAssignment.ticketId).attemptId, firstAttempt)
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 1)
  },
)

test(
  'stop obtains a physical barrier and an old native question cannot receive a late answer',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.product.start()
    const created = await h.create()
    const snapshot = await until(
      () => h.product.application.inspect({}),
      (value) => value.questions.length === 1,
    )
    const question = snapshot.questions[0]
    assert.equal((await h.command({ kind: 'stop_work', workId: created.workId })).status, 'recorded')
    const stopped = await until(
      () => h.view(created.workId),
      (value) => value?.phase === 'ended' && value.resourceStatus === 'quiescent',
    )
    const late = await h.command({
      kind: 'answer_question',
      questionId: question.id,
      expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] },
    })
    assert.equal(late.status, 'rejected')
    assert.equal(
      h.frames().some((frame) => frame.type === 'answer'),
      false,
    )
    assert.equal(stopped.actions.available.includes('continue_work'), true)
    assert.equal((await h.product.application.inspect({})).questions.length, 0)
  },
)

test(
  'supplement reaches the current child once and its actual read clears core unread inputs',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.product.start()
    const created = await h.create()
    const snapshot = await until(
      () => h.product.application.inspect({}),
      (value) => value.questions.length === 1,
    )
    const question = snapshot.questions[0]
    assert.equal(
      (
        await h.command({
          kind: 'chat',
          projectId: scope.projectId,
          anchor: { workId: created.workId },
          text: 'Keep the fixed scratch output',
        })
      ).status,
      'recorded',
    )
    await until(
      () => h.frames(),
      (value) => value.some((frame) => frame.type === 'deliver'),
    )
    assert.equal(
      (
        await h.command({
          kind: 'answer_question',
          questionId: question.id,
          expectedVersion: question.version,
          answer: { kind: 'choices', optionIds: ['allow'] },
        })
      ).status,
      'recorded',
    )
    const ready = await until(
      () => h.view(created.workId),
      (value) => value.actions.available.includes('accept_candidate'),
    )
    const ticket = h.store.domain.tickets.get(ready.actions.currentAssignment.ticketId)
    assert.equal(ticket.undelivered.length, 0)
    assert.ok(ticket.inputs.filter((input) => input.kind === 'trigger').every((input) => input.readAt))
    assert.equal(h.frames().filter((frame) => frame.type === 'deliver').length, 1)
  },
)

test(
  'two attempts with identical native RPC IDs retain separate original answer targets',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.product.start()
    const a = await h.create(),
      b = await h.create()
    const snapshot = await until(
      () => h.product.application.inspect({}),
      (value) => value.questions.length === 2,
    )
    const first = snapshot.questions.find((question) => question.contract.workId === a.workId)
    const second = snapshot.questions.find((question) => question.contract.workId === b.workId)
    assert.deepEqual(first.targets[0].nativeRequestId, second.targets[0].nativeRequestId)
    assert.notEqual(first.targets[0].id, second.targets[0].id)
    await h.command({
      kind: 'answer_question',
      questionId: second.id,
      expectedVersion: second.version,
      answer: { kind: 'choices', optionIds: ['allow'] },
    })
    await until(
      () => h.view(b.workId),
      (value) => value.actions.available.includes('accept_candidate'),
    )
    assert.deepEqual((await h.view(a.workId)).openQuestionIds, [first.id])
    assert.equal(h.frames().filter((frame) => frame.type === 'answer').length, 1)
    assert.equal(h.product.application.questions.currentDeliveries(second.id)[0].targetBindingId, second.targets[0].id)
  },
)

test(
  'failed fact receipt rolls native question intake back with no phantom prompt or candidate',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.store.db.exec(
      "CREATE TRIGGER fail_question_fact BEFORE INSERT ON fact_receipts WHEN EXISTS(SELECT 1 FROM user_questions) BEGIN SELECT RAISE(ABORT, 'injected question receipt failure'); END",
    )
    h.product.start()
    const created = await h.create()
    await until(
      () => h.view(created.workId),
      (value) => h.frames().some((frame) => frame.type === 'begin') && value.resourceStatus === 'quiescent',
    )
    assert.equal(h.store.product.questions.listOpen().length, 0)
    assert.equal(
      h.store.events.after(0).some((event) => event.topic === 'application.question.opened'),
      false,
    )
    assert.equal((await h.view(created.workId)).actions.currentCandidate, undefined)
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 1)
  },
)

test(
  'real coordinator SIGKILL preserves an unknown writer and never replays begin on reopen',
  { timeout: 20000 },
  async (t) => {
    const h = fixture(t)
    const readyPath = join(h.root, 'crash-ready.json')
    const worker = spawn(
      process.execPath,
      [
        fileURLToPath(new URL('./product-execution-worker.mjs', import.meta.url)),
        h.stateRoot,
        h.scratchProject,
        readyPath,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    let stderr = ''
    worker.stderr.on('data', (bytes) => {
      stderr += bytes.toString()
    })
    t.after(() => {
      if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL')
    })
    await until(
      () => ({ ready: existsSync(readyPath), exited: worker.exitCode, stderr }),
      (value) => value.ready || value.exited !== null,
    )
    assert.equal(existsSync(readyPath), true, stderr)
    const original = JSON.parse(readFileSync(readyPath, 'utf8'))
    assert.match(original.recoveryRoot, /^\/tmp\/pa-run-[A-Za-z0-9]+$/)
    t.after(() => rmSync(original.recoveryRoot, { recursive: true, force: true }))
    const exited = once(worker, 'exit')
    worker.kill('SIGKILL')
    await exited
    h.product.start()
    const reopened = await h.view(original.workId)
    assert.equal(reopened.resourceStatus, 'indeterminate')
    assert.equal(reopened.phase, 'stopping')
    assert.equal(reopened.actions.available.includes('retry_assignment'), false)
    const beginIntent = { kind: 'start', ...original.assignment }
    h.store.queue.enqueue(
      'application.execute',
      key('start', original.assignment.assignmentId),
      JSON.stringify(beginIntent),
      h.store.queue.maxSeq() + 1,
      0,
      new Date().toISOString(),
    )
    await h.product.execution.effects.idle('application.execute')
    assert.equal(h.store.queue.parked('application.execute')[0].parkedReason.startsWith('start_unknown:'), true)
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 1)
    assert.equal((await h.view(original.workId)).actions.currentCandidate, undefined)
  },
)

test(
  'revise waits for the old physical barrier and routes the next question only to the new attempt',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.product.start()
    const created = await h.create()
    const old = await until(
      () => h.product.application.inspect({}),
      (value) => value.questions.length === 1,
    )
    const first = old.questions[0]
    const expected = old.works[0].actions.currentAssignment.contract
    const revised = await h.command({
      kind: 'revise_work',
      expected,
      goal: 'Revised controlled scratch artifact',
      scope,
      criteria,
    })
    assert.equal(revised.status, 'recorded')
    const next = await until(
      () => h.product.application.inspect({}),
      (value) => value.questions.some((question) => question.contract.revision === 2),
    )
    const second = next.questions.find((question) => question.contract.revision === 2)
    assert.notEqual(first.targets[0].attemptId, second.targets[0].attemptId)
    assert.equal(h.store.bindings.binding(first.targets[0].attemptId).state, 'ended')
    const late = await h.command({
      kind: 'answer_question',
      questionId: first.id,
      expectedVersion: first.version,
      answer: { kind: 'choices', optionIds: ['allow'] },
    })
    assert.equal(late.status, 'rejected')
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 2)
  },
)

test(
  'artifact mutation refuses acceptance and a successful command receipt survives reopen',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.product.start()
    const created = await h.create('pass')
    const ready = await until(
      () => h.view(created.workId),
      (value) => value?.actions.available.includes('accept_candidate'),
    )
    const binding = h.store.bindings.current(ready.actions.currentCandidate.ticketId)
    const file = join(h.product.workspaces.attemptPath(binding.attemptId), 'src/product-output.txt')
    writeFileSync(file, 'changed after verification\n')
    const refused = await h.command({ kind: 'accept_candidate', candidate: ready.actions.currentCandidate })
    assert.equal(refused.status, 'rejected')
    assert.equal(refused.error.code, 'verification_failed')
    writeFileSync(file, 'approved product output\n')
    const command = {
      commandId: 'accept-with-replay',
      conversationId: 'conversation-product',
      kind: 'accept_candidate',
      candidate: ready.actions.currentCandidate,
    }
    const accepted = await h.product.application.dispatch(command, actor)
    assert.equal(accepted.status, 'recorded')
    await h.reopen()
    assert.deepEqual(await h.product.application.dispatch(command, actor), accepted)
    assert.equal((await h.view(created.workId)).phase, 'delivered')
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 1)
  },
)

test(
  'committed verification intent survives reopen after the controlled host has ended',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.store.db.exec(
      "CREATE TRIGGER fail_verification_commit BEFORE INSERT ON completion_verifications BEGIN SELECT RAISE(ABORT, 'injected verification failure'); END",
    )
    h.product.start()
    const created = await h.create('pass')
    const pending = await until(
      async () => ({
        view: await h.view(created.workId),
        queue: h.store.queue.dueRows('application.verify', Number.MAX_SAFE_INTEGER, 10),
      }),
      (value) => value.view.resourceStatus === 'quiescent' && value.queue.some((row) => row.attempts > 0),
    )
    assert.ok(pending.view.actions.currentCandidate)
    assert.equal(pending.view.actions.currentVerificationId, undefined)
    h.store.db.exec('DROP TRIGGER fail_verification_commit')
    await h.reopen()
    const ready = await until(
      () => h.view(created.workId),
      (value) => value.actions.available.includes('accept_candidate'),
    )
    assert.deepEqual(ready.actions.currentCandidate, pending.view.actions.currentCandidate)
    assert.equal(h.frames().filter((frame) => frame.type === 'begin').length, 1)
    assert.equal(
      (await h.command({ kind: 'accept_candidate', candidate: ready.actions.currentCandidate })).status,
      'recorded',
    )
  },
)

test(
  'authenticated HTTP commands drive the actual child and expose only published artifacts',
  { timeout: 15000 },
  async (t) => {
    const h = fixture(t)
    h.product.start()
    const token = 'a'.repeat(64)
    const http = createLocalHttpApp({
      application: h.product.application,
      principal,
      apiToken: token,
      bootstrapToken: 'b'.repeat(64),
      allowedOrigins: ['http://127.0.0.1:5173'],
      mode: 'fixture',
      read: h.product.read,
    })
    const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' }
    const response = await http.request('http://127.0.0.1/v1/commands', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commandId: 'http-create',
        conversationId: 'conversation-product',
        kind: 'create_work',
        projectId: scope.projectId,
        goal: 'Fixed scratch from HTTP',
        profileId: 'profile-fixture-pass',
        scope,
        criteria,
      }),
    })
    assert.equal(response.status, 200)
    const created = await response.json()
    const ready = await until(
      () => h.view(created.workId),
      (value) => value?.actions.available.includes('accept_candidate'),
    )
    const verification = await http.request(
      `http://127.0.0.1/v1/verifications/${ready.actions.currentVerificationId}`,
      { headers },
    )
    assert.equal(verification.status, 200)
    assert.equal((await verification.json()).results[0].outcome, 'PASS')
    const artifact = await http.request(`http://127.0.0.1/v1/artifacts/${ready.artifactIds[2]}`, { headers })
    assert.equal(artifact.status, 200)
    assert.equal(await artifact.text(), 'approved product output\n')
    const denied = await http.request(`http://127.0.0.1/v1/artifacts/${ready.artifactIds[2]}`)
    assert.equal(denied.status, 401)
  },
)
