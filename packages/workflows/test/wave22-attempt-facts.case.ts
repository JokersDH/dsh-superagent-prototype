/** Wave-22 A1/A2/A4: real attempt facts through existing ports, with intent/observed/unknown separated. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '@personal-agent/storage'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'

const principal = { userId: 'wave22-facts-user', authorityRef: 'wave22-facts-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'wave22-facts-project', conversationId = 'wave22-facts-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'wave22-output', kind: 'machine' as const, required: true as const, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'wave22-human', kind: 'human' as const, required: true, description: 'Review output' },
]
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) {
    latest = await read(); if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`timed out: ${JSON.stringify(latest ?? null)}`)
}

test('existing stores read the same attempt intent, observation, result and unknown across reopen', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'wave22-facts-')), stateRoot = join(root, 'state'), project = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'facts fixture'])
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createControlledProduct({ store, principal, projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 96), stateRoot, scratchProject: project })
  let attemptId = '', questionId = '', answerId = ''
  let before: any
  try {
    product.start(); let seq = 0
    const command = (value: any) => product.application.dispatch({ commandId: `wave22-facts-${++seq}`, conversationId, ...value }, actor)
    const created = await command({ kind: 'create_work', projectId, goal: 'Wave-22 attempt facts', profileId: 'profile-fixture-question', scope, criteria })
    assert.equal(created.status, 'recorded')
    const view = await until(async () => product.application.inspect({}), value => value.questions.length === 1)
    const question = view.questions[0]!; questionId = question.id
    const target = question.targets[0]!
    attemptId = target.attemptId

    // Write-before intent and unknown are distinct existing dispatch states; a command receipt alone
    // is not native observation.
    assert.equal(store.dispatch.get('wave22-intent', 'wave22-target'), undefined)
    assert.deepEqual(store.dispatch.beginSend('wave22-intent', 'wave22-target'), { proceed: true, state: 'not_sent' })
    assert.equal(store.dispatch.get('wave22-intent', 'wave22-target')?.delivery, 'not_sent')
    store.dispatch.markWritten('wave22-intent', 'wave22-target')
    assert.equal(store.dispatch.get('wave22-intent', 'wave22-target')?.delivery, 'written')
    store.dispatch.markIndeterminate('wave22-intent', 'wave22-target', 'transport unknown')
    assert.equal(store.dispatch.get('wave22-intent', 'wave22-target')?.delivery, 'indeterminate')
    assert.equal(store.commands.get('wave22-intent'), undefined)
    assert.ok(store.commands.get('wave22-facts-1'))

    before = {
      binding: store.bindings.binding(attemptId),
      current: store.bindings.current(target.ticketId),
      question: store.product.questions.get(questionId),
      answers: store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').all(questionId),
      deliveries: store.answers.deliveries('wave22-answer'),
      observations: store.observations.forAttempt(attemptId),
      unknown: store.dispatch.get('wave22-intent', 'wave22-target'),
    }
    assert.equal(before.question.validity, 'open')
    assert.equal(before.answers.length, 0)
    assert.ok(before.observations.length > 0)
    const payload = await store.payloads.read(before.observations[0]!.payloadRef)
    assert.equal(payload.sha256, before.observations[0]!.payloadSha256)

    const answer = await command({ kind: 'answer_question', questionId, expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] } })
    assert.equal(answer.status, 'recorded')
    await until(async () => product.application.questions.currentDeliveries(questionId), value => value[0]?.status === 'native_applied')
    answerId = (store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(questionId) as { answer_id: string }).answer_id
    assert.equal(store.answers.deliveries(answerId)[0]?.status, 'native_applied')
    assert.equal(store.product.questions.get(questionId)?.validity, 'answered')
  } finally { await product.close(); store.close() }
  const reopened = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  try {
    const reopenedBinding = reopened.bindings.binding<any>(attemptId)
    assert.equal(reopenedBinding.attemptId, before.binding.attemptId)
    assert.equal(reopenedBinding.ticketId, before.binding.ticketId)
    assert.equal(reopenedBinding.assignmentId, before.binding.assignmentId)
    assert.equal(reopenedBinding.fenceEpoch, before.binding.fenceEpoch)
    assert.deepEqual(reopenedBinding.contract, before.binding.contract)
    assert.ok(['active', 'stopping', 'ended'].includes(reopenedBinding.state))
    assert.equal(reopened.bindings.current<any>(before.binding.ticketId)?.attemptId, attemptId)
    assert.equal(reopened.product.questions.get(questionId)?.validity, 'answered')
    assert.equal(reopened.answers.get(answerId)?.questionId, questionId)
    assert.equal(reopened.answers.deliveries(answerId)[0]?.status, 'native_applied')
    assert.deepEqual(reopened.dispatch.get('wave22-intent', 'wave22-target')?.delivery, 'indeterminate')
    const reopenedFacts = reopened.observations.forAttempt(attemptId).map(row => row.factId)
    assert.deepEqual(reopenedFacts.slice(0, before.observations.length), before.observations.map((row: any) => row.factId))
    assert.ok(reopenedFacts.length >= before.observations.length)
    assert.equal(reopened.workflows.recoverySource.inspect().coverage, 'complete')
  } finally { reopened.close(); rmSync(root, { recursive: true, force: true }) }
})
