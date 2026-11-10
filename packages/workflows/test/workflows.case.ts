/**
 * Wave-03 A workflow ports over a real SQLite ProductStore: durable conversation catalog/search/
 * archive, versioned project settings, explicit decisions, a fail-closed read index, and
 * database+artifact snapshot verification. All fixtures are temporary; no model/account/network.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyMigrations, canonicalDigest, MIGRATIONS, ProductStore } from '@personal-agent/storage'
import type { ContractRevision, PersistedDecision, PersistedProposal, TicketLink, UserDecision, UserQuestion, WorkRecord } from '@personal-agent/contracts'
import {
  createWorkflowPorts, SnapshotError, WorkflowConflict, WorkflowSnapshots,
} from '../src/index.ts'

const at = '2026-11-10T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const contract = { workId: 'work-1', revision: 1, digest: 'a'.repeat(64) }
const revision: ContractRevision = {
  ...contract, goal: 'Deliver the change.', scope,
  criteria: [{ id: 'unit', kind: 'machine', description: 'Unit checks pass.', required: true, checkDefinitionRef: 'unit-check' }],
  authorityRef: 'authority-1', createdAt: at,
}
const link: TicketLink = { contract, ticketId: 'ticket-1', role: 'primary', authorityRef: 'authority-1' }
const work = (id = 'work-1', conversationId = 'conv-1'): WorkRecord => ({
  id, projectId: 'project-1', conversationId, title: `Work ${id}`, createdAt: at,
})
const question = (): UserQuestion => ({
  id: 'q-1', version: 1, kind: 'clarification', contract, scope, prompt: 'Which target?', nativePayloadRef: 'payload-1',
  presentation: { kind: 'free_text' },
  targets: [{
    ticketId: 'ticket-1', assignmentId: 'assignment-1', attemptId: 'attempt-1', fenceEpoch: 1, contract,
    id: 'target-1', connectionEpoch: 1, nativeRequestId: { kind: 'string', value: 'req-1' }, nativeMethod: 'ask_user', provenanceRef: 'prov-1',
  }],
  openedAt: at, validity: 'open',
})
const decision = (overrides: Partial<UserDecision> = {}): UserDecision => ({
  id: 'decision-1', version: 1, content: 'Prefer small reviewable patches.', scope, authorityRef: 'authority-1', ...overrides,
})
const tmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix))

test('conversation catalog, search, archive and message identity survive reopen', async () => {
  const dir = tmp('workflow-conversation-')
  const path = join(dir, 'state.sqlite')
  let store = new ProductStore({ path })
  try {
    const ports = createWorkflowPorts(store)
    assert.equal(ports.conversations.create({ id: 'conv-1', projectId: 'project-1', title: '季度报告' }).created, true)
    assert.equal(ports.conversations.create({ id: 'conv-1', projectId: 'project-1', title: '季度报告' }).created, false)
    ports.conversations.create({ id: 'conv-2', projectId: 'project-2', title: 'Other project' })
    store.product.messages.append({
      id: 'message-1', conversationId: 'conv-1', projectId: 'project-1', role: 'user',
      provenance: 'trusted_user', text: '请检查季度报告中的导出流程', sourceRefs: [], createdAt: at,
    })
    store.product.messages.append({
      id: 'message-mixed', conversationId: 'conv-1', projectId: 'project-2', role: 'user',
      provenance: 'trusted_user', text: 'mixed project membership', sourceRefs: [], createdAt: at,
    })
    assert.deepEqual([...ports.conversations.get('conv-1')!.projectIds].sort(), ['project-1', 'project-2'])
    assert.equal(ports.conversations.list({ projectIds: [] }).conversations.length, 0, 'empty authorization never means all')
    assert.equal(ports.discovery.discoverPage().conversations.length, 2)
    assert.equal(ports.conversations.search({ query: 'mixed', projectIds: ['project-2'] }).hits.length, 1)
    store.product.messages.append({
      id: 'message-2', conversationId: 'conv-2', projectId: 'project-2', role: 'user',
      provenance: 'trusted_user', text: 'unrelated private text', sourceRefs: [], createdAt: at,
    })
    assert.equal(ports.conversations.list({ projectIds: ['project-1'] }).conversations.length, 1)
    assert.equal(ports.conversations.search({ query: '季度', projectIds: ['project-1'] }).hits.length, 1)
    assert.equal(ports.conversations.search({ query: '季度报告', projectIds: ['project-1'] }).hits.length, 1)
    assert.equal(ports.conversations.search({ query: 'private', projectIds: ['project-1'] }).hits.length, 0)
    assert.equal(ports.conversations.search({ query: 'private', projectIds: ['project-2'] }).hits.length, 1)

    const renamed = ports.conversations.rename('conv-1', 1, '季度报告终稿')
    assert.equal(renamed.title, '季度报告终稿')
    assert.equal(ports.conversations.search({ query: '终稿', projectIds: ['project-1'] }).hits.length, 1)
    const archived = ports.conversations.setArchived('conv-1', 0, true)
    assert.ok(archived.archivedAt)
    assert.equal(archived.attention, false)
    assert.equal(ports.conversations.list({ projectIds: ['project-1'] }).conversations.length, 0)
    assert.equal(ports.conversations.list({ projectIds: ['project-1'], includeArchived: true }).conversations.length, 1)
    assert.equal(ports.conversations.search({ query: '季度', projectIds: ['project-1'] }).hits.length, 0)
    assert.equal(ports.conversations.search({ query: '季度', projectIds: ['project-1'], includeArchived: true }).hits.length, 1)
    assert.equal(store.product.messages.page('conv-1').messages.length, 2, 'archive does not delete messages')
    store.close()

    store = new ProductStore({ path })
    try {
      const reopened = createWorkflowPorts(store)
      const conversation = reopened.conversations.get('conv-1')!
      assert.equal(conversation.title, '季度报告终稿')
      assert.equal(conversation.messageCount, 2)
      assert.ok(conversation.archivedAt)
      assert.throws(() => reopened.conversations.rename('conv-1', 1, 'stale'), WorkflowConflict)
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('unresolved work/questions remain visible as attention after archive', () => {
  const dir = tmp('workflow-attention-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    ports.conversations.create({ id: 'conv-1', projectId: 'project-1', title: 'Needs a decision' })
    store.uow.atomic(() => {
      store.product.works.insert(work())
      store.product.questions.insert(question())
    })
    const before = ports.conversations.get('conv-1')!
    assert.equal(before.workCount, 1)
    assert.equal(before.openQuestionCount, 1)
    assert.equal(before.attention, true)
    const archived = ports.conversations.setArchived('conv-1', 0, true)
    assert.equal(archived.attention, true, 'archiving does not hide an unresolved user request')
    assert.equal(store.product.questions.listOpen({ workId: 'work-1' }).length, 1)
    assert.equal(store.product.works.get('work-1')!.id, 'work-1')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('project settings are append-only, CAS-protected and archive only visibility', () => {
  const dir = tmp('workflow-projects-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    const settings = { pathDigest: 'd'.repeat(64), check: 'node_test' as const, sourceRef: 'source:one', displayName: 'First' }
    const first = ports.projects.append({ projectId: 'project-1', expectedRevision: 0, settings })
    assert.equal(first.created, true)
    assert.equal(first.current.revision, 1)
    const replay = ports.projects.append({ projectId: 'project-1', expectedRevision: 0, settings })
    assert.equal(replay.created, false)
    assert.equal(replay.current.revision, 1)
    assert.throws(() => ports.projects.append({ projectId: 'project-1', expectedRevision: 0,
      settings: { ...settings, displayName: 'Changed' } }), WorkflowConflict)
    const second = ports.projects.append({
      projectId: 'project-1', expectedRevision: 1,
      settings: { ...settings, displayName: 'Second', environment: { policy: 'offline_install', storeDir: '/tmp/store' } },
    })
    assert.equal(second.current.revision, 2)
    assert.equal(ports.projects.current('project-1')!.settings.displayName, 'Second')
    assert.deepEqual(ports.projects.history('project-1').map(item => item.revision), [2, 1])
    assert.equal(ports.projects.history('project-1')[1]!.settings.displayName, 'First', 'old settings stay auditable')
    store.uow.atomic(() => {
      store.product.works.insert(work())
      store.product.contracts.append(revision)
    })
    const oldContract = store.product.contracts.getByRef(contract)!
    assert.equal(oldContract.goal, revision.goal, 'a settings update does not rewrite an in-flight contract')

    const archived = ports.projects.setArchived('project-1', 0, true)
    assert.ok(archived.archivedAt)
    assert.throws(() => ports.projects.append({ projectId: 'project-1', expectedRevision: 2,
      settings: { ...settings, displayName: 'While archived' } }), WorkflowConflict)
    assert.equal(ports.index.project('project-1').state, 'archived')
    ports.projects.setArchived('project-1', 1, false)
    assert.equal(ports.index.project('project-1').state, 'current')
    assert.equal(ports.index.project('missing-project').state, 'missing')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('explicit decision versions append and revoke without inferred rules', () => {
  const dir = tmp('workflow-decisions-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    const first = ports.decisions.append(decision())
    assert.equal(first.created, true)
    assert.equal(ports.decisions.append(decision()).created, false)
    assert.throws(() => ports.decisions.append(decision({ content: 'A different body' })), WorkflowConflict)
    const second = ports.decisions.append(decision({ version: 2, content: 'Prefer small patches and real tests.' }), { expectedVersion: 1 })
    assert.equal(second.record.decision.version, 2)
    assert.throws(() => ports.decisions.revoke({ id: 'decision-1', expectedVersion: 1 }), WorkflowConflict)
    const revoked = ports.decisions.revoke({ id: 'decision-1', expectedVersion: 2, revokedAt: '2026-11-10T01:00:00.000Z' })
    assert.equal(revoked.record.decision.version, 3)
    assert.equal(revoked.record.decision.revokedAt, '2026-11-10T01:00:00.000Z')
    assert.deepEqual(ports.decisions.history('decision-1').map(item => item.decision.version), [3, 2, 1])
    assert.equal(ports.decisions.list({ projectIds: ['project-1'] }).records.length, 0)
    assert.equal(ports.decisions.list({ projectIds: ['project-1'], includeRevoked: true }).records.length, 1)
    assert.equal(ports.decisions.list({ projectIds: ['project-2'], includeRevoked: true }).records.length, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('read index is bounded, scoped and never invents a current setting or authority', () => {
  const dir = tmp('workflow-index-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    ports.projects.append({ projectId: 'project-1', expectedRevision: 0,
      settings: { pathDigest: 'f'.repeat(64), check: 'pnpm_test', sourceRef: 'source:project-1' } })
    store.uow.atomic(() => {
      store.product.works.insert(work())
      store.product.contracts.append(revision)
      store.product.links.attach(link)
      store.authority.enable(contract)
      store.product.questions.insert(question())
    })
    const indexed = ports.index.work('work-1', ['project-1'])!
    assert.equal(indexed.work.title, 'Work work-1')
    assert.equal(indexed.authorityState, 'current')
    assert.equal(indexed.contractState, 'current')
    assert.equal(indexed.openQuestionIds.length, 1)
    assert.equal(indexed.project.state, 'current')
    assert.equal(indexed.provenance.includes('source:project-1'), true)
    assert.equal(ports.index.work('work-1', ['project-2']), undefined, 'project isolation')
    assert.equal(ports.index.listWorks({ projectIds: ['project-1'], query: 'Work' }).works.length, 1)
    assert.equal(ports.index.listWorks({ projectIds: ['project-2'], query: 'Work' }).works.length, 0)

    store.authority.disable(contract)
    const stale = ports.index.work('work-1', ['project-1'])!
    assert.equal(stale.authorityState, 'missing')
    assert.equal(stale.contractState, 'missing')
    assert.equal(ports.index.project('project-2').state, 'missing')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a snapshot includes the database and digest-verified artifacts; missing bytes block it', async () => {
  const dir = tmp('workflow-snapshot-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const written = store.artifacts.write(Buffer.from('delivery bytes\n'))
    store.artifacts.insert(written)
    store.queue.enqueue('test.delivery', 'delivery-key', '{}', 1, 0, at)
    const queued = store.queue.dueRows('test.delivery', Number.MAX_SAFE_INTEGER, 1)[0]!
    store.queue.park('test.delivery', 'delivery-key', queued.seq, queued.generation, 'fixture', at)
    store.product.questions.insert(question())
    store.db.prepare(`INSERT INTO completion_verifications
      (id, ticket_id, assignment_id, candidate_generation, contract, artifact_digest, criteria_digest,
       environment_ref, verifier_identity_ref, results, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('snapshot-verification', 'ticket-1', 'assignment-1', 1, JSON.stringify(contract), written.digest,
        'c'.repeat(64), 'environment-1', 'verifier-1', JSON.stringify([]), at)
    const snapshots = new WorkflowSnapshots(store)
    const destination = join(dir, 'snapshot')
    const result = await snapshots.create({ destination })
    assert.equal(result.status, 'ok', result.message)
    assert.equal(result.manifest.complete, true)
    const state = createWorkflowPorts(store).state.stateFacts()
    assert.deepEqual(state.queue, { waiting: 0, parked: 1 })
    assert.equal(state.openQuestions, 1)
    assert.equal(state.artifacts, 1)
    assert.equal(existsSync(join(destination, 'product.sqlite')), true)
    assert.equal(readFileSync(join(destination, 'artifacts', written.id), 'utf8'), 'delivery bytes\n')
    assert.equal(snapshots.verify(destination).status, 'ok')
    await assert.rejects(() => snapshots.create({ destination }), SnapshotError)

    unlinkSync(join(destination, 'artifacts', written.id))
    const broken = snapshots.verify(destination)
    assert.equal(broken.status, 'blocked')
    assert.equal(broken.artifacts[0]!.status, 'missing')

    const corruptDestination = join(dir, 'snapshot-corrupt')
    const secondCopy = await snapshots.create({ destination: corruptDestination })
    assert.equal(secondCopy.status, 'ok')
    const copied = join(corruptDestination, 'artifacts', written.id)
    const changed = readFileSync(copied)
    changed.writeUInt8((changed[0] ?? 0) ^ 0xff, 0)
    writeFileSync(copied, changed)
    assert.equal(snapshots.verify(corruptDestination).status, 'blocked')
    assert.equal(snapshots.verify(corruptDestination).artifacts[0]!.status, 'corrupt')

    // Missing source bytes also produce a blocked snapshot, not a "complete" manifest.
    const second = join(dir, 'snapshot-missing')
    unlinkSync(store.artifacts.filePath(written.id))
    const missing = await snapshots.create({ destination: second })
    assert.equal(missing.status, 'blocked')
    assert.equal(missing.manifest.missing.includes(written.id), true)
    assert.equal(missing.manifest.complete, false)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a v7 database backfills the conversation catalog on upgrade and keeps message identity', () => {
  const dir = tmp('workflow-upgrade-')
  const path = join(dir, 'state.sqlite')
  try {
    const legacy = new Database(path)
    applyMigrations(legacy, { registry: MIGRATIONS.slice(0, 7) })
    legacy.prepare('INSERT INTO works (id, project_id, conversation_id, value, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('work-1', 'project-1', 'conv-1', JSON.stringify(work()), at)
    legacy.prepare('INSERT INTO conversation_messages (conversation_id, sequence, id, value, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('conv-1', 1, 'message-1', JSON.stringify({
        id: 'message-1', conversationId: 'conv-1', sequence: 1, projectId: 'project-1', role: 'user',
        provenance: 'trusted_user', text: '升级后仍可搜索的中文消息', sourceRefs: [], createdAt: at,
      }), at)
    legacy.close()

    const store = new ProductStore({ path })
    try {
      assert.equal(store.database.productSchema, 12)
      const ports = createWorkflowPorts(store)
      const conversation = ports.conversations.get('conv-1')!
      assert.equal(conversation.title, 'Work work-1')
      assert.equal(conversation.messageCount, 1)
      assert.deepEqual(conversation.projectIds, ['project-1'])
      assert.equal(ports.conversations.search({ query: '中文消息', projectIds: ['project-1'] }).hits.length, 1)
      assert.equal(store.product.messages.page('conv-1').messages[0]!.id, 'message-1')
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})


test('catalog pagination, long/empty titles and message paging keep identity and bounds', () => {
  const dir = tmp('workflow-paging-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    for (let index = 0; index < 3; index += 1) {
      ports.conversations.create({ id: `conv-${index}`, projectId: 'project-1', title: `会话 ${index}`, createdAt: `2026-11-10T00:00:0${index}.000Z` })
    }
    const firstPage = ports.conversations.list({ projectIds: ['project-1'], limit: 2 })
    assert.equal(firstPage.conversations.length, 2)
    assert.equal(firstPage.hasMore, true)
    assert.ok(firstPage.nextCursor)
    const secondPage = ports.conversations.list({ projectIds: ['project-1'], limit: 2, cursor: firstPage.nextCursor })
    assert.equal(secondPage.conversations.length, 1)
    assert.equal(secondPage.hasMore, false)
    assert.equal(new Set([...firstPage.conversations, ...secondPage.conversations].map(item => item.id)).size, 3)
    assert.throws(() => ports.conversations.create({ id: 'conv-empty', projectId: 'project-1', title: '   ' }), WorkflowConflict)
    const long = '长'.repeat(300)
    ports.conversations.create({ id: 'conv-long', projectId: 'project-1', title: long })
    assert.equal(ports.conversations.get('conv-long')!.title.length, 300)

    for (let index = 0; index < 60; index += 1) {
      store.product.messages.append({
        id: `page-message-${index}`, conversationId: 'conv-0', projectId: 'project-1', role: 'user',
        provenance: 'trusted_user', text: `message ${index}`, sourceRefs: [], createdAt: `2026-11-10T00:01:${String(index).padStart(2, '0')}.000Z`,
      })
    }
    const page = store.product.messages.page('conv-0', { limit: 50 })
    assert.equal(page.messages.length, 50)
    assert.equal(page.hasMore, true)
    assert.equal(page.messages[0]!.sequence, 11)
    assert.equal(page.messages.at(-1)!.sequence, 60)
    assert.ok(page.beforeCursor)
    const older = store.product.messages.page('conv-0', { limit: 50, before: page.beforeCursor })
    assert.equal(older.messages.length, 10)
    assert.equal(older.messages[0]!.sequence, 1)
    assert.equal(new Set(store.product.messages.page('conv-0', { limit: 100 }).messages.map(item => item.id)).size, 60)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})


test('a second Node process consumes the public workflow ports and snapshot verifier', () => {
  const dir = tmp('workflow-second-process-')
  const path = join(dir, 'state.sqlite')
  const snapshot = join(dir, 'second-snapshot')
  const store = new ProductStore({ path })
  try {
    const ports = createWorkflowPorts(store)
    ports.projects.append({ projectId: 'project-1', expectedRevision: 0,
      settings: { pathDigest: 'a'.repeat(64), check: 'node_test', sourceRef: 'source:second' } })
    ports.conversations.create({ id: 'conv-1', projectId: 'project-1', title: '第二进程会话' })
    store.product.messages.append({
      id: 'second-message', conversationId: 'conv-1', projectId: 'project-1', role: 'user',
      provenance: 'trusted_user', text: '跨进程读取中文目录', sourceRefs: [], createdAt: at,
    })
    const artifact = store.artifacts.write(Buffer.from('second-process-artifact\n'))
    store.artifacts.insert(artifact)
    const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
    const code = `
      import { createWorkflowPorts, WorkflowSnapshots } from ${JSON.stringify(entry)}
      import { ProductStore } from '@personal-agent/storage'
      const store = new ProductStore({ path: ${JSON.stringify(path)} })
      const ports = createWorkflowPorts(store)
      const snapshot = new WorkflowSnapshots(store)
      const result = await snapshot.create({ destination: ${JSON.stringify(snapshot)} })
      console.log(JSON.stringify({
        projects: ports.index.listProjects({ projectIds: ['project-1'] }).projects.map(item => item.settings.sourceRef),
        conversations: ports.conversations.list({ projectIds: ['project-1'] }).conversations.map(item => item.title),
        search: ports.conversations.search({ query: '跨进程', projectIds: ['project-1'] }).hits.length,
        sourceDigest: ports.index.sourceMessage('second-message', ['project-1'])?.textDigest,
        stateSchema: ports.state.stateFacts().productSchema,
        snapshot: result.status,
        verify: snapshot.verify(${JSON.stringify(snapshot)}).status,
      }))
      store.close()
    `
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 30_000,
    })
    assert.equal(child.status, 0, String(child.stderr))
    const observed = JSON.parse(child.stdout.trim()) as {
      projects: string[]; conversations: string[]; search: number; sourceDigest: string; stateSchema: number; snapshot: string; verify: string
    }
    assert.deepEqual(observed.projects, ['source:second'])
    assert.deepEqual(observed.conversations, ['第二进程会话'])
    assert.equal(observed.search, 1)
    assert.equal(observed.sourceDigest, createHash('sha256').update('跨进程读取中文目录').digest('hex'))
    assert.equal(observed.stateSchema, 12)
    assert.equal(observed.snapshot, 'ok')
    assert.equal(observed.verify, 'ok')
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})


const persistedDecision = (version = 1, overrides: Partial<PersistedDecision['decision']> = {}): PersistedDecision => ({
  decision: { id: 'assistant-decision', version, content: 'Use explicit source evidence.', scope, authorityRef: 'authority-1', ...overrides },
  sourceMessageId: 'source-message', sourceTextDigest: 'b'.repeat(64), conversationId: 'assistant-conversation',
  actorRef: 'actor-1', recordedAt: `2026-11-10T00:0${version}:00.000Z`,
})
const proposal = (version = 1, state: PersistedProposal['state'] = 'pending', extra: Partial<PersistedProposal> = {}): PersistedProposal => {
  const payload = { kind: 'propose_decision' as const, content: 'Use the verified source.', scope, sourceMessageId: 'source-message' }
  return {
    proposalId: 'assistant-proposal', version, state, projectId: 'project-1', conversationId: 'assistant-conversation',
    sourceMessageId: 'source-message', sourceTextDigest: 'b'.repeat(64), actorRef: 'actor-1', grantId: 'grant-1', grantScope: scope,
    payload, payloadDigest: canonicalDigest(payload), createdAt: '2026-11-10T00:00:00.000Z',
    expiresAt: '2026-11-10T01:00:00.000Z', updatedAt: `2026-11-10T00:0${version}:00.000Z`, ...extra,
  }
}

test('AssistantState decisions are source-bound CAS records and legacy rows never become valid memory', () => {
  const dir = tmp('workflow-assistant-decision-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const assistant = createWorkflowPorts(store).assistant
    const created = assistant.decisions.put(persistedDecision(), 0)
    assert.equal(created.replayed, false)
    assert.equal(created.record.decision.version, 1)
    assert.equal(assistant.decisions.put(persistedDecision(), 0).replayed, true)
    assert.throws(() => assistant.decisions.put(persistedDecision(1, { content: 'changed' }), 0), WorkflowConflict)
    assert.throws(() => assistant.decisions.put(persistedDecision(2, { content: 'changed' }), 1), WorkflowConflict)
    const revoked = assistant.decisions.put({ ...persistedDecision(2, { revokedAt: '2026-11-10T02:00:00.000Z' }), revokedBy: 'actor-2' }, 1)
    assert.equal(revoked.record.decision.version, 2)
    assert.equal(revoked.record.revokedBy, 'actor-2')
    assert.equal(assistant.decisions.get('assistant-decision')!.decision.version, 2)
    assert.equal(assistant.decisions.history('assistant-decision').length, 2)
    assert.equal(assistant.decisions.list({ projectId: 'project-1' }).records.length, 1)
    assert.equal(assistant.decisions.list({ projectId: 'project-2' }).records.length, 0)

    // The old ledger remains auditable, but no metadata means no valid assistant memory.
    store.workflows.decisions.append(decision({ id: 'legacy-decision' }))
    assert.equal(assistant.decisions.get('legacy-decision'), undefined)
    const legacy = assistant.legacyDecisions({ projectId: 'project-1' })
    assert.equal(legacy.records.some(item => item.decision.id === 'legacy-decision'), true)
    assert.equal(legacy.records.every(item => item.missingSource), true)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('AssistantState proposals preserve immutable source/grant and confirmation command identity', () => {
  const dir = tmp('workflow-assistant-proposal-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const assistant = createWorkflowPorts(store).assistant
    const created = assistant.proposals.put(proposal(), 0)
    assert.equal(created.record.version, 1)
    assert.equal(assistant.proposals.put(proposal(), 0).replayed, true)
    assert.throws(() => assistant.proposals.put({ ...proposal(), grantScope: { ...scope, projectId: 'project-2', allowedPaths: ['.'] } }, 0), WorkflowConflict)
    assert.throws(() => assistant.proposals.put({ ...proposal(), payloadDigest: 'c'.repeat(64) }, 0), WorkflowConflict)
    const confirmed = assistant.proposals.put(proposal(2, 'confirmed', { effectCommandId: 'command-1' }), 1)
    assert.equal(confirmed.record.effectCommandId, 'command-1')
    assert.throws(() => assistant.proposals.put(proposal(3, 'confirmed', { effectCommandId: 'command-2', grantScope: { ...scope, allowedPaths: ['other/'] } }), 2), WorkflowConflict)
    assert.equal(assistant.proposals.get('assistant-proposal')!.state, 'confirmed')
    assert.equal(assistant.proposals.history('assistant-proposal').length, 2)
    assert.equal(assistant.proposals.list({ projectId: 'project-1' }).records.length, 1)
    assert.equal(assistant.proposals.list({ projectId: 'project-2' }).records.length, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('assistant persistence joins the caller transaction and rolls back all rows on failure', () => {
  const dir = tmp('workflow-assistant-tx-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const assistant = createWorkflowPorts(store).assistant
    assert.throws(() => store.uow.atomic(() => {
      assistant.decisions.put(persistedDecision(), 0)
      store.events.append({ topic: 'assistant.decision.changed', entityRef: 'assistant-decision', payload: { ok: true } })
      throw new Error('injected failure')
    }), /injected failure/)
    assert.equal(assistant.decisions.get('assistant-decision'), undefined)
    assert.equal(store.events.after(0, 10).length, 0)
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM assistant_decision_versions').get() as { n: number }).n, 0)
    assert.equal((store.db.prepare('SELECT COUNT(*) AS n FROM user_decision_versions').get() as { n: number }).n, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})


test('conversation membership is indexed across v7 chat, works without messages and new messages', () => {
  const dir = tmp('workflow-members-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    // v7-style chat without a conversation project; the first message establishes membership.
    store.workflows.conversations.create({ id: 'chat-only', title: '纯聊天' })
    store.product.messages.append({
      id: 'chat-message', conversationId: 'chat-only', projectId: 'project-1', role: 'user',
      provenance: 'trusted_user', text: '无项目目录消息', sourceRefs: [], createdAt: at,
    })
    assert.deepEqual(ports.conversations.get('chat-only')!.projectIds, ['project-1'])
    assert.equal(ports.conversations.list({ projectIds: ['project-1'] }).conversations.length, 1)

    // A Work can establish membership before its first message.
    ports.conversations.create({ id: 'work-conversation', projectId: 'project-2', title: '工作会话' })
    store.uow.atomic(() => {
      store.product.works.insert({ ...work('work-membership', 'work-conversation'), projectId: 'project-3' })
    })
    assert.deepEqual([...ports.conversations.get('work-conversation')!.projectIds].sort(), ['project-2', 'project-3'])
    assert.equal(ports.conversations.list({ projectIds: ['project-3'] }).conversations.some(item => item.id === 'work-conversation'), true)

    store.product.messages.append({
      id: 'work-message', conversationId: 'work-conversation', projectId: 'project-4', role: 'user',
      provenance: 'trusted_user', text: '新消息改变成员', sourceRefs: [], createdAt: at,
    })
    assert.equal(ports.conversations.list({ projectIds: ['project-4'] }).conversations.some(item => item.id === 'work-conversation'), true)
    assert.equal(ports.conversations.list({ projectIds: ['project-5'] }).conversations.length, 0)
    assert.equal(ports.conversations.list({ projectIds: [] }).conversations.length, 0)
    assert.equal(ports.discovery.discoverPage().conversations.length, 2)
    assert.equal(ports.conversations.search({ query: '改变成员', projectIds: ['project-4'] }).hits.length, 1)
    assert.equal(ports.conversations.search({ query: '改变成员', projectIds: ['project-5'] }).hits.length, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})


test('source message metadata is scoped/digested and state facts stay observational', () => {
  const dir = tmp('workflow-source-state-')
  const store = new ProductStore({ path: join(dir, 'state.sqlite') })
  try {
    const ports = createWorkflowPorts(store)
    ports.conversations.create({ id: 'source-conversation', projectId: 'project-1', title: 'Source' })
    store.product.messages.append({
      id: 'source-message', conversationId: 'source-conversation', projectId: 'project-1', role: 'user',
      provenance: 'trusted_user', text: 'source text', sourceRefs: [], createdAt: at,
    })
    const source = ports.index.sourceMessage('source-message', ['project-1'])!
    assert.equal(source.textDigest, createHash('sha256').update('source text').digest('hex'))
    assert.equal(source.textLength, 11)
    assert.equal(source.projectId, 'project-1')
    assert.equal(ports.index.sourceMessage('source-message', ['project-2']), undefined)
    assert.equal(ports.index.sourceMessage('unknown', ['project-1']), undefined)
    const state = ports.state.stateFacts()
    assert.equal(state.protocol, 'workflow-state/1')
    assert.equal(state.productSchema, 12)
    assert.equal(state.writerClaim, null)
    assert.equal(state.queue.waiting, 0)
    assert.equal(state.queue.parked, 0)
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})


test('a v10 ledger upgrades to v12: old decisions stay auditable but missing-source, new assistant state reopens', () => {
  const dir = tmp('workflow-v10-upgrade-')
  const path = join(dir, 'state.sqlite')
  const legacyDecision = decision({ id: 'legacy-v10', content: 'Old decision with no source metadata' })
  try {
    const legacy = new Database(path)
    applyMigrations(legacy, { registry: MIGRATIONS.slice(0, 10) })
    legacy.prepare(`INSERT INTO user_decision_versions
      (id, version, project_id, content, authority_ref, supersedes, revoked_at, value, digest, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      legacyDecision.id, legacyDecision.version, legacyDecision.scope.projectId, legacyDecision.content,
      legacyDecision.authorityRef, null, null, JSON.stringify(legacyDecision), canonicalDigest(JSON.parse(JSON.stringify(legacyDecision))), at,
    )
    legacy.close()

    let store = new ProductStore({ path })
    try {
      assert.equal(store.database.productSchema, 12)
      const ports = createWorkflowPorts(store)
      assert.equal(ports.assistant.decisions.get('legacy-v10'), undefined)
      assert.equal(ports.assistant.legacyDecisions({ projectId: 'project-1' }).records.length, 1)
      ports.assistant.decisions.put(persistedDecision(), 0)
      ports.assistant.proposals.put(proposal(), 0)
      ports.assistant.proposals.put(proposal(2, 'confirmed', { effectCommandId: 'command-v10' }), 1)
      store.close()

      store = new ProductStore({ path })
      try {
        const reopened = createWorkflowPorts(store)
        assert.equal(reopened.assistant.decisions.get('assistant-decision')!.decision.version, 1)
        assert.equal(reopened.assistant.proposals.get('assistant-proposal')!.state, 'confirmed')
        reopened.assistant.decisions.put({ ...persistedDecision(2, { revokedAt: '2026-11-10T02:00:00.000Z' }), revokedBy: 'actor-2' }, 1)
        assert.equal(reopened.assistant.decisions.history('assistant-decision').length, 2)
        assert.equal(reopened.assistant.decisions.list({ projectId: 'project-1' }).records.length, 1)
      } finally { store.close() }
    } finally { if (store.database.productSchema) store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
