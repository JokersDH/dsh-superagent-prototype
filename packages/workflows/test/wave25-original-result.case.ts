/** Wave-25 A9/A10: an observed original result lands on the original IDs idempotently; foreign tuples refuse. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { ProductStore } from '@personal-agent/storage'
import { applyOriginalResult, type OriginalResultInput } from '../src/index.ts'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'

const principal = { userId: 'wave25-result-user', authorityRef: 'wave25-result-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'wave25-result-project', conversationId = 'wave25-result-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'wave25-output', kind: 'machine' as const, required: true as const, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'wave25-human', kind: 'human' as const, required: true, description: 'Review output' },
]
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) { latest = await read(); if (predicate(latest)) return latest; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error(`timed out: ${JSON.stringify(latest ?? null)}`)
}

test('the original IDs land the observed result once, keep unknown unknown and refuse a foreign tuple', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'wave25-result-')), stateRoot = join(root, 'state'), project = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'result fixture'])
  let store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createControlledProduct({ store, principal, projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 98), stateRoot, scratchProject: project })
  let input: OriginalResultInput | undefined
  try {
    product.start(); let seq = 0
    const command = (value: any) => product.application.dispatch({ commandId: `wave25-result-${++seq}`, conversationId, ...value }, actor)
    const created = await command({ kind: 'create_work', projectId, goal: 'Wave-25 observed result', profileId: 'profile-fixture-question', scope, criteria })
    assert.equal(created.status, 'recorded')
    const view = await until(async () => product.application.inspect({}), value => value.questions.length === 1)
    const question = view.questions[0]!, target = question.targets[0]!
    const answer = await command({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] } })
    assert.equal(answer.status, 'recorded')
    await until(async () => product.application.questions.currentDeliveries(question.id), value => value[0]?.status === 'native_applied')
    const answerId = (store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(question.id) as { answer_id: string }).answer_id
    input = { protocol: 'original-result/1', ticketId: target.ticketId, assignmentId: target.assignmentId, attemptId: target.attemptId,
      fenceEpoch: target.fenceEpoch, contract: target.contract, questionId: question.id, answerId, deliveryTargetId: String(target.id),
      status: 'native_applied', evidence: 'fixture native result' }
    const before = { deliveries: store.answers.deliveries(answerId).length, observations: store.observations.forAttempt(target.attemptId).length }
    const duplicate = applyOriginalResult(store, input)
    assert.equal(duplicate.status, 'duplicate'); assert.equal(duplicate.delivery?.status, 'native_applied')
    assert.equal(store.answers.deliveries(answerId).length, before.deliveries)
    assert.equal(store.observations.forAttempt(target.attemptId).length, before.observations)
    const refusedTuples: [string, Partial<OriginalResultInput>][] = [
      ['ticket', { ticketId: 'foreign-ticket' }], ['assignment', { assignmentId: 'foreign-assignment' }],
      ['attempt', { attemptId: 'foreign-attempt' }], ['epoch', { fenceEpoch: target.fenceEpoch + 1 }],
      ['contract', { contract: { ...target.contract, revision: target.contract.revision + 1 } }],
      ['answer', { answerId: 'foreign-answer' }], ['question', { questionId: 'foreign-question' }],
      ['target', { deliveryTargetId: 'foreign-target' }],
    ]
    for (const [name, patch] of refusedTuples) {
      const result = applyOriginalResult(store, { ...input, ...patch } as OriginalResultInput)
      assert.equal(result.status, 'refused', name); assert.ok(result.delivery === null, name)
    }
    // A second recorded answer on the same target starts as local_recorded; an unknown result is
    // preserved exactly, and only a later explicit observed result advances it.
    const secondAnswerId = 'wave25-second-answer'
    store.answers.record(secondAnswerId, { questionId: question.id, expectedVersion: question.version, digest: 'd'.repeat(64), answer: { kind: 'free_text', text: 'x' } })
    store.answers.upsertDelivery(secondAnswerId, String(target.id), 'local_recorded')
    const unknown = applyOriginalResult(store, { ...input, answerId: secondAnswerId, status: 'indeterminate', evidence: 'transport unknown' })
    assert.equal(unknown.status, 'applied'); assert.equal(unknown.delivery?.status, 'indeterminate')
    assert.equal(applyOriginalResult(store, { ...input, answerId: secondAnswerId, status: 'indeterminate' }).status, 'duplicate')
    assert.equal(store.answers.deliveries(secondAnswerId)[0]?.status, 'indeterminate')
    const observed = applyOriginalResult(store, { ...input, answerId: secondAnswerId, status: 'native_applied', evidence: 'received native result' })
    assert.equal(observed.status, 'applied'); assert.equal(observed.delivery?.status, 'native_applied')
    assert.equal(applyOriginalResult(store, { ...input, answerId: secondAnswerId, status: 'native_applied', evidence: 'a different string' }).status, 'duplicate')
    assert.equal(store.answers.deliveries(secondAnswerId)[0]?.status, 'native_applied')
    console.log('WAVE25_ORIGINAL_RESULT', JSON.stringify({ answerId, targetId: target.id,
      duplicate: duplicate.status, unknown: unknown.delivery?.status, observed: observed.delivery?.status, refusals: refusedTuples.map(([name]) => name) }))
    await product.close(); store.close()
    const reader = spawnSync(process.execPath, [join(import.meta.dirname, 'fixtures', 'wave25-result-reader.mjs'), join(stateRoot, 'state.sqlite'), answerId, secondAnswerId], { encoding: 'utf8' })
    assert.equal(reader.status, 0, reader.stderr)
    const readback = JSON.parse(reader.stdout)
    assert.notEqual(readback.pid, process.pid)
    assert.deepEqual(readback.first.map((row: any) => row.status), ['native_applied'])
    assert.deepEqual(readback.second.map((row: any) => row.status), ['native_applied'])
    console.log('WAVE25_ORIGINAL_RESULT_READBACK', JSON.stringify({ pid: readback.pid, first: readback.first, second: readback.second }))
  } finally { await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) }
})
