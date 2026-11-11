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
import { MIGRATIONS, PRODUCT_SCHEMA_VERSION, ProductStore, applyMigrations } from '@personal-agent/storage'
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
          contract: { workId: 'work-evidence', revision: 1, digest: 'c0'.repeat(32) },
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
    const profile = { profileId: 'codex-cli', revision: 1, identityDigest: 'ef'.repeat(32) }
    store.workflows.routingEvidence.advice.put({
      protocol: 'route-advice/1',
      id: 'advice-evidence',
      projectId: 'project-evidence',
      sourceRef: 'source-evidence',
      taskContextDigest: 'ab'.repeat(32),
      catalogRevision: 'cd'.repeat(32),
      policyRevision: 'policy-evidence',
      eligibleProfileRefs: [profile],
      suggestedProfileRef: profile,
      excluded: [],
      basis: 'only_eligible',
      evidenceRefs: ['evidence-route-support'],
      reviewSuggested: false,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + 300_000).toISOString(),
    })
    store.workflows.routingEvidence.reviews.put({
      protocol: 'review-evidence/1',
      id: 'review-evidence',
      projectId: 'project-evidence',
      subject: {
        candidate: {
          ticketId: 'ticket-evidence', assignmentId: 'assignment-evidence', candidateGeneration: 1,
          contract: { workId: 'work-evidence', revision: 1, digest: 'c0'.repeat(32) },
        },
        artifactDigest: artifact.digest, baseCommit: '9'.repeat(40), environmentRef: 'environment-evidence', checkPolicyRef: 'policy-check-evidence',
      },
      reviewerProfileRef: profile,
      reviewAttempt: {
        ticketId: 'ticket-review', assignmentId: 'assignment-review', attemptId: 'attempt-review', fenceEpoch: 1,
        contract: { workId: 'work-review', revision: 1, digest: 'e1'.repeat(32) },
      },
      inputDigest: 'df'.repeat(32),
      reportDigest: 'bd'.repeat(32),
      reportArtifactRef: artifact.id,
      isolation: { kind: 'sealed_copy', proofRef: 'isolation-proof-evidence', capsuleManifestDigest: 'ce'.repeat(32) },
      evidenceRefs: [],
      layer: 'controlled',
      disposition: 'findings',
      observedAt: now,
    })
    store.workflows.routingEvidence.outcomes.put({
      protocol: 'execution-outcome/1',
      id: 'outcome-evidence',
      projectId: 'project-evidence',
      attempt: {
        ticketId: 'ticket-evidence', assignmentId: 'assignment-evidence', attemptId: 'attempt-evidence', fenceEpoch: 1,
        contract: { workId: 'work-evidence', revision: 1, digest: 'c0'.repeat(32) },
      },
      profileRef: profile,
      acceptance: 'accepted',
      acceptanceRef: 'acceptance-evidence',
      verificationRef: 'verification-evidence',
      artifactDigest: artifact.digest,
      candidate: {
        ticketId: 'ticket-evidence', assignmentId: 'assignment-evidence', candidateGeneration: 1,
        contract: { workId: 'work-evidence', revision: 1, digest: 'c0'.repeat(32) },
      },
      evidenceRefs: ['acceptance-evidence'],
      layer: 'controlled',
      usage: { completeness: 'unknown', evidenceRefs: [] },
      observedAt: now,
    })
    return { artifactId: artifact.id, artifactDigest: artifact.digest }
  } finally {
    store.close()
  }
}

test('the snapshot records readable project/work/artifact and A routing evidence through the public ports', async (t) => {
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
    assert.equal(snapshot.evidence.formatVersion, 2)
    assert.equal(snapshot.evidence.routingEvidence.status, 'included')
    if (snapshot.evidence.routingEvidence.status !== 'included') throw new Error('routing evidence not included')
    assert.equal(snapshot.evidence.counts.routeAdvice, 1)
    assert.equal(snapshot.evidence.counts.reviewEvidence, 1)
    assert.equal(snapshot.evidence.counts.executionOutcomes, 1)
    assert.equal(snapshot.evidence.routingEvidence.advice[0]?.id, 'advice-evidence')
    assert.equal(snapshot.evidence.routingEvidence.reviews[0]?.disposition, 'findings')
    assert.equal(snapshot.evidence.routingEvidence.outcomes[0]?.acceptance, 'accepted')
    assert.deepEqual(snapshot.evidence.routingEvidence.artifactRefs, [seeded.artifactId])
    assert.deepEqual(snapshot.evidence.routingEvidence.missingArtifactRefs, [])
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
    assert.equal(bundle.manifest.evidence?.routingEvidence.status, 'included')
    assert.equal(bundle.manifest.evidence?.counts.reviewEvidence, 1)

    const target = join(root, 'restored')
    const restored = await restoreBundle({ bundlePath: bundle.bundlePath, targetStateDir: target, stagingRoot: staging })
    assert.equal(restored.report.evidence.status, 'verified')
    assert.equal(restored.report.evidence.digest, snapshot.evidence.digest)
    assert.deepEqual(restored.report.evidence.counts, snapshot.evidence.counts)
    assert.equal(restored.report.evidence.routingEvidence?.status, 'included')
    assert.equal(restored.report.evidence.legacyFormat, false)
    assert.equal(restored.report.evidence.migratedSchema, false)
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
    assert.equal(verified.actual.counts.projects, 1)
    assert.notEqual(verified.actual.digest, before.digest)
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

/**
 * Produces a schema-12 fixture: create real records through the public store, then remove the v13
 * tables. v13 only adds tables/indexes, so this is structurally the database an older build writes.
 */
const seedSchema12 = (stateDir: string, scratchPath: string) => {
  const store = new ProductStore({ path: join(stateDir, 'state.sqlite') })
  try {
    store.workflows.projects.append({
      projectId: 'project-legacy',
      expectedRevision: 0,
      settings: { pathDigest: 'b2'.repeat(32), check: 'node_test', sourceRef: 'legacy' },
      createdAt: new Date().toISOString(),
    })
    store.close()
  } catch (error) {
    store.close()
    throw error
  }
  // A real schema-12 shape: apply only the recorded v1..v12 registry to a scratch file, then remove
  // from the fixture every table a later migration introduced (the legacy bundle must not contain
  // tables its recorded schema never had).
  const scratch = new Database(scratchPath)
  try { applyMigrations(scratch, { registry: MIGRATIONS.filter((entry) => entry.version <= 12) }) } finally { scratch.close() }
  const allowed = new Set<string>()
  const scratchRead = new Database(scratchPath, { readonly: true })
  try {
    for (const row of scratchRead.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]) allowed.add(row.name)
  } finally { scratchRead.close() }
  const db = new Database(join(stateDir, 'state.sqlite'))
  try {
    const present = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    for (const table of present) if (!allowed.has(table.name) && table.name !== 'sqlite_sequence') db.exec(`DROP TABLE "${table.name}"`)
    db.prepare("UPDATE schema_meta SET value = '12' WHERE key = 'product_schema'").run()
    const applied = JSON.parse(String((db.prepare("SELECT value FROM schema_meta WHERE key = 'migrations'").get() as { value: string }).value)) as { version: number }[]
    db.prepare("UPDATE schema_meta SET value = ? WHERE key = 'migrations'").run(JSON.stringify(applied.filter((entry) => entry.version <= 12)))
    return Number((db.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as { value: string }).value)
  } finally {
    db.close()
  }
}

test('a schema-12 state is recorded as legacy evidence and restores into the current-schema build without losing records', async (t) => {
  const { root, stateDir, staging } = base()
  try {
    assert.equal(seedSchema12(stateDir, join(root, 'scratch-12.sqlite')), 12)
    const snapshot = await snapshotState({ stateDir, stagingDir: join(staging, 'files') })
    assert.equal(snapshot.evidence.formatVersion, 1)
    assert.equal(snapshot.evidence.productSchema, 12)
    assert.equal(snapshot.evidence.routingEvidence.status, 'unavailable')
    const bundle = await createBundle({ stateDir, outputPath: join(root, 'legacy.pab'), stagingRoot: staging, productVersion: '0.1.0' })
    assert.equal(bundle.manifest.evidence?.formatVersion, 1)
    assert.equal(bundle.manifest.evidence?.routingEvidence.status, 'unavailable')

    const target = join(root, 'restored')
    const restored = await restoreBundle({ bundlePath: bundle.bundlePath, targetStateDir: target, stagingRoot: staging })
    assert.equal(restored.report.evidence.status, 'verified')
    assert.equal(restored.report.evidence.legacyFormat, true)
    assert.equal(restored.report.database.productSchema, 12)
    assert.ok(restored.report.limitations.some((line) => line.includes('predates routing evidence')))

    // The first open applies the append-only migrations to the current schema; no user record is deleted.
    const store = new ProductStore({ path: join(target, 'state.sqlite') })
    try {
      const open = new Database(join(target, 'state.sqlite'), { readonly: true })
      try {
        assert.equal(Number((open.prepare("SELECT value FROM schema_meta WHERE key = 'product_schema'").get() as { value: string }).value), PRODUCT_SCHEMA_VERSION)
      } finally {
        open.close()
      }
      assert.equal(store.workflows.projects.current('project-legacy')?.revision, 1)
    } finally {
      store.close()
    }
    const migrated = readEvidenceSummary(join(target, 'state.sqlite'))
    assert.equal(migrated.productSchema, PRODUCT_SCHEMA_VERSION)
    assert.equal(migrated.projects[0]?.id, 'project-legacy')
    assert.equal(migrated.routingEvidence.status, 'included')
    if (migrated.routingEvidence.status !== 'included') throw new Error('routing evidence missing after migration')
    assert.equal(migrated.routingEvidence.advice.length + migrated.routingEvidence.reviews.length + migrated.routingEvidence.outcomes.length, 0)
    // A migrated legacy restore must still match the classes the old bundle recorded.
    const legacyExpected = { ...snapshot.evidence }
    const recheck = verifyEvidenceSummary(join(target, 'state.sqlite'), legacyExpected)
    assert.equal(recheck.ok, true)
    assert.equal(recheck.migratedSchema, true)
    assert.equal(recheck.legacyFormat, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('review evidence that points at an artifact outside the registry refuses the bundle', async (t) => {
  const { root, stateDir, staging } = base()
  try {
    seedState(stateDir)
    const db = new Database(join(stateDir, 'state.sqlite'))
    try {
      db.prepare("UPDATE review_evidence SET report_artifact_ref = 'artifact-not-in-registry'").run()
    } finally {
      db.close()
    }
    await assert.rejects(
      () => snapshotState({ stateDir, stagingDir: join(staging, 'files') }),
      (error: unknown) => (error as { code?: string }).code === 'artifact_missing',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
