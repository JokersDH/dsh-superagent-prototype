/**
 * Wave-06 A5: D-consumable snapshot and restore integrity over schema 13. Creates a real state
 * containing decisions, settings, contracts, verification, outcomes/ReviewTiming and artifacts;
 * verifies bytes/references; restores a copy into a new directory and reads the data back.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ProductStore, PRODUCT_SCHEMA_VERSION, recoveryTargetInventory, verifyDatabase } from '@personal-agent/storage'
import { createWorkflowPorts, WorkflowSnapshots } from '../src/index.ts'
import { CompletedAssistantReplies } from '../../../apps/coordinator/product/assistant-reply-results.ts'
import { key } from '../../../packages/orchestrator-core/src/core/ids.ts'

const at = '2026-11-11T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const profile = { profileId: 'codex', revision: 3, identityDigest: 'a'.repeat(64) }
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

function dataset() {
  const root = tmp('pa-snapshot-d-')
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  const ports = createWorkflowPorts(store)
  store.uow.atomic(() => {
    store.product.works.insert({ id: 'work-1', projectId: 'project-1', conversationId: 'conversation-1', title: 'Snapshot work', createdAt: at })
    store.product.contracts.append({ ...contract, goal: 'Deliver', scope,
      criteria: [{ id: 'unit', kind: 'machine', description: 'Unit', required: true, checkDefinitionRef: 'check-1' }],
      authorityRef: 'authority-1', createdAt: at })
    store.product.links.attach({ contract, ticketId: 'ticket-1', role: 'primary', authorityRef: 'authority-1' })
    store.authority.enable(contract)
    store.product.messages.append({
      id: 'message-1', conversationId: 'conversation-1', projectId: 'project-1', role: 'user',
      provenance: 'trusted_user', text: '保留这条决定。', sourceRefs: [], createdAt: at,
    })
    ports.projects.append({ projectId: 'project-1', expectedRevision: 0,
      settings: { pathDigest: 'd'.repeat(64), check: 'node_test', sourceRef: 'source:project-1', displayName: 'Snapshot project' } })
    ports.assistant.decisions.put({
      decision: { id: 'decision-1', version: 1, content: 'Keep the verified patch.', scope, authorityRef: 'authority-1' },
      sourceMessageId: 'message-1', sourceTextDigest: 'e'.repeat(64), conversationId: 'conversation-1',
      actorRef: 'actor-1', recordedAt: at,
    }, 0)
    store.db.prepare(`INSERT INTO completion_verifications
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
       environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('verification-1', 'ticket-1', 'assignment-1', 1, JSON.stringify(contract), 'b'.repeat(64),
        'c'.repeat(64), 'environment-1', 'verifier-1', '[]', at)
  })
  const patch = store.artifacts.write(Buffer.from('diff --git a/src/a b/src/a\n'))
  store.artifacts.insert(patch)
  const report = store.artifacts.write(Buffer.from('# review report\n'))
  store.artifacts.insert(report)
  ports.routingEvidence.reviews.put({
    protocol: 'review-evidence/1', id: 'review-1', projectId: 'project-1',
    subject: { candidate: { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, candidateGeneration: 1 },
      artifactDigest: 'b'.repeat(64), baseCommit: 'f'.repeat(40), environmentRef: 'environment-1', checkPolicyRef: 'policy-1' },
    reviewerProfileRef: profile,
    reviewAttempt: { ticketId: 'review-ticket', assignmentId: 'review-assignment', attemptId: 'review-attempt',
      fenceEpoch: 1, contract: { workId: 'work-review', revision: 1, digest: 'a'.repeat(64) } },
    inputDigest: 'a'.repeat(64), reportDigest: 'e'.repeat(64), reportArtifactRef: report.id,
    isolation: { kind: 'sealed_copy', proofRef: 'capsule-proof', capsuleManifestDigest: 'a'.repeat(64) },
    evidenceRefs: ['review-evidence-1'], layer: 'controlled', disposition: 'no_findings', observedAt: at,
  })
  ports.routingEvidence.outcomes.put({
    protocol: 'execution-outcome/1', id: 'outcome-1', projectId: 'project-1',
    attempt: { ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract },
    profileRef: profile, candidate: { ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, candidateGeneration: 1 },
    verificationRef: 'verification-1', artifactDigest: 'b'.repeat(64), acceptance: 'accepted', acceptanceRef: 'acceptance-1',
    evidenceRefs: ['verification-1', 'acceptance-1'], layer: 'controlled',
    usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: at,
    reviewTiming: { candidateReadyAt: at, acceptedAt: '2026-11-11T00:01:40.000Z', readyToAcceptanceMs: 100000,
      activeReviewMs: 5000, activeReviewSource: 'ui_visibility_proxy', activeReviewCompleteness: 'partial',
      evidenceRefs: ['review-activity:1'] },
  })
  ports.recoveryIntents.record({
    commandId: 'recovery-command-1', actor: { userId: 'user-1', authorityRef: 'authority-1' },
    plan: { protocol: 'recovery-plan/1', planId: 'recovery-plan-1', inspectionFingerprint: 'f'.repeat(64),
      createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z',
      bindings: [{ sourceProjectId: 'project-1', proposedProjectId: 'project-1', path: '/tmp/project',
        headCommit: 'f'.repeat(40), configurationDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64) }],
      executor: { profileId: 'codex', revision: 1, version: '0.164.0', executableDigest: 'c'.repeat(64) },
      artifactsChecked: 0, artifactScanTruncated: false,
      blockers: [{ code: 'authorization_not_implemented', owner: 'main', detail: 'commit not connected' }],
      authorization: 'not_granted', commitAvailable: false },
    expectedInspectionFingerprint: 'f'.repeat(64), sourceFingerprint: 'f'.repeat(64), confirmedAt: at,
  })
  ports.recoveryActivations.put({
    protocol: 'recovery-activation-intent/1', activationId: 'activation-1', commandId: 'activation-command-1',
    planId: 'activation-plan-1', planDigest: 'b'.repeat(64),
    source: { stateId: 'state-source', stateRoot: '/tmp/source-state', markerDigest: 'c'.repeat(64), inspectionFingerprint: 'd'.repeat(64) },
    target: { generationId: 'generation-1', stateRoot: '/tmp/target-state', configurationDigest: 'e'.repeat(64) },
    principal: { userId: 'user-1', authorityRef: 'authority-1' },
    machineDigest: 'f'.repeat(64), resourcePolicyDigest: 'a'.repeat(64),
    createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z',
  })
  const replyRequestId = key('assistant-request', 'message-1'), replyMessageId = key('assistant-reply', 'message-1')
  const replyBodyValue = { protocol: 'assistant-reply-body/1', projectId: 'project-1', conversationId: 'conversation-1',
    sourceMessageId: 'message-1', replyMessageId, model: 'mock-model', text: 'completed', suggestions: [] }
  const replyBody = store.artifacts.write(new TextEncoder().encode(JSON.stringify(replyBodyValue)))
  store.artifacts.insert(replyBody)
  store.commands.record(replyRequestId, 'a'.repeat(64), () => ({ kind: 'assistant-inference/1',
    input: { messageId: 'message-1', conversationId: 'conversation-1', projectId: 'project-1' }, model: 'mock-model' }))
  ports.assistant.replyResults.put({ protocol: 'assistant-reply-result/1', requestId: replyRequestId,
    requestDigest: 'a'.repeat(64), sourceMessageId: 'message-1', replyMessageId,
    projectId: 'project-1', conversationId: 'conversation-1', principal: { userId: 'user-1', authorityRef: 'authority-1' },
    model: 'mock-model', artifactRef: replyBody.id, artifactDigest: replyBody.digest,
    textDigest: createHash('sha256').update('completed').digest('hex'), recordedAt: at })
  const bundle = store.artifacts.write(new TextEncoder().encode('{"context":"bounded"}'))
  store.artifacts.insert(bundle)
  ports.assistant.contextBindings.put({
    protocol: 'assistant-context-binding/1', commandId: 'context-command-1', messageId: 'message-1', requestId: 'context-request-1',
    projectId: 'project-1', conversationId: 'conversation-1', userTextDigest: 'e'.repeat(64),
    principal: { userId: 'user-1', authorityRef: 'authority-1' }, purpose: 'conversation_discussion', scope,
    contract, selections: ['work'], bundleRef: bundle.id, bundleDigest: bundle.digest,
    sources: [{ sourceId: 'work-1', kind: 'work', sourceDigest: 'e'.repeat(64), previewDigest: 'e'.repeat(64), truncated: false }],
    confirmedAt: at, expiresAt: '2026-11-11T00:04:00.000Z',
  })
  store.queue.enqueue('application.execute', 'snapshot-queue', '{"workId":"work-1"}', 1, 0, at)
  store.bindings.record({ attemptId: 'snapshot-attempt', ticketId: 'ticket-1', assignmentId: 'assignment-1', fenceEpoch: 3,
    contract, state: 'active', runnerIdentityRef: 'runner-snapshot', source: 'snapshot-test',
    resources: [{ ref: 'snapshot-process', ownership: 'spawned_process' }] })
  store.bindings.setCurrent('ticket-1', 'snapshot-attempt')
  store.product.questions.insert({ id: 'snapshot-question', version: 1, kind: 'clarification', contract, scope,
    prompt: 'Approve the snapshot fixture?', nativePayloadRef: bundle.id, presentation: { kind: 'free_text' },
    targets: [{ ticketId: 'ticket-1', assignmentId: 'assignment-1', contract, attemptId: 'snapshot-attempt', fenceEpoch: 3,
      id: 'snapshot-target', connectionEpoch: 1, nativeRequestId: { kind: 'string', value: 'native-req-1' },
      nativeMethod: 'question/ask', provenanceRef: 'provenance-1' }], openedAt: at, validity: 'open' })
  store.answers.record('snapshot-answer', { questionId: 'snapshot-question', expectedVersion: 1,
    digest: 'd'.repeat(64), answer: { kind: 'free_text', text: 'approved' } })
  store.answers.upsertDelivery('snapshot-answer', 'snapshot-target', 'local_recorded')
  store.db.prepare(`INSERT INTO runtime_observations
    (fact_id, ticket_id, assignment_id, attempt_id, fence_epoch, contract, kind, disposition, payload_ref, payload_sha256, detail, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('snapshot-observation', 'ticket-1', 'assignment-1', 'snapshot-attempt', 3,
    JSON.stringify(contract), 'process', 'running', bundle.id, 'f'.repeat(64), '{}', at)
  store.db.prepare(`INSERT INTO resource_observations
    (fact_id, attempt_id, resource_ref, ownership, kind, status, exit_code, signal, observed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('snapshot-observation', 'snapshot-attempt', 'snapshot-process',
    'spawned_process', 'process', 'running', null, null, at)
  return { root, store, ports, patch, report, bundle, replyBody, replyRequestId, replyMessageId }
}

test('schema-13 snapshot includes decisions/settings/contracts/verification/outcome and restores readably', async () => {
  const data = dataset()
  const snapshot = join(data.root, 'snapshot')
  const restored = join(data.root, 'restored')
  try {
    const result = await new WorkflowSnapshots(data.store).create({ destination: snapshot })
    assert.equal(result.status, 'ok', result.message)
    assert.equal(result.manifest.database.productSchema, PRODUCT_SCHEMA_VERSION)
    assert.equal(result.manifest.incompatibleSchema, false)
    assert.equal(result.manifest.complete, true)
    assert.deepEqual([...result.manifest.referencedArtifacts].sort(), [data.report.id, data.bundle.id, data.replyBody.id].sort())
    const families = new Map(result.manifest.evidence.families.map(family => [family.name, family]))
    assert.equal(families.get('decisions')!.count, 1)
    assert.equal(families.get('project_settings')!.count, 1)
    assert.equal(families.get('contracts')!.count, 1)
    assert.equal(families.get('verifications')!.count, 1)
    assert.equal(families.get('outcomes')!.count, 1)
    assert.equal(families.get('reviews')!.count, 1)
    assert.equal(families.get('recovery_intents')!.count, 1)
    assert.equal(families.get('recovery_activations')!.count, 1)
    assert.equal(families.get('assistant_context_bindings')!.count, 1)
    assert.equal(families.get('assistant_reply_results')!.count, 1)
    assert.equal(families.get('effect_queue')!.count, 1)
    assert.equal(families.get('runtime_bindings')!.count, 1)
    assert.equal(families.get('runtime_current')!.count, 1)
    assert.equal(families.get('resource_observations')!.count, 1)
    assert.equal(families.get('user_questions')!.count, 1)
    assert.equal(families.get('answers')!.count, 1)
    assert.equal(families.get('answer_deliveries')!.count, 1)
    assert.equal(result.manifest.evidence.complete, true)
    for (const row of result.manifest.artifacts)
      assert.equal(readFileSync(join(snapshot, row.snapshotPath)).length, row.bytes)

    // A "restore" is a byte copy into a new directory; D owns the actual policy.
    cpSync(snapshot, restored, { recursive: true })
    const verification = new WorkflowSnapshots(data.store).verify(restored)
    assert.equal(verification.status, 'ok', verification.message)
    assert.equal(verifyDatabase(join(restored, 'product.sqlite')).integrity, 'ok')

    // The restored binding stays audit-only: an inventory of the restored bytes still exports no
    // startup authority merely because a selected-context row survived.
    const targetRoot = join(data.root, 'restored-target')
    mkdirSync(targetRoot)
    cpSync(join(restored, 'product.sqlite'), join(targetRoot, 'state.sqlite'))
    const inventory = recoveryTargetInventory.inspect(targetRoot)
    assert.equal(inventory.completeness, 'complete')
    assert.equal(inventory.issues.includes('business_rows_present'), true)
    assert.equal(inventory.startupAvailable, false)

    // A main consumer reads the restored non-empty reply body without contacting a provider.
    const restoredStore = new ProductStore({ path: join(restored, 'product.sqlite') })
    try {
      const consumer = new CompletedAssistantReplies(restoredStore, restoredStore.workflows.assistant.replyResults,
        { userId: 'user-1', authorityRef: 'authority-1' }, () => ['project-1'])
      assert.equal(consumer.read(data.replyRequestId)?.text, 'completed')
      assert.equal(restoredStore.product.messages.getById('message-1')?.text, '保留这条决定。')
      assert.equal(restoredStore.product.contracts.getByRef(contract)?.digest, 'a'.repeat(64))
      assert.equal(restoredStore.commands.get(data.replyRequestId)?.payloadDigest, 'a'.repeat(64))
      assert.equal(restoredStore.bindings.current<{ fenceEpoch: number }>('ticket-1')?.fenceEpoch, 3)
      assert.equal(restoredStore.queue.dueRows('application.execute', Number.MAX_SAFE_INTEGER, 10)
        .some(row => row.key === 'snapshot-queue'), true)
      assert.equal(restoredStore.product.questions.get('snapshot-question')?.validity, 'open')
      assert.equal(restoredStore.answers.get('snapshot-answer')?.digest, 'd'.repeat(64))
      assert.equal(restoredStore.answers.deliveries('snapshot-answer')[0]?.status, 'local_recorded')
    } finally { restoredStore.close() }

    const db = new Database(join(restored, 'product.sqlite'), { readonly: true, fileMustExist: true })
    try {
      const decision = JSON.parse(String((db.prepare("SELECT value FROM user_decision_versions WHERE id = 'decision-1'").get() as { value: string }).value))
      assert.equal(decision.content, 'Keep the verified patch.')
      const metadata = db.prepare("SELECT source_text_digest FROM assistant_decision_versions WHERE id = 'decision-1'").get() as { source_text_digest: string }
      assert.equal(metadata.source_text_digest, 'e'.repeat(64))
      assert.equal((db.prepare("SELECT revision FROM project_settings_current WHERE project_id = 'project-1'").get() as { revision: number }).revision, 1)
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM contract_revisions WHERE work_id = 'work-1'").get() as { n: number }).n, 1)
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM completion_verifications WHERE id = 'verification-1'").get() as { n: number }).n, 1)
      const outcome = JSON.parse(String((db.prepare("SELECT value FROM execution_outcome WHERE id = 'outcome-1'").get() as { value: string }).value))
      assert.equal(outcome.acceptance, 'accepted')
      assert.equal(outcome.reviewTiming.readyToAcceptanceMs, 100000)
      assert.equal(outcome.reviewTiming.activeReviewMs, 5000)
      assert.equal((db.prepare("SELECT COUNT(*) AS n FROM review_evidence WHERE id = 'review-1'").get() as { n: number }).n, 1)
      const restoredReply = JSON.parse(String((db.prepare("SELECT value FROM assistant_reply_results WHERE request_id = ?").get(data.replyRequestId) as { value: string }).value))
      assert.equal(restoredReply.artifactRef, data.replyBody.id)
      assert.equal(restoredReply.replyMessageId, data.replyMessageId)
      const restoredBinding = JSON.parse(String((db.prepare("SELECT value FROM assistant_context_bindings WHERE message_id = 'message-1'").get() as { value: string }).value))
      assert.equal(restoredBinding.bundleRef, data.bundle.id)
      assert.equal(restoredBinding.purpose, 'conversation_discussion')
      assert.equal((db.prepare("SELECT report_artifact_ref FROM review_evidence WHERE id = 'review-1'").get() as { report_artifact_ref: string }).report_artifact_ref, data.report.id)
      const stored = db.prepare('SELECT digest, bytes FROM artifacts WHERE id = ?').get(data.patch.id) as { digest: string; bytes: number }
      assert.equal(stored.digest, data.patch.digest)
      assert.equal(stored.bytes, data.patch.bytes)
      const intent = JSON.parse(String((db.prepare("SELECT payload FROM recovery_intents WHERE plan_id = 'recovery-plan-1'").get() as { payload: string }).payload))
      assert.equal(intent.plan.authorization, 'not_granted')
      assert.equal(intent.plan.commitAvailable, false)
      assert.equal(JSON.stringify(intent).includes('credential'), false, 'a recovery intent carries no credential reference')
      const activation = JSON.parse(String((db.prepare("SELECT value FROM recovery_activations WHERE activation_id = 'activation-1'").get() as { value: string }).value))
      assert.equal(activation.target.stateRoot, '/tmp/target-state')
      assert.equal(activation.source.stateRoot, '/tmp/source-state')
      assert.equal(JSON.stringify(activation).includes('credential'), false, 'an activation fact carries no credential reference')
      assert.equal(JSON.stringify(activation).includes('token'), false)
    } finally { db.close() }
  } finally {
    data.store.close()
    rmSync(data.root, { recursive: true, force: true })
  }
})

test('a selected-context binding whose bundle artifact row is absent blocks the snapshot', async () => {
  const data = dataset()
  const snapshot = join(data.root, 'snapshot-missing-bundle')
  try {
    data.store.db.prepare('DELETE FROM artifacts WHERE id = ?').run(data.bundle.id)
    data.store.db.prepare('DELETE FROM artifacts WHERE id = ?').run(data.replyBody.id)
    const result = await new WorkflowSnapshots(data.store).create({ destination: snapshot })
    assert.equal(result.status, 'blocked')
    assert.deepEqual(result.manifest.missingReferences, [data.bundle.id, data.replyBody.id].sort())
    assert.equal(result.manifest.complete, false)
  } finally {
    data.store.close()
    rmSync(data.root, { recursive: true, force: true })
  }
})

test('missing file, changed bytes and a newer schema make the snapshot unusable', async () => {
  const data = dataset()
  const snapshot = join(data.root, 'snapshot')
  try {
    const created = await new WorkflowSnapshots(data.store).create({ destination: snapshot })
    assert.equal(created.status, 'ok', created.message)
    const first = created.manifest.artifacts[0]!

    const missingDir = join(data.root, 'missing-copy')
    cpSync(snapshot, missingDir, { recursive: true })
    unlinkSync(join(missingDir, first.snapshotPath))
    const missing = new WorkflowSnapshots(data.store).verify(missingDir)
    assert.equal(missing.status, 'blocked')
    assert.equal(missing.artifacts.some(item => item.id === first.id && item.status === 'missing'), true)

    const corruptDir = join(data.root, 'corrupt-copy')
    cpSync(snapshot, corruptDir, { recursive: true })
    const bytes = readFileSync(join(corruptDir, first.snapshotPath))
    bytes.writeUInt8((bytes[0] ?? 0) ^ 0xff, 0)
    writeFileSync(join(corruptDir, first.snapshotPath), bytes)
    const corrupt = new WorkflowSnapshots(data.store).verify(corruptDir)
    assert.equal(corrupt.status, 'blocked')
    assert.equal(corrupt.artifacts.some(item => item.id === first.id && item.status === 'corrupt'), true)

    // A newer schema cannot be restored by this build; opening it is refused by the migration entry.
    const futureDir = join(data.root, 'future-copy')
    cpSync(snapshot, futureDir, { recursive: true })
    const futureDatabase = join(futureDir, 'product.sqlite')
    const db = new Database(futureDatabase)
    try {
      db.prepare("UPDATE schema_meta SET value = '99' WHERE key = 'product_schema'").run()
      const migrations = JSON.parse(String((db.prepare("SELECT value FROM schema_meta WHERE key = 'migrations'").get() as { value: string }).value))
      migrations.push({ version: 99, name: 'future-v99', checksum: 'x', appliedAt: at })
      db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'migrations'").run(JSON.stringify(migrations))
    } finally { db.close() }
    const manifestPath = join(futureDir, 'snapshot.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const futureBytes = readFileSync(futureDatabase)
    const { createHash } = await import('node:crypto')
    manifest.database.sha256 = createHash('sha256').update(futureBytes).digest('hex')
    manifest.database.bytes = futureBytes.byteLength
    manifest.database.productSchema = 99
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    const future = new WorkflowSnapshots(data.store).verify(futureDir)
    assert.equal(future.status, 'blocked')
    assert.match(String(future.message), /schema 99|not restorable/)
    assert.throws(() => new ProductStore({ path: futureDatabase }), /newer than this build|not registered|gap at version 99/)

    // A row-level change with re-recorded database bytes is still caught by the evidence digest.
    const tamperedDir = join(data.root, 'tampered-copy')
    cpSync(snapshot, tamperedDir, { recursive: true })
    const tamperedDatabase = join(tamperedDir, 'product.sqlite')
    const tamperDb = new Database(tamperedDatabase)
    try {
      const row = tamperDb.prepare("SELECT value FROM user_decision_versions WHERE id = 'decision-1'").get() as { value: string }
      const value = JSON.parse(row.value)
      tamperDb.prepare("UPDATE user_decision_versions SET value = ? WHERE id = 'decision-1'")
        .run(JSON.stringify({ ...value, content: 'A different decision body' }))
    } finally { tamperDb.close() }
    const tamperedManifestPath = join(tamperedDir, 'snapshot.json')
    const tamperedManifest = JSON.parse(readFileSync(tamperedManifestPath, 'utf8'))
    const tamperedBytes = readFileSync(tamperedDatabase)
    tamperedManifest.database.sha256 = createHash('sha256').update(tamperedBytes).digest('hex')
    tamperedManifest.database.bytes = tamperedBytes.byteLength
    writeFileSync(tamperedManifestPath, JSON.stringify(tamperedManifest, null, 2))
    const tampered = new WorkflowSnapshots(data.store).verify(tamperedDir)
    assert.equal(tampered.status, 'blocked', 'reference evidence detects a row change even with a re-recorded DB hash')

    // A changed completed-reply result body with re-recorded database bytes is still caught.
    const replyTamperDir = join(data.root, 'reply-tamper-copy')
    cpSync(snapshot, replyTamperDir, { recursive: true })
    const replyTamperDb = join(replyTamperDir, 'product.sqlite')
    const replyTamper = new Database(replyTamperDb)
    try {
      const row = replyTamper.prepare("SELECT value FROM assistant_reply_results WHERE request_id = ?").get(data.replyRequestId) as { value: string }
      replyTamper.prepare("UPDATE assistant_reply_results SET value = ?, text_digest = ? WHERE request_id = ?")
        .run(JSON.stringify({ ...JSON.parse(row.value), textDigest: '9'.repeat(64) }), '9'.repeat(64), data.replyRequestId)
    } finally { replyTamper.close() }
    const replyTamperManifestPath = join(replyTamperDir, 'snapshot.json')
    const replyTamperManifest = JSON.parse(readFileSync(replyTamperManifestPath, 'utf8'))
    const replyTamperBytes = readFileSync(replyTamperDb)
    replyTamperManifest.database.sha256 = createHash('sha256').update(replyTamperBytes).digest('hex')
    replyTamperManifest.database.bytes = replyTamperBytes.byteLength
    writeFileSync(replyTamperManifestPath, JSON.stringify(replyTamperManifest, null, 2))
    const replyTampered = new WorkflowSnapshots(data.store).verify(replyTamperDir)
    assert.equal(replyTampered.status, 'blocked', 'a changed completed reply result is detected through its family digest')

    // The derived work index and queue body are covered by the new families.
    const workIndexDir = join(data.root, 'work-index-tamper')
    cpSync(snapshot, workIndexDir, { recursive: true })
    const workIndexDb = join(workIndexDir, 'product.sqlite')
    const workIndex = new Database(workIndexDb)
    try { workIndex.prepare("UPDATE assistant_context_bindings SET work_id = 'foreign-work' WHERE message_id = 'message-1'").run() } finally { workIndex.close() }
    const workIndexManifestPath = join(workIndexDir, 'snapshot.json')
    const workIndexManifest = JSON.parse(readFileSync(workIndexManifestPath, 'utf8'))
    const workIndexBytes = readFileSync(workIndexDb)
    workIndexManifest.database.sha256 = createHash('sha256').update(workIndexBytes).digest('hex')
    workIndexManifest.database.bytes = workIndexBytes.byteLength
    writeFileSync(workIndexManifestPath, JSON.stringify(workIndexManifest, null, 2))
    assert.equal(new WorkflowSnapshots(data.store).verify(workIndexDir).status, 'blocked',
      'a changed derived work_id is detected through the binding family')

    const queueDir = join(data.root, 'queue-tamper')
    cpSync(snapshot, queueDir, { recursive: true })
    const queueDb = join(queueDir, 'product.sqlite')
    const queue = new Database(queueDb)
    try { queue.prepare("UPDATE effect SET value = ? WHERE key = 'snapshot-queue'").run('{"workId":"other"}') } finally { queue.close() }
    const queueManifestPath = join(queueDir, 'snapshot.json')
    const queueManifest = JSON.parse(readFileSync(queueManifestPath, 'utf8'))
    const queueBytes = readFileSync(queueDb)
    queueManifest.database.sha256 = createHash('sha256').update(queueBytes).digest('hex')
    queueManifest.database.bytes = queueBytes.byteLength
    writeFileSync(queueManifestPath, JSON.stringify(queueManifest, null, 2))
    assert.equal(new WorkflowSnapshots(data.store).verify(queueDir).status, 'blocked',
      'a changed queue body is detected through the effect family')

    // Removing the activation table is not an empty-but-valid backup: the evidence family disappears.
    const missingTableDir = join(data.root, 'missing-table-copy')
    cpSync(snapshot, missingTableDir, { recursive: true })
    const missingTableDb = join(missingTableDir, 'product.sqlite')
    const dropDb = new Database(missingTableDb)
    try { dropDb.exec('DROP TABLE recovery_activations') } finally { dropDb.close() }
    const dropManifestPath = join(missingTableDir, 'snapshot.json')
    const dropManifest = JSON.parse(readFileSync(dropManifestPath, 'utf8'))
    const dropBytes = readFileSync(missingTableDb)
    dropManifest.database.sha256 = createHash('sha256').update(dropBytes).digest('hex')
    dropManifest.database.bytes = dropBytes.byteLength
    writeFileSync(dropManifestPath, JSON.stringify(dropManifest, null, 2))
    const dropped = new WorkflowSnapshots(data.store).verify(missingTableDir)
    assert.equal(dropped.status, 'blocked', 'a missing activation table is not silently treated as empty evidence')

    const missingBindingDir = join(data.root, 'missing-binding-copy')
    cpSync(snapshot, missingBindingDir, { recursive: true })
    const missingBindingDb = join(missingBindingDir, 'product.sqlite')
    const dropBindingDb = new Database(missingBindingDb)
    try { dropBindingDb.exec('DROP TABLE assistant_context_bindings') } finally { dropBindingDb.close() }
    const bindingManifestPath = join(missingBindingDir, 'snapshot.json')
    const bindingManifest = JSON.parse(readFileSync(bindingManifestPath, 'utf8'))
    const bindingBytes = readFileSync(missingBindingDb)
    bindingManifest.database.sha256 = createHash('sha256').update(bindingBytes).digest('hex')
    bindingManifest.database.bytes = bindingBytes.byteLength
    writeFileSync(bindingManifestPath, JSON.stringify(bindingManifest, null, 2))
    const missingBinding = new WorkflowSnapshots(data.store).verify(missingBindingDir)
    assert.equal(missingBinding.status, 'blocked', 'a missing binding table is not silently treated as empty evidence')

    const missingReplyDir = join(data.root, 'missing-reply-copy')
    cpSync(snapshot, missingReplyDir, { recursive: true })
    const missingReplyDb = join(missingReplyDir, 'product.sqlite')
    const dropReplyDb = new Database(missingReplyDb)
    try { dropReplyDb.exec('DROP TABLE assistant_reply_results') } finally { dropReplyDb.close() }
    const replyManifestPath = join(missingReplyDir, 'snapshot.json')
    const replyManifest = JSON.parse(readFileSync(replyManifestPath, 'utf8'))
    const replyBytes = readFileSync(missingReplyDb)
    replyManifest.database.sha256 = createHash('sha256').update(replyBytes).digest('hex')
    replyManifest.database.bytes = replyBytes.byteLength
    writeFileSync(replyManifestPath, JSON.stringify(replyManifest, null, 2))
    const missingReply = new WorkflowSnapshots(data.store).verify(missingReplyDir)
    assert.equal(missingReply.status, 'blocked', 'a missing reply result table is not silently treated as empty evidence')
  } finally {
    data.store.close()
    rmSync(data.root, { recursive: true, force: true })
  }
})

test('a v2 evidence manifest requires the exact complete family set while a v1 manifest keeps its recorded scope', async () => {
  const data = dataset(), snapshot = join(data.root, 'snapshot-versioned')
  try {
    const created = await new WorkflowSnapshots(data.store).create({ destination: snapshot })
    assert.equal(created.status, 'ok', created.message)
    assert.equal(created.manifest.protocol, 'workflow-snapshot/2')
    assert.equal(created.manifest.evidence.protocol, 'workflow-evidence/2')
    assert.equal(created.manifest.evidence.familySetVersion, 2)
    const copy = (name: string) => { const target = join(data.root, name); cpSync(snapshot, target, { recursive: true }); return target }
    const rewrite = (target: string, mutate: (manifest: any) => void) => {
      const manifestPath = join(target, 'snapshot.json'), manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      mutate(manifest); writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
    }
    for (const [name, mutate] of [
      ['drop-family', (manifest: any) => { manifest.evidence.families = manifest.evidence.families.filter((family: any) => family.name !== 'effect_queue') }],
      ['one-family', (manifest: any) => { manifest.evidence.families = manifest.evidence.families.slice(0, 1) }],
      ['duplicate-family', (manifest: any) => { manifest.evidence.families.push({ ...manifest.evidence.families[0] }) }],
      ['unknown-family', (manifest: any) => { manifest.evidence.families[0] = { ...manifest.evidence.families[0], name: 'unknown_family' } }],
      ['future-version', (manifest: any) => { manifest.evidence.familySetVersion = 3 }],
      ['mixed-old-snapshot-new-evidence', (manifest: any) => { manifest.protocol = 'workflow-snapshot/1'; delete manifest.evidence.familySetVersion }],
      ['v2-missing-family-version', (manifest: any) => { delete manifest.evidence.familySetVersion }],
      ['v2-evidence-v1', (manifest: any) => { manifest.evidence.protocol = 'workflow-evidence/1' }],
    ] as const) {
      const target = copy(name); rewrite(target, mutate)
      assert.equal(new WorkflowSnapshots(data.store).verify(target).status, 'blocked', name)
    }

    const legacy = copy('legacy-v1')
    rewrite(legacy, manifest => {
      manifest.protocol = 'workflow-snapshot/1'
      manifest.evidence.protocol = 'workflow-evidence/1'
      delete manifest.evidence.familySetVersion
      manifest.evidence.families = manifest.evidence.families.slice(0, 2)
    })
    assert.equal(new WorkflowSnapshots(data.store).verify(legacy).status, 'ok',
      'a v1 manifest is verified against the families it actually recorded')

    for (const [name, mutate] of [
      ['missing-empty-table', (db: any) => db.exec('DROP TABLE assistant_reply_results')],
      ['missing-required-index', (db: any) => db.exec('DROP INDEX assistant_context_history_scope')],
      ['unknown-table', (db: any) => db.exec('CREATE TABLE unexpected_snapshot_table (id TEXT PRIMARY KEY)')],
    ] as const) {
      const target = copy(name), databasePath = join(target, 'product.sqlite')
      const database = new Database(databasePath)
      try { mutate(database) } finally { database.close() }
      rewrite(target, manifest => {
        const bytes = readFileSync(databasePath)
        manifest.database.bytes = bytes.byteLength
        manifest.database.sha256 = createHash('sha256').update(bytes).digest('hex')
      })
      assert.equal(new WorkflowSnapshots(data.store).verify(target).status, 'blocked', name)
    }
  } finally {
    data.store.close(); rmSync(data.root, { recursive: true, force: true })
  }
})
