/**
 * Evidence coverage: a consistent database is not enough; the bundle must record what evidence was
 * readable and restore must fail closed if a restored database disagrees with that record.
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { ProductStore } from '@personal-agent/storage'
import { createBundle, readEvidenceSummary, restoreBundle, snapshotState, verifyEvidenceSummary } from '../src/index.ts'

const base = () => {
  const root = mkdtempSync(join(tmpdir(), 'pa-evidence-'))
  const stateDir = join(root, 'state')
  mkdirSync(stateDir, { recursive: true, mode: 0o700 })
  mkdirSync(join(root, 'staging'), { recursive: true, mode: 0o700 })
  return { root, stateDir, staging: join(root, 'staging') }
}

function seedState(stateDir: string) {
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  try {
    const now = new Date().toISOString()
    store.workflows.projects.append({
      projectId: 'project-evidence',
      expectedRevision: 0,
      settings: { pathDigest: 'a'.repeat(64), check: 'node_test', sourceRef: 'fixture-source' },
      createdAt: now,
    })
    store.product.works.insert({ id: 'work-evidence', projectId: 'project-evidence', conversationId: 'conv-evidence', title: 'evidence work', createdAt: now })
    const artifact = store.artifacts.write(Buffer.from('completed patch bytes\n'))
    store.artifacts.insert(artifact)
    store.events.append({
      topic: 'application.candidate.accepted',
      entityRef: 'work-evidence',
      payload: {
        candidate: {
          ticketId: 'ticket-evidence',
          assignmentId: 'assignment-evidence',
          contract: { workId: 'work-evidence', revision: 1, digest: 'c'.repeat(64) },
          candidateGeneration: 1,
        },
        actorRef: 'local-user',
        reviewTiming: {
          candidateReadyAt: now,
          acceptedAt: now,
          readyToAcceptanceMs: 0,
          activeReviewMs: null,
          activeReviewSource: 'ui_visibility_proxy',
          activeReviewCompleteness: 'unknown',
          evidenceRefs: [],
        },
      },
    })
    return { artifactId: artifact.id, artifactDigest: artifact.digest }
  } finally {
    store.close()
  }
}

test('the snapshot records readable project/work/artifact evidence and marks routing evidence unavailable', async (t) => {
  const { root, stateDir, staging } = base()
  try {
    const seeded = seedState(stateDir)
    const snapshot = await snapshotState({ stateDir, stagingDir: join(staging, 'files') })
    assert.equal(snapshot.evidence.protocol, 'personal-evidence')
    assert.equal(snapshot.evidence.counts.projects, 1)
    assert.equal(snapshot.evidence.counts.works, 1)
    assert.equal(snapshot.evidence.counts.artifacts, 1)
    assert.equal(snapshot.evidence.counts.acceptedEvents, 1)
    assert.equal(snapshot.evidence.acceptedEvents[0]?.candidate?.workId, 'work-evidence')
    assert.equal(snapshot.evidence.acceptedEvents[0]?.actorRef, 'local-user')
    assert.ok(snapshot.evidence.acceptedEvents[0]?.payloadDigest.length === 64)
    assert.equal(snapshot.evidence.artifacts[0]?.id, seeded.artifactId)
    assert.equal(snapshot.evidence.projects[0]?.id, 'project-evidence')
    assert.equal(snapshot.evidence.works[0]?.id, 'work-evidence')
    assert.equal(snapshot.evidence.routingEvidence.status, 'unavailable')
    assert.ok(snapshot.evidence.routingEvidence.requiredPorts.length >= 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the bundle carries the evidence digest and restore re-reads every covered class', async (t) => {
  const { root, stateDir, staging } = base()
  try {
    seedState(stateDir)
    const snapshot = await snapshotState({ stateDir, stagingDir: join(staging, 'snapshot') })
    const bundle = await createBundle({
      stateDir,
      outputPath: join(root, 'state.pab'),
      stagingRoot: staging,
      productVersion: '0.1.0',
    })
    assert.equal(bundle.manifest.evidence?.digest, snapshot.evidence.digest)
    assert.deepEqual(bundle.manifest.evidence?.counts, snapshot.evidence.counts)
    assert.equal(bundle.manifest.evidence?.routingEvidence.status, 'unavailable')

    const target = join(root, 'restored')
    const restored = await restoreBundle({ bundlePath: bundle.bundlePath, targetStateDir: target, stagingRoot: staging })
    assert.equal(restored.report.evidence.status, 'verified')
    assert.equal(restored.report.evidence.digest, snapshot.evidence.digest)
    assert.deepEqual(restored.report.evidence.counts, snapshot.evidence.counts)
    assert.equal(restored.report.evidence.routingEvidence?.status, 'unavailable')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('evidence verification fails closed when a restored database gains evidence after the bundle', async (t) => {
  const { root, stateDir, staging } = base()
  try {
    seedState(stateDir)
    const bundle = await createBundle({ stateDir, outputPath: join(root, 'state.pab'), stagingRoot: staging, productVersion: '0.1.0' })
    const target = join(root, 'restored')
    await restoreBundle({ bundlePath: bundle.bundlePath, targetStateDir: target, stagingRoot: staging })
    const restoredDb = join(target, 'state.sqlite')
    const before = readEvidenceSummary(restoredDb)
    const store = new ProductStore({ path: restoredDb })
    try {
      store.workflows.projects.append({
        projectId: 'project-evidence',
        expectedRevision: 1,
        settings: { pathDigest: 'b'.repeat(64), check: 'node_test', sourceRef: 'changed-after-bundle' },
      })
    } finally {
      store.close()
    }
    const verified = verifyEvidenceSummary(restoredDb, before)
    assert.equal(verified.ok, false)
    assert.ok(verified.mismatches.includes('digest'))
    assert.ok(verified.mismatches.includes('projects'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a missing database-referenced artifact refuses the bundle instead of claiming success', async (t) => {
  const { root, stateDir, staging } = base()
  try {
    const seeded = seedState(stateDir)
    rmSync(join(stateDir, 'artifacts', seeded.artifactId), { force: true })
    await assert.rejects(
      () => snapshotState({ stateDir, stagingDir: join(staging, 'files') }),
      (error: unknown) => (error as { code?: string }).code === 'artifact_missing',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a symlinked artifact is refused instead of copying bytes from outside the state', async (t) => {
  const { root, stateDir, staging } = base()
  try {
    const seeded = seedState(stateDir)
    const artifactPath = join(stateDir, 'artifacts', seeded.artifactId)
    rmSync(artifactPath, { force: true })
    symlinkSync('/etc/hosts', artifactPath)
    await assert.rejects(
      () => snapshotState({ stateDir, stagingDir: join(staging, 'files') }),
      (error: unknown) => (error as { code?: string }).code === 'artifact_missing',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a future database schema is refused before a bundle can be certified', async (t) => {
  const { root, stateDir, staging } = base()
  try {
    seedState(stateDir)
    const db = new Database(join(stateDir, 'state.sqlite'))
    try {
      db.prepare("UPDATE schema_meta SET value = '999' WHERE key = 'product_schema'").run()
    } finally {
      db.close()
    }
    await assert.rejects(
      () => snapshotState({ stateDir, stagingDir: join(staging, 'files') }),
      (error: unknown) => (error as { code?: string }).code === 'schema_unsupported',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
