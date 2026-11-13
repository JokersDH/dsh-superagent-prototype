/**
 * Wave-16 A4: drive the actual controlled product (Application/Broker/fixture Runner) to a real
 * work/ticket/assignment, original question/answer/delivery and queue/runtime rows, then restore a
 * non-empty snapshot at a second root read-only.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore, recoveryTargetInventory } from '@personal-agent/storage'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { WorkflowSnapshots } from '../src/index.ts'

const principal = { userId: 'wave16-question-user', authorityRef: 'wave16-question-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const scope = { projectId: 'wave16-question-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'criterion-output', kind: 'machine' as const, required: true as const,
    description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'criterion-human', kind: 'human' as const, required: true, description: 'Review generated patch' },
]
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 10000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) {
    latest = await read()
    if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`Product condition timed out: ${JSON.stringify(latest ?? null)}`)
}

test('a real question/answer/delivery workflow restores at a second root without startup authority', { timeout: 25000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'wave16-question-')), stateRoot = join(root, 'state'), scratchProject = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(scratchProject); mkdirSync(join(scratchProject, 'src')); writeFileSync(join(scratchProject, 'src', '.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: scratchProject, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'Question fixture'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createControlledProduct({ store, principal, projects: [{ id: scope.projectId, scope }],
    actionSecret: Buffer.alloc(32, 62), stateRoot, scratchProject })
  let restored: ProductStore | undefined
  t.after(async () => { if (restored) restored.close(); await product.close(); store.close(); rmSync(root, { recursive: true, force: true }) })
  product.start()
  let seq = 0
  const command = (value: any) => product.application.dispatch({ commandId: `wave16-question-${++seq}`,
    conversationId: 'wave16-question-conversation', ...value }, actor)
  const created = await command({ kind: 'create_work', projectId: scope.projectId, goal: 'Produce the controlled scratch artifact',
    profileId: 'profile-fixture-question', scope, criteria })
  assert.equal(created.status, 'recorded')
  const snapshot = await until(async () => ({ view: await product.application.inspect({}), deliveries: [] as unknown[] }),
    value => value.view.questions.length === 1)
  const question = snapshot.view.questions[0]!
  const answer = await command({ kind: 'answer_question', questionId: question.id, expectedVersion: question.version,
    answer: { kind: 'choices', optionIds: ['allow'] } })
  assert.equal(answer.status, 'recorded')
  await until(async () => product.application.questions.currentDeliveries(question.id), value => value[0]?.status === 'native_applied')

  // Keep one real held queue row so the restored queue itself is non-empty as well.
  store.queue.enqueue('application.execute', 'wave16-held-queue', '{}', 1, 0, new Date().toISOString())
  const snapshotDir = join(root, 'snapshot')
  const createdSnapshot = await new WorkflowSnapshots(store).create({ destination: snapshotDir })
  assert.equal(createdSnapshot.status, 'ok', createdSnapshot.message)
  const families = new Map(createdSnapshot.manifest.evidence.families.map(family => [family.name, family]))
  for (const name of ['user_questions', 'answers', 'answer_deliveries', 'effect_queue', 'runtime_bindings', 'runtime_current'])
    assert.ok((families.get(name)?.count ?? 0) > 0, name)

  const restoreRoot = mkdtempSync(join(tmpdir(), 'wave16-question-restore-'))
  cpSync(snapshotDir, restoreRoot, { recursive: true })
  restored = new ProductStore({ path: join(restoreRoot, 'product.sqlite') })
  try {
    assert.equal(restored.product.works.get(created.workId!)?.title, 'Produce the controlled scratch artifact')
    assert.equal(restored.product.questions.get(question.id)?.validity, 'answered')
    const storedAnswer = restored.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(question.id) as { answer_id: string }
    assert.ok(storedAnswer)
    assert.equal(restored.answers.get(storedAnswer.answer_id)?.questionId, question.id)
    assert.equal(restored.answers.deliveries(storedAnswer.answer_id)[0]?.status, 'native_applied')
    assert.ok((restored.db.prepare('SELECT COUNT(*) AS n FROM ticket_links').get() as { n: number }).n > 0)
    assert.ok((restored.db.prepare('SELECT COUNT(*) AS n FROM effect').get() as { n: number }).n > 0)
    assert.equal(restored.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10)
      .some(row => row.key === 'wave16-held-queue'), true)
    assert.ok((restored.db.prepare('SELECT COUNT(*) AS n FROM runtime_bindings').get() as { n: number }).n > 0)
    const target = join(root, 'restored-target'); mkdirSync(target)
    cpSync(join(restoreRoot, 'product.sqlite'), join(target, 'state.sqlite'))
    const inventory = recoveryTargetInventory.inspect(target)
    assert.equal(inventory.startupAvailable, false)
    assert.equal(inventory.issues.includes('business_rows_present'), true)
  } finally { restored.close(); restored = undefined; rmSync(restoreRoot, { recursive: true, force: true }) }
})
