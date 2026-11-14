/** Wave-25: one real Store restored twice (default v1 and explicit v2) into the same package's consumers. */
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { appendFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ProductStore, readWorkflowContent } from '@personal-agent/storage'
import { buildDataManifest, verifyDataManifest, type DataSubjectExpectation } from '../src/index.ts'
import { key } from '../../orchestrator-core/src/core/ids.ts'
import { restoreWorkflowSnapshot, verifyRestoredSnapshot, WorkflowSnapshots, RESTORE_LIMITS } from '../src/index.ts'
import { localCredentials } from '../../../apps/coordinator/http/local-state.ts'
import { prepareRestoredReview } from '../../../apps/coordinator/product/restored-review.ts'
import { createControlledProduct, createProductRuntime, FIXTURE_CHECK } from '../../../apps/coordinator/product/runtime.ts'
// @ts-expect-error main-owned plain-JS fixture without declarations
import { candidateModel } from '../../../tests/integration/fixtures/assistant-candidate-model.mjs'
// @ts-expect-error main-owned plain-JS fixture without declarations
import { availablePort, waitUntil } from '../../../tests/integration/fixtures/personal-startup.mjs'

const principal = { userId: 'local-demo-user', authorityRef: 'local-demo-authority' }
const actor = { ...principal, source: 'local_cli' as const }
const projectId = 'project-scratch', conversationId = 'wave20-personal-conversation'
const repoRoot = join(import.meta.dirname, '../../..')
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const scope = { projectId, allowedPaths: ['src/'], excludedPaths: ['.git'], externalActions: [] }
const fixtureScope = { projectId, allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const criteria = [
  { id: 'wave20-output', kind: 'machine' as const, required: true as const, description: 'Fixed output matches', checkDefinitionRef: FIXTURE_CHECK },
  { id: 'wave20-human', kind: 'human' as const, required: true, description: 'Review output' },
]
async function until<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeout = 20000): Promise<T> {
  const deadline = Date.now() + timeout
  let latest: T | undefined
  while (Date.now() < deadline) {
    latest = await read(); if (predicate(latest)) return latest
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error(`timed out: ${JSON.stringify(latest ?? null)}`)
}

test('the same real Store restores v1 and v2 separately through actual personal readonly', { timeout: 40000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'wave25-dual-personal-')), source = join(root, 'source'), project = join(root, 'project')
  mkdirSync(source, { mode: 0o700 }); mkdirSync(join(project, 'src'), { recursive: true })
  writeFileSync(join(project, 'index.mjs'), 'export const ok = true\n'); writeFileSync(join(project, 'src/.gitkeep'), '')
  const git = (args: string[]) => execFileSync('git', args, { cwd: project, stdio: 'pipe' })
  git(['init', '-q']); git(['add', 'index.mjs', 'src/.gitkeep']); git(['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@localhost', 'commit', '-qm', 'personal fixture'])
  const model = await candidateModel(), store = new ProductStore({ path: join(source, 'state.sqlite') })
  let child: any, runtime: any, businessWorkId = '', businessQuestionId = '', businessAnswerId = ''
  let ticketId = '', assignmentId = '', attemptId = '', fenceEpoch = 0, targetId = '', contract: DataSubjectExpectation['contract'] | undefined
  let assistantMessageId = ''
  const output = { text: '' }
  const stop = async () => { if (!child || child.exitCode !== null || child.signalCode !== null) return
    const done = once(child, 'exit'), timer = setTimeout(() => child.kill('SIGKILL'), 6000)
    child.kill('SIGTERM'); try { await done } finally { clearTimeout(timer) } }
  t.after(async () => { await stop(); await runtime?.close(); store.close(); await model.close(); rmSync(root, { recursive: true, force: true }) })
  const controlled = createControlledProduct({ store, principal, projects: [{ id: projectId, scope: fixtureScope }], actionSecret: Buffer.alloc(32, 94), stateRoot: source, scratchProject: project })
  try {
    controlled.start(); let seq = 0
    const command = (value: any, id = `wave20-business-${++seq}`) => controlled.application.dispatch({ commandId: id, conversationId, ...value }, actor)
    const created = await command({ kind: 'create_work', projectId, goal: 'Wave-20 personal business', profileId: 'profile-fixture-question', scope: fixtureScope, criteria }, 'wave20-business-create')
    assert.equal(created.status, 'recorded'); businessWorkId = created.workId!
    const view = await until(async () => controlled.application.inspect({}), value => value.questions.length === 1)
    businessQuestionId = view.questions[0]!.id
    const target = view.questions[0]!.targets[0]!; targetId = String(target.id); ticketId = target.ticketId; assignmentId = target.assignmentId
    fenceEpoch = target.fenceEpoch; contract = target.contract
    await until(async () => store.bindings.current(ticketId), value => !!value)
    attemptId = store.bindings.current<any>(ticketId)!.attemptId
    store.dispatch.beginSend('wave20-business-answer', targetId); store.dispatch.markWritten('wave20-business-answer', targetId)
    const answer = await command({ kind: 'answer_question', questionId: businessQuestionId, expectedVersion: view.questions[0]!.version,
      answer: { kind: 'choices', optionIds: ['allow'] } }, 'wave20-business-answer')
    assert.equal(answer.status, 'recorded')
    await until(async () => controlled.application.questions.currentDeliveries(businessQuestionId), value => value[0]?.status === 'native_applied')
    businessAnswerId = (store.db.prepare('SELECT answer_id FROM answers WHERE question_id = ?').get(businessQuestionId) as { answer_id: string }).answer_id
  } finally { await controlled.close() }
  model.setReply((context: any) => ({ text: '已整理为一项后续工作。', suggestions: [{ kind: 'propose_work',
    goal: '保留现有错误码并补充回归', projectId, sourceMessageId: context.sourceMessageId }] }))
  runtime = createProductRuntime({ store, stateRoot: source, scratchProject: project, principal, projects: [{ id: projectId, scope: fixtureScope }],
    actionSecret: Buffer.alloc(32, 95), assistantProvider: model.provider })
  runtime.start()
  await runtime.application.dispatch({ kind: 'chat', commandId: 'wave20-chat', projectId, conversationId, text: '整理历史决定。' }, actor)
  await until(async () => store.product.messages.page(conversationId).messages.filter(value => value.role === 'assistant').length === 1, value => value)
  const messageId = store.product.messages.page(conversationId).messages.find(value => value.role === 'assistant')!.sourceRefs[0]!
  const context = await runtime.operations.assistantContextPrepare({ commandId: 'wave20-context', text: '按原约束再核对。',
    context: { projectId, conversationId, selections: ['conversation'], budget: { maxFiles: 16, maxBytes: 65536, maxTokens: 16384 } } }, actor)
  await runtime.operations.assistantContextSend({ commandId: context.commandId, token: context.token }, actor)
  await until(async () => store.product.messages.page(conversationId).messages.filter(value => value.role === 'assistant').length === 2, value => value)
  const contextMessageId = key('message', 'wave20-context')
  assistantMessageId = store.product.messages.page(conversationId).messages.filter(value => value.role === 'assistant').at(-1)!.id
  await runtime.close(); runtime = undefined
  store.queue.enqueue('application.execute', 'held-personal', '{}', 1, 0, new Date().toISOString())
  const subject = { sourceSha: 'a'.repeat(40), ticketId, assignmentId, attemptId, fenceEpoch, contract: contract!,
    questionId: businessQuestionId, answerId: businessAnswerId,
    requiredCommandIds: ['wave20-business-create', 'wave20-business-answer'],
    requiredDispatch: [{ commandId: 'wave20-business-answer', target: targetId }], requiredDeliveryTargets: [targetId] }
  const sourceExpectation: DataSubjectExpectation = { ...subject, snapshotFormat: 1, dataRoot: source }
  const sourceManifest = await buildDataManifest(store, sourceExpectation)
  const sourceContent = readWorkflowContent(join(source, 'state.sqlite'))
  assert.equal(sourceContent.complete, true); assert.ok(sourceContent.digest)
  const sourceExpectationPath = join(root, 'source-expectation.json'), sourceManifestPath = join(root, 'source-manifest.json')
  writeFileSync(sourceExpectationPath, JSON.stringify(sourceExpectation, null, 2)); writeFileSync(sourceManifestPath, JSON.stringify(sourceManifest, null, 2))
  console.log('WAVE27_SOURCE_MANIFEST', JSON.stringify({ digest: sourceManifest.digest, counts: sourceManifest.counts, answers: sourceManifest.answer.id }))
  for (const format of [1, 2] as const) {
    const snapshotDir = join(root, `snapshot-${format}`)
    const snapshot = await new WorkflowSnapshots(store).create({ destination: snapshotDir, ...(format === 2 ? { formatVersion: 2 } : {}) })
    assert.equal(snapshot.status, 'ok', snapshot.message)
    assert.equal(snapshot.manifest.protocol, format === 2 ? 'workflow-snapshot/2' : 'workflow-snapshot/1')
    assert.equal(snapshot.manifest.evidence.protocol, format === 2 ? 'workflow-evidence/2' : 'workflow-evidence/1')
    assert.equal(snapshot.manifest.evidence.families.length, format === 2 ? 21 : 13)
    const expectedArtifacts = snapshot.manifest.artifacts.map(artifact => ({ id: artifact.id, digest: artifact.digest, bytes: artifact.bytes }))
    const duplicateInventory = expectedArtifacts[0] ? [...expectedArtifacts, expectedArtifacts[0]] : []
    if (duplicateInventory.length) {
      const refusedInventory = await restoreWorkflowSnapshot({ snapshotDirectory: snapshot.destination, targetStateDir: join(root, `bad-inventory-${format}`),
        expected: { artifacts: duplicateInventory } })
      assert.equal(refusedInventory.status, 'blocked')
      const oversizedInventory = await restoreWorkflowSnapshot({ snapshotDirectory: snapshot.destination, targetStateDir: join(root, `oversized-inventory-${format}`),
        expected: { artifacts: [{ ...expectedArtifacts[0]!, bytes: RESTORE_LIMITS.artifactBytes + 1 }] } })
      assert.equal(oversizedInventory.status, 'blocked')
      const foreignInventory = await restoreWorkflowSnapshot({ snapshotDirectory: snapshot.destination, targetStateDir: join(root, `foreign-inventory-${format}`),
        expected: { artifacts: [{ ...expectedArtifacts[0]!, id: '../foreign' }] } })
      assert.equal(foreignInventory.status, 'blocked')
    }
    const restoreRoot = join(mkdtempSync(join(tmpdir(), `wave25-restore-${format}-`)), 'state')
    const wrongFormat = format === 2 ? 'workflow-snapshot/1' : 'workflow-snapshot/2'
    const refusedFormat = await restoreWorkflowSnapshot({ snapshotDirectory: snapshot.destination, targetStateDir: join(root, `bad-format-${format}`),
      expected: { protocol: wrongFormat } })
    assert.equal(refusedFormat.status, 'blocked'); assert.equal(refusedFormat.report, null)
    const refusedDigest = await restoreWorkflowSnapshot({ snapshotDirectory: snapshot.destination, targetStateDir: join(root, `bad-digest-${format}`),
      expected: { databaseSha256: '0'.repeat(64) } })
    assert.equal(refusedDigest.status, 'blocked')
    const wrongArtifactSource = join(root, `wrong-artifact-${format}`)
    cpSync(snapshot.destination, wrongArtifactSource, { recursive: true })
    const firstArtifact = snapshot.manifest.artifacts[0]
    if (firstArtifact) { const tampered = Buffer.from(readFileSync(join(wrongArtifactSource, firstArtifact.snapshotPath))); tampered[0] = (tampered[0] ?? 0) ^ 0xff; writeFileSync(join(wrongArtifactSource, firstArtifact.snapshotPath), tampered) }
    const refusedArtifact = await restoreWorkflowSnapshot({ snapshotDirectory: wrongArtifactSource, targetStateDir: join(root, `bad-artifact-${format}`) })
    assert.equal(refusedArtifact.status, 'blocked'); assert.match(refusedArtifact.message ?? '', /digest mismatch/)
    assert.equal(existsSync(join(root, `bad-artifact-${format}`, 'state.sqlite')), false)
    assert.equal(existsSync(join(root, `bad-artifact-${format}`, 'restore-report.json')), false)
    if (format === 1) {
      const oversized = join(root, 'oversized-manifest')
      cpSync(snapshot.destination, oversized, { recursive: true })
      appendFileSync(join(oversized, 'snapshot.json'), ' '.repeat(8 * 1024 * 1024))
      const refusedOversized = await restoreWorkflowSnapshot({ snapshotDirectory: oversized, targetStateDir: join(root, 'bad-size') })
      assert.equal(refusedOversized.status, 'blocked'); assert.match(refusedOversized.message ?? '', /too large/)
    }
    const restored = await restoreWorkflowSnapshot({ snapshotDirectory: snapshot.destination, targetStateDir: restoreRoot, sourceStateRoot: source,
      expected: { protocol: snapshot.manifest.protocol, snapshotDigest: sha256(readFileSync(snapshot.manifestPath)), databaseSha256: snapshot.manifest.database.sha256,
        evidenceDigest: snapshot.manifest.evidence.digest, contentDigest: sourceContent.digest! } })
    assert.equal(restored.status, 'ok', restored.message)
    assert.equal(restored.report?.snapshot.format, snapshot.manifest.protocol)
    assert.equal(restored.report?.snapshot.digest, sha256(readFileSync(snapshot.manifestPath)))
    assert.equal(restored.report?.evidence.digest, snapshot.manifest.evidence.digest)
    assert.equal(restored.report?.rootMapping.from, source)
    assert.equal(restored.report?.content.complete, true)
    console.log('WAVE27_CONTENT', JSON.stringify({ format, snapshotDigest: sha256(readFileSync(snapshot.manifestPath)), databaseSha256: snapshot.manifest.database.sha256,
      contentDigest: restored.report?.content.digest, contentRows: restored.report?.content.rows, contentBytes: restored.report?.content.bytes, artifacts: restored.report?.artifacts.length }))
    assert.ok(restored.report?.content.digest)
    assert.equal(restored.report?.database.sha256, sha256(readFileSync(join(snapshot.destination, 'product.sqlite'))))
    assert.equal(restored.report?.artifacts.length, snapshot.manifest.artifacts.length)
    assert.equal(verifyRestoredSnapshot(restoreRoot).basis, 'report_only')
    const reverified = verifyRestoredSnapshot(restoreRoot, { protocol: snapshot.manifest.protocol,
      snapshotDigest: sha256(readFileSync(snapshot.manifestPath)), databaseSha256: snapshot.manifest.database.sha256,
      evidenceDigest: snapshot.manifest.evidence.digest, contentDigest: sourceContent.digest!, artifacts: expectedArtifacts, sourceStateRoot: source })
    assert.equal(reverified.status, 'ok', reverified.message); assert.equal(reverified.basis, 'independent')
    assert.equal(reverified.content?.digest, restored.report!.content.digest)
    assert.equal(restored.report!.content.digest, sourceContent.digest)
    assert.equal(verifyRestoredSnapshot(restoreRoot, { snapshotDigest: '0'.repeat(64), artifacts: expectedArtifacts }).status, 'blocked')
    const capped = readWorkflowContent(join(restoreRoot, 'state.sqlite'), { limits: { maxRows: 1 } })
    assert.equal(capped.complete, false); assert.equal(capped.digest, null); assert.ok(capped.reason)
    const driftRoot = join(root, `drift-${format}`)
    cpSync(restoreRoot, driftRoot, { recursive: true })
    const driftReport = JSON.parse(readFileSync(join(driftRoot, 'restore-report.json'), 'utf8'))
    driftReport.targetPath = driftRoot; driftReport.rootMapping.to = driftRoot
    writeFileSync(join(driftRoot, 'restore-report.json'), JSON.stringify(driftReport, null, 2))
    const driftStore = new ProductStore({ path: join(driftRoot, 'state.sqlite') })
    try {
      const last = driftStore.db.prepare('SELECT conversation_id, MAX(sequence) AS sequence, value, created_at FROM conversation_messages GROUP BY conversation_id').get() as any
      driftStore.db.prepare('INSERT INTO conversation_messages (conversation_id, sequence, id, value, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(last.conversation_id, last.sequence + 1, 'wave26-extra-message', last.value, last.created_at)
    } finally { driftStore.close() }
    const drift = verifyRestoredSnapshot(driftRoot, { snapshotDigest: sha256(readFileSync(snapshot.manifestPath)), artifacts: expectedArtifacts, sourceStateRoot: source })
    assert.equal(drift.status, 'blocked'); assert.match(drift.message ?? '', /content differs/)
    const artifactRootCopy = join(root, `artifact-drift-${format}`)
    cpSync(restoreRoot, artifactRootCopy, { recursive: true })
    const artifactReport = JSON.parse(readFileSync(join(artifactRootCopy, 'restore-report.json'), 'utf8'))
    artifactReport.targetPath = artifactRootCopy; artifactReport.rootMapping.to = artifactRootCopy
    writeFileSync(join(artifactRootCopy, 'restore-report.json'), JSON.stringify(artifactReport, null, 2))
    const artifactId = restored.report!.artifacts[0]?.id
    if (artifactId) {
      const artifactPath = join(artifactRootCopy, 'artifacts', artifactId), bytes = Buffer.from(readFileSync(artifactPath))
      bytes[0] = (bytes[0] ?? 0) ^ 0xff; writeFileSync(artifactPath, bytes)
      const artifactDrift = verifyRestoredSnapshot(artifactRootCopy, { snapshotDigest: sha256(readFileSync(snapshot.manifestPath)), artifacts: expectedArtifacts })
      assert.equal(artifactDrift.status, 'blocked'); assert.match(artifactDrift.message ?? '', /artifact/)
      rmSync(artifactPath)
      const missingArtifact = verifyRestoredSnapshot(artifactRootCopy, { snapshotDigest: sha256(readFileSync(snapshot.manifestPath)), artifacts: expectedArtifacts })
      assert.equal(missingArtifact.status, 'blocked')
    }
    const emptiedRoot = join(root, `emptied-inventory-${format}`)
    cpSync(restoreRoot, emptiedRoot, { recursive: true })
    const emptiedReport = JSON.parse(readFileSync(join(emptiedRoot, 'restore-report.json'), 'utf8'))
    emptiedReport.targetPath = emptiedRoot; emptiedReport.rootMapping.to = emptiedRoot; emptiedReport.artifacts = []; emptiedReport.snapshot.artifacts = 0
    writeFileSync(join(emptiedRoot, 'restore-report.json'), JSON.stringify(emptiedReport, null, 2))
    const firstExpectedArtifact = expectedArtifacts[0]
    if (firstExpectedArtifact) rmSync(join(emptiedRoot, 'artifacts', firstExpectedArtifact.id))
    const emptied = verifyRestoredSnapshot(emptiedRoot, { snapshotDigest: sha256(readFileSync(snapshot.manifestPath)), contentDigest: sourceContent.digest!, artifacts: expectedArtifacts })
    assert.equal(emptied.status, 'blocked'); assert.match(emptied.message ?? '', /artifact inventory/)
    const mappingRoot = join(root, `mapping-drift-${format}`)
    cpSync(restoreRoot, mappingRoot, { recursive: true })
    const mappingReport = JSON.parse(readFileSync(join(mappingRoot, 'restore-report.json'), 'utf8'))
    mappingReport.targetPath = mappingRoot; mappingReport.rootMapping.to = source
    writeFileSync(join(mappingRoot, 'restore-report.json'), JSON.stringify(mappingReport, null, 2))
    const mappingDrift = verifyRestoredSnapshot(mappingRoot, { snapshotDigest: sha256(readFileSync(snapshot.manifestPath)), artifacts: expectedArtifacts })
    assert.equal(mappingDrift.status, 'blocked'); assert.match(mappingDrift.message ?? '', /root mapping/)
    assert.equal((await restoreWorkflowSnapshot({ snapshotDirectory: snapshot.destination, targetStateDir: restoreRoot })).status, 'blocked')
    const credential = localCredentials(restoreRoot), reviewFile = join(root, `review-${format}.json`)
    const reviewStore = new ProductStore({ path: join(restoreRoot, 'state.sqlite') })
    try {
      writeFileSync(reviewFile, JSON.stringify(prepareRestoredReview(reviewStore, restoreRoot, principal,
        [{ projectId, allowedPaths: ['src/'], excludedPaths: [] }], Buffer.from(credential('action.key'), 'hex'))), { mode: 0o600 })
    } finally { reviewStore.close() }
    const port = await availablePort(), api = `http://127.0.0.1:${port}`, headers = { authorization: `Bearer ${credential('api.key')}` }
    child = spawn(process.execPath, [join(repoRoot, 'apps/coordinator/product/demo.ts'), '--state', restoreRoot, '--port', String(port),
      '--discussion-only', '--assistant', '--review-restored-scope', reviewFile],
    { cwd: repoRoot, env: { ...process.env, PA_MODEL_CONFIG: model.file }, stdio: ['ignore', 'pipe', 'pipe'] })
    child.stdout.on('data', (bytes: Buffer) => { output.text += bytes.toString() }); child.stderr.on('data', (bytes: Buffer) => { output.text += bytes.toString() })
    await waitUntil(async () => { if (child.exitCode !== null || child.signalCode !== null) throw new Error(output.text.slice(-2000));
      try { return (await fetch(`${api}/v1/health`)).ok } catch { return false } })
    const requestsBefore = model.requests.length
    const candidateResponse = await fetch(`${api}/v1/messages/${messageId}/candidates`, { headers })
    assert.equal(candidateResponse.status, 200, await candidateResponse.clone().text())
    assert.equal((await fetch(`${api}/v1/context/history?projectId=${projectId}`, { headers })).status, 200)
    const work = await fetch(`${api}/v1/snapshot?workId=${businessWorkId}`, { headers })
    assert.equal(work.status, 200, await work.clone().text())
    const deliveries = await fetch(`${api}/v1/questions/${businessQuestionId}/deliveries`, { headers })
    assert.equal(deliveries.status, 200, await deliveries.clone().text())
    const deliveryJson = await deliveries.json()
    assert.equal(deliveryJson[0].status, 'native_applied')
    const historyJson = await (await fetch(`${api}/v1/context/history?projectId=${projectId}`, { headers })).json()
    assert.ok(historyJson.entries.some((entry: any) => entry.messageId === contextMessageId))
    const candidatesJson = await candidateResponse.json()
    assert.equal(candidatesJson.executable, false); assert.equal(candidatesJson.authorization, 'none')
    assert.ok(candidatesJson.candidates.length >= 1)
    const sourceView = await (await fetch(`${api}/v1/messages/${contextMessageId}/context/sources`, { headers })).json()
    assert.equal(sourceView.state, 'verified'); assert.ok(sourceView.sources.length >= 1)
    assert.ok(deliveryJson.some((delivery: any) => delivery.targetBindingId === targetId && delivery.status === 'native_applied'))
    assert.ok(JSON.stringify(await work.json()).includes(businessWorkId))
    assert.ok(JSON.stringify(candidatesJson).includes('propose_work'))


    const refusal = await fetch(`${api}/v1/commands`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'answer_question', questionId: businessQuestionId, expectedVersion: 1, answer: { kind: 'free_text', text: 'x' } }) })
    assert.equal(refusal.status, 422)
    assert.equal(model.requests.length, requestsBefore)
    await stop()
    const expected: DataSubjectExpectation = { ...subject, snapshotFormat: format, dataRoot: restoreRoot }
    const restoredStore = new ProductStore({ path: join(restoreRoot, 'state.sqlite') })
    const manifest = await buildDataManifest(restoredStore, expected)
    assert.equal(manifest.subject.snapshotFormat, format); assert.equal(manifest.subject.dataRoot, restoreRoot)
    assert.equal(manifest.binding.attemptId, attemptId); assert.equal(manifest.answer.id, businessAnswerId)
    assert.equal((await verifyDataManifest(restoredStore, manifest, expected)).ok, true)
    restoredStore.close()
    const expectationPath = join(root, `expectation-${format}.json`), manifestPath = join(root, `manifest-${format}.json`)
    writeFileSync(expectationPath, JSON.stringify(expected, null, 2)); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    const cDriver = join(process.env.PA_C_WORKTREE ?? '/Users/hh/Desktop/joker/superagent-agent-c', 'packages/context/tools/wave24-a-manifest.mjs')
    if (existsSync(cDriver)) {
      const cOutput = join(root, `c-manifest-${format}.json`), aModule = join(repoRoot, 'packages/workflows/dist/data-manifest.js')
      const aHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
      const cBuild = spawnSync(process.execPath, [cDriver, '--a-module', aModule, '--a-worktree', repoRoot, '--db', join(restoreRoot, 'state.sqlite'),
        '--expectation', expectationPath, '--manifest', manifestPath, '--output', cOutput, '--mode', 'build', '--a-head', aHead], { encoding: 'utf8', timeout: 20000 })
      assert.equal(cBuild.status, 0, cBuild.stderr)
      const built = JSON.parse(cBuild.stdout); assert.equal(built.status, 'ok'); assert.equal(built.manifest.digest, manifest.digest)
      const cVerify = spawnSync(process.execPath, [cDriver, '--a-module', aModule, '--a-worktree', repoRoot, '--db', join(restoreRoot, 'state.sqlite'),
        '--expectation', expectationPath, '--manifest', cOutput, '--mode', 'verify', '--a-head', aHead], { encoding: 'utf8', timeout: 20000 })
      assert.equal(cVerify.status, 0, cVerify.stderr); assert.equal(JSON.parse(cVerify.stdout).verification.ok, true)
      const cProof = join(process.env.PA_C_WORKTREE ?? '/Users/hh/Desktop/joker/superagent-agent-c', 'packages/context/tools/wave27-target-proof.mjs')
      if (existsSync(cProof)) {
        const artifactsPath = join(root, `expected-artifacts-${format}.json`)
        writeFileSync(artifactsPath, JSON.stringify(expectedArtifacts))
        const common: string[] = ['--a-worktree', repoRoot, '--a-module', aModule, '--expectation', sourceExpectationPath, '--manifest', sourceManifestPath,
          '--source-state-root', source, '--protocol', snapshot.manifest.protocol, '--snapshot-digest', sha256(readFileSync(snapshot.manifestPath)),
          '--content-digest', sourceContent.digest!, '--artifacts', artifactsPath, '--a-head', aHead]
        const proof = spawnSync(process.execPath, [cProof, '--target-state', restoreRoot, ...common], { encoding: 'utf8', timeout: 20000 })
        console.log('WAVE27_C_PROOF', proof.status, proof.stdout.slice(0, 1200), proof.stderr.slice(0, 800))
        assert.equal(proof.status, 0, `${proof.stderr}\n${proof.stdout}`)
        const proofResult = JSON.parse(proof.stdout)
        assert.equal(proofResult.status, 'ok'); assert.equal(proofResult.verification.basis, 'independent'); assert.equal(proofResult.verification.artifactCoverage, 'independent')
        const driftProof = spawnSync(process.execPath, [cProof, '--target-state', driftRoot, ...common], { encoding: 'utf8', timeout: 20000 })
        assert.ok(driftProof.status === 0 || driftProof.status === 1, driftProof.stderr)
        assert.equal(JSON.parse(driftProof.stdout).status, 'mismatch')
        const emptiedProof = spawnSync(process.execPath, [cProof, '--target-state', emptiedRoot, ...common], { encoding: 'utf8', timeout: 20000 })
        assert.ok(emptiedProof.status === 0 || emptiedProof.status === 1, emptiedProof.stderr)
        assert.equal(JSON.parse(emptiedProof.stdout).status, 'mismatch')
        console.log('WAVE27_DUAL_C_DRIVER', JSON.stringify({ format, pid: built.pid, manifestDigest: built.manifest.digest, aHead,
          targetProof: 'ok', driftProof: 'mismatch', emptiedInventoryProof: 'mismatch', contentDigest: proofResult.verification.content?.digest,
          artifacts: proofResult.verification.report?.artifacts }))
      } else console.log(`WAVE27_DUAL_C_DRIVER format=${format} driver=${built.pid} targetProof=NOT_REACHED`)
    } else console.log(`WAVE25_DUAL_C_DRIVER_NOT_REACHED format=${format}`)
    const reader = spawnSync(process.execPath, [join(import.meta.dirname, 'fixtures', 'wave23-reader.mjs'), join(restoreRoot, 'state.sqlite'), manifestPath, expectationPath],
      { encoding: 'utf8', timeout: 20000 })
    assert.equal(reader.status, 0, reader.stderr)
    const readback = JSON.parse(reader.stdout)
    assert.notEqual(readback.pid, process.pid); assert.equal(readback.verification.ok, true, JSON.stringify(readback.verification))
    assert.equal(readback.answer.id, businessAnswerId)
    assert.ok(readback.deliveries.some((delivery: any) => delivery.targetBindingId === targetId && delivery.status === 'native_applied'))
    const check = new ProductStore({ path: join(restoreRoot, 'state.sqlite') })
    try {
      assert.equal(check.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10).filter(row => row.key === 'held-personal').length, 1)
      assert.equal(check.answers.deliveries(businessAnswerId)[0]?.status, 'native_applied')
      assert.equal(check.product.works.get(businessWorkId)?.title, 'Wave-20 personal business')
      assert.equal(check.workflows.assistant.contextBindings.forMessage(contextMessageId)?.messageId, contextMessageId)
    } finally { check.close() }

    if (format === 2) {
      const narrowFile = join(root, 'narrow-review.json')
      execFileSync(process.execPath, [join(repoRoot, 'tools/dev/review-restored.mjs'), '--state', restoreRoot, '--project', projectId,
        '--allow-path', 'src/narrow/', '--exclude-path', 'src/private/', '--output', narrowFile], { cwd: repoRoot, stdio: 'pipe' })
      const narrowPort = await availablePort(), narrowApi = `http://127.0.0.1:${narrowPort}`
      child = spawn(process.execPath, [join(repoRoot, 'apps/coordinator/product/demo.ts'), '--state', restoreRoot, '--port', String(narrowPort),
        '--discussion-only', '--assistant', '--review-restored-scope', narrowFile], { cwd: repoRoot,
        env: { ...process.env, PA_MODEL_CONFIG: model.file }, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', (bytes: Buffer) => { output.text += bytes.toString() }); child.stderr.on('data', (bytes: Buffer) => { output.text += bytes.toString() })
      await waitUntil(async () => { if (child.exitCode !== null || child.signalCode !== null) throw new Error(output.text.slice(-2000));
        try { return (await fetch(`${narrowApi}/v1/health`)).ok } catch { return false } })
      assert.equal((await fetch(`${narrowApi}/v1/context/history?projectId=${projectId}`, { headers })).status, 200)
      const narrowSources = await fetch(`${narrowApi}/v1/messages/${contextMessageId}/context/sources?scopeReview=1`, { headers })
      assert.equal(narrowSources.status, 200, await narrowSources.clone().text())
      const narrowView = await narrowSources.json()
      assert.equal(narrowView.state, 'scope_changed'); assert.deepEqual(narrowView.sources, [])
      assert.deepEqual([...narrowView.scopeReview.reasons].sort(), ['exclusion_added', 'selection_narrowed'])
      assert.equal(narrowView.scopeReview.authorization, 'none')
      const narrowRefusal = await fetch(`${narrowApi}/v1/commands`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'answer_question', questionId: businessQuestionId, expectedVersion: 1, answer: { kind: 'free_text', text: 'x' } }) })
      assert.equal(narrowRefusal.status, 422)
      assert.equal(model.requests.length, requestsBefore)
      await stop()
    }
    rmSync(restoreRoot, { recursive: true, force: true })
  }
})
