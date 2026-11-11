#!/usr/bin/env node
/**
 * Real temporary-SQLite decision transaction example.
 *
 * Shows main's copyable sequence: read-only prepare -> synchronous commit + receipt in one
 * UnitOfWork -> replay at a later time -> reopen -> revoke -> old replay without resurrection.
 * No model, network or coding task is executed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalDigest } from '@personal-agent/contracts/canonical'
import { ProductStore } from '@personal-agent/storage'
import { createWorkflowPorts } from '@personal-agent/workflows'
import { AssistantDecisionStore, DecisionTransactionService } from '../dist/index.js'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const now = '2026-11-10T00:00:00.000Z'
const scope = { projectId: 'transaction-project', allowedPaths: ['src/'], excludedPaths: [], externalActions: [] }
const actor = { actorRef: 'transaction-user', projectId: scope.projectId, grantScope: scope }

function sourcePort(ports) {
  return {
    getMessage(messageId) {
      const value = ports.index.sourceMessage(messageId, [scope.projectId])
      return value && {
        messageId: value.id,
        conversationId: value.conversationId,
        projectId: value.projectId ?? scope.projectId,
        role: value.role,
        provenance: value.provenance,
        createdAt: value.createdAt,
        textDigest: value.textDigest,
      }
    },
  }
}

async function main() {
  const root = mkdtempSync(join(tmpdir(), 'pa-decision-transaction-'))
  const file = join(root, 'state.sqlite')
  let store = new ProductStore({ path: file })
  let ports = createWorkflowPorts(store)
  try {
    store.product.messages.append({
      id: 'transaction-message',
      conversationId: 'transaction-conversation',
      projectId: scope.projectId,
      role: 'user',
      provenance: 'trusted_user',
      text: 'Explicitly retain this decision',
      sourceRefs: [],
      createdAt: now,
    })
    let tick = 0
    const clock = () => new Date(Date.parse(now) + tick)
    const service = () => new DecisionTransactionService(new AssistantDecisionStore(ports.assistant), sourcePort(ports), { now: clock })
    const input = { decisionId: 'transaction-decision', content: 'Explicit reusable decision', scope, sourceMessageId: 'transaction-message' }

    const first = service()
    const prepared = first.prepare(input, actor)
    const pendingAbsent = ports.assistant.decisions.get(input.decisionId) === undefined
    const created = store.uow.atomic(() => {
      const result = first.commit(prepared, actor)
      store.commands.record('transaction-command', canonicalDigest({ decisionId: input.decisionId }), () => ({ status: 'recorded' }))
      return result
    })

    tick = 60_000
    const later = first.prepare(input, actor)
    const replay = store.uow.atomic(() => first.commit(later, actor))

    store.close()
    store = new ProductStore({ path: file })
    ports = createWorkflowPorts(store)
    const reopened = service()
    const revoked = store.uow.atomic(() => reopened.revoke(input.decisionId, 1, actor))
    const oldReplay = store.uow.atomic(() => reopened.commit(prepared, actor))
    const history = ports.assistant.decisions.history(input.decisionId).map((record) => `${record.decision.version}:${record.decision.revokedAt ? 'revoked' : 'active'}`)

    const report = {
      protocol: 'wave05-decision-transaction/1',
      generatedAt: new Date().toISOString(),
      steps: {
        prepareWroteNothing: pendingAbsent,
        createdVersion: created.record.decision.version,
        createdStatus: created.record.status,
        replayIdempotent: replay.idempotent,
        replayRecordedAt: replay.record.recordedAt,
        revokedVersion: revoked.record.decision.version,
        revokedStatus: revoked.record.status,
        oldReplayStatus: oldReplay.record.status,
        oldReplayVersion: oldReplay.record.decision.version,
        history,
        commandRecorded: Boolean(store.commands.get('transaction-command')),
      },
      result: {
        status:
          pendingAbsent &&
          created.record.status === 'active' &&
          replay.idempotent === true &&
          revoked.record.status === 'revoked' &&
          oldReplay.record.status === 'revoked' &&
          oldReplay.record.decision.version === 2 &&
          history.length === 2
            ? 'PASS'
            : 'FAIL',
        modelCalls: 0,
        networkCalls: 0,
        sqlite: 'real temporary SQLite via A ProductStore/AssistantStatePort',
      },
    }
    mkdirSync(join(packageRoot, 'reports'), { recursive: true })
    writeFileSync(join(packageRoot, 'reports/decision-transaction-run.json'), `${JSON.stringify(report, null, 2)}\n`)
    process.stdout.write(`${JSON.stringify(report.result)}\n`)
    if (report.result.status !== 'PASS') process.exitCode = 1
  } finally {
    store.close()
    rmSync(root, { recursive: true, force: true })
  }
}

await main()
