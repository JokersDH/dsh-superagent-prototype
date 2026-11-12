/**
 * Wave-11 A9 benchmark: real SQLite with 100/1000 works, a long conversation and 5000 context
 * bindings. Reports bounded operation timings and snapshot bytes; performs no cleanup-policy tests
 * and touches no user state.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts, WorkflowSnapshots } from '../dist/index.js'

const at = '2026-11-12T00:00:00.000Z'
const temp = mkdtempSync(join(tmpdir(), 'wave11-benchmark-'))
const store = new ProductStore({ path: join(temp, 'state.sqlite') })
const artifact = store.artifacts.write(new TextEncoder().encode('{"bounded":true}'))
store.artifacts.insert(artifact)
const measure = async (fn) => { const start = performance.now(); const value = await fn(); return { value, ms: Number((performance.now() - start).toFixed(1)) } }
const report = { protocol: 'wave11-storage-benchmark/1', sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), modelCalls: 0, nativeTurns: 0, cases: [] }

for (const count of [100, 1000]) {
  const insert = await measure(() => store.uow.atomic(() => {
    for (let index = 0; index < count; index += 1)
      store.product.works.insert({ id: `work-${count}-${index}`, projectId: 'project-1', conversationId: 'conversation-long',
        title: `Work ${index}`, createdAt: at })
  }))
  report.cases.push({ case: `${count}-works`, rows: count, insertMs: insert.ms })
}

const messages = await measure(() => store.uow.atomic(() => {
  for (let index = 0; index < 2000; index += 1)
    store.product.messages.append({ id: `long-${index}`, conversationId: 'conversation-long', projectId: 'project-1',
      role: index % 2 ? 'assistant' : 'user', provenance: index % 2 ? 'reasoner_reply' : 'trusted_user',
      text: `Long conversation message ${index} `.repeat(12), sourceRefs: [], createdAt: at })
}))
report.cases.push({ case: 'long-conversation', rows: 2000, insertMs: messages.ms })

const bindings = await measure(() => store.uow.atomic(() => {
  for (let index = 0; index < 10000; index += 1) {
    const minute = index % 60, hour = Math.floor(index / 60) % 24
    store.workflows.assistant.contextBindings.put({
      protocol: 'assistant-context-binding/1', commandId: `bench-command-${index}`, messageId: `bench-message-${String(index).padStart(5, '0')}`,
      requestId: `bench-request-${index}`, projectId: 'project-1', conversationId: 'conversation-long', userTextDigest: 'a'.repeat(64),
      principal: { userId: 'user-1', authorityRef: 'authority-1' }, purpose: 'conversation_discussion',
      scope: { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] },
      selections: ['conversation'], bundleRef: artifact.id, bundleDigest: artifact.digest,
      sources: [{ sourceId: `bench-source-${index}`, kind: 'conversation_message', sourceDigest: 'b'.repeat(64),
        previewDigest: 'c'.repeat(64), truncated: false }],
      confirmedAt: `2026-11-12T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`,
      expiresAt: `2026-11-12T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:59.000Z`,
    })
  }
}))
report.cases.push({ case: '10000-context-bindings', rows: 10000, insertMs: bindings.ms })

const history = createWorkflowPorts(store).assistant.contextHistory
const page = await measure(() => history.page({ projectIds: ['project-1'], limit: 100 }))
report.cases.push({ case: 'history-first-page', rows: page.value.records.length, hasMore: page.value.hasMore, ms: page.ms })
const plan = store.db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM assistant_context_bindings
  WHERE project_id IN (?) ORDER BY confirmed_at DESC, message_id DESC LIMIT 101`).all('project-1')
report.cases.push({ case: 'history-query-plan', plan: plan.map(row => row.detail) })
const lookup = await measure(() => history.bundleStatus('bench-message-09999'))
report.cases.push({ case: 'bundle-lookup', present: lookup.value.present, digestMatches: lookup.value.digestMatches, bytes: lookup.value.bytes, ms: lookup.ms })
const source = await measure(() => store.workflows.recoverySource.inspect())
report.cases.push({ case: 'recovery-source-20000-row-window', coverage: source.value.coverage, families: source.value.families.length,
  rows: source.value.families.reduce((sum, family) => sum + family.rows, 0), ms: source.ms })

const bounded = await measure(() => store.workflows.recoverySource.inspect({ maxRows: 1000 }))
report.cases.push({ case: 'recovery-source-bounded', coverage: bounded.value.coverage, fingerprint: bounded.value.sourceFingerprint,
  families: bounded.value.families.length, rows: bounded.value.families.reduce((sum, family) => sum + family.rows, 0), ms: bounded.ms })

const large = store.artifacts.write(new Uint8Array(524288))
store.artifacts.insert(large)
report.cases.push({ case: 'max-reply-bundle-artifact', rows: 1, bytes: large.bytes, id: large.id })
const snapshotDir = join(temp, 'snapshot')
const snapshot = await measure(() => new WorkflowSnapshots(store).create({ destination: snapshotDir }))
report.cases.push({ case: 'snapshot-create', status: snapshot.value.status, databaseBytes: snapshot.value.manifest.database.bytes,
  artifacts: snapshot.value.manifest.artifacts.length, evidenceFamilies: snapshot.value.manifest.evidence.families.length, ms: snapshot.ms })
const verify = await measure(() => new WorkflowSnapshots(store).verify(snapshotDir))
report.cases.push({ case: 'snapshot-verify', status: verify.value.status, ms: verify.ms })
report.limits = { maxRows: 20000, maxHistoryPage: 100, maxReplyBodyBytes: 524288, maxBindingsTested: 10000 }
report.limitations = ['Temporary database and content-addressed artifact only; no user state, model/native send or cleanup-policy test.',
  'Timings are single-process wall clock on this host, not a service SLO.']
store.close()
rmSync(temp, { recursive: true, force: true })
const out = resolve('packages/workflows/reports/wave15-performance.json')
writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
