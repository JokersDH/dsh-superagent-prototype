#!/usr/bin/env node
/**
 * A4 consumer recipe: paged work evidence for a trusted project scope. It shows the three window
 * values, stable cursor continuation and cross-project refusal. Temporary SQLite only.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts, projectWorkEvidence } from '../src/index.ts'

const root = mkdtempSync(join(tmpdir(), 'pa-evidence-consumer-'))
const at = '2026-11-11T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
try {
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  const ports = createWorkflowPorts(store)
  store.uow.atomic(() => {
    store.product.works.insert({ id: 'work-1', projectId: 'project-1', conversationId: 'conversation-1', title: 'Evidence', createdAt: at })
    store.product.contracts.append({ ...contract, goal: 'Deliver', scope,
      criteria: [{ id: 'unit', kind: 'machine', description: 'Unit', required: true, checkDefinitionRef: 'check-1' }],
      authorityRef: 'authority-1', createdAt: at })
    store.product.links.attach({ contract, ticketId: 'ticket-1', role: 'primary', authorityRef: 'authority-1' })
    for (let index = 0; index < 5; index += 1) {
      store.db.prepare(`INSERT INTO completion_verifications
        (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
         environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(`verification-${index}`, 'ticket-1', 'assignment-1', index + 1, JSON.stringify(contract),
          String(index).padStart(64, '0'), 'c'.repeat(64), 'environment-1', 'verifier-1', '[]', at)
    }
  })
  const pages = []
  let cursor
  do {
    const page = ports.index.evidencePage({ workId: 'work-1', projectIds: ['project-1'], limit: 3, ...(cursor ? { cursor } : {}) })
    if (!page) throw new Error('evidence scope rejected')
    pages.push({ returned: page.entries.length, window: page.window, hasMore: page.hasMore })
    cursor = page.nextCursor
  } while (cursor)
  let crossProject = 'allowed'
  try { ports.index.evidencePage({ workId: 'work-1', projectIds: ['project-2'] }) } catch { crossProject = 'rejected' }
  if (ports.index.evidencePage({ workId: 'work-1', projectIds: ['project-2'] }) === undefined) crossProject = 'undefined'
  const projection = {
    accepted: projectWorkEvidence({ delivered: true, currentAccepted: true, window: 'complete' }),
    sourceMissing: projectWorkEvidence({ delivered: true, currentAccepted: false, window: 'complete' }),
    notInWindow: projectWorkEvidence({ delivered: true, currentAccepted: false, window: 'storage_cap' }),
    notAccepted: projectWorkEvidence({ delivered: false, currentAccepted: false, window: 'complete' }),
  }
  console.log(JSON.stringify({ protocol: 'evidence-consumer/1', pages, crossProject, projection }, null, 2))
  store.close()
} finally { rmSync(root, { recursive: true, force: true }) }
