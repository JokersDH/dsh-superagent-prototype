#!/usr/bin/env node
/**
 * Wave-04 persisted assistant consumer example over the shared AssistantStatePort fixture.
 *
 * It shows main's copyable sequence: prepare -> persistPending -> commit with effectCommandId and
 * current-authorization revalidation -> decision record -> state reload -> revoke. No model, network
 * or SQL database is used; the real storage port is A-owned.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AssistantProposalService, InMemoryAssistantState } from '@personal-agent/proposals'
import { AssistantDecisionStore, DecisionGovernance, StaticDecisionSourcePort } from '../dist/index.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const now = '2026-11-10T00:00:00.000Z'
const scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
const message = {
  messageId: 'msg-1',
  conversationId: 'conv-1',
  projectId: 'project-1',
  role: 'user',
  provenance: 'trusted_user',
  createdAt: now,
  textDigest: 'a'.repeat(64),
  title: 'Please use Chinese UI copy',
}
const actor = { actorRef: 'user-1', projectId: 'project-1', grantScope: scope }

async function main() {
  const port = new InMemoryAssistantState()
  const sources = new StaticDecisionSourcePort([message])
  const governance = new DecisionGovernance(new AssistantDecisionStore(port), sources, { now: () => new Date(now) })
  const proposals = new AssistantProposalService(port, { now: () => new Date(now) })

  const prepared = await proposals.prepare({
    proposalId: 'proposal-1',
    payload: { kind: 'propose_decision', content: 'Use Chinese UI copy', scope, sourceMessageId: 'msg-1' },
    trusted: {
      actorRef: 'user-1',
      projectId: 'project-1',
      grant: { grantId: 'grant-1', scope },
      sourceMessageId: 'msg-1',
    },
    conversationId: 'conv-1',
    sourceTextDigest: message.textDigest,
  })
  const pending = proposals.persistPending(prepared)
  const committed = proposals.commit(prepared, {
    expectedVersion: 1,
    expectedDigest: prepared.payloadDigest,
    actorRef: 'user-1',
    effectCommandId: 'command-1',
    revalidate: (candidate) => ({
      ok:
        candidate.projectId === 'project-1' &&
        candidate.conversationId === 'conv-1' &&
        candidate.sourceTextDigest === message.textDigest,
    }),
    barrier: () => ({ ok: true }),
  })

  if (committed.intent.kind !== 'record_decision') throw new Error('unexpected intent')
  const recorded = await governance.record(
    {
      decisionId: 'decision-1',
      content: committed.intent.content,
      scope: committed.intent.scope,
      sourceMessageId: committed.intent.sourceMessageId,
    },
    actor,
  )

  const restartedProposals = new AssistantProposalService(port, { now: () => new Date(now) })
  const restartedGovernance = new DecisionGovernance(new AssistantDecisionStore(port), sources, { now: () => new Date(now) })
  const reloaded = port.proposals.get('proposal-1')
  const effectiveBeforeRevoke = await restartedGovernance.isEffective('decision-1')
  const replay = restartedProposals.commit(prepared, {
    expectedVersion: 1,
    expectedDigest: prepared.payloadDigest,
    actorRef: 'user-1',
    effectCommandId: 'command-1',
  })
  await restartedGovernance.revoke('decision-1', 1, actor)
  const effectiveAfterRevoke = await restartedGovernance.isEffective('decision-1')

  const report = {
    protocol: 'wave04-persisted-consumer/1',
    generatedAt: new Date().toISOString(),
    steps: {
      preparedVersion: prepared.version,
      pendingVersion: pending.version,
      confirmedVersion: committed.record.version,
      effectCommandId: committed.record.effectCommandId,
      decisionStatus: recorded.record.status,
      proposalHistory: port.proposals.history('proposal-1').map((record) => `${record.version}:${record.state}`),
      decisionHistory: port.decisions.history('decision-1').map((record) => `${record.decision.version}:${record.decision.revokedAt ? 'revoked' : 'active'}`),
      reloadedProposalState: reloaded?.state ?? null,
      replayReplayed: replay.replayed,
      effectiveBeforeRevoke,
      effectiveAfterRevoke,
    },
    result: {
      status:
        committed.record.state === 'confirmed' &&
        reloaded?.state === 'confirmed' &&
        replay.replayed === true &&
        effectiveBeforeRevoke === true &&
        effectiveAfterRevoke === false
          ? 'PASS'
          : 'FAIL',
      modelCalls: 0,
      networkCalls: 0,
      realSqlAdapter: 'covered separately by tools/bootstrap/review-persisted-assistant.mjs (7/7 real SQLite)',
    },
  }
  mkdirSync(join(packageRoot, 'reports'), { recursive: true })
  writeFileSync(join(packageRoot, 'reports/persisted-consumer-run.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report.result)}\n`)
  if (report.result.status !== 'PASS') process.exitCode = 1
}

await main()
