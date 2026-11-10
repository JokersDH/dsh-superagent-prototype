#!/usr/bin/env node
/** Bounded routing-evidence benchmark: 500 advice, 100 reviews, 200 outcomes, fixed seed. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '../src/index.ts'

const dir = mkdtempSync(join(tmpdir(), 'routing-benchmark-'))
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-author', revision: 1, digest: 'a'.repeat(64) }
const reviewerContract = { workId: 'work-review', revision: 1, digest: 'b'.repeat(64) }
const profile = { profileId: 'codex', revision: 3, identityDigest: 'a'.repeat(64) }
const candidate = { ticketId: 'author-ticket', assignmentId: 'author-assignment', contract, candidateGeneration: 1 }
const subject = { candidate, artifactDigest: 'd'.repeat(64), baseCommit: 'b'.repeat(40), environmentRef: 'environment', checkPolicyRef: 'policy' }
const at = '2026-11-10T00:00:00.000Z'
const ms = async fn => { const start = performance.now(); const value = await fn(); return { ms: Math.round((performance.now() - start) * 100) / 100, value } }
try {
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  const port = createWorkflowPorts(store).routingEvidence
  const seed = await ms(() => {
    for (let i = 0; i < 500; i += 1) port.advice.put({
      protocol: 'route-advice/1', id: `advice-${i}`, projectId: 'project-1', sourceRef: 'source', taskContextDigest: 'c'.repeat(64),
      catalogRevision: 'c'.repeat(64), policyRevision: 'policy', eligibleProfileRefs: [profile], suggestedProfileRef: profile,
      excluded: [], basis: 'only_eligible', evidenceRefs: ['evidence'], reviewSuggested: true,
      createdAt: `2026-11-10T00:00:${String(i % 60).padStart(2, '0')}.000Z`, expiresAt: '2026-11-11T00:00:00.000Z',
    })
    for (let i = 0; i < 100; i += 1) port.reviews.put({
      protocol: 'review-evidence/1', id: `review-${i}`, projectId: 'project-1', subject, reviewerProfileRef: profile,
      reviewAttempt: { ticketId: 'review-ticket', assignmentId: 'review-assignment', attemptId: `review-attempt-${i}`, fenceEpoch: 1, contract: reviewerContract },
      inputDigest: 'a'.repeat(64), reportDigest: 'e'.repeat(64), reportArtifactRef: `report-${i}`,
      isolation: { kind: 'sealed_copy', proofRef: 'capsule', capsuleManifestDigest: 'a'.repeat(64) },
      evidenceRefs: ['review-evidence'], layer: 'controlled', disposition: 'no_findings', observedAt: at,
    })
    for (let i = 0; i < 200; i += 1) port.outcomes.put({
      protocol: 'execution-outcome/1', id: `outcome-${i}`, projectId: 'project-1',
      attempt: { ticketId: 'author-ticket', assignmentId: 'author-assignment', attemptId: `author-attempt-${i}`, fenceEpoch: 1, contract },
      profileRef: profile, acceptance: 'unknown', evidenceRefs: [], layer: 'controlled', usage: { completeness: 'unknown', evidenceRefs: [] }, observedAt: at,
    })
  })
  const advice = await ms(() => port.advice.list({ projectId: 'project-1', limit: 50 }))
  const reviews = await ms(() => port.reviews.list({ projectId: 'project-1', subject, limit: 50 }))
  const outcomes = await ms(() => port.outcomes.list({ projectId: 'project-1', profile, limit: 50 }))
  store.close()
  console.log(JSON.stringify({
    protocol: 'routing-evidence-benchmark/1', node: process.version, platform: process.platform, architecture: process.arch,
    dataset: { advice: 500, reviews: 100, outcomes: 200 },
    seed: { ms: seed.ms }, advice: { ms: advice.ms, returned: advice.value.records.length, nextCursor: Boolean(advice.value.nextCursor) },
    reviews: { ms: reviews.ms, returned: reviews.value.records.length }, outcomes: { ms: outcomes.ms, returned: outcomes.value.records.length },
    scope: 'temporary SQLite; no model/account/network/user project',
  }, null, 2))
} finally { rmSync(dir, { recursive: true, force: true }) }
