import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scope } from '@personal-agent/contracts'
import { InMemoryAssistantState } from '@personal-agent/proposals'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '@personal-agent/workflows'
import {
  AssistantDecisionStore,
  DecisionError,
  DecisionGovernance,
  StaticDecisionSourcePort,
} from '../src/index.ts'

const scope: Scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const at = (minutes: number) => new Date(Date.parse('2026-11-11T00:00:00.000Z') + minutes * 60_000).toISOString()

function seed(store: AssistantDecisionStore, count: number, overrides: { supersedesAt?: number } = {}): void {
  for (let index = 1; index <= count; index += 1) {
    const supersedes = overrides.supersedesAt === index ? 'decision-1' : undefined
    store.appendSync({
      decision: {
        id: `decision-${index}`,
        version: 1,
        content: `Rule ${index}`,
        scope,
        authorityRef: 'user-1',
        ...(supersedes === undefined ? {} : { supersedes }),
      },
      sourceMessageId: 'msg-1',
      sourceConversationId: 'conv-1',
      sourceTextDigest: 'a'.repeat(64),
      actorRef: 'user-1',
      recordedAt: at(index),
    })
  }
}

test('a scan that cannot complete refuses instead of reporting partial effectiveness', () => {
  const port = new InMemoryAssistantState()
  const store = new AssistantDecisionStore(port, { pageSize: 2, maxPages: 2 })
  seed(store, 5)
  for (const call of [
    () => store.getSync('decision-1'),
    () => store.listSync({ projectId: 'project-1', status: 'all' }),
    () => store.revokeSync({ decisionId: 'decision-1', expectedVersion: 1, revokedAt: at(99), actorRef: 'user-1' }),
  ]) {
    assert.throws(call, (error: unknown) =>
      error instanceof DecisionError && error.code === 'scan_incomplete')
  }
})

test('a superseded decision beyond one page boundary is still detected with default limits', () => {
  const port = new InMemoryAssistantState()
  const store = new AssistantDecisionStore(port)
  // 250 decisions exceed the store page size (200) but stay inside the default 200-page budget.
  seed(store, 250, { supersedesAt: 250 })
  assert.equal(store.getSync('decision-1')?.status, 'superseded')
  assert.equal(store.getSync('decision-2')?.status, 'active')
  assert.equal(store.getSync('decision-250')?.status, 'active')
})

test('effective knowledge never includes a decision superseded across a page boundary', async () => {
  const port = new InMemoryAssistantState()
  const store = new AssistantDecisionStore(port, { pageSize: 2, maxPages: 10 })
  seed(store, 4, { supersedesAt: 4 })
  const governance = new DecisionGovernance(
    store,
    new StaticDecisionSourcePort([
      { messageId: 'msg-1', conversationId: 'conv-1', projectId: 'project-1', role: 'user', provenance: 'trusted_user', createdAt: at(0), textDigest: 'a'.repeat(64) },
    ]),
    { now: () => new Date(at(120)) },
  )
  const effective = await governance.listEffective('project-1')
  assert.deepEqual(effective.map((record) => record.decision.id), ['decision-4', 'decision-3', 'decision-2'])
  assert.equal(effective.some((record) => record.decision.id === 'decision-1'), false)
  const page = await governance.page('project-1', { limit: 10 })
  assert.equal(page.decisions.some((decision) => decision.id === 'decision-1'), false)
})

test('an explicit caller cap is reported, not confused with a complete scan', async () => {
  const port = new InMemoryAssistantState()
  const store = new AssistantDecisionStore(port)
  seed(store, 3)
  const governance = new DecisionGovernance(
    store,
    new StaticDecisionSourcePort([
      { messageId: 'msg-1', conversationId: 'conv-1', projectId: 'project-1', role: 'user', provenance: 'trusted_user', createdAt: at(0), textDigest: 'a'.repeat(64) },
    ]),
    { now: () => new Date(at(60)) },
  )
  const capped = await governance.listEffectiveWindow('project-1', 2)
  assert.equal(capped.decisions.length, 2)
  assert.equal(capped.truncatedByLimit, true)
  const full = await governance.listEffectiveWindow('project-1', 10)
  assert.equal(full.decisions.length, 3)
  assert.equal(full.truncatedByLimit, false)
})

test('real SQLite: cross-page supersession is correct and page history is preserved', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'pa-scan-real-'))
  const store = new ProductStore({ path: join(root, 'state.sqlite') })
  t.after(() => {
    store.close()
    rmSync(root, { recursive: true, force: true })
  })
  const port = createWorkflowPorts(store)
  const decisions = new AssistantDecisionStore(port.assistant, { pageSize: 2, maxPages: 20 })
  for (let index = 1; index <= 5; index += 1) {
    store.uow.atomic(() =>
      decisions.appendSync({
        decision: {
          id: `sql-decision-${index}`,
          version: 1,
          content: `Rule ${index}`,
          scope: { ...scope, projectId: 'scan-project' },
          authorityRef: 'user-1',
          ...(index === 5 ? { supersedes: 'sql-decision-1' } : {}),
        },
        sourceMessageId: 'msg-1',
        sourceConversationId: 'conv-1',
        sourceTextDigest: 'a'.repeat(64),
        actorRef: 'user-1',
        recordedAt: at(index),
      }),
    )
  }
  assert.equal(decisions.getSync('sql-decision-1')?.status, 'superseded')
  assert.equal(decisions.getSync('sql-decision-5')?.status, 'active')
  assert.equal(port.assistant.decisions.history('sql-decision-1').length, 1)

  // A targeted probe may finish early when the superseder is on the first page.
  const bounded = new AssistantDecisionStore(port.assistant, { pageSize: 2, maxPages: 1 })
  assert.equal(bounded.getSync('sql-decision-1')?.status, 'superseded')
  // A full project scan that cannot finish still refuses instead of truncating.
  assert.throws(() => bounded.listSync({ projectId: 'scan-project', status: 'all' }), (error: unknown) =>
    error instanceof DecisionError && error.code === 'scan_incomplete')
  assert.throws(() => bounded.getSync('sql-decision-2'), (error: unknown) =>
    error instanceof DecisionError && error.code === 'scan_incomplete')
})
