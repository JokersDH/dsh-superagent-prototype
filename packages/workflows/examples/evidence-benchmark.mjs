#!/usr/bin/env node
/** Bounded wave-07 measurement: evidence pages over one work and recovery-intent listing. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '../src/index.ts'

const root = mkdtempSync(join(tmpdir(), 'pa-evidence-bench-'))
const at = '2026-11-11T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-bench', revision: 1, digest: 'a'.repeat(64) }
const ms = async fn => { const start = performance.now(); const value = await fn(); return { ms: Math.round((performance.now() - start) * 100) / 100, value } }
try {
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  const ports = createWorkflowPorts(store)
  await ms(() => store.uow.atomic(() => {
    store.product.works.insert({ id: 'work-bench', projectId: 'project-1', conversationId: 'conversation-1', title: 'Bench', createdAt: at })
    store.product.contracts.append({ ...contract, goal: 'Deliver', scope,
      criteria: [{ id: 'unit', kind: 'machine', description: 'Unit', required: true, checkDefinitionRef: 'check-1' }],
      authorityRef: 'authority-1', createdAt: at })
    store.product.links.attach({ contract, ticketId: 'ticket-1', role: 'primary', authorityRef: 'authority-1' })
    for (let index = 0; index < 600; index += 1) {
      store.db.prepare(`INSERT INTO completion_verifications
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
         environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`verification-${index}`, 'ticket-1', 'assignment-1', index + 1, JSON.stringify(contract),
          String(index).padStart(64, '0'), 'c'.repeat(64), 'environment-1', 'verifier-1', '[]', at)
    }
  }))
  for (let index = 0; index < 200; index += 1) ports.recoveryIntents.record({
    commandId: `recovery-command-${index}`, actor: { userId: 'user-1', authorityRef: 'authority-1' },
    plan: { protocol: 'recovery-plan/1', planId: `recovery-plan-${index}`, inspectionFingerprint: 'f'.repeat(64),
      createdAt: at, expiresAt: '2026-11-11T00:05:00.000Z',
      bindings: [{ sourceProjectId: 'project-1', proposedProjectId: 'project-1', path: '/tmp/project',
        headCommit: 'f'.repeat(40), configurationDigest: 'a'.repeat(64), scopeDigest: 'b'.repeat(64) }],
      executor: null, artifactsChecked: 0, artifactScanTruncated: false,
      blockers: [{ code: 'authorization_not_implemented', owner: 'main', detail: 'commit not connected' }],
      authorization: 'not_granted', commitAvailable: false },
    expectedInspectionFingerprint: 'f'.repeat(64), sourceFingerprint: 'f'.repeat(64), confirmedAt: at,
  })
  const firstPage = await ms(() => ports.index.evidencePage({ workId: 'work-bench', projectIds: ['project-1'], limit: 100 }))
  let cursor = firstPage.value.nextCursor, pages = 1
  const all = await ms(() => {
    while (cursor) {
      const page = ports.index.evidencePage({ workId: 'work-bench', projectIds: ['project-1'], limit: 100, cursor })
      assertOk(page)
      cursor = page.nextCursor
      pages += 1
    }
    return pages
  })
  const intents = await ms(() => ports.recoveryIntents.list({ sourceFingerprint: 'f'.repeat(64), limit: 50 }))
  store.close()
  console.log(JSON.stringify({
    protocol: 'wave07-evidence-benchmark/1', node: process.version, platform: process.platform, architecture: process.arch,
    dataset: { verifications: 600, recoveryIntents: 200 },
    evidencePage: { ms: firstPage.ms, returned: firstPage.value.entries.length, window: firstPage.value.window },
    allPages: { ms: all.ms, pages: all.value },
    recoveryIntents: { ms: intents.ms, returned: intents.value.records.length, hasMore: intents.value.hasMore },
    scope: 'temporary SQLite; no model/account/network/user project',
  }, null, 2))
} finally { rmSync(root, { recursive: true, force: true }) }
function assertOk(page) { if (!page) throw new Error('evidence page missing') }
