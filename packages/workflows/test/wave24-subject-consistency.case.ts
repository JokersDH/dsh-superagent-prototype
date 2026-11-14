/** Wave-24 A1/A3/A4: complete subject across two real Works, async payload guard and bounded manifests. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore } from '@personal-agent/storage'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { buildDataManifest, type DataSubjectExpectation } from '../src/index.ts'

const principal = { userId: 'wave24-subject-user', authorityRef: 'wave24-subject-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'wave24-subject-project', conversationId = 'wave24-subject-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'wave24-output', kind: 'machine' as const, required: true as const, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'wave24-human', kind: 'human' as const, required: true, description: 'Review output' },
]
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) { latest = await read(); if (predicate(latest)) return latest; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error(`timed out: ${JSON.stringify(latest ?? null)}`)
}

test('two real Works cannot be mixed and payload/source changes or limits reject', { timeout: 40000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'wave24-subject-')), stateRoot = join(root, 'state'), project = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'subject fixture'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createControlledProduct({ store, principal, projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 98), stateRoot, scratchProject: project })
  const works: { workId: string; ticketId: string; assignmentId: string; attemptId: string; fenceEpoch: number; contract: any; questionId: string; questionVersion: number; answerId: string; targetId: string; createCommand: string; answerCommand: string }[] = []
  try {
    product.start(); let seq = 0
    const command = (value: any) => product.application.dispatch({ commandId: `wave24-subject-${++seq}`, conversationId, ...value }, actor)
    for (const label of ['A', 'B']) {
      const createCommand = `wave24-subject-${seq + 1}`
      const created = await command({ kind: 'create_work', projectId, goal: `Wave-24 subject ${label}`, profileId: 'profile-fixture-question', scope, criteria })
      assert.equal(created.status, 'recorded')
      const view = await until(async () => product.application.inspect({}), value => value.questions.length === 1)
      const question = view.questions[0]!, target = question.targets[0]!
      const answerCommand = `wave24-subject-${seq + 1}`
      const answer = await command({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version,
        answer: { kind: 'choices', optionIds: ['allow'] } })
      assert.equal(answer.status, 'recorded')
      await until(async () => product.application.questions.currentDeliveries(question.id), value => value[0]?.status === 'native_applied')
      const answerId = (store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(question.id) as { answer_id: string }).answer_id
      works.push({ workId: created.workId!, ticketId: target.ticketId, assignmentId: target.assignmentId,
        attemptId: target.attemptId, fenceEpoch: target.fenceEpoch, contract: target.contract, questionId: question.id,
        questionVersion: question.version, answerId, targetId: target.id, createCommand, answerCommand })
    }
  } finally { await product.close() }
  store.dispatch.beginSend('wave24-window', 'wave24-target'); store.dispatch.markWritten('wave24-window', 'wave24-target')
  const [first, second] = works as [typeof works[0], typeof works[0]]
  const expectation = (value: typeof works[0]): DataSubjectExpectation => ({
    sourceSha: 'a'.repeat(40), snapshotFormat: 1, ticketId: value.ticketId, assignmentId: value.assignmentId,
    attemptId: value.attemptId, fenceEpoch: value.fenceEpoch, contract: value.contract,
    questionId: value.questionId, answerId: value.answerId,
    requiredCommandIds: [value.createCommand, value.answerCommand],
    requiredDispatch: [{ commandId: 'wave24-window', target: 'wave24-target' }],
    requiredDeliveryTargets: [value.targetId],
  })
  const valid = expectation(first)
  const manifest = await buildDataManifest(store, valid)
  assert.equal(manifest.counts.commands, 2)
  assert.equal(manifest.coverage.commands, 'complete')

  await assert.rejects(() => buildDataManifest(store, { ...valid, questionId: second.questionId, answerId: second.answerId }),
    /Question targets do not belong/)
  await assert.rejects(() => buildDataManifest(store, { ...valid, ticketId: second.ticketId, assignmentId: second.assignmentId }),
    /does not match the expected original subject/)
  await assert.rejects(() => buildDataManifest(store, { ...valid, requiredCommandIds: [first.createCommand, first.createCommand] }),
    /duplicate/)
  await assert.rejects(() => buildDataManifest(store, { ...valid, requiredCommandIds: ['missing-command'] }), /missing/)
  await assert.rejects(() => buildDataManifest(store, { ...valid, requiredDeliveryTargets: [second.targetId] }), /foreign/)
  await assert.rejects(() => buildDataManifest(store, { ...valid, requiredObservationFactIds: ['missing-fact'] }), /missing/)
  await assert.rejects(() => buildDataManifest(store, { ...valid, limits: { maxObservations: 2 } }), /Observation count exceeds/)
  await assert.rejects(() => buildDataManifest(store, { ...valid, limits: { maxPayloadBytes: 8 } }), /byte limit/)
  await assert.rejects(() => buildDataManifest(store, { ...valid, limits: { maxCommands: 1 } }), /Command count exceeds/)

  const originalRead = store.payloads.read.bind(store.payloads)
  let injected = false
  store.payloads.read = async ref => {
    const value = await originalRead(ref)
    if (!injected) {
      injected = true
      store.product.works.insert({ id: 'wave24-concurrent-work', projectId, conversationId, title: 'Concurrent change', createdAt: new Date().toISOString() })
    }
    return value
  }
  try { await assert.rejects(() => buildDataManifest(store, valid), /changed while payload bytes were read/) }
  finally { store.payloads.read = originalRead }
  store.close(); rmSync(root, { recursive: true, force: true })
})
