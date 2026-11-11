#!/usr/bin/env node
/**
 * D-consumable snapshot recipe: create a schema-13 snapshot from a temporary state, verify it,
 * byte-copy it to a new directory (a restore stand-in), and re-verify/read the durable evidence.
 * Uses only public ports. No model, account, network or user service is touched.
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ProductStore, verifyDatabase } from '@personal-agent/storage'
import { createWorkflowPorts, WorkflowSnapshots } from '../src/index.ts'

const root = mkdtempSync(join(tmpdir(), 'pa-d-snapshot-'))
const at = '2026-11-11T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const profile = { profileId: 'codex', revision: 3, identityDigest: 'a'.repeat(64) }
const store = new ProductStore({ path: join(root, 'state.sqlite') })
try {
  const ports = createWorkflowPorts(store)
  store.product.messages.append({
    id: 'message-1', conversationId: 'conversation-1', projectId: 'project-1', role: 'user',
    provenance: 'trusted_user', text: '保留已验证补丁。', sourceRefs: [], createdAt: at,
  })
  store.uow.atomic(() => {
    store.product.works.insert({ id: 'work-1', projectId: 'project-1', conversationId: 'conversation-1', title: 'Snapshot', createdAt: at })
    store.product.contracts.append({ ...contract, goal: 'Deliver', scope,
      criteria: [{ id: 'unit', kind: 'machine', description: 'Unit', required: true, checkDefinitionRef: 'check-1' }],
      authorityRef: 'authority-1', createdAt: at })
    ports.assistant.decisions.put({
      decision: { id: 'decision-1', version: 1, content: 'Keep the verified patch.', scope, authorityRef: 'authority-1' },
      sourceMessageId: 'message-1', sourceTextDigest: 'e'.repeat(64), conversationId: 'conversation-1',
      actorRef: 'actor-1', recordedAt: at,
    }, 0)
    ports.routingEvidence.outcomes.put({
      protocol: 'execution-outcome/1', id: 'outcome-1', projectId: 'project-1',
      attempt: { ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract },
      profileRef: profile, acceptance: 'unknown', evidenceRefs: [], layer: 'controlled',
      usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: at,
      reviewTiming: { candidateReadyAt: at, acceptedAt: '2026-11-11T00:01:40.000Z', readyToAcceptanceMs: 100000,
        activeReviewMs: null, activeReviewSource: 'unknown', activeReviewCompleteness: 'unknown', evidenceRefs: [] },
    })
  })
  const patch = store.artifacts.write(Buffer.from('diff --git a/src/a b/src/a\n'))
  store.artifacts.insert(patch)
  ports.recoveryIntents.record({
    commandId: 'recovery-command-1', actor: { userId: 'user-1', authorityRef: 'authority-1' },
    plan: { protocol: 'recovery-plan/1', planId: 'recovery-plan-1', inspectionFingerprint: 'f'.repeat(64),
      createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z',
      bindings: [{ sourceProjectId: 'project-1', proposedProjectId: 'project-1', path: '/tmp/project',
        headCommit: 'f'.repeat(40), configurationDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64) }],
      executor: { profileId: 'codex', revision: 1, version: '0.164.0', executableDigest: 'c'.repeat(64) },
      artifactsChecked: 1, artifactScanTruncated: false,
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
  const snapshot = join(root, 'snapshot')
  const snapshots = new WorkflowSnapshots(store)
  const created = await snapshots.create({ destination: snapshot })
  const restored = join(root, 'restored')
  cpSync(snapshot, restored, { recursive: true })
  const verified = snapshots.verify(restored)
  const db = new Database(join(restored, 'product.sqlite'), { readonly: true, fileMustExist: true })
  let summary
  try {
    summary = {
      decisions: db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get().n,
      outcomes: db.prepare("SELECT COUNT(*) AS n FROM execution_outcome WHERE id = 'outcome-1'").get().n,
      settings: db.prepare('SELECT COUNT(*) AS n FROM project_settings_versions').get().n,
      recoveryIntents: db.prepare('SELECT COUNT(*) AS n FROM recovery_intents').get().n,
      recoveryActivations: db.prepare('SELECT COUNT(*) AS n FROM recovery_activations').get().n,
      activationTarget: JSON.parse(String(db.prepare("SELECT value FROM recovery_activations WHERE activation_id = 'activation-1'").get().value)).target.stateRoot,
      intentAuthorization: JSON.parse(String(db.prepare("SELECT payload FROM recovery_intents WHERE plan_id = 'recovery-plan-1'").get().payload)).plan.authorization,
    }
  } finally { db.close() }
  console.log(JSON.stringify({
    protocol: 'd-snapshot-recipe/1',
    status: created.status === 'ok' && verified.status === 'ok' ? 'ok' : 'blocked',
    manifest: { schema: created.manifest.database.productSchema, complete: created.manifest.complete,
      artifacts: created.manifest.artifacts.length, families: created.manifest.evidence.families.map(family => [family.name, family.count]) },
    restored: { verify: verified.status, integrity: verifyDatabase(join(restored, 'product.sqlite')).integrity, summary },
  }, null, 2))
} finally {
  store.close()
  rmSync(root, { recursive: true, force: true })
}
