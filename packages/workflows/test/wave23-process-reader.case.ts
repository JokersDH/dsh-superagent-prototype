/** Wave-23 A2/A3/A4: independent Node PID reads original attempt facts and validates a data manifest. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ProductStore } from '@personal-agent/storage'
import { canonicalJson } from '@personal-agent/contracts/canonical'
import { createControlledProduct, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
import { buildDataManifest, verifyDataManifest, type DataManifest } from '../src/index.ts'

const principal = { userId: 'wave23-reader-user', authorityRef: 'wave23-reader-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'wave23-reader-project', conversationId = 'wave23-reader-conversation'
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'wave23-output', kind: 'machine' as const, required: true as const, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'wave23-human', kind: 'human' as const, required: true, description: 'Review output' },
]
const digest = (value: unknown): string => createHash('sha256').update(canonicalJson(value as any)).digest('hex')
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 15000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) { latest = await read(); if (predicate(latest)) return latest; await new Promise(resolve => setTimeout(resolve, 20)) }
  throw new Error(`timed out: ${JSON.stringify(latest ?? null)}`)
}

test('a different Node PID reads the original attempt and the manifest rejects single-variable drift', { timeout: 30000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'wave23-reader-')), stateRoot = join(root, 'state'), project = join(root, 'project')
  mkdirSync(stateRoot); mkdirSync(join(project, 'src'), { recursive: true }); writeFileSync(join(project, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'reader fixture'])
  const store = new ProductStore({ path: join(stateRoot, 'state.sqlite') })
  const product = createControlledProduct({ store, principal, projects: [{ id: projectId, scope }], actionSecret: Buffer.alloc(32, 97), stateRoot, scratchProject: project })
  let attemptId = '', ticketId = '', questionId = '', answerId = '', contract: any
  try {
    product.start(); let seq = 0
    const command = (value: any) => product.application.dispatch({ commandId: `wave23-reader-${++seq}`, conversationId, ...value }, actor)
    const created = await command({ kind: 'create_work', projectId, goal: 'Wave-23 process reader', profileId: 'profile-fixture-question', scope, criteria })
    assert.equal(created.status, 'recorded')
    const view = await until(async () => product.application.inspect({}), value => value.questions.length === 1)
    const question = view.questions[0]!; questionId = question.id; ticketId = question.targets[0]!.ticketId; contract = question.targets[0]!.contract
    await until(async () => store.bindings.current(ticketId), value => !!value)
    attemptId = store.bindings.current<any>(ticketId)!.attemptId
    // Intent / written / unknown windows on the same real attempt identity, with no fabrication as observed.
    store.dispatch.beginSend('wave23-window', 'wave23-target')
    store.dispatch.markWritten('wave23-window', 'wave23-target')
    store.dispatch.beginSend('wave23-unknown', 'wave23-target')
    store.dispatch.markIndeterminate('wave23-unknown', 'wave23-target', 'transport unknown')
    const answer = await command({ kind: 'answer_question', questionId, expectedVersion: question.version,
      answer: { kind: 'choices', optionIds: ['allow'] } })
    assert.equal(answer.status, 'recorded')
    await until(async () => product.application.questions.currentDeliveries(questionId), value => value[0]?.status === 'native_applied')
    answerId = (store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(questionId) as { answer_id: string }).answer_id
  } finally { await product.close() }
  const sourceSha = 'a'.repeat(40)
  const manifest = await buildDataManifest(store, { sourceSha, snapshotFormat: 1, ticketId, attemptId, questionId, answerId,
    commandIds: ['wave23-reader-1', 'wave23-reader-2'],
    dispatch: [{ commandId: 'wave23-window', target: 'wave23-target' }, { commandId: 'wave23-unknown', target: 'wave23-target' }] })
  console.log('WAVE23_MANIFEST', JSON.stringify(manifest))
  const manifestPath = join(root, 'manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const before = { deliveries: manifest.counts.deliveries, dispatch: manifest.counts.dispatch, observations: manifest.counts.observations,
    queue: store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100).length }
  const reader = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'wave23-reader.mjs')
  const child = spawnSync(process.execPath, [reader, join(stateRoot, 'state.sqlite'), manifestPath, sourceSha], { encoding: 'utf8', timeout: 20000 })
  assert.equal(child.status, 0, child.stderr)
  const observed = JSON.parse(child.stdout)
  assert.notEqual(observed.pid, process.pid)
  assert.deepEqual(observed.verification, { ok: true })
  assert.equal(observed.binding.attemptId, attemptId); assert.equal(observed.binding.ticketId, ticketId)
  assert.equal(observed.binding.assignmentId, manifest.binding.assignmentId)
  assert.deepEqual(observed.binding.contract, contract)
  assert.equal(observed.binding.fenceEpoch, manifest.binding.fenceEpoch)
  assert.equal(observed.currentAttemptId, attemptId)
  assert.equal(observed.question.id, questionId); assert.equal(observed.question.validity, 'answered')
  assert.equal(observed.answer.id, answerId); assert.equal(observed.answer.digest, manifest.answer.digest)
  assert.equal(observed.deliveries[0].status, 'native_applied')
  const dispatchByCommand = new Map<string, any>(observed.dispatch.map((value: any) => [value.commandId, value]))
  assert.equal(dispatchByCommand.get('wave23-window').delivery, 'written')
  assert.equal(dispatchByCommand.get('wave23-unknown').delivery, 'indeterminate')
  assert.deepEqual(observed.observations.map((row: any) => row.factId), manifest.observations.map(row => row.factId))
  assert.equal(child.pid, observed.pid)
  assert.equal(store.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 100).length, before.queue)
  assert.equal(store.answers.deliveries(answerId).length, before.deliveries)
  assert.equal(store.observations.forAttempt(attemptId).length, before.observations)

  const mutations: [string, (value: DataManifest) => void][] = [
    ['payload digest', value => { value.observations[0]!.payloadSha256 = 'f'.repeat(64) }],
    ['answer id', value => { value.answer.id = 'other-answer' }],
    ['data root', value => { value.dataRoot = '/tmp/other-root' }],
    ['source sha', value => { value.sourceSha = 'b'.repeat(40) }],
    ['snapshot format', value => { value.snapshotFormat = 2 }],
    ['source fingerprint', value => { value.sourceFingerprint = 'c'.repeat(64) }],
  ]
  const rejected: string[] = []
  for (const [name, mutate] of mutations) {
    const copy = structuredClone(manifest); mutate(copy)
    ;(copy as any).digest = digest((({ digest: _digest, ...rest }) => rest)(copy))
    const result = await verifyDataManifest(store, copy, { sourceSha, snapshotFormat: 1 })
    assert.equal(result.ok, false, name)
    rejected.push(name)
  }
  console.log('WAVE23_MUTATIONS_REJECTED', JSON.stringify(rejected))
  store.close(); rmSync(root, { recursive: true, force: true })
})
