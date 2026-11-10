import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ReasonerProposalSchema } from '@personal-agent/contracts'
import { ProposalError, ProposalRegistry, parseStructuredOutput } from '../src/index.ts'
import type { ProposalTrustedContext } from '../src/index.ts'

const NOW = '2026-11-10T00:00:00.000Z'
const contract = { workId: 'work-1', revision: 2, digest: 'a'.repeat(64) }
const scope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }

const trusted = (overrides: Partial<ProposalTrustedContext> = {}): ProposalTrustedContext => ({
  actorRef: 'user-1',
  projectId: 'project-1',
  grant: { grantId: 'grant-1', scope },
  sourceMessageId: 'msg-1',
  contract,
  ...overrides,
})

const trustedWithoutContract = (): ProposalTrustedContext => {
  const { contract: _contract, ...rest } = trusted()
  return rest
}

const work = (overrides: Record<string, unknown> = {}) => ({
  kind: 'propose_work',
  goal: 'Add a parser setting',
  projectId: 'project-1',
  sourceMessageId: 'msg-1',
  ...overrides,
})

const registry = (now = () => new Date(NOW), defaultTtlMs?: number) =>
  new ProposalRegistry({ now, ...(defaultTtlMs === undefined ? {} : { defaultTtlMs }) })

test('only structured output becomes a proposal; plain text and Markdown stay replies', () => {
  const plain = parseStructuredOutput('Here is a normal answer.')
  assert.equal(plain.ok, false)
  if (!plain.ok) {
    assert.equal(plain.reason, 'not_structured')
    assert.equal(plain.executable, false)
    assert.equal(plain.reply, 'Here is a normal answer.')
  }

  const fenced = parseStructuredOutput(
    'Sure, do this:\n```json\n{"kind":"propose_work","goal":"x","projectId":"project-1","sourceMessageId":"msg-1"}\n```',
  )
  assert.equal(fenced.ok, false)
  if (!fenced.ok) {
    assert.equal(fenced.reason, 'not_structured')
    assert.equal(fenced.executable, false)
    assert.equal('proposal' in fenced, false)
  }

  const noKind = parseStructuredOutput({ goal: 'x' })
  assert.equal(noKind.ok, false)

  const valid = parseStructuredOutput(work())
  assert.equal(valid.ok, true)
  if (valid.ok) assert.equal(valid.proposal.kind, 'propose_work')
})

test('a model cannot smuggle actor, tool authority, command ids or a wider work scope', () => {
  for (const extra of [
    { actorRef: 'admin' },
    { authorityRef: 'root' },
    { commandId: 'cmd-1' },
    { tools: ['shell'] },
    { scope: { ...scope, allowedPaths: ['/'] } },
  ]) {
    const parsed = parseStructuredOutput(work(extra))
    assert.equal(parsed.ok, false, `extra field should be rejected: ${JSON.stringify(extra)}`)
    if (!parsed.ok) assert.equal(parsed.reason, 'invalid_proposal')
  }
  const command = parseStructuredOutput({ kind: 'chat', text: 'run', commandId: 'c' })
  assert.equal(command.ok, false)
})

test('create binds source, project, contract and current authorization', () => {
  assert.throws(() => registry().create({ proposalId: 'p1', payload: work({ sourceMessageId: 'msg-2' }), trusted: trusted() }), (error: unknown) =>
    error instanceof ProposalError && error.code === 'source_mismatch')
  assert.throws(() => registry().create({ proposalId: 'p2', payload: work({ projectId: 'project-2' }), trusted: trusted() }), (error: unknown) =>
    error instanceof ProposalError && error.code === 'cross_project')
  assert.throws(
    () =>
      registry().create({
        proposalId: 'p3',
        payload: { kind: 'propose_decision', content: 'Use Chinese copy', scope: { ...scope, projectId: 'project-2' }, sourceMessageId: 'msg-1' },
        trusted: trusted(),
      }),
    (error: unknown) => error instanceof ProposalError && error.code === 'cross_project',
  )
  assert.throws(
    () =>
      registry().create({
        proposalId: 'p4',
        payload: { kind: 'propose_decision', content: 'Use Chinese copy', scope: { ...scope, allowedPaths: ['everything'] }, sourceMessageId: 'msg-1' },
        trusted: trusted(),
      }),
    (error: unknown) => error instanceof ProposalError && error.code === 'scope_escalation',
  )
  assert.throws(
    () =>
      registry().create({
        proposalId: 'p5',
        payload: { kind: 'propose_revision', expected: { ...contract, revision: 1 }, rationale: 'old', sourceMessageId: 'msg-1' },
        trusted: trusted(),
      }),
    (error: unknown) => error instanceof ProposalError && error.code === 'contract_stale',
  )
  assert.throws(
    () =>
      registry().create({
        proposalId: 'p6',
        payload: { kind: 'propose_revision', expected: contract, rationale: 'change', sourceMessageId: 'msg-1' },
        trusted: trustedWithoutContract(),
      }),
    (error: unknown) => error instanceof ProposalError && error.code === 'contract_stale',
  )
})

test('a proposal id is idempotent for the same payload and conflicts on a changed payload', () => {
  const first = registry().create({ proposalId: 'p1', payload: work(), trusted: trusted() })
  const twice = registry()
  const a = twice.create({ proposalId: 'p1', payload: work(), trusted: trusted() })
  const b = twice.create({ proposalId: 'p1', payload: work(), trusted: trusted() })
  assert.equal(a.payloadDigest, b.payloadDigest)
  assert.equal(b.version, 1)
  assert.equal(first.payloadDigest, a.payloadDigest)
  assert.throws(
    () => twice.create({ proposalId: 'p1', payload: work({ goal: 'Different goal' }), trusted: trusted() }),
    (error: unknown) => error instanceof ProposalError && error.code === 'conflict',
  )
})

test('confirmation returns only a typed intent and never an actor or command id', () => {
  const proposals = registry()
  const record = proposals.create({ proposalId: 'p1', payload: work(), trusted: trusted() })
  const confirmed = proposals.confirm('p1', {
    expectedVersion: record.version,
    expectedDigest: record.payloadDigest,
    actorRef: 'user-1',
  })
  assert.equal(confirmed.status, 'confirmed')
  assert.equal(confirmed.intent.kind, 'create_work')
  if (confirmed.intent.kind === 'create_work') {
    assert.equal(confirmed.intent.goal, 'Add a parser setting')
    assert.deepEqual(Object.keys(confirmed.intent).sort(), ['goal', 'kind', 'projectId', 'sourceMessageId'])
  }
  assert.equal(Object.hasOwn(confirmed.intent, 'actorRef'), false)
  assert.equal(Object.hasOwn(confirmed.intent, 'commandId'), false)
  assert.equal(Object.hasOwn(confirmed.intent, 'scope'), false)
})

test('confirmation revalidates actor, version, digest, current authorization and physical barrier', () => {
  const proposals = registry()
  const record = proposals.create({ proposalId: 'p1', payload: work(), trusted: trusted() })
  const base = { expectedVersion: record.version, expectedDigest: record.payloadDigest, actorRef: 'user-1' }
  assert.throws(() => proposals.confirm('p1', { ...base, actorRef: 'intruder' }), (error: unknown) =>
    error instanceof ProposalError && error.code === 'forbidden')
  assert.throws(() => proposals.confirm('p1', { ...base, expectedVersion: 9 }), (error: unknown) =>
    error instanceof ProposalError && error.code === 'proposal_stale')
  assert.throws(() => proposals.confirm('p1', { ...base, expectedDigest: '0'.repeat(64) }), (error: unknown) =>
    error instanceof ProposalError && error.code === 'proposal_mutated')
  assert.throws(
    () => proposals.confirm('p1', { ...base, revalidate: () => ({ ok: false, code: 'source_stale' }) }),
    (error: unknown) => error instanceof ProposalError && error.code === 'stale_authorization',
  )
  assert.throws(
    () => proposals.confirm('p1', { ...base, barrier: () => ({ ok: false, detail: 'writer_active' }) }),
    (error: unknown) => error instanceof ProposalError && error.code === 'barrier_blocked',
  )
  const ok = proposals.confirm('p1', { ...base, barrier: () => ({ ok: true }) })
  assert.equal(ok.status, 'confirmed')
  const again = proposals.confirm('p1', base)
  assert.equal(again.status, 'already_confirmed')
  assert.equal(again.idempotent, true)
})

test('a confirmed replay still authenticates the actor and current authorization', () => {
  const proposals = registry()
  const record = proposals.create({ proposalId: 'p1', payload: work(), trusted: trusted() })
  const base = { expectedVersion: record.version, expectedDigest: record.payloadDigest, actorRef: 'user-1' }
  proposals.confirm('p1', base)
  assert.throws(() => proposals.confirm('p1', { ...base, actorRef: 'foreign-user' }), (error: unknown) =>
    error instanceof ProposalError && error.code === 'forbidden')
  assert.throws(
    () => proposals.confirm('p1', { ...base, revalidate: () => ({ ok: false, code: 'grant_revoked' }) }),
    (error: unknown) => error instanceof ProposalError && error.code === 'stale_authorization',
  )
  assert.equal(proposals.confirm('p1', base).status, 'already_confirmed')
})

test('stored proposals and returned records are independent immutable snapshots', () => {
  const mutableScope = { projectId: 'project-1', allowedPaths: ['src'], excludedPaths: [], externalActions: [] }
  const proposals = registry()
  const record = proposals.create({
    proposalId: 'p1',
    payload: work(),
    trusted: { ...trusted(), grant: { grantId: 'grant-1', scope: mutableScope } },
  })
  mutableScope.allowedPaths.push('private/')
  assert.deepEqual(record.grantScope.allowedPaths, ['src'])

  assert.throws(() => {
    ;(record.grantScope.allowedPaths as string[]).push('other')
  })
  const reread = proposals.get('p1')
  assert.deepEqual(reread?.grantScope.allowedPaths, ['src'])

  const listed = proposals.list()[0]
  assert.ok(listed)
  assert.throws(() => {
    ;(listed!.grantScope.allowedPaths as string[]).push('other')
  })
  assert.deepEqual(proposals.get('p1')?.grantScope.allowedPaths, ['src'])
})

test('rejected, superseded and expired proposals cannot be confirmed', () => {
  const proposals = registry()
  const rejected = proposals.create({ proposalId: 'p1', payload: work(), trusted: trusted() })
  proposals.reject('p1', { expectedVersion: rejected.version, reason: 'not what I want', actorRef: 'user-1' })
  assert.throws(() => proposals.confirm('p1', { expectedVersion: 1, expectedDigest: rejected.payloadDigest, actorRef: 'user-1' }), (error: unknown) =>
    error instanceof ProposalError && error.code === 'proposal_not_pending')

  const older = proposals.create({ proposalId: 'p2', payload: work({ goal: 'Older' }), trusted: trusted() })
  proposals.create({ proposalId: 'p3', payload: work({ goal: 'Newer' }), trusted: trusted() })
  proposals.supersede('p2', 'p3', 'user-1')
  assert.throws(() => proposals.confirm('p2', { expectedVersion: older.version, expectedDigest: older.payloadDigest, actorRef: 'user-1' }), (error: unknown) =>
    error instanceof ProposalError && error.code === 'proposal_not_pending')
})

test('expiry is enforced at confirmation and by the sweep', () => {
  let now = Date.parse(NOW)
  const proposals = registry(() => new Date(now))
  proposals.create({ proposalId: 'p1', payload: work(), trusted: trusted({ expiresAt: '2026-11-10T00:00:01.000Z' }) })
  now += 60_000
  assert.throws(
    () => proposals.confirm('p1', { expectedVersion: 1, expectedDigest: proposals.get('p1')?.payloadDigest ?? '', actorRef: 'user-1' }),
    (error: unknown) => error instanceof ProposalError && error.code === 'proposal_expired',
  )
  assert.equal(proposals.get('p1')?.state, 'expired')

  const sweep = registry(() => new Date(now))
  sweep.create({
    proposalId: 'p2',
    payload: work(),
    trusted: trusted({ expiresAt: new Date(now + 1500).toISOString() }),
  })
  assert.equal(sweep.expire(new Date(now + 2000)).length, 1)
  assert.equal(sweep.get('p2')?.state, 'expired')
})

test('decision and revision proposals keep their exact scope and current contract', () => {
  const proposals = registry()
  const decision = proposals.create({
    proposalId: 'd1',
    payload: { kind: 'propose_decision', content: 'Use Chinese UI copy', scope, sourceMessageId: 'msg-1' },
    trusted: trusted(),
  })
  const decisionConfirm = proposals.confirm('d1', {
    expectedVersion: decision.version,
    expectedDigest: decision.payloadDigest,
    actorRef: 'user-1',
  })
  assert.equal(decisionConfirm.intent.kind, 'record_decision')
  if (decisionConfirm.intent.kind === 'record_decision') {
    assert.deepEqual(decisionConfirm.intent.scope, scope)
    assert.equal(decisionConfirm.intent.content, 'Use Chinese UI copy')
    assert.equal(decisionConfirm.intent.sourceMessageId, 'msg-1')
  }

  const revision = proposals.create({
    proposalId: 'r1',
    payload: { kind: 'propose_revision', expected: contract, rationale: 'Need a check', sourceMessageId: 'msg-1' },
    trusted: trusted(),
  })
  const revisionConfirm = proposals.confirm('r1', {
    expectedVersion: revision.version,
    expectedDigest: revision.payloadDigest,
    actorRef: 'user-1',
  })
  assert.equal(revisionConfirm.intent.kind, 'revise_work')
  if (revisionConfirm.intent.kind === 'revise_work') assert.deepEqual(revisionConfirm.intent.expected, contract)
})

test('the shared ReasonerProposal schema is the only accepted proposal shape', () => {
  const payload = { kind: 'propose_work', goal: 'x', projectId: 'project-1', sourceMessageId: 'msg-1' }
  const parsed = parseStructuredOutput(payload)
  assert.equal(parsed.ok, true)
  if (parsed.ok) assert.deepEqual(ReasonerProposalSchema.parse(payload), parsed.proposal)
})
