import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ProductProposals } from '../../../apps/coordinator/product/proposals.ts'
import { ProductDecisions } from '../../../apps/coordinator/product/decisions.ts'
import { actor, fixture, scope } from '../../application/test/helpers.ts'
import { key } from '@personal-agent/orchestrator-core'

const TIME = '2026-11-11T00:00:00.000Z'

/** Independent consumer of main's proposal HTTP composition over a real temporary SQLite store. */
function setup(t: { after(fn: () => void): void }) {
  const h = fixture(t)
  const projects = [{ id: scope.projectId, scope: structuredClone(scope) }]
  let time = TIME
  h.store.product.messages.append({
    id: 'proposal-source',
    conversationId: 'conversation-main',
    projectId: scope.projectId,
    role: 'user',
    provenance: 'trusted_user',
    text: 'Please implement the change',
    sourceRefs: [],
    createdAt: time,
  })
  const make = () => {
    const decisions = new ProductDecisions(h.store, actor, () => projects, Buffer.alloc(32, 11), () => time)
    return new ProductProposals(h.store, h.app, decisions, actor, () => projects, Buffer.alloc(32, 11), () => time)
  }
  const service = { current: make() }
  const base = { projectId: scope.projectId, conversationId: 'conversation-main', sourceMessageId: 'proposal-source' }
  return {
    get store() {
      return h.store
    },
    get service() {
      return service.current
    },
    projects,
    decision: {
      ...base,
      payload: { kind: 'propose_decision', content: 'Keep the validation contract', scope, sourceMessageId: 'proposal-source' } as const,
    },
    work: {
      ...base,
      payload: { kind: 'propose_work', goal: 'Implement the proposed change', projectId: scope.projectId, sourceMessageId: 'proposal-source' } as const,
    },
    revision: {
      ...base,
      payload: {
        kind: 'propose_revision',
        expected: { workId: 'missing-work', revision: 1, digest: 'a'.repeat(64) },
        rationale: 'need a change',
        sourceMessageId: 'proposal-source',
      } as const,
    },
    setTime(value: string) {
      time = value
    },
    reopen() {
      h.reopen()
      service.current = make()
    },
    confirm: (preview: { token: string }, commandId: string, extra: Record<string, unknown> = {}) => ({
      kind: 'confirm_proposal' as const,
      commandId,
      projectId: base.projectId,
      conversationId: base.conversationId,
      token: preview.token,
      ...extra,
    }),
  }
}

test('a decision proposal confirms into the decision transaction and replays once', async (t) => {
  const h = setup(t)
  const preview = await h.service.prepare(h.decision, actor)
  assert.deepEqual(preview.requiredInputs, [])
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.workflows.assistant.decisions.get('decision-from-proposal'), undefined)

  const command = h.confirm(preview, 'confirm-decision')
  const receipt = await h.service.dispatch(command, actor)
  assert.equal(receipt.status, 'recorded')
  const record = h.store.workflows.assistant.proposals.get(preview.record.proposalId)
  assert.equal(record?.state, 'confirmed')
  assert.equal(record?.effectCommandId, key('proposal-effect', 'confirm-decision'))
  const decisions = h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records
  assert.equal(decisions.length, 1)
  assert.equal(decisions[0]?.sourceMessageId, 'proposal-source')
  assert.equal(
    h.store.events.after(0, 100).filter((event) => event.topic === 'application.proposal.changed').length,
    1,
  )

  h.reopen()
  h.setTime('2026-11-12T00:00:00.000Z')
  const replay = await h.service.dispatch(command, actor)
  assert.deepEqual(replay, receipt)
  assert.equal(h.store.workflows.assistant.proposals.history(record!.proposalId).length, 2)
  assert.equal(h.store.workflows.assistant.decisions.history(decisions[0]!.decision.id).length, 1)
})

test('reject is terminal, audited and never produces an effect receipt', async (t) => {
  const h = setup(t)
  const preview = await h.service.prepare(h.decision, actor)
  const receipt = await h.service.dispatch(
    { kind: 'reject_proposal', commandId: 'reject-1', projectId: scope.projectId, conversationId: 'conversation-main', token: preview.token },
    actor,
  )
  assert.equal(receipt.status, 'recorded')
  const record = h.store.workflows.assistant.proposals.get(preview.record.proposalId)
  assert.equal(record?.state, 'rejected')
  assert.equal(record?.effectCommandId, undefined)
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 0)
  const events = h.store.events.after(0, 100).filter((event) => event.topic === 'application.proposal.changed')
  assert.equal(events.length, 1)
  assert.equal((events[0]?.payload as { state?: string }).state, 'rejected')

  h.reopen()
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId)?.state, 'rejected')
  const confirmAfterReject = await h.service.dispatch(h.confirm(preview, 'confirm-after-reject'), actor)
  assert.equal(confirmAfterReject.status, 'rejected')
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId)?.state, 'rejected')
})

test('an expired preview and a changed grant are rejected without any confirmed state', async (t) => {
  const h = setup(t)
  const expiredPreview = await h.service.prepare(h.decision, actor)
  h.setTime('2026-11-11T00:06:00.000Z')
  const expired = await h.service.dispatch(h.confirm(expiredPreview, 'expired-confirm'), actor)
  assert.equal(expired.status, 'rejected')
  assert.equal(h.store.workflows.assistant.proposals.get(expiredPreview.record.proposalId), undefined)

  h.setTime(TIME)
  const preview = await h.service.prepare(h.decision, actor)
  h.projects[0]!.scope = { ...scope, allowedPaths: ['src/narrower/'] }
  const drifted = await h.service.dispatch(h.confirm(preview, 'grant-drift'), actor)
  assert.equal(drifted.status, 'rejected')
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 0)
})

test('a work proposal without user inputs stays inert; a revision without a current work is refused at prepare', async (t) => {
  const h = setup(t)
  const preview = await h.service.prepare(h.work, actor)
  assert.deepEqual(preview.requiredInputs, ['work.scope', 'work.criteria', 'work.profileId'])
  const missing = await h.service.dispatch(h.confirm(preview, 'missing-inputs'), actor)
  assert.equal(missing.status, 'rejected')
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.domain.tickets.list().length, 0)

  await assert.rejects(h.service.prepare(h.revision, actor), (error: unknown) =>
    error instanceof Error && 'error' in error && (error as { error?: { code?: string } }).error?.code === 'stale_contract')
})

test('a receipt failure rolls back the confirmed proposal and the effect', async (t) => {
  const h = setup(t)
  const preview = await h.service.prepare(h.decision, actor)
  h.store.db.exec(`CREATE TRIGGER reject_proposal_receipt BEFORE INSERT ON command_receipts
    WHEN NEW.command_id = 'confirm-fail' BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END`)
  await assert.rejects(h.service.dispatch(h.confirm(preview, 'confirm-fail'), actor))
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId), undefined)
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 0)
  assert.equal(h.store.events.after(0, 100).filter((event) => event.topic === 'application.proposal.changed').length, 0)
  assert.equal(h.store.commands.get('confirm-fail'), undefined)
  h.store.db.exec('DROP TRIGGER reject_proposal_receipt')

  const retried = await h.service.dispatch(h.confirm(preview, 'confirm-retry'), actor)
  assert.equal(retried.status, 'recorded')
  assert.equal(h.store.workflows.assistant.proposals.get(preview.record.proposalId)?.state, 'confirmed')
  assert.equal(h.store.workflows.assistant.decisions.list({ projectId: scope.projectId }).records.length, 1)
})
